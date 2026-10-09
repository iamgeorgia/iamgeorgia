import type { HelpCategory } from "./types";

/**
 * The areas of the manual, in the order the hub lists them.
 *
 * The order follows the sidebar's own logic: the day's work first (getting
 * started, the queues, the board), then the catalogue in the order things are
 * created (a destination before the hotel inside it), then the network, then
 * the cross-cutting chapters that belong to no single screen.
 *
 * `pathPrefixes` are the fallback for a screen no article claims: the
 * contextual Help button opens the area rather than nothing. Every screen
 * *should* have an article — the registry test insists on it — so the
 * fallback is for the interval between a new screen landing and its help
 * being written.
 */
export const helpCategories: HelpCategory[] = [
  {
    id: "getting-started",
    title: "Getting started",
    summary: "What the panel is, how to sign in, what each role sees, and where things are.",
    iconName: "compass",
    roles: ["ADMIN", "DISPATCHER"],
    pathPrefixes: ["/admin"],
  },
  {
    id: "bookings",
    title: "Bookings & orders",
    summary: "The four registers — hotel, tour, transfer and package orders — and what can be done to one.",
    iconName: "calendarCheck",
    roles: ["ADMIN", "DISPATCHER"],
    pathPrefixes: ["/admin/bookings", "/admin/orders", "/admin/tours/bookings", "/admin/transfers/bookings"],
  },
  {
    id: "dispatch",
    title: "Dispatch, schedule & ratings",
    summary: "Putting a driver and a car on each leg, moving it through its day, and moderating what passengers write.",
    iconName: "radio",
    roles: ["ADMIN", "DISPATCHER"],
    pathPrefixes: ["/admin/transfers/dispatch", "/admin/transfers/schedule", "/admin/transfers/ratings"],
  },
  {
    id: "destinations",
    title: "Destinations",
    summary: "The tree of places everything else is filed inside.",
    iconName: "globe",
    roles: ["ADMIN"],
    pathPrefixes: ["/admin/destinations"],
  },
  {
    id: "hotels",
    title: "Hotels",
    summary: "From a named draft to a property on sale: rooms, rates, inventory, images, policies, location, kosher.",
    iconName: "bedDouble",
    roles: ["ADMIN"],
    pathPrefixes: ["/admin/hotels"],
  },
  {
    id: "tours",
    title: "Tours",
    summary: "Options, seasons and price tiers, departures and capacity, the itinerary, translations.",
    iconName: "map",
    roles: ["ADMIN"],
    pathPrefixes: ["/admin/tours"],
  },
  {
    id: "packages",
    title: "Packages",
    summary: "A trip assembled from hotels, transfers, tours and services, sold as one thing.",
    iconName: "boxes",
    roles: ["ADMIN"],
    pathPrefixes: ["/admin/packages"],
  },
  {
    id: "services",
    title: "Services",
    summary: "Priced extras with no inventory — a kosher meal, a guide, a mashgiach — sold inside packages.",
    iconName: "conciergeBell",
    roles: ["ADMIN"],
    pathPrefixes: ["/admin/services"],
  },
  {
    id: "transfers-catalogue",
    title: "Transfers catalogue",
    summary: "Routes and their fares, pick-up points, vehicle classes and extras — what a traveller buys.",
    iconName: "route",
    roles: ["ADMIN"],
    pathPrefixes: [
      "/admin/transfers/routes",
      "/admin/transfers/points",
      "/admin/transfers/vehicles",
      "/admin/transfers/extras",
    ],
  },
  {
    id: "fleet-drivers",
    title: "Fleet & drivers",
    summary: "The cars that turn up and the people who drive them: documents, verification, logins.",
    iconName: "car",
    roles: ["ADMIN", "DISPATCHER"],
    pathPrefixes: ["/admin/transfers/fleet", "/admin/transfers/drivers"],
  },
  {
    id: "partners",
    title: "Partners",
    summary: "Registering supplier companies and agencies, reviewing applications, suspending and reinstating.",
    iconName: "handshake",
    roles: ["ADMIN"],
    pathPrefixes: ["/admin/partners"],
  },
  {
    id: "people",
    title: "Staff & audit log",
    summary: "Giving colleagues a seat in the panel with the right role, retiring it again, and reading who did what.",
    iconName: "users",
    roles: ["ADMIN"],
    pathPrefixes: ["/admin/users", "/admin/audit"],
  },
  {
    id: "media",
    title: "Images & documents",
    summary: "What uploads are accepted, how a cover is chosen, and the difference between removing and deleting.",
    iconName: "image",
    roles: ["ADMIN", "DISPATCHER"],
    pathPrefixes: [],
  },
  {
    id: "publishing",
    title: "Publishing, statuses & the public site",
    summary: "Draft, on sale, off sale and archived; the checklists; slugs, translations and the public channel.",
    iconName: "send",
    roles: ["ADMIN"],
    pathPrefixes: [],
  },
  {
    id: "reference",
    title: "Working in the panel",
    summary: "Search and filters, common tasks, what an error means, and the actions that cannot be undone.",
    iconName: "bookOpen",
    roles: ["ADMIN", "DISPATCHER"],
    pathPrefixes: [],
  },
];

export const helpCategoryById = (id: string): HelpCategory | undefined =>
  helpCategories.find((category) => category.id === id);
