import type { HelpArticle } from "../../types";

/**
 * The sign-in screen, the session and signing out. Encodes what
 * `SignInForm.tsx`, `server/services/auth.service.js` and `server/config.js`
 * actually do: one error for every failure, a 10-attempt limiter, a 30-day
 * sliding session with a 90-day ceiling, and — a real gap — no way to reset
 * or change a password from inside the panel.
 */
export const article = {
  id: "gs-signing-in",
  title: "Signing in, sessions and signing out",
  summary:
    "Where the sign-in screen is, why every failure shows the same message, how long a session lasts, and what to do about a forgotten password.",
  category: "getting-started",
  roles: ["ADMIN", "DISPATCHER"],
  keywords: ["login", "log in", "password", "forgot", "reset", "session", "sign out", "logout", "locked", "too many attempts"],
  related: ["gs-accounts", "gs-roles", "rf-troubleshooting"],
  blocks: [
    { type: "where", path: ["Browser", "/admin/sign-in"] },
    {
      type: "heading",
      id: "sign-in",
      text: "Signing in",
    },
    {
      type: "steps",
      items: [
        "Open `/admin/sign-in`. Any admin address you visit while signed out sends you here.",
        "Enter the **Email** and **Password** of your staff account and press **Sign in**.",
        "You land on the Overview. A dispatcher lands on the dispatch board instead — the overview holds figures a dispatcher is not allowed to read.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "One message for every failure",
      text: "Whatever went wrong — an unknown address, the wrong password, an account that was never activated or has been deactivated — the screen says **Incorrect email address or password**. It is deliberate: the message must not confirm to a stranger which addresses have accounts. If you are sure of both, the account itself may be inactive; ask whoever manages accounts.",
    },
    {
      type: "paragraph",
      text: "After ten failed attempts from the same connection for the same address within fifteen minutes, the server answers **Too many sign-in attempts. Try again later.** There is no permanent lock-out; the window simply has to pass.",
    },
    {
      type: "heading",
      id: "session",
      text: "How long you stay signed in",
    },
    {
      type: "list",
      items: [
        "A session lasts **30 days** and renews itself while you keep using the panel.",
        "It can never be extended past **90 days** from the day you signed in — after that you sign in afresh, however active you have been.",
        "Deactivating an account ends its sessions on the next request. Changing a password ends every session for that account, including the one that changed it.",
      ],
    },
    {
      type: "heading",
      id: "sign-out",
      text: "Signing out",
    },
    {
      type: "paragraph",
      text: "Open the account menu at the end of the top bar — your initials, name and role — and choose **Sign out**. There is no confirmation step. Closing the browser does not sign you out; the session survives until it expires or you end it.",
    },
    {
      type: "heading",
      id: "password",
      text: "Forgotten or changing a password",
    },
    {
      type: "callout",
      tone: "warning",
      title: "There is no self-service password reset in the panel",
      text: "The sign-in screen has no **Forgot password?** link, and there is no screen for changing your own password once signed in. The server can reset a password, but the page the reset email would point at does not exist in the site yet. If you have lost your password, contact the developer who manages the platform's accounts — they can issue a new activation link or set one for you.",
    },
    {
      type: "paragraph",
      text: "A password may not contain your email address or your first or last name. Choose something long rather than something clever.",
    },
  ],
} satisfies HelpArticle;
