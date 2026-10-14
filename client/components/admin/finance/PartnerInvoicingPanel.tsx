"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdminDefinitionList, AdminPanel } from "@/components/admin/AdminPage";
import { FormError, SelectInput, SubmitButton, TextInput } from "@/components/admin/FormControls";
import { invoiceLanguageLabel } from "@/lib/admin/finance";
import { ApiError, describeError } from "@/lib/api/client";
import { updatePartner } from "@/lib/api/partners";

/**
 * What an invoice for this partner will say, and in which language.
 *
 * The buyer block is taken from the company record (shown read-only here);
 * the tax number and the document language are the two things that live on
 * this panel. Editable with `partners.write`, which the PATCH checks again.
 */

export interface PartnerInvoicingFields {
  id: string;
  taxId: string | null;
  invoiceLang: string | null;
  legalName: string | null;
  legalAddress: string | null;
  city: string | null;
  country: string | null;
}

const SERVER_DEFAULT = "";

export function PartnerInvoicingPanel({
  partner,
  canEdit,
  languages,
  defaultLang,
}: {
  partner: PartnerInvoicingFields;
  canEdit: boolean;
  languages: string[];
  defaultLang: string;
}) {
  const router = useRouter();
  const [taxId, setTaxId] = useState(partner.taxId ?? "");
  const [lang, setLang] = useState(partner.invoiceLang ?? SERVER_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const touched = () => {
    setSaved(false);
    setError(null);
  };

  // Keep a language the partner already has selectable even if the server's list no longer offers it.
  const codes = partner.invoiceLang && !languages.includes(partner.invoiceLang) ? [partner.invoiceLang, ...languages] : languages;
  const defaultLabel = `Server default (${invoiceLanguageLabel(defaultLang)})`;

  const buyer = (
    <AdminDefinitionList
      items={[
        { label: "Buyer name", value: partner.legalName ?? "—" },
        { label: "Address", value: partner.legalAddress ?? "—" },
        { label: "City and country", value: [partner.city, partner.country].filter(Boolean).join(", ") || "—" },
      ]}
    />
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    try {
      await updatePartner(partner.id, {
        taxId: taxId.trim() || null,
        invoiceLang: lang || null,
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors());
      setError(describeError(caught, "Could not save the invoicing details."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPanel title="Invoicing" description="How this partner appears on the invoices we issue to it.">
      {buyer}
      <p className="mt-3 text-[0.75rem] leading-relaxed text-subtle">
        Printed as the buyer on each document. Change these under Company.
      </p>

      {canEdit ? (
        <form onSubmit={submit} noValidate className="mt-4 space-y-4 border-t border-line pt-4">
          <TextInput
            label="Tax ID / VAT number"
            value={taxId}
            onChange={(event) => {
              setTaxId(event.target.value);
              touched();
            }}
            disabled={busy}
            maxLength={64}
            error={fieldErrors.taxId}
            hint="Leave blank if the partner has none."
          />
          <SelectInput
            label="Invoice language"
            value={lang}
            onChange={(event) => {
              setLang(event.target.value);
              touched();
            }}
            disabled={busy}
            error={fieldErrors.invoiceLang}
            options={[
              { value: SERVER_DEFAULT, label: defaultLabel },
              ...codes.map((code) => ({ value: code, label: invoiceLanguageLabel(code) })),
            ]}
          />

          <FormError message={error} />

          <div className="flex justify-end">
            <SubmitButton type="submit" busy={busy} saved={saved}>
              {saved ? "Saved" : "Save invoicing details"}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <AdminDefinitionList
          className="mt-4 border-t border-line pt-4"
          items={[
            { label: "Tax ID / VAT number", value: partner.taxId ?? "—" },
            {
              label: "Invoice language",
              value: partner.invoiceLang ? invoiceLanguageLabel(partner.invoiceLang) : defaultLabel,
            },
          ]}
        />
      )}
    </AdminPanel>
  );
}
