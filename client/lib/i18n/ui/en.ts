/**
 * English UI dictionary — the source of truth for the shape of every other
 * language. `UiDictionary` is derived from this object, so adding a key here
 * makes TypeScript demand it in ka, ru and he before the build will pass.
 *
 * Editorial content that belongs to an *entity* (a tour, hotel, destination,
 * experience, transfer offer or pick-up point) is not here — it lives in
 * `data/i18n/`, keyed by entity id, and is merged over the English record at
 * read time. Everything in this file is chrome, page copy, or vocabulary that
 * exists once for the whole site.
 *
 * Countable nouns are `PluralForms` rather than plain strings: Russian needs
 * three forms where English needs two, and a `${count} ${noun}s` template
 * cannot express that. See `plural()` in ../plural.ts.
 */

import type { PluralForms } from "../plural";

/** Every countable noun the UI renders with a number in front of it. */
export type UnitKey =
  | "traveller"
  | "guest"
  | "night"
  | "day"
  | "room"
  | "property"
  | "journey"
  | "experience"
  | "transfer"
  | "passenger"
  | "adult"
  | "child"
  | "largeBag"
  | "cabinBag"
  | "bag"
  | "review"
  | "result"
  | "seat";

const englishUnits: Record<UnitKey, PluralForms> = {
  traveller: { one: "traveller", other: "travellers" },
  guest: { one: "guest", other: "guests" },
  night: { one: "night", other: "nights" },
  day: { one: "day", other: "days" },
  room: { one: "room", other: "rooms" },
  property: { one: "property", other: "properties" },
  journey: { one: "journey", other: "journeys" },
  experience: { one: "experience", other: "experiences" },
  transfer: { one: "transfer", other: "transfers" },
  passenger: { one: "passenger", other: "passengers" },
  adult: { one: "adult", other: "adults" },
  child: { one: "child", other: "children" },
  largeBag: { one: "large bag", other: "large bags" },
  cabinBag: { one: "cabin bag", other: "cabin bags" },
  bag: { one: "bag", other: "bags" },
  review: { one: "review", other: "reviews" },
  result: { one: "result", other: "results" },
  seat: { one: "seat", other: "seats" },
};

export const en = {
  meta: {
    tagline: "Discover Georgia Beyond the Ordinary",
    description:
      "A Georgian travel studio crafting private tours, mountain journeys, wine routes and stays across the Caucasus.",
  },

  nav: {
    tours: "Tours",
    packages: "Packages",
    destinations: "Destinations",
    hotels: "Hotels",
    transfers: "Transfers",
    experiences: "Experiences",
    about: "About",
    contact: "Contact",
    planTrip: "Plan a trip",
    privacy: "Privacy policy",
    terms: "Terms of service",
    cookies: "Cookie policy",
    descriptions: {
      tours: "Multi-day journeys across the Caucasus",
      packages: "Stay, transfer and tour, booked as one",
      destinations: "Regions, cities and mountain valleys",
      hotels: "Stays we have slept in ourselves",
      transfers: "Private cars and shared shuttles",
      experiences: "Wine, food, craft and adventure",
      about: "The studio behind the journeys",
    },
    /**
     * The way into the two staff surfaces, shown in the site header.
     *
     * Which of the three labels appears depends on who is signed in, so all
     * three are needed in every language — a partner must never be offered
     * "Admin panel", and a signed-out visitor must be offered a way in rather
     * than a door that redirects.
     */
    account: {
      portal: "Partner portal",
      admin: "Admin panel",
      signIn: "Partner login",
      description: "Bookings, listings and your account",
    },
    groups: {
      explore: "Explore",
      company: "Company",
      legal: "Legal",
      follow: "Follow",
    },
  },

  actions: {
    planYourTrip: "Plan your trip",
    exploreTours: "Explore tours",
    browseDestinations: "Browse destinations",
    browseHotels: "Browse hotels",
    allTours: "All tours",
    allHotels: "All hotels",
    allExperiences: "All experiences",
    allDestinations: "All destinations",
    learnMore: "Learn more",
    viewDetails: "View details",
    viewHotel: "View hotel",
    reserve: "Reserve",
    request: "Request",
    sendEnquiry: "Send enquiry",
    sendAnother: "Send another",
    browseTours: "Browse tours",
    exploreExperiences: "Explore experiences",
    clearFilters: "Clear filters",
    clearSearch: "Clear search",
    search: "Search",
    share: "Share",
    save: "Save",
    saved: "Saved",
    subscribe: "Subscribe",
    backHome: "Back to home",
    seeAll: "See all",
    cancel: "Cancel",
    close: "Close",
    done: "Done",
    tryAgain: "Try again",
    select: "Select",
    change: "Change",
    clearAll: "Clear all",
    filters: "Filters",
    sortBy: "Sort by",
    askQuestion: "Ask a question",
    talkToPlanner: "Talk to a trip planner",
    planCustomTrip: "Plan a custom trip",
    askUs: "Ask us",
    askUsToFindOne: "Ask us to find one",
    continue: "Continue",
  },

  common: {
    /** The Google place search on the checkout forms. */
    placeSearch: {
      placeholder: "Search for an address or place…",
      typeMore: "Keep typing — three letters or more.",
      searching: "Searching…",
      noResults: "No places match “{term}”.",
      failed: "Place search is not answering. Try again in a moment.",
      loading: "Loading place search…",
      unavailable: "Place search is not available on this site.",
      pickSuggestion: "Choose a suggestion to set the location.",
      clear: "Clear",
      poweredBy: "Powered by Google",
    },
    home: "Home",
    from: "From",
    total: "Total",
    any: "Any",
    all: "All",
    everything: "Everything",
    flexible: "Flexible",
    included: "Included",
    perPerson: "per person",
    perNight: "per night",
    perNightShort: "/ night",
    approx: "Approx. {value}",
    /**
     * Duration abbreviations, appended straight to the number by
     * `formatDuration` — "5h 35m". A language that sets its abbreviation off
     * from the digits (Russian: 5 ч) carries the space in the string itself.
     */
    hourShort: "h",
    minuteShort: "m",
  },

  /**
   * Countable nouns. `plural(locale, count, forms)` picks the right variant
   * through `Intl.PluralRules`, so Russian gets турист / туриста / туристов
   * from the same call site that gets traveller / travellers in English.
   *
   * Typed through `UnitKey` rather than inferred: inference would freeze each
   * entry at the two forms English happens to need, and Russian would then be
   * unable to declare `few` and `many`.
   */
  units: englishUnits,

  a11y: {
    breadcrumb: "Breadcrumb",
    primaryNav: "Primary",
    mobileNav: "Mobile",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    closeDialog: "Close dialog",
    closeGallery: "Close gallery",
    previousImage: "Previous image",
    nextImage: "Next image",
    changeLanguage: "Change language",
    skipToContent: "Skip to content",
    scroll: "Scroll",
    ratedOutOf: "Rated {value} out of 5",
    fromReviews: "from {count} reviews",
    starProperty: "{count}-star property",
    to: "to",
    fewer: "Fewer {item}",
    more: "More {item}",
    removeTraveller: "Remove a traveller",
    addTraveller: "Add a traveller",
    removeGuest: "Remove a guest",
    addGuest: "Add a guest",
    maximumPrice: "Maximum price",
    maximumNightlyPrice: "Maximum nightly price",
    filterByRegion: "Filter by region",
    sortTours: "Sort tours",
    propertySections: "Property sections",
  },

  home: {
    hero: {
      eyebrow: "Georgia · The Caucasus",
      title: "Discover Georgia beyond the ordinary",
      body: "Mountain journeys, eight-thousand-year-old vineyards and a table that never empties — planned by the people who grew up here.",
      imageAlt: "A glacial lake below the peaks of the Greater Caucasus",
    },
    statement: {
      eyebrow: "Who we are",
      title:
        "A country the size of Ireland, with three climate zones, a language nobody else speaks and the oldest wine on earth.",
      body: "I'am Georgia is a travel studio in Tbilisi. We design private journeys for people who would rather understand a place than photograph it — and we do it with guides, drivers and winemakers we have known for years.",
    },
    destinations: {
      eyebrow: "Where to go",
      title: "Regions worth the drive",
      description:
        "Eight places that between them cover glaciers, vineyards, the Black Sea and a capital that resists description.",
    },
    tours: {
      eyebrow: "Signature journeys",
      title: "Tours we would go on ourselves",
      description:
        "Small groups, local guides and itineraries with enough room in them to change your mind.",
    },
    culture: {
      eyebrow: "The Georgian table",
      title:
        "Guests are a gift from God. They will remind you of this while refilling your glass.",
      body1:
        "A supra is not a dinner. It is a form, with a toastmaster, a sequence and rules about when you may drink and when you must simply listen. The first toast is always to peace. The last is always to the people who are no longer at the table.",
      body2:
        "Somewhere in the middle, three-part polyphonic singing starts — a tradition older than the Georgian alphabet, and one that UNESCO added to its heritage list in 2001. Nobody performs it at you. They simply expect you to join in badly.",
      quote: "We do not have a word for stranger that does not also mean guest.",
      quoteAttribution: "Nino Kvaratskhelia — our lead guide in Kakheti",
      storyImageAlt: "Morning light over the highland village of Upper Omalo in Tusheti",
      strip: {
        khachapuri: "Adjarian khachapuri fresh from the oven",
        wine: "A glass of amber Georgian qvevri wine",
        dance: "Traditional Georgian dance in costume",
        craft: "Georgian cloisonné enamel work",
      },
    },
    hotels: {
      eyebrow: "Where to stay",
      title: "Properties we have slept in",
      description: "Every hotel here has been visited, and none of them pay to be listed.",
    },
    experiences: {
      eyebrow: "Things to do",
      title: "Half a day that changes the trip",
      description:
        "Short, specific experiences run by people who do this for a living rather than for visitors.",
    },
    why: {
      eyebrow: "Why travel with us",
      title: "A small studio, deliberately",
      body: "We run fewer journeys than we could, because the alternative is doing them less well.",
      reasons: [
        {
          title: "We live here",
          description:
            "The studio is in Tbilisi and the guides are Georgian. When a road closes over the Cross Pass, we know before the news does.",
        },
        {
          title: "Nothing is commissioned",
          description:
            "No hotel, winery or restaurant pays to appear in an itinerary. If we recommend it, it is because we go there.",
        },
        {
          title: "Small by design",
          description:
            "Groups cap at eight, and most journeys run private. Villages in Svaneti and Tusheti are not built for coaches.",
        },
        {
          title: "Planned around you",
          description:
            "Every itinerary starts as a conversation. Tell us you would rather walk than drive and the whole shape changes.",
        },
      ],
    },
    journal: {
      eyebrow: "Journal",
      title: "Before you book anything",
      description:
        "Notes from the studio on timing, routes and the things worth arguing about.",
      items: [
        {
          tag: "Planning",
          title: "When to visit Georgia",
          excerpt:
            "Why late September is the best fortnight of the year, and the two weeks in August to avoid.",
          alt: "Tbilisi at sunset",
        },
        {
          tag: "Regions",
          title: "The Svaneti question",
          excerpt:
            "Fly or drive? Four days or seven? What the guidebooks understate about getting behind the ridge.",
          alt: "The Svaneti ridge under cloud",
        },
        {
          tag: "Wine",
          title: "A short course in qvevri",
          excerpt:
            "Amber wine, buried clay and eight thousand years of doing it the difficult way.",
          alt: "Sunset over the Black Sea coast",
        },
      ],
    },
    cta: {
      eyebrow: "Start the conversation",
      title: "Tell us what kind of traveller you are. We'll do the rest.",
      body: "Every journey begins with a short call and a lot of questions. There is no cost to planning, and no obligation to book.",
    },
  },

  footer: {
    dispatches: "Dispatches",
    newsletterBody:
      "Occasional notes on where to go in Georgia, and when. No more than once a month.",
    emailPlaceholder: "your@email.com",
    newsletterThanks: "Thank you — we'll be in touch.",
    newsletterError: "Please enter a valid email address.",
    rights: "© {year} {name}. All rights reserved.",
    credit: "Designed and developed by {name}",
  },

  /** Studio contact details. Addresses and opening hours are read, not parsed. */
  studio: {
    address: "12 Erekle II Street, Old Tbilisi, 0105 Georgia",
    hours: "Mon–Sat · 09:00–19:00 (GMT+4)",
    credentials: [
      { value: "Live", label: "Real availability, confirmed instantly" },
      { value: "Local", label: "Hotels, guides and drivers based in Georgia" },
      { value: "4 languages", label: "English, Georgian, Russian and Hebrew" },
      { value: "Clear terms", label: "Cancellation rules shown before you book" },
    ],
  },

  tours: {
    metaTitle: "Tours",
    metaDescription:
      "Multi-day journeys and day trips across Georgia — mountain treks in Kazbegi and Svaneti, wine routes through Kakheti and cave cities in the south.",
    heroEyebrow: "Journeys",
    heroTitle: "Tours across Georgia and the Caucasus",
    heroDescription:
      "Ten routes we run ourselves, from a single day in Tbilisi to six days behind the main ridge.",
    heroImageAlt: "The granite towers of the Chaukhi massif above Juta",
    spotlightEyebrow: "Journey of the season",
    spotlightTitle: "Three days beneath Mount Kazbek",
    spotlightDescription: "Our most requested trek, and the one our guides argue over leading.",
    overview: "Overview",
    about: "About this journey",
    itinerary: "Itinerary",
    included: "What's included",
    excluded: "Not included",
    importantInfo: "Important information",
    meetingPoint: "Meeting point",
    highlights: "Highlights",
    day: "Day {n}",
    mealsIncluded: "Meals included",
    overnight: "Overnight",
    meals: "Meals",
    /** Rendered from the `MealKey`s an itinerary day carries. */
    mealNames: {
      breakfast: "Breakfast",
      lunch: "Lunch",
      dinner: "Dinner",
    },
    /** Accordion label for a day trip, which has no "Day 2" to number. */
    itineraryLabel: "Itinerary",
    accommodation: "Accommodation",
    difficulty: "Difficulty",
    duration: "Duration",
    groupSize: "Group size",
    region: "Region",
    from: "From",
    perPerson: "per person",
    relatedEyebrow: "You may also like",
    relatedTitle: "Related journeys",
    planThisTour: "Plan this tour",
    notFound: "Tour not found",
    searchLabel: "Search tours",
    searchPlaceholder: "Search by name, region or interest",
    filterType: "Type",
    filterLength: "Length",
    allRegions: "All regions",
    matchingFilters: "matching your filters",
    emptyTitle: "No journeys match that combination",
    emptyBody:
      "Try widening the length or region — or tell us what you had in mind and we will build it.",
    sort: {
      recommended: "Our recommendations",
      priceLow: "Price (lowest first)",
      priceHigh: "Price (highest first)",
      duration: "Duration (shortest first)",
    },
    perGroup: "per group",
    optionKinds: {
      SHARED: "Shared departure",
      PRIVATE: "Private",
    },
    search: {
      date: "Departure date",
      travellers: "Travellers",
      adults: "Adults",
      children: "Children",
      childAge: "Child {number}",
      submit: "See departures",
      update: "Update",
      datesRequired: "Choose a date to see live prices and every departure that runs.",
      done: "Done",
      minAge: "Minimum age {age}",
    },
    results: {
      heading: "{count} departing",
      subheading: "{date} · {party}",
      emptyTitle: "Nothing departs that day",
      emptyBody:
        "No journey runs on that date for your party. Shared departures often run on set weekdays — try a nearby date.",
      browseCatalogue: "Browse all tours",
      viewDepartures: "See departures",
      cheapestFrom: "from {price}",
    },
    availability: {
      heading: "Departures",
      windowFor: "Departures {from} – {to} for {party}",
      noDatesTitle: "Pick a date",
      noDatesBody:
        "Prices and seats are live. Choose a departure date and we will show every option that runs in the two weeks after it.",
      emptyTitle: "Nothing runs in that window",
      emptyBody:
        "No departure fits your party between those dates. Try another date, or a smaller party for a shared departure.",
      seatsLeft: "{count} left",
      lastSeat: "Last seat",
      groupsLeft: "{count} available",
      perPerson: "{price} per person",
      wholeGroup: "for the whole group",
      totalFor: "Total for {party}",
      showBreakdown: "Price breakdown",
      hideBreakdown: "Hide breakdown",
      reserve: "Reserve",
      holding: "Holding your seats…",
      instant: "Instant confirmation",
      onRequest: "Confirmed by the operator within 48 hours",
      startsAt: "Starts {time}",
      freeUntil: "Free cancellation until {date}",
      nonRefundable: "Non-refundable",
      languages: "Guided in {languages}",
      lines: {
        ADULT: "Adult",
        CHILD: "Child",
        INFANT: "Infant",
        GROUP: "Group",
      },
      reasons: {
        SOLD_OUT: "Sold out",
        PARTY_SIZE: "Party size",
        TOO_SOON: "Too late to book",
        BEYOND_HORIZON: "Not on sale yet",
        PAST: "Departed",
        UNPRICED: "Not priced",
      },
      reasonHints: {
        SOLD_OUT: "No seats left on this departure.",
        PARTY_SIZE: "This option takes {min} to {max} travellers.",
        TOO_SOON: "Book at least {hours} hours before departure.",
        BEYOND_HORIZON: "Bookable up to {date}.",
        PAST: "This date has passed.",
        UNPRICED: "No price has been set for this date.",
      },
    },
    checkout: {
      metaTitle: "Checkout",
      title: "Confirm your journey",
      crumb: "Checkout",
      steps: {
        choose: "Choose a departure",
        details: "Your details",
        confirm: "Confirmed",
      },
      heldNotice: "These seats are held for you",
      expiredTitle: "Your hold has expired",
      expiredBody:
        "Seats are only held for a few minutes so they are not kept from other travellers. Nothing was booked and nothing was charged — pick the departure again and it will be held afresh.",
      backToTour: "Back to the tour",
      leadTraveller: "Lead traveller",
      leadTravellerHint: "Whoever the guide will ask for at the meeting point.",
      otherTravellers: "Other travellers",
      otherTravellersHint:
        "Optional now. Multi-day journeys need every name before departure, so adding them saves a call later.",
      travellerNumber: "Traveller {number}",
      addTraveller: "Add a traveller",
      removeTraveller: "Remove traveller {number}",
      passport: "Passport number (optional)",
      nationality: "Nationality (optional)",
      nationalityHint: "Two-letter country code, e.g. GE, IL, US.",
      dietary: "Dietary needs (optional)",
      pickupNote: "Pick-up note",
      pickupNoteHint:
        "Where to collect you if the option includes pick-up — a hotel name and address is ideal.",
      specialRequests: "Anything the operator should know",
      specialRequestsHint:
        "Mobility, a birthday on the road, a photographer in the group. Passed on, never guaranteed.",
      terms:
        "By confirming you accept the cancellation terms shown. Payment is settled with the operator, not on this site.",
      onRequestNotice:
        "This departure is confirmed by the operator. Your seats are held now; you will hear within 48 hours, and nothing is charged if it cannot run.",
      confirm: "Confirm booking",
      request: "Send request",
      confirming: "Confirming…",
      summary: "Your journey",
      departure: "Departure",
      option: "Option",
      travellers: "Travellers",
      total: "Total",
      noHoldTitle: "Nothing to check out",
      noHoldBody:
        "This page needs a departure held against it. Choose a date and an option on a tour, and you will land back here.",
      findTour: "Find a tour",
      partialDraft:
        "We could not recover the full details of your hold in this tab, but it is still valid and your booking will be confirmed correctly.",
    },
    confirmation: {
      metaTitle: "Booking confirmed",
      title: "You are booked",
      requestedTitle: "Request sent",
      subtitle: "{tour} departs on {date}.",
      requestedSubtitle: "The operator will confirm {tour} for {date} within 48 hours.",
      emailedTo: "A confirmation is on its way to {email}.",
      referenceHint: "Quote this to the guide. Keep it with your travel documents.",
      whatNext: "What happens now",
      whatNextSteps: {
        one: "The operator has your booking and your travellers' names.",
        two: "Be at the meeting point a little before the start time.",
        three: "You can review or cancel from your booking page, under the terms shown.",
      },
      requestedSteps: {
        one: "The operator checks the guide and the vehicle for your date.",
        two: "You will get an email within 48 hours saying yes or no.",
        three: "Until then the request can be cancelled at no charge.",
      },
      manageBooking: "View or cancel this booking",
      notFoundTitle: "We cannot find that booking",
      notFoundBody:
        "The reference or the email does not match anything we hold. Check both — the reference is on your confirmation email.",
    },
    manage: {
      reference: "Booking reference",
      bookedOn: "Booked {date}",
      tour: "Journey",
      departure: "Departure",
      ends: "Ends",
      option: "Option",
      meetingPoint: "Meeting point",
      meetingTime: "Meet at {time}",
      travellers: "Travellers",
      leadTraveller: "Lead traveller",
      pickupNote: "Pick-up",
      specialRequests: "Your requests",
      noRequests: "None",
      priceTitle: "What you booked",
      cancellationTerms: "Cancellation terms",
      freeUntil: "Free until {date}",
      thenCharge: "From {date}: {amount}",
      nonRefundable: "Non-refundable",
      total: "Total",
      cancellationCharge: "Cancellation charge",
      cancelledOn: "Cancelled {date}",
      awaiting: "The operator has until {date} to confirm this departure.",
      declined: "The operator could not run this departure: {reason}",
    },
    cancel: {
      irreversible: "Cancelling releases the seats immediately and cannot be undone.",
      doneBody: "The seats have been released and the operator has been told.",
      pendingFree: "A request the operator has not yet confirmed is cancelled at no charge.",
    },
    status: {
      PENDING: "Awaiting confirmation",
      CONFIRMED: "Confirmed",
      CANCELLED: "Cancelled",
      COMPLETED: "Completed",
      NO_SHOW: "No show",
    },
    categories: {
      adventure: "Adventure",
      culture: "Culture",
      wine: "Wine",
      nature: "Nature",
      city: "City",
    },
    difficulties: {
      Easy: "Easy",
      Moderate: "Moderate",
      Challenging: "Challenging",
    },
    durations: {
      "1": "Day trip",
      "2-3": "2–3 days",
      "4-6": "4–6 days",
      "7": "7+ days",
    },
  },

  packages: {
    metaTitle: "Packages",
    metaDescription:
      "Stay, transfers and tours arranged as one trip and booked in a single confirmation — including kosher packages with supervised hotels and Shabbat-aware timings.",
    heroEyebrow: "Ready-made trips",
    heroTitle: "Whole trips, booked at once",
    heroDescription:
      "A hotel, the transfers either end and the journeys in between — priced together, confirmed together, and yours to adjust before you book.",
    heroImageAlt: "A minibus on the Georgian Military Highway beneath the Caucasus",
    notFound: "Package not found",
    crumb: "Packages",

    // --- listing ---
    searchLabel: "Search packages",
    searchPlaceholder: "Search by name or region",
    filterLength: "Length",
    filterKosher: "Kosher",
    kosherOnly: "Kosher packages only",
    allRegions: "All regions",
    matchingFilters: "matching your filters",
    emptyTitle: "No packages match that combination",
    emptyBody: "Try a different length or region — or ask us to build the trip you had in mind.",
    nights: "{count} nights",
    componentCount: "{count} parts",
    from: "From",
    perTrip: "for the trip",
    priceIndicative: "Indicative. Choose your dates for a real price.",
    viewPackage: "View package",
    durations: {
      "2-3": "2\u20133 nights",
      "4-6": "4\u20136 nights",
      "7": "7+ nights",
    },

    // --- detail ---
    overview: "Overview",
    whatsIncluded: "What the trip includes",
    itinerary: "Day by day",
    day: "Day {n}",
    arrivalDay: "Arrival day",
    optional: "Optional",
    required: "Included",
    gallery: "Gallery",
    validFor: "Travel between {from} and {until}",
    partyRules: "For {min} adults or more",
    partyRulesMax: "For {min}\u2013{max} travellers",

    // --- search form ---
    search: {
      startDate: "Start date",
      travellers: "Travellers",
      adults: "Adults",
      children: "Children",
      rooms: "Rooms",
      childAge: "Child {number}",
      childAgeUnit: "years old",
      addChild: "Add a child",
      removeChild: "Remove child {number}",
      ageHint: "A child's age decides how they are priced and where they sleep.",
      submit: "Price this trip",
      update: "Update",
      edit: "Change dates",
      pastDate: "The start date cannot be in the past.",
      datesRequired: "Choose a start date to see the real price for your party.",
      done: "Done",
    },

    // --- the quote ---
    quote: {
      heading: "Your trip",
      pricedFor: "{dates} \u00b7 {party}",
      choose: "Choose",
      change: "Change",
      changing: "Repricing\u2026",
      alternatives: "Other options",
      cheapest: "Cheapest",
      selected: "Selected",
      include: "Add to the trip",
      remove: "Remove from the trip",
      requiredHint: "Part of the package and cannot be removed.",
      onRequest: "Confirmed by the operator",
      onRequestHint: "Held now, answered within 48 hours, charged only if it can run.",
      nightsAt: "{count} nights at {hotel}",
      board: "Board",
      roomFor: "{room} for {party}",
      freeUntil: "Free cancellation until {date}",
      payAtProperty: "{amount} payable at the property",
      pickupAt: "Pick-up {time}",
      departsAt: "Departs {time}",
      forParty: "for {count} travellers",
      perGroup: "for the group",
      quantity: "{count} \u00d7",
      componentsTotal: "Parts",
      discount: "Package discount",
      supplement: "Package supplement",
      total: "Total",
      totalHint: "For the whole party. Settled with us, not on this page.",
      margin: "Margin",
      net: "Net",
      reserve: "Reserve this trip",
      holding: "Holding your rooms and seats\u2026",
      selectDates: "Choose dates",
      unavailableTitle: "Not available for those dates",
      unavailable: {
        COMPONENT_UNAVAILABLE:
          "One of the parts of this package cannot be booked for that date and party. The details are beside each part below.",
        ADJUSTMENT_BELOW_COST:
          "We cannot price this package for those dates. Try a different start date, and tell us if it keeps happening.",
        KOSHER_INELIGIBLE:
          "This package cannot meet its kosher requirements for those dates. The reasons are listed below.",
      },
      slotReasons: {
        EXCLUDED: "You removed this from the trip.",
        UNAVAILABLE: "Not available for these dates.",
        ROUTE_CLOSED: "We are not driving that route that day.",
        SOLD_OUT: "Fully booked on that date.",
        PARTY_SIZE: "Not available for a party this size.",
        TOO_SOON: "Too close to the date to arrange.",
        BEYOND_HORIZON: "Too far ahead to book yet.",
        PAST: "That date has passed.",
        UNPRICED: "Not on sale for that date.",
        QUANTITY: "Not available in that quantity.",
        NOT_FOUND: "No longer offered.",
        INACTIVE: "Not on sale at the moment.",
        CURRENCY: "Priced in another currency.",
      },
    },

    // --- kosher ---
    kosher: {
      title: "Kosher arrangements",
      badge: "Kosher package",
      serviceLevel: "Hotel standard",
      certified: "Certified kitchen required",
      certifiedNo: "Certification not required",
      scopes: "Certification covers",
      mealPlans: "Board must include",
      supervision: "Supervision",
      shabbat: "Shabbat",
      shabbatSolar: "Candle lighting and Havdalah from local sunset, {before} minutes before and {after} after.",
      shabbatFixed: "Fixed hours: {start} to {end}.",
      shabbatNone: "No Shabbat restrictions on this package.",
      noTransfers: "No transfers during Shabbat.",
      noTours: "No tours on Shabbat or a festival.",
      restDays: "Additional rest days",
      requestsAttached: "These are requested from the hotel with your booking: {items}",
      blockersTitle: "This trip cannot be arranged as a kosher package",
      warningsTitle: "Worth knowing",
      overridden: "Approved by our team despite the notes below.",
    },
  },

  orders: {
    // --- checkout ---
    checkout: {
      metaTitle: "Checkout",
      title: "Confirm your trip",
      crumb: "Checkout",
      steps: {
        choose: "Build the trip",
        details: "Your details",
        confirm: "Confirmed",
      },
      heldNotice: "The rooms and seats are held for you",
      expiredTitle: "Your hold has expired",
      expiredBody:
        "Rooms and seats are only held for a few minutes so they are not kept from other travellers. Nothing was booked and nothing was charged \u2014 price the trip again and it will be held afresh.",
      backToPackage: "Back to the package",
      leadGuest: "Lead traveller",
      leadGuestHint: "Whoever the hotel and the guides will ask for.",
      travellers: "Other travellers",
      travellersHint:
        "Optional now, and useful later: the names save a call before departure.",
      travellerNumber: "Traveller {number}",
      addTraveller: "Add a traveller",
      removeTraveller: "Remove traveller {number}",
      flightNumber: "Flight number (optional)",
      flightNumberHint: "So the driver can follow the flight if it moves.",
      pickupAddress: "Pick-up address (optional)",
      pickupPlace: "Exact pick-up address (optional)",
      pickupPlaceHint: "Search for the hotel or building where the driver should collect you.",
      specialRequests: "Anything we should know",
      specialRequestsHint:
        "Mobility, a birthday on the road, an early arrival. Passed to everyone involved, never guaranteed.",
      terms:
        "By confirming you accept the cancellation terms shown for each part. Payment is settled with us, not on this page.",
      onRequestNotice:
        "Part of this trip is confirmed by the operator: {items}. The rest is booked outright, and you will hear about these within 48 hours. Nothing is charged for a part that cannot run.",
      confirm: "Confirm the trip",
      request: "Confirm and request",
      confirming: "Booking your trip\u2026",
      summary: "Your trip",
      noDraftTitle: "Nothing to check out",
      noDraftBody:
        "This page needs a priced trip behind it. Choose a package and your dates, and you will land back here.",
      findPackage: "Browse packages",
      partialDraft:
        "We could not recover the full details in this tab, but the offer is still valid and your trip will be booked correctly.",
    },

    // --- confirmation ---
    confirmation: {
      metaTitle: "Trip confirmed",
      title: "Your trip is booked",
      requestedTitle: "Your trip is requested",
      subtitle: "{package}, {dates}.",
      requestedSubtitle: "{package} starts on {date}. Part of it is with the operator.",
      emailedTo: "A confirmation is on its way to {email}.",
      referenceHint: "One reference for the trip; each part has its own beneath it.",
      whatNext: "What happens now",
      whatNextSteps: {
        one: "Every part is booked and holds its own reference.",
        two: "Take the references with you: the hotel, the driver and the guides each use their own.",
        three: "You can review or cancel from your trip page, under the terms shown.",
      },
      requestedSteps: {
        one: "The parts booked outright are confirmed and will not change.",
        two: "The operator answers the rest within 48 hours, and you will get an email either way.",
        three: "Until then the whole trip can be cancelled at no charge.",
      },
      manageOrder: "View or cancel this trip",
      notFoundTitle: "We cannot find that trip",
      notFoundBody:
        "The reference or the email does not match anything we hold. Check both \u2014 the reference is on your confirmation email.",
    },

    // --- the trip itself ---
    manage: {
      reference: "Trip reference",
      bookedOn: "Booked {date}",
      package: "Package",
      dates: "Dates",
      party: "Party",
      leadGuest: "Lead traveller",
      specialRequests: "Your requests",
      noRequests: "None",
      parts: "The parts of this trip",
      partReference: "Reference",
      priceTitle: "What you booked",
      partsTotal: "Parts",
      discount: "Package discount",
      supplement: "Package supplement",
      total: "Total",
      cancellationCharge: "Cancellation charge",
      cancelledOn: "Cancelled {date}",
      awaiting: "The operator has until {date} to answer {items}.",
      awaitingShort: "{count} awaiting the operator",
      declinedPart: "The operator could not provide this: {reason}",
      viewBooking: "Open this booking",
    },

    // --- cancelling ---
    cancel: {
      title: "Cancel this trip",
      itemTitle: "Remove {label}",
      quote: "What cancelling costs",
      refund: "Refunded",
      charge: "Charged",
      clawback: "Package discount forfeited",
      clawbackHint:
        "The discount was given for booking the trip whole, so the share carried by this part is not refunded.",
      free: "Nothing is charged.",
      reason: "Reason (optional)",
      confirm: "Cancel the whole trip",
      confirmItem: "Remove this part",
      cancelling: "Cancelling\u2026",
      keep: "Keep the trip",
      irreversible: "Cancelling releases the rooms and seats immediately and cannot be undone.",
      doneTitle: "Trip cancelled",
      doneBody: "Every part has been released and everyone involved has been told.",
      itemDoneTitle: "Part removed",
      itemDoneBody: "The rest of the trip stands, and the total has been adjusted.",
      alreadyCancelled: "This trip was already cancelled.",
      requiredPart: "This part cannot be removed on its own",
      requiredPartHint:
        "The package is priced as a whole, so its core parts go together. Cancel the whole trip, or ask us and we will look at it.",
      pendingFree: "A part the operator has not yet confirmed is cancelled at no charge.",
    },

    // --- statuses ---
    status: {
      PENDING_CONFIRMATION: "Awaiting confirmation",
      CONFIRMED: "Confirmed",
      PARTIALLY_CANCELLED: "Partly cancelled",
      CANCELLED: "Cancelled",
      COMPLETED: "Completed",
    },
    itemStatus: {
      REQUESTED: "Awaiting the operator",
      CONFIRMED: "Confirmed",
      DECLINED: "Not available",
      CANCELLED: "Cancelled",
      COMPLETED: "Completed",
      NO_SHOW: "No show",
    },
    componentTypes: {
      HOTEL_STAY: "Stay",
      TRANSFER: "Transfer",
      TOUR: "Tour",
      SERVICE: "Service",
    },

    // --- errors the checkout has to render ---
    errors: {
      generic: "Something went wrong. Nothing was booked \u2014 please try again.",
      priceChangedTitle: "The price has moved",
      priceChangedBody:
        "One or more parts of this trip are no longer the price you were quoted. Nothing was booked. Price the trip again to see the new total.",
      priceChangedRow: "{label}: was {was}, now {now}",
      unavailableTitle: "Part of the trip has gone",
      unavailableBody:
        "These parts can no longer be booked for your dates. Nothing was booked and nothing was charged.",
      kosherTitle: "The kosher requirements cannot be met",
      kosherBody:
        "Something changed since this trip was priced. Price it again to see the current position.",
      holdExpired: "Your hold ran out. Price the trip again and we will hold it afresh.",
      packageChanged: "This package has been changed since you priced it. Price it again to continue.",
      notOnSale: "This package is not on sale for those dates.",
      notFound: "We could not find that.",
      partOfOrder: "This booking is part of a trip and can only be changed from the trip itself.",
      requeryTrip: "Price the trip again",
    },

    nav: {
      manage: "Your trip",
    },
  },

  hotels: {
    metaTitle: "Hotels",
    metaDescription:
      "Boutique houses, mountain lodges, wine estates and seafront resorts across Georgia — every property visited by our team.",
    heroEyebrow: "Where to stay",
    heroTitle: "Places we would book for ourselves",
    heroDescription:
      "Nine properties across Georgia. No paid placements, no properties we have not slept in.",
    heroImageAlt: "The lit entrance of a boutique property at dusk",
    overview: "Overview",
    about: "About this property",
    amenities: "Amenities",
    facilities: "Facilities",
    staffSpeaks: "Staff speaks",
    location: "Location",
    rooms: "Rooms",
    reviews: "Reviews",
    guestReviews: "Guest reviews",
    policies: "Policies",
    whatsNearby: "What's nearby",
    guestScore: "Guest score",
    reviewsCount: "{count} reviews",
    stayed: "Stayed {date}",
    fromPerNight: "From {price} per night",
    perNight: "per night",
    perNightInclTaxes: "per night, incl. taxes",
    selectRoom: "Select room",
    seeRooms: "See rooms",
    roomTypesAvailable: "{count} room types available. Rates are indicative and include taxes.",
    breakfastIncluded: "Breakfast included",
    breakfastSupplement: "Breakfast available for a supplement",
    maxGuests: "Sleeps {count}",
    guestsCount: "{count} guests",
    roomSize: "{size} m²",
    checkIn: "Check-in",
    checkOut: "Check-out",
    cancellation: "Cancellation",
    children: "Children",
    childrenAndBeds: "Children & beds",
    pets: "Pets",
    payment: "Payment",
    houseRules: "House rules",
    mapPlaceholder: "A map view is not available for this property. Use the address above for directions.",
    relatedEyebrow: "Other properties",
    relatedTitle: "You might also consider",
    notFound: "Property not found",
    searchDestination: "Destination",
    searchAnywhere: "Anywhere in Georgia",
    guestsAndRooms: "Guests & rooms",
    guestsLabel: "Guests",
    roomsLabel: "Rooms",
    inDestination: "in {name}",
    emptyTitle: "No properties match those filters",
    emptyBody:
      "Try widening the budget or removing a facility — we only list nine properties, and every one of them is worth a look.",
    showProperties: "Show {count}",
    filters: {
      propertyType: "Property type",
      guestScore: "Guest score",
      nightlyBudget: "Nightly budget",
      facilities: "Facilities",
      upTo: "Up to",
      anyScore: "Any score",
      veryGood: "Very good · 8+",
      exceptional: "Exceptional · 9+",
      destination: "Destination",
      starRating: "Star rating",
      anyStars: "Any rating",
      starsPlus: "{count}+ stars",
      starsFive: "5 stars",
      showAll: "Show all {count}",
      showFewer: "Show fewer",
    },
    sort: {
      recommended: "Our recommendations",
      priceLow: "Price (lowest first)",
      priceHigh: "Price (highest first)",
      rating: "Guest rating",
    },
    booking: {
      serviceCharge: "Service charge",
      notChargedNow: "You will not be charged now.",
      confirmStay: "Confirm your stay",
      rowProperty: "Property",
      rowRoom: "Room",
      rowNights: "Nights",
      rowGuests: "Guests",
      rowBeds: "Beds",
      rowMaxGuests: "Maximum guests",
      rowCancellation: "Cancellation",
      reserveRoom: "Reserve this room",
      requestRoom: "Request this room",
    },
    propertyTypes: {
      Hotel: "Hotel",
      Boutique: "Boutique",
      Resort: "Resort",
      Guesthouse: "Guesthouse",
      Lodge: "Lodge",
    },
    amenityLabels: {
      wifi: "Free Wi-Fi",
      breakfast: "Breakfast included",
      pool: "Swimming pool",
      parking: "Parking",
      freeParking: "Free parking",
      restaurant: "Restaurant",
      spa: "Spa & wellness",
      airConditioning: "Air conditioning",
      gym: "Fitness centre",
      bar: "Bar & lounge",
      petFriendly: "Pet friendly",
      familyRooms: "Family rooms",
      airportShuttle: "Airport shuttle",
      terrace: "Terrace",
      roomService: "Room service",
    },
    /**
     * Kosher.
     *
     * Every label here is keyed on an enum value or a facility code, never on
     * text stored in the database. `hotels.kosher.features.shabbatElevator` is
     * the label; the row holds `shabbatElevator`, so a property entered by an
     * English-speaking admin reads in Hebrew for the agency that books it.
     *
     * The three badge strings are not interchangeable, and picking between them
     * is the whole point: "certified" is only ever rendered from the server's
     * derived `certified` flag, which needs a verified, unexpired,
     * property-scoped certificate. A hotel with every kosher facility ticked and
     * no certificate reads "Kosher services · not certified".
     */
    kosher: {
      title: "Kosher",
      navLabel: "Kosher",
      badgeCertified: "Kosher certified",
      badgeUncertified: "Kosher services · not certified",
      badgeExpired: "Kosher services · certification expired",
      badgePending: "Kosher services · certification under review",
      certification: "Certification",
      certifiedBy: "Certification: {authority}",
      scopeLabel: "Scope",
      validUntil: "Valid until",
      noExpiry: "No expiry",
      issuedOn: "Issued",
      reference: "Certificate number",
      verifiedOn: "Verified by our team on {date}",
      expiringSoon: "Expires in {count} days",
      expiredOn: "Expired {date}",
      viewCertificate: "View certificate",
      certificateTradeOnly: "Sign in as a partner to view the certificate.",
      selfDeclared:
        "Facilities below are stated by the property. Only the certification above has been checked by our team.",
      contact: "Kosher enquiries",
      notesHeading: "In the property's words",
      filterHeading: "Kosher",
      filterAnyKosher: "Kosher services",
      filterCertified: "Kosher certified",
      serviceLevel: {
        NONE: "Not kosher",
        ON_REQUEST: "Kosher meals on request",
        KOSHER_FRIENDLY: "Kosher-friendly",
        PARTIAL: "Partly kosher",
        FULL: "Fully kosher",
      },
      scopes: {
        PROPERTY: "Whole property",
        KITCHEN: "Kitchen",
        RESTAURANT: "Restaurant only",
        PASSOVER: "Passover only",
      },
      states: {
        NONE: "No certificate",
        UNVERIFIED: "Not yet checked",
        PENDING_VERIFICATION: "Under review",
        VERIFIED: "Verified",
        EXPIRED: "Expired",
        REJECTED: "Rejected",
        ARCHIVED: "Archived",
      },
      groups: {
        KosherFood: "Food & dining",
        Shabbat: "Shabbat",
        Religious: "Religious facilities",
      },
      features: {
        kosherRestaurant: "Kosher restaurant",
        kosherKitchen: "Kosher kitchen",
        kosherBreakfast: "Kosher breakfast",
        kosherLunch: "Kosher lunch",
        kosherDinner: "Kosher dinner",
        separateMeatDairy: "Separate meat and dairy preparation",
        kosherMealOnRequest: "Kosher meal on request",
        passoverKosher: "Kosher for Passover",
        kosherWine: "Kosher wine",
        shabbatElevator: "Shabbat elevator",
        shabbatMeals: "Shabbat meals",
        manualRoomKeys: "Physical room keys",
        shabbatLighting: "Shabbat room lighting",
        shabbatHotPlate: "Shabbat hot plate",
        shabbatLateCheckout: "Late Saturday checkout",
        synagogueOnSite: "Synagogue on property",
        synagogueNearby: "Synagogue nearby",
        prayerRoom: "Prayer room",
        minyanDaily: "Daily minyan",
        mikvehOnSite: "Mikveh on property",
        mikvehNearby: "Mikveh nearby",
        eruv: "Within an eruv",
      },
      walkingMinutes: "{count} min walk",
    },
    scoreLabels: {
      exceptional: "Exceptional",
      excellent: "Excellent",
      veryGood: "Very good",
      good: "Good",
      pleasant: "Pleasant",
    },
  },

  destinations: {
    metaTitle: "Destinations",
    metaDescription:
      "Tbilisi, Kazbegi, Svaneti, Kakheti, Batumi, Mtskheta, Borjomi and Gudauri — the regions of Georgia worth building a journey around.",
    heroEyebrow: "Where to go",
    heroTitle: "Eight regions, three climates, one small country",
    heroDescription:
      "From the Black Sea to a 5,000-metre ridge is a five-hour drive. Here is how to choose.",
    heroImageAlt: "Stone defence towers of Ushguli beneath Mount Shkhara",
    moreEyebrow: "Also worth your time",
    moreTitle: "Four more places to build a trip around",
    moreDescription: "Shorter stops, and the regions that reward a second visit to Georgia.",
    aboutTitle: "About {name}",
    attractionsTitle: "Attractions in {name}",
    attractionsEyebrow: "What to see",
    galleryEyebrow: "Gallery",
    galleryTitle: "{name} in pictures",
    idealFor: "Ideal for",
    travelInfo: "Travel information",
    bestTime: "Best time to visit",
    gettingThere: "Getting there",
    gettingAround: "Getting around",
    language: "Language",
    toursHere: "Tours in {name}",
    hotelsHere: "Where to stay in {name}",
    experiencesHere: "Experiences in {name}",
    keepExploring: "Keep exploring",
    otherRegions: "Other regions of Georgia",
    heroImageAltNamed: "{name}, Georgia",
    notFound: "Destination not found",
  },

  experiences: {
    metaTitle: "Experiences",
    metaDescription:
      "Qvevri wine tastings, khinkali classes, sulphur baths, polyphonic singing and paragliding over the Caucasus — short experiences across Georgia.",
    heroEyebrow: "Things to do",
    heroTitle: "The half-days people remember longest",
    heroDescription:
      "Wine, food, craft, mountains and music — run by people who do this for a living, not for visitors.",
    heroImageAlt: "A Georgian supra table laid with dishes",
    theExperience: "The experience",
    whatToExpect: "What to expect",
    included: "What's included",
    highlights: "Highlights",
    duration: "Duration",
    groupSize: "Group size",
    location: "Location",
    from: "From",
    perPerson: "per person",
    pricePerPerson: "{price} pp",
    bookThis: "Request this experience",
    preferredDate: "Preferred date",
    guests: "Guests",
    noPayment: "No payment is taken at this stage.",
    relatedEyebrow: "More to do",
    relatedTitle: "Other experiences",
    emptyTitle: "Nothing in that category yet",
    emptyBody:
      "We add experiences as we find ones worth recommending. Tell us what you are after in the meantime.",
    showEverything: "Show everything",
    notFound: "Experience not found",
    rowExperience: "Experience",
    rowLocation: "Location",
    rowDuration: "Duration",
    rowDate: "Preferred date",
    rowGuests: "Guests",
    categories: {
      wine: "Wine",
      food: "Food",
      adventure: "Adventure",
      culture: "Culture",
      wellness: "Wellness",
      craft: "Craft",
    },
  },

  transfers: {
    rating: {
      title: "How was your transfer?",
      intro: "A minute to rate your driver helps us keep the good drivers busy. Your rating is anonymous to the driver.",
      scoreLabel: "Score out of 5",
      commentPlaceholder: "Anything to add? Comments are read by our team before they appear.",
      submit: "Send rating",
      thanks: "Thank you — your rating has been recorded.",
      expired: "This rating link has expired.",
      already: "This transfer has already been rated.",
    },
    metaTitle: "Transfers",
    metaDescription:
      "Private cars, minivans and shared shuttles between Georgian airports, cities and hotels — booked in advance, with a named driver and a fixed price.",

    hero: {
      eyebrow: "Getting around",
      title: "Private transfers across Georgia",
      description:
        "Airports, cities and mountain villages. A named driver and a fixed price, agreed before you travel.",
      imageAlt: "The Georgian Military Road climbing towards the Cross Pass",
    },

    intro: {
      eyebrow: "Booked ahead",
      title: "Why arrange it before you land",
      description:
        "Tbilisi arrivals peak between midnight and four in the morning. The kerbside price at that hour is not the price you would have been quoted at noon.",
    },

    trust: [
      {
        title: "Checked providers",
        body: "Every operator listed here holds a Georgian passenger licence and insurance we have seen.",
      },
      {
        title: "Named driver",
        body: "You get the driver's name, photo and vehicle registration the evening before pick-up.",
      },
      {
        title: "Free cancellation",
        body: "Most transfers can be cancelled up to 24 hours before pick-up at no cost.",
      },
      {
        title: "Someone to call",
        body: "A Tbilisi number answered around the clock while you are travelling with us.",
      },
    ],

    routes: {
      eyebrow: "Popular routes",
      title: "The journeys we drive most",
      description:
        "From prices, for the most affordable vehicle on each route. Tolls, parking and waiting time are included.",
      metaTitle: "{from} to {to} transfer",
      metaDescription:
        "Private and shared transfers from {from} to {to} — about {distance} km by road, with a fixed price and a driver who tracks your flight.",
      stopsTitle: "Where this journey stops",
      stopMinutes: "{count} minutes",
      seePrices: "See prices for your dates",
      priceNote:
        "The price shown is for the cheapest vehicle on this route. Search your dates for every class and the exact total.",
    },

    fleet: {
      eyebrow: "The fleet",
      title: "Choose the vehicle, not the surprise",
      description:
        "Every class states exactly how many people and bags it takes. You book the class; the exact car is confirmed the evening before with the driver's name.",
      upTo: "Up to {count}",
    },

    how: {
      title: "How a transfer works",
      body: "Four steps, and the only one that happens on the day is getting in the car.",
      steps: [
        {
          title: "Tell us the journey",
          body: "Pick-up, destination, date, time and how many of you are travelling with how much luggage.",
        },
        {
          title: "Choose a vehicle",
          body: "Every class that can carry your party, priced for your exact route. No estimates that change later.",
        },
        {
          title: "Confirm the details",
          body: "Lead passenger, a phone number, and your flight if you are arriving. Nothing is charged at this stage.",
        },
        {
          title: "Meet your driver",
          body: "You get the driver's name, photo and registration the evening before. At an airport they meet you in arrivals with a name board.",
        },
      ],
      disclaimer:
        "The fare you see is the fare you pay: it is fixed when you book, and your reference is confirmed by email. No card is needed — you settle with the driver, in cash or by card, on the day.",
    },

    search: {
      formLabel: "Transfer search",
      typeLegend: "Transfer type",
      oneWay: "One way",
      return: "Return",
      pickUp: "Pick-up",
      dropOff: "Drop-off",
      pickUpPlaceholder: "Airport, city or hotel",
      dropOffPlaceholder: "Where are you going?",
      swap: "Swap pick-up and drop-off",
      date: "Date",
      time: "Pick-up time",
      returnDate: "Return date",
      returnTime: "Return pick-up time",
      passengersLuggage: "Passengers & luggage",
      submit: "Search transfers",
      update: "Update search",
      errorSummary: "{count} details still need your attention.",
    },

    errors: {
      from: "Choose where we should collect you.",
      to: "Choose where you are going.",
      samePlace: "Pick-up and drop-off cannot be the same place.",
      date: "Choose a travel date.",
      time: "Choose a pick-up time.",
      returnDate: "Choose a return date.",
      returnBeforeOutbound: "The return cannot be before the outbound journey.",
      returnTime: "Choose a return pick-up time.",
      noAdults: "At least one adult must travel.",
      tooManyPassengers: "For parties over 40, talk to us directly.",
    },

    locationPicker: {
      searchPlaceholder: "Airport, city, hotel or address",
      searchLabel: "Search {field} locations",
      noResults: "Nothing matches “{query}”. Try a city, or the airport code.",
      note: "Pick-up points come from our transfer network — airports, cities, resorts and landmarks across Georgia. If your exact spot is not listed, choose the nearest one and add the address at checkout.",
      groups: {
        airport: "Airports",
        city: "Cities & towns",
        resort: "Resorts",
        landmark: "Popular destinations",
        station: "Stations",
        hotel: "Hotels",
      },
    },

    passengers: {
      adults: "Adults",
      adultsHint: "12 and over",
      children: "Children",
      childrenHint: "Child seats free on request",
      luggage: "Large bags",
      luggageHint: "Checked suitcases",
      cabinBags: "Cabin bags",
      cabinBagsHint: "Carried on your lap or at your feet",
    },

    steps: {
      navLabel: "Booking progress",
      completed: "completed",
      search: "Search",
      choose: "Choose a vehicle",
      details: "Your details",
      confirmed: "Confirmed",
    },

    vehicleClasses: {
      sedan: "Sedan",
      suv: "SUV",
      minivan: "Minivan",
      van: "Van",
      bus: "Bus",
    },

    features: {
      airConditioning: "Air conditioning",
      wifi: "Wi-Fi on board",
      childSeat: "Child seat available",
      englishDriver: "English-speaking driver",
      meetGreet: "Meet & greet",
      flightTracking: "Flight tracking",
      bottledWater: "Bottled water",
      freeWaiting: "Free waiting time",
      wheelchairAccessible: "Wheelchair accessible",
    },

    kinds: {
      private: "Private",
      shared: "Shared",
      privateTransfer: "Private transfer",
      sharedTransfer: "Shared transfer",
    },

    filters: {
      vehicleType: "Vehicle type",
      passengerCapacity: "Passenger capacity",
      transferType: "Transfer type",
      price: "Price",
      upTo: "Up to",
      features: "Features",
      providerRating: "Provider rating",
      anyRating: "Any rating",
      outstanding: "4.5+ · Outstanding",
      veryGood: "4.0+ · Very good",
    },

    sort: {
      recommended: "Our recommendations",
      priceLow: "Price (lowest first)",
      rating: "Provider rating",
      duration: "Fastest transfer",
    },

    results: {
      metaTitle: "Available transfers",
      metaDescription: "Compare private cars, minivans and shared shuttles for your journey.",
      title: "Available transfers",
      searching: "Searching for available vehicles…",
      closedTitle: "That road is closed for those dates",
      closedBody:
        "Mountain roads in Georgia close for snow and repairs. Try a different date, or a route that does not cross the pass.",
      unavailable: {
        TOO_SOON:
          "That pick-up is sooner than we can arrange a car. Choose a time at least three hours from now.",
        BEYOND_HORIZON: "That date is further ahead than we take bookings for. Try a nearer date.",
        RETURN_BEFORE_OUTBOUND: "The return pick-up is before the outbound one.",
        PARTY_TOO_LARGE:
          "That is a larger group than we quote online. Get in touch and we will arrange a coach.",
        SAME_POINT: "The pick-up and drop-off are the same place.",
      },
      availableFor: "available for your journey",
      show: "Show {count}",
      noJourneyTitle: "Tell us where you're going",
      noJourneyBody:
        "Choose a pick-up point and a destination and we'll price every vehicle that can make the journey.",
      emptyTitle: "No transfers found",
      emptyCapacity:
        "No vehicle on this route can take that many passengers and bags. Reduce the party size, or ask us to arrange a convoy.",
      emptyFilters:
        "Nothing matches those filters. Widen the budget or drop a requirement and the options will come back.",
      changeSearch: "Change search",
    },

    card: {
      selected: "Selected transfer",
      upToPassengers: "Up to {count}",
      verified: "Verified",
      fromPerPerson: "From, per person",
      forYourParty: "{price} for your party",
      bothJourneys: "both journeys",
      allTaxes: "all taxes and tolls",
    },

    journeyBar: {
      pickUpFallback: "Pick-up",
      dropOffFallback: "Drop-off",
      returnLabel: "Return",
      changeSearch: "Change search",
      close: "Close",
    },

    gallery: {
      pickUp: "Pick-up: {name}",
      destination: "Destination: {name}",
    },

    detail: {
      metaTitle: "{name} — transfer",
      notFound: "Transfer not found",
      titleRoute: "{kind} transfer — {from} to {to}",
      titleFallback: "{name} — {kind} transfer",
      kindPrivate: "Private",
      kindShared: "Shared",
      kindPrivateLower: "private",
      kindSharedLower: "shared",
      yearsOperating: "{count} years operating in Georgia",
      keyInformation: "Key information",
      pickUp: "Pick-up",
      destination: "Destination",
      journeyTime: "Journey time",
      distance: "Distance",
      vehicle: "Vehicle",
      passengers: "Passengers",
      luggage: "Luggage",
      notSelected: "Not selected",
      kmByRoad: "{count} km by road",
      upToTravelling: "Up to {max} · {count} travelling",
      upTo: "Up to {max}",
      luggageValue: "{large} large bags · {cabin} cabin bags",
      about: "About this transfer",
      onBoard: "On board",
      included: "What's included",
      excluded: "Not included",
      howPickupWorks: "How pick-up works",
      beforeTheDay: "Before the day",
      beforeTheDayBody:
        "The evening before travel you receive the driver's name, photograph, mobile number and vehicle registration. If your plans change, reply to that message — the driver reads it, not a call centre.",
      cancellation: "Cancellation",
      cancellationNote:
        "Cancellation terms are set by {provider} and confirmed in writing when the transfer is booked.",
      backToResults: "Back to results",
      noPaymentStep: "No payment is taken at this step.",
      priceThis: "Price this transfer",
      priceThisBody:
        "Fares depend on the route, so tell us where you are travelling between and we will price this vehicle for your journey.",
      startSearch: "Start a search",
    },

    summary: {
      route: "Route",
      pickUp: "Pick-up",
      returnPickUp: "Return pick-up",
      journeyTime: "Journey time",
      passengers: "Passengers",
      luggage: "Luggage",
      perJourney: "{name}, per journey",
      perPersonLine: "{price} × {passengers}",
      returnJourney: "Return journey",
      tollsTaxes: "Tolls, taxes and parking",
      transferSummary: "Transfer summary",
      yourTransfer: "Your transfer",
    },

    booking: {
      metaTitle: "Your transfer details",
      title: "Your transfer details",
      intro:
        "One more step. Tell us who is travelling and how to reach you, and we will hold this vehicle while the provider confirms.",
      breadcrumb: "Your details",
      leadPassenger: "Lead passenger",
      leadPassengerBody:
        "The driver contacts this person, and the confirmation goes to this address.",
      firstName: "First name",
      lastName: "Last name",
      email: "Email",
      mobile: "Mobile number",
      mobileHint: "Include the country code — the driver may need to call on the day.",
      phonePlaceholder: "+995 599 12 45 80",
      required: "(required)",
      pickUpSection: "Pick-up",
      pickUpLocation: "Pick-up location",
      dateAndTime: "Date and time",
      dropOffLocation: "Drop-off location",
      changeNote: "To change any of these, go back to the results page and update your search.",
      flightNumber: "Flight number",
      flightPlaceholder: "e.g. A9 604",
      flightHint: "Optional, but it is how we track a delay and hold the driver for you.",
      pickupNote: "Exact address or meeting note",
      pickupNotePlaceholder: "Hotel name, street number, or where to wait",
      pickupPlace: "Exact pick-up address",
      pickupPlaceHint: "Search for the hotel, building or terminal where the driver should find you, if it is not the location above.",
      dropoffPlace: "Exact drop-off address",
      dropoffPlaceHint: "Where the journey should end, if it is a specific door rather than the location above.",
      requests: "Special requests",
      requestsBody:
        "Child seats, extra stops, oversized luggage, a wheelchair — tell us and we will confirm before the day.",
      requestsPlaceholder: "Anything the driver should know in advance…",
      paymentNote:
        "No card is needed. We confirm the booking now and you settle with the driver, in cash or by card, on the day.",
      errorOne: "One detail still needs your attention.",
      errorMany: "{count} details still need your attention.",
      submit: "Continue to confirmation",
      submitting: "Confirming your transfer…",
      priceChanged:
        "The fare for this journey changed while you were filling this in. Go back to the results for the current price.",
      quoteExpired:
        "This quote has expired. Search again and the current fares will come back.",
      submitFailed: "We could not confirm the booking. Please try again in a moment.",
      back: "Back to transfer details",
      noTransferTitle: "No transfer chosen yet",
      noTransferBody:
        "Pick a vehicle from the results and we will bring your journey through to this step.",
      searchTransfers: "Search transfers",
      // Choosing the driver: shown to partners only.
      driverSection: "Choose your driver",
      driverBody: "As a partner you can ask for a particular driver. They are offered the job first and asked to confirm; if they cannot take it, our dispatch team assigns another.",
      driverAny: "Let us assign a driver",
      driverAnyBody: "Dispatch picks the best available driver for this journey.",
      driverLoading: "Checking who is available…",
      driverNone: "No driver is free for this journey yet. Dispatch will assign one after you book.",
      driverLoadFailed: "We could not load the available drivers. You can still book and let us assign one.",
      driverVerified: "Verified",
      driverRatings: "{avg} · {count} ratings",
      driverNoRatings: "No ratings yet",
      driverTransfers: "{count} transfers driven",
      driverExperience: "{count} years driving",
      driverSpeaks: "Speaks {languages}",
      driverCarCapacity: "{passengers} passengers · {luggage} bags",
      driverChooseCar: "Which car",
      driverPhotos: "Photos of the car",
      driverUnavailable: "That driver is no longer free for this journey. Choose another, or let us assign one.",
      driverNotEligible: "That driver cannot take this journey. Choose another, or let us assign one.",
      driverRequested: "Requested driver",
      driverAwaiting: "Waiting for the driver to confirm. We will let you know as soon as they do.",
      driverConfirmed: "Your driver has confirmed.",
      errors: {
        firstName: "Please give the lead passenger's first name.",
        lastName: "Please give the lead passenger's last name.",
        email: "Please enter a valid email address.",
        phone: "The driver needs a number they can reach you on.",
      },
    },

    confirmation: {
      metaTitle: "Transfer request received",
      title: "Transfer request received",
      thanks: "Thank you, {name}. ",
      body: "Your transfer details have been saved. {provider} confirms the driver within a few hours, and you will have their name and vehicle registration the evening before you travel.",
      reference: "Booking reference",
      copy: "Copy reference",
      copied: "Copied",
      copiedAnnounce: "Booking reference copied to clipboard",
      cancelled: "Cancelled",
      leadPassenger: "Lead passenger",
      name: "Name",
      email: "Email",
      mobile: "Mobile",
      flight: "Flight",
      pickupNote: "Pick-up note",
      specialRequests: "Special requests",
      whatNext: "What happens next",
      nextSteps: [
        "The provider confirms the vehicle and assigns a driver.",
        "The evening before, you get the driver's name, photo, mobile number and registration.",
        "On the day, meet as described in the pick-up instructions. Payment is arranged with the provider.",
      ],
      ifChanges: "If anything changes",
      ifChangesBody: "Quote your reference and we will move or cancel the transfer.",
      viewDetails: "View transfer details",
      backHome: "Back to homepage",
      nothingTitle: "Nothing to confirm",
      nothingBody:
        "This confirmation link has expired or is incomplete. Start a new search and we will take you through again.",
    },

    error: {
      title: "Something went wrong finding your transfer",
      body: "The search did not come back. Nothing has been booked and nothing has been charged — try again, or start a fresh search.",
      reference: "Reference: {digest}",
      newSearch: "Start a new search",
    },
  },

  about: {
    metaTitle: "About",
    metaDescription:
      "I'am Georgia is a Georgian travel platform for booking hotels, tours, transfers and packages from local partners — in four languages, with real availability and clear cancellation terms.",
    heroEyebrow: "About the platform",
    heroTitle: "A Georgian travel platform, built with local partners",
    heroDescription:
      "Hotels, tours, transfers and packages across Georgia — with real availability, clear prices and cancellation terms you can read before you book.",
    heroImageAlt: "A Georgian church standing on mountain pasture",
    introEyebrow: "What this is",
    introTitle: "One place to book a trip to Georgia, from the people who run it.",
    introBody1:
      "I'am Georgia brings together stays, tours, transfers and combined packages from local partners — hotels, guesthouses, tour operators and transfer companies working in Georgia. You book here; they host you.",
    introBody2:
      "The site works in English, Georgian, Russian and Hebrew, and every price you see is one that can actually be booked: rooms come with live availability, departures with real seats, and transfer fares are fixed the moment you confirm.",
    howEyebrow: "How booking works",
    howTitle: "Choose, confirm, pay on the spot",
    howBody1:
      "Pick a stay, tour or transfer for your dates and party. What we show is what the supplier can sell for those exact dates — not a brochure.",
    howBody2:
      "Confirm with the lead traveller's details and you receive a reference by email. Some tours are sold on request, in which case we say plainly that the operator still has to accept.",
    howBody3:
      "There is no online payment. You settle with the property, operator or driver directly, on the terms shown at checkout, and the cancellation policy you agreed to is the one that applies.",
    howImageAlt: "Fog lying across the hills of the Khada gorge",
    valuesEyebrow: "What we hold to",
    valuesTitle: "Four things you can expect",
    values: [
      {
        title: "Local partners",
        description:
          "Every stay, tour and transfer on this site is provided by a partner based in Georgia. The money you spend goes to the people doing the work.",
      },
      {
        title: "Real availability",
        description:
          "Dated searches return only what can be sold for those dates. We would rather show fewer results than rooms nobody can book.",
      },
      {
        title: "Transparent terms",
        description:
          "Prices, taxes and cancellation policies are shown before you confirm and repeated in your confirmation email. No surprise line at the end.",
      },
      {
        title: "Kosher-aware travel",
        description:
          "Properties and packages that offer kosher catering or facilities are marked, with the certification shown, so observant travellers can plan with confidence.",
      },
    ],
    sellEyebrow: "What you can book",
    sellTitle: "Stays, tours, transfers — and the three arranged as one trip",
    sellDescription:
      "From a night in Tbilisi to a week across the Caucasus with the driver and guide already arranged, everything on this site is booked from local partners and confirmed by email.",
    sellImageAlts: [
      "Guides walking a mountain trail",
      "A shepherd moving a flock in the highlands",
      "A Georgian polyphonic ensemble",
    ],
    ctaTitle: "Ready to plan?",
    ctaBody:
      "Browse what is available for your dates, or tell us about the trip you have in mind and we will help put it together.",
    ctaPlan: "Get in touch",
    ctaBrowse: "Browse tours",
  },

  /**
   * The legal pages. `{address}`, `{email}` and `{name}` are filled from
   * `constants/site` at render time, so the registered details live in one
   * place rather than in four languages.
   */
  legal: {
    templateNote:
      "This text is a template prepared for I am Georgia LLC and is pending review by a qualified lawyer. It may change before it becomes final.",
    privacy: {
      metaTitle: "Privacy policy",
      metaDescription:
        "What personal data I am Georgia LLC collects when you book through iamgeorgia.travel, why, who it is shared with, how long it is kept and the rights you have.",
      title: "Privacy policy",
      updated: "Last updated: 14 September 2026",
      intro:
        "This policy explains what personal data {name} collects when you use this website, why we collect it, who we share it with and the rights you have over it.",
      sections: [
        {
          heading: "Who we are",
          body: [
            "{name}, {address}, is the data controller for this website. You can reach us at {email}.",
          ],
        },
        {
          heading: "What we collect",
          body: [
            "When you book, we collect the lead guest's name, email address and phone number, the details of the stay, tour, transfer or package you booked, and any requests you add — for example dietary needs, a flight number or a pick-up note. For tours that require it, we may also collect passport details and nationality.",
            "Partners, staff and drivers who sign in to the partner extranet or the driver panel give us a name, email address and password, and — for drivers — the documents needed to verify them.",
            "We keep technical logs (IP address, browser, time of request) to keep the service secure and running.",
          ],
        },
        {
          heading: "Why we use it",
          body: [
            "To make, change and cancel bookings and pass them to the supplier who fulfils them; to send you confirmation, change and cancellation emails; to answer your enquiries; to verify partners and drivers; to prevent fraud and abuse; and to meet our legal obligations.",
          ],
        },
        {
          heading: "Legal bases",
          body: [
            "We process booking data because it is necessary to arrange the contract you ask us to make. We process account, security and log data on the basis of our legitimate interest in running a safe, reliable service. Where the law requires it — tax and accounting records, for example — we process data to meet a legal obligation. Where we rely on your consent, you can withdraw it at any time.",
          ],
        },
        {
          heading: "Who we share it with",
          body: [
            "The supplier that fulfils your booking — the property, tour operator or transfer driver — receives what they need to host you: the lead guest's name and contact details, the size of the party and your requests. The provider that delivers our emails processes the messages we send you.",
            "We do not sell personal data and we do not share it with advertisers.",
          ],
        },
        {
          heading: "Payment",
          body: [
            "We take no payment online. You pay the property, operator or driver directly, so we never see or store card details.",
          ],
        },
        {
          heading: "How long we keep it",
          body: [
            "Booking records are kept for as long as needed to provide the service, and afterwards for the period Georgian tax and accounting law requires. Account data is kept while the account is active. Technical logs are kept for a short period and then deleted.",
          ],
        },
        {
          heading: "Your rights",
          body: [
            "You can ask for a copy of the data we hold about you, ask us to correct or delete it, object to or restrict certain processing, and ask for your data in a portable format. Write to {email} and we will answer within one month.",
            "If you believe we have handled your data unlawfully, you may complain to the Personal Data Protection Service of Georgia or to the supervisory authority in your own country.",
          ],
        },
        {
          heading: "International transfers",
          body: [
            "Our servers and service providers may be located outside Georgia, including in the European Union. Where your data leaves your country we rely on appropriate safeguards, such as standard contractual clauses.",
          ],
        },
        {
          heading: "Changes and contact",
          body: [
            "We may update this policy as the service changes; the date at the top tells you when. Questions about it go to {email}.",
          ],
        },
      ],
    },
    terms: {
      metaTitle: "Terms of service",
      metaDescription:
        "The terms that govern bookings made through iamgeorgia.travel: our role as agent, how a booking is formed, prices, payment, cancellations, liability and governing law.",
      title: "Terms of service",
      updated: "Last updated: 14 September 2026",
      intro:
        "These terms govern your use of this website and every booking made through it. By making a booking you agree to them.",
      sections: [
        {
          heading: "Who you are dealing with",
          body: [
            "{name} ({address}) operates this platform as an agent. The stays, tours, transfers and packages listed here are provided by independent partner suppliers — hotels, guesthouses, tour operators and transfer companies — and your contract for the service itself is with that supplier. We arrange the booking and pass it on.",
          ],
        },
        {
          heading: "How a booking is formed",
          body: [
            "A booking is confirmed when we send you a confirmation email carrying a booking reference. Until then no contract exists.",
            "Some options are sold on request. We forward your request to the supplier, who may accept or decline it; you will hear back within the period stated on the page, and a declined request costs nothing.",
          ],
        },
        {
          heading: "Prices and currency",
          body: [
            "Prices are shown in Georgian lari (GEL) unless another currency is indicated, and include applicable taxes unless stated otherwise. The price shown at the moment you confirm is the price of your booking; if a price changes while you are completing checkout we show you the new price before you commit.",
          ],
        },
        {
          heading: "Payment",
          body: [
            "We take no payment online. You pay the property, operator or driver directly, on the terms shown at checkout — on arrival, for example, or to the driver on the day. Where a supplier requires a card to guarantee a room, that arrangement is between you and the supplier.",
          ],
        },
        {
          heading: "Changes and cancellations",
          body: [
            "Each booking carries the cancellation policy shown at checkout and repeated in your confirmation email. You can change or cancel through the Manage booking page using your reference and the email address the booking was made under. Any charge that applies is the one stated in that policy.",
          ],
        },
        {
          heading: "The supplier's responsibility",
          body: [
            "The supplier is responsible for delivering the service as described — the room, the tour, the vehicle. If something is wrong on the day, tell the supplier first and then us; we will help resolve it, but we do not own or operate the accommodation, vehicles or tours.",
          ],
        },
        {
          heading: "Your responsibility",
          body: [
            "You are responsible for giving accurate details, for holding valid travel documents, and for the conduct of your party. A supplier may refuse service to anyone who is abusive or unsafe.",
          ],
        },
        {
          heading: "Our liability",
          body: [
            "To the extent permitted by law, our liability is limited to our role as agent and to the value of the booking concerned. We are not liable for the acts or omissions of suppliers, for events outside our reasonable control, or for indirect losses.",
          ],
        },
        {
          heading: "Governing law",
          body: [
            "These terms are governed by the law of Georgia. Disputes that cannot be settled by agreement fall under the jurisdiction of the courts of Georgia, without prejudice to any mandatory consumer protection you enjoy where you live.",
          ],
        },
        {
          heading: "Contact",
          body: ["Questions about these terms go to {email}."],
        },
      ],
    },
    cookies: {
      metaTitle: "Cookie policy",
      metaDescription:
        "iamgeorgia.travel sets only strictly necessary cookies — a language preference and a sign-in session for partners and drivers. No analytics, no advertising.",
      title: "Cookie policy",
      updated: "Last updated: 14 September 2026",
      intro:
        "This site uses only the cookies it needs to work. There is no analytics, advertising or tracking cookie of any kind.",
      sections: [
        {
          heading: "What a cookie is",
          body: [
            "A cookie is a small text file a website stores in your browser so it can recognise you on your next request — to remember a setting, or to keep you signed in.",
          ],
        },
        {
          heading: "Strictly necessary cookies",
          body: [
            "iag_locale — remembers the language you chose so the site opens in it next time. It is set for one year and contains nothing but the language code.",
            "Session cookie — set only when a partner, member of staff or driver signs in to the partner extranet or the driver panel. It keeps you signed in and is removed when the session ends or you sign out.",
          ],
        },
        {
          heading: "What we do not use",
          body: [
            "No analytics cookies, no advertising cookies, no social media pixels and no third-party trackers. We do not build profiles of visitors.",
          ],
        },
        {
          heading: "Browser storage",
          body: [
            "Your browser's local and session storage hold a few conveniences that never leave your device: whether you dismissed the cookie notice, and a draft of your booking while you complete checkout so that a refresh does not lose your progress. Nothing in them is sent to us.",
          ],
        },
        {
          heading: "Managing cookies",
          body: [
            "You can delete or block cookies in your browser settings. Blocking the language cookie means the site picks a language from your browser on each visit; blocking the session cookie means you cannot sign in to the partner or driver areas.",
          ],
        },
        {
          heading: "Changes",
          body: [
            "If we ever add a cookie that is not strictly necessary, we will update this page and ask for your consent before setting it.",
          ],
        },
        {
          heading: "Contact",
          body: ["Questions about cookies go to {email}."],
        },
      ],
    },
  },

  cookieNotice: {
    label: "Cookie notice",
    body: "We only use cookies that are strictly necessary to run the site.",
    link: "Cookie policy",
    dismiss: "OK",
  },

  contact: {
    metaTitle: "Contact",
    metaDescription:
      "Talk to a trip planner at I'am Georgia. Tell us how long you have and what you like, and we will send back a route.",
    eyebrow: "Plan your trip",
    title: "Tell us what kind of traveller you are",
    description:
      "Every journey starts with a few questions and no obligation. We reply within one working day, in English, Georgian, Russian or German.",
    directTitle: "Get in touch directly",
    labels: {
      email: "Email",
      telephone: "Telephone",
      whatsapp: "WhatsApp",
      studio: "Studio",
      hours: "Opening hours",
    },
    follow: "Follow",
    imageAlt: "The tiled Orbeliani bathhouse facade in old Tbilisi, near our studio",
    form: {
      name: "Your name",
      email: "Email",
      phone: "Phone",
      travellers: "Travellers",
      travelDates: "Approximate travel dates",
      whenThinking: "When are you thinking?",
      notSureYet: "Not sure yet",
      groupSize: "How many travelling",
      interests: "What interests you",
      interestsLegend: "What are you most interested in?",
      message: "Tell us about the trip",
      messageLabel: "Tell us about your trip",
      messagePlaceholder:
        "How long you have, what you like eating, whether you would rather walk or be driven…",
      required: "*",
      prototypeNote:
        "This form is part of a front-end prototype. Nothing is submitted, emailed or stored.",
      errors: {
        name: "Please tell us your name.",
        email: "Please enter a valid email address.",
        message: "A sentence or two about your trip helps us reply properly.",
      },
      successTitle: "Thank you, {name}",
      successBody:
        "In a live product your enquiry would now be with a trip planner. Here, it is the end of the prototype flow — nothing was sent or stored.",
      note: "We reply to every enquiry within one working day.",
      interestOptions: [
        "Mountains & hiking",
        "Wine & food",
        "Culture & history",
        "Skiing",
        "Black Sea",
        "Photography",
      ],
      months: [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ],
    },
  },

  filters: {
    all: "All",
    region: "Region",
    category: "Category",
    duration: "Duration",
    priceRange: "Price",
    sortBy: "Sort by",
    results: "{count} results",
    noResultsTitle: "Nothing matches those filters",
    noResultsBody: "Try widening the search, or clear the filters to start again.",
    searchTours: "Search tours",
    searchHotels: "Search hotels",
    searchExperiences: "Search experiences",
  },

  notFound: {
    metaTitle: "Page not found",
    eyebrow: "Error 404",
    title: "This road doesn't go anywhere",
    body: "Which happens more often than you would think in the Caucasus. The page you were looking for has moved, or never existed.",
    backHome: "Back to the homepage",
    askUs: "Ask us where to go",
    sections: "Site sections",
  },

  /** The site-wide error boundary — anything that throws under `(site)`. */
  error: {
    title: "Something went wrong on our side",
    body: "The page did not load as it should. Nothing has been booked and nothing has been charged — try again, or head back to the homepage.",
    reference: "Reference: {digest}",
    accountBlocked: "Your company's access has been blocked. Contact us.",
    accountTerminated: "Your company no longer has an account on the platform.",
  },

  /**
   * The booking flow — dated search, live availability, checkout, confirmation
   * and the guest's own booking page.
   *
   * Unlike the rest of this file, these strings sit in front of a real
   * transaction: a room is genuinely held, a booking is genuinely confirmed and
   * a cancellation charge is quoted from terms the guest agreed to. Wording
   * that overstates what is free, or understates what is charged, is not a
   * translation nit here — it is a dispute later.
   */
  booking: {
    requirements: {
      heading: "Religious and dietary requirements",
      hint:
        "Only what this property offers is listed. Each is passed to the hotel and confirmed separately from your rooms — your booking is secure either way.",
      none: "None requested",
      notePlaceholder: "Anything the property needs to know",
      noteLabel: "Note for {feature}",
      pending: "{count} awaiting the property",
      allConfirmed: "All requirements confirmed",
      awaitingHeading: "Awaiting the property",
      unsupported: "This property does not offer: {items}",
      status: {
        REQUESTED: "Requested",
        CONFIRMED: "Confirmed by the property",
        DECLINED: "Not available",
        WITHDRAWN: "Withdrawn",
      },
    },
    search: {
      checkIn: "Check-in",
      checkOut: "Check-out",
      guests: "Guests",
      adults: "Adults",
      children: "Children",
      rooms: "Rooms",
      childAge: "Child {number}",
      childAgeUnit: "years old",
      addChild: "Add a child",
      removeChild: "Remove child {number}",
      ageHint: "A child's age decides how they are priced and where they sleep.",
      submit: "Check availability",
      update: "Update search",
      edit: "Change search",
      invalidDates: "Check-out must be after check-in.",
      pastDate: "Check-in cannot be in the past.",
      datesRequired: "Choose your dates to see real prices and availability.",
      done: "Done",
    },
    results: {
      metaTitle: "Available stays",
      heading: "{count} available",
      subheading: "{stay} · {party}",
      emptyTitle: "Nothing free on those dates",
      emptyBody:
        "Every property is either full or does not open these dates for sale. Shifting the stay by a night usually finds something.",
      browseCatalogue: "Browse all properties",
      totalFor: "Total for {nights}",
      perNight: "{price} per night",
      refundable: "Free cancellation",
      nonRefundable: "Non-refundable",
      ratesAvailable: "{count} rates available",
      viewRooms: "View rooms",
      soldOut: "No availability",
    },
    availability: {
      heading: "Choose your room",
      ratesFor: "Live rates for {stay}",
      noDatesTitle: "Pick your dates",
      noDatesBody:
        "Rates and availability at this property are live. Choose when you are coming and we will show you exactly what can be booked.",
      emptyTitle: "Nothing available on those dates",
      emptyBody:
        "This property has no rooms open for the dates and party you asked for. Try a different date, or fewer guests per room.",
      sleeps: "Sleeps {count}",
      unitsLeft: "Only {count} left",
      lastRoom: "Last room at this rate",
      freeUntil: "Free cancellation until {date}",
      nonRefundable: "Non-refundable",
      extraBeds: "Includes {count} extra beds",
      extraGuests: "Includes {count} extra guests",
      taxesIncluded: "Taxes included",
      payAtProperty: "{amount} payable at the property",
      totalForStay: "Total for {nights}",
      showBreakdown: "Night by night",
      hideBreakdown: "Hide breakdown",
      reserve: "Reserve",
      holding: "Holding your room…",
      selectDates: "Check dates",
    },
    checkout: {
      metaTitle: "Checkout",
      title: "Confirm your stay",
      crumb: "Checkout",
      steps: {
        choose: "Choose a room",
        details: "Your details",
        confirm: "Confirmed",
      },
      heldNotice: "These rooms are held for you",
      expiresIn: "Time left: {time}",
      expiredTitle: "Your hold has expired",
      expiredBody:
        "Rooms are only held for a few minutes so they are not kept from other travellers. Nothing was booked and nothing was charged — pick the room again and it will be held afresh.",
      backToProperty: "Back to the property",
      leadGuest: "Lead guest",
      leadGuestHint: "Whoever is checking in. The property asks for this name at the desk.",
      firstName: "First name",
      lastName: "Last name",
      email: "Email",
      emailHint: "Your confirmation goes here, and it is how you reach this booking later.",
      phone: "Phone",
      phoneOptional: "Phone (optional)",
      otherGuests: "Other guests",
      otherGuestsHint:
        "Optional. Adding the names now saves the property asking for them on arrival.",
      guestNumber: "Guest {number}",
      addGuest: "Add a guest",
      removeGuest: "Remove guest {number}",
      guestType: "Type",
      adult: "Adult",
      child: "Child",
      infant: "Infant",
      age: "Age",
      specialRequests: "Anything the property should know",
      specialRequestsHint:
        "A late arrival, a quiet room, a wheelchair. Requests are passed on but never guaranteed.",
      terms:
        "By confirming you accept the cancellation terms shown above. Payment is taken by the property, not on this site.",
      confirmStay: "Confirm booking",
      confirming: "Confirming…",
      summary: "Your stay",
      room: "Room",
      rate: "Rate",
      nights: "Nights",
      total: "Total",
      taxesIncluded: "Taxes included",
      payAtProperty: "Payable at the property",
      payAtPropertyHint: "Charged by the hotel on arrival, not by us.",
      required: "Required",
      invalidEmail: "That does not look like an email address.",
      noHoldTitle: "Nothing to check out",
      noHoldBody:
        "This page needs a room held against it. Choose your dates and a room, and you will land back here.",
      findStay: "Find a stay",
      partialDraft:
        "We could not recover the full details of your hold in this tab, but it is still valid and your booking will be confirmed correctly.",
    },
    confirmation: {
      metaTitle: "Booking confirmed",
      title: "You are booked",
      subtitle: "{hotel} is expecting you on {date}.",
      reference: "Booking reference",
      referenceHint: "Quote this to the property. Keep it with your travel documents.",
      emailedTo: "A confirmation is on its way to {email}.",
      whatNext: "What happens now",
      whatNextSteps: {
        one: "The property has your booking and your requests.",
        two: "Payment is settled with the property, not with us.",
        three: "You can review or cancel from your booking page, under the terms below.",
      },
      manageBooking: "View or cancel this booking",
      print: "Print this page",
      notFoundTitle: "We cannot find that booking",
      notFoundBody:
        "The reference or the email does not match anything we hold. Check both — the reference is on your confirmation email.",
    },
    manage: {
      metaTitle: "Your booking",
      title: "Find your booking",
      description:
        "Your reference is on the confirmation email. We ask for the email too, because a reference on its own is not proof the booking is yours.",
      crumb: "Your booking",
      reference: "Booking reference",
      referencePlaceholder: "BKG-000142 or TRF-000068",
      email: "Email used to book",
      find: "Find booking",
      finding: "Looking…",
      notFoundTitle: "No booking matches that",
      notFoundBody:
        "Check the reference and the email address you booked with. If it still will not open, we can find it for you.",
      bookedOn: "Booked {date}",
      property: "Property",
      stay: "Stay",
      guestsLabel: "Guests",
      roomsLabel: "Rooms",
      leadGuest: "Lead guest",
      contact: "Contact",
      specialRequests: "Your requests",
      noRequests: "None",
      arrival: "Arrival",
      departure: "Departure",
      checkInFrom: "Check-in from {time}",
      checkOutBy: "Check-out by {time}",
      roomsTitle: "What you booked",
      mealPlan: "Board",
      cancellationTerms: "Cancellation terms",
      freeUntil: "Free until {date}",
      thenCharge: "From {date}: {amount}",
      nonRefundable: "Non-refundable",
      total: "Total",
      taxesIncluded: "Taxes included",
      payAtProperty: "Payable at the property",
      cancelledOn: "Cancelled {date}",
      cancellationCharge: "Cancellation charge",
    },
    cancel: {
      title: "Cancel this booking",
      free: "Cancelling now costs nothing.",
      charge: "Cancelling now costs {amount}.",
      refund: "You would be refunded {amount}.",
      noRefund: "There would be no refund.",
      deadline: "Free cancellation ends {date}.",
      reason: "Reason (optional)",
      reasonHint: "Not required, and it does not change the charge.",
      confirm: "Cancel booking",
      cancelling: "Cancelling…",
      keep: "Keep my booking",
      irreversible: "Cancelling releases the rooms immediately and cannot be undone.",
      doneTitle: "Booking cancelled",
      doneBody: "The rooms have been released and the property has been told.",
      alreadyCancelled: "This booking was already cancelled.",
      notCancellable: "This booking can no longer be cancelled online. Please contact us.",
    },
    window: {
      title: "We cannot sell those dates",
      tooFarAhead: "We take bookings up to {limit} days ahead. Try a nearer date.",
      inThePast: "That check-in has already passed. Choose a date from today onwards.",
      tooLong: "One booking can run to at most {limit} nights. Split the stay, or ask us to arrange it.",
    },
    status: {
      PENDING: "Pending",
      CONFIRMED: "Confirmed",
      CANCELLED: "Cancelled",
      COMPLETED: "Completed",
      NO_SHOW: "No show",
    },
    errors: {
      generic: "Something went wrong. Nothing was booked — please try again.",
      soldOut: "That room went while you were deciding. Choose another and nothing is lost.",
      holdExpired: "Your hold ran out. Pick the room again and we will hold it afresh.",
      priceChanged: "The price for this room has changed. Go back and choose again.",
      notFound: "We could not find that.",
      creditLimit: "Your company has reached its credit limit ({used} of {limit}). Settle open invoices or contact us.",
      termsOutdated: "Your company must accept the updated platform terms before booking again.",
      termsOutdatedLink: "Review the terms",
    },
    nav: {
      manage: "Your booking",
    },
  },

  share: {
    copied: "Link copied to clipboard",
    pageLink: "Page link",
    title: "Share",
    native: "Share…",
    nativeHint: "Send with an app on this device",
    copyLink: "Copy link",
  },
};

/**
 * Every other locale must satisfy this shape.
 *
 * Deliberately not `as const`: literal types would make `UiDictionary` demand
 * the *English words* from every translation rather than just the same keys.
 */
export type UiDictionary = typeof en;
