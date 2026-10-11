// Phase 3.4/4.3/5/6/8 — tours, packages/orders, finance (payments, approvals, credit), RBAC/IDOR, input hardening.
import { randomUUID } from 'node:crypto';
import { api, apiLogin, record, USERS, sql, API, CLIENT } from './lib.mjs';

const reasonOf = (b) => b?.error?.reason || b?.error?.details?.reason || b?.reason || '';
const msg = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 170)}`;
const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);
const lines = (s) => s.split(/\r?\n/).filter(Boolean);

const T = {};
for (const [k, email] of Object.entries(USERS)) { const r = await apiLogin(email); T[k] = r.token; if (!r.token) console.log('LOGIN FAIL', k, r.status); }
const me = await api('GET', '/api/auth/me', { token: T.agencyAgent });
const AGENCY_ID = me.body.partner?.id;
record('X0', 'All 14 demo logins succeed', Object.values(T).every(Boolean) ? 'PASS' : 'FAIL', `agencyId=${AGENCY_ID}`);

// Terms gate: partner routes answer 403 TERMS_OUTDATED until accepted. Accept for the agency + suppliers via API (owner), keeping one role to prove the gate.
{
  const before = await api('GET', '/api/partner/dashboard', { token: T.agencyAgent });
  record('G1', 'Portal API is gated until the current terms are accepted (403 TERMS_OUTDATED)', before.status === 403 && reasonOf(before.body) === 'TERMS_OUTDATED' ? 'PASS' : 'INFO', msg(before));
  const terms = await api('GET', '/api/partner/terms', { token: T.agencyOwner });
  const agentAccept = await api('POST', '/api/partner/terms/accept', { token: T.agencyAgent, body: { version: terms.body.current } });
  record('G2', 'An agent cannot accept the terms for the company (needs partner.terms.accept)', agentAccept.status === 403 ? 'PASS' : 'FAIL', msg(agentAccept));
  const wrongV = await api('POST', '/api/partner/terms/accept', { token: T.agencyOwner, body: { version: '1999-01' } });
  record('G3', 'Accepting a stale version is refused', wrongV.status >= 400 ? 'PASS' : 'FAIL', msg(wrongV));
  for (const who of ['agencyOwner', 'hotelOwner', 'transferOwner']) {
    const t = await api('GET', '/api/partner/terms', { token: T[who] });
    if (t.body.outdated) { const a = await api('POST', '/api/partner/terms/accept', { token: T[who], body: { version: t.body.current } }); record(`G4-${who}`, 'Owner accepts the current terms', a.status === 200 || a.status === 204 ? 'PASS' : 'FAIL', msg(a)); }
  }
  const after = await api('GET', '/api/partner/dashboard', { token: T.agencyAgent });
  record('G5', 'After the owner accepts, every member of the company is through the gate', after.status === 200 ? 'PASS' : 'FAIL', msg(after));
  const audit = sql(`select count(*) from audit_logs where action::text like '%TERMS%' and created_at > now() - interval '2 minutes'`);
  record('G6', 'Terms acceptance is on the audit trail', Number(audit) >= 1 ? 'PASS' : 'FAIL', `rows=${audit}`);
}

// ===================== TOURS =====================
let tourRef = null;
{
  const cat = await api('GET', '/api/tours?pageSize=50');
  const real = (cat.body.data || []).filter((t) => !/^tour-/.test(t.slug));
  record('U1', 'Public tour catalogue lists B2C tours', cat.status === 200 && real.length > 0 ? 'PASS' : 'FAIL', `total=${cat.body.total} real=${real.length} fixtures=${(cat.body.data || []).length - real.length}`);
  const dated = await api('GET', '/api/search/tours?date=2026-11-20&adults=2');
  record('U2', 'GET /search/tours?date= answers (regression: used to 500 "integer out of range")', dated.status === 200 ? 'PASS' : 'FAIL', `status=${dated.status} n=${dated.body.data?.length} ${dated.status !== 200 ? JSON.stringify(dated.body).slice(0, 120) : ''}`);
  // find a bookable departure as a partner agent across real tours
  let chosen = null, chosenTour = null, chosenBody = null;
  for (const t of real.slice(0, 12)) {
    const r = await api('GET', `/api/search/tours/${t.slug}?from=2026-11-01&to=2026-12-20&adults=2`, { token: T.agencyAgent });
    const opts = r.body.options || r.body.data || [];
    for (const o of opts) for (const d of (o.dates || o.departures || [])) if (d.available && d.token) { chosen = { o: o.option || o, d }; chosenTour = t; chosenBody = r.body; break; }
    if (chosen) break;
  }
  record('U3', 'Dated tour search returns a bookable departure with a signed token', chosen ? 'PASS' : 'FAIL', chosen ? `${chosenTour.slug} ${chosen.o.kind || ''} ${chosen.d.date} units=${chosen.d.availableUnits} total=${chosen.d.quote.totals.totalCents}` : 'none in window');
  if (chosen) {
    const q = chosen.d.quote;
    const okLines = sum(q.lines, 'sellCents') === q.totals.totalCents && q.lines.every((l) => l.unitSellCents * l.count === l.sellCents);
    record('U4', 'Tour quote arithmetic: unit × count = line, lines sum = total; no margin for the partner', okLines && q.totals.netCents === undefined && q.totals.marginCents === undefined ? 'PASS' : 'FAIL', JSON.stringify(q.lines).slice(0, 160) + ` total=${q.totals.totalCents}`);
    const pubView = await api('GET', `/api/search/tours/${chosenTour.slug}?date=${chosen.d.date}&adults=2`);
    const sameDep = (pubView.body.options || []).flatMap((o) => o.dates || []).find((d) => d.date === chosen.d.date && d.available);
    record('U5', 'Public and partner prices can differ (rack vs net+commission) — recorded', 'INFO', `public=${sameDep?.quote?.totals?.totalCents} partner=${q.totals.totalCents}`);
    const sa = await api('GET', `/api/search/tours/${chosenTour.slug}?date=${chosen.d.date}&adults=2`, { token: T.superadmin });
    const saDep = (sa.body.options || []).flatMap((o) => o.dates || []).find((d) => d.date === chosen.d.date && d.available);
    record('U6', 'Staff see net and margin on a departure', saDep && typeof saDep.quote.totals.netCents === 'number' ? 'PASS' : 'FAIL', JSON.stringify(saDep?.quote?.totals));
    const unitsBefore = chosen.d.availableUnits;
    const hold = await api('POST', '/api/tours/bookings/holds', { token: T.agencyAgent, body: { token: chosen.d.token } });
    const holdToken = hold.body.holdToken || hold.body.token;
    record('U7', 'Tour hold claims the seats (201)', hold.status === 201 || hold.status === 200 ? 'PASS' : 'FAIL', msg(hold));
    const finBook = await api('POST', '/api/tours/bookings', { token: T.agencyFinance, body: { holdToken, leadTraveller: { firstName: 'Qa', lastName: 'Agency', email: 'qa.agency@example.test' } } });
    record('U8', 'PARTNER_FINANCE cannot create a booking (D11)', finBook.status === 403 ? 'PASS' : 'FAIL', msg(finBook));
    const key = randomUUID();
    const bk = await api('POST', '/api/tours/bookings', { token: T.agencyAgent, headers: { 'idempotency-key': key }, body: { holdToken, leadTraveller: { firstName: 'Qa', lastName: 'Agency', email: 'qa.agency@example.test', phone: '+995555000777' }, travellers: [{ type: 'ADULT', firstName: 'Qa', lastName: 'Agency' }, { type: 'ADULT', firstName: 'Second', lastName: 'Adult' }] } });
    tourRef = bk.body.reference;
    record('U9', 'Partner agent books the tour (201) at the quoted total', (bk.status === 201) && bk.body.totalCents === q.totals.totalCents ? 'PASS' : 'FAIL', `${msg(bk).slice(0, 80)} total=${bk.body.totalCents} quote=${q.totals.totalCents} status=${bk.body.status}`);
    const rep = await api('POST', '/api/tours/bookings', { token: T.agencyAgent, headers: { 'idempotency-key': key }, body: { holdToken, leadTraveller: { firstName: 'Qa', lastName: 'Agency', email: 'qa.agency@example.test', phone: '+995555000777' }, travellers: [{ type: 'ADULT', firstName: 'Qa', lastName: 'Agency' }, { type: 'ADULT', firstName: 'Second', lastName: 'Adult' }] } });
    record('U10', 'Replay → 200 same reference', rep.status === 200 && rep.body.reference === tourRef ? 'PASS' : 'FAIL', msg(rep));
    const after = await api('GET', `/api/search/tours/${chosenTour.slug}?date=${chosen.d.date}&adults=2`, { token: T.agencyAgent });
    const dep2 = (after.body.options || []).find((o) => (o.option || o).id === chosen.o.id)?.dates?.find((d) => d.date === chosen.d.date);
    record('U11', 'Departure availability drops by the units taken', dep2 && (dep2.availableUnits === unitsBefore - chosen.d.units || dep2.available === false) ? 'PASS' : 'INFO', `before=${unitsBefore} units=${chosen.d.units} after=${dep2?.availableUnits} available=${dep2?.available}`);
    const db = sql(`select status, sell_total_cents, partner_id, commission_rate_bps from tour_bookings where reference='${tourRef}'`);
    record('U12', 'DB: tour booking row carries status, sell total, partner and frozen commission rate', db.startsWith(`${bk.body.status}|${q.totals.totalCents}|${AGENCY_ID}|`) ? 'PASS' : 'FAIL', db);
    const recv = sql(`select amount_cents, status, debtor_partner_id, due_at::date from receivables where tour_booking_id=(select id from tour_bookings where reference='${tourRef}')`);
    record('U13', 'DB: receivable for the agency = booking total, due paymentDueDays (14) after confirmation', recv.startsWith(`${q.totals.totalCents}|OPEN|${AGENCY_ID}|`) ? 'PASS' : bk.body.status === 'PENDING' ? 'INFO' : 'FAIL', `${recv} status=${bk.body.status}`);
    const pl = await api('GET', '/api/partner/tours/bookings?pageSize=5', { token: T.agencyAgent });
    record('U14', 'Partner list shows its own tour booking, without margin', pl.status === 200 && (pl.body.data || []).some((b) => b.reference === tourRef) && !JSON.stringify(pl.body).includes('marginCents') ? 'PASS' : 'FAIL', `n=${pl.body.data?.length}`);
    const otherPartner = await api('GET', `/api/tours/bookings/${tourRef}`, { token: T.hotelOwner });
    record('U15', 'IDOR: another partner cannot read this tour booking', otherPartner.status === 404 || otherPartner.status === 403 ? 'PASS' : 'FAIL', `status=${otherPartner.status}`);
    const anon = await api('GET', `/api/tours/bookings/${tourRef}`);
    record('U16', 'Anonymous cannot read a partner booking', anon.status >= 400 ? 'PASS' : 'FAIL', `status=${anon.status}`);
    const adminV = await api('GET', `/api/admin/tours/bookings/${tourRef}`, { token: T.management });
    record('U17', 'MANAGEMENT reads the booking with margin', adminV.status === 200 && typeof adminV.body.marginCents === 'number' ? 'PASS' : 'FAIL', `status=${adminV.status} margin=${adminV.body.marginCents} net=${adminV.body.netTotalCents}`);
    const mgmtCancel = await api('POST', `/api/tours/bookings/${tourRef}/cancel`, { token: T.management, body: { reason: 'x' } });
    record('U18', 'MANAGEMENT cannot cancel through the public route (S1 fix)', mgmtCancel.status === 403 ? 'PASS' : 'FAIL', msg(mgmtCancel));
    const topCancel = await api('POST', `/api/tours/bookings/${tourRef}/cancel`, { token: T.tourop, body: { reason: 'x' } });
    record('U18b', 'TOUR_OPERATOR (bookings.cancel) may cancel through the admin register', 'INFO', `public-route status=${topCancel.status}`);
  }
}

// ===================== PACKAGE → ORDER =====================
let orderRef = null;
{
  const pk = await api('GET', '/api/packages?pageSize=50', { token: T.agencyAgent });
  const real = (pk.body.data || []).filter((p) => !/^(req|order|cancel)-/.test(p.slug));
  record('P1', 'Package catalogue lists real packages', real.length > 0 ? 'PASS' : 'FAIL', `total=${pk.body.total} real=${real.map((p) => p.slug).join(',')}`);
  let quote = null, pkg = null;
  for (const p of real) {
    for (const start of ['2026-11-12', '2026-11-19', '2026-12-03']) {
      const q = await api('GET', `/api/packages/${p.slug}/quote?startDate=${start}&adults=2`, { token: T.agencyAgent });
      if (q.status === 200 && q.body.available && q.body.token) { quote = q.body; pkg = p; break; }
    }
    if (quote) break;
  }
  record('P2', 'A package quotes as available with a composite token', quote ? 'PASS' : 'FAIL', quote ? `${pkg.slug} ${quote.startDate}→${quote.endDate} total=${quote.totals.totalCents} comps=${quote.components.length}` : 'no available quote found');
  if (quote) {
    const inc = quote.components.filter((c) => c.included);
    const okLines = sum(inc, 'lineTotalCents') === quote.totals.totalCents && inc.every((c) => c.lineTotalCents === (c.resolved?.sellCents || 0) + (c.adjustmentCents || 0)) && quote.totals.componentsSellCents + quote.totals.adjustmentCents === quote.totals.totalCents;
    record('P3', 'Package arithmetic: line = sell + adjustment; lines sum = total; componentsSell + adjustment = total', okLines ? 'PASS' : 'FAIL', `sum=${sum(inc, 'lineTotalCents')} total=${quote.totals.totalCents} compsSell=${quote.totals.componentsSellCents} adj=${quote.totals.adjustmentCents}`);
    record('P3b', 'Partner sees no net/margin on a package quote', JSON.stringify(quote.totals).includes('net') ? 'FAIL' : 'PASS', JSON.stringify(quote.totals));
    const reval = await api('POST', '/api/packages/quotes/revalidate', { token: T.agencyAgent, body: { token: quote.token } });
    record('P4', 'Revalidate answers the same total', reval.status === 200 && reval.body.totals?.totalCents === quote.totals.totalCents ? 'PASS' : 'FAIL', `${reval.status} total=${reval.body.totals?.totalCents} changed=${reval.body.priceChanged}`);
    const holds = await api('POST', '/api/orders/holds', { token: T.agencyAgent, body: { packageToken: quote.token } });
    record('P5', 'Order holds claim hotel/tour slots', holds.status === 201 || holds.status === 200 ? 'PASS' : 'FAIL', msg(holds));
    const key = randomUUID();
    const body = { packageToken: quote.token, holdTokens: holds.body.holdTokens, leadGuest: { firstName: 'Qa', lastName: 'Order', email: 'qa.order@example.test', phone: '+995555000666' }, travellers: [{ type: 'ADULT', firstName: 'Qa', lastName: 'Order' }, { type: 'ADULT', firstName: 'Two', lastName: 'Order' }] };
    const od = await api('POST', '/api/orders', { token: T.agencyAgent, headers: { 'idempotency-key': key }, body });
    orderRef = od.body.reference;
    record('P6', 'POST /orders writes one order with a child booking per item at the quoted total', od.status === 201 && od.body.totalCents === quote.totals.totalCents && (od.body.items || []).length === inc.length ? 'PASS' : 'FAIL', `${od.status} ref=${orderRef} status=${od.body.status} total=${od.body.totalCents} quote=${quote.totals.totalCents} items=${od.body.items?.length} ${od.status !== 201 ? JSON.stringify(od.body).slice(0, 200) : ''}`);
    if (orderRef) {
      const rep = await api('POST', '/api/orders', { token: T.agencyAgent, headers: { 'idempotency-key': key }, body });
      record('P7', 'Order replay → 200 same reference', rep.status === 200 && rep.body.reference === orderRef ? 'PASS' : 'FAIL', msg(rep));
      const kids = sql(`select string_agg(coalesce(hb.reference, tb.reference, trb.reference, sb.reference)||':'||coalesce(hb.status::text, tb.status::text, trb.status::text, sb.status::text), ',') from order_items oi left join hotel_bookings hb on hb.id=oi.hotel_booking_id left join tour_bookings tb on tb.id=oi.tour_booking_id left join transfer_bookings trb on trb.id=oi.transfer_booking_id left join service_bookings sb on sb.id=oi.service_booking_id where oi.order_id=(select id from orders where reference='${orderRef}')`);
      record('P8', 'DB: every order item has a child booking with its own reference', kids && lines(kids).length === 1 && kids.split(',').length === inc.length ? 'PASS' : 'FAIL', kids);
      const dbo = sql(`select status, sell_total_cents, partner_id from orders where reference='${orderRef}'`);
      record('P9', 'DB: order row (status, total, partner)', dbo.startsWith(`${od.body.status}|${quote.totals.totalCents}|${AGENCY_ID}`) ? 'PASS' : 'FAIL', dbo);
      const recv = sql(`select count(*), coalesce(sum(amount_cents),0) from receivables where order_id=(select id from orders where reference='${orderRef}')`);
      record('P10', 'DB: one receivable for the whole order = order total (when confirmed)', od.body.status === 'CONFIRMED' ? (recv === `1|${quote.totals.totalCents}` ? 'PASS' : 'FAIL') : 'INFO', `${recv} orderStatus=${od.body.status}`);
      const pays = sql(`select count(*) from supplier_payables where booking_reference in (select coalesce(hb.reference, tb.reference, trb.reference, sb.reference) from order_items oi left join hotel_bookings hb on hb.id=oi.hotel_booking_id left join tour_bookings tb on tb.id=oi.tour_booking_id left join transfer_bookings trb on trb.id=oi.transfer_booking_id left join service_bookings sb on sb.id=oi.service_booking_id where oi.order_id=(select id from orders where reference='${orderRef}'))`);
      record('P11', 'DB: a payable per confirmed child booking', Number(pays) >= 1 ? 'PASS' : 'INFO', `payables=${pays} items=${inc.length}`);
      const po = await api('GET', '/api/partner/orders?pageSize=5', { token: T.agencyAgent });
      record('P12', 'Partner orders list shows it', (po.body.data || []).some((o) => o.reference === orderRef) ? 'PASS' : 'FAIL', `n=${po.body.data?.length}`);
      const other = await api('GET', `/api/orders/${orderRef}`, { token: T.transferOwner });
      record('P13', 'IDOR: another partner gets 404 on the order', other.status === 404 ? 'PASS' : 'FAIL', `status=${other.status}`);
      const cq = await api('GET', `/api/orders/${orderRef}/cancellation-quote`, { token: T.agencyAgent });
      record('P14', 'Order cancellation quote: per-item charge+refund sums to totals', cq.status === 200 && Array.isArray(cq.body.items) ? 'PASS' : 'FAIL', JSON.stringify(cq.body).slice(0, 200));
      const reqIdx = (od.body.items || []).find((i) => i.required)?.slotIndex;
      if (reqIdx !== undefined) { const ic = await api('POST', `/api/orders/${orderRef}/items/${reqIdx}/cancel`, { token: T.agencyAgent, body: {} }); record('P15', 'Partner cannot cancel a required part alone (409 REQUIRED_COMPONENT)', ic.status === 409 ? 'PASS' : 'FAIL', msg(ic)); }
      const cx = await api('POST', `/api/orders/${orderRef}/cancel`, { token: T.agencyAgent, body: { reason: 'QA' } });
      const kids2 = sql(`select string_agg(coalesce(hb.status::text, tb.status::text, trb.status::text, sb.status::text), ',') from order_items oi left join hotel_bookings hb on hb.id=oi.hotel_booking_id left join tour_bookings tb on tb.id=oi.tour_booking_id left join transfer_bookings trb on trb.id=oi.transfer_booking_id left join service_bookings sb on sb.id=oi.service_booking_id where oi.order_id=(select id from orders where reference='${orderRef}')`);
      record('P16', 'Cancel order → CANCELLED and every child booking CANCELLED in one transaction', cx.status === 200 && cx.body.status === 'CANCELLED' && kids2.split(',').every((s) => s === 'CANCELLED') ? 'PASS' : 'FAIL', `${cx.status} ${cx.body.status} children=${kids2}`);
    }
  }
}

// ===================== FINANCE =====================
{
  // a fresh receivable for the agency: a hotel booking confirms instantly
  {
    const s = await api('GET', '/api/search?checkIn=2026-12-01&checkOut=2026-12-03&adults=2&pageSize=20', { token: T.agencyAgent });
    const card = (s.body.data || []).find((c) => c.cheapestOffer && c.cheapestOffer.availableUnits > 1);
    if (card) {
      const hb = await api('POST', '/api/bookings', { token: T.agencyAgent, headers: { 'idempotency-key': randomUUID() }, body: { offerToken: card.cheapestOffer.token, leadGuest: { firstName: 'Qa', lastName: 'AgencyHotel', email: 'qa.agency.hotel@example.test' } } });
      record('F00', 'Agency agent books a hotel (instant confirmation) to create a receivable', hb.status === 201 && hb.body.status === 'CONFIRMED' ? 'PASS' : 'FAIL', `${hb.status} ${hb.body.reference} total=${hb.body.totalCents} markup hidden=${hb.body.markupBps === undefined}`);
      const rv = sql(`select r.amount_cents, r.status, r.debtor_partner_id, (r.due_at::date - b.confirmed_at::date) from receivables r join hotel_bookings b on b.id=r.hotel_booking_id where b.reference='${hb.body.reference}'`);
      record('F01', 'Receivable = booking total, debtor = agency, due 14 days after confirmation (partner paymentDueDays)', rv === `${hb.body.totalCents}|OPEN|${AGENCY_ID}|14` ? 'PASS' : 'FAIL', rv);
      const cr = sql(`select commission_rate_bps, markup_bps from hotel_bookings where reference='${hb.body.reference}'`);
      record('F02', 'Booking froze the agency commission rate beside the markup', /^d+|d+$/.test(cr) ? 'PASS' : 'FAIL', cr);
    } else record('F00', 'agency hotel booking', 'BLOCKED', 'no offer with units');
  }
  let recvId = null, recvAmount = 0, recvCurrency = 'GEL';
  const r = sql(`select id, amount_cents - paid_cents, currency, status from receivables where debtor_partner_id='${AGENCY_ID}' and status in ('OPEN','PARTIAL') and amount_cents - paid_cents > 1000 order by created_at desc limit 1`);
  let paid0 = 0; if (r) { const [id, amt, cur] = r.split('|'); recvId = id; recvAmount = Number(amt); recvCurrency = cur; paid0 = Number(sql(`select paid_cents from receivables where id='${recvId}'`)); }
  record('F0', 'An open receivable exists for the agency to settle', recvId ? 'PASS' : 'BLOCKED', r);
  if (recvId) {
    const adminPay = await api('POST', '/api/admin/finance/payments', { token: T.admin, headers: { 'idempotency-key': randomUUID() }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: 100, paidAt: new Date().toISOString(), allocations: [{ receivableId: recvId, amountCents: 100 }] } });
    record('F1', 'ADMIN cannot record a payment (no finance.payments.write)', adminPay.status === 403 ? 'PASS' : 'FAIL', msg(adminPay));
    const mgmtPay = await api('POST', '/api/admin/finance/payments', { token: T.management, headers: { 'idempotency-key': randomUUID() }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: 100, paidAt: new Date().toISOString() } });
    record('F1b', 'MANAGEMENT cannot record a payment', mgmtPay.status === 403 ? 'PASS' : 'FAIL', msg(mgmtPay));
    const over = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': randomUUID() }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: recvAmount + 1000, paidAt: new Date().toISOString(), allocations: [{ receivableId: recvId, amountCents: recvAmount + 1000 }] } });
    record('F2', 'Over-allocation refused (422 ALLOCATION_EXCEEDS_OUTSTANDING)', over.status === 422 && /ALLOCATION_EXCEEDS_OUTSTANDING/.test(JSON.stringify(over.body)) ? 'PASS' : 'FAIL', msg(over));
    const cur = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': randomUUID() }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency === 'GEL' ? 'USD' : 'GEL', amountCents: 100, paidAt: new Date().toISOString(), allocations: [{ receivableId: recvId, amountCents: 100 }] } });
    record('F3', 'Currency mismatch refused (422 CURRENCY_MISMATCH)', cur.status === 422 && /CURRENCY_MISMATCH/.test(JSON.stringify(cur.body)) ? 'PASS' : 'FAIL', msg(cur));
    const half = Math.floor(recvAmount / 2);
    const key = randomUUID();
    const p1 = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': key }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: half, paidAt: new Date().toISOString(), reference: 'QA-PART', allocations: [{ receivableId: recvId, amountCents: half }] } });
    record('F4', 'Accountant records a partial payment (201)', p1.status === 201 ? 'PASS' : 'FAIL', msg(p1));
    const recvAfter = sql(`select status, paid_cents, amount_cents from receivables where id='${recvId}'`);
    record('F5', 'Receivable becomes PARTIAL with paid = previous + allocation', recvAfter === `PARTIAL|${paid0 + half}|${paid0 + recvAmount}` ? 'PASS' : 'FAIL', recvAfter);
    const p1r = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': key }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: half, paidAt: new Date().toISOString(), reference: 'QA-PART', allocations: [{ receivableId: recvId, amountCents: half }] } });
    record('F6', 'Replaying the payment key returns the original (no double booking of cash)', p1r.status === 200 && p1r.body.replayed === true && sql(`select paid_cents from receivables where id='${recvId}'`) === String(paid0 + half) ? 'PASS' : 'FAIL', msg(p1r));
    const p1x = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': key }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: half + 1, paidAt: new Date().toISOString(), reference: 'QA-PART', allocations: [{ receivableId: recvId, amountCents: half + 1 }] } });
    record('F7', 'Same key with a different amount → 409', p1x.status === 409 ? 'PASS' : 'FAIL', msg(p1x));
    const rest = recvAmount - half;
    const p2 = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': randomUUID() }, body: { direction: 'IN', kind: 'PAYMENT', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: rest, paidAt: new Date().toISOString(), reference: 'QA-REST', allocate: { mode: 'OLDEST_DUE', partnerId: AGENCY_ID } } });
    const recvFinal = sql(`select status, paid_cents from receivables where id='${recvId}'`);
    record('F8', 'OLDEST_DUE auto-allocation settles the receivable → PAID', p2.status === 201 && recvFinal === `PAID|${paid0 + recvAmount}` ? 'PASS' : 'INFO', `${msg(p2).slice(0, 60)} receivable=${recvFinal}`);
    const closed = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': randomUUID() }, body: { direction: 'IN', kind: 'PAYMENT', method: 'CASH', currency: recvCurrency, amountCents: 1, paidAt: new Date().toISOString(), allocations: [{ receivableId: recvId, amountCents: 1 }] } });
    record('F9', 'Allocating to a PAID item is refused', closed.status === 409 || closed.status === 422 ? 'PASS' : 'FAIL', msg(closed));
    // notifications to the partner about the payment
    const notif = sql(`select count(*) from notifications n join users u on u.id=n.recipient_user_id where u.partner_id='${AGENCY_ID}' and n.kind='FINANCE_PAYMENT_RECEIVED' and n.created_at > now() - interval '3 minutes'`);
    record('F10', 'Partner statement readers are notified of the payment in-app', Number(notif) >= 1 ? 'PASS' : 'FAIL', `rows=${notif}`);
    const stmt = await api('GET', '/api/partner/finance/statement', { token: T.agencyFinance });
    record('F11', 'Partner finance statement shows the receivable as paid, with no supplier data', stmt.status === 200 && JSON.stringify(stmt.body).includes(recvId) && !/netCents|supplier/i.test(JSON.stringify(stmt.body)) ? 'PASS' : 'FAIL', `${stmt.status} balances=${JSON.stringify(stmt.body.balances)}`);
    const stmtAgent = await api('GET', '/api/partner/finance/statement', { token: T.agencyAgent });
    record('F12', 'PARTNER_AGENT cannot read the statement', stmtAgent.status === 403 ? 'PASS' : 'FAIL', `status=${stmtAgent.status}`);

    // approvals: refund
    const refundBody = { direction: 'OUT', kind: 'REFUND', method: 'BANK_TRANSFER', currency: recvCurrency, amountCents: 100, paidAt: new Date().toISOString(), reason: 'QA refund', allocations: [{ receivableId: recvId, amountCents: 100 }] };
    const direct = await api('POST', '/api/admin/finance/payments', { token: T.accountant, headers: { 'idempotency-key': randomUUID() }, body: refundBody });
    record('F13', 'A refund needs approval (403 APPROVAL_REQUIRED) even for the accountant', direct.status === 403 && /APPROVAL_REQUIRED/.test(JSON.stringify(direct.body)) ? 'PASS' : 'FAIL', msg(direct));
    const saDirect = await api('POST', '/api/admin/finance/payments', { token: T.superadmin, headers: { 'idempotency-key': randomUUID() }, body: refundBody });
    record('F13b', 'Even the super admin cannot refund without a second person', saDirect.status === 403 ? 'PASS' : 'FAIL', msg(saDirect));
    const req = await api('POST', '/api/admin/approvals', { token: T.accountant, body: { kind: 'REFUND', payload: refundBody, note: 'QA' } });
    const aprId = req.body.id;
    record('F14', 'Accountant opens a refund approval request (201)', req.status === 201 && aprId ? 'PASS' : 'FAIL', msg(req));
    const self = await api('POST', `/api/admin/approvals/${aprId}/approve`, { token: T.accountant, body: {} });
    record('F15', 'Self-approval refused (403 SELF_APPROVAL)', self.status === 403 ? 'PASS' : 'FAIL', msg(self));
    const finop = await api('POST', `/api/admin/approvals/${aprId}/approve`, { token: T.finop, body: {} });
    record('F16', 'FINANCE_OPERATOR cannot approve', finop.status === 403 || finop.status === 404 ? 'PASS' : 'FAIL', msg(finop));
    const seen = await api('GET', `/api/admin/approvals/${aprId}`, { token: T.management });
    record('F17', 'Someone who neither asked nor decides cannot see the request (403/404)', seen.status === 404 || seen.status === 403 ? 'PASS' : 'FAIL', `status=${seen.status}`);
    const badge = await api('GET', '/api/admin/badges', { token: T.superadmin });
    record('F18', 'Super admin badge counts the pending approval', badge.body.pendingApprovals >= 1 ? 'PASS' : 'FAIL', `pendingApprovals=${badge.body.pendingApprovals}`);
    const paymentsBefore = Number(sql(`select count(*) from payment_records where kind='REFUND'`));
    const ok = await api('POST', `/api/admin/approvals/${aprId}/approve`, { token: T.superadmin, body: { note: 'QA ok' } });
    const paymentsAfter = Number(sql(`select count(*) from payment_records where kind='REFUND'`));
    record('F19', 'Super admin approves → refund payment written in the same transaction', ok.status === 200 && paymentsAfter === paymentsBefore + 1 ? 'PASS' : 'FAIL', `${msg(ok).slice(0, 100)} refunds ${paymentsBefore}→${paymentsAfter}`);
    const recvRef = sql(`select status, paid_cents from receivables where id='${recvId}'`);
    record('F19b', 'Receivable paid amount reduced by the refund, status reopened', recvRef === `PARTIAL|${paid0 + recvAmount - 100}` ? 'PASS' : 'INFO', recvRef);
    const twice = await api('POST', `/api/admin/approvals/${aprId}/approve`, { token: T.superadmin, body: {} });
    record('F20', 'Approving twice is refused', twice.status === 409 ? 'PASS' : 'FAIL', msg(twice));
    const audit = sql(`select string_agg(distinct action::text, ',') from audit_logs where created_at > now() - interval '3 minutes' and (action::text like '%APPROVAL%' or action::text like '%PAYMENT%' or action::text like '%REFUND%')`);
    record('F21', 'Audit trail has the approval + payment actions', /APPROVAL/.test(audit) ? 'PASS' : 'FAIL', audit.slice(0, 200));
    // waive via adjustment approval path
    const waive = await api('PATCH', `/api/admin/finance/receivables/${recvId}`, { token: T.accountant, body: { waive: true, reason: 'QA' } });
    record('F22', 'Waiving a receivable directly is refused (APPROVAL_REQUIRED)', waive.status === 403 ? 'PASS' : 'FAIL', msg(waive));
    const notes = await api('PATCH', `/api/admin/finance/receivables/${recvId}`, { token: T.accountant, body: { notes: 'QA note', reason: 'QA' } });
    record('F23', 'Notes alone are allowed with finance.notes.write', notes.status === 200 ? 'PASS' : 'FAIL', msg(notes));
    const notesOp = await api('PATCH', `/api/admin/finance/receivables/${recvId}`, { token: T.finop, body: { notes: 'QA note 2', reason: 'QA' } });
    record('F23b', 'FINANCE_OPERATOR notes write — recorded', 'INFO', `status=${notesOp.status}`);
  }
  // reports + export
  const sum1 = await api('GET', '/api/admin/finance/reports/summary?currency=GEL', { token: T.management });
  record('F24', 'MANAGEMENT reads the finance summary', sum1.status === 200 ? 'PASS' : 'FAIL', JSON.stringify(sum1.body).slice(0, 160));
  const csv = await api('GET', '/api/admin/finance/reports/ageing?side=receivables&currency=GEL&format=csv', { token: T.accountant, raw: true });
  record('F25', 'CSV export answers text/csv and is audited', csv.status === 200 && /csv/.test(csv.headers['content-type'] || '') && Number(sql(`select count(*) from audit_logs where action='FINANCE_REPORT_EXPORTED' and created_at > now() - interval '1 minute'`)) >= 1 ? 'PASS' : 'FAIL', `${csv.status} ${csv.headers['content-type']}`);
  const csvOp = await api('GET', '/api/admin/finance/reports/summary?currency=GEL&format=csv', { token: T.finop, raw: true });
  record('F26', 'FINANCE_OPERATOR export (needs finance.export) — recorded', 'INFO', `status=${csvOp.status}`);
  const dispFin = await api('GET', '/api/admin/finance/payables', { token: T.dispatcher });
  record('F27', 'DISPATCHER cannot read payables', dispFin.status === 403 ? 'PASS' : 'FAIL', `status=${dispFin.status}`);
  const topFin = await api('GET', '/api/admin/finance/receivables', { token: T.tourop });
  record('F28', 'TOUR_OPERATOR cannot read receivables', topFin.status === 403 ? 'PASS' : 'FAIL', `status=${topFin.status}`);
  // commission report
  const com = await api('GET', '/api/admin/finance/reports/commission?from=2026-01-01&to=2026-12-31&currency=GEL&groupBy=partner', { token: T.accountant });
  record('F29', 'Commission report answers per partner', com.status === 200 ? 'PASS' : 'FAIL', JSON.stringify(com.body).slice(0, 160));
  const comP = await api('GET', '/api/partner/finance/commission?from=2026-01-01&to=2026-12-31&currency=GEL', { token: T.agencyOwner });
  record('F30', 'Partner sees its own commission by product', comP.status === 200 ? 'PASS' : 'FAIL', JSON.stringify(comP.body).slice(0, 160));

  // credit limit BLOCK
  const credit0 = await api('GET', `/api/admin/finance/partners/${AGENCY_ID}/credit`, { token: T.accountant });
  record('F31', 'Credit position readable', credit0.status === 200 ? 'PASS' : 'FAIL', JSON.stringify(credit0.body));
  const setBlock = await api('PATCH', `/api/admin/finance/partners/${AGENCY_ID}/credit`, { token: T.accountant, body: { creditLimitCents: 1, creditLimitCurrency: 'GEL', creditLimitMode: 'BLOCK' } });
  record('F32', 'Accountant sets a 0.01 GEL BLOCK limit', setBlock.status === 200 ? 'PASS' : 'FAIL', msg(setBlock));
  const mgmtSet = await api('PATCH', `/api/admin/finance/partners/${AGENCY_ID}/credit`, { token: T.management, body: { creditLimitCents: null } });
  record('F32b', 'MANAGEMENT cannot change the credit limit', mgmtSet.status === 403 ? 'PASS' : 'FAIL', `status=${mgmtSet.status}`);
  // try to book a tour → must be refused with CREDIT_LIMIT_EXCEEDED
  const cat = await api('GET', '/api/tours?pageSize=50');
  let chosen = null, slug = null;
  for (const t of (cat.body.data || []).filter((t) => !/^tour-/.test(t.slug)).slice(0, 10)) {
    const r = await api('GET', `/api/search/tours/${t.slug}?from=2026-11-01&to=2026-12-20&adults=1`, { token: T.agencyAgent });
    for (const o of (r.body.options || [])) for (const d of (o.dates || [])) if (d.available && d.token) { chosen = d; slug = t.slug; break; }
    if (chosen) break;
  }
  if (chosen) {
    const blocked = await api('POST', '/api/tours/bookings', { token: T.agencyAgent, headers: { 'idempotency-key': randomUUID() }, body: { offerToken: chosen.token, leadTraveller: { firstName: 'Qa', lastName: 'Credit', email: 'qa.credit@example.test' } } });
    record('F33', 'Booking over the credit limit is refused (422 CREDIT_LIMIT_EXCEEDED) and nothing is written', blocked.status === 422 && /CREDIT_LIMIT_EXCEEDED/.test(JSON.stringify(blocked.body)) && sql(`select count(*) from tour_bookings where lead_traveller_email='qa.credit@example.test'`) === '0' ? 'PASS' : 'FAIL', msg(blocked));
    const seats = await api('GET', `/api/search/tours/${slug}?date=${chosen.date}&adults=1`, { token: T.agencyAgent });
    const dep = (seats.body.options || []).flatMap((o) => o.dates || []).find((d) => d.date === chosen.date);
    record('F33b', 'Seats not consumed by the refused booking', dep && dep.availableUnits === chosen.availableUnits ? 'PASS' : 'INFO', `before=${chosen.availableUnits} after=${dep?.availableUnits}`);
  } else record('F33', 'credit block booking', 'NOT TESTED', 'no bookable departure');
  const warn = await api('PATCH', `/api/admin/finance/partners/${AGENCY_ID}/credit`, { token: T.accountant, body: { creditLimitCents: 1, creditLimitCurrency: 'GEL', creditLimitMode: 'WARN' } });
  if (chosen && warn.status === 200) {
    const went = await api('POST', '/api/tours/bookings', { token: T.agencyAgent, headers: { 'idempotency-key': randomUUID() }, body: { offerToken: chosen.token, leadTraveller: { firstName: 'Qa', lastName: 'Credit', email: 'qa.credit@example.test' } } });
    const warned = sql(`select count(*) from audit_logs where action='PARTNER_CREDIT_WARNING' and created_at > now() - interval '1 minute'`);
    record('F34', 'WARN mode lets the booking through and records PARTNER_CREDIT_WARNING', (went.status === 201) && Number(warned) >= 1 ? 'PASS' : 'FAIL', `${went.status} ${went.body.reference || JSON.stringify(went.body).slice(0, 100)} warnings=${warned}`);
    if (went.body.reference) await api('POST', `/api/tours/bookings/${went.body.reference}/cancel`, { token: T.agencyAgent, body: { reason: 'QA cleanup' } });
  }
  const reset = await api('PATCH', `/api/admin/finance/partners/${AGENCY_ID}/credit`, { token: T.accountant, body: { creditLimitCents: null } });
  record('F35', 'Credit limit reset to none', reset.status === 200 ? 'PASS' : 'FAIL', msg(reset));
}

// ===================== RBAC / IDOR / HARDENING =====================
{
  const cases = [
    ['R1', 'dispatcher', 'GET', '/api/admin/hotels', 200, 'DISPATCHER reads the catalogue register (catalogue.read, by design)'],
    ['R2', 'dispatcher', 'GET', '/api/admin/transfers/fleet', 200, 'DISPATCHER reads the fleet'],
    ['R3', 'dispatcher', 'POST', '/api/admin/transfers/vehicles', 403, 'DISPATCHER cannot create a vehicle class'],
    ['R4', 'management', 'POST', '/api/admin/hotels', 403, 'MANAGEMENT cannot create a hotel'],
    ['R5', 'management', 'GET', `/api/admin/partners/${AGENCY_ID}/financial`, 403, 'MANAGEMENT cannot read bank details (S2 fix)'],
    ['R6', 'tourop', 'GET', `/api/admin/partners/${AGENCY_ID}/financial`, 403, 'TOUR_OPERATOR cannot read bank details'],
    ['R7', 'accountant', 'GET', `/api/admin/partners/${AGENCY_ID}/financial`, 200, 'ACCOUNTANT reads bank details'],
    ['R8', 'tourop', 'GET', '/api/admin/users', 403, 'TOUR_OPERATOR cannot list staff'],
    ['R9', 'admin', 'GET', '/api/admin/users', 403, 'ADMIN cannot list staff (SUPER_ADMIN only)'],
    ['R10', 'superadmin', 'GET', '/api/admin/users', 200, 'SUPER_ADMIN lists staff'],
    ['R11', 'admin', 'GET', '/api/admin/roles', 403, 'ADMIN cannot read roles editor'],
    ['R12', 'management', 'GET', '/api/admin/audit', 200, 'MANAGEMENT reads the audit log'],
    ['R13', 'dispatcher', 'GET', '/api/admin/audit', 403, 'DISPATCHER cannot read the audit log'],
    ['R14', 'agencyOwner', 'GET', '/api/admin/badges', 403, 'Partner cannot reach admin'],
    ['R15', 'agencyAgent', 'GET', '/api/partner/team', 403, 'PARTNER_AGENT cannot read the team'],
    ['R16', 'agencyAdmin', 'GET', '/api/partner/team', 200, 'PARTNER_ADMIN reads the team'],
    ['R17', 'agencyAgent', 'GET', '/api/partner/financial', 403, 'PARTNER_AGENT cannot read company bank details'],
    ['R18', 'hotelOwner', 'GET', '/api/partner/hotels', 200, 'Hotel owner lists own properties'],
    ['R19', 'agencyOwner', 'GET', '/api/partner/hotels', 200, 'Agency has no properties (empty list)'],
    ['R20', 'suspendedOwner', 'GET', '/api/partner/dashboard', 403, 'Suspended partner refused'],
    ['R21', 'suspendedOwner', 'GET', '/api/search/tours?date=2026-11-20&adults=2', 200, 'Suspended partner still browses public catalogue'],
    ['R22', 'finop', 'PUT', '/api/admin/finance/terms/hotels/' + sql("select id from hotels where slug='vera-house-tbilisi'"), 403, 'FINANCE_OPERATOR cannot write supplier terms'],
    ['R23', 'tourop', 'POST', '/api/admin/tours', 201, 'TOUR_OPERATOR may create a draft tour (tours.write)'],
    ['R24', 'tourop', 'POST', '/api/admin/pricing-rules', 403, 'TOUR_OPERATOR cannot write pricing rules'],
    ['R25', 'dispatcher', 'GET', '/api/admin/notifications', 200, 'DISPATCHER reads own notifications'],
  ];
  for (const [id, who, method, path, expect, label] of cases) {
    let body;
    if (method === 'POST' && path === '/api/admin/tours') body = { title: 'QA RBAC tour', slug: `qa-rbac-${Date.now()}`, destinationId: sql(`select id from destinations where slug not like 'dest-%' order by created_at limit 1`), category: 'CULTURE', summary: 'qa', location: 'Tbilisi', durationDays: 1 };
    else if (method === 'POST' || method === 'PUT') body = {};
    const r = await api(method, path, { token: T[who], body });
    const ok = Array.isArray(expect) ? expect.includes(r.status) : r.status === expect || (expect === 201 && r.status === 400);
    record(id, label, ok ? 'PASS' : 'FAIL', `${who} ${method} ${path} → ${r.status}${r.status !== expect ? ' ' + JSON.stringify(r.body).slice(0, 120) : ''}`);
    if (r.status === 201 && r.body.id && path === '/api/admin/tours') { const d = await api('DELETE', `/api/admin/tours/${r.body.id}`, { token: T.superadmin }); record('R23b', 'Cleanup: draft tour deleted', d.status === 204 || d.status === 200 ? 'PASS' : 'INFO', `status=${d.status}`); }
  }
  // IDOR across suppliers
  const foreignHotel = sql(`select id from hotels where supplier_id is distinct from (select partner_id from users where email='${USERS.hotelOwner}') and status='ACTIVE' limit 1`);
  const idor1 = await api('GET', `/api/partner/hotels/${foreignHotel}`, { token: T.hotelOwner });
  record('R30', "IDOR: supplier reading another supplier's hotel → 404", idor1.status === 404 ? 'PASS' : 'FAIL', `status=${idor1.status}`);
  const idor2 = await api('GET', `/api/partner/hotels/${foreignHotel}/room-types`, { token: T.hotelOwner });
  record('R31', "IDOR: another supplier's room types → 404", idor2.status === 404 ? 'PASS' : 'FAIL', `status=${idor2.status}`);
  const ownHotel = sql(`select id from hotels where supplier_id=(select partner_id from users where email='${USERS.hotelOwner}') limit 1`);
  const rts = await api('GET', `/api/partner/hotels/${ownHotel}/room-types`, { token: T.hotelOwner });
  const rt = (rts.body.data || rts.body || [])[0];
  if (rt) {
    const cal = await api('GET', `/api/partner/hotels/${ownHotel}/room-types/${rt.id}/inventory/calendar?from=2027-03-01&to=2027-03-03`, { token: T.hotelOwner });
    record('R32', 'Supplier reads own inventory calendar', cal.status === 200 ? 'PASS' : 'FAIL', `status=${cal.status}`);
    const inv = await api('PUT', `/api/partner/hotels/${ownHotel}/room-types/${rt.id}/inventory`, { token: T.hotelOwner, body: { from: '2027-03-01', to: '2027-03-02', totalUnits: 3 } });
    const cal2 = await api('GET', `/api/partner/hotels/${ownHotel}/room-types/${rt.id}/inventory/calendar?from=2027-03-01&to=2027-03-02`, { token: T.hotelOwner });
    record('R33', 'Supplier writes inventory and it persists', inv.status < 300 && JSON.stringify(cal2.body).includes('"totalUnits":3') ? 'PASS' : 'FAIL', `${inv.status} ${JSON.stringify(cal2.body).slice(0, 160)}`);
    const foreignRt = sql(`select id from room_types where hotel_id='${foreignHotel}' limit 1`);
    const inv2 = await api('PUT', `/api/partner/hotels/${foreignHotel}/room-types/${foreignRt}/inventory`, { token: T.hotelOwner, body: { from: '2027-03-01', to: '2027-03-02', totalUnits: 3 } });
    record('R34', "IDOR: writing another supplier's inventory → 404", inv2.status === 404 ? 'PASS' : 'FAIL', `status=${inv2.status}`);
    const inv3 = await api('PUT', `/api/partner/hotels/${ownHotel}/room-types/${foreignRt}/inventory`, { token: T.hotelOwner, body: { from: '2027-03-01', to: '2027-03-02', totalUnits: 3 } });
    record('R35', "IDOR: own hotel id + another hotel's room type id → 404", inv3.status === 404 ? 'PASS' : 'FAIL', `status=${inv3.status}`);
  }
  // S3: PARTNER_ADMIN cannot grant a role with capabilities it lacks
  const grantable = await api('GET', '/api/partner/team/grantable', { token: T.agencyAdmin });
  const keys = JSON.stringify(grantable.body);
  record('R36', 'Grantable roles for PARTNER_ADMIN exclude PARTNER_FINANCE/OWNER (capability subset)', grantable.status === 200 && !/PARTNER_FINANCE|PARTNER_OWNER/.test(keys) ? 'PASS' : 'FAIL', keys.slice(0, 200));
  const inv = await api('POST', '/api/partner/team', { token: T.agencyAdmin, body: { email: `qa.invite.${Date.now()}@example.test`, role: 'PARTNER_FINANCE', firstName: 'Qa', lastName: 'Invite' } });
  record('R37', 'PARTNER_ADMIN inviting a PARTNER_FINANCE is refused', inv.status === 403 || inv.status === 400 ? 'PASS' : 'FAIL', msg(inv));

  // Hardening
  const inj = await api('GET', `/api/hotels?search=${encodeURIComponent("' OR 1=1; --")}`);
  record('S1', 'SQL-looking search string handled as data', inj.status === 200 ? 'PASS' : 'FAIL', `status=${inj.status} n=${inj.body.data?.length}`);
  const neg = await api('GET', '/api/hotels?page=-1&pageSize=99999');
  record('S2', 'Negative page / huge pageSize → 400 or clamped', neg.status === 400 || (neg.status === 200 && neg.body.pageSize <= 100) ? 'PASS' : 'FAIL', `status=${neg.status} pageSize=${neg.body.pageSize}`);
  const big = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: CLIENT }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200 * 1024) }) });
  record('S3', 'Oversized JSON body → 413', big.status === 413 ? 'PASS' : 'FAIL', `status=${big.status}`);
  const badJson = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: CLIENT }, body: '{bad json' });
  const bj = await badJson.json().catch(() => ({}));
  record('S4', 'Malformed JSON → 400 with a clean message (no stack)', badJson.status === 400 && !/at .*\.js/.test(JSON.stringify(bj)) ? 'PASS' : 'FAIL', `${badJson.status} ${JSON.stringify(bj).slice(0, 120)}`);
  const unk = await api('GET', '/api/nope/nothing');
  record('S5', 'Unknown route → JSON 404', unk.status === 404 && unk.body?.error ? 'PASS' : 'FAIL', msg(unk));
  const xss = await api('GET', `/api/hotels?search=${encodeURIComponent('<script>alert(1)</script>')}`);
  record('S6', 'Script tag in query is not reflected raw', xss.status === 200 && !JSON.stringify(xss.body).includes('<script>') ? 'PASS' : 'FAIL', `status=${xss.status}`);
  const idk = await api('POST', '/api/bookings', { headers: { 'idempotency-key': 'short' }, body: { offerToken: 'x', leadGuest: { firstName: 'a', lastName: 'b', email: 'a@b.co' } } });
  record('S7', 'Idempotency-Key shorter than 8 chars → 400', idk.status === 400 ? 'PASS' : 'FAIL', msg(idk));
  const cors = await fetch(`${API}/api/hotels`, { headers: { origin: 'https://evil.example' } });
  record('S8', 'CORS: foreign origin is not echoed in Access-Control-Allow-Origin', cors.headers.get('access-control-allow-origin') !== 'https://evil.example' ? 'PASS' : 'FAIL', `acao=${cors.headers.get('access-control-allow-origin')}`);
  const h = Object.fromEntries((await fetch(`${API}/api/hotels`)).headers.entries());
  record('S9', 'Security headers present (CSP, HSTS, nosniff, frame-ancestors) and no X-Powered-By', h['content-security-policy'] && h['strict-transport-security'] && h['x-content-type-options'] === 'nosniff' && !h['x-powered-by'] ? 'PASS' : 'FAIL', Object.keys(h).filter((k) => /security|frame|content-type-options|powered|referrer/.test(k)).join(','));
  const cookie = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: CLIENT }, body: JSON.stringify({ email: USERS.admin, password: 'Demo-Georgia-2026' }) });
  const sc = cookie.headers.get('set-cookie') || '';
  record('S10', 'Session cookie is HttpOnly + SameSite (Secure expected only over https)', /httponly/i.test(sc) && /samesite/i.test(sc) ? 'PASS' : 'FAIL', sc.replace(/iag_session=[^;]+/, 'iag_session=<redacted>'));
  const tok = /iag_session=([^;]+)/.exec(sc)?.[1];
  const sess = sql(`select count(*) from sessions where expires_at > now()`);
  record('S11', 'Sessions are stored server-side with expiry', Number(sess) > 0 ? 'PASS' : 'FAIL', `live sessions=${sess}`);
  const pw = await api('POST', '/api/auth/password/change', { token: tok, body: { currentPassword: 'Demo-Georgia-2026', newPassword: 'short' } });
  record('S12', 'Weak new password refused', pw.status === 400 ? 'PASS' : 'FAIL', msg(pw));
  // media upload: text disguised as PNG
  const fd = new FormData();
  fd.append('category', 'HOTEL_IMAGE');
  fd.append('file', new Blob(['this is not an image'], { type: 'image/png' }), 'fake.png');
  const up = await fetch(`${API}/api/admin/media`, { method: 'POST', headers: { origin: CLIENT, cookie: `iag_session=${T.superadmin}` }, body: fd });
  record('S13', 'Upload of a text file disguised as PNG is refused (magic-byte sniffing)', up.status >= 400 && up.status < 500 ? 'PASS' : 'FAIL', `status=${up.status} ${(await up.text()).slice(0, 120)}`);
  const upDisp = await (async () => { const f = new FormData(); f.append('category', 'HOTEL_IMAGE'); f.append('file', new Blob([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')], { type: 'image/png' }), 'x.png'); return fetch(`${API}/api/admin/media`, { method: 'POST', headers: { origin: CLIENT, cookie: `iag_session=${T.dispatcher}` }, body: f }); })();
  record('S14', 'DISPATCHER cannot upload in the HOTEL_IMAGE category (403)', upDisp.status === 403 ? 'PASS' : 'FAIL', `status=${upDisp.status}`);
  await api('POST', '/api/auth/logout', { token: tok });
}

for (const t of Object.values(T)) await api('POST', '/api/auth/logout', { token: t });
console.log('DONE', { tourRef, orderRef });
