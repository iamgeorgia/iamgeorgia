import { config } from '../../config.js';

/**
 * Every value interpolated into an email body is attacker-influenced: a company
 * name, a contact name, a rejection reason typed by an admin. Escaping is not
 * optional even though the recipient is a mail client rather than a browser —
 * several render HTML, and a stray tag would at minimum break the layout.
 */
const escapeHtml = (value) =>
    String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

const link = (path) => `${config.appUrl.replace(/\/$/, '')}${path}`;

export const invitationUrl = (token) => link(`/partners/register/${token}`);
export const activationUrl = (token) => link(`/activate/${token}`);
export const passwordResetUrl = (token) => link(`/reset-password/${token}`);
export const portalUrl = () => link('/portal');
export const driverPanelUrl = (assignmentId) => link(assignmentId ? `/driver/assignments/${assignmentId}` : '/driver');
export const ratingUrl = (token) => link(`/transfers/rate/${token}`);

/** Where a guest manages a standalone booking. The email is the credential, so it travels in the link. */
export const bookingManageUrl = (reference, email) =>
    link(`/booking/manage/${encodeURIComponent(reference)}?email=${encodeURIComponent(email)}`);

const formatDate = (date) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(date);

/** A calendar date — a check-in, a departure — with no time attached. */
const formatDay = (date) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
        date instanceof Date ? date : new Date(date)
    );

const hello = (name) => (name ? `Hello ${name},` : 'Hello,');
const helloHtml = (name) => (name ? `Hello ${escapeHtml(name)},` : 'Hello,');
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The same, read as a wall clock somewhere in particular. */
const formatLocal = (date, timeZone) =>
    new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone }).format(
        date instanceof Date ? date : new Date(date)
    );

/** Minor units back into something a person reads. */
const formatMoney = (cents, currency) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(cents / 100);

/**
 * The brand, as email clients allow it: the site's palette (`client/app/globals.css`)
 * and the same serif-for-headings, sans-for-body pairing, but every value
 * inlined and every box a table, because Outlook and Gmail strip stylesheets
 * and ignore most CSS layout. Nothing is loaded from the network — no logo
 * image, no web font — so the message looks the same with images blocked and
 * cannot be used to track opens.
 */
const BRAND = Object.freeze({
    name: "I'am Georgia",
    wordmark: "I'AM GEORGIA",
    tagline: 'Discover Georgia Beyond the Ordinary',
    address: '12 Erekle II Street, Old Tbilisi, 0105 Georgia',
    email: 'hello@iamgeorgia.travel',
    phone: '+995 32 255 0140',
    // Palette
    page: '#f1e8de',
    card: '#ffffff',
    line: '#e8ded4',
    soft: '#faf6f1',
    ink: '#20201d',
    body: '#2e2e29',
    muted: '#625f59',
    green: '#496458',
    gold: '#b8873f'
});

const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

/**
 * One wrapper for every message.
 *
 * `paragraphs` are already-escaped HTML fragments. `facts` are label/value
 * pairs — the reference, the dates, the total — rendered as a ruled table, so
 * the numbers a guest will scan for are never buried in a sentence. `cta`
 * becomes a button, followed by the bare URL for clients that lose the
 * button; a link that survives as text beats one that vanishes. `eyebrow` is
 * the small line above the heading (a product name, a reference).
 */
const layout = ({ eyebrow, heading, paragraphs, facts = [], cta, footer, preheader }) => {
    const body = paragraphs
        .filter(Boolean)
        .map((line) => `<p style="margin:0 0 14px;font:15px/1.6 ${SANS};color:${BRAND.body}">${line}</p>`)
        .join('\n');

    const table =
        facts.filter((fact) => fact && fact.value !== null && fact.value !== undefined && fact.value !== '').length > 0
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;border:1px solid ${BRAND.line};border-radius:4px;background:${BRAND.soft}">
${facts
    .filter((fact) => fact && fact.value !== null && fact.value !== undefined && fact.value !== '')
    .map(
        (fact, index) => `  <tr>
    <td style="padding:10px 14px;${index > 0 ? `border-top:1px solid ${BRAND.line};` : ''}font:600 11px/1.4 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${BRAND.muted};vertical-align:top;width:38%">${escapeHtml(fact.label)}</td>
    <td style="padding:10px 14px;${index > 0 ? `border-top:1px solid ${BRAND.line};` : ''}font:${fact.strong ? '600 ' : ''}15px/1.5 ${SANS};color:${BRAND.ink};vertical-align:top">${fact.html ?? escapeHtml(fact.value)}</td>
  </tr>`
    )
    .join('\n')}
</table>`
            : '';

    const button = cta
        ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 10px">
  <tr>
    <td style="background:${BRAND.green};border-radius:4px">
      <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 24px;font:600 14px/1 ${SANS};color:#ffffff;text-decoration:none;letter-spacing:.02em">${escapeHtml(cta.label)}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 18px;font:12px/1.6 ${SANS};color:${BRAND.muted}">If the button does not work, paste this into your browser:<br><a href="${escapeHtml(cta.url)}" style="color:${BRAND.green};word-break:break-all">${escapeHtml(cta.url)}</a></p>`
        : '';

    const hidden = preheader
        ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${escapeHtml(preheader)}</div>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page}">
${hidden}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page}">
  <tr>
    <td align="center" style="padding:32px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
        <tr>
          <td style="padding:0 6px 18px">
            <span style="font:700 14px/1 ${SANS};letter-spacing:.2em;color:${BRAND.ink}">${escapeHtml(BRAND.wordmark)}</span>
            <span style="display:inline-block;margin-left:12px;font:italic 13px/1 ${SERIF};color:${BRAND.muted}">${escapeHtml(BRAND.tagline)}</span>
          </td>
        </tr>
        <tr>
          <td style="background:${BRAND.card};border:1px solid ${BRAND.line};border-top:4px solid ${BRAND.green};border-radius:6px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:34px 38px 30px">
                  ${eyebrow ? `<p style="margin:0 0 10px;font:600 11px/1.4 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${BRAND.gold}">${escapeHtml(eyebrow)}</p>` : ''}
                  <h1 style="margin:0 0 20px;font:400 26px/1.25 ${SERIF};color:${BRAND.ink}">${escapeHtml(heading)}</h1>
                  ${body}
                  ${table}
                  ${button}
                  ${footer ? `<p style="margin:18px 0 0;padding-top:16px;border-top:1px solid ${BRAND.line};font:13px/1.6 ${SANS};color:${BRAND.muted}">${footer}</p>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 6px 0;text-align:center;font:12px/1.7 ${SANS};color:${BRAND.muted}">
            ${escapeHtml(BRAND.name)} &middot; ${escapeHtml(BRAND.address)}<br>
            <a href="mailto:${escapeHtml(BRAND.email)}" style="color:${BRAND.muted};text-decoration:underline">${escapeHtml(BRAND.email)}</a> &middot; ${escapeHtml(BRAND.phone)}<br>
            <span style="color:#8a857c">You are receiving this because of a booking or an account with us. Replies reach a person.</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
};

const plain = (lines) => lines.filter(Boolean).join('\n\n');

export const templates = {
    /** 1. An admin invites someone to register a partner company. */
    partnerInvitation: ({ companyName, url, expiresAt, invitedByName }) => {
        const greeting = companyName
            ? `You have been invited to register ${companyName} as a partner of I am Georgia.`
            : 'You have been invited to register as a partner of I am Georgia.';
        const invitedBy = invitedByName ? ` by ${invitedByName}` : '';

        return {
            subject: 'Your I am Georgia partner invitation',
            text: plain([
                greeting,
                `This invitation was sent${invitedBy} to this email address and can only be completed from it.`,
                `Open the link below to complete your company details and choose a password:\n${url}`,
                `The link can be used once and expires on ${formatDate(expiresAt)} UTC.`,
                'If you were not expecting this, you can ignore this email.'
            ]),
            html: layout({
                heading: 'Register as a partner',
                paragraphs: [
                    escapeHtml(greeting),
                    `This invitation was sent${escapeHtml(invitedBy)} to this email address and can only be completed from it.`,
                    `The link can be used once and expires on <strong>${escapeHtml(formatDate(expiresAt))} UTC</strong>.`
                ],
                cta: { label: 'Complete your registration', url },
                footer: 'If you were not expecting this, you can ignore this email.'
            })
        };
    },

    /** 2. Receipt for a submitted application. */
    registrationSubmitted: ({ companyName, reference, contactName }) => ({
        subject: `Application received - ${reference}`,
        text: plain([
            `${contactName ? `Hello ${contactName},` : 'Hello,'}`,
            `We have received the partner application for ${companyName}.`,
            `Your Partner ID is ${reference}. Quote it in any correspondence with us.`,
            'Our team reviews applications and will email you once a decision has been made. You can sign in at any time to check the status of your application.',
            portalUrl()
        ]),
        html: layout({
            heading: 'We have your application',
            paragraphs: [
                `${contactName ? `Hello ${escapeHtml(contactName)},` : 'Hello,'}`,
                `We have received the partner application for <strong>${escapeHtml(companyName)}</strong>.`,
                `Your Partner ID is <strong>${escapeHtml(reference)}</strong>. Quote it in any correspondence with us.`,
                'Our team reviews applications and will email you once a decision has been made.'
            ],
            cta: { label: 'Check your application status', url: portalUrl() }
        })
    }),

    /** 3. Approved. */
    partnerApproved: ({ companyName, reference, contactName }) => ({
        subject: `${companyName} is approved - welcome to I am Georgia`,
        text: plain([
            `${contactName ? `Hello ${contactName},` : 'Hello,'}`,
            `Good news: the partner application for ${companyName} (${reference}) has been approved.`,
            `You now have full access to the partner platform:\n${portalUrl()}`,
            'Sign in with the email address this message was sent to.'
        ]),
        html: layout({
            heading: 'Your partner account is active',
            paragraphs: [
                `${contactName ? `Hello ${escapeHtml(contactName)},` : 'Hello,'}`,
                `The partner application for <strong>${escapeHtml(companyName)}</strong> (${escapeHtml(reference)}) has been approved.`,
                'Sign in with the email address this message was sent to.'
            ],
            cta: { label: 'Open the partner platform', url: portalUrl() }
        })
    }),

    /**
     * 4. Rejected. Carries `reason` — the applicant-facing text — and never
     * the internal note, which is a separate column for exactly this reason.
     */
    partnerRejected: ({ companyName, reference, contactName, reason }) => ({
        subject: `Update on your I am Georgia partner application - ${reference}`,
        text: plain([
            `${contactName ? `Hello ${contactName},` : 'Hello,'}`,
            `Thank you for applying to partner with I am Georgia. After reviewing the application for ${companyName} (${reference}), we are not able to approve it at this time.`,
            `Reason given: ${reason}`,
            'If you believe this decision was made in error, or your circumstances change, reply to this email and we will take another look.'
        ]),
        html: layout({
            heading: 'About your partner application',
            paragraphs: [
                `${contactName ? `Hello ${escapeHtml(contactName)},` : 'Hello,'}`,
                `After reviewing the application for <strong>${escapeHtml(companyName)}</strong> (${escapeHtml(reference)}), we are not able to approve it at this time.`,
                `<strong>Reason given:</strong> ${escapeHtml(reason)}`,
                'If you believe this decision was made in error, or your circumstances change, reply to this email and we will take another look.'
            ]
        })
    }),

    /** 5. An admin created the account; the user still needs a password. */
    accountActivation: ({ contactName, companyName, url, expiresAt }) => ({
        subject: 'Set up your I am Georgia partner account',
        text: plain([
            `${contactName ? `Hello ${contactName},` : 'Hello,'}`,
            `An account has been created for you${companyName ? ` on behalf of ${companyName}` : ''} on the I am Georgia partner platform.`,
            `Choose a password to activate it:\n${url}`,
            `This link can be used once and expires on ${formatDate(expiresAt)} UTC.`
        ]),
        html: layout({
            heading: 'Activate your account',
            paragraphs: [
                `${contactName ? `Hello ${escapeHtml(contactName)},` : 'Hello,'}`,
                `An account has been created for you${companyName ? ` on behalf of <strong>${escapeHtml(companyName)}</strong>` : ''} on the I am Georgia partner platform.`,
                `This link can be used once and expires on <strong>${escapeHtml(formatDate(expiresAt))} UTC</strong>.`
            ],
            cta: { label: 'Choose your password', url }
        })
    }),

    /** A staff seat in the admin panel, created by a super admin. */
    staffAccountActivation: ({ contactName, roleLabel, url, expiresAt }) => ({
        subject: 'Your I am Georgia staff account',
        text: plain([
            `${contactName ? `Hello ${contactName},` : 'Hello,'}`,
            `A staff account${roleLabel ? ` (${roleLabel})` : ''} has been created for you in the I am Georgia admin panel.`,
            `Choose a password to activate it:\n${url}`,
            `This link can be used once and expires on ${formatDate(expiresAt)} UTC.`
        ]),
        html: layout({
            heading: 'Activate your staff account',
            paragraphs: [
                `${contactName ? `Hello ${escapeHtml(contactName)},` : 'Hello,'}`,
                `A staff account${roleLabel ? ` (<strong>${escapeHtml(roleLabel)}</strong>)` : ''} has been created for you in the I am Georgia admin panel.`,
                `This link can be used once and expires on <strong>${escapeHtml(formatDate(expiresAt))} UTC</strong>.`
            ],
            cta: { label: 'Choose your password', url }
        })
    }),

    /** A driver's login, created by operations against an existing profile. */
    driverAccountActivation: ({ driverName, url, expiresAt }) => ({
        subject: 'Your I am Georgia driver account',
        text: plain([
            `${driverName ? `Hello ${driverName},` : 'Hello,'}`,
            'A driver account has been created for you on the I am Georgia platform. It is where your assigned transfers, pick-up details and passenger contacts will appear.',
            `Choose a password to activate it:\n${url}`,
            `This link can be used once and expires on ${formatDate(expiresAt)} UTC.`
        ]),
        html: layout({
            heading: 'Activate your driver account',
            paragraphs: [
                `${driverName ? `Hello ${escapeHtml(driverName)},` : 'Hello,'}`,
                'A driver account has been created for you on the I am Georgia platform. It is where your assigned transfers, pick-up details and passenger contacts will appear.',
                `This link can be used once and expires on <strong>${escapeHtml(formatDate(expiresAt))} UTC</strong>.`
            ],
            cta: { label: 'Choose your password', url }
        })
    }),

    /** 6. A replacement invitation, after the first expired or was resent. */
    invitationReissued: ({ companyName, url, expiresAt }) => ({
        subject: 'Your new I am Georgia partner invitation link',
        text: plain([
            `A new registration link has been issued${companyName ? ` for ${companyName}` : ''}.`,
            'Any earlier link you were sent no longer works. Use this one instead:',
            url,
            `It can be used once and expires on ${formatDate(expiresAt)} UTC.`
        ]),
        html: layout({
            heading: 'Here is your new link',
            paragraphs: [
                `A new registration link has been issued${companyName ? ` for <strong>${escapeHtml(companyName)}</strong>` : ''}.`,
                '<strong>Any earlier link you were sent no longer works.</strong> Use this one instead.',
                `It can be used once and expires on <strong>${escapeHtml(formatDate(expiresAt))} UTC</strong>.`
            ],
            cta: { label: 'Complete your registration', url }
        })
    }),

    /**
     * Dispatch. Every one of these describes a fact already committed, and
     * every one goes through `sendMailQuietly` from the outbox drain.
     */
    transferAssignmentOffered: ({ driverName, reference, from, to, pickupAt, timezone, passengers, flightNumber, onBehalf, url }) => ({
        subject: `${onBehalf ? 'New transfer' : 'Transfer offered'}: ${from} to ${to}, ${formatLocal(pickupAt, timezone)}`,
        text: plain([
            `Hello ${driverName},`,
            onBehalf
                ? `Dispatch has assigned you a transfer, ${reference}.`
                : `Dispatch has offered you a transfer, ${reference}. Please accept or decline it in your panel.`,
            `${from} to ${to}\nPick-up: ${formatLocal(pickupAt, timezone)} (${timezone})\nPassengers: ${passengers}${flightNumber ? `\nFlight: ${flightNumber}` : ''}`,
            `Open it here:\n${url}`
        ]),
        html: layout({
            heading: onBehalf ? 'A transfer has been assigned to you' : 'A transfer has been offered to you',
            paragraphs: [
                `Hello ${escapeHtml(driverName)},`,
                onBehalf
                    ? `Dispatch has assigned you <strong>${escapeHtml(reference)}</strong>.`
                    : `Dispatch has offered you <strong>${escapeHtml(reference)}</strong>. Please accept or decline it in your panel.`,
                `<strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong><br>Pick-up ${escapeHtml(formatLocal(pickupAt, timezone))} (${escapeHtml(timezone)})<br>${passengers} passenger${passengers === 1 ? '' : 's'}${flightNumber ? `<br>Flight ${escapeHtml(flightNumber)}` : ''}`
            ],
            cta: { label: onBehalf ? 'See the transfer' : 'Answer the offer', url },
            footer: 'I am Georgia &middot; dispatch'
        })
    }),

    transferAssignmentRevoked: ({ driverName, reference, from, to, pickupAt, timezone, reason }) => {
        const why =
            reason === 'REASSIGNED'
                ? 'It has been reassigned to another driver.'
                : reason === 'BOOKING_CANCELLED'
                  ? 'The booking has been cancelled.'
                  : 'Dispatch has withdrawn it.';

        return {
            subject: `${reference} is no longer yours`,
            text: plain([
                `Hello ${driverName},`,
                `The transfer ${reference} (${from} to ${to}, ${formatLocal(pickupAt, timezone)}) is no longer assigned to you. ${why}`,
                'Nothing more is needed from you for it.'
            ]),
            html: layout({
                heading: `${escapeHtml(reference)} is no longer yours`,
                paragraphs: [
                    `Hello ${escapeHtml(driverName)},`,
                    `The transfer <strong>${escapeHtml(reference)}</strong> (${escapeHtml(from)} → ${escapeHtml(to)}, ${escapeHtml(formatLocal(pickupAt, timezone))}) is no longer assigned to you. ${escapeHtml(why)}`,
                    'Nothing more is needed from you for it.'
                ],
                footer: 'I am Georgia &middot; dispatch'
            })
        };
    },

    transferPickupReminder: ({ driverName, reference, from, to, pickupAt, timezone, passengerName, passengerPhone, pickupAddress, flightNumber, url }) => ({
        subject: `Pick-up soon: ${from} at ${formatLocal(pickupAt, timezone)}`,
        text: plain([
            `Hello ${driverName},`,
            `A reminder of your next transfer, ${reference}.`,
            `${from} to ${to}\nPick-up: ${formatLocal(pickupAt, timezone)} (${timezone})${pickupAddress ? `\nAddress: ${pickupAddress}` : ''}${flightNumber ? `\nFlight: ${flightNumber}` : ''}\nPassenger: ${passengerName}${passengerPhone ? ` (${passengerPhone})` : ''}`,
            `Open it here:\n${url}`
        ]),
        html: layout({
            heading: 'Your next pick-up is coming up',
            paragraphs: [
                `Hello ${escapeHtml(driverName)},`,
                `A reminder of <strong>${escapeHtml(reference)}</strong>.`,
                `<strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong><br>Pick-up ${escapeHtml(formatLocal(pickupAt, timezone))} (${escapeHtml(timezone)})${pickupAddress ? `<br>${escapeHtml(pickupAddress)}` : ''}${flightNumber ? `<br>Flight ${escapeHtml(flightNumber)}` : ''}<br>Passenger: ${escapeHtml(passengerName)}${passengerPhone ? ` (${escapeHtml(passengerPhone)})` : ''}`
            ],
            cta: { label: 'See the transfer', url },
            footer: 'I am Georgia &middot; dispatch'
        })
    }),

    transferDriverAssigned: ({ reference, from, to, pickupAt, timezone, driverName, driverPhone, vehicle }) => ({
        subject: `Driver confirmed for ${reference}`,
        text: plain([
            `A driver has confirmed the transfer ${reference}: ${from} to ${to} on ${formatLocal(pickupAt, timezone)} (${timezone}).`,
            `Driver: ${driverName}${vehicle ? `\nCar: ${vehicle}` : ''}${driverPhone ? `\nPhone: ${driverPhone}` : '\nThe phone number will be shared the day before the pick-up.'}`
        ]),
        html: layout({
            heading: 'Your driver is confirmed',
            paragraphs: [
                `A driver has confirmed <strong>${escapeHtml(reference)}</strong>: ${escapeHtml(from)} → ${escapeHtml(to)} on ${escapeHtml(formatLocal(pickupAt, timezone))} (${escapeHtml(timezone)}).`,
                `<strong>${escapeHtml(driverName)}</strong>${vehicle ? `<br>${escapeHtml(vehicle)}` : ''}${driverPhone ? `<br>${escapeHtml(driverPhone)}` : '<br>The phone number will be shared the day before the pick-up.'}`
            ]
        })
    }),

    transferDriverDetails: ({ reference, from, to, pickupAt, timezone, driverName, driverPhone, vehicle, passengerName }) => ({
        subject: `Your driver for ${from}: ${driverName}`,
        text: plain([
            `${passengerName ? `Hello ${passengerName},` : 'Hello,'}`,
            `Here is who is meeting you for ${reference}, ${from} to ${to} on ${formatLocal(pickupAt, timezone)} (${timezone}).`,
            `Driver: ${driverName}${vehicle ? `\nCar: ${vehicle}` : ''}${driverPhone ? `\nPhone: ${driverPhone}` : ''}`,
            'If anything changes on your side, call the driver or reply to this email.'
        ]),
        html: layout({
            heading: 'Who is meeting you',
            paragraphs: [
                `${passengerName ? `Hello ${escapeHtml(passengerName)},` : 'Hello,'}`,
                `Here is who is meeting you for <strong>${escapeHtml(reference)}</strong>, ${escapeHtml(from)} → ${escapeHtml(to)} on ${escapeHtml(formatLocal(pickupAt, timezone))} (${escapeHtml(timezone)}).`,
                `<strong>${escapeHtml(driverName)}</strong>${vehicle ? `<br>${escapeHtml(vehicle)}` : ''}${driverPhone ? `<br>${escapeHtml(driverPhone)}` : ''}`,
                'If anything changes on your side, call the driver or reply to this email.'
            ],
            footer: 'Need to change something? Reply to this email and quote your reference.'
        })
    }),

    transferRatingInvite: ({ reference, from, to, driverName, passengerName, url }) => ({
        subject: `How was your transfer, ${from} to ${to}?`,
        text: plain([
            `${passengerName ? `Hello ${passengerName},` : 'Hello,'}`,
            `Thank you for travelling with us (${reference}). ${driverName ? `A minute to rate ${driverName} helps us keep the good drivers busy.` : 'A minute to rate your driver helps us keep the good drivers busy.'}`,
            `Rate your transfer:\n${url}`,
            'The link works once and for the next thirty days.'
        ]),
        html: layout({
            heading: 'How was your transfer?',
            paragraphs: [
                `${passengerName ? `Hello ${escapeHtml(passengerName)},` : 'Hello,'}`,
                `Thank you for travelling with us (<strong>${escapeHtml(reference)}</strong>). ${driverName ? `A minute to rate <strong>${escapeHtml(driverName)}</strong> helps us keep the good drivers busy.` : 'A minute to rate your driver helps us keep the good drivers busy.'}`,
                'The link works once and for the next thirty days.'
            ],
            cta: { label: 'Rate your transfer', url },
            footer: 'I am Georgia &middot; transfers'
        })
    }),

    transferUnassignedAlert: ({ reference, from, to, pickupAt, timezone, passengers }) => ({
        subject: `No driver yet: ${reference}, ${formatLocal(pickupAt, timezone)}`,
        text: plain([
            `The transfer ${reference} (${from} to ${to}, ${passengers} passengers) picks up at ${formatLocal(pickupAt, timezone)} (${timezone}) and still has no driver.`,
            'Assign one from the dispatch board.'
        ]),
        html: layout({
            heading: 'A transfer within a day has no driver',
            paragraphs: [
                `<strong>${escapeHtml(reference)}</strong> (${escapeHtml(from)} → ${escapeHtml(to)}, ${passengers} passenger${passengers === 1 ? '' : 's'}) picks up at ${escapeHtml(formatLocal(pickupAt, timezone))} (${escapeHtml(timezone)}) and still has no driver.`,
                'Assign one from the dispatch board.'
            ],
            footer: 'I am Georgia &middot; dispatch'
        })
    }),

    /** An on-request tour booking the operator has not answered in time. */
    tourRequestOverdue: ({ reference, tourTitle, optionName, date, timezone, travellers, partnerName }) => ({
        subject: `Unanswered request: ${reference}, ${tourTitle}`,
        text: plain([
            `The tour request ${reference} (${tourTitle}${optionName ? `, ${optionName}` : ''}, ${travellers} travellers, departing ${formatLocal(date, timezone)}${partnerName ? `, booked by ${partnerName}` : ''}) has passed its answer deadline and is still pending.`,
            'Confirm or decline it from the tour bookings register.'
        ]),
        html: layout({
            heading: 'A tour request is overdue',
            paragraphs: [
                `<strong>${escapeHtml(reference)}</strong> (${escapeHtml(tourTitle)}${optionName ? `, ${escapeHtml(optionName)}` : ''}, ${travellers} traveller${travellers === 1 ? '' : 's'}, departing ${escapeHtml(formatLocal(date, timezone))}${partnerName ? `, booked by ${escapeHtml(partnerName)}` : ''}) has passed its answer deadline and is still pending.`,
                'Confirm or decline it from the tour bookings register.'
            ],
            footer: 'I am Georgia &middot; tours'
        })
    }),


    /** The order voucher: one mail listing every part, sent once the whole order is confirmed. */
    orderConfirmed: ({ reference, packageName, startDate, endDate, leadName, totalCents, currency, items }) => ({
        subject: `Confirmed: ${reference}, ${packageName}`,
        text: plain([
            `Dear ${leadName}, your order ${reference} for ${packageName} (${startDate} to ${endDate}) is confirmed.`,
            ...items.map((item) => `${item.label}: ${item.reference} (${item.status})`),
            `Total: ${formatMoney(totalCents, currency)}.`,
            'Each part carries its own reference; quote the order reference for anything about the whole trip.'
        ]),
        html: layout({
            heading: 'Your order is confirmed',
            paragraphs: [
                `<strong>${escapeHtml(reference)}</strong> &mdash; ${escapeHtml(packageName)}, ${escapeHtml(startDate)} to ${escapeHtml(endDate)}.`,
                ...items.map((item) => `${escapeHtml(item.label)}: <strong>${escapeHtml(item.reference)}</strong> (${escapeHtml(item.status)})`),
                `Total: <strong>${escapeHtml(formatMoney(totalCents, currency))}</strong>.`
            ],
            footer: 'I am Georgia &middot; packages'
        })
    }),

    /** Part of the order is waiting for a supplier's answer. */
    orderRequested: ({ reference, packageName, startDate, leadName, pending, requestDeadlineAt }) => ({
        subject: `Request received: ${reference}, ${packageName}`,
        text: plain([
            `Dear ${leadName}, your order ${reference} for ${packageName} starting ${startDate} has been received.`,
            `Awaiting confirmation: ${pending.map((item) => item.label).join(', ')}. You will hear by ${formatDate(requestDeadlineAt)} UTC.`,
            'Nothing is charged for a request that cannot be honoured, and you may cancel it meanwhile at no charge.'
        ]),
        html: layout({
            heading: 'Your request has been received',
            paragraphs: [
                `<strong>${escapeHtml(reference)}</strong> &mdash; ${escapeHtml(packageName)}, starting ${escapeHtml(startDate)}.`,
                `Awaiting confirmation: ${pending.map((item) => escapeHtml(item.label)).join(', ')}. You will hear by <strong>${escapeHtml(formatDate(requestDeadlineAt))} UTC</strong>.`,
                'Nothing is charged for a request that cannot be honoured, and you may cancel it meanwhile at no charge.'
            ],
            footer: 'I am Georgia &middot; packages'
        })
    }),

    /** An optional part could not be honoured; the rest stands. */
    orderItemDeclined: ({ reference, packageName, leadName, label, reason, totalCents, currency }) => ({
        subject: `${label} is not available on ${reference}`,
        text: plain([
            `Dear ${leadName}, the supplier could not honour "${label}" on your order ${reference} (${packageName}): ${reason}.`,
            `The rest of the order stands. Your total is now ${formatMoney(totalCents, currency)}.`
        ]),
        html: layout({
            heading: 'One part of your order is not available',
            paragraphs: [
                `The supplier could not honour <strong>${escapeHtml(label)}</strong> on <strong>${escapeHtml(reference)}</strong> (${escapeHtml(packageName)}): ${escapeHtml(reason)}.`,
                `The rest of the order stands. Your total is now <strong>${escapeHtml(formatMoney(totalCents, currency))}</strong>.`
            ],
            footer: 'I am Georgia &middot; packages'
        })
    }),

    orderCancelled: ({ reference, packageName, leadName, chargeCents, currency, reason }) => ({
        subject: `Cancelled: ${reference}, ${packageName}`,
        text: plain([
            `Dear ${leadName}, your order ${reference} for ${packageName} has been cancelled${reason ? ` (${reason})` : ''}.`,
            chargeCents > 0
                ? `${formatMoney(chargeCents, currency)} is chargeable under the terms agreed at booking.`
                : 'Nothing is chargeable.'
        ]),
        html: layout({
            heading: 'Your order has been cancelled',
            paragraphs: [
                `<strong>${escapeHtml(reference)}</strong> &mdash; ${escapeHtml(packageName)}${reason ? ` (${escapeHtml(reason)})` : ''}.`,
                chargeCents > 0
                    ? `<strong>${escapeHtml(formatMoney(chargeCents, currency))}</strong> is chargeable under the terms agreed at booking.`
                    : 'Nothing is chargeable.'
            ],
            footer: 'I am Georgia &middot; packages'
        })
    }),

    /** An order with a request nobody has answered in time. */
    orderRequestOverdue: ({ reference, packageName, pending, partnerName, requestDeadlineAt }) => ({
        subject: `Unanswered request: ${reference}, ${packageName}`,
        text: plain([
            `Order ${reference} (${packageName}${partnerName ? `, booked by ${partnerName}` : ''}) has passed its answer deadline of ${formatDate(requestDeadlineAt)} UTC with ${pending.map((item) => item.label).join(', ')} still pending.`,
            'Confirm or decline from the orders register.'
        ]),
        html: layout({
            heading: 'An order request is overdue',
            paragraphs: [
                `<strong>${escapeHtml(reference)}</strong> (${escapeHtml(packageName)}${partnerName ? `, booked by ${escapeHtml(partnerName)}` : ''}) has passed its answer deadline with ${pending.map((item) => escapeHtml(item.label)).join(', ')} still pending.`,
                'Confirm or decline from the orders register.'
            ],
            footer: 'I am Georgia &middot; packages'
        })
    }),

    /** Password reset, which falls out of the same token machinery. */
    passwordReset: ({ url, expiresAt }) => ({
        subject: 'Reset your I am Georgia password',
        text: plain([
            'Someone asked to reset the password for this account.',
            `If it was you, choose a new one here:\n${url}`,
            `The link expires on ${formatDate(expiresAt)} UTC and can be used once.`,
            'If it was not you, no action is needed — the password has not changed.'
        ]),
        html: layout({
            heading: 'Reset your password',
            paragraphs: [
                'Someone asked to reset the password for this account.',
                `The link expires on <strong>${escapeHtml(formatDate(expiresAt))} UTC</strong> and can be used once.`
            ],
            cta: { label: 'Choose a new password', url },
            footer: 'If it was not you, no action is needed - the password has not changed.'
        })
    }),

    /**
     * The transfer voucher.
     *
     * The pick-up time is formatted in the pick-up point's own timezone, not in
     * UTC like every other message here. A driver and a traveller agree to meet
     * at nine in the morning in Tbilisi; telling either of them "05:00 UTC" is
     * technically correct and practically useless.
     */
    transferConfirmed: ({
        reference,
        leadPassengerName,
        fromName,
        toName,
        pickupAt,
        returnPickupAt,
        timezone,
        vehicleName,
        passengers,
        pickupAddress,
        flightNumber,
        pickupProcedure,
        currency,
        totalCents
    }) => {
        const journey = `${fromName} to ${toName}`;
        const outbound = formatLocal(pickupAt, timezone);
        const back = returnPickupAt ? formatLocal(returnPickupAt, timezone) : null;
        const total = formatMoney(totalCents, currency);

        return {
            subject: `Your transfer is confirmed - ${reference}`,
            text: plain([
                hello(leadPassengerName),
                `Your transfer is booked. Quote ${reference} to your driver.`,
                `${journey}\nPick-up: ${outbound}${back ? `\nReturn pick-up: ${back}` : ''}`,
                `Vehicle: ${vehicleName}, for ${plural(passengers, 'passenger')}`,
                pickupAddress ? `Pick-up address: ${pickupAddress}` : null,
                flightNumber ? `Flight: ${flightNumber}. We track it, so a delay moves your car rather than losing it.` : null,
                pickupProcedure,
                `Total: ${total}. No card was taken online; you settle with the driver on the day.`
            ]),
            html: layout({
                eyebrow: `Transfer · ${reference}`,
                heading: 'Your transfer is confirmed',
                preheader: `${journey}, pick-up ${outbound}. Quote ${reference} to your driver.`,
                paragraphs: [
                    helloHtml(leadPassengerName),
                    `Your transfer is booked. Quote <strong>${escapeHtml(reference)}</strong> to your driver.`
                ],
                facts: [
                    { label: 'Journey', value: journey, strong: true },
                    { label: 'Pick-up', value: outbound },
                    back ? { label: 'Return pick-up', value: back } : null,
                    { label: 'Vehicle', value: `${vehicleName} · ${plural(passengers, 'passenger')}` },
                    pickupAddress ? { label: 'Pick-up address', value: pickupAddress } : null,
                    flightNumber ? { label: 'Flight', value: `${flightNumber} · tracked, so a delay moves your car` } : null,
                    { label: 'Total', value: total, strong: true }
                ],
                footer: [
                    pickupProcedure ? escapeHtml(pickupProcedure) : null,
                    'No card was taken online; you settle with the driver on the day. Need to change something? Reply to this email and quote your reference.'
                ]
                    .filter(Boolean)
                    .join('<br><br>')
            })
        };
    },

    // --- Standalone bookings: the guest's side ------------------------------------
    //
    // Nothing is charged online anywhere on the platform, and every one of
    // these says so: a guest who reads "Total" as "Total paid" would arrive
    // expecting nothing to settle. Dates are calendar dates and are shown
    // without a time; the one time that matters — check-in from, departure —
    // is a wall clock in the property's own zone and is quoted as written.

    /** The hotel voucher. */
    hotelBookingConfirmed: ({
        reference,
        leadName,
        hotelName,
        address,
        phone,
        checkIn,
        checkOut,
        nights,
        checkInFrom,
        rooms,
        currency,
        totalCents,
        payableAtPropertyCents,
        cancellationSummary,
        specialRequests,
        url
    }) => {
        const stay = `${formatDay(checkIn)} to ${formatDay(checkOut)} (${plural(nights, 'night')})`;
        const roomLine = (room) =>
            `${room.roomTypeName} · ${room.ratePlanName} · ${room.mealPlanName} · ${plural(room.adults, 'adult')}${
                room.children > 0 ? `, ${plural(room.children, 'child', 'children')}` : ''
            }`;
        const total = formatMoney(totalCents, currency);
        const atDesk = payableAtPropertyCents > 0 ? formatMoney(payableAtPropertyCents, currency) : null;
        const settle = `Nothing has been charged online; payment is settled directly with the property.${
            atDesk ? ` Of the total, ${atDesk} in local taxes and fees is collected at the desk.` : ''
        }`;

        return {
            subject: `Your stay at ${hotelName} is confirmed - ${reference}`,
            text: plain([
                hello(leadName),
                `Your booking at ${hotelName} is confirmed. Quote ${reference} at the desk.`,
                `${hotelName}${address ? `\n${address}` : ''}${phone ? `\nTelephone: ${phone}` : ''}`,
                `Stay: ${stay}${checkInFrom ? `\nCheck-in from ${checkInFrom}` : ''}`,
                rooms.map(roomLine).join('\n'),
                `Total: ${total}. ${settle}`,
                cancellationSummary ? `Cancellation: ${cancellationSummary}` : null,
                specialRequests ? `Your requests: ${specialRequests}` : null,
                `Manage or cancel your booking:\n${url}`
            ]),
            html: layout({
                eyebrow: `Hotel booking · ${reference}`,
                heading: 'Your stay is confirmed',
                preheader: `${hotelName}, ${stay}. Quote ${reference} at the desk.`,
                paragraphs: [
                    helloHtml(leadName),
                    `Your booking at <strong>${escapeHtml(hotelName)}</strong> is confirmed. Quote <strong>${escapeHtml(
                        reference
                    )}</strong> at the desk.`
                ],
                facts: [
                    {
                        label: 'Property',
                        html: `<strong>${escapeHtml(hotelName)}</strong>${address ? `<br>${escapeHtml(address)}` : ''}${
                            phone ? `<br>${escapeHtml(phone)}` : ''
                        }`,
                        value: hotelName
                    },
                    { label: 'Stay', value: stay, strong: true },
                    checkInFrom ? { label: 'Check-in', value: `From ${checkInFrom}` } : null,
                    ...rooms.map((room, index) => ({
                        label: rooms.length > 1 ? `Room ${index + 1}` : 'Room',
                        value: roomLine(room)
                    })),
                    { label: 'Total', value: total, strong: true },
                    cancellationSummary ? { label: 'Cancellation', value: cancellationSummary } : null,
                    specialRequests ? { label: 'Your requests', value: specialRequests } : null
                ],
                cta: { label: 'Manage your booking', url },
                footer: `${escapeHtml(settle)}<br><br>Need to change something? Reply to this email and quote your reference.`
            })
        };
    },

    hotelBookingCancelled: ({ reference, leadName, hotelName, checkIn, checkOut, currency, chargeCents, reason }) => {
        const stay = `${formatDay(checkIn)} to ${formatDay(checkOut)}`;
        const charge =
            chargeCents > 0
                ? `A cancellation charge of ${formatMoney(chargeCents, currency)} applies under the terms you accepted at booking.`
                : 'No cancellation charge applies.';

        return {
            subject: `Your booking at ${hotelName} is cancelled - ${reference}`,
            text: plain([
                hello(leadName),
                `Booking ${reference} at ${hotelName}, ${stay}, has been cancelled.`,
                charge,
                reason ? `Reason given: ${reason}` : null,
                'If you did not ask for this, reply to this email straight away.'
            ]),
            html: layout({
                eyebrow: `Hotel booking · ${reference}`,
                heading: 'Your booking is cancelled',
                preheader: `${hotelName}, ${stay} — cancelled. ${charge}`,
                paragraphs: [helloHtml(leadName), `Your booking at <strong>${escapeHtml(hotelName)}</strong> has been cancelled.`],
                facts: [
                    { label: 'Reference', value: reference },
                    { label: 'Stay', value: stay },
                    { label: 'Cancellation charge', value: chargeCents > 0 ? formatMoney(chargeCents, currency) : 'None', strong: true },
                    reason ? { label: 'Reason given', value: reason } : null
                ],
                footer: `${escapeHtml(charge)}<br><br>If you did not ask for this, reply to this email straight away.`
            })
        };
    },

    /** A tour that is booked — instantly, or after the operator said yes to a request. */
    tourBookingConfirmed: ({
        reference,
        leadName,
        tourTitle,
        optionName,
        date,
        endDate,
        durationDays,
        meetingPoint,
        departureTime,
        travellers,
        currency,
        totalCents,
        cancellationSummary,
        wasRequest,
        url
    }) => {
        const when =
            durationDays > 1 ? `${formatDay(date)} to ${formatDay(endDate)} (${plural(durationDays, 'day')})` : formatDay(date);
        const total = formatMoney(totalCents, currency);
        const opening = wasRequest
            ? `Good news: the operator has confirmed your request for ${tourTitle}.`
            : `Your place on ${tourTitle} is confirmed.`;
        const heading = wasRequest ? 'Your tour request is confirmed' : 'Your tour is confirmed';

        return {
            subject: `${heading} - ${reference}`,
            text: plain([
                hello(leadName),
                `${opening} Quote ${reference} to your guide.`,
                `${tourTitle}${optionName ? ` · ${optionName}` : ''}\n${when}${departureTime ? `\nDeparts ${departureTime}` : ''}`,
                meetingPoint ? `Meeting point: ${meetingPoint}` : null,
                `For ${plural(travellers, 'traveller')}.`,
                `Total: ${total}. Nothing has been charged online; payment is settled with the operator.`,
                cancellationSummary ? `Cancellation: ${cancellationSummary}` : null,
                `Manage or cancel your booking:\n${url}`
            ]),
            html: layout({
                eyebrow: `Tour booking · ${reference}`,
                heading,
                preheader: `${tourTitle}, ${when}. Quote ${reference} to your guide.`,
                paragraphs: [helloHtml(leadName), `${escapeHtml(opening)} Quote <strong>${escapeHtml(reference)}</strong> to your guide.`],
                facts: [
                    { label: 'Tour', value: `${tourTitle}${optionName ? ` · ${optionName}` : ''}`, strong: true },
                    { label: 'Date', value: when },
                    departureTime ? { label: 'Departs', value: departureTime } : null,
                    meetingPoint ? { label: 'Meeting point', value: meetingPoint } : null,
                    { label: 'Travellers', value: String(travellers) },
                    { label: 'Total', value: total, strong: true },
                    cancellationSummary ? { label: 'Cancellation', value: cancellationSummary } : null
                ],
                cta: { label: 'Manage your booking', url },
                footer: 'Nothing has been charged online; payment is settled with the operator.<br><br>Need to change something? Reply to this email and quote your reference.'
            })
        };
    },

    /** An on-request tour: the seats are held, the operator has yet to answer. */
    tourBookingRequested: ({ reference, leadName, tourTitle, optionName, date, travellers, currency, totalCents, requestDeadlineAt, url }) => {
        const answerBy = requestDeadlineAt ? `${formatDate(requestDeadlineAt)} UTC` : null;

        return {
            subject: `We have your tour request - ${reference}`,
            text: plain([
                hello(leadName),
                `We have passed your request for ${tourTitle}${optionName ? ` (${optionName})` : ''} on ${formatDay(date)}, for ${plural(
                    travellers,
                    'traveller'
                )}, to the operator.`,
                `Your reference is ${reference}. The price of ${formatMoney(totalCents, currency)} is held for you and will not change.`,
                answerBy
                    ? `Operators usually answer within two days; we expect a reply by ${answerBy} and will email you the moment it arrives.`
                    : 'We will email you the moment the operator answers.',
                'Nothing has been charged, and nothing will be unless the operator confirms.',
                `Follow your request:\n${url}`
            ]),
            html: layout({
                eyebrow: `Tour request · ${reference}`,
                heading: 'We have your request',
                preheader: `${tourTitle} on ${formatDay(date)} — with the operator now. We will email you as soon as they answer.`,
                paragraphs: [
                    helloHtml(leadName),
                    `We have passed your request to the operator. The price is held for you and will not change, and we will email you the moment they answer.`
                ],
                facts: [
                    { label: 'Tour', value: `${tourTitle}${optionName ? ` · ${optionName}` : ''}`, strong: true },
                    { label: 'Date', value: formatDay(date) },
                    { label: 'Travellers', value: String(travellers) },
                    { label: 'Price held', value: formatMoney(totalCents, currency), strong: true },
                    answerBy ? { label: 'Answer expected by', value: answerBy } : null
                ],
                cta: { label: 'Follow your request', url },
                footer: 'Nothing has been charged, and nothing will be unless the operator confirms.'
            })
        };
    },

    tourBookingDeclined: ({ reference, leadName, tourTitle, optionName, date, reason }) => ({
        subject: `Your tour request could not be confirmed - ${reference}`,
        text: plain([
            hello(leadName),
            `We are sorry: the operator was unable to confirm ${tourTitle}${optionName ? ` (${optionName})` : ''} on ${formatDay(
                date
            )}.`,
            reason ? `Their reason: ${reason}` : null,
            `Request ${reference} is closed and nothing has been charged.`,
            'Other dates and other tours are on the site, and we are happy to help you find one - reply to this email.'
        ]),
        html: layout({
            eyebrow: `Tour request · ${reference}`,
            heading: 'Your request could not be confirmed',
            preheader: `The operator could not confirm ${tourTitle} on ${formatDay(date)}. Nothing has been charged.`,
            paragraphs: [
                helloHtml(leadName),
                `We are sorry: the operator was unable to confirm <strong>${escapeHtml(tourTitle)}${
                    optionName ? ` (${escapeHtml(optionName)})` : ''
                }</strong> on ${escapeHtml(formatDay(date))}. The request is closed and nothing has been charged.`
            ],
            facts: [
                { label: 'Reference', value: reference },
                { label: 'Date', value: formatDay(date) },
                reason ? { label: 'Their reason', value: reason } : null
            ],
            footer: 'Other dates and other tours are on the site, and we are happy to help you find one - reply to this email.'
        })
    }),

    tourBookingCancelled: ({ reference, leadName, tourTitle, date, currency, chargeCents, reason }) => {
        const charge =
            chargeCents > 0
                ? `A cancellation charge of ${formatMoney(chargeCents, currency)} applies under the terms you accepted at booking.`
                : 'No cancellation charge applies.';

        return {
            subject: `Your tour booking is cancelled - ${reference}`,
            text: plain([
                hello(leadName),
                `Booking ${reference}, ${tourTitle} on ${formatDay(date)}, has been cancelled.`,
                charge,
                reason ? `Reason given: ${reason}` : null,
                'If you did not ask for this, reply to this email straight away.'
            ]),
            html: layout({
                eyebrow: `Tour booking · ${reference}`,
                heading: 'Your tour booking is cancelled',
                preheader: `${tourTitle} on ${formatDay(date)} — cancelled. ${charge}`,
                paragraphs: [helloHtml(leadName), `Your booking for <strong>${escapeHtml(tourTitle)}</strong> has been cancelled.`],
                facts: [
                    { label: 'Reference', value: reference },
                    { label: 'Date', value: formatDay(date) },
                    { label: 'Cancellation charge', value: chargeCents > 0 ? formatMoney(chargeCents, currency) : 'None', strong: true },
                    reason ? { label: 'Reason given', value: reason } : null
                ],
                footer: `${escapeHtml(charge)}<br><br>If you did not ask for this, reply to this email straight away.`
            })
        };
    },

    serviceBookingConfirmed: ({ reference, leadName, serviceName, date, endDate, days, quantity, pax, currency, totalCents, wasRequest, url }) => {
        const when = days > 1 ? `${formatDay(date)} to ${formatDay(endDate)} (${plural(days, 'day')})` : formatDay(date);
        const total = formatMoney(totalCents, currency);
        const opening = wasRequest
            ? `Good news: the provider has confirmed your request for ${serviceName}.`
            : `Your booking for ${serviceName} is confirmed.`;
        const heading = wasRequest ? 'Your request is confirmed' : 'Your booking is confirmed';
        const party = `${plural(pax, 'person', 'people')}${quantity > 1 ? ` · ${quantity} units` : ''}`;

        return {
            subject: `${heading} - ${reference}`,
            text: plain([
                hello(leadName),
                `${opening} Your reference is ${reference}.`,
                `${serviceName}\n${when}\nFor ${party}.`,
                `Total: ${total}. Nothing has been charged online; payment is settled with the provider.`,
                `Manage or cancel your booking:\n${url}`
            ]),
            html: layout({
                eyebrow: `Booking · ${reference}`,
                heading,
                preheader: `${serviceName}, ${when}. Reference ${reference}.`,
                paragraphs: [helloHtml(leadName), `${escapeHtml(opening)} Your reference is <strong>${escapeHtml(reference)}</strong>.`],
                facts: [
                    { label: 'Service', value: serviceName, strong: true },
                    { label: 'Date', value: when },
                    { label: 'For', value: party },
                    { label: 'Total', value: total, strong: true }
                ],
                cta: { label: 'Manage your booking', url },
                footer: 'Nothing has been charged online; payment is settled with the provider.<br><br>Need to change something? Reply to this email and quote your reference.'
            })
        };
    },

    serviceBookingRequested: ({ reference, leadName, serviceName, date, pax, currency, totalCents, requestDeadlineAt, url }) => {
        const answerBy = requestDeadlineAt ? `${formatDate(requestDeadlineAt)} UTC` : null;

        return {
            subject: `We have your request - ${reference}`,
            text: plain([
                hello(leadName),
                `We have passed your request for ${serviceName} on ${formatDay(date)}, for ${plural(pax, 'person', 'people')}, to the provider.`,
                `Your reference is ${reference}. The price of ${formatMoney(totalCents, currency)} is held for you and will not change.`,
                answerBy ? `We expect a reply by ${answerBy} and will email you the moment it arrives.` : 'We will email you the moment the provider answers.',
                'Nothing has been charged, and nothing will be unless the provider confirms.',
                `Follow your request:\n${url}`
            ]),
            html: layout({
                eyebrow: `Request · ${reference}`,
                heading: 'We have your request',
                preheader: `${serviceName} on ${formatDay(date)} — with the provider now. We will email you as soon as they answer.`,
                paragraphs: [
                    helloHtml(leadName),
                    'We have passed your request to the provider. The price is held for you and will not change, and we will email you the moment they answer.'
                ],
                facts: [
                    { label: 'Service', value: serviceName, strong: true },
                    { label: 'Date', value: formatDay(date) },
                    { label: 'For', value: plural(pax, 'person', 'people') },
                    { label: 'Price held', value: formatMoney(totalCents, currency), strong: true },
                    answerBy ? { label: 'Answer expected by', value: answerBy } : null
                ],
                cta: { label: 'Follow your request', url },
                footer: 'Nothing has been charged, and nothing will be unless the provider confirms.'
            })
        };
    },

    serviceBookingDeclined: ({ reference, leadName, serviceName, date, reason }) => ({
        subject: `Your request could not be confirmed - ${reference}`,
        text: plain([
            hello(leadName),
            `We are sorry: the provider was unable to confirm ${serviceName} on ${formatDay(date)}.`,
            reason ? `Their reason: ${reason}` : null,
            `Request ${reference} is closed and nothing has been charged.`,
            'We are happy to help you find an alternative - reply to this email.'
        ]),
        html: layout({
            eyebrow: `Request · ${reference}`,
            heading: 'Your request could not be confirmed',
            preheader: `The provider could not confirm ${serviceName} on ${formatDay(date)}. Nothing has been charged.`,
            paragraphs: [
                helloHtml(leadName),
                `We are sorry: the provider was unable to confirm <strong>${escapeHtml(serviceName)}</strong> on ${escapeHtml(
                    formatDay(date)
                )}. The request is closed and nothing has been charged.`
            ],
            facts: [{ label: 'Reference', value: reference }, { label: 'Date', value: formatDay(date) }, reason ? { label: 'Their reason', value: reason } : null],
            footer: 'We are happy to help you find an alternative - reply to this email.'
        })
    }),

    serviceBookingCancelled: ({ reference, leadName, serviceName, date, currency, chargeCents, reason }) => {
        const charge =
            chargeCents > 0
                ? `A cancellation charge of ${formatMoney(chargeCents, currency)} applies under the terms you accepted at booking.`
                : 'No cancellation charge applies.';

        return {
            subject: `Your booking is cancelled - ${reference}`,
            text: plain([
                hello(leadName),
                `Booking ${reference}, ${serviceName} on ${formatDay(date)}, has been cancelled.`,
                charge,
                reason ? `Reason given: ${reason}` : null,
                'If you did not ask for this, reply to this email straight away.'
            ]),
            html: layout({
                eyebrow: `Booking · ${reference}`,
                heading: 'Your booking is cancelled',
                preheader: `${serviceName} on ${formatDay(date)} — cancelled. ${charge}`,
                paragraphs: [helloHtml(leadName), `Your booking for <strong>${escapeHtml(serviceName)}</strong> has been cancelled.`],
                facts: [
                    { label: 'Reference', value: reference },
                    { label: 'Date', value: formatDay(date) },
                    { label: 'Cancellation charge', value: chargeCents > 0 ? formatMoney(chargeCents, currency) : 'None', strong: true },
                    reason ? { label: 'Reason given', value: reason } : null
                ],
                footer: `${escapeHtml(charge)}<br><br>If you did not ask for this, reply to this email straight away.`
            })
        };
    },

    // --- Standalone bookings: the supplier's side ---------------------------------
    //
    // One pair of templates for hotels, tours and services alike: what a
    // property, an operator and a provider each need to know is the same
    // rooming-list information — who, when, how many, what they asked for,
    // and what the platform owes them (the net side, never the sell).

    supplierBookingReceived: ({
        product,
        reference,
        productName,
        partnerName,
        guestName,
        guestEmail,
        guestPhone,
        from,
        to,
        party,
        currency,
        netCents,
        notes,
        requested,
        url
    }) => {
        const noun = { hotel: 'reservation', tour: 'booking', service: 'booking' }[product] ?? 'booking';
        const dates = to && to.getTime() !== from.getTime() ? `${formatDay(from)} to ${formatDay(to)}` : formatDay(from);
        const opening = requested
            ? `A new request for ${productName} is waiting for your answer. Please confirm or decline it in the portal within two days.`
            : `A new ${noun} for ${productName} has been made through I'am Georgia.`;
        const net = formatMoney(netCents, currency);
        const contact = `${guestName}${guestPhone ? ` · ${guestPhone}` : ''}${guestEmail ? ` · ${guestEmail}` : ''}`;

        return {
            subject: `${requested ? 'New request' : `New ${noun}`} - ${reference} - ${productName}`,
            text: plain([
                hello(partnerName),
                opening,
                `Reference: ${reference}\nDates: ${dates}\n${party}`,
                `Guest: ${contact}`,
                notes ? `Requests and notes: ${notes}` : null,
                `Net amount due to you: ${net}. The guest settles with you directly; nothing was charged online.`,
                `Open it in the portal:\n${url}`
            ]),
            html: layout({
                eyebrow: `${requested ? 'Request' : `New ${noun}`} · ${reference}`,
                heading: requested ? 'A request is waiting for you' : `New ${noun}: ${productName}`,
                preheader: `${dates} · ${guestName} · net ${net}`,
                paragraphs: [helloHtml(partnerName), escapeHtml(opening)],
                facts: [
                    { label: 'Reference', value: reference, strong: true },
                    { label: 'Product', value: productName },
                    { label: 'Dates', value: dates },
                    { label: 'Party', html: escapeHtml(party).replaceAll('\n', '<br>'), value: party },
                    { label: 'Guest', value: contact },
                    notes ? { label: 'Requests and notes', value: notes } : null,
                    { label: 'Net due to you', value: net, strong: true }
                ],
                cta: { label: requested ? 'Answer the request' : 'Open in the portal', url },
                footer: 'The guest settles with you directly; nothing was charged online.'
            })
        };
    },

    supplierBookingCancelled: ({ product, reference, productName, partnerName, guestName, from, to, reason, url }) => {
        const noun = { hotel: 'reservation', tour: 'booking', service: 'booking' }[product] ?? 'booking';
        const dates = to && to.getTime() !== from.getTime() ? `${formatDay(from)} to ${formatDay(to)}` : formatDay(from);
        const heading = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} cancelled`;

        return {
            subject: `Cancelled - ${reference} - ${productName}`,
            text: plain([
                hello(partnerName),
                `The ${noun} ${reference} for ${productName}, ${dates}, in the name of ${guestName}, has been cancelled. Please release it on your side.`,
                reason ? `Reason given: ${reason}` : null,
                `Details in the portal:\n${url}`
            ]),
            html: layout({
                eyebrow: `Cancelled · ${reference}`,
                heading,
                preheader: `${productName}, ${dates}, ${guestName} — cancelled. Please release it on your side.`,
                paragraphs: [
                    helloHtml(partnerName),
                    `The ${noun} below has been cancelled. Please release it on your side.`
                ],
                facts: [
                    { label: 'Reference', value: reference, strong: true },
                    { label: 'Product', value: productName },
                    { label: 'Dates', value: dates },
                    { label: 'Guest', value: guestName },
                    reason ? { label: 'Reason given', value: reason } : null
                ],
                cta: { label: 'Open in the portal', url }
            })
        };
    }
};
