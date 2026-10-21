"use client";

import { FilterDisclosure } from "@/components/ui/FilterDisclosure";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, History, Search, UserRound, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import { Cell, DataTable, EmptyRow, Row, type Column } from "./DataTable";
import {
  AUDIT_ACTION_GROUPS,
  AUDIT_ENTITY_TYPES,
  auditActionLabel,
  auditEntityHref,
  auditEntityLabel,
  auditEntityLabels,
  formatAuditTime,
  humanizeConstant,
} from "@/lib/admin/audit";
import type { GlobalAuditEntry } from "@/lib/api/audit";
import { useLocalePath } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

interface AuditBrowserProps {
  entries: GlobalAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** The viewer's capabilities, so a row only links where the viewer may follow. */
  capabilities: string[];
}

const COLUMNS: Column[] = [
  { label: "When" },
  { label: "Who" },
  { label: "Action" },
  { label: "What" },
  { label: "Summary" },
];

const field =
  "h-10 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-ink outline-none focus:border-ink";

const smallLink =
  "inline-flex items-center gap-1 text-[0.75rem] text-brand-text underline-offset-4 hover:underline";

/**
 * The audit trail and its filters.
 *
 * The same URL-state pattern as `PartnersBrowser`: the filters write to the
 * address and the Server Component above re-reads the trail, so a filtered
 * view — "everything Nino did last Tuesday" — is a link that can be sent to
 * whoever asked. Two filters have no control of their own: the person and the
 * record. They are set from a row (the person's name, a record's History
 * link) and shown as removable chips, because nobody types an id.
 */
export function AuditBrowser({
  entries,
  total,
  page,
  pageSize,
  totalPages,
  capabilities,
}: AuditBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const path = useLocalePath();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const action = params.get("action") ?? "all";
  const entityType = params.get("entityType") ?? "all";
  const entityId = params.get("entityId");
  const actor = params.get("actor");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  const apply = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }

    // Any change to the filters invalidates the page number: page 3 of a
    // narrower result set is usually empty.
    if (!("page" in changes)) next.delete("page");

    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  };

  // Debounced, so typing an email is one navigation rather than one per
  // keystroke. The input stays controlled locally so it never feels laggy.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (query === current) return;

    const timer = setTimeout(() => apply({ q: query.trim() || null }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const activeFilters = [
    action !== "all",
    entityType !== "all",
    Boolean(entityId),
    Boolean(actor),
    Boolean(from),
    Boolean(to),
    query.trim() !== "",
  ].filter(Boolean).length;

  // The chip names the person when any row on the page is theirs; with a
  // filter on, every row is, unless the filters leave nothing.
  const actorName = actor
    ? entries.find((entry) => entry.actor?.id === actor)?.actor?.fullName ?? "One person"
    : null;

  const filterByActor = (id: string) => apply({ actor: id });
  const filterByRecord = (entry: GlobalAuditEntry) =>
    apply({ entityType: entry.entityType, entityId: entry.entityId });

  const renderWho = (entry: GlobalAuditEntry) => <Who entry={entry} onFilter={filterByActor} />;
  const renderWhat = (entry: GlobalAuditEntry) => {
    const href = auditEntityHref(entry, capabilities);
    return (
      <>
        <span className="block text-body">{auditEntityLabel(entry.entityType)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {href && (
            // No prefetch: several detail pages read their record for the
            // title, and a page of fifty rows would spend fifty API calls
            // against the panel's shared rate limit before anyone clicked.
            <Link href={path(href)} prefetch={false} className={smallLink}>
              Open
              <ChevronRight size={12} className="rtl:-scale-x-100" aria-hidden />
            </Link>
          )}
          {entityId !== entry.entityId && (
            <button type="button" onClick={() => filterByRecord(entry)} className={smallLink}>
              <History size={12} aria-hidden />
              History
              <span className="sr-only"> of this {auditEntityLabel(entry.entityType).toLowerCase()}</span>
            </button>
          )}
        </span>
      </>
    );
  };

  return (
    <section className="mt-8">
      <div className="rounded-sm border border-line bg-surface p-4 sm:p-5">
        <FilterDisclosure
          count={[entityType !== "all", action !== "all", from !== "", to !== ""].filter(Boolean).length}
          lead={
          <div className="relative min-w-[16rem] flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute top-1/2 start-3 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Summary text, email address or record ID"
              aria-label="Search the audit log"
              className="h-11 w-full rounded-sm border border-line bg-background ps-9 pe-3 text-sm text-ink transition-colors focus:border-ink focus:outline-none"
            />
          </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">Type</span>
              <select
                value={entityType}
                onChange={(event) =>
                  // A record filter belongs to one type; changing the type drops it.
                  apply({ entityType: event.target.value, entityId: null })
                }
                className={cn(field, "w-full min-w-0")}
              >
                <option value="all">All types</option>
                {AUDIT_ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {auditEntityLabels[type]}
                  </option>
                ))}
                {entityType !== "all" && !auditEntityLabels[entityType] && (
                  <option value={entityType}>{auditEntityLabel(entityType)}</option>
                )}
              </select>
            </label>

            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">Action</span>
              <select
                value={action}
                onChange={(event) => apply({ action: event.target.value })}
                className={cn(field, "w-full min-w-0")}
              >
                <option value="all">All actions</option>
                {AUDIT_ACTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.actions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <fieldset className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 xl:col-span-1">
              <legend className="mb-1.5 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
                Dates <span className="normal-case tracking-normal">(Tbilisi time)</span>
              </legend>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(event) => apply({ from: event.target.value || null })}
                  aria-label="On or after"
                  className={cn(field, "min-w-0 flex-1 sm:flex-none")}
                />
                <span aria-hidden className="text-muted">
                  –
                </span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(event) => apply({ to: event.target.value || null })}
                  aria-label="On or before"
                  className={cn(field, "min-w-0 flex-1 sm:flex-none")}
                />
              </div>
            </fieldset>
          </div>
        </FilterDisclosure>

        {(actor || entityId) && (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Narrowed to">
            {actor && (
              <li>
                <FilterChip
                  label={`Person: ${actorName}`}
                  onRemove={() => apply({ actor: null })}
                />
              </li>
            )}
            {entityId && (
              <li>
                <FilterChip
                  label={`${entityType !== "all" ? auditEntityLabel(entityType) : "Record"} ${shortId(entityId)}`}
                  title={entityId}
                  onRemove={() => apply({ entityId: null })}
                />
              </li>
            )}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <p aria-live="polite" className={cn("text-[0.8125rem] text-muted", pending && "opacity-50")}>
            {total === 1 ? "1 entry" : `${total.toLocaleString("en-GB")} entries`}
            {activeFilters > 0 && " matching your filters"}
          </p>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                apply({
                  q: null,
                  action: null,
                  entityType: null,
                  entityId: null,
                  actor: null,
                  from: null,
                  to: null,
                });
              }}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] text-brand-text underline-offset-4 hover:underline"
            >
              <X size={13} aria-hidden />
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className={cn("mt-5 transition-opacity", pending && "opacity-60")}>
        <div className="hidden lg:block">
          <DataTable columns={COLUMNS} caption="Audit log entries, newest first">
            {entries.length === 0 && (
              <EmptyRow
                colSpan={COLUMNS.length}
                message={activeFilters > 0 ? "No entries match your filters." : "Nothing has been recorded yet."}
              />
            )}

            {entries.map((entry) => {
              const when = formatAuditTime(entry.createdAt);
              return (
                <Row key={entry.id} className="[&>td]:align-top">
                  <Cell className="whitespace-nowrap">
                    <time dateTime={entry.createdAt}>
                      <span className="block text-body">{when.date}</span>
                      <span className="block font-mono text-[0.75rem] text-muted">{when.time}</span>
                    </time>
                  </Cell>
                  <Cell className="max-w-[14rem]">{renderWho(entry)}</Cell>
                  <Cell>
                    <span className="font-medium text-ink">{auditActionLabel(entry.action)}</span>
                  </Cell>
                  <Cell className="whitespace-nowrap">{renderWhat(entry)}</Cell>
                  <Cell className="min-w-[16rem]">
                    <p className="break-words text-body">{entry.summary}</p>
                    <AuditMetadata metadata={entry.metadata} />
                  </Cell>
                </Row>
              );
            })}
          </DataTable>
        </div>

        <ul className="space-y-3 lg:hidden">
          {entries.length === 0 && (
            <li className="rounded-sm border border-line bg-surface p-6 text-center text-[0.8125rem] text-muted">
              {activeFilters > 0 ? "No entries match your filters." : "Nothing has been recorded yet."}
            </li>
          )}

          {entries.map((entry) => {
            const when = formatAuditTime(entry.createdAt);
            return (
              <li key={entry.id} className="min-w-0 rounded-sm border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-medium text-ink">{auditActionLabel(entry.action)}</p>
                  <time dateTime={entry.createdAt} className="text-[0.75rem] text-muted">
                    {when.date} · <span className="font-mono">{when.time}</span>
                  </time>
                </div>
                <p className="mt-2 break-words text-[0.875rem] text-body">{entry.summary}</p>
                <div className="mt-3 grid gap-3 text-[0.8125rem] sm:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">Who</p>
                    <div className="mt-1">{renderWho(entry)}</div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-muted uppercase">What</p>
                    <div className="mt-1">{renderWhat(entry)}</div>
                  </div>
                </div>
                <AuditMetadata metadata={entry.metadata} />
              </li>
            );
          })}
        </ul>
      </div>

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => apply({ page: String(page - 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-[0.8125rem] text-muted">
            Page {page} of {totalPages}
            <span className="sr-only">, {pageSize} per page</span>
          </p>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => apply({ page: String(page + 1) })}
            className="h-10 rounded-sm border border-line bg-surface px-4 text-[0.8125rem] text-body transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

/** The first and last few characters of a cuid — enough to tell two apart. */
const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);

/**
 * Who acted. Three cases: a live account (named, and a filter); an account
 * since deleted, which the trail still names by its email snapshot; and the
 * platform itself — expiries, reminders, and sign-in failures, where by
 * definition nobody was signed in.
 */
function Who({ entry, onFilter }: { entry: GlobalAuditEntry; onFilter: (id: string) => void }) {
  if (entry.actor) {
    const actor = entry.actor;
    return (
      <>
        <button
          type="button"
          onClick={() => onFilter(actor.id)}
          title="Show only this person's actions"
          className="inline-flex max-w-full items-center gap-1.5 text-start font-medium text-ink underline-offset-4 hover:underline"
        >
          <UserRound size={13} className="shrink-0 text-subtle" aria-hidden />
          <span className="truncate">{actor.fullName}</span>
          <span className="sr-only">, show only their actions</span>
        </button>
        <span className="block truncate text-[0.75rem] text-muted">{actor.email}</span>
      </>
    );
  }

  if (entry.actorEmail && entry.actorEmail !== "system") {
    return (
      <>
        <span className="block truncate text-body">{entry.actorEmail}</span>
        <span className="block text-[0.75rem] text-muted">Account since removed</span>
      </>
    );
  }

  return <span className="text-muted italic">system</span>;
}

function FilterChip({
  label,
  title,
  onRemove,
}: {
  label: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink bg-ink py-1 ps-3 pe-1.5 text-[0.8125rem] text-on-dark"
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
      >
        <X size={12} aria-hidden />
        <span className="sr-only">Remove filter: {label}</span>
      </button>
    </span>
  );
}

/**
 * The row's metadata, folded away and laid out as key–value pairs.
 *
 * Shapes vary by action — a reason, a list of edited fields, a before and an
 * after — so the renderer is generic: plain values print as text, flat lists
 * join, nested objects indent one level, and anything deeper falls back to
 * indented JSON rather than one unreadable line.
 */
function AuditMetadata({ metadata }: { metadata: Record<string, unknown> }) {
  const keys = metadata && typeof metadata === "object" ? Object.keys(metadata) : [];
  if (keys.length === 0) return null;

  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[0.75rem] text-muted transition-colors select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={12}
          className="transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90"
          aria-hidden
        />
        Details ({keys.length})
      </summary>
      <div className="mt-2 rounded-sm border border-line bg-surface-soft/50 px-3 py-2">
        <MetadataList value={metadata} depth={0} />
      </div>
    </details>
  );
}

/** `ttlSeconds` → "Ttl seconds"; snake case reads the same way. */
const humanizeKey = (key: string) => humanizeConstant(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));

const isPlain = (value: unknown) =>
  value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);

function MetadataList({ value, depth }: { value: Record<string, unknown>; depth: number }) {
  return (
    <dl className="space-y-1.5">
      {Object.entries(value).map(([key, entry]) => (
        <div key={key} className="grid gap-x-3 gap-y-0.5 text-[0.75rem] sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
          <dt className="truncate text-muted" title={key}>
            {humanizeKey(key)}
          </dt>
          <dd className="min-w-0 break-words text-body">
            <MetadataValue value={entry} depth={depth} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MetadataValue({ value, depth }: { value: unknown; depth: number }) {
  if (value === null || value === undefined || value === "") return <span className="text-subtle">—</span>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (typeof value === "number") return <span className="font-mono">{value}</span>;
  if (typeof value === "string") return <>{value}</>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-subtle">none</span>;
    if (value.every(isPlain)) return <>{value.map((item) => String(item ?? "—")).join(", ")}</>;
  } else if (typeof value === "object" && depth < 1) {
    return (
      <div className="border-s border-line ps-3">
        <MetadataList value={value as Record<string, unknown>} depth={depth + 1} />
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-body">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
