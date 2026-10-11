// Re-runs the exact checks that failed in the 2026-10-10 audit, against the fixed build.
import { randomUUID } from 'node:crypto';
import { launch, newPage, record, USERS, CLIENT, API, api, apiLogin, loginViaApi, summarizeErrors, sql } from './lib.mjs';
const msg = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;

// BUG-001 — dated tour search
const u2 = await api('GET', '/api/search/tours?date=2026-11-20&adults=2');
record('FX-001', 'BUG-001 GET /search/tours?date= answers 200 with priced tours', u2.status === 200 && (u2.body.data || []).length > 0 ? 'PASS' : 'FAIL', `${u2.status} n=${u2.body.data?.length}`);
const susp = (await apiLogin(USERS.suspendedOwner)).token;
const r21 = await api('GET', '/api/search/tours?date=2026-11-20&adults=2', { token: susp });
record('FX-001b', 'BUG-001 suspended partner browsing the dated catalogue gets 200', r21.status === 200 ? 'PASS' : 'FAIL', `${r21.status}`);
await api('POST', '/api/auth/logout', { token: susp });

// BUG-002 — per-visitor search limit through the relay (API started with API_CLIENT_TOKEN=qa-relay-token, RATE_LIMIT_SEARCH default 30)
const relay = (i) => fetch(`${API}/api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=2`, { headers: { 'x-client-token': 'qa-relay-token', 'x-visitor-address': `198.51.100.${i}` } }).then((r) => r.status);
const distinct = await Promise.all(Array.from({ length: 40 }, (_, i) => relay(i + 1)));
record('FX-002', 'BUG-002 40 concurrent dated searches for 40 distinct visitors all succeed', distinct.every((s) => s === 200) ? 'PASS' : 'FAIL', `statuses=${[...new Set(distinct)].join(',')}`);
const one = await Promise.all(Array.from({ length: 40 }, () => relay(250)));
record('FX-002b', 'BUG-002 one visitor is still capped at 30/min', one.filter((s) => s === 200).length === 30 && one.filter((s) => s === 429).length === 10 ? 'PASS' : 'FAIL', `200=${one.filter((s) => s === 200).length} 429=${one.filter((s) => s === 429).length}`);

// BUG-003 — order replay after the holds are spent
{
  const agent = (await apiLogin(USERS.agencyAgent)).token;
  let quote = null, pkg = null;
  for (const p of (await api('GET', '/api/packages?pageSize=50', { token: agent })).body.data.filter((x) => !/^(req|order|cancel)-/.test(x.slug))) {
    for (const start of ['2026-11-12', '2026-11-19', '2026-12-03']) { const q = await api('GET', `/api/packages/${p.slug}/quote?startDate=${start}&adults=2`, { token: agent }); if (q.status === 200 && q.body.available && q.body.token) { quote = q.body; pkg = p; break; } }
    if (quote) break;
  }
  if (quote) {
    const holds = await api('POST', '/api/orders/holds', { token: agent, body: { packageToken: quote.token } });
    const key = randomUUID();
    const body = { packageToken: quote.token, holdTokens: holds.body.holdTokens, leadGuest: { firstName: 'Qa', lastName: 'Replay', email: 'qa.replay@example.test' }, travellers: [{ type: 'ADULT', firstName: 'Qa', lastName: 'Replay' }, { type: 'ADULT', firstName: 'Two', lastName: 'Replay' }] };
    const od = await api('POST', '/api/orders', { token: agent, headers: { 'idempotency-key': key }, body });
    const rep = await api('POST', '/api/orders', { token: agent, headers: { 'idempotency-key': key }, body });
    record('FX-003', 'BUG-003 order replay with spent hold tokens returns 200 and the same reference', od.status === 201 && rep.status === 200 && rep.body.reference === od.body.reference ? 'PASS' : 'FAIL', `create=${od.status} ${od.body.reference} replay=${msg(rep).slice(0, 80)}`);
    if (od.body.reference) await api('POST', `/api/orders/${od.body.reference}/cancel`, { token: agent, body: { reason: 'QA cleanup' } });
  } else record('FX-003', 'order replay', 'BLOCKED', 'no available package quote');
  await api('POST', '/api/auth/logout', { token: agent });
}

// BUG-006 — refundCents on the transfer quote
{
  const pts = await api('GET', '/api/transfers/points?search=airport');
  const from = (pts.body.data || pts.body).find((p) => p.kind === 'AIRPORT');
  const q = await api('GET', `/api/transfers/quotes?from=${from.slug}&to=gudauri&date=2026-11-25&time=10:00&adults=2`);
  const o = (q.body.offers || []).find((x) => x.vehicle.kind === 'PRIVATE') || q.body.offers[0];
  const b = await api('POST', '/api/transfers/bookings', { headers: { 'idempotency-key': randomUUID() }, body: { quoteToken: o.token, leadPassenger: { firstName: 'Qa', lastName: 'Refund', email: 'qa.refund@example.test', phone: '+995555000321' } } });
  const cq = await api('GET', `/api/transfers/bookings/${b.body.reference}/cancellation-quote?email=qa.refund@example.test`);
  record('FX-006', 'BUG-006 transfer cancellation quote says refundCents (alias kept) and charge + refund = total', cq.status === 200 && typeof cq.body.refundCents === 'number' && cq.body.refundableCents === cq.body.refundCents && cq.body.chargeCents + cq.body.refundCents === b.body.totalCents ? 'PASS' : 'FAIL', msg(cq));
  await api('POST', `/api/transfers/bookings/${b.body.reference}/cancel`, { body: { email: 'qa.refund@example.test', reason: 'QA cleanup' } });
}

// BUG-007 — service sell below net on PATCH
{
  const sa = (await apiLogin(USERS.superadmin)).token;
  const pol = await api('GET', '/api/admin/tours/policies/cancellation', { token: sa });
  const s = await api('POST', '/api/admin/services', { token: sa, body: { slug: `qa-fx-service-${Date.now()}`, name: 'QA fx service', category: 'GUIDE', basis: 'PER_GROUP', netCents: 10000, cancellationPolicyId: (pol.body.data || pol.body)[0].id, summary: 'QA' } });
  const below = await api('PATCH', `/api/admin/services/${s.body.id}`, { token: sa, body: { sellCents: 5000 } });
  record('FX-007', 'BUG-007 PATCH sell below net → 422 SELL_BELOW_NET naming both figures', below.status === 422 && below.body.error?.details?.reason === 'SELL_BELOW_NET' && below.body.error.details.netCents === 10000 ? 'PASS' : 'FAIL', msg(below));
  await api('DELETE', `/api/admin/services/${s.body.id}`, { token: sa });
  // BUG-008 — strict audit query + no-op profile audit
  const typo = await api('GET', '/api/admin/audit?search=zzz', { token: sa });
  const real = await api('GET', '/api/admin/audit?q=zzz-nothing', { token: sa });
  record('FX-008', 'BUG-008 audit ?search= is a 400; ?q= still filters', typo.status === 400 && real.status === 200 && real.body.total === 0 ? 'PASS' : 'FAIL', `typo=${typo.status} q=${real.status}/${real.body.total}`);
  await api('POST', '/api/auth/logout', { token: sa });
  const owner = (await apiLogin(USERS.agencyOwner)).token;
  const me = await api('GET', '/api/partner/me', { token: owner });
  const pid = me.body.id || me.body.partner?.id;
  const before = Number(sql(`select count(*) from audit_logs where entity_id='${pid}' and action='PARTNER_UPDATED'`));
  const noop = await api('PATCH', '/api/partner/profile', { token: owner, body: { status: 'SUSPENDED', commissionRateBps: 0, city: me.body.city || me.body.partner?.city } });
  const after = Number(sql(`select count(*) from audit_logs where entity_id='${pid}' and action='PARTNER_UPDATED'`));
  record('FX-008b', 'BUG-008 partner profile PATCH with nothing to change writes no audit row (and still ignores status/commission)', noop.status === 200 && after === before && sql(`select status from partners where id='${pid}'`) === 'APPROVED' ? 'PASS' : 'FAIL', `${noop.status} audit ${before}→${after}`);
  await api('POST', '/api/auth/logout', { token: owner });
}

// BUG-004, BUG-010, BUG-005 — browser
const browser = await launch();
{
  // BUG-004: a partner with outdated terms → notifications page redirects to /portal/terms
  const sa = (await apiLogin(USERS.superadmin)).token;
  const ownerTok = (await apiLogin(USERS.hotelOwner)).token;
  const me = await api('GET', '/api/partner/me', { token: ownerTok });
  const pid = me.body.id || me.body.partner?.id;
  const acceptedAt = sql(`select terms_accepted_at from partners where id='${pid}'`);
  sql(`update partners set terms_version = null, terms_accepted_at = null, terms_accepted_by_user_id = null where id='${pid}'`);
  const { context, page } = await newPage(browser);
  await loginViaApi(context, USERS.hotelOwner);
  const r = await page.goto(`${CLIENT}/portal/notifications`, { waitUntil: 'networkidle' });
  record('FX-004', 'BUG-004 /portal/notifications before terms acceptance redirects to /portal/terms (no 500)', r.status() === 200 && /\/portal\/terms/.test(page.url()) ? 'PASS' : 'FAIL', `status=${r.status()} url=${page.url().replace(CLIENT, '')}`);
  // restore: accept via API as the owner
  const t = await api('GET', '/api/partner/terms', { token: ownerTok });
  await api('POST', '/api/partner/terms/accept', { token: ownerTok, body: { version: t.body.current } });
  await context.close(); await api('POST', '/api/auth/logout', { token: ownerTok }); await api('POST', '/api/auth/logout', { token: sa });
}
{
  const { context, page } = await newPage(browser);
  await page.goto(`${CLIENT}/`, { waitUntil: 'networkidle' });
  const si = page.__errors.http.filter((h) => /speed-insights/.test(h.url));
  record('FX-010', 'BUG-010 no /_vercel/speed-insights request off Vercel', si.length === 0 ? 'PASS' : 'FAIL', `requests=${si.length}`);
  for (const p of ['/ka/tours', '/ka/tours/kakheti-wine-route']) {
    const p2 = await context.newPage(); const errs = []; p2.on('pageerror', (e) => errs.push(String(e.message).slice(0, 80)));
    await p2.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' }); await p2.waitForTimeout(800);
    record('FX-005', `BUG-005 ${p} hydrates without React errors`, errs.length === 0 ? 'PASS' : 'FAIL', errs.join(' | '));
    await p2.close();
  }
  await context.close();
}
await browser.close();
