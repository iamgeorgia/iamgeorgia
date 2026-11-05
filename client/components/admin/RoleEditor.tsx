"use client";

import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { CapabilityChecklist, capabilitiesForSide } from "./CapabilityChecklist";
import { RolePreview } from "./RolePreview";
import { FormError, SubmitButton, TextArea, TextInput } from "./FormControls";
import { Badge } from "@/components/ui/Badge";
import { describeRbacError } from "@/lib/admin/rbacErrors";
import { deleteRole, updateRole } from "@/lib/api/roles";
import { useLocalePath } from "@/lib/i18n/provider";
import type { CapabilityCatalogue, Role } from "@/types/rbac";

/** Roles whose capabilities the server will not let anyone edit. */
const LOCKED_ROLES = ["SUPER_ADMIN", "DRIVER"];

/**
 * One role: its name, its description and the capabilities it carries.
 *
 * The key and the side are fixed at creation, so they are shown and not
 * editable. Built-in roles can have their capabilities changed (bar the two
 * the server locks) but not be deleted. What the server refuses, it explains,
 * and that explanation is what lands under the form.
 */
export function RoleEditor({ role, catalogue }: { role: Role; catalogue: CapabilityCatalogue }) {
  const router = useRouter();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [capabilities, setCapabilities] = useState([...role.capabilities].sort());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = LOCKED_ROLES.includes(role.key);
  const everything = role.key === "SUPER_ADMIN";
  const available = capabilitiesForSide(
    catalogue.data.flatMap((group) => group.capabilities),
    role.side,
  );

  const dirty =
    name.trim() !== role.name ||
    description.trim() !== (role.description ?? "") ||
    capabilities.join() !== [...role.capabilities].sort().join();

  const touch = () => {
    setSaved(false);
    setError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      await updateRole(role.key, {
        name: name.trim(),
        description: description.trim(),
        ...(locked ? {} : { capabilities }),
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(describeRbacError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={save} className="space-y-6">
        <AdminPanel title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              label="Name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                touch();
              }}
              required
              maxLength={80}
            />
            <TextInput label="Key" value={role.key} readOnly mono hint="Fixed once the role exists." />
            <TextArea
              label="Description"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                touch();
              }}
              rows={2}
              className="sm:col-span-2"
              hint="Shown when someone chooses a role for an account."
            />
            <TextInput
              label="Side"
              value={role.side === "PLATFORM" ? "Platform (staff)" : "Partner (company teams)"}
              readOnly
              hint="Fixed once the role exists."
            />
          </div>
        </AdminPanel>

        <AdminPanel
          title="What this role can do"
          description={
            locked && !everything
              ? "This role's capabilities are fixed."
              : "Tick what an account with this role may do. Changes apply the next time they sign in."
          }
        >
          {everything ? (
            <p className="text-[0.875rem] text-body">
              Holds every platform capability. It grows with the platform and cannot be edited.
            </p>
          ) : (
            <CapabilityChecklist
              available={available}
              selected={capabilities}
              onChange={(next) => {
                setCapabilities(next);
                touch();
              }}
              protectedCapabilities={catalogue.protected}
              disabled={locked}
            />
          )}
        </AdminPanel>

        {/* What an account with this role sees, from the ticks as they stand —
            the super admin sees everything, so the preview is for the rest. */}
        {role.side === "PLATFORM" && !everything && <RolePreview capabilities={capabilities} />}

        <FormError message={error} />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            type="submit"
            busy={busy}
            saved={saved && !dirty}
            disabled={!dirty || name.trim() === ""}
          >
            {saved && !dirty ? "Saved" : "Save changes"}
          </SubmitButton>
          {!everything && (
            <p className="text-[0.8125rem] text-muted">
              {capabilities.length} {capabilities.length === 1 ? "capability" : "capabilities"} selected
            </p>
          )}
        </div>
      </form>

      <RoleDangerZone role={role} />
    </>
  );
}

function RoleDangerZone({ role }: { role: Role }) {
  const router = useRouter();
  const path = useLocalePath();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inUse = (role.members ?? 0) > 0;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);

    try {
      await deleteRole(role.key);
      router.replace(path("/admin/roles"));
      router.refresh();
    } catch (caught) {
      setError(describeRbacError(caught));
      setDeleting(false);
    }
  };

  return (
    <AdminPanel title="Delete this role" className="mt-6 border-error/30">
      {role.isSystem ? (
        <p className="text-[0.8125rem] leading-relaxed text-muted">
          <Badge tone="outline" className="me-2">
            Built in
          </Badge>
          Built-in roles cannot be deleted.
        </p>
      ) : (
        <>
          <p className="text-[0.8125rem] leading-relaxed text-muted">
            {inUse
              ? `${role.members} ${role.members === 1 ? "account holds" : "accounts hold"} this role. Take it off them before deleting it.`
              : "No one holds this role. Deleting it removes it for good."}
          </p>

          {!confirming ? (
            <button
              type="button"
              disabled={inUse}
              onClick={() => setConfirming(true)}
              className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-error/40 bg-surface px-4 text-[0.8125rem] font-medium text-error-text transition-colors hover:bg-error/8 disabled:opacity-50"
            >
              <Trash2 size={15} aria-hidden />
              Delete role
            </button>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-sm bg-error px-4 text-[0.8125rem] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {deleting ? (
                  <Loader2 size={15} className="animate-spin" aria-hidden />
                ) : (
                  <Trash2 size={15} aria-hidden />
                )}
                Delete permanently
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirming(false)}
                className="inline-flex h-10 items-center rounded-sm border border-line bg-surface px-4 text-[0.8125rem] font-medium text-body transition-colors hover:border-ink/40 hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 text-[0.8125rem] text-error-text">
              {error}
            </p>
          )}
        </>
      )}
    </AdminPanel>
  );
}
