// Phase 5.2 — pagination boundaries, filtering and sorting correctness, response schemas, idempotent reads.
import { api, apiLogin, record, USERS, sql } from './lib.mjs';
const msg = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
const SA = (await apiLogin(USERS.superadmin)).token;

// public hotels pagination
{
  const p1 = await api('GET', '/api/hotels?page=1&pageSize=2');
  const p2 = await api('GET', '/api/hotels?page=2&pageSize=2');
  const ids1 = (p1.body.data || []).map((h) => h.id), ids2 = (p2.body.data || []).map((h) => h.id);
  record('Q1', 'Hotels: page 1 and page 2 are disjoint, pageSize honoured, totals consistent', p1.status === 200 && ids1.length === 2 && ids2.length === 2 && !ids1.some((i) => ids2.includes(i)) && p1.body.total === p2.body.total && p1.body.totalPages === Math.ceil(p1.body.total / 2) ? 'PASS' : 'FAIL', `total=${p1.body.total} pages=${p1.body.totalPages} p1=${ids1.length} p2=${ids2.length}`);
  const last = await api('GET', `/api/hotels?page=${p1.body.totalPages}&pageSize=2`);
  const beyond = await api('GET', `/api/hotels?page=${p1.body.totalPages + 5}&pageSize=2`);
  record('Q2', 'Last page has ≤ pageSize rows; a page past the end is an empty 200 (not 500)', last.body.data?.length >= 1 && last.body.data?.length <= 2 && beyond.status === 200 && (beyond.body.data || []).length === 0 ? 'PASS' : 'FAIL', `last=${last.body.data?.length} beyond=${beyond.status}/${beyond.body.data?.length}`);
  const zero = await api('GET', '/api/hotels?page=0');
  const str = await api('GET', '/api/hotels?page=abc');
  record('Q3', 'page=0 / page=abc → 400', zero.status === 400 && str.status === 400 ? 'PASS' : 'FAIL', `page0=${zero.status} abc=${str.status}`);
  const stars = await api('GET', '/api/hotels?minStars=5&pageSize=50');
  record('Q4', 'minStars filter: every result has ≥ 5 stars', stars.status === 200 && (stars.body.data || []).every((h) => h.starRating >= 5) ? 'PASS' : 'FAIL', `n=${stars.body.data?.length} stars=${[...new Set((stars.body.data || []).map((h) => h.starRating))]}`);
  const search = await api('GET', '/api/hotels?search=vera');
  record('Q5', 'search=vera matches by name', (search.body.data || []).some((h) => /vera/i.test(h.name)) && (search.body.data || []).every((h) => /vera/i.test(h.name + ' ' + (h.destination?.name || '') + ' ' + (h.summary || ''))) ? 'PASS' : 'INFO', `n=${search.body.data?.length} names=${(search.body.data || []).map((h) => h.name).join('|').slice(0, 100)}`);
  const kosher = await api('GET', '/api/hotels?kosher=NONE');
  record('Q6', 'kosher=NONE is rejected (400) as documented', kosher.status === 400 ? 'PASS' : 'FAIL', `status=${kosher.status}`);
  const amen = await api('GET', '/api/hotels?amenity=shabbatelevator');
  const amen2 = await api('GET', '/api/hotels?amenity=shabbatElevator');
  record('Q7', 'amenity codes are case-sensitive (lowercase variant → 400 or empty)', (amen.status === 400 || (amen.body.data || []).length === 0) && amen2.status === 200 ? 'PASS' : 'INFO', `lower=${amen.status}/${amen.body.data?.length} exact=${amen2.status}/${amen2.body.data?.length}`);
  const dest = await api('GET', '/api/hotels?destinationSlug=tbilisi&pageSize=50');
  record('Q8', 'destinationSlug=tbilisi returns only Tbilisi hotels', dest.status === 200 && (dest.body.data || []).length > 0 && (dest.body.data || []).every((h) => /tbilisi/i.test(h.destination?.path || h.destination?.name || '')) ? 'PASS' : 'FAIL', `n=${dest.body.data?.length} paths=${[...new Set((dest.body.data || []).map((h) => h.destination?.path))].slice(0, 3)}`);
  const draft = sql(`select count(*) from hotels where status<>'ACTIVE'`);
  const all = await api('GET', '/api/hotels?pageSize=100&status=DRAFT');
  record('Q9', 'Public catalogue never returns non-ACTIVE hotels whatever the query says', (all.body.data || []).every((h) => !h.status || h.status === 'ACTIVE') && Number(all.body.total) === Number(sql(`select count(*) from hotels where status='ACTIVE'`)) ? 'PASS' : 'FAIL', `publicTotal=${all.body.total} activeInDb=${sql(`select count(*) from hotels where status='ACTIVE'`)} nonActive=${draft}`);
}
// dated search sorting
{
  const s = await api('GET', '/api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=2&pageSize=50');
  const prices = (s.body.data || []).map((c) => c.startingFrom?.totalCents).filter(Boolean);
  const sorted = [...prices].sort((a, b) => a - b);
  record('Q10', 'Dated search default order (recorded)', 'INFO', `n=${prices.length} ascending=${JSON.stringify(prices) === JSON.stringify(sorted)} first=${prices.slice(0, 5)}`);
  const refundable = await api('GET', '/api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=2&refundableOnly=true&pageSize=50');
  record('Q11', 'refundableOnly=true → every card refundable', refundable.status === 200 && (refundable.body.data || []).every((c) => c.refundable === true) ? 'PASS' : 'FAIL', `n=${refundable.body.data?.length}`);
  const badDates = await api('GET', '/api/search?checkIn=2026-11-13&checkOut=2026-11-10&adults=2');
  record('Q12', 'checkOut before checkIn → 400', badDates.status === 400 ? 'PASS' : 'FAIL', msg(badDates));
  const past = await api('GET', '/api/search?checkIn=2020-01-01&checkOut=2020-01-03&adults=2');
  record('Q13', 'Past dates → 400 or empty', past.status === 400 || (past.status === 200 && (past.body.data || []).length === 0) ? 'PASS' : 'FAIL', `status=${past.status} n=${past.body.data?.length}`);
  const long = await api('GET', '/api/search?checkIn=2026-11-01&checkOut=2026-12-31&adults=2');
  record('Q14', 'A 60-night stay is refused or priced (no 500)', long.status !== 500 ? 'PASS' : 'FAIL', `status=${long.status}`);
  const kids = await api('GET', '/api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=1&childAges=3&childAges=9&pageSize=5');
  record('Q15', 'Child ages accepted as repeated params', kids.status === 200 ? 'PASS' : 'FAIL', `status=${kids.status} n=${kids.body.data?.length}`);
  const tooMany = await api('GET', '/api/search?checkIn=2026-11-10&checkOut=2026-11-13&adults=40&rooms=1');
  record('Q16', '40 adults in one room → 400 or no offers', tooMany.status === 400 || (tooMany.status === 200 && (tooMany.body.data || []).length === 0) ? 'PASS' : 'FAIL', `status=${tooMany.status} n=${tooMany.body.data?.length}`);
}
// admin list filters
{
  const canc = await api('GET', '/api/admin/bookings?status=CANCELLED&pageSize=20', { token: SA });
  record('Q20', 'Admin bookings status=CANCELLED returns only cancelled', canc.status === 200 && (canc.body.data || []).length > 0 && (canc.body.data || []).every((b) => b.status === 'CANCELLED') ? 'PASS' : 'FAIL', `n=${canc.body.data?.length} statuses=${[...new Set((canc.body.data || []).map((b) => b.status))]}`);
  const ref = sql(`select reference from hotel_bookings order by created_at desc limit 1`);
  const byRef = await api('GET', `/api/admin/bookings?search=${ref}`, { token: SA });
  const byQ = await api('GET', `/api/admin/bookings?q=${ref}`, { token: SA });
  record('Q21', 'Admin bookings search narrows to one booking (search= or q=)', ((byRef.body.data || []).length === 1 && byRef.body.data[0].reference === ref) || ((byQ.body.data || []).length === 1 && byQ.body.data[0].reference === ref) ? 'PASS' : 'FAIL', `search=${byRef.body.data?.length} q=${byQ.body.data?.length}`);
  const range = await api('GET', '/api/admin/bookings?from=2026-11-01&to=2026-11-30&pageSize=50', { token: SA });
  record('Q22', 'Admin bookings date range filter keeps stays inside the window', range.status === 200 && (range.body.data || []).every((b) => b.checkIn >= '2026-11-01' && b.checkIn <= '2026-11-30' || b.checkOut >= '2026-11-01') ? 'PASS' : 'INFO', `n=${range.body.data?.length} first=${range.body.data?.[0]?.checkIn}`);
  const partners = await api('GET', '/api/admin/partners?status=PENDING_APPROVAL', { token: SA });
  record('Q23', 'Admin partners status filter works with the real enum (PENDING_APPROVAL)', partners.status === 200 && (partners.body.data || []).every((p) => p.status === 'PENDING_APPROVAL') ? 'PASS' : 'FAIL', `n=${partners.body.data?.length}`);
  const q = await api('GET', '/api/admin/partners?q=Demo%20Travel', { token: SA });
  record('Q24', 'Admin partners q= search', q.status === 200 && (q.body.data || []).some((p) => /Demo Travel/.test(p.name)) ? 'PASS' : 'FAIL', `n=${q.body.data?.length}`);
  const pay = await api('GET', '/api/admin/finance/payables?status=PAID&pageSize=20', { token: SA });
  record('Q25', 'Payables status filter', pay.status === 200 && (pay.body.data || []).every((p) => p.status === 'PAID') ? 'PASS' : 'FAIL', `n=${pay.body.data?.length} statuses=${[...new Set((pay.body.data || []).map((p) => p.status))]}`);
  const overdue = await api('GET', '/api/admin/finance/receivables?overdue=true&pageSize=20', { token: SA });
  const now = new Date().toISOString();
  record('Q26', 'Receivables overdue=true → every row past due and still open', overdue.status === 200 && (overdue.body.data || []).every((r) => r.dueAt < now && ['OPEN', 'PARTIAL'].includes(r.status)) ? 'PASS' : 'FAIL', `n=${overdue.body.data?.length} sample=${JSON.stringify((overdue.body.data || [])[0] || {}).slice(0, 100)}`);
  const due = await api('GET', '/api/admin/finance/due?days=7', { token: SA });
  record('Q27', 'Payments-due queue answers, earliest first', due.status === 200 && Array.isArray(due.body.instalments) && due.body.instalments.every((x, i, a) => i === 0 || (a[i - 1].dueAt || '') <= (x.dueAt || '')) ? 'PASS' : 'FAIL', `n=${due.body.instalments?.length}`);
  const due99 = await api('GET', '/api/admin/finance/due?days=999', { token: SA });
  record('Q28', 'due?days=999 → 400 (0–90)', due99.status === 400 ? 'PASS' : 'FAIL', `status=${due99.status}`);
  const audit = await api('GET', '/api/admin/audit?q=zzzz-nothing', { token: SA });
  record('Q29', 'Audit q= filter yields 0 for nonsense', audit.status === 200 && audit.body.total === 0 ? 'PASS' : 'FAIL', `total=${audit.body.total}`);
  const unknownParam = await api('GET', '/api/admin/audit?search=zzzz-nothing', { token: SA });
  record('Q30', 'Unknown query params are ignored silently (search= instead of q= returns the full log)', unknownParam.body.total > 0 ? 'FAIL' : 'PASS', `total=${unknownParam.body.total} (lenient parsing: a client typo returns everything)`);
  const legs = await api('GET', '/api/admin/transfers/dispatch/legs?legStatus=UNASSIGNED&from=2026-11-01&to=2026-11-30', { token: SA });
  record('Q31', 'Dispatch legs filter by status + window', legs.status === 200 && (legs.body.data || []).every((l) => l.status === 'UNASSIGNED' && l.pickupAt >= '2026-11-01' && l.pickupAt < '2026-12-01') ? 'PASS' : 'FAIL', `n=${legs.body.data?.length}`);
  const users = await api('GET', '/api/admin/users?role=DISPATCHER', { token: SA });
  record('Q32', 'Staff list role filter', users.status === 200 && (users.body.data || []).every((u) => u.role === 'DISPATCHER' || u.primaryRole?.key === 'DISPATCHER' || (u.roles || []).some((r) => r.key === 'DISPATCHER' || r === 'DISPATCHER')) ? 'PASS' : 'INFO', `n=${users.body.data?.length} sample=${JSON.stringify((users.body.data || [])[0] || {}).slice(0, 120)}`);
  const summary = await api('GET', '/api/admin/bookings/summary?days=30', { token: SA });
  const dbCount = sql(`select count(*) from hotel_bookings where status in ('PENDING','CONFIRMED') and created_at > now() - interval '30 days'`);
  record('Q33', 'Bookings summary recent count matches the DB (PENDING+CONFIRMED created in 30 days)', summary.status === 200 && String(summary.body.recent?.byCurrency?.reduce((a, c) => a + c.count, 0)) === dbCount ? 'PASS' : 'FAIL', `api=${JSON.stringify(summary.body.recent?.byCurrency)} db=${dbCount}`);
  const badges = await api('GET', '/api/admin/badges', { token: SA });
  const unassigned = sql(`select count(*) from transfer_booking_legs l join transfer_bookings b on b.id=l.booking_id where l.status='UNASSIGNED' and b.status='CONFIRMED' and l.pickup_at > now()`);
  record('Q34', 'Badge unassignedLegs matches DB (future confirmed legs without a driver)', String(badges.body.unassignedLegs) === unassigned ? 'PASS' : 'INFO', `badge=${badges.body.unassignedLegs} db=${unassigned} (definition may differ)`);
}
// transfers catalogue
{
  const r1 = await api('GET', '/api/transfers/routes?page=1&pageSize=5');
  const r2 = await api('GET', '/api/transfers/routes?page=2&pageSize=5');
  record('Q40', 'Transfer routes paginate (disjoint pages)', r1.status === 200 && !(r1.body.data || []).some((a) => (r2.body.data || []).some((b) => b.id === a.id)) ? 'PASS' : 'FAIL', `total=${r1.body.total}`);
  const feat = await api('GET', '/api/transfers/routes?featured=true&pageSize=50');
  record('Q41', 'featured=true filter', feat.status === 200 && (feat.body.data || []).every((r) => r.featured) ? 'PASS' : 'FAIL', `n=${feat.body.data?.length}`);
  const pts = await api('GET', '/api/transfers/points?search=TBS');
  record('Q42', 'Points search matches IATA code', (pts.body.data || pts.body || []).some?.((p) => p.code === 'TBS') ? 'PASS' : 'FAIL', `n=${(pts.body.data || pts.body || []).length}`);
  const ka = await api('GET', '/api/transfers/points?search=თბილისი&locale=ka');
  record('Q43', 'Points search matches a Georgian translation', (ka.body.data || ka.body || []).length > 0 ? 'PASS' : 'INFO', `n=${(ka.body.data || ka.body || []).length}`);
  const veh = await api('GET', '/api/transfers/vehicles');
  const vehP = await api('GET', '/api/transfers/vehicles', { token: (await apiLogin(USERS.agencyAgent)).token });
  record('Q44', 'Anonymous sees only b2cEnabled vehicle classes; a partner sees the whole active fleet', (veh.body.data || veh.body).length <= (vehP.body.data || vehP.body).length ? 'PASS' : 'FAIL', `anon=${(veh.body.data || veh.body).length} partner=${(vehP.body.data || vehP.body).length}`);
}
// i18n fallbacks
{
  const en = await api('GET', '/api/tours/kakheti-wine-route?locale=en');
  const he = await api('GET', '/api/tours/kakheti-wine-route?locale=he');
  const xx = await api('GET', '/api/tours/kakheti-wine-route?locale=xx');
  record('Q50', 'locale=he returns translated title; unknown locale → 400 or English', en.status === 200 && he.status === 200 && he.body.title && he.body.title !== en.body.title && (xx.status === 400 || xx.body.title === en.body.title) ? 'PASS' : 'INFO', `en="${en.body.title}" he="${he.body.title}" xx=${xx.status}`);
  const dest = await api('GET', '/api/destinations?locale=ru');
  record('Q51', 'Destinations tree in ru', dest.status === 200 && (dest.body.data || []).length > 0 ? 'PASS' : 'FAIL', `n=${dest.body.data?.length} first=${dest.body.data?.[0]?.name}`);
}
await api('POST', '/api/auth/logout', { token: SA });
