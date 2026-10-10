"use client";

import { Lock } from "lucide-react";

import { CheckboxField } from "./FormControls";
import { capabilityDescription, capabilityLabel, groupCapabilities } from "@/lib/admin/capabilities";

/**
 * Capabilities as a checklist, grouped by area.
 *
 * `available` is every capability the list may show; `selected` the ones
 * ticked. Protected capabilities are shown but cannot be ticked: they only
 * ever come with a built-in role, and hiding them would make the list look
 * incomplete rather than deliberate.
 */
export function CapabilityChecklist({
  available,
  selected,
  onChange,
  protectedCapabilities = [],
  disabled,
}: {
  available: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  protectedCapabilities?: string[];
  disabled?: boolean;
}) {
  const groups = groupCapabilities(available);
  const locked = new Set(protectedCapabilities);
  const chosen = new Set(selected);

  const toggle = (capability: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(capability);
    else next.delete(capability);
    onChange([...next].sort());
  };

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <fieldset key={group.area}>
          <legend className="mb-3 text-[0.75rem] font-medium tracking-wide text-muted uppercase">
            {group.label}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.capabilities.map((capability) => {
              const isLocked = locked.has(capability);

              return (
                <CheckboxField
                  key={capability}
                  label={capabilityLabel(capability)}
                  hint={
                    isLocked ? (
                      <span className="inline-flex items-center gap-1">
                        <Lock size={11} aria-hidden />
                        Only comes with a built-in role.
                      </span>
                    ) : (
                      capabilityDescription(capability) || capability
                    )
                  }
                  checked={chosen.has(capability)}
                  disabled={disabled || isLocked}
                  onChange={(on) => toggle(capability, on)}
                />
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** A read-only list of capabilities, grouped, for showing what an account can do. */
export function CapabilityList({ capabilities }: { capabilities: string[] }) {
  const groups = groupCapabilities(capabilities);

  if (groups.length === 0) {
    return <p className="text-[0.8125rem] text-muted">Nothing. This account holds no capabilities.</p>;
  }

  return (
    <dl className="space-y-4">
      {groups.map((group) => (
        <div key={group.area}>
          <dt className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">{group.label}</dt>
          <dd className="mt-1.5">
            <ul className="space-y-1">
              {group.capabilities.map((capability) => (
                <li key={capability} className="text-[0.8125rem] text-body">
                  <span className="font-medium text-ink">{capabilityLabel(capability)}</span>
                  {capabilityDescription(capability) && (
                    <span className="text-muted"> — {capabilityDescription(capability)}</span>
                  )}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The side of a role decides which capability names can be offered. */
export const capabilitiesForSide = (all: string[], side: "PLATFORM" | "PARTNER") =>
  all.filter((capability) => (side === "PARTNER") === capability.startsWith("partner."));
