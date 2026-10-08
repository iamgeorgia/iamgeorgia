import type { HelpArticle } from "../../types";

/**
 * What a message on screen means and what to do about it. Encodes the
 * three error boundaries (`admin/error.tsx`, `(panel)/error.tsx`,
 * `(panel)/not-found.tsx`), the 403 "Insufficient permissions" split
 * between the roles, session expiry (30-day sliding, 90-day absolute,
 * revoked on password change or deactivation), the sign-in messages and
 * the 15-minute limiter, the 422 publish message, the 409 refusals
 * (destination and service delete, driver and car archive/deactivate,
 * capacity), the "could not be emailed" link fallback, the map and upload
 * failures, the 15-second timeout, and the empty candidate list and
 * override prompt in the Assign dialog.
 */
export const article = {
  id: "rf-troubleshooting",
  title: "When something goes wrong",
  summary: "The messages the panel shows when something fails, what each one means, and what to do — including when to ask the developer.",
  category: "reference",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["error", "troubleshooting", "problem", "failed", "could not", "403", "409", "422", "timeout", "signed out", "not found", "permissions", "refused"],
  related: ["gs-signing-in", "gs-roles", "rf-dangerous-actions", "dp-assigning-a-driver", "fd-driver-detail"],
  blocks: [
    {
      type: "paragraph",
      text: "The panel has no pop-up notifications. When something fails, the message appears next to the thing you were doing — under the button, in the form, or as a whole-screen notice — and it is the server's own words. Find the message below.",
    },
    {
      type: "heading",
      id: "whole-screen",
      text: "Whole-screen notices",
    },
    {
      type: "definitions",
      items: [
        {
          term: "The admin panel could not load",
          description: "The server did not answer at all. Nothing you did caused it. Press **Try again**; if it keeps happening, press **Sign in** and start afresh. The reference code under the message is for the developer.",
        },
        {
          term: "This screen could not load",
          description: "The records behind the screen did not come back. Nothing has been changed by the failure. Press **Try again**, or **Back to overview** and open the screen from the sidebar.",
        },
        {
          term: "Record not found",
          description: "Nothing in the register matches that address. Either the record was removed — a deleted partner, a deleted draft — or the link is out of date. Search for it on its register rather than trusting the old link.",
        },
        {
          term: "A page full of failed requests, or `Insufficient permissions`",
          description: "Your role cannot use that screen. A dispatcher's account reaches transfer bookings, dispatch, fleet, drivers, schedule and ratings and nothing else; typing the address of a hotel or a partner gives refused requests, not the screen. The sidebar only lists what your role can open, so use it.",
        },
      ],
    },
    {
      type: "heading",
      id: "signing-in",
      text: "Signing in and being signed out",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Signed out without asking",
          description: "A session ends after 30 days without use, and after 90 days from signing in whatever happens. It also ends at once when your password is changed or your account is deactivated. Sign in again; if you cannot, ask the developer whether the account is still active.",
        },
        {
          term: "Incorrect email address or password",
          description: "One message for every cause: an unknown address, a wrong password, an account that has never been activated, an account that has been deactivated. The panel deliberately does not say which. Check the address, then the password, then ask the developer.",
        },
        {
          term: "Too many sign-in attempts. Try again later.",
          description: "Ten failed attempts from one place for one address within fifteen minutes lock that address for the rest of the window. There is no account lockout beyond it; wait, then try once with the right password.",
        },
      ],
    },
    {
      type: "heading",
      id: "refusals",
      text: "The server refused an action",
    },
    {
      type: "definitions",
      items: [
        {
          term: "Not ready to publish: …",
          description: "The product still lacks something. The message lists every missing item; so does the Publishing panel on the hub, which is why **Publish** was disabled. Work through the list and try again.",
        },
        {
          term: "Still attached: 3 hotels, 2 destinations inside it. Move or remove them first.",
          description: "A destination cannot be deleted while anything is filed inside it — hotels, tours, child destinations. Move or remove each of them, then delete.",
        },
        {
          term: "A package still has a slot pointing at this service. Remove that slot first, then delete.",
          description: "Open the package named, take the service out of its parts and save them, then delete the service.",
        },
        {
          term: "… Archive it instead — that takes it off sale without destroying anything.",
          description: "The service, hotel or tour has bookings and cannot be deleted at all. Archive it, or take it off sale.",
        },
        {
          term: "A list of upcoming jobs when archiving a car or deactivating a driver",
          description: "The car or driver still has jobs ahead of them, listed as reference and time. Either reassign each of those legs first on the dispatch board, or — for a driver — tick **Send any upcoming jobs back to dispatch**, which withdraws every one of them and returns the legs to **Needs a driver**.",
        },
        {
          term: "The dates named when reducing capacity",
          description: "A tour departure's seats cannot be cut below what is already booked. The message names the dates that would be overbooked; leave those dates out of the range or cancel the bookings first.",
        },
        {
          term: "The link could not be emailed to … — send it yourself.",
          description: "The driver's login (or the partner's registration link) was created, but the email failed. Copy the link from the panel with **Copy link** and send it by another route. Issuing a new link stops the old one working.",
        },
        {
          term: "A request that gave up after about fifteen seconds",
          description: "The panel stops waiting for the server after 15 seconds and reports a connection problem. The action may or may not have gone through. Reload the record and look before repeating it, especially a cancellation or an assignment.",
        },
      ],
    },
    {
      type: "heading",
      id: "maps-uploads",
      text: "Maps and uploads",
    },
    {
      type: "definitions",
      items: [
        {
          term: "The map could not be loaded. Reload the page to try again.",
          description: "The Google Maps script did not arrive, or the key was refused for this address. The fields under **Enter coordinates by hand** still work, so you can type the coordinates and save; reload to get the map and the search back. If it persists on a new host, the host is missing from the key's allowed referrers.",
        },
        {
          term: "Place search is not configured on this deployment",
          description: "This site was built without a Google Maps key (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`). Search and the map are off; the coordinate fields are open and save as they always did.",
        },
        {
          term: "That place is already registered as …",
          description: "The place you chose for a pick-up point is already a point in service under the slug named. Open that point rather than creating a second one for the same terminal.",
        },
        {
          term: "An upload was refused",
          description: "Images must be JPEG, PNG, WebP or AVIF and at most 10 MB; documents (PDF or an image) at most 25 MB. The server reads the file's real bytes, so renaming a file to change its extension does not get it through. Convert or shrink the file and upload again.",
        },
      ],
    },
    {
      type: "heading",
      id: "dispatch",
      text: "On the dispatch board",
    },
    {
      type: "definitions",
      items: [
        {
          term: "No driver has a … car on the road.",
          description: "The Assign dialog only offers drivers who are active and linked to an active car of the class that was booked. Link a car to a driver under **Cars** on the driver's page, or put a car back on the road under Fleet, then reopen the dialog.",
        },
        {
          term: "This needs your say-so",
          description: "The assignment breaks one of the dispatch rules and can only go ahead with an override: **Driver not yet verified**, **Car is a different class from the one booked** or **Car is not one the driver usually takes**. Tick the override you are prepared to stand behind and send again. Every override used is recorded on the assignment and audited.",
        },
        {
          term: "Refused with no override offered",
          description: "Some refusals cannot be overridden: the booking is not confirmed, the driver is deactivated, the car is not on the road, the car is too small for the party, or the driver or car already has a job or a block in that window. Fix the cause — or pick another driver.",
        },
      ],
    },
    {
      type: "heading",
      id: "ask-the-developer",
      text: "When to ask the developer",
    },
    {
      type: "paragraph",
      text: "Some things have no screen in the panel and can only be done by the developer:",
    },
    {
      type: "list",
      items: [
        "Changing a staff password from inside the panel. A forgotten password is reset by its owner with **Forgot your password?** on the sign-in screen.",
        "Creating a new administrator or dispatcher account. Only driver and partner logins are created from inside the panel.",
        "Changing a hotel's, tour's or package's slug. Only a service's slug can be edited on screen, and changing any slug breaks links already shared.",
        "Editing a partner's commission rate. The panel shows it and never lets you change it.",
        "Anything else the panel has no screen for: translations of destinations, routes, points and vehicle classes; reordering a gallery; a note on a rating decision; a vehicle-only blackout.",
      ],
    },
  ],
} satisfies HelpArticle;
