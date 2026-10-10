/**
 * Plain-English names for the server's capability strings.
 *
 * The server speaks `area.verb`; the Roles screens speak in sentences. A
 * capability the server adds that is missing here still works — it shows its
 * raw name — so this table can lag the server without breaking a screen.
 */

export interface CapabilityInfo {
  label: string;
  description: string;
}

export interface CapabilityArea {
  id: string;
  label: string;
  capabilities: Record<string, CapabilityInfo>;
}

const c = (label: string, description: string): CapabilityInfo => ({ label, description });

export const capabilityAreas: CapabilityArea[] = [
  {
    id: "catalogue",
    label: "Catalogue",
    capabilities: {
      "catalogue.read": c("Catalogue: read", "See destinations, hotels, tours, packages, services and transfers"),
      "catalogue.write": c("Catalogue: edit", "Create and edit destinations, hotels, services, transfers, fleet and media"),
      "tours.write": c("Tours: edit", "Create and edit tours, options, seasons and departures"),
      "pricing.write": c("Pricing: edit", "Change rates, price grids and pricing rules"),
    },
  },
  {
    id: "bookings",
    label: "Bookings",
    capabilities: {
      "bookings.read": c("Bookings: read", "See every booking and order"),
      "bookings.write": c("Bookings: handle", "Confirm and decline requests and change bookings"),
      "bookings.cancel": c("Bookings: cancel", "Cancel bookings and orders"),
    },
  },
  {
    id: "dispatch",
    label: "Dispatch",
    capabilities: {
      "dispatch.read": c("Dispatch: read", "See the dispatch board, schedule, fleet and drivers"),
      "dispatch.write": c("Dispatch: manage", "Assign drivers and cars, and edit fleet and drivers"),
    },
  },
  {
    id: "partners",
    label: "Partners",
    capabilities: {
      "partners.read": c("Partners: read", "See partner companies and applications"),
      "partners.write": c("Partners: manage", "Approve, edit, suspend and register partners"),
      "partners.financial.read": c("Partners: bank details", "See a partner's bank details and payment terms"),
    },
  },
  {
    id: "finance",
    label: "Finance",
    capabilities: {
      "finance.margin.read": c("Margins: read", "See net prices, markup and margin"),
      "finance.payables.read": c("Payables: read", "See what we owe suppliers"),
      "finance.receivables.read": c("Receivables: read", "See what partners owe us"),
      "finance.payments.read": c("Payments: read", "See recorded payments"),
      "finance.payments.write": c("Payments: record", "Record payments, refunds and write-offs"),
      "finance.terms.write": c("Payment terms: edit", "Change credit limits and payment terms"),
      "finance.reports.read": c("Reports: read", "Open the finance reports"),
      "finance.export": c("Exports: download", "Download finance data as files"),
      "finance.commission.write": c("Commission: edit", "Change commission rules"),
    },
  },
  {
    id: "invoices",
    label: "Invoices",
    capabilities: {
      "invoices.read": c("Invoices: read", "See invoices and proformas"),
      "invoices.write": c("Invoices: issue", "Issue, void and send invoices"),
    },
  },
  {
    id: "audit",
    label: "Audit",
    capabilities: {
      "audit.read": c("Audit log: read", "Read who did what, and when"),
    },
  },
  {
    id: "users",
    label: "Users",
    capabilities: {
      "users.staff.manage": c("Staff: manage", "Invite, change and switch off staff accounts"),
    },
  },
  {
    id: "roles",
    label: "Roles",
    capabilities: {
      "roles.manage": c("Roles: manage", "Create, edit and delete roles"),
    },
  },
  {
    id: "settings",
    label: "Settings",
    capabilities: {
      "settings.write": c("Settings: edit", "Change platform settings"),
    },
  },
  {
    id: "platform",
    label: "Platform",
    capabilities: {
      "platform.admin": c("Platform: administer", "Platform-level administration"),
    },
  },
  {
    id: "notifications",
    label: "Notifications",
    capabilities: {
      "notifications.read": c("Notifications: read", "Receive and read notifications"),
    },
  },
  {
    id: "driver",
    label: "Driver",
    capabilities: {
      "driver.panel": c("Driver panel", "Use the driver panel: own jobs, documents and profile"),
    },
  },
  {
    id: "partner",
    label: "Partner portal",
    capabilities: {
      "partner.profile.write": c("Company profile: edit", "Edit the company's profile"),
      "partner.financial.read": c("Bank details: read", "See the company's bank details"),
      "partner.financial.write": c("Bank details: edit", "Change the company's bank details"),
      "partner.team.manage": c("Team: manage", "Invite and manage the company's team"),
      "partner.bookings.read": c("Bookings: read", "See the company's bookings"),
      "partner.bookings.write": c("Bookings: make", "Make and change bookings"),
      "partner.bookings.cancel": c("Bookings: cancel", "Cancel the company's bookings"),
      "partner.inventory.write": c("Inventory: edit", "Edit the company's hotel rates and availability"),
      "partner.statement.read": c("Statement: read", "See the account statement"),
      "partner.invoices.read": c("Invoices: read", "See and download invoices"),
    },
  },
];

const lookup = new Map<string, CapabilityInfo>(
  capabilityAreas.flatMap((area) => Object.entries(area.capabilities)),
);

export const capabilityLabel = (capability: string): string => lookup.get(capability)?.label ?? capability;

export const capabilityDescription = (capability: string): string =>
  lookup.get(capability)?.description ?? "";

/** The area label for a capability name, from the part before the first dot. */
export const areaLabelOf = (capability: string): string => {
  const found = capabilityAreas.find((area) => capability in area.capabilities);
  return found ? found.label : capability.split(".")[0];
};

export interface LabelledGroup {
  area: string;
  label: string;
  capabilities: string[];
}

/**
 * Groups capability names for display, in the table's order. Names the table
 * does not know land in an "Other" group, so nothing the server grants is
 * hidden from the reader.
 */
export function groupCapabilities(capabilities: Iterable<string>): LabelledGroup[] {
  const wanted = new Set(capabilities);
  const groups: LabelledGroup[] = [];

  for (const area of capabilityAreas) {
    const names = Object.keys(area.capabilities).filter((name) => wanted.delete(name));
    if (names.length) groups.push({ area: area.id, label: area.label, capabilities: names });
  }

  if (wanted.size) groups.push({ area: "other", label: "Other", capabilities: [...wanted].sort() });
  return groups;
}
