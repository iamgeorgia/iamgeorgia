// Phase 3.1 — visit every page per role, follow the first detail link of each list,
// and collect JS errors, failed requests and error-boundary text.
import fs from 'node:fs';
import { launch, newPage, shot, record, USERS, CLIENT, API, loginViaApi, summarizeErrors, resetErrors, sleep } from './lib.mjs';

const ADMIN_PAGES = [
  '/admin', '/admin/bookings', '/admin/transfers/bookings', '/admin/tours/bookings', '/admin/orders',
  '/admin/transfers/dispatch', '/admin/destinations', '/admin/destinations/new', '/admin/hotels', '/admin/hotels/new',
  '/admin/transfers', '/admin/transfers/routes', '/admin/transfers/routes/new', '/admin/transfers/points', '/admin/transfers/points/new',
  '/admin/transfers/vehicles', '/admin/transfers/vehicles/new', '/admin/transfers/extras', '/admin/transfers/fleet', '/admin/transfers/fleet/new',
  '/admin/transfers/drivers', '/admin/transfers/drivers/new', '/admin/transfers/schedule', '/admin/transfers/ratings',
  '/admin/tours', '/admin/tours/new', '/admin/packages', '/admin/packages/new', '/admin/services',
  '/admin/partners', '/admin/partners/new', '/admin/partners/applications',
  '/admin/finance', '/admin/finance/payables', '/admin/finance/receivables', '/admin/finance/payments', '/admin/finance/approvals',
  '/admin/finance/penalties', '/admin/finance/reports', '/admin/users', '/admin/roles', '/admin/roles/new', '/admin/audit',
  '/admin/notifications', '/admin/help',
];
const PORTAL_PAGES = ['/portal', '/portal/dashboard', '/portal/bookings', '/portal/finance', '/portal/settings', '/portal/team', '/portal/notifications', '/portal/terms'];
const DRIVER_PAGES = ['/driver', '/driver/upcoming', '/driver/history', '/driver/me', '/driver/notifications'];
const PUBLIC_PAGES = [
  '/', '/about', '/contact', '/destinations', '/hotels', '/tours', '/experiences', '/packages', '/transfers', '/transfers/search',
  '/privacy', '/terms', '/cookies', '/booking/manage', '/forgot-password', '/this-page-does-not-exist',
  '/ka', '/ru', '/he', '/he/hotels', '/ka/tours',
];

const ERROR_TEXT = /(something went wrong|application error|unhandled|internal server error|this page could not be found|404)/i;
const IGNORE_HTTP = [/\/api\/auth\/me$/, /favicon/, /_next\/static/, /speed-insights|vitals/];
const out = [];

async function visit(page, role, p) {
  resetErrors(page);
  let status = null;
  const t0 = Date.now();
  try {
    const resp = await page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle', timeout: 45000 });
    status = resp?.status() ?? null;
  } catch (e) {
    out.push({ role, page: p, status: 'NAV_ERROR', note: String(e.message).slice(0, 120) });
    record(`SW-${role}`, `page ${p}`, 'FAIL', `navigation error: ${String(e.message).slice(0, 100)}`);
    return;
  }
  const ms = Date.now() - t0;
  const finalUrl = page.url().replace(CLIENT, '');
  const h1 = (await page.locator('h1').first().textContent().catch(() => '') || '').trim().slice(0, 60);
  const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
  const errText = ERROR_TEXT.test(bodyText.slice(0, 4000)) && !/does-not-exist/.test(p) ? (bodyText.match(ERROR_TEXT) || [])[0] : '';
  const e = summarizeErrors(page, { ignore: IGNORE_HTTP });
  const http = e.http.filter((h) => !(h.status === 404 && /does-not-exist/.test(p)));
  const bad = status >= 400 && !/does-not-exist/.test(p) ? `HTTP ${status}` : '';
  const problems = [bad, errText && `error text "${errText}"`, e.pageerrors.length && `${e.pageerrors.length} JS error(s): ${e.pageerrors[0].text.slice(0, 100)}`, http.length && `${http.length} failed API call(s): ${http.slice(0, 2).map((h) => h.status + ' ' + h.url.replace(API, '')).join('; ')}`, e.console.length && `${e.console.length} console error(s): ${e.console[0].text.slice(0, 100)}`].filter(Boolean);
  const row = { role, page: p, finalUrl, status, ms, h1, problems, consoleErrors: e.console.slice(0, 3), http: http.slice(0, 5), pageerrors: e.pageerrors.slice(0, 3) };
  out.push(row);
  if (problems.length) await shot(page, `SW-${role}${p}`);
  record(`SW-${role}`, `page ${p}`, problems.length ? 'FAIL' : 'PASS', `${status} ${ms}ms h1="${h1}" ${finalUrl !== p ? '→ ' + finalUrl : ''} ${problems.join(' | ')}`);
  return row;
}

async function followFirstDetail(page, role, listPath, prefix) {
  const links = page.locator(`main a[href^="${prefix}/"]`);
  const n = await links.count();
  let href = null;
  for (let i = 0; i < n; i++) {
    const h = await links.nth(i).getAttribute('href');
    if (h && h.startsWith(prefix + '/') && !/\/(new|applications|bookings|dispatch|routes|points|vehicles|extras|fleet|drivers|schedule|ratings|payables|receivables|payments|approvals|penalties|reports|terms)$/.test(h)) { href = h; break; }
  }
  if (!href) { record(`SW-${role}`, `detail of ${listPath}`, 'NOT TESTED', 'no detail link found on list'); return; }
  await visit(page, role, href.replace(/^\/en/, ''));
  return href;
}

const browser = await launch();

// ---- superadmin admin sweep
{
  const { context, page } = await newPage(browser);
  await loginViaApi(context, USERS.superadmin);
  for (const p of ADMIN_PAGES) { await visit(page, 'SA', p); await sleep(150); }
  // detail pages: follow the first row link on each list
  const detailLists = [
    ['/admin/bookings', '/admin/bookings'], ['/admin/transfers/bookings', '/admin/transfers/bookings'], ['/admin/tours/bookings', '/admin/tours/bookings'],
    ['/admin/orders', '/admin/orders'], ['/admin/destinations', '/admin/destinations'], ['/admin/hotels', '/admin/hotels'],
    ['/admin/transfers/routes', '/admin/transfers/routes'], ['/admin/transfers/points', '/admin/transfers/points'], ['/admin/transfers/vehicles', '/admin/transfers/vehicles'],
    ['/admin/transfers/fleet', '/admin/transfers/fleet'], ['/admin/transfers/drivers', '/admin/transfers/drivers'], ['/admin/tours', '/admin/tours'],
    ['/admin/packages', '/admin/packages'], ['/admin/services', '/admin/services'], ['/admin/partners', '/admin/partners'],
    ['/admin/finance/payables', '/admin/finance/payables'], ['/admin/finance/receivables', '/admin/finance/receivables'], ['/admin/finance/payments', '/admin/finance/payments'],
    ['/admin/finance/approvals', '/admin/finance/approvals'], ['/admin/users', '/admin/users'], ['/admin/roles', '/admin/roles'], ['/admin/help', '/admin/help'],
  ];
  const details = {};
  for (const [list, prefix] of detailLists) {
    await visit(page, 'SA', list);
    const href = await followFirstDetail(page, 'SA', list, prefix);
    if (href) details[list] = href;
    await sleep(150);
  }
  // sub-tabs of hotel / tour / package detail
  for (const [list, subs] of [['/admin/hotels', ['details', 'rooms', 'calendar', 'images', 'location', 'kosher']], ['/admin/tours', ['details', 'options', 'departures', 'images', 'translations']], ['/admin/packages', ['details', 'components', 'images', 'kosher', 'preview', 'translations']]]) {
    const base = details[list];
    if (!base) continue;
    for (const s of subs) { await visit(page, 'SA', `${base.replace(/^\/en/, '')}/${s}`); await sleep(150); }
  }
  // help article
  await visit(page, 'SA', '/admin/help');
  const art = await page.locator('main a[href*="/admin/help/"]').first().getAttribute('href').catch(() => null);
  if (art) { await visit(page, 'SA', art.replace(/^\/en/, '')); const art2 = await page.locator('main a[href*="/admin/help/"]').first().getAttribute('href').catch(() => null); if (art2) await visit(page, 'SA', art2.replace(/^\/en/, '')); }
  fs.writeFileSync(new URL('./sweep-details.json', import.meta.url), JSON.stringify(details, null, 2));
  await context.close();
}

// ---- partner portal sweep (agency owner, hotel owner, transfer owner)
for (const [who, email] of [['PO-agency', USERS.agencyOwner], ['PO-hotel', USERS.hotelOwner], ['PO-transfer', USERS.transferOwner], ['PF-agencyfin', USERS.agencyFinance]]) {
  const { context, page } = await newPage(browser);
  await loginViaApi(context, email);
  for (const p of PORTAL_PAGES) { await visit(page, who, p); await sleep(150); }
  await visit(page, who, '/portal/bookings');
  const href = await page.locator('main a[href*="/portal/bookings/"]').first().getAttribute('href').catch(() => null);
  if (href) await visit(page, who, href.replace(/^\/en/, '')); else record(`SW-${who}`, 'portal booking detail', 'NOT TESTED', 'no booking link');
  if (who === 'PO-transfer') {
    const d = await page.goto(`${CLIENT}/portal/settings`).then(() => page.locator('main a[href*="/portal/drivers/"]').first().getAttribute('href').catch(() => null));
    if (d) await visit(page, who, d.replace(/^\/en/, ''));
  }
  await context.close();
}

// ---- driver sweep
{
  const { context, page } = await newPage(browser);
  await loginViaApi(context, 'ana.lomidze@demo.iamgeorgia.test', 'driver-demo-password');
  for (const p of DRIVER_PAGES) { await visit(page, 'DRV', p); await sleep(150); }
  const href = await page.goto(`${CLIENT}/driver/upcoming`).then(() => page.locator('main a[href*="/driver/assignments/"]').first().getAttribute('href').catch(() => null));
  if (href) await visit(page, 'DRV', href.replace(/^\/en/, '')); else record('SW-DRV', 'driver assignment detail', 'NOT TESTED', 'no assignment link');
  await context.close();
}

// ---- public sweep (anonymous)
{
  const { context, page } = await newPage(browser);
  for (const p of PUBLIC_PAGES) { await visit(page, 'PUB', p); await sleep(100); }
  // detail pages from the API
  const j = async (u) => (await (await fetch(`${API}${u}`)).json());
  const hotel = (await j('/api/hotels?pageSize=1')).data?.[0]?.slug;
  const tour = (await j('/api/tours?pageSize=1')).data?.[0]?.slug;
  const pkg = (await j('/api/packages?pageSize=1')).data?.[0]?.slug;
  const dest = (await j('/api/destinations')).data?.find((d) => !/^dest-/.test(d.slug))?.slug;
  for (const p of [hotel && `/hotels/${hotel}`, tour && `/tours/${tour}`, pkg && `/packages/${pkg}`, dest && `/destinations/${dest}`, hotel && `/he/hotels/${hotel}`, tour && `/ka/tours/${tour}`].filter(Boolean)) { await visit(page, 'PUB', p); await sleep(100); }
  // experiences + transfer route from links on their index pages
  for (const [idx, sel] of [['/experiences', 'main a[href*="/experiences/"]'], ['/transfers', 'main a[href*="/transfers/routes/"], main a[href*="/transfers/"]']]) {
    await page.goto(`${CLIENT}${idx}`, { waitUntil: 'networkidle' });
    const hrefs = await page.locator(sel).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    const h = hrefs.find((x) => x && !/\/(search|booking)$/.test(x) && x !== idx && x !== `/en${idx}`);
    if (h) await visit(page, 'PUB', h.replace(/^\/en/, '')); else record('SW-PUB', `detail of ${idx}`, 'NOT TESTED', 'no link');
  }
  // protected routes anonymous
  for (const p of ['/admin', '/admin/hotels', '/portal/bookings', '/driver/upcoming']) {
    await page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' });
    record('SW-ANON', `anonymous ${p} → sign-in`, /sign-in/.test(page.url()) ? 'PASS' : 'FAIL', page.url());
  }
  await context.close();
}

fs.writeFileSync(new URL('./sweep.json', import.meta.url), JSON.stringify(out, null, 2));
const failed = out.filter((r) => r.problems?.length || r.status === 'NAV_ERROR');
console.log(`\nSWEEP: ${out.length} page loads, ${failed.length} with problems`);
for (const f of failed) console.log(` - [${f.role}] ${f.page}: ${(f.problems || [f.note]).join(' | ')}`);
await browser.close();
