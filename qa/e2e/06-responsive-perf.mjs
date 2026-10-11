// Phase 7 (responsive) + Phase 9 (performance) — viewport sweeps with real interactions, web-vitals timings, API latency.
import fs from 'node:fs';
import { launch, newPage, shot, record, USERS, CLIENT, API, api, apiLogin, loginViaApi, sleep } from './lib.mjs';

const browser = await launch();
const VIEWPORTS = [['desktop', 1920, 1080], ['laptop', 1366, 768], ['tablet', 768, 1024], ['mobile', 390, 844], ['small', 375, 667]];
const PUBLIC = ['/', '/hotels', '/hotels/vera-house-tbilisi?checkIn=2026-11-20&checkOut=2026-11-22&adults=2', '/tours', '/tours/kakheti-wine-route', '/packages', '/transfers', '/transfers/search?from=tbilisi-airport&to=gudauri&date=2026-11-20&time=10:00&adults=2&children=0&luggage=2&cabinBags=0', '/booking/manage', '/he', '/he/hotels'];
const ADMIN = ['/admin', '/admin/bookings', '/admin/hotels', '/admin/finance/payables', '/admin/transfers/dispatch'];
const PORTAL = ['/portal/dashboard', '/portal/bookings', '/portal/finance'];
const overflow = async (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, wide: [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed').slice(0, 3).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '')) }));
const results = [];

const ONLY = (process.env.VP || '').split(',').filter(Boolean);
for (const [name, w, h] of VIEWPORTS) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const { context, page } = await newPage(browser, { viewport: { width: w, height: h } });
  for (const p of PUBLIC) {
    await page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(300);
    const o = await overflow(page);
    const ok = o.sw <= o.iw + 1;
    results.push({ vp: name, page: p, ...o, ok });
    if (!ok) await shot(page, `R-${name}${p.split('?')[0]}`);
    record(`RV-${name}`, `no horizontal overflow ${p.split('?')[0]}`, ok ? 'PASS' : 'FAIL', `scrollWidth=${o.sw} innerWidth=${o.iw} ${o.wide.join(',')}`);
  }
  // mobile interactions
  if (w <= 768) {
    await page.goto(`${CLIENT}/`, { waitUntil: 'networkidle' });
    const burger = page.locator('header button:not([aria-haspopup="menu"]):visible').first();
    if (await burger.count()) { try {
      await burger.click({ timeout: 10000 }); await page.waitForTimeout(400);
      const link = page.getByRole('link', { name: /^hotels$/i }).first();
      const visible = await link.isVisible().catch(() => false);
      if (visible) { await link.click(); await page.waitForURL(/\/hotels/, { timeout: 10000 }).catch(() => {}); }
      record(`RM-${name}`, 'mobile menu opens and Hotels link navigates', visible && /\/hotels/.test(page.url()) ? 'PASS' : 'FAIL', `visible=${visible} url=${page.url().replace(CLIENT, '')}`);
    } catch (e) { record(`RM-${name}`, 'mobile menu interaction', 'FAIL', String(e.message).slice(0, 120)); } } else record(`RM-${name}`, 'mobile menu button', 'FAIL', 'no header menu button');
    // search form usable at this width
    await page.goto(`${CLIENT}/hotels`, { waitUntil: 'networkidle' });
    const d = page.locator('main input[type="date"]');
    if (await d.count() >= 2) {
      await d.nth(0).fill('2026-11-20'); await d.nth(1).fill('2026-11-22');
      const btn = page.locator('main button[type="submit"]').first();
      const box = await btn.boundingBox();
      await btn.click(); await page.waitForURL(/checkIn=/, { timeout: 15000 }).catch(() => {});
      record(`RS-${name}`, 'hotel search form submits at mobile width (button within viewport)', box && box.x + box.width <= w + 1 && /checkIn=2026-11-20/.test(page.url()) ? 'PASS' : 'FAIL', `btn=${JSON.stringify(box)} url=${page.url().replace(CLIENT, '').slice(0, 50)}`);
    }
    // tap target sizes on the listing
    const small = await page.evaluate(() => [...document.querySelectorAll('main a, main button')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24); }).length);
    record(`RT-${name}`, 'tap targets ≥24px on the hotel listing', small === 0 ? 'PASS' : 'INFO', `small targets=${small}`);
  }
  await context.close();
}

// admin + portal at desktop and mobile
for (const [name, w, h] of [['laptop', 1366, 768], ['mobile', 390, 844]]) {
  const { context, page } = await newPage(browser, { viewport: { width: w, height: h } });
  await loginViaApi(context, USERS.superadmin);
  for (const p of ADMIN) {
    await page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' });
    const o = await overflow(page);
    record(`RA-${name}`, `admin no horizontal overflow ${p}`, o.sw <= o.iw + 1 ? 'PASS' : 'FAIL', `scrollWidth=${o.sw} innerWidth=${o.iw} ${o.wide.join(',')}`);
    if (o.sw > o.iw + 1) await shot(page, `RA-${name}${p}`);
  }
  if (w < 1024) {
    await page.goto(`${CLIENT}/admin`, { waitUntil: 'networkidle' });
    const burger = page.locator('button[aria-label="Open navigation"], button[aria-label*="navigation" i], button[aria-label*="menu" i]').first();
    if (await burger.count()) { try {
      await burger.click({ timeout: 10000 }); await page.waitForTimeout(400);
      const link = page.getByRole('link', { name: /^bookings$/i }).first();
      const vis = await link.isVisible().catch(() => false);
      if (vis) await link.click();
      await page.waitForURL(/\/admin\/bookings/, { timeout: 10000 }).catch(() => {});
      record('RA-mobile-nav', 'admin sidebar opens on mobile and navigates', vis && /\/admin\/bookings/.test(page.url()) ? 'PASS' : 'FAIL', `visible=${vis} url=${page.url().replace(CLIENT, '')}`);
    } catch (e) { record('RA-mobile-nav', 'admin mobile nav interaction', 'FAIL', String(e.message).slice(0, 120)); } } else record('RA-mobile-nav', 'admin mobile menu button', 'FAIL', 'not found');
    // a table page: does it scroll inside its container rather than the page?
    await page.goto(`${CLIENT}/admin/bookings`, { waitUntil: 'networkidle' });
    const tbl = await page.evaluate(() => { const t = document.querySelector('main table'); if (!t) return null; let el = t.parentElement; while (el && el !== document.body) { const cs = getComputedStyle(el); if (/auto|scroll/.test(cs.overflowX)) return { wrapped: true, cls: el.className.slice(0, 40) }; el = el.parentElement; } return { wrapped: false }; });
    record('RA-mobile-table', 'bookings table is wrapped in a horizontally scrollable container on mobile', tbl === null ? 'INFO' : tbl.wrapped ? 'PASS' : 'FAIL', JSON.stringify(tbl));
  }
  await context.close();
  const c2 = await newPage(browser, { viewport: { width: w, height: h } });
  await loginViaApi(c2.context, USERS.agencyOwner);
  for (const p of PORTAL) {
    await c2.page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' });
    const o = await overflow(c2.page);
    record(`RP-${name}`, `portal no horizontal overflow ${p}`, o.sw <= o.iw + 1 ? 'PASS' : 'FAIL', `scrollWidth=${o.sw} innerWidth=${o.iw} ${o.wide.join(',')}`);
  }
  await c2.context.close();
}

// ===================== PERFORMANCE: web vitals-ish timings per page (cold, laptop)
{
  const perf = [];
  for (const p of ['/', '/hotels', '/hotels/vera-house-tbilisi?checkIn=2026-11-20&checkOut=2026-11-22&adults=2', '/tours', '/transfers/search?from=tbilisi-airport&to=gudauri&date=2026-11-20&time=10:00&adults=2&children=0&luggage=2&cabinBags=0', '/packages/kakheti-wine-weekend']) {
    const { context, page } = await newPage(browser);
    await page.addInitScript(() => { window.__lcp = 0; window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
    await page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => { const nav = performance.getEntriesByType('navigation')[0]; const res = performance.getEntriesByType('resource'); const js = res.filter((r) => /\.js(\?|$)/.test(r.name)); const img = res.filter((r) => r.initiatorType === 'img' || /_next\/image/.test(r.name)); return { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), lcp: Math.round(window.__lcp), cls: Number(window.__cls.toFixed(3)), requests: res.length + 1, jsKB: Math.round(js.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024), imgKB: Math.round(img.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024), totalKB: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024), apiCalls: res.filter((r) => r.name.includes(':5000/')).length }; });
    perf.push({ page: p.split('?')[0], ...m });
    record('PF', `web timings ${p.split('?')[0]}`, m.lcp < 2500 && m.cls < 0.1 ? 'PASS' : 'INFO', `TTFB=${m.ttfb}ms DCL=${m.dcl}ms load=${m.load}ms LCP=${m.lcp}ms CLS=${m.cls} req=${m.requests} js=${m.jsKB}KB img=${m.imgKB}KB total=${m.totalKB}KB apiCalls(browser)=${m.apiCalls}`);
    await context.close();
  }
  // admin page timings + client-side navigation speed
  const { context, page } = await newPage(browser);
  await loginViaApi(context, USERS.superadmin);
  for (const p of ['/admin', '/admin/bookings', '/admin/finance', '/admin/hotels']) {
    await page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' });
    const m = await page.evaluate(() => { const nav = performance.getEntriesByType('navigation')[0]; const res = performance.getEntriesByType('resource'); return { ttfb: Math.round(nav.responseStart), load: Math.round(nav.loadEventEnd), js: Math.round(res.filter((r) => /\.js(\?|$)/.test(r.name)).reduce((a, r) => a + (r.transferSize || 0), 0) / 1024), req: res.length + 1 }; });
    perf.push({ page: p, ...m });
    record('PF', `admin timings ${p}`, m.ttfb < 1500 ? 'PASS' : 'INFO', `TTFB=${m.ttfb}ms load=${m.load}ms js=${m.js}KB req=${m.req}`);
  }
  await page.goto(`${CLIENT}/admin`, { waitUntil: 'networkidle' });
  const t0 = Date.now();
  await page.locator('aside a[href$="/admin/bookings"], nav a[href$="/admin/bookings"]').first().click();
  await page.waitForFunction(() => /Bookings/i.test(document.querySelector('main h1')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  const navMs = Date.now() - t0;
  record('PF-nav', 'client-side navigation dashboard → bookings (click to h1)', navMs < 3000 ? 'PASS' : 'INFO', `${navMs}ms`);
  await context.close();
  fs.writeFileSync(new URL('./perf.json', import.meta.url), JSON.stringify(perf, null, 2));
}

// ===================== API latency & concurrency
{
  const sa = (await apiLogin(USERS.superadmin)).token;
  const timed = async (label, fn, n = 10) => { const ts = []; let bad = 0; for (let i = 0; i < n; i++) { const t = performance.now(); const r = await fn(); ts.push(performance.now() - t); if (r.status >= 400) bad++; } ts.sort((a, b) => a - b); const p50 = Math.round(ts[Math.floor(n / 2)]), p95 = Math.round(ts[Math.floor(n * 0.95)]), max = Math.round(ts[n - 1]); record('PA', `API latency ${label} (n=${n})`, bad === 0 && p95 < 1000 ? 'PASS' : bad ? 'FAIL' : 'INFO', `p50=${p50}ms p95=${p95}ms max=${max}ms errors=${bad}`); return { label, p50, p95, max, bad }; };
  const out = [];
  out.push(await timed('GET /search (dated, 3 nights)', () => api('GET', '/api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=2')));
  out.push(await timed('GET /hotels', () => api('GET', '/api/hotels')));
  out.push(await timed('GET /transfers/quotes', () => api('GET', '/api/transfers/quotes?from=tbilisi-airport&to=gudauri&date=2026-11-15&time=10:00&adults=2')));
  out.push(await timed('GET /packages/:slug/quote', () => api('GET', '/api/packages/kakheti-wine-weekend/quote?startDate=2026-11-19&adults=2', { token: sa })));
  out.push(await timed('GET /admin/bookings', () => api('GET', '/api/admin/bookings', { token: sa })));
  out.push(await timed('GET /admin/finance/payables', () => api('GET', '/api/admin/finance/payables', { token: sa })));
  out.push(await timed('GET /admin/finance/reports/summary', () => api('GET', '/api/admin/finance/reports/summary?currency=GEL', { token: sa })));
  out.push(await timed('GET /admin/audit', () => api('GET', '/api/admin/audit', { token: sa })));
  out.push(await timed('GET /admin/transfers/dispatch/legs', () => api('GET', '/api/admin/transfers/dispatch/legs?from=2026-11-01&to=2026-11-30', { token: sa })));
  // concurrency burst
  const t = performance.now();
  const burst = await Promise.all(Array.from({ length: 30 }, () => api('GET', '/api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=2')));
  const ms = Math.round(performance.now() - t);
  record('PA-burst', '30 concurrent dated searches all succeed', burst.every((b) => b.status === 200) ? 'PASS' : 'FAIL', `wall=${ms}ms statuses=${[...new Set(burst.map((b) => b.status))].join(',')}`);
  const t2 = performance.now();
  const burst2 = await Promise.all(Array.from({ length: 30 }, () => api('GET', '/api/transfers/quotes?from=tbilisi-airport&to=gudauri&date=2026-11-15&time=10:00&adults=2')));
  record('PA-burst2', '30 concurrent transfer quotes all succeed', burst2.every((b) => b.status === 200) ? 'PASS' : 'FAIL', `wall=${Math.round(performance.now() - t2)}ms`);
  fs.writeFileSync(new URL('./api-latency.json', import.meta.url), JSON.stringify(out, null, 2));
  await api('POST', '/api/auth/logout', { token: sa });
}
await browser.close();
