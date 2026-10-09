import { apiFetch } from "./client";
import { toQueryString } from "./query";
import type { ReceivableQuery } from "./finance";
import type { PickerOption } from "@/components/admin/EntityPicker";
import type { Paginated, PartnerSummary } from "@/types/partner";
import type { Receivable } from "@/types/finance";

/**
 * Browser-side reads for the receivables and payments screens.
 *
 * `lib/api/finance.ts` reads during a server render; these run inside a
 * dialog after the page has loaded — the partner picker in "Record a payment"
 * and the open items listed under "Allocate the rest" — where a server
 * round trip per keystroke is not an option.
 */

const PAGE_SIZE = 20;

export const listReceivablesClient = (query: ReceivableQuery = {}) =>
  apiFetch<Paginated<Receivable>>(`/api/admin/finance/receivables${toQueryString(query)}`);

/** One partner's items that can still take money, in one currency. */
export const listOpenReceivablesClient = (partnerId: string, currency: string) =>
  listReceivablesClient({
    debtorPartnerId: partnerId,
    currency,
    status: ["OPEN", "PARTIAL"],
    pageSize: 100,
  });

/** Partners as `EntityPicker` rows: name, reference and where they are. */
export const searchPartnerOptions = async (term: string): Promise<PickerOption[]> => {
  const { data } = await apiFetch<Paginated<PartnerSummary>>(
    `/api/admin/partners${toQueryString({ q: term || undefined, pageSize: PAGE_SIZE })}`,
  );

  return data.map((partner) => ({
    id: partner.id,
    label: partner.name,
    meta: [partner.city, partner.country].filter(Boolean).join(", ") || partner.email,
    badge: partner.reference,
  }));
};
