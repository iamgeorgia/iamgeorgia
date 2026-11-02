"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { describeError } from "@/lib/api/client";
import { setTransferProviderPaymentPolicy } from "@/lib/api/payments";
import { cn } from "@/lib/utils";
import type { PaymentPolicy } from "@/types/catalogue";
import type { PaymentPolicyProductKind } from "@/types/payments";
import type { TransferProvider } from "@/types/transfer";

import { useCan } from "./AdminViewerContext";
import { AdminPanel } from "./AdminPage";
import { FormError } from "./FormControls";
import { PaymentPolicyEditor, paymentTimingLabels } from "./PaymentPolicyEditor";
import { PaymentPolicySelect } from "./PaymentPolicySelect";
import { ReadOnlyNote } from "./ReadOnlyNote";

const KINDS: { value: PaymentPolicyProductKind; label: string; note: string }[] = [
  { value: "TOUR", label: "Tours", note: "Attached to each tour option." },
  { value: "PACKAGE", label: "Packages", note: "Attached to each package." },
  { value: "TRANSFER", label: "Transfers", note: "Attached to each transfer supplier, not to routes." },
];

interface PaymentPoliciesManagerProps {
  policies: Record<PaymentPolicyProductKind, PaymentPolicy[]>;
  providers: TransferProvider[];
}

/** Platform payment policy templates by product kind, and the transfer suppliers' choice of one. */
export function PaymentPoliciesManager({ policies, providers }: PaymentPoliciesManagerProps) {
  const router = useRouter();
  const can = useCan();
  const canEdit = can("catalogue.write");

  const [kind, setKind] = useState<PaymentPolicyProductKind>("TOUR");
  // "new" for the create form, a policy id for an edit, null for neither.
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  const rows = policies[kind];
  const active = KINDS.find((entry) => entry.value === kind)!;

  const done = () => {
    setEditing(null);
    router.refresh();
  };

  const chooseForProvider = async (provider: TransferProvider, policyId: string) => {
    setSavingProvider(provider.id);
    setError(null);
    try {
      await setTransferProviderPaymentPolicy(provider.id, policyId || null);
      router.refresh();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSavingProvider(null);
    }
  };

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Product kind" className="flex flex-wrap gap-2">
        {KINDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={kind === entry.value}
            onClick={() => {
              setKind(entry.value);
              setEditing(null);
            }}
            className={cn(
              "rounded-full border px-4 py-1.5 text-[0.8125rem] transition-colors",
              kind === entry.value
                ? "border-ink bg-ink text-on-dark"
                : "border-line bg-surface text-body hover:border-ink/40 hover:text-ink",
            )}
          >
            {entry.label}
            <span className="ms-1.5 text-[0.75rem] opacity-70">{policies[entry.value].length}</span>
          </button>
        ))}
      </div>

      <AdminPanel
        title={`${active.label} payment policies`}
        description={`${active.note} Nothing attached means the platform default.`}
        bodyClassName="p-0"
        action={
          canEdit && editing !== "new" ? (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-ink/20 px-3 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft"
            >
              <Plus size={14} aria-hidden />
              New policy
            </button>
          ) : undefined
        }
      >
        {editing === "new" && (
          <PaymentPolicyEditor productKind={kind} onSaved={done} onCancel={() => setEditing(null)} />
        )}

        <ul className="divide-y divide-line">
          {rows.length === 0 && (
            <li className="px-5 py-4 text-[0.8125rem] text-muted">No policies for {active.label.toLowerCase()} yet.</li>
          )}
          {rows.map((policy) => (
            <li key={policy.id}>
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-[0.875rem] font-medium text-ink">
                    {policy.name}
                    {!policy.isActive && <span className="ms-2 text-[0.75rem] text-muted">(inactive)</span>}
                  </p>
                  <p className="mt-0.5 text-[0.75rem] text-muted">
                    {paymentTimingLabels[policy.timing]}
                    {policy.unpaidCancelHours != null && ` · cancels unpaid after ${policy.unpaidCancelHours} h`}
                    {policy.cardOptional && " · card also offered"}
                    {policy.depositBps != null && ` · deposit ${policy.depositBps / 100}%`}
                  </p>
                  {policy.description && <p className="mt-1 text-[0.8125rem] text-body">{policy.description}</p>}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(editing === policy.id ? null : policy.id)}
                    className="text-[0.8125rem] font-medium text-ink hover:underline"
                  >
                    {editing === policy.id ? "Close" : "Edit"}
                  </button>
                )}
              </div>
              {editing === policy.id && (
                <PaymentPolicyEditor
                  productKind={kind}
                  policy={policy}
                  onSaved={done}
                  onCancel={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      </AdminPanel>

      {kind === "TRANSFER" && (
        <AdminPanel
          title="Transfer suppliers"
          description="One policy per supplier, because routes are many and prices are per vehicle class."
          bodyClassName="p-0"
        >
          <FormError message={error} />
          <ul className="divide-y divide-line">
            {providers.length === 0 && <li className="px-5 py-4 text-[0.8125rem] text-muted">No transfer suppliers yet.</li>}
            {providers.map((provider) => (
              <li key={provider.id} className="flex flex-wrap items-end justify-between gap-3 px-5 py-4">
                <p className="text-[0.875rem] font-medium text-ink">{provider.name}</p>
                <PaymentPolicySelect
                  label="Payment terms"
                  className="w-full sm:w-80"
                  value={provider.payment?.id ?? ""}
                  current={provider.payment}
                  policies={policies.TRANSFER.filter((policy) => policy.isActive)}
                  disabled={!canEdit || savingProvider === provider.id}
                  onChange={(next) => void chooseForProvider(provider, next)}
                />
              </li>
            ))}
          </ul>
        </AdminPanel>
      )}

      {!canEdit && <ReadOnlyNote needs={["catalogue.write"]} what="Editing payment policies" />}
    </div>
  );
}
