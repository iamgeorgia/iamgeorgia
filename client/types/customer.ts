import type { BookingApprovalProduct } from "./booking";

/**
 * A desk customer: the company or person a manual booking is made for when
 * the buyer has no partner account. Mirrors
 * `server/services/booking/customer.service.js` (`toCustomer`).
 *
 * `name` is the person, or the company's legal name when `kind` is COMPANY;
 * `contactName` is then the person to speak to.
 */
export type CustomerKind = "INDIVIDUAL" | "COMPANY";

export interface Customer {
  id: string;
  kind: CustomerKind;
  name: string;
  contactName: string | null;
  email: string;
  phone: string | null;
  billingAddress: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2. */
  country: string | null;
  taxId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the desk sends to create a customer, inline on a booking or on its own. */
export interface CustomerInput {
  kind: CustomerKind;
  name: string;
  contactName?: string | null;
  email: string;
  phone?: string | null;
  billingAddress?: string | null;
  city?: string | null;
  country?: string | null;
  taxId?: string | null;
  notes?: string | null;
}

/** One of a customer's bookings, across every product (`GET /admin/customers/:id`). */
export interface CustomerBookingRow {
  product: BookingApprovalProduct;
  reference: string;
  status: string;
  title: string;
  /** The stay's check-in, the pick-up instant, the departure date, or the order's start. */
  date: string;
  currency: string;
  totalCents: number;
  createdAt: string;
}

export interface CustomerDetail extends Customer {
  bookings: CustomerBookingRow[];
}

export interface CustomerQuery {
  q?: string;
  kind?: CustomerKind;
  page?: number;
  pageSize?: number;
}
