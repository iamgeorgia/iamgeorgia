/** Brand-level constants. Anything shown in more than one place lives here. */

export const site = {
  name: "I'am Georgia",
  wordmark: "I'AM GEORGIA",
  tagline: "Discover Georgia Beyond the Ordinary",
  description:
    "A Georgian travel studio crafting private tours, mountain journeys, wine routes and stays across the Caucasus.",
  url: "https://iamgeorgia.travel",
  founded: 2014,
  /** Footer credit. A company name, so it stays in Latin in every language. */
  developer: "Goal Software Development",
  contact: {
    email: "hello@iamgeorgia.travel",
    phone: "+995 32 255 0140",
    whatsapp: "+995 599 12 45 80",
    address: "12 Erekle II Street, Old Tbilisi, 0105 Georgia",
    hours: "Mon–Sat · 09:00–19:00 (GMT+4)",
  },
  social: [
    { label: "Instagram", href: "https://instagram.com" },
    { label: "Facebook", href: "https://facebook.com" },
    { label: "YouTube", href: "https://youtube.com" },
    { label: "Pinterest", href: "https://pinterest.com" },
  ],
  /**
   * Brand-level search defaults. Per-page titles and descriptions come from the
   * locale dictionaries; only what is the same in every language belongs here.
   */
  seo: {
    /**
     * Fallback Open Graph / Twitter card image, resolved against `url`.
     *
     * A 1200×630 JPEG cut from the hero photograph for this one purpose:
     * every link-preview crawler reads JPEG, and the declared dimensions
     * below are the file's real ones — a preview crops to what is declared.
     */
    image: "/images/social/default.jpg",
    imageAlt: "The Greater Caucasus above a Georgian valley at first light",
    /** 1200×630 is the card size both Facebook and X crop to. */
    imageWidth: 1200,
    imageHeight: 630,
    /** Legal entity name for `Organization`, which wants the registered one. */
    legalName: "I am Georgia LLC",
    /** ISO 3166 pieces of `contact.address`, for `PostalAddress`. */
    addressLocality: "Tbilisi",
    addressCountry: "GE",
    postalCode: "0105",
    streetAddress: "12 Erekle II Street, Old Tbilisi",
  },
} as const;
