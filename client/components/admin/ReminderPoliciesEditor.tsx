"use client";

import { Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { AdminPanel } from "@/components/admin/AdminPage";
import { useCan } from "@/components/admin/AdminViewerContext";
import { Cell, DataTable, EmptyRow, Row } from "@/components/admin/DataTable";
import { EntityPicker, type PickerOption } from "@/components/admin/EntityPicker";
import { CheckboxField, FormError, SubmitButton, TextInput } from "@/components/admin/FormControls";
import { ReadOnlyNote } from "@/components/admin/ReadOnlyNote";
import { DeadlineKindBadge } from "@/components/admin/StatusBadge";
import { Modal } from "@/components/ui/Modal";
import { DEADLINE_KINDS, deadlineKindLabels } from "@/lib/admin/deadlines";
import { ApiError, describeError } from "@/lib/api/client";
import { listReminderPoliciesClient, putReminderPolicy } from "@/lib/api/deadlines";
import { listPartnersClient } from "@/lib/api/partners";
import { cn } from "@/lib/utils";
import type { DeadlineKind, ReminderChannel, ReminderPolicy, ReminderPolicyInput, ReminderRecipient } from "@/types/deadline";

const CHANNELS: { value: ReminderChannel; label: string; hint: string }[] = [
  { value: "IN_APP", label: "In-app", hint: "On the bell, for staff and partner users." },
  { value: "EMAIL", label: "Email", hint: "To the partner's contact address and to guests." },
];

const RECIPIENTS: { value: ReminderRecipient; label: string; hint: string }[] = [
  { value: "STAFF", label: "Staff", hint: "The finance desk for a payment; the bookings desk for the rest." },
  { value: "PARTNER", label: "Partner", hint: "The partner's portal users, and its contact by email." },
  { value: "GUEST", label: "Guest", hint: "The guest or desk customer, by email." },
];

const channelLabel = (channel: ReminderChannel) => CHANNELS.find((entry) => entry.value === channel)?.label ?? channel;
const recipientLabel = (recipient: ReminderRecipient) => RECIPIENTS.find((entry) => entry.value === recipient)?.label ?? recipient;

/** "7, 3, 1, 0" ⇄ [7, 3, 1, 0], largest first, each once. */
const parseOffsets = (text: string): number[] =>
  [...new Set(text.split(/[,\s]+/).filter(Boolean).map(Number))].filter((n) => Number.isInteger(n) && n >= 0).sort((a, b) => b - a);

/**
 * The reminder schedule: one platform row per deadline kind, and a chosen
 * partner's overrides beneath them. Reading is open to the bookings desk;
 * saving needs `settings.reminders.write`, and the server says so too.
 */
export function ReminderPoliciesEditor({ initial }: { initial: ReminderPolicy[] }) {
  const can = useCan();
  const mayWrite = can("settings.reminders.write");

  const [policies, setPolicies] = useState(initial);
  const [partner, setPartner] = useState<PickerOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: DeadlineKind; partnerId: string | null; policy: ReminderPolicy | null } | null>(null);

  const reload = useCallback(async (partnerId: string | null) => {
    setLoading(true);
    try {
      const result = await listReminderPoliciesClient(partnerId ?? undefined);
      setPolicies(result.data);
      setError(null);
    } catch (failure) {
      setError(describeError(failure, "The schedule could not be read."));
    } finally {
      setLoading(false);
    }
  }, []);

  const platform = DEADLINE_KINDS.map((kind) => ({ kind, policy: policies.find((p) => p.scope === "PLATFORM" && p.kind === kind) ?? null }));
  const overrides = partner
    ? DEADLINE_KINDS.map((kind) => ({ kind, policy: policies.find((p) => p.scope === "PARTNER" && p.partner?.id === partner.id && p.kind === kind) ?? null }))
    : [];

  const searchPartners = async (term: string): Promise<PickerOption[]> => {
    const found = await listPartnersClient({ q: term || undefined, status: "APPROVED", pageSize: 10 });
    return found.data.map((row) => ({ id: row.id, label: row.name, meta: row.reference }));
  };

  const columns = [
    { label: "Kind" },
    { label: "Days before" },
    { label: "Channels", hideBelow: "md" as const },
    { label: "Recipients", hideBelow: "md" as const },
    { label: "Enabled" },
    { label: "" },
  ];

  const renderRow = (kind: DeadlineKind, policy: ReminderPolicy | null, partnerId: string | null) => (
    <Row key={`${partnerId ?? "platform"}:${kind}`} className={cn(policy && !policy.enabled && "opacity-60")}>
      <Cell>
        <DeadlineKindBadge kind={kind} />
      </Cell>
      <Cell>
        {policy ? (
          <span className="flex flex-wrap gap-1">
            {policy.offsetsDays.map((offset) => (
              <span key={offset} className="rounded-full bg-surface-soft px-2 py-0.5 text-[0.75rem] font-medium text-ink tabular-nums">
                {offset === 0 ? "On the day" : `${offset}d`}
              </span>
            ))}
          </span>
        ) : partnerId ? (
          <span className="text-[0.8125rem] text-subtle">Follows the platform</span>
        ) : (
          <span className="text-[0.8125rem] text-subtle">Not set</span>
        )}
      </Cell>
      <Cell hideBelow="md">{policy ? policy.channels.map(channelLabel).join(", ") : "—"}</Cell>
      <Cell hideBelow="md">{policy ? policy.recipients.map(recipientLabel).join(", ") : "—"}</Cell>
      <Cell>{policy ? (policy.enabled ? "On" : "Off") : "—"}</Cell>
      <Cell align="end">
        {mayWrite && (
          <button
            type="button"
            onClick={() => setEditing({ kind, partnerId, policy })}
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-line px-2.5 text-[0.75rem] font-medium text-ink transition-colors hover:border-ink hover:bg-surface-soft"
          >
            {policy ? "Edit" : partnerId ? <><Plus size={12} aria-hidden /> Add override</> : <><Plus size={12} aria-hidden /> Set</>}
          </button>
        )}
      </Cell>
    </Row>
  );

  return (
    <div className="flex flex-col gap-6">
      {!mayWrite && <ReadOnlyNote needs="settings.reminders.write" what="Changing the schedule" />}
      {error && <FormError message={error} />}

      <AdminPanel title="Platform schedule" description="Applies to every booking unless the partner has an override of its own." bodyClassName="p-0">
        <DataTable columns={columns} caption="Platform reminder schedule">
          {platform.map(({ kind, policy }) => renderRow(kind, policy, null))}
        </DataTable>
      </AdminPanel>

      <AdminPanel
        title="Partner overrides"
        description="Choose a partner to see, add or remove its own rows. A partner without one follows the platform schedule."
        action={
          <EntityPicker
            label="Partner"
            className="w-64"
            value={partner?.id ?? ""}
            valueLabel={partner?.label}
            onChange={(choice) => {
              setPartner(choice);
              if (choice) void reload(choice.id);
              else setPolicies((current) => current.filter((p) => p.scope === "PLATFORM"));
            }}
            search={searchPartners}
            placeholder="Choose a partner"
            clearLabel="No partner"
          />
        }
        bodyClassName="p-0"
      >
        <DataTable columns={columns} caption="Partner reminder overrides">
          {!partner ? (
            <EmptyRow colSpan={columns.length} message="Choose a partner above to see its overrides." />
          ) : loading ? (
            <EmptyRow colSpan={columns.length} message="Loading…" />
          ) : (
            overrides.map(({ kind, policy }) => renderRow(kind, policy, partner.id))
          )}
        </DataTable>
      </AdminPanel>

      <PolicyModal
        target={editing}
        platformFor={(kind) => platform.find((entry) => entry.kind === kind)?.policy ?? null}
        partnerName={partner?.label ?? null}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void reload(partner?.id ?? null);
        }}
      />
    </div>
  );
}

function PolicyModal({
  target,
  platformFor,
  partnerName,
  onClose,
  onSaved,
}: {
  target: { kind: DeadlineKind; partnerId: string | null; policy: ReminderPolicy | null } | null;
  platformFor: (kind: DeadlineKind) => ReminderPolicy | null;
  partnerName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const title = target
    ? `${deadlineKindLabels[target.kind]} · ${target.partnerId ? (partnerName ?? "Partner override") : "Platform"}`
    : "Reminder policy";
  return (
    <Modal open={target !== null} onClose={onClose} title={title} size="md">
      {target && (
        <PolicyForm
          key={`${target.partnerId ?? "platform"}:${target.kind}`}
          target={target}
          starting={target.policy ?? platformFor(target.kind)}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function PolicyForm({
  target,
  starting,
  onClose,
  onSaved,
}: {
  target: { kind: DeadlineKind; partnerId: string | null; policy: ReminderPolicy | null };
  /** The row to start from: the existing one, else the platform's for this kind. */
  starting: ReminderPolicy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = target.policy;
  const [offsets, setOffsets] = useState((starting?.offsetsDays ?? [7, 3, 1, 0]).join(", "));
  const [channels, setChannels] = useState<ReminderChannel[]>(starting?.channels ?? ["IN_APP"]);
  const [recipients, setRecipients] = useState<ReminderRecipient[]>(starting?.recipients ?? ["STAFF"]);
  const [enabled, setEnabled] = useState(starting?.enabled ?? true);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

  const send = async (body: ReminderPolicyInput, mode: "save" | "remove") => {
    setBusy(mode);
    setError(null);
    setFieldErrors({});
    try {
      await putReminderPolicy(body);
      onSaved();
    } catch (failure) {
      if (failure instanceof ApiError) setFieldErrors(failure.fieldErrors());
      setError(describeError(failure, "The schedule could not be saved."));
      setBusy(null);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseOffsets(offsets);
    const local: Record<string, string> = {};
    if (parsed.length === 0) local.offsetsDays = "Give at least one number of days, 0 for the day itself.";
    if (parsed.some((n) => n > 365)) local.offsetsDays = "A reminder cannot go out more than a year ahead.";
    if (channels.length === 0) local.channels = "Choose at least one channel.";
    if (recipients.length === 0) local.recipients = "Choose at least one recipient.";
    setFieldErrors(local);
    if (Object.keys(local).length > 0) return;
    void send({ kind: target.kind, partnerId: target.partnerId, offsetsDays: parsed, channels, recipients, enabled }, "save");
  };

  return (
    <form onSubmit={submit} className="px-6 pt-4 pb-6">
      <p className="text-[0.8125rem] leading-relaxed text-muted">
        {target.partnerId
          ? "This row applies to the partner's bookings only and replaces the platform row for them."
          : "The platform row applies to every booking without a partner override. It can be switched off, never removed."}
      </p>

      <div className="mt-5 grid gap-5">
        <TextInput
          label="Days before the deadline"
          value={offsets}
          onChange={(event) => setOffsets(event.target.value)}
          placeholder="7, 3, 1, 0"
          hint="Comma-separated. 0 is the day itself. Counted in calendar days in the booking's own time zone."
          error={fieldErrors.offsetsDays}
          mono
        />

        <fieldset>
          <legend className="block text-[0.75rem] font-semibold text-muted">Channels</legend>
          <div className="mt-2 grid gap-2">
            {CHANNELS.map((channel) => (
              <CheckboxField
                key={channel.value}
                label={channel.label}
                hint={channel.hint}
                checked={channels.includes(channel.value)}
                onChange={() => setChannels((current) => toggle(current, channel.value))}
              />
            ))}
          </div>
          {fieldErrors.channels && <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">{fieldErrors.channels}</p>}
        </fieldset>

        <fieldset>
          <legend className="block text-[0.75rem] font-semibold text-muted">Recipients</legend>
          <div className="mt-2 grid gap-2">
            {RECIPIENTS.map((recipient) => (
              <CheckboxField
                key={recipient.value}
                label={recipient.label}
                hint={recipient.hint}
                checked={recipients.includes(recipient.value)}
                onChange={() => setRecipients((current) => toggle(current, recipient.value))}
              />
            ))}
          </div>
          {fieldErrors.recipients && <p role="alert" className="mt-1.5 text-[0.75rem] text-error-text">{fieldErrors.recipients}</p>}
        </fieldset>

        <CheckboxField label="Enabled" hint="Switched off, the row sends nothing." checked={enabled} onChange={setEnabled} />
      </div>

      <FormError message={error} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        {target.partnerId && existing ? (
          <button
            type="button"
            disabled={busy !== null}
            // The body must still validate (at least one offset, channel and recipient); the row's own values do.
            onClick={() =>
              void send(
                {
                  kind: target.kind,
                  partnerId: target.partnerId,
                  offsetsDays: existing.offsetsDays,
                  channels: existing.channels,
                  recipients: existing.recipients,
                  enabled: existing.enabled,
                  remove: true,
                },
                "remove",
              )
            }
            className="text-[0.8125rem] font-medium text-error-text underline-offset-4 hover:underline disabled:opacity-50"
          >
            {busy === "remove" ? "Removing…" : "Remove override"}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink transition-colors hover:border-ink hover:bg-surface-soft disabled:opacity-50"
          >
            Cancel
          </button>
          <SubmitButton type="submit" busy={busy === "save"}>
            Save
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
