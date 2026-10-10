"use client";

import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { CheckboxField, FormError, SelectInput, SubmitButton, TextInput } from "./FormControls";
import { formatPartnerDate } from "@/lib/admin/partners";
import { capabilityDescription, capabilityLabel } from "@/lib/admin/capabilities";
import { describeRbacError } from "@/lib/admin/rbacErrors";
import { grantOverride, revokeOverride, setUserRoles } from "@/lib/api/users";
import { Badge } from "@/components/ui/Badge";
import type { OverrideEffect, Role, UserDetail } from "@/types/rbac";

/**
 * The roles an account holds, as a checklist of what the viewer may assign.
 *
 * A role the account already holds but the viewer may not hand out stays
 * ticked and cannot be unticked, and is sent back with the rest: the server
 * takes the whole set, so leaving it out would quietly take it away.
 */
export function UserRolesPanel({
  user,
  assignable,
  readOnly,
}: {
  user: UserDetail;
  assignable: Role[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const held = user.roles.map((role) => role.key);
  const [selected, setSelected] = useState<string[]>(held);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offered = new Map(assignable.map((role) => [role.key, role]));
  // Held but not on offer: shown, but fixed.
  const fixed = user.roles.filter((role) => !offered.has(role.key));
  const rows: { key: string; name: string; description: string | null; isSystem: boolean; fixed: boolean }[] = [
    ...assignable.map((role) => ({ ...role, fixed: false })),
    ...fixed.map((role) => ({ key: role.key, name: role.name, description: null, isSystem: role.isSystem, fixed: true })),
  ];

  const systemKeys = new Set(rows.filter((row) => row.isSystem).map((row) => row.key));
  const hasBuiltIn = selected.some((key) => systemKeys.has(key));
  const dirty = [...selected].sort().join() !== [...held].sort().join();

  const toggle = (key: string, on: boolean) => {
    setSelected((current) => (on ? [...current, key] : current.filter((other) => other !== key)));
    setSaved(false);
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);

    try {
      await setUserRoles("staff", user.id, selected);
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(describeRbacError(caught));
    } finally {
      setBusy(false);
    }
  };

  if (readOnly) {
    return (
      <AdminPanel title="Roles" description="What this account is allowed to do comes from its roles.">
        <ul className="space-y-1.5">
          {user.roles.map((role) => (
            <li key={role.key} className="text-[0.875rem] font-medium text-ink">
              {role.name}
              {role.isSystem && (
                <Badge tone="outline" className="ms-2">
                  Built in
                </Badge>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
          This is your own account. Nobody changes their own roles; another super admin has to.
        </p>
      </AdminPanel>
    );
  }

  return (
    <AdminPanel
      title="Roles"
      description="Tick every role this account should hold. Its access is the sum of them."
    >
      <div className="space-y-3">
        {rows.map((row) => (
          <CheckboxField
            key={row.key}
            label={row.name}
            hint={
              <>
                {row.isSystem ? "Built in. " : ""}
                {row.fixed ? "You cannot change this one. " : ""}
                {row.description}
              </>
            }
            checked={selected.includes(row.key)}
            disabled={busy || row.fixed}
            onChange={(on) => toggle(row.key, on)}
          />
        ))}
      </div>

      <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted">
        Every account needs at least one built-in role as its primary role. Custom roles add to it.
        You can only hand out roles made of things you hold yourself. Open sessions end when the
        roles change, so the new access applies at the next sign-in.
      </p>

      {!hasBuiltIn && (
        <p className="mt-3 text-[0.8125rem] text-warning-text">Choose at least one built-in role.</p>
      )}

      <FormError message={error} />

      <div className="mt-5">
        <SubmitButton busy={busy} saved={saved && !dirty} disabled={!dirty || !hasBuiltIn} onClick={save}>
          {saved && !dirty ? "Saved" : "Save roles"}
        </SubmitButton>
      </div>
    </AdminPanel>
  );
}

const EFFECT_LABELS: Record<OverrideEffect, string> = {
  GRANT: "Granted",
  DENY: "Withheld",
};

/**
 * Single capabilities granted to, or withheld from, one account outside its
 * roles — for the one-off case that does not deserve a role of its own.
 */
export function UserOverridesPanel({
  user,
  grantable,
  deniable,
  readOnly,
}: {
  user: UserDetail;
  /** Capabilities the viewer may grant by name. */
  grantable: string[];
  /** Capabilities that may be withheld: every platform one that is not protected. */
  deniable: string[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [effect, setEffect] = useState<OverrideEffect>("GRANT");
  const [capability, setCapability] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const options = (effect === "GRANT" ? grantable : deniable).map((value) => ({
    value,
    label: capabilityLabel(value),
  }));
  const today = new Date().toISOString().slice(0, 10);
  const ready = capability !== "" && reason.trim().length > 0;

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await grantOverride(user.id, {
        capability,
        effect,
        reason: reason.trim(),
        // The last day is inclusive, so the override ends at the close of it.
        ...(until ? { expiresAt: new Date(`${until}T23:59:59`).toISOString() } : {}),
      });
      setCapability("");
      setReason("");
      setUntil("");
      setMessage(effect === "GRANT" ? "Granted." : "Withheld.");
      router.refresh();
    } catch (caught) {
      setError(describeRbacError(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    setRemoving(name);
    setError(null);
    setMessage(null);

    try {
      await revokeOverride(user.id, name);
      setMessage("Removed.");
      router.refresh();
    } catch (caught) {
      setError(describeRbacError(caught));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <AdminPanel
      title="Overrides"
      description="One-off exceptions to this account's roles. Prefer a role when more than one person needs the same thing."
    >
      {user.overrides.length === 0 ? (
        <p className="text-[0.8125rem] text-muted">No overrides. This account has exactly what its roles give it.</p>
      ) : (
        <ul className="divide-y divide-line">
          {user.overrides.map((override) => (
            <li key={override.capability} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="text-[0.875rem] font-medium text-ink">
                  {capabilityLabel(override.capability)}
                  <Badge tone={override.effect === "GRANT" ? "nature" : "outline"} className="ms-2">
                    {EFFECT_LABELS[override.effect]}
                  </Badge>
                </p>
                {capabilityDescription(override.capability) && (
                  <p className="mt-0.5 text-[0.75rem] text-muted">{capabilityDescription(override.capability)}</p>
                )}
                <p className="mt-1 text-[0.8125rem] text-body">{override.reason}</p>
                <p className="mt-0.5 text-[0.75rem] text-muted">
                  {override.expiresAt ? `Until ${formatPartnerDate(override.expiresAt)}` : "No end date"}
                </p>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  disabled={removing !== null}
                  onClick={() => remove(override.capability)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
                >
                  {removing === override.capability ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Trash2 size={13} aria-hidden />
                  )}
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form onSubmit={add} className="mt-5 space-y-4 border-t border-line pt-5">
          <h3 className="text-[0.8125rem] font-semibold text-ink">Add an override</h3>

          <SelectInput
            label="Effect"
            value={effect}
            onChange={(event) => {
              setEffect(event.target.value as OverrideEffect);
              setCapability("");
            }}
            options={[
              { value: "GRANT", label: "Grant: add something the roles do not give" },
              { value: "DENY", label: "Withhold: take away something the roles give" },
            ]}
          />
          <SelectInput
            label="Capability"
            value={capability}
            onChange={(event) => setCapability(event.target.value)}
            placeholder="Choose a capability"
            options={options}
            hint={capability ? capabilityDescription(capability) : undefined}
          />
          <TextInput
            label="Reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={300}
            required
            hint="Kept in the audit log."
          />
          <TextInput
            label="Last day (optional)"
            type="date"
            value={until}
            min={today}
            onChange={(event) => setUntil(event.target.value)}
            hint="Leave empty for no end date."
          />

          <SubmitButton type="submit" busy={busy} disabled={!ready}>
            {effect === "GRANT" ? "Grant" : "Withhold"}
          </SubmitButton>
        </form>
      )}

      <FormError message={error} />
      <p aria-live="polite" className="mt-3 text-[0.8125rem] text-muted empty:hidden">
        {message}
      </p>
    </AdminPanel>
  );
}
