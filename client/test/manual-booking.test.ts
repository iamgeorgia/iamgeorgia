import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WIZARD_STEPS,
  adjustmentCentsFrom,
  buildManualBookingBody,
  cartConflictErrors,
  cartConflictOf,
  cartItemsOf,
  emptyWizardState,
  envelopeOf,
  hasProduct,
  isCartBooking,
  isStaleOffer,
  labelOf,
  leadFromCustomer,
  mapServerErrors,
  mixedCurrencies,
  mixedCurrencyOf,
  singleSelection,
  splitName,
  validateStep,
  wizardCatalogueCents,
  wizardCurrency,
  wizardFieldFor,
  wizardTotalCents,
  type ServiceSelection,
  type WizardState,
} from "../lib/admin/manualBooking";

/**
 * The desk's booking wizard as data: the body it sends for each product,
 * the cart it sends for several, and which step a server refusal belongs to.
 */

const hotel: ServiceSelection = {
  product: "HOTEL",
  offerToken: "offer.token",
  hotelName: "Hotel Vera",
  roomName: "Deluxe",
  ratePlanName: "BB",
  checkIn: "2026-12-01",
  checkOut: "2026-12-05",
  nights: 4,
  rooms: 1,
  adults: 2,
  childAges: [7],
  currency: "GEL",
  totalCents: 100_000,
};

const transfer: ServiceSelection = {
  product: "TRANSFER",
  quoteToken: "quote.token",
  from: "Tbilisi Airport",
  to: "Tbilisi",
  pickupAt: "2026-12-02T01:30:00.000Z",
  returnPickupAt: "2026-12-09T10:00:00.000Z",
  vehicleName: "Comfort Sedan",
  tripType: "RETURN",
  passengers: 3,
  currency: "GEL",
  totalCents: 20_000,
};

const tour: ServiceSelection = {
  product: "TOUR",
  offerToken: "tour.token",
  tourTitle: "Kakheti wine day",
  optionName: "Shared",
  date: "2026-12-03",
  endDate: "2026-12-03",
  adults: 2,
  childAges: [7],
  currency: "GEL",
  totalCents: 30_000,
};

const service: ServiceSelection = {
  product: "SERVICE",
  serviceId: "svc_1",
  serviceName: "Shabbat meals",
  date: "2026-12-04",
  time: "18:00",
  days: 2,
  quantity: 1,
  pax: 3,
  currency: "GEL",
  totalCents: 15_000,
};

const pkg: ServiceSelection = {
  product: "PACKAGE",
  packageToken: "package.token",
  packageSlug: "kakheti-weekend",
  packageName: "Kakheti weekend",
  startDate: "2026-12-05",
  endDate: "2026-12-07",
  adults: 2,
  childAges: [],
  rooms: 1,
  components: [{ slotIndex: 0, componentType: "HOTEL_STAY", label: "Two nights", detail: "2 nights at Hotel Vera · Deluxe" }],
  currency: "GEL",
  totalCents: 80_000,
};

const filled = (): WizardState => {
  const state = emptyWizardState();
  state.buyer = { ...state.buyer, mode: "PARTNER", partnerId: "ptr_1", partnerLabel: "Kosher Travel" };
  state.travellers.lead = { title: "MRS", firstName: "Nino", lastName: "Beridze", email: "nino@example.com", phone: "+995 555 00 00 00" };
  state.travellers.extras = [
    { title: "MR", firstName: "Giorgi", lastName: "Beridze", type: "ADULT", age: "" },
    { title: "", firstName: "Ana", lastName: "Beridze", type: "CHILD", age: "7" },
  ];
  state.travellers.specialRequests = "Late arrival";
  state.terms = { ...state.terms, channel: "PHONE", assignedManagerUserId: "usr_9", internalNotes: "Called twice", confirmNow: true };
  return state;
};

describe("manual booking: the body", () => {
  it("has five steps in the order the screen shows them", () => {
    assert.deepEqual([...WIZARD_STEPS], ["Buyer", "Service", "Travellers", "Terms", "Review"]);
  });

  it("builds a hotel booking exactly as the public checkout would, under the desk's envelope", () => {
    const state = filled();
    state.items = [hotel];
    state.terms.adjustmentAmount = "-50";
    state.terms.adjustmentReason = "Loyal client";

    const built = buildManualBookingBody(state);
    assert.equal(built.product, "HOTEL");
    assert.deepEqual(built.body, {
      buyer: { kind: "PARTNER", partnerId: "ptr_1" },
      channel: "PHONE",
      confirmNow: true,
      priceAdjustment: { cents: -5000, reason: "Loyal client" },
      assignedManagerUserId: "usr_9",
      internalNotes: "Called twice",
      booking: {
        offerToken: "offer.token",
        leadGuest: { title: "MRS", firstName: "Nino", lastName: "Beridze", email: "nino@example.com", phone: "+995 555 00 00 00" },
        guests: [
          { type: "ADULT", title: "MR", firstName: "Giorgi", lastName: "Beridze" },
          { type: "CHILD", firstName: "Ana", lastName: "Beridze", age: 7 },
        ],
        specialRequests: "Late arrival",
      },
    });
    assert.equal(wizardTotalCents(state), 95_000);
  });

  it("sends a transfer's flights per leg and its doors", () => {
    const state = filled();
    state.items = [transfer];
    state.travellers.flightOutbound = "TK 384";
    state.travellers.flightReturn = "TK 385";
    state.travellers.pickupAddress = "Terminal 1";
    state.terms.confirmNow = false;

    const built = buildManualBookingBody(state);
    assert.equal(built.product, "TRANSFER");
    assert.deepEqual(built.body.booking, {
      quoteToken: "quote.token",
      leadPassenger: { title: "MRS", firstName: "Nino", lastName: "Beridze", email: "nino@example.com", phone: "+995 555 00 00 00" },
      flightNumber: "TK 384",
      flights: { outbound: "TK 384", return: "TK 385" },
      pickupAddress: "Terminal 1",
      specialRequests: "Late arrival",
    });
    assert.equal("confirmNow" in built.body, false, "confirmNow is omitted when off");
    assert.equal("priceAdjustment" in built.body, false);
  });

  it("books a tour with its travellers and a service without a title on the lead", () => {
    const state = filled();
    state.items = [tour];
    state.travellers.pickupNote = "Hotel lobby";
    const built = buildManualBookingBody(state);
    assert.equal(built.product, "TOUR");
    assert.equal(built.body.booking.offerToken, "tour.token");
    assert.equal(built.body.booking.travellers?.length, 2);
    assert.equal(built.body.booking.pickupNote, "Hotel lobby");

    state.items = [service];
    const serviceBuilt = buildManualBookingBody(state);
    assert.equal(serviceBuilt.product, "SERVICE");
    assert.deepEqual(serviceBuilt.body.booking, {
      serviceId: "svc_1",
      date: "2026-12-04",
      time: "18:00",
      days: 2,
      quantity: 1,
      pax: 3,
      lead: { firstName: "Nino", lastName: "Beridze", email: "nino@example.com", phone: "+995 555 00 00 00" },
      notes: "Late arrival",
    });
  });

  it("describes a new customer inline and an existing one by id", () => {
    const state = filled();
    state.buyer = {
      ...state.buyer,
      mode: "NEW_CUSTOMER",
      newCustomer: { ...state.buyer.newCustomer, kind: "COMPANY", name: "Acme Travel", contactName: "Dan", email: "dan@acme.test", country: "il", taxId: "123" },
    };
    assert.deepEqual(envelopeOf(state, "GEL").buyer, {
      kind: "CUSTOMER",
      customer: { kind: "COMPANY", name: "Acme Travel", contactName: "Dan", email: "dan@acme.test", country: "IL", taxId: "123" },
    });

    state.buyer = { ...state.buyer, mode: "CUSTOMER", customerId: "cus_1" };
    assert.deepEqual(envelopeOf(state, "GEL").buyer, { kind: "CUSTOMER", customerId: "cus_1" });
  });

  it("reads the adjustment as signed minor units and ignores nothing", () => {
    assert.equal(adjustmentCentsFrom("-50", "GEL"), -5000);
    assert.equal(adjustmentCentsFrom("12.5", "GEL"), 1250);
    assert.equal(adjustmentCentsFrom("0", "GEL"), null);
    assert.equal(adjustmentCentsFrom("", "GEL"), null);
    assert.equal(adjustmentCentsFrom("abc", "GEL"), null);
  });

  it("knows one line from a cart, and names each", () => {
    const state = filled();
    state.items = [hotel];
    assert.equal(isCartBooking(state), false);
    assert.equal(singleSelection(state), hotel);
    state.items = [pkg];
    assert.equal(isCartBooking(state), true, "a package can only be booked through the cart");
    assert.equal(singleSelection(state), null);
    state.items = [hotel, transfer];
    assert.equal(isCartBooking(state), true);
    assert.equal(wizardCurrency(state), "GEL");
    assert.equal(wizardCatalogueCents(state), 120_000);
    assert.ok(hasProduct(state, "TRANSFER"));
    assert.ok(!hasProduct(state, "TOUR", "PACKAGE"));
    assert.deepEqual(mixedCurrencies([hotel, { ...transfer, currency: "USD" }]), ["GEL", "USD"]);
    assert.deepEqual(mixedCurrencies([hotel, transfer]), []);
    assert.equal(labelOf(hotel), "Hotel Vera · Deluxe");
    assert.equal(labelOf(transfer), "Tbilisi Airport → Tbilisi");
    assert.equal(labelOf(pkg), "Kakheti weekend");
    assert.equal(wizardCurrency(emptyWizardState()), "GEL");
    assert.equal(wizardCatalogueCents(emptyWizardState()), null);
  });

  it("sends several lines, or a package, as one CUSTOM order under the same envelope", () => {
    const state = filled();
    state.items = [hotel, transfer, tour, service, pkg];
    state.travellers.flightOutbound = "TK 384";
    state.travellers.flightReturn = "TK 385";
    state.travellers.pickupAddress = "Terminal 1";
    state.travellers.pickupNote = "Hotel lobby";
    state.terms.adjustmentAmount = "-100";
    state.terms.adjustmentReason = "Group rate";

    const built = buildManualBookingBody(state);
    assert.equal(built.product, "CART");
    assert.deepEqual(built.body, {
      buyer: { kind: "PARTNER", partnerId: "ptr_1" },
      channel: "PHONE",
      confirmNow: true,
      priceAdjustment: { cents: -10_000, reason: "Group rate" },
      assignedManagerUserId: "usr_9",
      internalNotes: "Called twice",
      booking: {
        items: [
          { type: "HOTEL_STAY", label: "Hotel Vera · Deluxe", offerToken: "offer.token" },
          {
            type: "TRANSFER",
            label: "Tbilisi Airport → Tbilisi",
            quoteToken: "quote.token",
            flightNumber: "TK 384",
            flights: { outbound: "TK 384", return: "TK 385" },
            pickupAddress: "Terminal 1",
          },
          { type: "TOUR", label: "Kakheti wine day · Shared", offerToken: "tour.token", specialRequests: "Pick-up: Hotel lobby" },
          { type: "SERVICE", label: "Shabbat meals", serviceId: "svc_1", date: "2026-12-04", time: "18:00", days: 2, quantity: 1, pax: 3 },
          { type: "PACKAGE", label: "Kakheti weekend", packageToken: "package.token", flightNumber: "TK 384", pickupAddress: "Terminal 1" },
        ],
        leadGuest: { title: "MRS", firstName: "Nino", lastName: "Beridze", email: "nino@example.com", phone: "+995 555 00 00 00" },
        travellers: [
          { type: "ADULT", title: "MR", firstName: "Giorgi", lastName: "Beridze" },
          { type: "CHILD", firstName: "Ana", lastName: "Beridze", age: 7 },
        ],
        specialRequests: "Late arrival",
      },
    });
    // The catalogue sum plus the adjustment; the Review step swaps in the quote's figure when it has one.
    assert.equal(wizardTotalCents(state), 245_000 - 10_000);
    assert.equal(wizardTotalCents(state, 250_000), 240_000);

    // A lone package is a cart of one, with nothing the travellers did not type.
    state.items = [pkg];
    state.travellers = { ...state.travellers, flightOutbound: "", flightReturn: "", pickupAddress: "", pickupNote: "" };
    assert.deepEqual(cartItemsOf(state), [{ type: "PACKAGE", label: "Kakheti weekend", packageToken: "package.token" }]);
    assert.equal(buildManualBookingBody(state).product, "CART");
  });

  it("prefills the lead from a customer", () => {
    assert.deepEqual(splitName("Nino Beridze"), { firstName: "Nino", lastName: "Beridze" });
    assert.deepEqual(splitName("Ana Maria de la Cruz"), { firstName: "Ana Maria de la", lastName: "Cruz" });
    assert.deepEqual(splitName("Cher"), { firstName: "Cher", lastName: "" });
    const lead = leadFromCustomer({ kind: "COMPANY", name: "Acme", contactName: "Dan Levi", email: "dan@acme.test", phone: null });
    assert.deepEqual(lead, { title: "", firstName: "Dan", lastName: "Levi", email: "dan@acme.test", phone: "" });
  });
});

describe("manual booking: validation", () => {
  const can = { approve: true, override: true };

  it("refuses to advance past a step with a blank the next one needs", () => {
    const state = emptyWizardState();
    assert.ok(validateStep(0, state, can)["buyer.partnerId"]);
    assert.ok(validateStep(1, state, can).selection);
    assert.ok(validateStep(2, state, can)["lead.email"]);
    assert.ok(validateStep(3, state, can).channel);
  });

  it("refuses a list that settles in two currencies, and one past the server's limit", () => {
    const state = filled();
    state.items = [hotel, { ...transfer, currency: "USD" }];
    assert.match(validateStep(1, state, can).selection ?? "", /GEL and USD/);
    state.items = [hotel, transfer];
    assert.deepEqual(validateStep(1, state, can), {});
    state.items = Array.from({ length: 21 }, () => hotel);
    assert.match(validateStep(1, state, can).selection ?? "", /up to 20/);
  });

  it("needs a reason with an adjustment, and the capability for it", () => {
    const state = filled();
    state.terms.adjustmentAmount = "-10";
    assert.ok(validateStep(3, state, can).adjustmentReason);
    state.terms.adjustmentReason = "Because";
    assert.deepEqual(validateStep(3, state, can), {});
    assert.ok(validateStep(3, state, { approve: true, override: false }).adjustmentAmount);
    state.terms.adjustmentAmount = "0";
    assert.ok(validateStep(3, state, can).adjustmentAmount);
    assert.ok(validateStep(3, state, { approve: false, override: true }).confirmNow);
  });
});

describe("manual booking: server refusals", () => {
  it("maps each server path onto the step that owns it", () => {
    assert.deepEqual(wizardFieldFor("buyer.customer.email"), { step: 0, field: "newCustomer.email" });
    assert.deepEqual(wizardFieldFor("buyer.partnerId"), { step: 0, field: "buyer.partnerId" });
    assert.deepEqual(wizardFieldFor("booking.offerToken"), { step: 1, field: "selection" });
    assert.deepEqual(wizardFieldFor("booking.date"), { step: 1, field: "selection" });
    assert.deepEqual(wizardFieldFor("booking.items.2.offerToken"), { step: 1, field: "items.2" });
    assert.deepEqual(wizardFieldFor("booking.items"), { step: 1, field: "selection" });
    assert.deepEqual(wizardFieldFor("booking.leadGuest.email"), { step: 2, field: "lead.email" });
    assert.deepEqual(wizardFieldFor("booking.leadPassenger.phone"), { step: 2, field: "lead.phone" });
    assert.deepEqual(wizardFieldFor("booking.lead.firstName"), { step: 2, field: "lead.firstName" });
    assert.deepEqual(wizardFieldFor("booking.guests.1.age"), { step: 2, field: "extras.1.age" });
    assert.deepEqual(wizardFieldFor("booking.flights.return"), { step: 2, field: "flightReturn" });
    assert.deepEqual(wizardFieldFor("booking.notes"), { step: 2, field: "specialRequests" });
    assert.deepEqual(wizardFieldFor("priceAdjustment.cents"), { step: 3, field: "adjustmentAmount" });
    assert.deepEqual(wizardFieldFor("priceAdjustment.reason"), { step: 3, field: "adjustmentReason" });
    assert.deepEqual(wizardFieldFor("channel"), { step: 3, field: "channel" });
    assert.deepEqual(wizardFieldFor("something.else"), { step: 4, field: "something.else" });
  });

  it("reopens the earliest step that has a problem", () => {
    const mapped = mapServerErrors({ "priceAdjustment.cents": "An adjustment of nothing is not one", "booking.leadGuest.email": "Invalid email" });
    assert.equal(mapped.step, 2);
    assert.deepEqual(mapped.errors, { adjustmentAmount: "An adjustment of nothing is not one", "lead.email": "Invalid email" });
    assert.equal(mapServerErrors({}).step, null);
  });

  it("knows a stale offer when it sees one", () => {
    assert.ok(isStaleOffer({ reason: "PRICE_CHANGED", quotedCents: 1, currentCents: 2 }));
    assert.ok(isStaleOffer({ reason: "UNAVAILABLE" }));
    assert.ok(!isStaleOffer({ reason: "PARTNER_INACTIVE" }));
    assert.ok(!isStaleOffer(null));
  });

  it("maps a cart's 409 back onto the lines it names, and a 422 onto the currency", () => {
    const items = [hotel, transfer, tour];
    assert.equal(cartConflictOf({ reason: "PRICE_CHANGED", quotedCents: 1, currentCents: 2 }), null, "a single product's 409 is not a cart's");
    assert.equal(cartConflictOf({ reason: "PARTNER_INACTIVE", items: [] }), null);

    const gone = cartConflictOf({ reason: "UNAVAILABLE", items: [{ index: 1, type: "TRANSFER", reason: "ROUTE_CLOSED" }, { index: 7, type: "TOUR", reason: "SOLD_OUT" }] });
    assert.ok(gone);
    assert.deepEqual(cartConflictErrors(gone, items), { "items.1": "No longer available (route closed): remove it, or search again." });

    const moved = cartConflictOf({ reason: "PRICE_CHANGED", items: [{ index: 0, type: "HOTEL_STAY", quotedCents: 100_000, currentCents: 110_000 }] });
    assert.ok(moved);
    assert.deepEqual(cartConflictErrors(moved, items), { "items.0": "The price has moved since the search." });

    assert.deepEqual(mixedCurrencyOf({ reason: "MIXED_CURRENCY", currencies: ["GEL", "USD"] }), ["GEL", "USD"]);
    assert.deepEqual(mixedCurrencyOf({ reason: "MIXED_CURRENCY" }), []);
    assert.equal(mixedCurrencyOf({ reason: "EMPTY" }), null);
  });
});
