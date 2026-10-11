// Targeted re-checks for F9, F10, F33 with correct preconditions, plus cleanup of QA bookings.
import { randomUUID } from 'node:crypto';
import { api, apiLogin, record, USERS, sql } from './lib.mjs';
const msg = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 170)}`;
const acc = (await apiLogin(USERS.accountant)).token;
const agent = (await apiLogin(USERS.agencyAgent)).token;
const AGENCY_ID = (await api('GET', '/api/auth/me', { token: agent })).body.partner.id;

// F9: allocating to a PAID receivable
const paid = sql(`select id, currency from receivables where debtor_partner_id='${AGENCY_ID}' and status='PAID' order by updated_at desc limit 1`);
if (paid) {
  const [id, cur] = paid.split('|');
  const r = await api('POST', '/api/admin/finance/payments', { token: acc, headers: { 'idempotency-key': randomUUID() }, body: { direction: 'IN', kind: 'PAYMENT', method: 'CASH', currency: cur, amountCents: 1, paidAt: new Date().toISOString(), allocations: [{ receivableId: id, amountCents: 1 }] } });
  record('F9', 'Allocating to a PAID receivable is refused (409 NOT_SETTLEABLE / 422)', r.status === 409 || r.status === 422 ? 'PASS' : 'FAIL', msg(r));
} else record('F9', 'PAID receivable precondition', 'NOT TESTED', 'none');

// F10: payment notification pipeline
const ob = sql(`select topic, processed_at is not null, last_error from outbox_events where topic='finance.payment.recorded' order by created_at desc limit 3`);
const nf = sql(`select n.kind, u.email, n.created_at from notifications n join users u on u.id=n.recipient_user_id where u.partner_id='${AGENCY_ID}' order by n.created_at desc limit 5`);
record('F10', 'Partner notified in-app of a recorded payment (FINANCE_PAYMENT_RECEIVED)', /FINANCE_PAYMENT_RECEIVED/.test(nf) ? 'PASS' : 'FAIL', `outbox=${ob.replace(/\n/g, ' ; ')} | notifications=${nf.replace(/\n/g, ' ; ')}`);
const mailLog = sql(`select count(*) from outbox_events where topic='finance.payment.recorded' and created_at > now() - interval '30 minutes'`);
record('F10b', 'Outbox events for payments written today', 'INFO', `count=${mailLog}`);

// F33: BLOCK limit refuses and writes nothing
await api('PATCH', `/api/admin/finance/partners/${AGENCY_ID}/credit`, { token: acc, body: { creditLimitCents: 1, creditLimitCurrency: 'GEL', creditLimitMode: 'BLOCK' } });
const before = sql(`select count(*) from tour_bookings where created_at > now() - interval '5 seconds'`);
const cat = await api('GET', '/api/tours?pageSize=50');
let chosen = null;
for (const t of (cat.body.data || []).filter((t) => !/^tour-/.test(t.slug)).slice(0, 10)) {
  const r = await api('GET', `/api/search/tours/${t.slug}?from=2026-11-01&to=2026-12-20&adults=1`, { token: agent });
  for (const o of (r.body.options || [])) for (const d of (o.dates || [])) if (d.available && d.token) { chosen = d; break; }
  if (chosen) break;
}
if (chosen) {
  const stamp = sql('select now()');
  const blocked = await api('POST', '/api/tours/bookings', { token: agent, headers: { 'idempotency-key': randomUUID() }, body: { offerToken: chosen.token, leadTraveller: { firstName: 'Qa', lastName: 'Credit', email: 'qa.credit2@example.test' } } });
  const rows = sql(`select count(*) from tour_bookings where created_at >= '${stamp}'`);
  const holds = sql(`select count(*) from tour_holds where created_at >= '${stamp}'`);
  record('F33', 'BLOCK credit limit: 422 CREDIT_LIMIT_EXCEEDED and no booking/hold rows written', blocked.status === 422 && rows === '0' && holds === '0' ? 'PASS' : 'FAIL', `${msg(blocked).slice(0, 120)} rows=${rows} holds=${holds}`);
}
await api('PATCH', `/api/admin/finance/partners/${AGENCY_ID}/credit`, { token: acc, body: { creditLimitCents: null } });

// cleanup QA bookings made by the agency
for (const ref of sql(`select reference from tour_bookings where lead_traveller_email like 'qa.%@example.test' and status in ('PENDING','CONFIRMED')`).split(/\r?\n/).filter(Boolean)) { const r = await api('POST', `/api/tours/bookings/${ref}/cancel`, { token: agent, body: { reason: 'QA cleanup' } }); console.log('cleanup tour', ref, r.status); }
for (const ref of sql(`select reference from hotel_bookings where lead_guest_email like 'qa.agency%@example.test' and status in ('PENDING','CONFIRMED')`).split(/\r?\n/).filter(Boolean)) { const r = await api('POST', `/api/bookings/${ref}/cancel`, { token: agent, body: { reason: 'QA cleanup' } }); console.log('cleanup hotel', ref, r.status); }
await api('POST', '/api/auth/logout', { token: acc }); await api('POST', '/api/auth/logout', { token: agent });
