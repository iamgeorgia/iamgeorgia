"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminPanel } from "./AdminPage";
import { CapabilityChecklist, capabilitiesForSide } from "./CapabilityChecklist";
import { RolePreview } from "./RolePreview";
import { FormError, SelectInput, SubmitButton, TextArea, TextInput } from "./FormControls";
import { describeRbacError } from "@/lib/admin/rbacErrors";
import { ApiError } from "@/lib/api/client";
import { createRole } from "@/lib/api/roles";
import { useLocalePath } from "@/lib/i18n/provider";
import type { CapabilityCatalogue, RoleSide } from "@/types/rbac";

const KEY_PATTERN = /^[a-z][a-z0-9_]{2,40}$/;

/** Turns "Night desk" into `night_desk`: a starting point the person can still edit. */
const keyFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 41);

/** Creates a custom role: name, side and the capabilities it starts with. */
export function NewRoleForm({ catalogue }: { catalogue: CapabilityCatalogue }) {
  const router = useRouter();
  const path = useLocalePath();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [side, setSide] = useState<RoleSide>("PLATFORM");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const available = capabilitiesForSide(
    catalogue.data.flatMap((group) => group.capabilities),
    side,
  );
  const keyValid = KEY_PATTERN.test(key);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!keyValid || name.trim() === "") return;

    setBusy(true);
    setError(null);
    setFieldErrors({});

    try {
      const created = await createRole({
        key,
        name: name.trim(),
        side,
        capabilities,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      router.push(path(`/admin/roles/${created.key}`));
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeRbacError(caught));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <AdminPanel title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!keyTouched) setKey(keyFrom(event.target.value));
            }}
            placeholder="Night desk"
            required
            maxLength={80}
            error={fieldErrors.name || undefined}
          />
          <TextInput
            label="Key"
            value={key}
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value.toLowerCase());
            }}
            mono
            autoComplete="off"
            spellCheck={false}
            required
            hint="Lower-case letters, numbers and underscores, 3 to 41 characters. It cannot be changed later."
            error={
              fieldErrors.key ||
              (key && !keyValid
                ? "Use lower-case letters, numbers and underscores, starting with a letter."
                : undefined)
            }
          />
          <SelectInput
            label="Side"
            value={side}
            onChange={(event) => {
              setSide(event.target.value as RoleSide);
              setCapabilities([]);
            }}
            options={[
              { value: "PLATFORM", label: "Platform (staff)" },
              { value: "PARTNER", label: "Partner (company teams)" },
            ]}
            hint="Platform roles are for staff in this panel; partner roles are for the teams of agencies and suppliers. It cannot be changed later."
          />
          <TextArea
            label="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
          />
        </div>
      </AdminPanel>

      <AdminPanel title="What this role can do" description="You can only tick what you hold yourself.">
        <CapabilityChecklist
          available={available}
          selected={capabilities}
          onChange={setCapabilities}
          protectedCapabilities={catalogue.protected}
        />
      </AdminPanel>

      {/* The effect of the ticks, before anyone is given the role. Partner
          roles have no sidebar here; the portal reads its own capabilities. */}
      {side === "PLATFORM" && <RolePreview capabilities={capabilities} />}

      <FormError message={error} />

      <SubmitButton type="submit" busy={busy} disabled={!keyValid || name.trim() === ""}>
        Create role
      </SubmitButton>
    </form>
  );
}
