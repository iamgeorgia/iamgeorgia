import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NOTIFICATIONS_PAGE_SIZE,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SORTS,
  hrefFor,
  isNotificationCategory,
  notificationBrowseStateFromParams,
  notificationCategoryLabel,
  notificationCategoryLabels,
  notificationHref,
  notificationQueryFor,
  notificationSortLabels,
  type AppNotification,
} from "../lib/api/notifications";
import { canOpenPath } from "../lib/admin/access";
import { adminGroupItems, adminScreenLabel, navigationFor } from "../lib/admin/navigation";

/**
 * The bell's vocabulary and link rule, kept in a plain `.ts` module so this
 * runs under Node without React: every tab has a name, the server's `href`
 * wins over the client's fallback table, and the page's URL state reads
 * back the way the browser writes it.
 */

const notice = (overrides: Partial<AppNotification> = {}): AppNotification => ({
  id: "n-1",
  kind: "BOOKING_NEW",
  category: "BOOKING",
  title: "New booking",
  body: "BKG-000001",
  payload: { bookingReference: "BKG-000001" },
  entityType: "HotelBooking",
  entityId: "hb-1",
  href: "/admin/bookings/BKG-000001",
  readAt: null,
  createdAt: "2026-10-20T08:00:00.000Z",
  ...overrides,
});

describe("notification categories", () => {
  it("names every tab and every sort", () => {
    assert.deepEqual(NOTIFICATION_CATEGORIES, ["BOOKING", "DISPATCH", "FINANCE", "APPROVAL", "DEADLINE", "SYSTEM"]);
    for (const category of NOTIFICATION_CATEGORIES) {
      assert.ok(notificationCategoryLabels[category], category);
      assert.equal(notificationCategoryLabel(category), notificationCategoryLabels[category]);
      assert.ok(isNotificationCategory(category));
    }
    assert.deepEqual(
      NOTIFICATION_CATEGORIES.map((category) => notificationCategoryLabels[category]),
      ["Bookings", "Dispatch", "Finance", "Approvals", "Deadlines", "System"],
    );
    for (const sort of NOTIFICATION_SORTS) assert.ok(notificationSortLabels[sort], sort);
  });

  it("files a category this build does not know under System rather than nowhere", () => {
    assert.equal(notificationCategoryLabel("WEATHER"), "System");
    assert.equal(notificationCategoryLabel(null), "System");
    assert.equal(isNotificationCategory("WEATHER"), false);
  });
});

describe("hrefFor", () => {
  it("takes the server's word when it gave one, including a deliberate null", () => {
    assert.equal(hrefFor("admin", notice()), "/admin/bookings/BKG-000001");
    assert.equal(hrefFor("partner", notice({ href: "/portal/bookings/BKG-000001" })), "/portal/bookings/BKG-000001");
    // A null is "only news" and must not fall through to the client table,
    // which would invent a link for a hotel booking the server declined to give.
    assert.equal(hrefFor("admin", notice({ href: null, entityType: "TourBooking" })), null);
  });

  it("falls back to the client table only for a row served without a link", () => {
    const legacy = notice({ href: undefined, entityType: "TourBooking", payload: { bookingReference: "TUR-1" } });
    assert.equal(hrefFor("admin", legacy), "/admin/tours/bookings/TUR-1");
    assert.equal(hrefFor("admin", legacy), notificationHref("admin", legacy));
    assert.equal(hrefFor("partner", legacy), "/portal/bookings/TUR-1");
    assert.equal(hrefFor("driver", notice({ href: undefined, payload: { assignmentId: "as-1" } })), "/driver/assignments/as-1");
    assert.equal(hrefFor("driver", notice({ href: undefined, payload: {} })), null);
  });
});

describe("notification browse state", () => {
  it("reads the tab, the unread switch, the sort and the page, dropping what it does not know", () => {
    assert.deepEqual(notificationBrowseStateFromParams({}), { category: undefined, unread: false, sort: "newest", page: 1 });
    assert.deepEqual(
      notificationBrowseStateFromParams({ category: "APPROVAL", unread: "true", sort: "unreadFirst", page: "3" }),
      { category: "APPROVAL", unread: true, sort: "unreadFirst", page: 3 },
    );
    assert.deepEqual(
      notificationBrowseStateFromParams({ category: "NOPE", unread: "yes", sort: "random", page: "-2" }),
      { category: undefined, unread: false, sort: "newest", page: 1 },
    );
    // A repeated parameter reads as its first value, as the registers do.
    assert.equal(notificationBrowseStateFromParams({ category: ["FINANCE", "SYSTEM"] }).category, "FINANCE");
  });

  it("asks the server for exactly the state, and nothing for the defaults", () => {
    assert.deepEqual(notificationQueryFor({ category: undefined, unread: false, sort: "newest", page: 1 }), {
      category: undefined,
      unread: undefined,
      sort: "newest",
      page: 1,
      pageSize: NOTIFICATIONS_PAGE_SIZE,
    });
    assert.deepEqual(notificationQueryFor({ category: "DEADLINE", unread: true, sort: "oldest", page: 2 }), {
      category: "DEADLINE",
      unread: "true",
      sort: "oldest",
      page: 2,
      pageSize: NOTIFICATIONS_PAGE_SIZE,
    });
  });
});

describe("the notifications screen in the panel", () => {
  it("is offered beside the overview, badged with the unread count, to whoever may read the bell", () => {
    const [overview] = navigationFor(["notifications.read"]);
    const item = adminGroupItems(overview).find((entry) => entry.href === "/admin/notifications");
    assert.ok(item, "no Notifications entry");
    assert.equal(item.label, "Notifications");
    assert.equal(item.badgeKey, "unreadNotifications");
    assert.equal(item.capability, "notifications.read");
    assert.ok(canOpenPath(["notifications.read"], "/admin/notifications"));
    assert.equal(canOpenPath([], "/admin/notifications"), false);
    assert.equal(adminScreenLabel("/admin/notifications"), "Notifications");
  });
});
