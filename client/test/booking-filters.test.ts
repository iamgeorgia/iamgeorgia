import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOOKING_FILTER_KEYS,
  BOOKING_PRESETS,
  activePreset,
  bookingFiltersFromParams,
  bookingFiltersToParams,
  bookingFiltersToSearch,
  bookingSourceLabels,
  dateRangeFor,
  describeFilters,
  hasActiveFilters,
  invoiceStatusLabels,
  paymentStatusLabels,
  presetFilters,
  sortLabels,
  withoutFilter,
  BOOKING_SORTS,
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
} from "../lib/admin/bookingFilters";
import { BOOKING_SOURCES, BOOKING_STATUSES, bookingQueryFromParams } from "../lib/admin/bookings";
import { orderQueryFromParams } from "../lib/admin/orders";
import { tourBookingQueryFromParams } from "../lib/admin/tours";

/**
 * The shared filter vocabulary every booking register reads and writes. The
 * keys are the server's own query parameters, so what goes in as a URL must
 * come out as the same URL, and what a preset sets must be recognised as
 * that preset when it comes back.
 */

const TODAY = "2026-10-20";

describe("booking filters: reading the URL", () => {
  it("reads every shared key, arrays as repeated params", () => {
    const state = bookingFiltersFromParams(
      {
        search: " Beridze ",
        status: ["CONFIRMED", "PENDING"],
        paymentStatus: ["UNPAID", "OVERDUE"],
        invoiceStatus: "ISSUED",
        paymentMethod: "CASH",
        source: ["PHONE", "WEB"],
        partnerId: "p1",
        customerId: "c1",
        managerId: "u1",
        destinationId: "d1",
        approval: "OVERDUE",
        from: "2026-11-01",
        to: "2026-11-30",
        createdFrom: "2026-10-01",
        createdTo: "2026-10-20",
        sort: "due:asc",
        page: "3",
      },
      { statuses: BOOKING_STATUSES },
    );

    assert.deepEqual(state, {
      search: "Beridze",
      status: ["PENDING", "CONFIRMED"],
      paymentStatus: ["UNPAID", "OVERDUE"],
      invoiceStatus: ["ISSUED"],
      paymentMethod: "CASH",
      source: ["WEB", "PHONE"],
      partnerId: "p1",
      customerId: "c1",
      managerId: "u1",
      destinationId: "d1",
      approval: "OVERDUE",
      from: "2026-11-01",
      to: "2026-11-30",
      createdFrom: "2026-10-01",
      createdTo: "2026-10-20",
      sort: "due:asc",
      page: 3,
    });
  });

  it("drops what it does not recognise rather than failing", () => {
    const state = bookingFiltersFromParams(
      {
        status: ["CONFIRMED", "BOGUS"],
        paymentStatus: "NOPE",
        source: "carrier-pigeon",
        approval: "MAYBE",
        from: "1 Nov",
        sort: "price:up",
        page: "-2",
      },
      { statuses: BOOKING_STATUSES },
    );

    assert.deepEqual(state, { status: ["CONFIRMED"], page: 1 });
  });

  it("never reads a status without a vocabulary to check it against", () => {
    assert.deepEqual(bookingFiltersFromParams({ status: "CONFIRMED" }), { page: 1 });
  });

  it("reads products only on the register of every booking", () => {
    const state = bookingFiltersFromParams({ product: ["HOTEL", "ORDER", "X"] }, { products: ["HOTEL", "TRANSFER", "TOUR", "SERVICE", "ORDER"] });
    assert.deepEqual(state.product, ["HOTEL", "ORDER"]);
    assert.equal(bookingFiltersFromParams({ product: "HOTEL" }).product, undefined);
  });
});

describe("booking filters: writing the URL", () => {
  it("round-trips every key, with no page=1", () => {
    const params = {
      search: "x",
      status: ["PENDING", "CONFIRMED"],
      paymentStatus: ["OVERDUE"],
      invoiceStatus: ["PAID", "ERROR"],
      paymentMethod: "CARD",
      source: ["DEMO"],
      partnerId: "p",
      customerId: "c",
      managerId: "m",
      destinationId: "d",
      approval: "PENDING",
      from: "2026-01-01",
      to: "2026-01-31",
      createdFrom: "2025-12-01",
      createdTo: "2025-12-31",
      sort: "total:desc",
      page: "2",
    };
    const state = bookingFiltersFromParams(params, { statuses: BOOKING_STATUSES });
    assert.deepEqual(bookingFiltersToParams(state), params);

    const again = bookingFiltersFromParams(bookingFiltersToParams(state), { statuses: BOOKING_STATUSES });
    assert.deepEqual(again, state);

    assert.deepEqual(bookingFiltersToParams({ page: 1 }), {});
    assert.equal(bookingFiltersToSearch({ page: 1 }), "");
    assert.equal(bookingFiltersToSearch({ status: ["A", "B"], page: 2 }), "?status=A&status=B&page=2");
  });

  it("knows when nothing is narrowing the list", () => {
    assert.equal(hasActiveFilters({ page: 4 }), false);
    assert.equal(hasActiveFilters({ page: 1, paymentStatus: [] }), false);
    assert.equal(hasActiveFilters({ page: 1, search: "x" }), true);
    assert.equal(hasActiveFilters({ page: 1, sort: "date:asc" }), true);
  });
});

describe("booking filters: presets", () => {
  it("maps each preset onto the shared keys and recognises it back", () => {
    for (const preset of BOOKING_PRESETS) {
      const filters = presetFilters(preset.id, TODAY);
      for (const key of Object.keys(filters)) assert.ok((BOOKING_FILTER_KEYS as readonly string[]).includes(key), `${preset.id} sets ${key}`);
      const state = bookingFiltersFromParams(bookingFiltersToParams({ ...filters, page: 1 }), { statuses: BOOKING_STATUSES });
      assert.equal(activePreset(state, TODAY), preset.id, preset.id);
    }
  });

  it("looks forward for arrivals and back for recently created", () => {
    assert.deepEqual(presetFilters("upcoming", TODAY), { status: ["CONFIRMED"], from: TODAY, sort: "date:asc" });
    assert.deepEqual(presetFilters("recent", TODAY), { createdFrom: "2026-10-13", sort: "created:desc" });
    assert.deepEqual(presetFilters("overduePayments", TODAY), { paymentStatus: ["OVERDUE"], sort: "due:asc" });
    assert.deepEqual(presetFilters("all", TODAY), {});
  });

  it("ignores the search box and the page when matching, and nothing else", () => {
    assert.equal(activePreset({ page: 3, search: "nino", approval: "PENDING" }, TODAY), "pendingApproval");
    assert.equal(activePreset({ page: 1, approval: "PENDING", partnerId: "p" }, TODAY), null);
    assert.equal(activePreset({ page: 1 }, TODAY), "all");
    assert.equal(activePreset({ page: 1, search: "x" }, TODAY), "all");
  });

  it("builds the date shortcuts in either direction", () => {
    assert.deepEqual(dateRangeFor("today", TODAY), { from: TODAY, to: TODAY });
    assert.deepEqual(dateRangeFor("week", TODAY), { from: TODAY, to: "2026-10-26" });
    assert.deepEqual(dateRangeFor("month", TODAY, "back"), { from: "2026-09-21", to: TODAY });
  });
});

describe("booking filters: active chips", () => {
  it("describes each filter once, ranges as one chip, the default sort not at all", () => {
    const chips = describeFilters(
      {
        search: "nino",
        status: ["CONFIRMED"],
        paymentStatus: ["UNPAID", "OVERDUE"],
        source: ["PHONE"],
        partnerId: "p1",
        from: "2026-11-01",
        to: "2026-11-03",
        createdFrom: "2026-10-01",
        sort: "created:desc",
        page: 2,
      },
      { statusLabel: (status) => `S:${status}`, dateLabel: "Arriving", partnerName: "Kosher Travel" },
    );

    assert.deepEqual(
      chips.map((chip) => chip.label),
      ["“nino”", "S:CONFIRMED", "Payment: Unpaid", "Payment: Overdue", "Source: Phone", "Partner: Kosher Travel", "Arriving 1 Nov 2026 – 3 Nov 2026", "Created from 1 Oct 2026"],
    );
    assert.ok(new Set(chips.map((chip) => chip.key)).size === chips.length, "chip keys are unique");
  });

  it("removes one entry of an array, both ends of a range, or the key", () => {
    const state = bookingFiltersFromParams(
      { paymentStatus: ["UNPAID", "OVERDUE"], from: "2026-11-01", to: "2026-11-03", createdFrom: "2026-10-01", createdTo: "2026-10-02", sort: "due:asc", page: "3" },
      {},
    );

    assert.deepEqual(withoutFilter(state, { key: "paymentStatus", value: "UNPAID" }).paymentStatus, ["OVERDUE"]);
    assert.equal(withoutFilter(withoutFilter(state, { key: "paymentStatus", value: "UNPAID" }), { key: "paymentStatus", value: "OVERDUE" }).paymentStatus, undefined);
    const noDates = withoutFilter(state, { key: "from" });
    assert.equal(noDates.from, undefined);
    assert.equal(noDates.to, undefined);
    assert.equal(noDates.createdFrom, "2026-10-01");
    const noCreated = withoutFilter(state, { key: "createdFrom" });
    assert.equal(noCreated.createdTo, undefined);
    assert.equal(withoutFilter(state, { key: "sort" }).sort, undefined);
    assert.equal(withoutFilter(state, { key: "sort" }).page, 1, "removing a chip goes back to the first page");
  });
});

describe("booking filters: labels", () => {
  it("names every payment status, invoice status, source and sort", () => {
    for (const status of PAYMENT_STATUSES) assert.ok(paymentStatusLabels[status], status);
    for (const status of INVOICE_STATUSES) assert.ok(invoiceStatusLabels[status], status);
    for (const source of BOOKING_SOURCES) assert.ok(bookingSourceLabels[source], source);
    for (const sort of BOOKING_SORTS) assert.ok(sortLabels[sort], sort);
    assert.equal(bookingSourceLabels.EXTERNAL_AGENCY, "External agency");
  });
});

describe("the product registers read the shared keys", () => {
  it("spreads them beside their own fields", () => {
    const hotel = bookingQueryFromParams({ status: "CONFIRMED", paymentStatus: "PAID", hotelId: "h", sort: "date:asc", page: "2" });
    assert.deepEqual(hotel, { status: ["CONFIRMED"], paymentStatus: ["PAID"], hotelId: "h", sort: "date:asc", page: 2, pageSize: 25 });

    const tour = tourBookingQueryFromParams({ status: ["PENDING"], managerId: "m", tourId: "t" });
    assert.deepEqual(tour, { status: ["PENDING"], managerId: "m", tourId: "t", page: 1, pageSize: 25 });

    const order = orderQueryFromParams({ status: "PENDING_CONFIRMATION", source: ["PARTNER"], partnerId: "p", packageId: "pk" });
    assert.deepEqual(order, { status: ["PENDING_CONFIRMATION"], source: ["PARTNER"], partnerId: "p", packageId: "pk", page: 1, pageSize: 25 });
  });

  it("still lets a fixed queue lock its statuses", () => {
    assert.deepEqual(bookingQueryFromParams({ status: "CANCELLED" }, { lockedStatuses: ["CONFIRMED"] }).status, ["CONFIRMED"]);
  });
});
