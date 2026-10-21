import type { CustomerInput, CustomerKind, CustomerQuery } from "@/types/customer";

/**
 * Display vocabulary and URL reading for the desk's customers, mirroring
 * `lib/admin/partners.ts`. Kept free of React so a test can load it.
 */

export const CUSTOMER_KINDS: CustomerKind[] = ["INDIVIDUAL", "COMPANY"];

export const customerKindLabels: Record<CustomerKind, string> = {
  INDIVIDUAL: "Individual",
  COMPANY: "Company",
};

/** What the desk types into the form; everything optional is a string that may be empty. */
export interface CustomerFormValues {
  kind: CustomerKind;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  billingAddress: string;
  city: string;
  country: string;
  taxId: string;
  notes: string;
}

export const emptyCustomerForm: CustomerFormValues = {
  kind: "INDIVIDUAL",
  name: "",
  contactName: "",
  email: "",
  phone: "",
  billingAddress: "",
  city: "",
  country: "",
  taxId: "",
  notes: "",
};

const trimmedOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/**
 * The body `POST /admin/customers` takes, from the form. Empty optional
 * fields go as null on an edit (clearing them) and are omitted on a create,
 * where the server's defaults already mean "none".
 */
export function customerInputFromForm(values: CustomerFormValues, mode: "create" | "edit" = "create"): CustomerInput {
  const optional = (value: string): string | null | undefined => {
    const result = trimmedOrNull(value);
    return result === null && mode === "create" ? undefined : result;
  };

  const input: CustomerInput = {
    kind: values.kind,
    name: values.name.trim(),
    email: values.email.trim(),
  };

  const extras: (keyof Omit<CustomerInput, "kind" | "name" | "email">)[] = [
    "contactName",
    "phone",
    "billingAddress",
    "city",
    "taxId",
    "notes",
  ];
  for (const key of extras) {
    const value = optional(values[key]);
    if (value !== undefined) input[key] = value;
  }

  const country = optional(values.country.toUpperCase());
  if (country !== undefined) input.country = country;

  return input;
}

/** The form's values for an existing customer, every null read back as "". */
export function customerFormFromCustomer(customer: {
  kind: CustomerKind;
  name: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  billingAddress: string | null;
  city: string | null;
  country: string | null;
  taxId: string | null;
  notes: string | null;
}): CustomerFormValues {
  return {
    kind: customer.kind,
    name: customer.name,
    contactName: customer.contactName ?? "",
    email: customer.email,
    phone: customer.phone ?? "",
    billingAddress: customer.billingAddress ?? "",
    city: customer.city ?? "",
    country: customer.country ?? "",
    taxId: customer.taxId ?? "",
    notes: customer.notes ?? "",
  };
}

const read = (params: Record<string, string | string[] | undefined>, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/** Reads the register's query out of the URL, dropping anything unrecognised. */
export function customerQueryFromParams(params: Record<string, string | string[] | undefined>): CustomerQuery {
  const kind = read(params, "kind");
  const page = Number.parseInt(read(params, "page") ?? "", 10);

  return {
    q: read(params, "q")?.trim() || undefined,
    kind: CUSTOMER_KINDS.includes(kind as CustomerKind) ? (kind as CustomerKind) : undefined,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 25,
  };
}
