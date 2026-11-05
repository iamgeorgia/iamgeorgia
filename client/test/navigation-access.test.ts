import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { canOpenPath } from "../lib/admin/access";
import { adminGroupItems, adminNavigation, isAdminNavSection, landingFor, navigationFor } from "../lib/admin/navigation";

/**
 * What each built-in role finds in its sidebar.
 *
 * The role table is the server's, copied into the fixture by
 * `server/scripts/print-role-capabilities.js` and kept in step by a server
 * test. SUPER_ADMIN is computed on the server (every non-partner capability
 * except the two `*.execute` ones), so it is rebuilt here the same way.
 */

const ROLES = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/role-capabilities.json", import.meta.url)), "utf8"),
) as Record<string, string[]>;

const ALL_PLATFORM = [...new Set(Object.values(ROLES).flat())].filter((capability) => !capability.startsWith("partner."));
const SUPER_ADMIN = ALL_PLATFORM.filter((capability) => !capability.endsWith(".execute"));

const capsOf = (role: string): string[] => (role === "SUPER_ADMIN" ? SUPER_ADMIN : ROLES[role]);

const labelsFor = (capabilities: string[]): string[] =>
  navigationFor(capabilities).flatMap((group) => adminGroupItems(group).map((item) => item.label));

const titlesFor = (capabilities: string[]): string[] => navigationFor(capabilities).map((group) => group.title);

/** The sidebar each seeded role should see, in reading order (the plan's §3.1). */
const EXPECTED: Record<string, string[]> = {
  MANAGEMENT: [
    "Overview", "Notifications",
    "All bookings", "Hotel bookings", "Transfer bookings", "Tour bookings", "Service bookings", "Orders", "Dispatch", "Deadlines",
    "Schedule", "Ratings",
    "Partners", "Customers",
    "Finance overview", "Payables", "Receivables", "Payments", "Invoices", "Penalties", "Reports",
    "Audit log",
    "Help & tutorials",
  ],
  TOUR_OPERATOR: [
    "Overview", "Notifications",
    "Booking approvals", "All bookings", "Hotel bookings", "Transfer bookings", "Tour bookings", "Service bookings", "Orders", "Dispatch", "Deadlines",
    "Hotels", "Fleet", "Drivers", "Schedule", "Ratings", "Tours",
    "Partners", "Customers",
    "Help & tutorials",
  ],
  ACCOUNTANT: [
    "Overview", "Notifications",
    "Partners", "Customers",
    "Finance overview", "Payables", "Receivables", "Payments", "Invoices", "Approvals", "Penalties", "Reports",
    "All bookings", "Hotel bookings", "Transfer bookings", "Tour bookings", "Service bookings", "Orders", "Deadlines",
    "Audit log",
    "Help & tutorials",
  ],
  FINANCE_OPERATOR: [
    "Overview", "Notifications",
    "Finance overview", "Payables", "Receivables", "Payments", "Approvals", "Penalties",
    "All bookings", "Hotel bookings", "Transfer bookings", "Tour bookings", "Service bookings", "Orders", "Deadlines",
    "Partners", "Customers",
    "Help & tutorials",
  ],
  DISPATCHER: [
    "Overview", "Notifications",
    "Transfer bookings", "Dispatch",
    "Fleet", "Drivers", "Schedule", "Ratings",
    "Help & tutorials",
  ],
};

describe("sidebar per role", () => {
  for (const [role, expected] of Object.entries(EXPECTED)) {
    it(`gives ${role} exactly its screens, in its order`, () => {
      assert.deepEqual(labelsFor(capsOf(role)), expected);
    });
  }

  it("gives the administrators the whole operation", () => {
    const admin = labelsFor(capsOf("ADMIN"));
    for (const label of ["Destinations", "Hotels", "Routes", "Packages", "Services", "Applications", "Reports"]) {
      assert.ok(admin.includes(label), `ADMIN misses ${label}`);
    }
    assert.ok(!admin.includes("Staff") && !admin.includes("Roles"), "ADMIN does not manage staff or roles");
    assert.ok(admin.includes("Reminders"), "ADMIN sets the reminder schedule");
    const superAdmin = labelsFor(capsOf("SUPER_ADMIN"));
    assert.ok(superAdmin.includes("Staff") && superAdmin.includes("Roles") && superAdmin.includes("Reminders"));
    // Nobody below the administrators is offered the Settings group.
    for (const role of Object.keys(EXPECTED)) assert.ok(!titlesFor(capsOf(role)).includes("Settings"), `${role} is offered Settings`);
  });

  it("leads a finance desk with Finance and a desk with Operations", () => {
    assert.equal(titlesFor(capsOf("ACCOUNTANT"))[1], "Network"); // Partners: commission and credit are the accountant's
    assert.equal(titlesFor(capsOf("ACCOUNTANT"))[2], "Finance");
    assert.equal(titlesFor(capsOf("FINANCE_OPERATOR"))[1], "Finance");
    assert.equal(titlesFor(capsOf("TOUR_OPERATOR"))[1], "Operations");
  });

  it("pins the overview first and the manual last for everyone", () => {
    for (const role of [...Object.keys(EXPECTED), "ADMIN", "SUPER_ADMIN"]) {
      const titles = titlesFor(capsOf(role));
      assert.equal(titles[0], "", `${role} does not start with the overview`);
      assert.equal(titles.at(-1), "Support", `${role} does not end with Support`);
      assert.equal(landingFor(capsOf(role)), "/admin");
    }
  });

  it("never leaves an empty group, section or sub-group", () => {
    for (const role of [...Object.keys(EXPECTED), "ADMIN", "SUPER_ADMIN"]) {
      for (const group of navigationFor(capsOf(role))) {
        assert.ok(group.entries.length > 0, `${role}: empty group ${group.title}`);
        for (const entry of group.entries) {
          if (!isAdminNavSection(entry)) continue;
          assert.ok(entry.groups.length > 0, `${role}: empty section ${entry.label}`);
          for (const sub of entry.groups) assert.ok(sub.items.length > 0, `${role}: empty run ${sub.label}`);
        }
      }
    }
  });

  it("gives a custom role with no capabilities the overview and the manual only", () => {
    assert.deepEqual(labelsFor([]), ["Overview", "Help & tutorials"]);
  });

  it("gives a custom role exactly the screen its one capability opens", () => {
    assert.deepEqual(labelsFor(["catalogue.read", "invoices.read"]), ["Overview", "Invoices", "Help & tutorials"]);
    assert.deepEqual(labelsFor(["catalogue.read", "tours.write"]), ["Overview", "Tours", "Help & tutorials"]);
  });

  it("offers the notifications page beside the overview to whoever may read the bell", () => {
    assert.deepEqual(labelsFor(["notifications.read"]), ["Overview", "Notifications", "Help & tutorials"]);
    const [first] = navigationFor(["notifications.read"]);
    assert.equal(first.title, "");
    assert.deepEqual(adminGroupItems(first).map((item) => item.href), ["/admin", "/admin/notifications"]);
    assert.equal(adminGroupItems(first)[1].badgeKey, "unreadNotifications");
  });

  it("never offers a screen the screen table would refuse", () => {
    for (const role of [...Object.keys(EXPECTED), "ADMIN", "SUPER_ADMIN"]) {
      const capabilities = capsOf(role);
      for (const group of navigationFor(capabilities)) {
        for (const item of adminGroupItems(group)) {
          assert.ok(canOpenPath(capabilities, item.href), `${role} is offered ${item.href} but cannot open it`);
        }
      }
    }
  });

  it("names a capability on every item except the overview and the manual", () => {
    for (const group of adminNavigation) {
      for (const item of adminGroupItems(group)) {
        if (item.href === "/admin" || item.href === "/admin/help") continue;
        assert.ok(item.capability, `${item.href} is offered to everyone`);
      }
    }
  });
});
