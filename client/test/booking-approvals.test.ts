import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOOKING_APPROVAL_PRODUCTS,
  PAYMENT_STATUSES,
  approvalProductFilterLabels,
  approvalProductLabels,
  bookingApprovalHref,
  bookingApprovalQueryFromParams,
  paymentStatusLabels,
  paymentStatusTones,
  timeAgo,
} from "../lib/admin/bookingApprovals";
import { canOpenPath, screenFor } from "../lib/admin/access";

/**
 * The approval queue's vocabulary and URL reading, kept in a plain `.ts`
 * module so this can run under Node without React. The screen-table checks
 * guard the one subtlety in the route: `/admin/bookings/approvals` sits under
 * the hotel register's `/admin/bookings/[id]` and must win on literalness.
 */
describe("booking approvals", () => {
  it("links every product to its own detail page", () => {
    assert.equal(bookingApprovalHref("HOTEL", "BKG-1"), "/admin/bookings/BKG-1");
    assert.equal(bookingApprovalHref("TRANSFER", "TRF-1"), "/admin/transfers/bookings/TRF-1");
    assert.equal(bookingApprovalHref("TOUR", "TUR-1"), "/admin/tours/bookings/TUR-1");
    assert.equal(bookingApprovalHref("ORDER", "ORD-1"), "/admin/orders/ORD-1");
    assert.equal(bookingApprovalHref("SERVICE", "SVC-1"), "/admin/services/bookings/SVC-1");
  });

  it("names every product and every payment status", () => {
    for (const product of BOOKING_APPROVAL_PRODUCTS) {
      assert.ok(approvalProductLabels[product], product);
      assert.ok(approvalProductFilterLabels[product], product);
    }
    for (const status of PAYMENT_STATUSES) {
      assert.ok(paymentStatusLabels[status], status);
      assert.ok(paymentStatusTones[status], status);
    }
    assert.equal(paymentStatusTones.OVERDUE, "critical");
    assert.equal(paymentStatusTones.PAID, "positive");
  });

  it("reads the queue's filters out of the URL and drops what it does not know", () => {
    assert.deepEqual(bookingApprovalQueryFromParams({}), {
      product: undefined,
      partnerId: undefined,
      overdue: undefined,
      search: undefined,
      page: 1,
      pageSize: 25,
    });
    const query = bookingApprovalQueryFromParams({
      product: "TOUR",
      overdue: "true",
      search: "ana",
      page: "3",
      partnerId: "p1",
    });
    assert.equal(query.product, "TOUR");
    assert.equal(query.overdue, true);
    assert.equal(query.search, "ana");
    assert.equal(query.page, 3);
    assert.equal(query.partnerId, "p1");
    assert.equal(bookingApprovalQueryFromParams({ product: "YACHT" }).product, undefined);
    assert.equal(bookingApprovalQueryFromParams({ overdue: "yes" }).overdue, undefined);
    assert.equal(bookingApprovalQueryFromParams({ page: "-2" }).page, 1);
    assert.equal(bookingApprovalQueryFromParams({ product: ["HOTEL", "TOUR"] }).product, "HOTEL");
  });

  it("says how long a request has waited against an injected clock", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    assert.equal(timeAgo("2026-10-20T11:59:50Z", now), "just now");
    assert.equal(timeAgo("2026-10-20T11:30:00Z", now), "30 minutes ago");
    assert.equal(timeAgo("2026-10-20T09:00:00Z", now), "3 hours ago");
    assert.equal(timeAgo("2026-10-17T12:00:00Z", now), "3 days ago");
    assert.equal(timeAgo("2026-10-21T12:00:00Z", now), "just now");
  });

  it("opens the queue on bookings.approve, not on the hotel register's rule", () => {
    assert.equal(screenFor("/admin/bookings/approvals")?.pattern, "/admin/bookings/approvals");
    assert.equal(screenFor("/admin/bookings/BKG-000123")?.pattern, "/admin/bookings/[id]");
    assert.ok(canOpenPath(["bookings.approve"], "/admin/bookings/approvals"));
    assert.ok(!canOpenPath(["bookings.read"], "/admin/bookings/approvals"));
    assert.ok(!canOpenPath(["bookings.approve"], "/admin/bookings/BKG-000123"));
  });
});
