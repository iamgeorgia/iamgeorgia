import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDuration,
  greetingFor,
  jobNeeds,
  progressIndex,
  untilLabel,
} from "../lib/driver/assignment";
import type { PassengerBlock } from "../types/driver";

/**
 * The driver panel's small judgements: how a gap in time is said, what a job
 * needs, how far along it is, and which greeting the clock calls for. Each is
 * shown to a driver at the kerb, so each is pinned here.
 */

const booking = (overrides: Partial<PassengerBlock> = {}): PassengerBlock => ({
  reference: "TRF-000001",
  bookingStatus: "CONFIRMED",
  tripType: "ONE_WAY",
  adults: 2,
  children: 0,
  childAges: [],
  passengers: 2,
  luggage: 2,
  cabinBags: 0,
  leadPassengerName: "Priya Raman",
  leadPassengerPhone: null,
  flightNumber: null,
  pickupAddress: null,
  dropoffAddress: null,
  pickupPlace: null,
  dropoffPlace: null,
  specialRequests: null,
  vehicleClassName: null,
  extras: [],
  ...overrides,
});

const NOW = Date.parse("2026-11-04T10:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

describe("formatDuration", () => {
  it("says minutes alone under an hour, and pads minutes after hours", () => {
    assert.equal(formatDuration(40), "40 min");
    assert.equal(formatDuration(65), "1 h 05 min");
    assert.equal(formatDuration(180), "3 h");
  });

  it("never goes negative", () => {
    assert.equal(formatDuration(-5), "0 min");
  });
});

describe("untilLabel", () => {
  it("is 'now' within a minute either side", () => {
    assert.deepEqual(untilLabel(at(0.5), NOW), { label: "now", past: false, soon: true });
    assert.equal(untilLabel(at(-0.5), NOW).label, "now");
  });

  it("rounds a future gap up, so 'in 1 min' lasts until it is 'now'", () => {
    assert.equal(untilLabel(at(1.2), NOW).label, "in 2 min");
    assert.equal(untilLabel(at(80), NOW).label, "in 1 h 20 min");
  });

  it("marks the last hour as soon, and anything before it as not", () => {
    assert.equal(untilLabel(at(60), NOW).soon, true);
    assert.equal(untilLabel(at(61), NOW).soon, false);
  });

  it("switches to days past a day, with hours only while they matter", () => {
    assert.equal(untilLabel(at(26 * 60), NOW).label, "in 1 day 2 h");
    assert.equal(untilLabel(at(24 * 60), NOW).label, "in 1 day");
    assert.equal(untilLabel(at(170 * 60 + 35), NOW).label, "in 7 days");
  });

  it("says a past moment as 'ago', and never as soon", () => {
    assert.deepEqual(untilLabel(at(-12), NOW), { label: "12 min ago", past: true, soon: false });
  });
});

describe("jobNeeds", () => {
  it("is empty for a plain booking", () => {
    assert.deepEqual(jobNeeds(booking()), []);
  });

  it("names child seats with the ages that decide them", () => {
    assert.equal(jobNeeds(booking({ childAges: [4] }))[0].label, "Child seat · age 4");
    assert.equal(jobNeeds(booking({ childAges: [0, 7] }))[0].label, "2 child seats · ages under 1, 7");
  });

  it("lists paid extras with their quantity, and flags a written request", () => {
    const needs = jobNeeds(
      booking({
        extras: [
          { code: "SKI", name: "Ski carriage", quantity: 2 },
          { code: "STOP", name: "Additional stop", quantity: 1 },
        ],
        specialRequests: "Quiet ride, please",
      }),
    );
    assert.deepEqual(
      needs.map((need) => [need.label, need.kind]),
      [
        ["Ski carriage\u00a0×\u00a02", "equipment"],
        ["Additional stop", "equipment"],
        ["Passenger request", "note"],
      ],
    );
  });

  it("ignores a request that is only whitespace", () => {
    assert.deepEqual(jobNeeds(booking({ specialRequests: "  \n " })), []);
  });
});

describe("progressIndex", () => {
  it("counts the five steps from acceptance to drop-off", () => {
    assert.equal(progressIndex("ASSIGNED"), -1);
    assert.equal(progressIndex("ACCEPTED"), 0);
    assert.equal(progressIndex("ARRIVED"), 2);
    assert.equal(progressIndex("COMPLETED"), 4);
  });

  it("stops a no-show at 'Arrived': the passenger never boarded", () => {
    assert.equal(progressIndex("NO_SHOW_REPORTED"), 2);
    assert.equal(progressIndex("NO_SHOW"), 2);
  });
});

describe("greetingFor", () => {
  it("reads the hour in the pick-up's zone, not the server's", () => {
    // 04:30 UTC is 08:30 in Tbilisi (UTC+4).
    assert.equal(greetingFor(Date.parse("2026-11-04T04:30:00Z"), "Asia/Tbilisi"), "Good morning");
    assert.equal(greetingFor(Date.parse("2026-11-04T04:30:00Z"), "UTC"), "Good evening");
    assert.equal(greetingFor(Date.parse("2026-11-04T10:00:00Z"), "Asia/Tbilisi"), "Good afternoon");
  });
});
