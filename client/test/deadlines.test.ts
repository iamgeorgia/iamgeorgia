import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calendarRange,
  calendarStateFromParams,
  calendarStateToParams,
  calendarStateToSearch,
  countByKind,
  dayKeyIn,
  deadlineDueWords,
  deadlineTone,
  describeCalendarFilters,
  groupByDay,
  hasCalendarFilters,
  instantFromZoned,
  instantRangeFor,
  moveCapabilitiesFor,
  monthEndISO,
  monthGridDays,
  rangeTitle,
  stepAnchor,
  weekStartISO,
  withoutCalendarFilter,
  zonedParts,
} from "../lib/admin/deadlines";
import type { Deadline } from "../types/deadline";

const TODAY = "2026-10-20";

const row = (over: Partial<Deadline> = {}): Deadline => ({
  id: "d1",
  kind: "PAYMENT",
  status: "OPEN",
  source: "SYSTEM",
  product: "HOTEL",
  bookingId: "b1",
  reference: "BKG-1",
  title: "Rooms Hotel",
  leadName: "Ana",
  partnerId: null,
  customerId: null,
  assignedManagerUserId: null,
  partner: null,
  customer: null,
  assignedManager: null,
  receivableId: "r1",
  dueAt: "2026-10-22T14:00:00.000Z",
  timezone: "Asia/Tbilisi",
  overdue: false,
  daysLeft: 2,
  meta: {},
  completedAt: null,
  href: "/admin/bookings/BKG-1",
  updatedAt: "2026-10-20T00:00:00.000Z",
  ...over,
});

describe("deadline vocabulary", () => {
  it("paints by kind, then by lateness, then by closure", () => {
    assert.equal(deadlineTone(row()), "info");
    assert.equal(deadlineTone(row({ kind: "FREE_CANCELLATION" })), "warning");
    assert.equal(deadlineTone(row({ kind: "CONFIRMATION" })), "attention");
    assert.equal(deadlineTone(row({ overdue: true })), "critical");
    assert.equal(deadlineTone(row({ status: "MISSED" })), "critical");
    assert.equal(deadlineTone(row({ status: "MET", overdue: true })), "positive");
    assert.equal(deadlineTone(row({ status: "CANCELLED" })), "neutral");
  });

  it("names Finance's capabilities for a payment and the desk's for the rest", () => {
    assert.deepEqual(moveCapabilitiesFor("PAYMENT"), ["finance.adjustments.execute", "finance.adjustments.request"]);
    assert.deepEqual(moveCapabilitiesFor("FREE_CANCELLATION"), ["bookings.deadlines.write"]);
    assert.deepEqual(moveCapabilitiesFor("CONFIRMATION"), ["bookings.deadlines.write"]);
  });

  it("says how far away a deadline is in its own zone's days", () => {
    assert.equal(deadlineDueWords(row(), TODAY), "In 2 days");
    assert.equal(deadlineDueWords(row({ dueAt: "2026-10-20T20:30:00.000Z" }), TODAY), "Tomorrow"); // 00:30 on the 21st in Tbilisi
    assert.equal(deadlineDueWords(row({ dueAt: "2026-10-20T10:00:00.000Z" }), TODAY), "Today");
    assert.equal(deadlineDueWords(row({ dueAt: "2026-10-18T10:00:00.000Z", status: "MISSED" }), TODAY), "2 days late");
    assert.equal(deadlineDueWords(row({ status: "MET" }), TODAY), "Met");
  });
});

describe("calendar state and the URL", () => {
  it("round-trips through the query string", () => {
    const state = calendarStateFromParams(
      { view: "week", from: "2026-11-03", kind: ["PAYMENT", "CONFIRMATION"], status: "OPEN", product: "HOTEL", partnerId: "p1" },
      TODAY,
    );
    assert.deepEqual(state, {
      view: "week",
      from: "2026-11-03",
      kind: ["PAYMENT", "CONFIRMATION"],
      status: ["OPEN"],
      product: ["HOTEL"],
      partnerId: "p1",
    });
    const params = calendarStateToParams(state, TODAY);
    assert.deepEqual(calendarStateFromParams(params, TODAY), state);
    assert.equal(
      calendarStateToSearch(state, TODAY),
      "?view=week&from=2026-11-03&kind=PAYMENT&kind=CONFIRMATION&status=OPEN&product=HOTEL&partnerId=p1",
    );
  });

  it("writes nothing for the defaults and drops what it does not know", () => {
    const state = calendarStateFromParams({ view: "year", from: "yesterday", kind: "LUNCH", status: ["OPEN", "LATE"] }, TODAY);
    assert.deepEqual(state, { view: "month", from: TODAY, kind: [], status: ["OPEN"], product: [] });
    assert.deepEqual(calendarStateToParams({ view: "month", from: TODAY, kind: [], status: [], product: [] }, TODAY), {});
    assert.equal(calendarStateFromParams({}, TODAY, "week").view, "week");
  });

  it("knows when something is narrowing the calendar, and how to take it off", () => {
    const empty = calendarStateFromParams({}, TODAY);
    assert.equal(hasCalendarFilters(empty), false);
    const state = calendarStateFromParams({ kind: ["PAYMENT", "CONFIRMATION"], managerId: "u1" }, TODAY);
    assert.equal(hasCalendarFilters(state), true);
    const chips = describeCalendarFilters(state, { managerName: "Nino" });
    assert.deepEqual(
      chips.map((chip) => chip.label),
      ["Payment due", "Confirmation due", "Manager: Nino"],
    );
    const fewer = withoutCalendarFilter(state, chips[0].clear);
    assert.deepEqual(fewer.kind, ["CONFIRMATION"]);
    assert.equal(withoutCalendarFilter(fewer, chips[2].clear).managerId, undefined);
    assert.deepEqual(state.kind, ["PAYMENT", "CONFIRMATION"], "the original is left alone");
  });
});

describe("zones", () => {
  it("reads an instant as the wall clock of the deadline's zone", () => {
    assert.deepEqual(zonedParts("2026-10-22T14:00:00.000Z", "Asia/Tbilisi"), { date: "2026-10-22", time: "18:00" });
    assert.equal(dayKeyIn("2026-10-22T21:30:00.000Z", "Asia/Tbilisi"), "2026-10-23");
    assert.equal(dayKeyIn("2026-10-22T21:30:00.000Z", "Not/AZone"), "2026-10-22");
  });

  it("turns a wall clock back into the instant, across a DST change", () => {
    assert.equal(instantFromZoned("2026-10-22", "18:00", "Asia/Tbilisi"), "2026-10-22T14:00:00.000Z");
    // Israel leaves summer time on 25 Oct 2026: the same wall clock is one hour later in UTC afterwards.
    assert.equal(instantFromZoned("2026-10-20", "12:00", "Asia/Jerusalem"), "2026-10-20T09:00:00.000Z");
    assert.equal(instantFromZoned("2026-10-27", "12:00", "Asia/Jerusalem"), "2026-10-27T10:00:00.000Z");
    assert.equal(instantFromZoned("2026-10-22", "", "UTC"), "2026-10-22T00:00:00.000Z");
  });
});

describe("month, week and day arithmetic", () => {
  it("starts weeks on Monday and shows whole weeks around a month", () => {
    assert.equal(weekStartISO("2026-10-20"), "2026-10-19");
    assert.equal(weekStartISO("2026-10-19"), "2026-10-19");
    assert.equal(weekStartISO("2026-10-25"), "2026-10-19");
    assert.equal(monthEndISO("2026-02-10"), "2026-02-28");
    assert.equal(monthEndISO("2028-02-10"), "2028-02-29");
    assert.deepEqual(calendarRange("month", "2026-10-20"), { start: "2026-09-28", end: "2026-11-01" });
    assert.deepEqual(calendarRange("week", "2026-10-20"), { start: "2026-10-19", end: "2026-10-25" });
    assert.deepEqual(calendarRange("day", "2026-10-20"), { start: "2026-10-20", end: "2026-10-20" });
  });

  it("lays the month out seven across, weekends marked", () => {
    const days = monthGridDays("2026-10-20");
    assert.equal(days.length, 35);
    assert.equal(days[0].key, "2026-09-28");
    assert.equal(days[0].inMonth, false);
    assert.equal(days[3].key, "2026-10-01");
    assert.equal(days[3].inMonth, true);
    assert.equal(days[5].weekend, true);
    assert.equal(days[6].weekend, true);
    assert.equal(days[7].weekend, false);
    assert.equal(monthGridDays("2026-08-01").length, 42); // August 2026 starts on a Saturday and ends on a Monday: six rows
  });

  it("steps the anchor by one view at a time", () => {
    assert.equal(stepAnchor("month", "2026-10-20", 1), "2026-11-01");
    assert.equal(stepAnchor("month", "2026-01-31", -1), "2025-12-01");
    assert.equal(stepAnchor("week", "2026-10-20", 1), "2026-10-26");
    assert.equal(stepAnchor("day", "2026-10-31", 1), "2026-11-01");
  });

  it("asks the server for a day's padding either side, then buckets by zone", () => {
    assert.deepEqual(instantRangeFor("day", "2026-10-20"), { from: "2026-10-19T00:00:00.000Z", to: "2026-10-21T23:59:59.999Z" });
    const groups = groupByDay([
      row({ id: "late", dueAt: "2026-10-22T21:30:00.000Z" }), // 01:30 on the 23rd in Tbilisi
      row({ id: "early", dueAt: "2026-10-22T05:00:00.000Z" }),
      row({ id: "mid", dueAt: "2026-10-22T10:00:00.000Z", kind: "CONFIRMATION" }),
    ]);
    assert.deepEqual([...groups.keys()], ["2026-10-22", "2026-10-23"]);
    assert.deepEqual(groups.get("2026-10-22")?.map((entry) => entry.id), ["early", "mid"]);
    assert.deepEqual(countByKind([...groups.values()].flat()), { PAYMENT: 2, FREE_CANCELLATION: 0, CONFIRMATION: 1 });
  });

  it("titles each view", () => {
    assert.equal(rangeTitle("month", "2026-10-20"), "October 2026");
    assert.equal(rangeTitle("week", "2026-10-20"), "19 – 25 Oct 2026");
    assert.equal(rangeTitle("week", "2026-10-28"), "26 Oct – 1 Nov 2026");
    assert.equal(rangeTitle("day", "2026-10-20"), "Tuesday, 20 October 2026");
  });
});
