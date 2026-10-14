import { config } from '../config.js';
import { prisma, disconnect } from '../db/index.js';
import { recordAudit, AUDIT_ENTITY } from '../lib/audit.js';
import { invoiceOcean } from '../services/invoicing/invoiceocean.adapter.js';

/**
 * Brings invoices that already exist in InvoiceOcean into the platform.
 *
 *   node scripts/import-invoiceocean.js --from 2026-01-01                 # dry run: what would match
 *   node scripts/import-invoiceocean.js --from 2026-01-01 --apply         # write
 *   node scripts/import-invoiceocean.js --from 2026-01-01 --to 2026-06-30 --apply
 *
 * Lists the account's documents issued in the window (pages of a hundred,
 * positions included) and matches each one's `oid` to a receivable's
 * reference — the booking or order reference, which is what the platform
 * writes as `oid` when it issues. A match becomes an `Invoice` row with
 * `source: IMPORT`, its lines, number, status and paid amount as the
 * provider has them; the chain (a VAT invoice from its proforma, a
 * correction from its VAT invoice) is linked where both ends were imported.
 * A document whose `oid` matches nothing, or whose kind the platform does
 * not keep, is listed in the report and left alone.
 *
 * Idempotent on (provider, external id): a document already here is skipped,
 * so the script can be re-run after a failure or for a later window. It
 * needs INVOICEOCEAN_DOMAIN and INVOICEOCEAN_API_TOKEN; it does not need
 * INVOICEOCEAN_ENABLED, so the history can be loaded before the switch is
 * thrown. Nothing is sent to the provider: this reads only.
 */
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
};
const from = option('--from');
const to = option('--to') ?? new Date().toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

if (!DATE.test(from ?? '') || !DATE.test(to)) {
    console.error('Usage: node scripts/import-invoiceocean.js --from YYYY-MM-DD [--to YYYY-MM-DD] [--apply]');
    process.exit(1);
}

if (!config.finance.invoiceocean.domain || !config.finance.invoiceocean.apiToken) {
    console.error('INVOICEOCEAN_DOMAIN and INVOICEOCEAN_API_TOKEN must be set in .env');
    process.exit(1);
}

const PROVIDER = 'INVOICEOCEAN';

const run = async () => {
    const report = { listed: 0, imported: 0, alreadyHere: 0, unmatched: [], unsupported: [], failed: [] };
    const byExternalId = new Map();

    for (let page = 1; page <= 200; page += 1) {
        const batch = await invoiceOcean.listInvoices({ dateFrom: from, dateTo: to, page, perPage: 100, includeLines: true });
        if (batch.length === 0) break;
        for (const remote of batch) byExternalId.set(remote.externalId, remote);
        if (batch.length < 100) break;
    }

    report.listed = byExternalId.size;

    // Oldest first, so a proforma exists here before the VAT invoice that points at it.
    const remotes = [...byExternalId.values()].sort((a, b) => `${a.issueDate}${a.externalId}`.localeCompare(`${b.issueDate}${b.externalId}`));
    const existing = new Set((await prisma.invoice.findMany({ where: { provider: PROVIDER, externalId: { in: remotes.map((r) => r.externalId) } }, select: { externalId: true } })).map((row) => row.externalId));

    for (const remote of remotes) {
        if (existing.has(remote.externalId)) {
            report.alreadyHere += 1;
            continue;
        }

        if (!remote.kind) {
            report.unsupported.push({ externalId: remote.externalId, number: remote.number, oid: remote.oid });
            continue;
        }

        const receivable = remote.oid ? await prisma.receivable.findFirst({ where: { reference: remote.oid }, include: { debtorPartner: { select: { legalName: true, name: true, taxId: true, email: true, legalAddress: true, city: true, country: true } } } }) : null;

        if (!receivable) {
            report.unmatched.push({ externalId: remote.externalId, number: remote.number, oid: remote.oid ?? null, totalCents: remote.totalCents, currency: remote.currency });
            continue;
        }

        if (!apply) {
            report.imported += 1;
            continue;
        }

        try {
            const fromInvoice = remote.fromExternalId ? await prisma.invoice.findUnique({ where: { provider_externalId: { provider: PROVIDER, externalId: remote.fromExternalId } }, select: { id: true } }) : null;
            const status = remote.status ?? 'ISSUED';
            const lines = remote.lines.length > 0 ? remote.lines : [{ description: `${remote.kind} ${remote.number ?? remote.externalId}`, quantity: 1, taxRateBps: null, totalGrossCents: remote.totalCents }];

            const invoice = await prisma.$transaction(async (tx) => {
                const created = await tx.invoice.create({
                    data: {
                        provider: PROVIDER,
                        receivableId: receivable.id,
                        kind: remote.kind,
                        // A cancelled or failed document does not count as the live one, so an
                        // imported history never blocks a new proforma; a live one does, on purpose.
                        status,
                        externalId: remote.externalId,
                        externalNumber: remote.number,
                        externalUpdatedAt: remote.updatedAt,
                        fromInvoiceId: fromInvoice?.id ?? null,
                        currency: remote.currency ?? receivable.currency,
                        lang: remote.lang ?? config.finance.invoiceocean.lang,
                        totalCents: remote.totalCents,
                        paidCents: remote.paidCents,
                        issueDate: new Date(`${remote.issueDate ?? from}T00:00:00Z`),
                        sellDate: new Date(`${remote.sellDate ?? remote.issueDate ?? from}T00:00:00Z`),
                        dueDate: remote.dueDate ? new Date(`${remote.dueDate}T00:00:00Z`) : null,
                        buyerSnapshot: receivable.debtorPartner
                            ? { name: receivable.debtorPartner.legalName || receivable.debtorPartner.name, taxId: receivable.debtorPartner.taxId ?? null, email: receivable.debtorPartner.email ?? receivable.debtorEmail, street: receivable.debtorPartner.legalAddress ?? null, city: receivable.debtorPartner.city ?? null, country: receivable.debtorPartner.country ?? null }
                            : { name: receivable.debtorName, taxId: null, email: receivable.debtorEmail, street: null, city: null, country: null },
                        publicToken: remote.publicToken,
                        lastSyncedAt: new Date(),
                        source: 'IMPORT',
                        lines: { create: lines.map((line, index) => ({ sortOrder: index, description: line.description || `Line ${index + 1}`, quantity: Math.max(1, line.quantity || 1), taxRateBps: line.taxRateBps, totalGrossCents: line.totalGrossCents, bookingReference: receivable.reference })) }
                    }
                });

                await recordAudit(tx, {
                    action: 'INVOICE_IMPORTED',
                    actor: null,
                    entityType: AUDIT_ENTITY.invoice,
                    entityId: created.id,
                    summary: `${remote.kind} ${remote.number ?? remote.externalId} imported from InvoiceOcean for ${receivable.reference}`,
                    metadata: { receivableId: receivable.id, externalId: remote.externalId, number: remote.number, status, totalCents: remote.totalCents, window: { from, to } }
                });

                return created;
            });

            existing.add(remote.externalId);
            report.imported += 1;
            console.log(`imported ${remote.kind} ${remote.number ?? remote.externalId} → ${receivable.reference} (${invoice.id})`);
        } catch (err) {
            // Most often: a live document of that kind already exists for the receivable (issued by the platform meanwhile).
            report.failed.push({ externalId: remote.externalId, number: remote.number, oid: remote.oid, error: String(err?.message ?? err).slice(0, 200) });
        }
    }

    console.log(`\n${apply ? 'Imported' : 'Would import'} ${report.imported} of ${report.listed} listed (${report.alreadyHere} already here) between ${from} and ${to}.`);

    if (report.unmatched.length > 0) {
        console.log(`\nUnmatched (${report.unmatched.length}) — no receivable has this reference:`);
        for (const row of report.unmatched) console.log(`  ${row.number ?? row.externalId}  oid=${row.oid ?? '—'}  ${(row.totalCents / 100).toFixed(2)} ${row.currency ?? ''}`);
    }

    if (report.unsupported.length > 0) {
        console.log(`\nSkipped (${report.unsupported.length}) — a kind the platform does not keep:`);
        for (const row of report.unsupported) console.log(`  ${row.number ?? row.externalId}  oid=${row.oid ?? '—'}`);
    }

    if (report.failed.length > 0) {
        console.log(`\nFailed (${report.failed.length}):`);
        for (const row of report.failed) console.log(`  ${row.number ?? row.externalId}  oid=${row.oid ?? '—'}  ${row.error}`);
    }

    if (!apply) console.log('\nDry run. Add --apply to write.');
};

run()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => disconnect());
