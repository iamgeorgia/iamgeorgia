import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { DASHBOARD_WIDGETS, dashboardFor, widgetsIn } from "../lib/admin/dashboard";

/**
 * What each built-in role finds on its overview, and a guarantee that no
 * widget it is shown reads an endpoint the server would refuse it. The second
 * half reads the server's RBAC matrix fixture directly — the same file the
 * server's route-guard test pins — so a guard tightened on the server breaks
 * this test rather than an overview in production.
 */

const read = (relativePath: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"));

const ROLES = read("./fixtures/role-capabilities.json") as Record<string, string[]>;
const MATRIX = read("../../server/test/fixtures/rbac-matrix.json") as Record<string, Record<string, string>>;

const STAFF = ["ADMIN", "MANAGEMENT", "TOUR_OPERATOR", "ACCOUNTANT", "FINANCE_OPERATOR", "DISPATCHER"];

const ids = (role: string, section?: "decide" | "watch") => {
  const placed = dashboardFor(ROLES[role]);
  return (section ? widgetsIn(placed, section) : placed).map((widget) => widget.id).sort();
};

describe("overview per role", () => {
  it("gives the reservations desk its queues and the arrivals", () => {
    assert.deepEqual(
      ids("TOUR_OPERATOR", "decide"),
      ["bookingApprovals", "pendingOrders", "tourRequests", "unassignedLegs"].sort(),
    );
    // Only the approver roles are shown the approval queue; management watches
    // the figures and finance the money, and neither can say yes to a booking.
    assert.ok(!ids("MANAGEMENT").includes("bookingApprovals"));
    assert.ok(!ids("FINANCE_OPERATOR").includes("bookingApprovals"));
    assert.ok(ids("ADMIN", "decide").includes("bookingApprovals"));
    assert.ok(ids("TOUR_OPERATOR").includes("arrivals"));
    assert.ok(!ids("TOUR_OPERATOR").some((id) => ["paymentsDue", "financeFigures", "recentPayments"].includes(id)));
  });

  it("gives the finance operator money and nothing about the catalogue or dispatch", () => {
    assert.deepEqual(ids("FINANCE_OPERATOR", "decide"), ["overdueReceivables", "paymentsDue"].sort());
    assert.ok(!ids("FINANCE_OPERATOR").some((id) => ["unassignedLegs", "dispatchFigures", "financeFigures"].includes(id)));
  });

  it("gives the accountant the money queues and the figures over them", () => {
    assert.deepEqual(ids("ACCOUNTANT", "decide"), ["invoiceErrors", "overdueReceivables", "paymentsDue"].sort());
    assert.ok(ids("ACCOUNTANT").includes("financeFigures"));
  });

  it("gives management every figure and no work", () => {
    assert.deepEqual(ids("MANAGEMENT", "decide"), []);
    for (const id of ["bookingFigures", "financeFigures", "dispatchFigures", "paymentsDue", "applications"]) {
      assert.ok(ids("MANAGEMENT").includes(id as never), `MANAGEMENT misses ${id}`);
    }
  });

  it("gives the dispatcher the board and nothing else", () => {
    assert.deepEqual(ids("DISPATCHER"), ["dispatchFigures", "unassignedLegs"].sort());
    assert.deepEqual(ids("DISPATCHER", "decide"), ["unassignedLegs"]);
  });

  it("shows a role with nothing nothing", () => {
    assert.deepEqual(dashboardFor([]), []);
  });

  it("never shows a role a widget whose endpoint the server refuses it", () => {
    for (const widget of DASHBOARD_WIDGETS) {
      for (const endpoint of widget.endpoints) assert.ok(MATRIX[endpoint], `${widget.id}: ${endpoint} is not a known route`);
    }
    for (const role of STAFF) {
      for (const widget of dashboardFor(ROLES[role])) {
        for (const endpoint of widget.endpoints) {
          assert.equal(MATRIX[endpoint][role], "REACHED", `${role} is shown ${widget.id} but ${endpoint} is ${MATRIX[endpoint][role]}`);
        }
      }
    }
  });
});
