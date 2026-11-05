import type { HelpArticle } from "../../types";

/**
 * `/admin/settings/email` (`(panel)/settings/email/page.tsx`,
 * `MailProviderSettings.tsx`, `GET|POST /api/admin/mail/google*`). Encodes:
 * the Gmail API transport and the one sender account (`GMAIL_SENDER_EMAIL`);
 * who may connect (`settings.write`) versus who may look (`platform.admin`);
 * the connect round trip and its error codes; the test send to oneself; what
 * happens when Google revokes the grant; the daily cap and the warning line;
 * and that switching the transport is a server setting, not a button here.
 */
export const article = {
  id: "pp-email-settings",
  title: "Email: the account the platform sends from",
  summary: "Connecting the company Google account outgoing email goes through, testing it, and what to do when Google disconnects it.",
  category: "people",
  routes: ["/admin/settings/email"],
  keywords: [
    "email",
    "gmail",
    "google",
    "smtp",
    "sender",
    "send mail as",
    "alias",
    "connect",
    "reconnect",
    "disconnect",
    "test email",
    "emails not arriving",
    "confirmation not received",
    "quota",
    "daily limit",
  ],
  related: ["pp-audit-log", "pp-staff"],
  blocks: [
    { type: "where", path: ["Sidebar", "Settings", "Email"] },
    {
      type: "paragraph",
      text: "Every email the platform sends — booking confirmations, vouchers, invitations, password resets, reminders — can go out through the **Gmail API** as one company Google account, instead of through an SMTP provider. This screen connects that account, proves it works, and shows whether mail is flowing.",
    },
    { type: "heading", id: "who-can-use-it", text: "Who can use it" },
    {
      type: "paragraph",
      text: "Every administrator can open the screen and see the status. Connecting, reconnecting, disconnecting and sending a test take **settings.write**, which super admins hold. Each of those actions is recorded in the audit log.",
    },
    { type: "heading", id: "connecting", text: "Connecting the account" },
    {
      type: "steps",
      items: [
        "Press **Connect Google account**. The browser goes to Google.",
        "Sign in as the sender account the screen names — no other account is accepted — and allow the platform to **send email on your behalf**. Leave that permission ticked.",
        "Google sends you back here, and the status reads **Connected**.",
        "Press **Send test email**. It goes through Gmail to your own address only. Check it arrives, and that the sender shown is the one guests should see.",
      ],
    },
    {
      type: "callout",
      tone: "info",
      title: "Connecting does not switch the transport",
      text: "Whether email goes through Gmail or SMTP is a server setting (`MAIL_TRANSPORT`), changed at deploy time. The account can be connected and tested while SMTP is still in use, which is the safe order: prove it first, then switch. Switching back is the rollback.",
    },
    { type: "heading", id: "sender-address", text: "The sender address" },
    {
      type: "paragraph",
      text: "Gmail sends as the account itself. If emails should come from another address, such as a no-reply address, that address must first be added to the Google account as a verified **Send mail as** alias (Gmail → Settings → Accounts). Until then the screen warns, and the server refuses to start on Gmail rather than letting Gmail quietly change the sender.",
    },
    { type: "heading", id: "when-google-disconnects", text: "When Google disconnects it" },
    {
      type: "paragraph",
      text: "Google withdraws the platform's access when the account's password is changed, when someone removes the app from the account's security settings, or after six months without use. Outgoing email then stops, every administrator gets a notice on the bell, and this screen shows **Disconnected by Google**. Nothing is lost: queued emails wait and go out once a super admin presses **Reconnect Google account** and signs in again.",
    },
    {
      type: "definitions",
      items: [
        { term: "Expired or already used", description: "The connection attempt is single-use and lasts ten minutes. Press Connect again." },
        { term: "Sign-in cookie missing", description: "Google brought the browser back without the cookie this screen set — a different browser, or cookies blocked for the API. Connect again from the same browser." },
        { term: "Only … may send", description: "A different Google account was chosen. Its access was revoked straight away; connect again with the named account." },
        { term: "Permission to send was unticked", description: "Google lets a person untick a permission on its screen. Connect again and leave it ticked." },
      ],
    },
    { type: "heading", id: "daily-limit", text: "The daily limit" },
    {
      type: "paragraph",
      text: "Gmail caps how many emails one account sends in 24 hours — about 2,000 for a Google Workspace account and 500 for a personal one, shared with mail people send from it by hand. The screen counts the last 24 hours, and administrators are warned on the bell when the count passes the warning line. Past the cap Gmail refuses; emails wait in the queue and go when the window rolls. If the platform regularly comes near it, a transactional email provider is the next step.",
    },
    { type: "heading", id: "disconnecting", text: "Disconnecting" },
    {
      type: "paragraph",
      text: "**Disconnect** revokes the platform's access at Google and forgets the account here. If Gmail is the active transport, every email stops until an account is connected again, so do this only when switching accounts or retiring Gmail.",
    },
  ],
} satisfies HelpArticle;
