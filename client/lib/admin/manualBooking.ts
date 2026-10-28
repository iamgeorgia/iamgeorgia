import { emptyCustomerForm, customerInputFromForm, type CustomerFormValues } from "./customers";
import { toMinorUnits } from "@/lib/money";
import type { ManualBookingBody, ManualBookingBuyer, ManualBookingEnvelope } from "@/lib/api/manualBookings";
import type { BookingGuestType, GuestTitle, ManualBookingChannel } from "@/types/booking";
import type { CustomOrderConflictDetails, CustomOrderItemInput } from "@/types/order";
import type { PackageComponentType } from "@/types/package";
import type { ConfirmServiceBookingInput } from "@/types/service";

/**
 * The desk's booking wizard, as data.
 *
 * Five steps — Buyer, Service, Travellers, Terms, Review — each owning a
 * slice of one state. This module turns that state into the body
 * `POST …/manual` takes, decides which step a server refusal belongs to, and
 * does the little arithmetic the Review step shows (the catalogue price plus
 * the desk's adjustment). Kept free of React so
 * `test/manual-booking.test.ts` can load it under plain Node.
 *
 * One item goes to its product's own `/manual` route, exactly as the desk
 * always sent it. Several items, or a package, go as one CUSTOM order to
 * `/admin/orders/custom/manual` — the cart at the desk — and the lines are
 * then priced by `POST /orders/custom/quote` on the Review step.
 */

export type WizardProduct = "HOTEL" | "TRANSFER" | "TOUR" | "SERVICE" | "PACKAGE";

export const WIZARD_STEPS = ["Buyer", "Service", "Travellers", "Terms", "Review"] as const;
export type WizardStep = 0 | 1 | 2 | 3 | 4;

export const MANUAL_CHANNELS: ManualBookingChannel[] = ["PHONE", "EMAIL", "EXTERNAL_AGENCY", "DIRECT"];

export const manualChannelLabels: Record<ManualBookingChannel, string> = {
  PHONE: "Phone",
  EMAIL: "Email",
  EXTERNAL_AGENCY: "External agency",
  DIRECT: "Direct (in person)",
};

export const wizardProductLabels: Record<WizardProduct, string> = {
  HOTEL: "Hotel",
  TRANSFER: "Transfer",
  TOUR: "Tour",
  SERVICE: "Service",
  PACKAGE: "Package",
};

/** The server takes 1–20 items per CUSTOM order. */
export const WIZARD_MAX_ITEMS = 20;

// --- state ----------------------------------------------------------------------

export type BuyerMode = "PARTNER" | "CUSTOMER" | "NEW_CUSTOMER";

export interface BuyerState {
  mode: BuyerMode;
  partnerId: string;
  partnerLabel: string | null;
  customerId: string;
  customerLabel: string | null;
  newCustomer: CustomerFormValues;
}

export interface PersonState {
  title: GuestTitle | "";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface TravellerState {
  title: GuestTitle | "";
  firstName: string;
  lastName: string;
  type: BookingGuestType;
  /** Years, as typed; blank for an adult. */
  age: string;
}

export interface TravellersState {
  lead: PersonState;
  extras: TravellerState[];
  specialRequests: string;
  /** Transfers: one flight per leg and the doors. */
  flightOutbound: string;
  flightReturn: string;
  pickupAddress: string;
  dropoffAddress: string;
  /** Tours. */
  pickupNote: string;
}

export interface TermsState {
  channel: ManualBookingChannel | "";
  assignedManagerUserId: string;
  assignedManagerLabel: string | null;
  internalNotes: string;
  /** Major units, signed, as typed: "-50" or "120.00". */
  adjustmentAmount: string;
  adjustmentReason: string;
  confirmNow: boolean;
}

/** What the Service step chose: enough to book it and enough to describe it. */
export type ServiceSelection =
  | {
      product: "HOTEL";
      offerToken: string;
      hotelName: string;
      roomName: string;
      ratePlanName: string;
      checkIn: string;
      checkOut: string;
      nights: number;
      rooms: number;
      adults: number;
      childAges: number[];
      currency: string;
      totalCents: number;
    }
  | {
      product: "TRANSFER";
      quoteToken: string;
      from: string;
      to: string;
      pickupAt: string;
      returnPickupAt: string | null;
      vehicleName: string;
      tripType: "ONE_WAY" | "RETURN";
      passengers: number;
      currency: string;
      totalCents: number;
    }
  | {
      product: "TOUR";
      offerToken: string;
      tourTitle: string;
      optionName: string;
      date: string;
      endDate: string;
      adults: number;
      childAges: number[];
      currency: string;
      totalCents: number;
    }
  | {
      product: "SERVICE";
      serviceId: string;
      serviceName: string;
      date: string;
      time: string;
      days: number;
      quantity: number;
      pax: number;
      currency: string;
      /** Estimated from the catalogue unit price; the server prices it again. */
      totalCents: number;
    }
  | {
      product: "PACKAGE";
      /** The composite offer from `GET /packages/:slug/quote`, priced for this buyer. */
      packageToken: string;
      packageSlug: string;
      packageName: string;
      startDate: string;
      endDate: string;
      adults: number;
      childAges: number[];
      rooms: number;
      /** The included slots, for the chip and the Review step. */
      components: { slotIndex: number; componentType: PackageComponentType; label: string; detail: string }[];
      currency: string;
      /** The package total after its own adjustment. */
      totalCents: number;
    };

export interface WizardState {
  buyer: BuyerState;
  /** What is being booked: one line, or several booked as one order. */
  items: ServiceSelection[];
  travellers: TravellersState;
  terms: TermsState;
}

export const emptyPerson: PersonState = { title: "", firstName: "", lastName: "", email: "", phone: "" };

export const emptyWizardState = (): WizardState => ({
  buyer: { mode: "PARTNER", partnerId: "", partnerLabel: null, customerId: "", customerLabel: null, newCustomer: { ...emptyCustomerForm } },
  items: [],
  travellers: {
    lead: { ...emptyPerson },
    extras: [],
    specialRequests: "",
    flightOutbound: "",
    flightReturn: "",
    pickupAddress: "",
    dropoffAddress: "",
    pickupNote: "",
  },
  terms: {
    channel: "",
    assignedManagerUserId: "",
    assignedManagerLabel: null,
    internalNotes: "",
    adjustmentAmount: "",
    adjustmentReason: "",
    confirmNow: false,
  },
});

/** "Nino Beridze" → first "Nino", last "Beridze"; one word is a first name. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** The lead traveller the desk starts from: the customer, where one is chosen. */
export function leadFromCustomer(customer: {
  kind: "INDIVIDUAL" | "COMPANY";
  name: string;
  contactName: string | null;
  email: string;
  phone: string | null;
}): PersonState {
  const { firstName, lastName } = splitName(customer.kind === "COMPANY" && customer.contactName ? customer.contactName : customer.name);
  return { title: "", firstName, lastName, email: customer.email, phone: customer.phone ?? "" };
}

// --- the list -------------------------------------------------------------------

/**
 * Whether the booking goes through the cart: several items, or a package
 * (which no product route can book on its own at the desk). One hotel,
 * transfer, tour or service keeps its product's own `/manual` route.
 */
export const isCartBooking = (state: WizardState): boolean =>
  state.items.length > 1 || state.items.some((item) => item.product === "PACKAGE");

/** The one item of a single-product booking; null for an empty list or a cart. */
export const singleSelection = (state: WizardState): Exclude<ServiceSelection, { product: "PACKAGE" }> | null =>
  state.items.length === 1 && state.items[0].product !== "PACKAGE" ? state.items[0] : null;

/** The currency the booking settles in: the first item's, or GEL before anything is chosen. */
export const wizardCurrency = (state: WizardState): string => state.items[0]?.currency ?? "GEL";

/** The currencies the items disagree on; empty when they agree, which the server requires. */
export const mixedCurrencies = (items: ServiceSelection[]): string[] => {
  const seen = [...new Set(items.map((item) => item.currency))];
  return seen.length > 1 ? seen : [];
};

/** Whether the list has anything of these products — what the Travellers step asks for depends on it. */
export const hasProduct = (state: WizardState, ...products: WizardProduct[]): boolean =>
  state.items.some((item) => products.includes(item.product));

/** An item's short name: "Hotel Vera · Deluxe", "Tbilisi Airport → Tbilisi". The cart line's `label`. */
export function labelOf(selection: ServiceSelection): string {
  switch (selection.product) {
    case "HOTEL":
      return `${selection.hotelName} · ${selection.roomName}`;
    case "TRANSFER":
      return `${selection.from} → ${selection.to}`;
    case "TOUR":
      return `${selection.tourTitle} · ${selection.optionName}`;
    case "SERVICE":
      return selection.serviceName;
    case "PACKAGE":
      return selection.packageName;
  }
}

// --- money ----------------------------------------------------------------------

/** The adjustment in minor units: null for nothing, NaN-safe. Zero counts as nothing. */
export function adjustmentCentsFrom(amount: string, currency: string): number | null {
  const trimmed = amount.trim();
  if (!trimmed) return null;
  const cents = toMinorUnits(trimmed, currency);
  return cents === null || cents === 0 ? null : cents;
}

/** The catalogue price of everything chosen, as the searches priced it; null before anything is. */
export function wizardCatalogueCents(state: WizardState): number | null {
  if (state.items.length === 0) return null;
  return state.items.reduce((sum, item) => sum + item.totalCents, 0);
}

/**
 * The buyer's total as the Review step shows it: catalogue price plus the
 * adjustment. A cart's Review step passes the server's quote (the current
 * prices) as the catalogue figure and falls back to the searches' while it
 * loads.
 */
export function wizardTotalCents(state: WizardState, catalogueCents: number | null = wizardCatalogueCents(state)): number | null {
  if (catalogueCents === null) return null;
  return catalogueCents + (adjustmentCentsFrom(state.terms.adjustmentAmount, wizardCurrency(state)) ?? 0);
}

// --- validation -----------------------------------------------------------------

export type WizardErrors = Record<string, string>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What the wizard itself refuses before asking the server: the required
 * choices and names. The server validates everything again; this only
 * stops a step advancing with a blank the next step would need.
 */
export function validateStep(step: WizardStep, state: WizardState, can: { approve: boolean; override: boolean }): WizardErrors {
  const errors: WizardErrors = {};

  if (step === 0) {
    if (state.buyer.mode === "PARTNER" && !state.buyer.partnerId) errors["buyer.partnerId"] = "Choose the partner the booking is for.";
    if (state.buyer.mode === "CUSTOMER" && !state.buyer.customerId) errors["buyer.customerId"] = "Choose the customer the booking is for.";
    if (state.buyer.mode === "NEW_CUSTOMER") {
      if (!state.buyer.newCustomer.name.trim()) errors["newCustomer.name"] = "A name is required.";
      if (!EMAIL.test(state.buyer.newCustomer.email.trim())) errors["newCustomer.email"] = "A valid email is required.";
    }
  }

  if (step === 1) {
    if (state.items.length === 0) errors.selection = "Search and pick what is being booked.";
    else if (state.items.length > WIZARD_MAX_ITEMS) errors.selection = `One booking takes up to ${WIZARD_MAX_ITEMS} items.`;
    else {
      const mixed = mixedCurrencies(state.items);
      if (mixed.length > 0) errors.selection = `Everything in one booking settles in one currency; these are in ${mixed.join(" and ")}.`;
    }
  }

  if (step === 2) {
    const lead = state.travellers.lead;
    if (!lead.firstName.trim()) errors["lead.firstName"] = "Required.";
    if (!lead.lastName.trim()) errors["lead.lastName"] = "Required.";
    if (!EMAIL.test(lead.email.trim())) errors["lead.email"] = "A valid email is required.";
    state.travellers.extras.forEach((traveller, index) => {
      if (!traveller.firstName.trim()) errors[`extras.${index}.firstName`] = "Required.";
      if (!traveller.lastName.trim()) errors[`extras.${index}.lastName`] = "Required.";
      if (traveller.type !== "ADULT" && traveller.age.trim() && !/^\d{1,2}$/.test(traveller.age.trim())) {
        errors[`extras.${index}.age`] = "Years, as a number.";
      }
    });
  }

  if (step === 3) {
    if (!state.terms.channel) errors.channel = "Say how the booking came in.";
    const amount = state.terms.adjustmentAmount.trim();
    if (amount) {
      if (!can.override) errors.adjustmentAmount = "Changing the price is not part of your role.";
      else if (toMinorUnits(amount, wizardCurrency(state)) === null) errors.adjustmentAmount = "A signed amount, like -50 or 120.";
      else if (adjustmentCentsFrom(amount, wizardCurrency(state)) === null) errors.adjustmentAmount = "An adjustment of nothing is not one.";
      else if (!state.terms.adjustmentReason.trim()) errors.adjustmentReason = "Say why the price changed.";
    }
    if (state.terms.confirmNow && !can.approve) errors.confirmNow = "Confirming at once is not part of your role.";
  }

  return errors;
}

// --- the body -------------------------------------------------------------------

const optional = (value: string): string | undefined => (value.trim() ? value.trim() : undefined);

const titleOf = (title: GuestTitle | ""): GuestTitle | undefined => (title ? title : undefined);

const personOf = (person: PersonState) => ({
  ...(titleOf(person.title) ? { title: titleOf(person.title) } : {}),
  firstName: person.firstName.trim(),
  lastName: person.lastName.trim(),
  email: person.email.trim(),
  ...(optional(person.phone) ? { phone: optional(person.phone) } : {}),
});

const travellerOf = (traveller: TravellerState) => ({
  type: traveller.type,
  ...(titleOf(traveller.title) ? { title: titleOf(traveller.title) } : {}),
  firstName: traveller.firstName.trim(),
  lastName: traveller.lastName.trim(),
  ...(traveller.type !== "ADULT" && traveller.age.trim() ? { age: Number.parseInt(traveller.age.trim(), 10) } : {}),
});

export function buyerOf(buyer: BuyerState): ManualBookingBuyer {
  switch (buyer.mode) {
    case "PARTNER":
      return { kind: "PARTNER", partnerId: buyer.partnerId };
    case "CUSTOMER":
      return { kind: "CUSTOMER", customerId: buyer.customerId };
    case "NEW_CUSTOMER":
      return { kind: "CUSTOMER", customer: customerInputFromForm(buyer.newCustomer, "create") };
  }
}

export function envelopeOf(state: WizardState, currency: string): ManualBookingEnvelope {
  const cents = adjustmentCentsFrom(state.terms.adjustmentAmount, currency);

  return {
    buyer: buyerOf(state.buyer),
    channel: state.terms.channel || "PHONE",
    ...(state.terms.confirmNow ? { confirmNow: true } : {}),
    ...(cents !== null ? { priceAdjustment: { cents, reason: state.terms.adjustmentReason.trim() } } : {}),
    ...(state.terms.assignedManagerUserId ? { assignedManagerUserId: state.terms.assignedManagerUserId } : {}),
    ...(optional(state.terms.internalNotes) ? { internalNotes: optional(state.terms.internalNotes) } : {}),
  };
}

export type BuiltBody =
  | { product: "HOTEL"; body: ManualBookingBody<"HOTEL"> }
  | { product: "TRANSFER"; body: ManualBookingBody<"TRANSFER"> }
  | { product: "TOUR"; body: ManualBookingBody<"TOUR"> }
  | { product: "SERVICE"; body: ManualBookingBody<"SERVICE"> }
  | { product: "CART"; body: ManualBookingBody<"CART"> };

/** A cart line's label: the server takes 120 characters. */
const cartLabel = (selection: ServiceSelection): string => labelOf(selection).slice(0, 120);

/**
 * One line of the cart, as `POST /orders/custom` wants it. The schema is
 * strict and carries no amount: a token, or a service and its date. What
 * the Travellers step typed for a transfer goes on every transfer line and
 * on a package (the flights and the doors are the party's, not a
 * journey's); a tour's pick-up note has no field of its own on a cart line
 * and travels in the line's requests.
 */
export function cartItemOf(selection: ServiceSelection, travellers: TravellersState): CustomOrderItemInput {
  const label = cartLabel(selection);
  switch (selection.product) {
    case "HOTEL":
      return { type: "HOTEL_STAY", label, offerToken: selection.offerToken };
    case "TRANSFER": {
      const outbound = optional(travellers.flightOutbound);
      const back = optional(travellers.flightReturn);
      return {
        type: "TRANSFER",
        label,
        quoteToken: selection.quoteToken,
        ...(outbound ? { flightNumber: outbound } : {}),
        ...(outbound || back ? { flights: { outbound: outbound ?? null, return: back ?? null } } : {}),
        ...(optional(travellers.pickupAddress) ? { pickupAddress: optional(travellers.pickupAddress) } : {}),
        ...(optional(travellers.dropoffAddress) ? { dropoffAddress: optional(travellers.dropoffAddress) } : {}),
      };
    }
    case "TOUR": {
      const note = optional(travellers.pickupNote);
      return {
        type: "TOUR",
        label,
        offerToken: selection.offerToken,
        ...(note ? { specialRequests: `Pick-up: ${note}`.slice(0, 1000) } : {}),
      };
    }
    case "SERVICE":
      return {
        type: "SERVICE",
        label,
        serviceId: selection.serviceId,
        date: selection.date,
        ...(selection.time ? { time: selection.time } : {}),
        days: selection.days,
        quantity: selection.quantity,
        pax: selection.pax,
      };
    case "PACKAGE": {
      const outbound = optional(travellers.flightOutbound);
      return {
        type: "PACKAGE",
        label,
        packageToken: selection.packageToken,
        ...(outbound ? { flightNumber: outbound } : {}),
        ...(optional(travellers.pickupAddress) ? { pickupAddress: optional(travellers.pickupAddress) } : {}),
      };
    }
  }
}

/** The cart's lines for the quote and the booking, in the order the list shows them. */
export const cartItemsOf = (state: WizardState): CustomOrderItemInput[] =>
  state.items.map((selection) => cartItemOf(selection, state.travellers));

/**
 * The request body, from the wizard's state. The product's ordinary
 * confirmation body sits under `booking`, built exactly as the public
 * checkout would build it; the envelope around it is the desk's. A cart —
 * several items, or a package — is the `POST /orders/custom` body under the
 * same envelope, and the desk's adjustment then applies to the whole order.
 */
export function buildManualBookingBody(state: WizardState): BuiltBody {
  if (state.items.length === 0) throw new Error("Nothing chosen to book");

  const envelope = envelopeOf(state, wizardCurrency(state));
  const { lead, extras, specialRequests } = state.travellers;

  const selection = singleSelection(state);
  if (!selection) {
    return {
      product: "CART",
      body: {
        ...envelope,
        booking: {
          items: cartItemsOf(state),
          leadGuest: personOf(lead),
          ...(extras.length > 0 ? { travellers: extras.map(travellerOf) } : {}),
          ...(optional(specialRequests) ? { specialRequests: optional(specialRequests) } : {}),
        },
      },
    };
  }

  switch (selection.product) {
    case "HOTEL":
      return {
        product: "HOTEL",
        body: {
          ...envelope,
          booking: {
            offerToken: selection.offerToken,
            leadGuest: personOf(lead),
            ...(extras.length > 0 ? { guests: extras.map(travellerOf) } : {}),
            ...(optional(specialRequests) ? { specialRequests: optional(specialRequests) } : {}),
          },
        },
      };
    case "TRANSFER": {
      const outbound = optional(state.travellers.flightOutbound);
      const back = optional(state.travellers.flightReturn);
      return {
        product: "TRANSFER",
        body: {
          ...envelope,
          booking: {
            quoteToken: selection.quoteToken,
            leadPassenger: personOf(lead),
            ...(outbound ? { flightNumber: outbound } : {}),
            ...(outbound || back ? { flights: { outbound: outbound ?? null, return: back ?? null } } : {}),
            ...(optional(state.travellers.pickupAddress) ? { pickupAddress: optional(state.travellers.pickupAddress) } : {}),
            ...(optional(state.travellers.dropoffAddress) ? { dropoffAddress: optional(state.travellers.dropoffAddress) } : {}),
            ...(optional(specialRequests) ? { specialRequests: optional(specialRequests) } : {}),
          },
        },
      };
    }
    case "TOUR":
      return {
        product: "TOUR",
        body: {
          ...envelope,
          booking: {
            offerToken: selection.offerToken,
            leadTraveller: personOf(lead),
            ...(extras.length > 0 ? { travellers: extras.map(travellerOf) } : {}),
            ...(optional(specialRequests) ? { specialRequests: optional(specialRequests) } : {}),
            ...(optional(state.travellers.pickupNote) ? { pickupNote: optional(state.travellers.pickupNote) } : {}),
          },
        },
      };
    case "SERVICE": {
      const { title: _title, ...leadWithoutTitle } = personOf(lead) as ConfirmServiceBookingInput["lead"] & { title?: GuestTitle };
      void _title;
      return {
        product: "SERVICE",
        body: {
          ...envelope,
          booking: {
            serviceId: selection.serviceId,
            date: selection.date,
            ...(selection.time ? { time: selection.time } : {}),
            days: selection.days,
            quantity: selection.quantity,
            pax: selection.pax,
            // The service lead takes no title (`server/validation/service.js`).
            lead: leadWithoutTitle,
            ...(optional(specialRequests) ? { notes: optional(specialRequests) } : {}),
          },
        },
      };
    }
  }
}

// --- server refusals ------------------------------------------------------------

/**
 * Which step owns a field the server refused, and the wizard's own name for
 * it. The server's paths follow the body (`booking.leadGuest.email`,
 * `buyer.customer.taxId`, `priceAdjustment.cents`); the wizard's follow its
 * state (`lead.email`, `newCustomer.taxId`, `adjustmentAmount`). A path
 * nobody recognises lands on the Review step with its message shown whole.
 */
export function wizardFieldFor(path: string): { step: WizardStep; field: string } {
  const parts = path.split(".");

  if (parts[0] === "buyer") {
    if (parts[1] === "customer" && parts[2]) return { step: 0, field: `newCustomer.${parts.slice(2).join(".")}` };
    if (parts[1] === "partnerId") return { step: 0, field: "buyer.partnerId" };
    if (parts[1] === "customerId") return { step: 0, field: "buyer.customerId" };
    return { step: 0, field: "buyer" };
  }

  if (parts[0] === "channel") return { step: 3, field: "channel" };
  if (parts[0] === "assignedManagerUserId") return { step: 3, field: "assignedManagerUserId" };
  if (parts[0] === "internalNotes") return { step: 3, field: "internalNotes" };
  if (parts[0] === "confirmNow") return { step: 3, field: "confirmNow" };
  if (parts[0] === "priceAdjustment") {
    return { step: 3, field: parts[1] === "reason" ? "adjustmentReason" : "adjustmentAmount" };
  }

  if (parts[0] === "booking") {
    const field = parts[1] ?? "";
    const rest = parts.slice(2).join(".");

    if (["leadGuest", "leadPassenger", "leadTraveller", "lead"].includes(field)) return { step: 2, field: `lead.${rest || "firstName"}` };
    if (field === "guests" || field === "travellers") return { step: 2, field: `extras.${rest}` };
    // A cart line: `booking.items.3.offerToken` marks the fourth line.
    if (field === "items") return { step: 1, field: /^\d+$/.test(parts[2] ?? "") ? `items.${parts[2]}` : "selection" };
    if (field === "flightNumber") return { step: 2, field: "flightOutbound" };
    if (field === "flights") return { step: 2, field: parts[2] === "return" ? "flightReturn" : "flightOutbound" };
    if (["pickupAddress", "dropoffAddress", "pickupNote"].includes(field)) return { step: 2, field };
    if (field === "specialRequests" || field === "notes") return { step: 2, field: "specialRequests" };

    // Tokens, dates, quantities: the thing chosen on the Service step.
    return { step: 1, field: "selection" };
  }

  return { step: 4, field: path || "form" };
}

/**
 * The server's field errors mapped onto the wizard: which fields to mark,
 * and the earliest step that has one — the step to reopen, so the person is
 * not left on the Review screen wondering what is wrong with it.
 */
export function mapServerErrors(fieldErrors: Record<string, string>): { errors: WizardErrors; step: WizardStep | null } {
  const errors: WizardErrors = {};
  let step: WizardStep | null = null;

  for (const [path, message] of Object.entries(fieldErrors)) {
    const target = wizardFieldFor(path);
    if (!errors[target.field]) errors[target.field] = message;
    if (step === null || target.step < step) step = target.step;
  }

  return { errors, step };
}

/** A refusal that means the chosen offer is no longer good: search again. */
export const isStaleOffer = (details: unknown): details is { reason: "PRICE_CHANGED" | "UNAVAILABLE" } => {
  const reason = (details as { reason?: unknown } | null)?.reason;
  return reason === "PRICE_CHANGED" || reason === "UNAVAILABLE";
};

/**
 * A cart's 409, which names every item in the way by its position in the
 * `items` sent — the position in the wizard's list. Null for any other
 * refusal, including a single product's own `PRICE_CHANGED`.
 */
export const cartConflictOf = (details: unknown): CustomOrderConflictDetails | null => {
  if (!isStaleOffer(details)) return null;
  const items = (details as { items?: unknown }).items;
  return Array.isArray(items) ? (details as CustomOrderConflictDetails) : null;
};

/** A 422 that says the items settle in different currencies: the currencies named, or null. */
export const mixedCurrencyOf = (details: unknown): string[] | null => {
  const refusal = details as { reason?: unknown; currencies?: unknown } | null;
  if (refusal?.reason !== "MIXED_CURRENCY") return null;
  return Array.isArray(refusal.currencies) ? refusal.currencies.filter((entry): entry is string => typeof entry === "string") : [];
};

/** The lines a cart's 409 names, as errors keyed the way the Service step reads them (`items.<index>`). */
export function cartConflictErrors(conflict: CustomOrderConflictDetails, items: ServiceSelection[]): WizardErrors {
  const errors: WizardErrors = {};
  for (const entry of conflict.items) {
    if (!items[entry.index]) continue;
    if (conflict.reason === "UNAVAILABLE") {
      const why = "reason" in entry && typeof entry.reason === "string" ? ` (${entry.reason.toLowerCase().replace(/_/g, " ")})` : "";
      errors[`items.${entry.index}`] = `No longer available${why}: remove it, or search again.`;
    } else {
      errors[`items.${entry.index}`] = "The price has moved since the search.";
    }
  }
  return errors;
}
