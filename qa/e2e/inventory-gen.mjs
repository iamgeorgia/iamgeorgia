// Builds the feature inventory (pages + API routers) and joins it with execution status derived from results.jsonl / sweep.json / newman.
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
import { finalResults } from './final-results.mjs';
const R = finalResults();
const statusOf = (pred) => { const hits = R.filter(pred); if (!hits.length) return 'NOT TESTED'; if (hits.some((h) => h.status === 'FAIL')) return 'FAIL'; if (hits.some((h) => h.status === 'PASS')) return 'PASS'; if (hits.some((h) => h.status === 'BLOCKED')) return 'BLOCKED'; return 'INFO'; };
const sweep = JSON.parse(fs.readFileSync(path.join(here, 'sweep.json'), 'utf8'));
const pageSweep = (p) => sweep.filter((s) => s.page.split('?')[0] === p || s.page.split('?')[0].replace(/\/[^/]+$/, '/[x]') === p);
const newman = JSON.parse(fs.readFileSync(path.join(here, '..', 'newman.json'), 'utf8'));
const nmByPath = {};
for (const e of newman.run.executions) { const u = e.request.url; const p = '/' + (u.path || []).join('/'); const key = e.request.method + ' ' + p.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id').replace(/\/(BKG|TRF|TUR|ORD|SVC|APR|PTR)-\d+/g, '/:ref'); const failed = (e.assertions || []).some((a) => a.error); nmByPath[key] = nmByPath[key] || { n: 0, failed: 0 }; nmByPath[key].n++; if (failed) nmByPath[key].failed++; }

// ---- pages
const pageDefs = [
  // [route, module, feature, roles, api, priority, matcher over check ids/features]
  ['/', 'Public site', 'Home page', 'All', 'catalogue', 'High', (r) => /^SW-PUB/.test(r.id) && / \/$/.test(r.feature)],
  ['/hotels', 'Hotels', 'Hotel listing + dated search form', 'All', 'GET /hotels, /search', 'Critical', (r) => /^(UH1|UH2|SW-PUB.*hotels$)/.test(r.id + ' ' + r.feature) || r.id === 'UH1' || r.id === 'UH2'],
  ['/hotels/[slug]', 'Hotels', 'Hotel detail, live room offers, reserve', 'All', 'GET /hotels/:slug, /search/hotels/:slug', 'Critical', (r) => ['UH3', 'UH4'].includes(r.id)],
  ['/booking/checkout', 'Hotel booking', 'Checkout form, hold countdown, validation, confirm', 'All', 'POST /bookings/holds, POST /bookings', 'Critical', (r) => ['UH4b', 'UH5', 'UH5b', 'UH6', 'UH7'].includes(r.id)],
  ['/booking/confirmation/[ref]', 'Hotel booking', 'Confirmation page', 'All', 'GET /bookings/:ref', 'Critical', (r) => ['UH8', 'UH8b', 'UH9'].includes(r.id)],
  ['/booking/manage', 'Hotel booking', 'Find my booking (reference + email)', 'Guest', 'GET /bookings/:ref', 'High', (r) => ['UH10', 'UH11'].includes(r.id)],
  ['/booking/manage/[ref]', 'Hotel booking', 'Manage: view, cancel with quote', 'Guest', 'cancellation-quote, cancel', 'Critical', (r) => ['UH12', 'UH13', 'UH14'].includes(r.id)],
  ['/tours', 'Tours', 'Tour listing', 'All', 'GET /tours', 'High', (r) => /^SW-PUB/.test(r.id) && r.feature === 'page /tours'],
  ['/tours/[slug]', 'Tours', 'Tour detail (B2C) + departures', 'All', 'GET /tours/:slug, /search/tours/:slug', 'High', (r) => /^SW-PUB/.test(r.id) && r.feature === 'page /tours/kakheti-wine-route'],
  ['/tours/checkout', 'Tours', 'Tour checkout (UI)', 'All', 'POST /tours/bookings', 'High', () => false],
  ['/packages', 'Packages', 'Package listing', 'All', 'GET /packages', 'High', (r) => /^SW-PUB/.test(r.id) && /\/packages$/.test(r.feature)],
  ['/packages/[slug]', 'Packages', 'Package detail + quote', 'All', 'GET /packages/:slug/quote', 'High', (r) => /^SW-PUB/.test(r.id) && /\/packages\/kakheti/.test(r.feature)],
  ['/packages/checkout', 'Packages', 'Package checkout (UI)', 'All', 'POST /orders', 'High', () => false],
  ['/transfers', 'Transfers', 'Transfer landing + search widget', 'All', 'GET /transfers/points', 'High', (r) => /^SW-PUB/.test(r.id) && /\/transfers$/.test(r.feature)],
  ['/transfers/search', 'Transfers', 'Results, filters, vehicle cards', 'All', 'GET /transfers/quotes', 'Critical', (r) => ['UT1', 'UT1b'].includes(r.id)],
  ['/transfers/[slug]', 'Transfers', 'Vehicle detail with journey', 'All', 'GET /transfers/vehicles/:slug', 'High', (r) => r.id === 'UT1b'],
  ['/transfers/booking', 'Transfers', 'Passenger details form, validation, confirm', 'All', 'POST /transfers/bookings', 'Critical', (r) => ['UT2', 'UT2b', 'UT3', 'UT3b', 'UT4', 'UT4b'].includes(r.id)],
  ['/transfers/confirmation/[ref]', 'Transfers', 'Transfer confirmation', 'All', 'GET /transfers/bookings/:ref', 'Critical', (r) => ['UT5', 'UT5b', 'UT5c'].includes(r.id)],
  ['/transfers/routes/[slug]', 'Transfers', 'Route landing page', 'All', 'GET /transfers/routes/:slug', 'Medium', (r) => /^SW-PUB/.test(r.id) && /transfers\/routes\//.test(r.feature)],
  ['/transfers/rate/[token]', 'Transfers', 'Passenger rates the driver (emailed link)', 'Guest', 'POST /transfers/ratings', 'Medium', () => false],
  ['/experiences, /experiences/[slug]', 'Public site', 'Experiences (page returns notFound by design)', 'All', '-', 'Low', (r) => /^SW-PUB/.test(r.id) && /\/experiences$/.test(r.feature)],
  ['/destinations, /destinations/[slug]', 'Public site', 'Destinations (page returns notFound by design)', 'All', 'GET /destinations', 'Low', (r) => /^SW-PUB/.test(r.id) && /\/destinations$/.test(r.feature)],
  ['/about, /contact, /privacy, /terms, /cookies', 'Public site', 'Static pages', 'All', '-', 'Low', (r) => /^SW-PUB/.test(r.id) && /\/(about|contact|privacy|terms|cookies)$/.test(r.feature)],
  ['/forgot-password, /reset-password/[token]', 'Auth', 'Password reset request + reset form', 'All', 'POST /auth/password/forgot, /reset/:token', 'High', (r) => r.id === 'A10'],
  ['/activate/[token]', 'Auth', 'Account activation (set password)', 'Invited users', 'GET/POST /auth/activation/:token', 'High', (r) => ['UA7', 'UA8'].includes(r.id)],
  ['/partners/register/[token]', 'Partners', 'Partner registration wizard (UI)', 'Invited partner', 'GET/POST /invitations/:token', 'High', () => false],
  ['/[locale]/* (ka, ru, he RTL)', 'i18n', 'Localised routes incl. RTL Hebrew', 'All', 'locale param', 'High', (r) => /^SW-PUB/.test(r.id) && /\/(ka|ru|he)/.test(r.feature)],
  ['/admin/sign-in', 'Auth', 'Staff sign-in', 'Staff', 'POST /auth/login', 'Critical', (r) => ['A1', 'A2', 'A5', 'A6'].includes(r.id)],
  ['/portal/sign-in', 'Auth', 'Partner sign-in', 'Partners', 'POST /auth/login', 'Critical', (r) => ['A7', 'A7b', 'A8'].includes(r.id)],
  ['/driver/sign-in', 'Auth', 'Driver sign-in', 'Drivers', 'POST /auth/login', 'High', (r) => ['A9', 'A9b'].includes(r.id)],
  ['/admin (dashboard)', 'Admin', 'Dashboard, badges, summary', 'Staff', 'GET /admin/badges, /admin/bookings/summary', 'High', (r) => /^SW-SA/.test(r.id) && / \/admin$/.test(r.feature)],
  ['/admin/bookings, /admin/bookings/[id]', 'Admin bookings', 'Hotel bookings register, detail, cancel, requests', 'bookings.read/cancel', 'GET /admin/bookings*, POST cancel', 'Critical', (r) => ['UA1', 'UA10', 'W50', 'W50b', 'H21', 'H22'].includes(r.id) || (/^SW-SA/.test(r.id) && /\/admin\/bookings/.test(r.feature))],
  ['/admin/transfers/bookings[/ref]', 'Admin transfers', 'Transfer bookings register + detail', 'bookings.read', 'GET /admin/transfers/bookings*', 'High', (r) => /^SW-SA/.test(r.id) && /transfers\/bookings/.test(r.feature) || r.id === 'T22'],
  ['/admin/tours/bookings[/ref]', 'Admin tours', 'Tour bookings register, confirm/decline requests', 'bookings.write', 'GET/POST /admin/tours/bookings*', 'High', (r) => /^SW-SA/.test(r.id) && /tours\/bookings/.test(r.feature) || r.id === 'U17'],
  ['/admin/orders[/ref]', 'Admin orders', 'Orders register, on-request queue, item actions', 'bookings.write', '/admin/orders*', 'High', (r) => /^SW-SA/.test(r.id) && /\/admin\/orders/.test(r.feature)],
  ['/admin/transfers/dispatch', 'Dispatch', 'Legs board, candidates, assign, status', 'dispatch.*', '/admin/transfers/dispatch/*', 'Critical', (r) => /^T2[1-9]|^T3[0-3]/.test(r.id) || (/^SW-SA/.test(r.id) && /dispatch/.test(r.feature))],
  ['/admin/transfers/schedule, /ratings', 'Dispatch', 'Schedule view, ratings moderation', 'dispatch.read', 'dispatch/schedule, dispatch/ratings', 'Medium', (r) => /^SW-SA/.test(r.id) && /(schedule|ratings)$/.test(r.feature)],
  ['/admin/transfers/fleet[/id|new]', 'Fleet', 'Fleet cars CRUD, images, documents', 'dispatch.write', '/admin/transfers/fleet/*', 'High', (r) => /^SW-SA/.test(r.id) && /\/fleet/.test(r.feature) || r.id === 'R2'],
  ['/admin/transfers/drivers[/id|new]', 'Fleet', 'Drivers CRUD, verify, account, documents', 'dispatch.write', '/admin/transfers/drivers/*', 'High', (r) => /^SW-SA/.test(r.id) && /\/drivers/.test(r.feature)],
  ['/admin/transfers/routes|points|vehicles|extras', 'Transfer catalogue', 'Routes, points, vehicle classes, extras CRUD + bulk prices', 'catalogue.write', '/admin/transfers/*', 'High', (r) => /^SW-SA/.test(r.id) && /transfers\/(routes|points|vehicles|extras)/.test(r.feature) || r.id === 'R3'],
  ['/admin/destinations[/id|new]', 'Reference data', 'Destinations CRUD, translations, place pin', 'catalogue.write', '/admin/destinations/*', 'Medium', (r) => ['UA2', 'UA3', 'UA4'].includes(r.id)],
  ['/admin/hotels[/slug/*|new]', 'Hotels admin', 'Hotel register, details, rooms, calendar, images, location, kosher, publish', 'catalogue.write, pricing.write', '/admin/hotels/*', 'Critical', (r) => /^W(2[0-7]|3[0-5])$/.test(r.id) || (/^SW-SA/.test(r.id) && /\/admin\/hotels/.test(r.feature))],
  ['/admin/tours[/slug/*|new]', 'Tours admin', 'Tour register, options, seasons, departures, images, translations, publish', 'tours.write', '/admin/tours/*', 'High', (r) => /^W3[6-8]$/.test(r.id) || r.id === 'R23' || (/^SW-SA/.test(r.id) && /\/admin\/tours/.test(r.feature))],
  ['/admin/packages[/slug/*|new]', 'Packages admin', 'Package templates, components, kosher profile, preview quote', 'catalogue.write', '/admin/packages/*', 'High', (r) => /^SW-SA/.test(r.id) && /\/admin\/packages/.test(r.feature)],
  ['/admin/services[/id]', 'Services admin', 'Services register, publish, bookings', 'catalogue.write', '/admin/services/*', 'Medium', (r) => /^W(39|4[0-2])$/.test(r.id) || (/^SW-SA/.test(r.id) && /\/admin\/services/.test(r.feature))],
  ['/admin/partners[/id|new|applications]', 'Partners admin', 'Partner lifecycle: invite, approve (contract gate), suspend, block, terminate, terms, product access, financial', 'partners.*', '/admin/partners/*', 'Critical', (r) => /^W(1\d?|[2-9])$|^W1[0-8]$/.test(r.id) || /^R[5-7]$/.test(r.id) || (/^SW-SA/.test(r.id) && /\/admin\/partners/.test(r.feature))],
  ['/admin/finance (overview)', 'Finance', 'Finance overview, payments-due panel', 'finance.*.read', '/admin/finance/due, reports/summary', 'High', (r) => ['Q27', 'Q28', 'F24'].includes(r.id) || (/^SW-SA/.test(r.id) && / \/admin\/finance$/.test(r.feature))],
  ['/admin/finance/payables[/id]', 'Finance', 'Supplier payables, instalments, pay, override/waive via approval', 'finance.payables.read, payments.write', '/admin/finance/payables*', 'Critical', (r) => ['Q25', 'F27'].includes(r.id) || (/^SW-SA/.test(r.id) && /payables/.test(r.feature))],
  ['/admin/finance/receivables[/id]', 'Finance', 'Receivables, due date, waive via approval, notes', 'finance.receivables.read', '/admin/finance/receivables*', 'Critical', (r) => /^F(5|6|8|9|19b|22|23)$/.test(r.id) || ['Q26'].includes(r.id)],
  ['/admin/finance/payments[/id]', 'Finance', 'Record payments, allocations, idempotency, refunds', 'finance.payments.write', 'POST /admin/finance/payments', 'Critical', (r) => /^F(1|1b|2|3|4|7|13|13b)$/.test(r.id)],
  ['/admin/finance/approvals[/id]', 'Finance', 'Maker-checker approvals (refund, override, waive)', 'finance.*.approve', '/admin/approvals/*', 'Critical', (r) => /^F(1[4-9]|20|21)$/.test(r.id)],
  ['/admin/finance/penalties', 'Finance', 'Cancellation penalties register', 'finance.receivables.read', '/admin/finance/penalties', 'Medium', (r) => r.id === 'H28' || (/^SW-SA/.test(r.id) && /penalties/.test(r.feature))],
  ['/admin/finance/reports', 'Finance', 'Summary, margin, ageing, commission reports + CSV export', 'finance.reports.read, export', '/admin/finance/reports/*', 'High', (r) => /^F(24|25|26|29)$/.test(r.id)],
  ['/admin/finance/terms/[kind]/[id]', 'Finance', 'Supplier payment terms editor', 'finance.terms.write', '/admin/finance/terms/:kind/:id', 'Medium', (r) => r.id === 'R22'],
  ['Partner credit limits', 'Finance', 'Credit limit BLOCK/WARN enforcement at booking', 'partners.credit.write', '/admin/finance/partners/:id/credit', 'Critical', (r) => /^F3[1-5]/.test(r.id)],
  ['/admin/users[/id]', 'Staff', 'Invite staff, roles, overrides, deactivate, sessions', 'users.staff.manage', '/admin/users/*', 'Critical', (r) => /^UA[6-9]$/.test(r.id) || ['R8', 'R9', 'R10', 'A23', 'Q32'].includes(r.id)],
  ['/admin/roles[/key|new]', 'Staff', 'Role editor (capabilities as data)', 'roles.manage', '/admin/roles/*', 'High', (r) => ['UA5', 'UA5b', 'R11'].includes(r.id)],
  ['/admin/audit', 'Audit', 'Audit log browser + filters', 'audit.read', '/admin/audit', 'High', (r) => ['W51', 'W55', 'Q29', 'Q30', 'R12', 'R13'].includes(r.id)],
  ['/admin/notifications', 'Notifications', 'Staff notifications, mark read', 'notifications.read', '/admin/notifications/*', 'Medium', (r) => /^W5[2-4]$/.test(r.id)],
  ['/admin/help/*', 'Help', 'Help centre articles', 'Staff', '-', 'Low', (r) => /^SW-SA/.test(r.id) && /\/admin\/help/.test(r.feature)],
  ['Admin shell', 'Admin', 'Sidebar by capability, account menu, sign-out', 'Staff', 'POST /auth/logout', 'High', (r) => ['UA11', 'A3', 'A4', 'A15'].includes(r.id)],
  ['/portal (status) + /portal/terms', 'Portal', 'Status panel, terms acceptance gate', 'Partners', 'GET/POST /partner/terms', 'Critical', (r) => /^G[1-6]/.test(r.id) || (/^SW-P/.test(r.id) && /terms/.test(r.feature))],
  ['/portal/dashboard', 'Portal', 'Partner dashboard + stats', 'partner.bookings.read', 'GET /partner/dashboard', 'High', (r) => r.id === 'UP-/portal/dashboard' || r.id === 'G5'],
  ['/portal/bookings[/ref]', 'Portal', 'Own bookings (hotel/transfer/tour/orders), detail, cancel', 'partner.bookings.*', '/partner/bookings, /partner/orders…', 'Critical', (r) => ['UP-/portal/bookings', 'UP-detail', 'U14', 'P12'].includes(r.id)],
  ['Portal booking editors (hotel, tour, transfer)', 'Portal', 'B2B booking creation incl. preferred driver', 'partner.bookings.write', 'POST /bookings, /tours/bookings, /transfers/bookings, /partner/drivers/available', 'Critical', (r) => ['U9', 'U10', 'F00', 'P6'].includes(r.id)],
  ['/portal/finance', 'Portal', 'Statement, credit, commission', 'partner.statement.read', '/partner/finance/*', 'High', (r) => ['F11', 'F12', 'F30', 'UP-/portal/finance'].includes(r.id)],
  ['/portal/team', 'Portal', 'Team members, invitations, roles (capability subset)', 'partner.team.manage', '/partner/team/*', 'High', (r) => ['R15', 'R16', 'R36', 'R37', 'UP-team'].includes(r.id)],
  ['/portal/settings', 'Portal', 'Company profile, bank details, account', 'partner.profile.write, financial.*', 'PATCH /partner/profile, /partner/financial', 'High', (r) => ['R17', 'UP-/portal/settings'].includes(r.id)],
  ['/portal/notifications', 'Portal', 'Partner notifications', 'notifications.read', '/partner/notifications/*', 'Medium', (r) => ['UP-/portal/notifications', 'UP-notif'].includes(r.id) || (/^SW-P/.test(r.id) && /notifications/.test(r.feature))],
  ['/portal/drivers/[id]', 'Portal', 'Driver public profile + reviews', 'Partners', 'GET /partner/drivers/:id', 'Low', () => false],
  ['Supplier extranet (hotel owner)', 'Portal', 'Own hotels, room types, inventory + rates editing', 'PARTNER_OWNER/ADMIN', '/partner/hotels/*', 'Critical', (r) => /^R(18|19|3[0-5])$/.test(r.id)],
  ['/driver (today/upcoming/history)', 'Driver panel', 'Jobs, accept/decline, status milestones', 'DRIVER', '/driver/assignments/*', 'Critical', (r) => /^T(27|28|29|30|33)/.test(r.id) || /^SW-DRV/.test(r.id) || r.id === 'UD2'],
  ['/driver/me', 'Driver panel', 'Own profile edit (phone, languages, bio)', 'DRIVER', 'PATCH /driver/me', 'Medium', (r) => r.id === 'UD1'],
  ['/driver/notifications', 'Driver panel', 'Driver notifications', 'DRIVER', '/driver/notifications', 'Low', (r) => /^SW-DRV/.test(r.id) && /notifications/.test(r.feature)],
];
let inv = '| ID | Module | Feature | Route | Roles | Backend/API | Priority | Status |\n|---|---|---|---|---|---|---|---|\n';
const counts = {};
pageDefs.forEach(([route, mod, feat, roles, apiS, prio, pred], i) => { const st = statusOf(pred); counts[st] = (counts[st] || 0) + 1; inv += `| F${String(i + 1).padStart(3, '0')} | ${mod} | ${feat} | ${route} | ${roles} | ${apiS} | ${prio} | ${st} |\n`; });
fs.writeFileSync(path.join(here, 'inventory.md'), inv);
console.log('FEATURES', pageDefs.length, JSON.stringify(counts));

// ---- API endpoint coverage: our scripts (by observed calls is not tracked) → use newman + server tests + our checks heuristically
const endpoints = fs.readFileSync(path.join(here, '..', 'endpoints.txt'), 'utf8').split(/\r?\n/).filter((l) => /^   /.test(l)).map((l) => l.trim());
const norm = (s) => s.replace(/:[a-zA-Z]+/g, ':id');
let covered = 0; const rows = [];
for (const ep of endpoints) { const [m, p] = ep.split(' '); const key = m + ' ' + norm(p).replace(/\/:id/g, '/:id'); const nm = Object.entries(nmByPath).find(([k]) => k.split(' ')[0] === m && norm(k.split(' ')[1]).replace(/\/:ref/g, '/:id') === key.split(' ')[1]); if (nm) covered++; rows.push({ ep, newman: nm ? `${nm[1].n} req, ${nm[1].failed} failed` : '' }); }
fs.writeFileSync(path.join(here, 'endpoint-coverage.md'), '| Endpoint | Newman coverage |\n|---|---|\n' + rows.map((r) => `| ${r.ep} | ${r.newman || '—'} |`).join('\n'));
console.log('ENDPOINTS', endpoints.length, 'covered by newman (path match):', covered);
