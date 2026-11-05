"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { useState } from "react";

import { FormError, SelectInput, SubmitButton, TextArea, TextInput } from "./FormControls";
import { Modal } from "@/components/ui/Modal";
import {
  CUSTOMER_KINDS,
  customerFormFromCustomer,
  customerInputFromForm,
  customerKindLabels,
  emptyCustomerForm,
  type CustomerFormValues,
} from "@/lib/admin/customers";
import { ApiError, describeError } from "@/lib/api/client";
import { createCustomer, updateCustomer } from "@/lib/api/customers";
import type { Customer } from "@/types/customer";

/**
 * The customer form: the person or company the desk books for when the
 * buyer has no partner account. Used three ways — the "New customer" dialog
 * on the register, the "Edit" dialog on a customer's page, and inline on the
 * booking wizard's Buyer step — so the fields live here once.
 *
 * `errors` are the server's own, keyed by field: a validation failure lands
 * on the field it concerns rather than as one sentence at the bottom.
 */

export type CustomerFormErrors = Partial<Record<keyof CustomerFormValues, string>>;

export function CustomerFields({
  values,
  errors,
  onChange,
  compact = false,
}: {
  values: CustomerFormValues;
  errors: CustomerFormErrors;
  onChange: (next: CustomerFormValues) => void;
  /** Two columns from `sm` rather than one: for the wizard, where the form shares the screen. */
  compact?: boolean;
}) {
  const set = (key: keyof CustomerFormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    onChange({ ...values, [key]: event.target.value });

  const company = values.kind === "COMPANY";

  return (
    <div className={compact ? "grid gap-4 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2"}>
      <SelectInput
        label="Kind"
        value={values.kind}
        onChange={set("kind")}
        options={CUSTOMER_KINDS.map((kind) => ({ value: kind, label: customerKindLabels[kind] }))}
        hint={company ? "The company is the buyer; name the person to speak to below." : undefined}
      />
      <TextInput
        label={company ? "Company name" : "Full name"}
        required
        value={values.name}
        onChange={set("name")}
        error={errors.name}
        autoComplete="off"
      />
      {company && (
        <TextInput label="Contact person" value={values.contactName} onChange={set("contactName")} error={errors.contactName} />
      )}
      <TextInput label="Email" type="email" required value={values.email} onChange={set("email")} error={errors.email} autoComplete="off" />
      <TextInput label="Phone" type="tel" value={values.phone} onChange={set("phone")} error={errors.phone} />
      <TextInput
        label="Billing address"
        value={values.billingAddress}
        onChange={set("billingAddress")}
        error={errors.billingAddress}
        className="sm:col-span-2"
      />
      <TextInput label="City" value={values.city} onChange={set("city")} error={errors.city} />
      <TextInput
        label="Country"
        hint="Two-letter code: GE, IL, US."
        value={values.country}
        onChange={set("country")}
        error={errors.country}
        maxLength={2}
        mono
      />
      <TextInput
        label="Tax ID"
        hint="Printed as the buyer on invoices, where the customer has one."
        value={values.taxId}
        onChange={set("taxId")}
        error={errors.taxId}
        mono
      />
      <TextArea
        label="Notes"
        hint="For the desk only."
        rows={3}
        value={values.notes}
        onChange={set("notes")}
        error={errors.notes}
        className="sm:col-span-2"
      />
    </div>
  );
}

/** The server's issues keyed by the form's field names. */
export const customerErrorsFrom = (error: unknown): CustomerFormErrors => {
  if (!(error instanceof ApiError)) return {};
  const mapped: CustomerFormErrors = {};
  for (const [path, message] of Object.entries(error.fieldErrors())) {
    // Inline on a booking the path is `buyer.customer.email`; on its own it is `email`.
    const key = path.split(".").at(-1) as keyof CustomerFormValues;
    if (key in emptyCustomerForm) mapped[key] = message;
  }
  return mapped;
};

function CustomerDialogForm({
  customer,
  onClose,
  onSaved,
}: {
  /** Absent to create. */
  customer?: Customer;
  onClose: () => void;
  onSaved?: (customer: Customer) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<CustomerFormValues>(customer ? customerFormFromCustomer(customer) : emptyCustomerForm);
  const [errors, setErrors] = useState<CustomerFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    setErrors({});

    try {
      const saved = customer
        ? await updateCustomer(customer.id, customerInputFromForm(values, "edit"))
        : await createCustomer(customerInputFromForm(values, "create"));
      onSaved?.(saved);
      onClose();
      router.refresh();
    } catch (caught) {
      setErrors(customerErrorsFrom(caught));
      setFormError(describeError(caught, customer ? "Could not save the customer." : "Could not create the customer."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <CustomerFields values={values} errors={errors} onChange={setValues} />
      <FormError message={formError} />
      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink"
        >
          Cancel
        </button>
        <SubmitButton type="submit" busy={busy}>
          {customer ? "Save changes" : "Create customer"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** The register's "New customer" button and the dialog behind it. */
export function NewCustomerButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-sm bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-hover"
      >
        <UserPlus size={15} aria-hidden />
        New customer
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="New customer" size="md">
        {open && <CustomerDialogForm onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

/** The "Edit" link on a customer's page and the dialog behind it. */
export function EditCustomerButton({ customer }: { customer: Customer }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center rounded-sm border border-ink/20 px-4 text-[0.8125rem] font-semibold text-ink hover:border-ink hover:bg-surface-soft"
      >
        Edit details
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Edit customer" size="md">
        {open && <CustomerDialogForm customer={customer} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}
