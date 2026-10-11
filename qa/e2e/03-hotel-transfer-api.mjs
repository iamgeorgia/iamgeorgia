// Phase 3.4/3.5/5 — hotel + transfer booking business logic through the API, with DB verification.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { api, apiLogin, record, USERS } from './lib.mjs';

const sql = (q) => execFileSync('docker', ['exec', 'iamgeorgia-postgres', 'psql', '-U', 'postgres', '-d', 'iamgeorgia', '-At', '-F', '|', '-c', q], { encoding: 'utf8' }).trim();
const reasonOf = (b) => b?.error?.reason || b?.error?.details?.reason || b?.reason || b?.error?.code || '';
const msg = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);

const CHECKIN = '2026-11-10', CHECKOUT = '2026-11-13';
const GUEST = { firstName: 'Qa', lastName: 'Tester', email: 'qa.guest+hotel@example.test', phone: '+995555000999' };
const created = { hotel: [], transfer: [] };
for (const r of sql("select reference||'|'||lead_passenger_email from transfer_bookings where lead_passenger_email like 'qa.guest+transfer%' and status in ('CONFIRMED','PENDING')").split(/\r?\n/).filter(Boolean)) { const [ref, em] = r.split('|'); await api('POST', `/api/transfers/bookings/${ref}/cancel`, { body: { email: em, reason: 'QA cleanup' } }); }
for (const r of sql("select reference||'|'||lead_guest_email from hotel_bookings where lead_guest_email like 'qa.guest+hotel%' and status in ('CONFIRMED','PENDING')").split(/\r?\n/).filter(Boolean)) { const [ref, em] = r.split('|'); await api('POST', `/api/bookings/${ref}/cancel`, { body: { email: em, reason: 'QA cleanup' } }); }

// ===================== HOTEL =====================
{
  const s = await api('GET', `/api/search?checkIn=${CHECKIN}&checkOut=${CHECKOUT}&adults=2&pageSize=50`);
  record('H1', 'GET /search dated availability returns results with offers', s.status === 200 && s.body.data?.length > 0 ? 'PASS' : 'FAIL', `status=${s.status} results=${s.body.data?.length}`);
  const cards = s.body.data || [];
  // arithmetic on every cheapest offer
  let arith = 0, arithFail = [];
  for (const c of cards) {
    const o = c.cheapestOffer; if (!o) continue; arith++;
    const nightsSum = sum(o.quote.nights, 'sellCents');
    const t = o.quote.totals;
    const okNights = nightsSum === t.roomCents && o.quote.nights.length === t.nights && t.nights === 3;
    const okTotal = t.totalCents === t.roomCents + (o.quote.taxes?.includedCents || 0);
    const okStart = c.startingFrom.totalCents === t.totalCents;
    const noStaff = o.quote.totals.netCents === undefined && o.markupBps === undefined && o.quote.nights[0].netCents === undefined;
    if (!(okNights && okTotal && okStart && noStaff)) arithFail.push({ slug: c.slug, nightsSum, t, inc: o.quote.taxes?.includedCents, start: c.startingFrom.totalCents, noStaff });
  }
  record('H2', `Offer arithmetic (nights sum = roomCents, total = room + included tax, card startingFrom = total, no staff fields) across ${arith} offers`, arithFail.length ? 'FAIL' : 'PASS', arithFail.length ? JSON.stringify(arithFail.slice(0, 2)).slice(0, 300) : '');

  // choose an offer: prefer small availability for the concurrency test
  const pick = cards.filter((c) => c.cheapestOffer).sort((a, b) => a.cheapestOffer.availableUnits - b.cheapestOffer.availableUnits)[0];
  const offer = pick.cheapestOffer;
  const units = offer.availableUnits;
  record('H2b', 'Picked offer', 'INFO', `${pick.slug} ${offer.name} units=${units} total=${offer.quote.totals.totalCents} ${offer.quote.currency}`);

  const q = await api('POST', '/api/search/offers/quote', { body: { token: offer.token } });
  record('H3', 'POST /search/offers/quote re-prices to the same total', q.status === 200 && q.body.quote?.totals?.totalCents === offer.quote.totals.totalCents ? 'PASS' : 'FAIL', msg(q));
  const bad = await api('POST', '/api/search/offers/quote', { body: { token: offer.token.slice(0, -3) + 'abc' } });
  record('H4', 'Tampered offer token is refused', bad.status >= 400 && bad.status < 500 ? 'PASS' : 'FAIL', msg(bad));

  // concurrency: units+1 simultaneous holds on the same offer
  const attempts = Math.min(units + 1, 8);
  const holds = await Promise.all(Array.from({ length: attempts }, () => api('POST', '/api/bookings/holds', { body: { token: offer.token } })));
  const okHolds = holds.filter((h) => h.status === 201 || h.status === 200);
  const rejected = holds.filter((h) => h.status === 409);
  record('H5', `Concurrent holds: ${attempts} simultaneous holds on ${units} units`, okHolds.length === Math.min(units, attempts) && okHolds.length + rejected.length === attempts ? 'PASS' : 'FAIL', `ok=${okHolds.length} 409=${rejected.length} other=${holds.filter((h) => ![200, 201, 409].includes(h.status)).map((h) => h.status).join(',')}`);
  const avail = await api('GET', `/api/search/hotels/${pick.slug}?checkIn=${CHECKIN}&checkOut=${CHECKOUT}&adults=2`);
  const findOffer = (body) => { const rooms = body.rooms || body.roomTypes || body.data || []; for (const r of rooms) { const rid = r.id || r.roomTypeId || r.roomType?.id; for (const o of (r.offers || [])) if (o.ratePlanId === offer.ratePlanId && (o.roomTypeId === offer.roomTypeId || rid === offer.roomTypeId)) return o; } return null; };
  const during = findOffer(avail.body);
  const expectedLeft = Math.max(0, units - okHolds.length); record('H6', 'Held units are not offered to others while the hold lives (offer disappears at 0)', during ? (during.availableUnits === expectedLeft ? 'PASS' : 'FAIL') : (expectedLeft === 0 ? 'PASS' : 'FAIL'), `before=${units} held=${okHolds.length} now=${during ? during.availableUnits : 'offer not listed'} expected=${expectedLeft}`);
  // release all but one
  const keep = okHolds[0].body;
  const holdToken = keep.holdToken || keep.token || keep.hold?.token;
  for (const h of okHolds.slice(1)) { const t = h.body.holdToken || h.body.token || h.body.hold?.token; await api('DELETE', `/api/bookings/holds/${encodeURIComponent(t)}`); }
  const after = await api('GET', `/api/search/hotels/${pick.slug}?checkIn=${CHECKIN}&checkOut=${CHECKOUT}&adults=2`);
  const afterO = findOffer(after.body);
  record('H7', 'Releasing holds restores availability', afterO ? (afterO.availableUnits === units - 1 ? 'PASS' : 'FAIL') : 'NOT TESTED', afterO ? `now=${afterO.availableUnits} expected=${units - 1}` : '');

  // amount in body must be refused
  const amt = await api('POST', '/api/bookings', { body: { holdToken, leadGuest: GUEST, totalCents: 1 } });
  record('H8', 'POST /bookings rejects an amount field (strict schema)', amt.status === 400 ? 'PASS' : 'FAIL', msg(amt));
  const miss = await api('POST', '/api/bookings', { body: { holdToken, leadGuest: { firstName: 'X' } } });
  record('H9', 'POST /bookings rejects missing lead guest fields', miss.status === 400 ? 'PASS' : 'FAIL', msg(miss));

  const key = randomUUID();
  const b1 = await api('POST', '/api/bookings', { body: { holdToken, leadGuest: GUEST, specialRequests: 'QA run <b>bold</b> & "quotes"' }, headers: { 'idempotency-key': key } });
  const ref = b1.body.reference;
  if (ref) created.hotel.push(ref);
  record('H10', 'POST /bookings confirms the held offer (201, CONFIRMED, total = quote)', b1.status === 201 && b1.body.status === 'CONFIRMED' && b1.body.totalCents === offer.quote.totals.totalCents ? 'PASS' : 'FAIL', `${msg(b1).slice(0, 60)} ref=${ref} total=${b1.body.totalCents} quote=${offer.quote.totals.totalCents}`);
  record('H10b', 'Public booking response carries no staff money fields', b1.body.netTotalCents === undefined && b1.body.markupBps === undefined && b1.body.marginCents === undefined ? 'PASS' : 'FAIL', Object.keys(b1.body).filter((k) => /net|markup|margin/i.test(k)).join(','));
  const b2 = await api('POST', '/api/bookings', { body: { holdToken, leadGuest: GUEST, specialRequests: 'QA run <b>bold</b> & "quotes"' }, headers: { 'idempotency-key': key } });
  record('H11', 'Idempotent replay returns 200 with the same reference', b2.status === 200 && b2.body.reference === ref ? 'PASS' : 'FAIL', msg(b2));
  const b3 = await api('POST', '/api/bookings', { body: { holdToken, leadGuest: GUEST }, headers: { 'idempotency-key': randomUUID() } });
  record('H12', 'Spent hold token cannot be booked twice with a new key', b3.status === 409 || b3.status === 410 ? 'PASS' : 'FAIL', msg(b3));

  // DB verification
  const row = sql(`select status, sell_total_cents + tax_total_cents, currency, lead_guest_email from hotel_bookings where reference='${ref}'`);
  record('H13', 'DB: hotel_bookings row matches API (status, total, email)', row.startsWith(`CONFIRMED|${offer.quote.totals.totalCents}|`) && row.endsWith(GUEST.email) ? 'PASS' : 'FAIL', row);
  const nights = sql(`select count(*) from hotel_booking_nights n join hotel_booking_rooms r on r.id=n.booking_room_id join hotel_bookings b on b.id=r.booking_id where b.reference='${ref}'`);
  record('H14', 'DB: 3 frozen night rows per room', nights === '3' ? 'PASS' : 'FAIL', `nights=${nights}`);
  const pay = sql(`select count(*), coalesce(sum(amount_cents),0) from supplier_payables where hotel_booking_id=(select id from hotel_bookings where reference='${ref}')`);
  const rec = sql(`select count(*), coalesce(sum(amount_cents),0), status from receivables where hotel_booking_id=(select id from hotel_bookings where reference='${ref}') group by status`);
  record('H15', 'DB: finance rows written in the booking transaction (payable + receivable)', pay.startsWith('1|') && rec.startsWith('1|') ? 'PASS' : 'FAIL', `payable=${pay} receivable=${rec}`);
  const recAmt = Number(rec.split('|')[1]);
  record('H15b', 'Receivable amount equals what the guest owes (booking total)', recAmt === offer.quote.totals.totalCents ? 'PASS' : 'FAIL', `receivable=${recAmt} total=${offer.quote.totals.totalCents}`);
  const outbox = sql(`select string_agg(topic, ',') from outbox_events where entity_id=(select id from hotel_bookings where reference='${ref}')`);
  record('H16', 'Outbox: guest confirmation + supplier notice queued', /hotel.booking.confirmed/.test(outbox) && /supplier.booking.received/.test(outbox) ? 'PASS' : 'FAIL', outbox.slice(0, 160));

  // read auth
  const noEmail = await api('GET', `/api/bookings/${ref}`);
  const wrongEmail = await api('GET', `/api/bookings/${ref}?email=someone.else@example.test`);
  const good = await api('GET', `/api/bookings/${ref}?email=${encodeURIComponent(GUEST.email)}`);
  record('H17', 'Guest read needs the lead email (no email / wrong email refused, right email 200)', noEmail.status >= 400 && wrongEmail.status >= 400 && good.status === 200 ? 'PASS' : 'FAIL', `none=${noEmail.status} wrong=${wrongEmail.status} right=${good.status}`);
  record('H17b', 'Booking detail uses the snapshot and frozen nights', good.body.hotelSnapshot && good.body.bookingRooms?.[0]?.nights?.length === 3 ? 'PASS' : 'FAIL', `snapshot=${!!good.body.hotelSnapshot} nights=${good.body.bookingRooms?.[0]?.nights?.length}`);

  // amend
  const am = await api('PATCH', `/api/bookings/${ref}`, { body: { email: GUEST.email, leadGuest: { ...GUEST, phone: '+995555111222' }, specialRequests: 'Changed by QA' } });
  const am2 = await api('GET', `/api/bookings/${ref}?email=${encodeURIComponent(GUEST.email)}`);
  record('H18', 'PATCH amends paperwork and the change persists', am.status === 200 && am2.body.specialRequests === 'Changed by QA' ? 'PASS' : 'FAIL', `${am.status} special="${am2.body.specialRequests}" phone=${am2.body.leadGuestPhone}`);
  const amBad = await api('PATCH', `/api/bookings/${ref}`, { body: { email: GUEST.email, checkIn: '2026-12-01' } });
  record('H19', 'PATCH refuses priced fields (dates)', amBad.status === 400 ? 'PASS' : 'FAIL', msg(amBad));
  const otherAmend = await api('PATCH', `/api/bookings/${ref}`, { body: { email: 'intruder@example.test', specialRequests: 'hacked' } });
  record('H20', 'PATCH with another email is refused', otherAmend.status >= 400 ? 'PASS' : 'FAIL', `status=${otherAmend.status}`);

  // staff view
  const sa = await apiLogin(USERS.superadmin);
  const adminView = await api('GET', `/api/admin/bookings/${ref}`, { token: sa.token });
  record('H21', 'Admin booking detail carries net/markup/margin', adminView.status === 200 && typeof adminView.body.netTotalCents === 'number' && typeof adminView.body.marginCents === 'number' ? 'PASS' : 'FAIL', `net=${adminView.body.netTotalCents} margin=${adminView.body.marginCents} total=${adminView.body.totalCents}`);
  const taxDb = Number(sql(`select tax_total_cents from hotel_bookings where reference='${ref}'`)); record('H21b', 'Margin arithmetic: total − tax − net = margin', adminView.body.totalCents - taxDb - adminView.body.netTotalCents === adminView.body.marginCents ? 'PASS' : 'FAIL', `total=${adminView.body.totalCents} tax=${taxDb} net=${adminView.body.netTotalCents} margin=${adminView.body.marginCents}`);
  const list = await api('GET', `/api/admin/bookings?search=${ref}`, { token: sa.token });
  record('H22', 'Admin bookings list finds the new booking by reference', list.status === 200 && (list.body.data || []).some((b) => b.reference === ref) ? 'PASS' : 'FAIL', `status=${list.status} n=${list.body.data?.length}`);

  // cancel
  const cq = await api('GET', `/api/bookings/${ref}/cancellation-quote?email=${encodeURIComponent(GUEST.email)}`);
  record('H23', 'Cancellation quote: charge + refund = total', cq.status === 200 && cq.body.chargeCents + cq.body.refundCents === good.body.totalCents ? 'PASS' : 'FAIL', msg(cq));
  const cancel = await api('POST', `/api/bookings/${ref}/cancel`, { body: { email: GUEST.email, reason: 'QA' } });
  record('H24', 'POST cancel → CANCELLED', cancel.status === 200 && cancel.body.status === 'CANCELLED' ? 'PASS' : 'FAIL', msg(cancel));
  const again = await api('POST', `/api/bookings/${ref}/cancel`, { body: { email: GUEST.email } });
  record('H25', 'Cancelling twice is a 409', again.status === 409 ? 'PASS' : 'FAIL', msg(again));
  const amAfter = await api('PATCH', `/api/bookings/${ref}`, { body: { email: GUEST.email, specialRequests: 'after cancel' } });
  record('H26', 'PATCH after cancellation is a 409', amAfter.status === 409 ? 'PASS' : 'FAIL', msg(amAfter));
  const restored = await api('GET', `/api/search/hotels/${pick.slug}?checkIn=${CHECKIN}&checkOut=${CHECKOUT}&adults=2`);
  const rO = findOffer(restored.body);
  record('H27', 'Inventory restored after cancellation', rO ? (rO.availableUnits === units ? 'PASS' : 'FAIL') : 'NOT TESTED', rO ? `now=${rO.availableUnits} original=${units}` : '');
  const recAfter = sql(`select amount_cents, status from receivables where hotel_booking_id=(select id from hotel_bookings where reference='${ref}')`);
  const pen = sql(`select count(*) from penalty_entries where booking_type='HOTEL' and booking_id=(select id from hotel_bookings where reference='${ref}')`);
  record('H28', 'DB after cancel: receivable = cancellation charge, penalty row exists', recAfter.startsWith(`${cq.body.chargeCents}|`) && pen === '1' ? 'PASS' : 'FAIL', `receivable=${recAfter} charge=${cq.body.chargeCents} penalties=${pen}`);
  const outbox2 = sql(`select string_agg(topic, ',') from outbox_events where entity_id=(select id from hotel_bookings where reference='${ref}')`);
  record('H29', 'Outbox: cancellation events queued (guest + supplier)', /hotel.booking.cancelled/.test(outbox2) && /supplier.booking.cancelled/.test(outbox2) ? 'PASS' : 'FAIL', outbox2.slice(0, 200));
  await api('POST', '/api/auth/logout', { token: sa.token });
}

// ===================== TRANSFER =====================
{
  const pts = await api('GET', '/api/transfers/points?search=airport');
  const from = (pts.body.data || pts.body)?.find((p) => p.kind === 'AIRPORT');
  const pts2 = await api('GET', '/api/transfers/points?popular=true');
  const to = (pts2.body.data || pts2.body)?.find((p) => p.slug !== from?.slug && p.kind !== 'AIRPORT') || (pts2.body.data || pts2.body)?.find((p) => p.slug !== from?.slug);
  record('T1', 'Transfer points picker answers (airport + popular points)', from && to ? 'PASS' : 'FAIL', `from=${from?.slug} to=${to?.slug}`);
  const DATE = '2026-11-15', TIME = '10:00';
  const qs = `from=${from.slug}&to=${to.slug}&date=${DATE}&time=${TIME}&adults=2&luggage=2`;
  const quote = await api('GET', `/api/transfers/quotes?${qs}`);
  const offers = quote.body.offers || [];
  record('T2', 'GET /transfers/quotes returns offers', quote.status === 200 && offers.length > 0 ? 'PASS' : 'FAIL', `status=${quote.status} offers=${offers.length} closed=${quote.body.closed}`);
  const bad = [];
  for (const o of offers) {
    const legs = o.quote.legs; const t = o.quote.totals;
    const legSum = sum(legs, 'sellCents');
    const pax = 2; const legOk = legs.every((l) => l.sellCents === l.baseFareCents * (o.quote.perSeat ? pax : 1) + (l.nightSurchargeCents || 0) + sum(l.extras || [], 'totalCents'));
    if (!(legSum === t.sellCents && t.totalCents === t.sellCents && legOk) || t.netCents !== undefined || legs[0].source !== undefined) bad.push({ v: o.vehicle.slug, legSum, t, legOk, net: t.netCents, src: legs[0].source });
  }
  record('T3', `Quote arithmetic (leg = base[×pax if perSeat] + night + extras; legs sum = total; no staff fields) across ${offers.length} offers`, bad.length ? 'FAIL' : 'PASS', JSON.stringify(bad.slice(0, 2)).slice(0, 250));
  const withExtra = await api('GET', `/api/transfers/quotes?${qs}&extra=childSeat`);
  const readyIds = sql("select distinct fv.vehicle_class_id from transfer_fleet_vehicles fv join transfer_driver_vehicles dv on dv.fleet_vehicle_id=fv.id join transfer_drivers d on d.id=dv.driver_id join users u on u.id=d.user_id where fv.status='ACTIVE' and d.is_active and d.verification_status='VERIFIED' and u.email like '%@demo.iamgeorgia.test'").split(/\r?\n/); const o0 = offers.find((o) => o.vehicle.kind === 'PRIVATE' && readyIds.includes(o.vehicle.id)) || offers.find((o) => o.vehicle.kind === 'PRIVATE') || offers[0]; record('T2b', 'Chosen offer has fleet cars with verified demo drivers', readyIds.includes(o0.vehicle.id) ? 'PASS' : 'INFO', `${o0.vehicle.slug} ${o0.vehicle.vehicleClass} total=${o0.quote.totals.totalCents}`); const e0 = (withExtra.body.offers || []).find((o) => o.vehicle.slug === o0.vehicle.slug);
  record('T4', 'Adding a child seat extra raises the fare by the extra price only', e0 && e0.quote.totals.totalCents > o0.quote.totals.totalCents && e0.quote.totals.totalCents - o0.quote.totals.totalCents === sum(e0.quote.legs[0].extras || [], 'totalCents') ? 'PASS' : 'FAIL', `base=${o0.quote.totals.totalCents} withExtra=${e0?.quote.totals.totalCents} extras=${JSON.stringify(e0?.quote.legs[0].extras)}`);
  const same = await api('GET', `/api/transfers/quotes?from=${from.slug}&to=${from.slug}&date=${DATE}&time=${TIME}&adults=2`);
  record('T5', 'Same from/to → 409 SAME_POINT', same.status === 409 && reasonOf(same.body) === 'SAME_POINT' ? 'PASS' : 'FAIL', msg(same));
  const past = await api('GET', `/api/transfers/quotes?from=${from.slug}&to=${to.slug}&date=2026-10-10&time=00:30&adults=2`);
  record('T6', 'Pick-up too soon/past → 422', past.status === 422 ? 'PASS' : 'FAIL', msg(past));
  const huge = await api('GET', `/api/transfers/quotes?from=${from.slug}&to=${to.slug}&date=${DATE}&time=${TIME}&adults=60`);
  record('T7', 'Party nobody can carry → 200 with no offers or 422 PARTY_TOO_LARGE', (huge.status === 200 && (huge.body.offers || []).length === 0) || (huge.status === 422) ? 'PASS' : 'FAIL', `status=${huge.status} offers=${huge.body.offers?.length}`);
  const unknown = await api('GET', `/api/transfers/quotes?from=nowhere-land&to=${to.slug}&date=${DATE}&time=${TIME}&adults=2`);
  record('T8', 'Unknown point → 404', unknown.status === 404 ? 'PASS' : 'FAIL', msg(unknown));
  const ret = await api('GET', `/api/transfers/quotes?${qs}&tripType=RETURN&returnDate=2026-11-14&returnTime=10:00`);
  record('T9', 'Return before outbound → 422 RETURN_BEFORE_OUTBOUND', ret.status === 422 ? 'PASS' : 'FAIL', msg(ret));
  const ret2 = await api('GET', `/api/transfers/quotes?${qs}&tripType=RETURN&returnDate=2026-11-18&returnTime=18:00`);
  const r0 = (ret2.body.offers || [])[0];
  record('T10', 'Return trip prices two legs and sums them', r0 && r0.quote.legs.length === 2 && sum(r0.quote.legs, 'sellCents') === r0.quote.totals.totalCents ? 'PASS' : 'FAIL', `legs=${r0?.quote.legs.length} total=${r0?.quote.totals.totalCents}`);

  const LEAD = { firstName: 'Qa', lastName: 'Passenger', email: 'qa.guest+transfer@example.test', phone: '+995555000998' };
  const amt = await api('POST', '/api/transfers/bookings', { body: { quoteToken: o0.token, leadPassenger: LEAD, totalCents: 5 } });
  record('T11', 'Amount in body → 400', amt.status === 400 ? 'PASS' : 'FAIL', msg(amt));
  const drv = await api('POST', '/api/transfers/bookings', { body: { quoteToken: o0.token, leadPassenger: LEAD, preferredDriverId: 'abc' } });
  record('T12', 'Guest naming a driver → 400', drv.status === 400 ? 'PASS' : 'FAIL', msg(drv));
  const key = randomUUID();
  const tb = await api('POST', '/api/transfers/bookings', { body: { quoteToken: o0.token, leadPassenger: LEAD, flightNumber: 'TK378', pickupAddress: 'Arrivals' }, headers: { 'idempotency-key': key } });
  const tref = tb.body.reference; if (tref) created.transfer.push(tref);
  record('T13', 'POST /transfers/bookings → 201 CONFIRMED, total = quote', tb.status === 201 && tb.body.status === 'CONFIRMED' && tb.body.totalCents === o0.quote.totals.totalCents ? 'PASS' : 'FAIL', `${tb.status} ref=${tref} total=${tb.body.totalCents} quote=${o0.quote.totals.totalCents}`);
  const tb2 = await api('POST', '/api/transfers/bookings', { body: { quoteToken: o0.token, leadPassenger: LEAD, flightNumber: 'TK378', pickupAddress: 'Arrivals' }, headers: { 'idempotency-key': key } });
  record('T14', 'Replay → 200 same reference', tb2.status === 200 && tb2.body.reference === tref ? 'PASS' : 'FAIL', msg(tb2));
  const row = sql(`select status, sell_total_cents, lead_passenger_email from transfer_bookings where reference='${tref}'`);
  record('T15', 'DB: transfer_bookings row matches', row === `CONFIRMED|${o0.quote.totals.totalCents}|${LEAD.email}` ? 'PASS' : 'FAIL', row);
  const legs = sql(`select count(*), string_agg(status::text, ',') from transfer_booking_legs where booking_id=(select id from transfer_bookings where reference='${tref}')`);
  record('T16', 'DB: one UNASSIGNED leg for a one-way booking', legs === '1|UNASSIGNED' ? 'PASS' : 'FAIL', legs);
  const pay = sql(`select count(*) from supplier_payables where transfer_booking_id=(select id from transfer_bookings where reference='${tref}')`);
  const rec = sql(`select count(*), coalesce(sum(amount_cents),0) from receivables where transfer_booking_id=(select id from transfer_bookings where reference='${tref}')`);
  record('T17', 'DB: payable + receivable written', pay === '1' && rec === `1|${o0.quote.totals.totalCents}` ? 'PASS' : 'FAIL', `payable=${pay} receivable=${rec}`);
  const rd = await api('GET', `/api/transfers/bookings/${tref}?email=${encodeURIComponent(LEAD.email)}`);
  record('T18', 'Guest reads the booking with email; snapshot + legs present', rd.status === 200 && rd.body.route && rd.body.vehicle && rd.body.legs?.length === 1 && rd.body.netTotalCents === undefined ? 'PASS' : 'FAIL', `${rd.status} keys=${Object.keys(rd.body).slice(0, 12)}`);
  const am = await api('PATCH', `/api/transfers/bookings/${tref}`, { body: { email: LEAD.email, flightNumber: 'TK380' } });
  const rd2 = await api('GET', `/api/transfers/bookings/${tref}?email=${encodeURIComponent(LEAD.email)}`);
  record('T19', 'PATCH flight number persists', am.status === 200 && rd2.body.flightNumber === 'TK380' ? 'PASS' : 'FAIL', `${am.status} flight=${rd2.body.flightNumber}`);
  const amBad = await api('PATCH', `/api/transfers/bookings/${tref}`, { body: { email: LEAD.email, pickupAt: '2026-12-01T10:00:00Z' } });
  record('T20', 'PATCH refuses the journey fields', amBad.status === 400 ? 'PASS' : 'FAIL', msg(amBad));

  // dispatch
  const disp = await apiLogin(USERS.dispatcher);
  const dl = await api('GET', `/api/admin/transfers/dispatch/legs?search=${tref}`, { token: disp.token });
  const leg = (dl.body.data || dl.body.legs || dl.body || []).find?.((l) => l.booking?.reference === tref) || (dl.body.data || [])[0];
  record('T21', 'Dispatcher sees the new leg as UNASSIGNED', dl.status === 200 && leg && leg.status === 'UNASSIGNED' ? 'PASS' : 'FAIL', `${dl.status} leg=${leg?.id} status=${leg?.status}`);
  const bd = await api('GET', `/api/admin/transfers/bookings/${tref}`, { token: disp.token });
  record('T22', 'Dispatcher booking view hides money (no netTotalCents/margin)', bd.status === 200 && bd.body.netTotalCents === undefined && bd.body.marginCents === undefined ? 'PASS' : 'FAIL', `${bd.status} net=${bd.body.netTotalCents}`);
  const dcancel = await api('POST', `/api/admin/transfers/bookings/${tref}/cancel`, { token: disp.token, body: { reason: 'x' } });
  record('T23', 'Dispatcher cannot cancel a booking (403)', dcancel.status === 403 ? 'PASS' : 'FAIL', msg(dcancel));
  let assignmentId = null, driverEmail = null;
  if (leg) {
    const cand = await api('GET', `/api/admin/transfers/dispatch/legs/${leg.id}/candidates`, { token: disp.token });
    const cands = cand.body.data || cand.body.candidates || cand.body || [];
    const c = cands.find?.((x) => !(x.conflicts || []).length && (x.driver?.isActive ?? x.isActive ?? true)) || cands[0]; console.log('CANDIDATE0', JSON.stringify(cands[0] || null).slice(0, 400), 'class', o0.vehicle.vehicleClass);
    record('T24', 'Candidates endpoint ranks drivers with cars of the booked class', cand.status === 200 && cands.length > 0 ? 'PASS' : 'FAIL', `${cand.status} n=${cands.length} first=${JSON.stringify(c || null).slice(0, 120)}`);
    if (c) {
      const driverId = c.driver?.id || c.id || c.driverId;
      const car = (c.vehicles || c.cars || c.fleetVehicles || [])[0];
      const asg = await api('POST', `/api/admin/transfers/dispatch/legs/${leg.id}/assign`, { token: disp.token, body: { driverId, fleetVehicleId: car?.id || car?.fleetVehicleId, note: 'QA' } });
      assignmentId = asg.body.assignment?.id || asg.body.id;
      record('T25', 'Assign driver → 201, leg ASSIGNED', asg.status === 201 ? 'PASS' : 'FAIL', msg(asg));
      const legAfter = await api('GET', `/api/admin/transfers/dispatch/legs/${leg.id}`, { token: disp.token });
      record('T25b', 'Leg status after assign is ASSIGNED with a live assignment', legAfter.body.status === 'ASSIGNED' && legAfter.body.assignment ? 'PASS' : 'FAIL', `status=${legAfter.body.status} asg=${legAfter.body.assignment?.id}`);
      // double assignment of the same driver onto an overlapping leg: create a second booking at the same time and assign the same driver
      const tb3 = await api('POST', '/api/transfers/bookings', { body: { quoteToken: o0.token, leadPassenger: { ...LEAD, email: 'qa.guest+transfer2@example.test' } }, headers: { 'idempotency-key': randomUUID() } });
      if (tb3.body.reference) created.transfer.push(tb3.body.reference);
      const dl2 = await api('GET', `/api/admin/transfers/dispatch/legs?search=${tb3.body.reference}`, { token: disp.token });
      const leg2 = (dl2.body.data || []).find((l) => l.booking?.reference === tb3.body.reference);
      if (leg2) {
        const asg2 = await api('POST', `/api/admin/transfers/dispatch/legs/${leg2.id}/assign`, { token: disp.token, body: { driverId, fleetVehicleId: car?.id || car?.fleetVehicleId } });
        record('T26', 'Same driver on an overlapping leg is refused (409 SCHEDULE_CONFLICT)', asg2.status === 409 ? 'PASS' : 'FAIL', msg(asg2));
      } else record('T26', 'overlap test', 'NOT TESTED', 'second leg not found');
      // driver side
      driverEmail = sql(`select u.email from transfer_drivers d join users u on u.id=d.user_id where d.id='${driverId}'`);
      if (driverEmail) {
        const dr = await apiLogin(driverEmail, 'driver-demo-password');
        if (dr.token) {
          const up = await api('GET', '/api/driver/assignments?scope=upcoming', { token: dr.token });
          const mine = (up.body.data || up.body || []).find?.((a) => a.id === assignmentId || a.booking?.reference === tref);
          record('T27', 'Driver sees the offered job in upcoming', up.status === 200 && mine ? 'PASS' : 'FAIL', `${up.status} n=${(up.body.data || up.body || []).length} keys=${JSON.stringify(mine || {}).slice(0, 100)}`);
          record('T27b', 'Driver view carries no fare', mine && JSON.stringify(mine).match(/sellCents|netCents|totalCents/) === null ? 'PASS' : mine ? 'FAIL' : 'NOT TESTED', (JSON.stringify(mine || {}).match(/\w*Cents/g) || []).join(','));
          const acc = await api('POST', `/api/driver/assignments/${assignmentId}/accept`, { token: dr.token });
          record('T28', 'Driver accepts → leg ACCEPTED', acc.status === 200 && (acc.body.status === 'ACCEPTED' || acc.body.leg?.status === 'ACCEPTED' || acc.body.assignment?.status === 'ACCEPTED') ? 'PASS' : 'FAIL', msg(acc));
          const early = await api('POST', `/api/driver/assignments/${assignmentId}/status`, { token: dr.token, body: { to: 'EN_ROUTE' } });
          record('T29', 'EN_ROUTE a month before pick-up is refused (409 TOO_EARLY)', early.status === 409 ? 'PASS' : 'FAIL', msg(early));
          const other = sql(`select id from transfer_assignments where driver_id<>'${driverId}' order by created_at desc limit 1`);
          const idor = await api('GET', `/api/driver/assignments/${other}`, { token: dr.token });
          record('T30', 'Driver cannot read another driver\'s assignment (404)', idor.status === 404 ? 'PASS' : 'FAIL', `status=${idor.status}`);
          const adm = await api('GET', '/api/admin/badges', { token: dr.token });
          record('T31', 'Driver cannot reach /admin/*', adm.status === 403 ? 'PASS' : 'FAIL', `status=${adm.status}`);
          // guest now sees the driver (accepted)
          const rd3 = await api('GET', `/api/transfers/bookings/${tref}?email=${encodeURIComponent(LEAD.email)}`);
          const a = rd3.body.legs?.[0]?.assignment;
          record('T32', 'Passenger sees accepted driver (initial only, no phone a month ahead)', a && a.driver && !a.driver.phone && (!a.driver.lastName || a.driver.lastName.length <= 2) ? 'PASS' : 'FAIL', JSON.stringify(a?.driver || null).slice(0, 160));
          const dec = await api('POST', `/api/driver/assignments/${assignmentId}/decline`, { token: dr.token, body: { reason: 'QA' } });
          record('T33', 'Driver declines an accepted job (allowed well before pick-up) → leg back to UNASSIGNED', dec.status === 200 ? 'PASS' : 'FAIL', msg(dec));
          const legAfter2 = await api('GET', `/api/admin/transfers/dispatch/legs/${leg.id}`, { token: disp.token });
          record('T33b', 'Leg is UNASSIGNED after the decline', legAfter2.body.status === 'UNASSIGNED' ? 'PASS' : 'FAIL', `status=${legAfter2.body.status}`);
          await api('POST', '/api/auth/logout', { token: dr.token });
        } else record('T27', 'driver login', 'BLOCKED', `could not log in as ${driverEmail}: ${dr.status}`);
      } else record('T27', 'driver login', 'NOT TESTED', 'assigned driver has no user account');
    }
  }
  // cancel transfer as guest
  const cq = await api('GET', `/api/transfers/bookings/${tref}/cancellation-quote?email=${encodeURIComponent(LEAD.email)}`);
  record('T34', 'Transfer cancellation quote: charge + refundable = total', cq.status === 200 && cq.body.chargeCents + (cq.body.refundableCents ?? cq.body.refundCents) === o0.quote.totals.totalCents ? 'PASS' : 'FAIL', msg(cq)); record('T34b', 'API consistency: hotel quote says refundCents, transfer quote says refundableCents', cq.body.refundableCents !== undefined ? 'FAIL' : 'PASS', Object.keys(cq.body).join(','));
  const cx = await api('POST', `/api/transfers/bookings/${tref}/cancel`, { body: { email: LEAD.email, reason: 'QA' } });
  record('T35', 'Guest cancels → CANCELLED; leg CANCELLED', cx.status === 200 && cx.body.status === 'CANCELLED' && sql(`select string_agg(status::text, ',') from transfer_booking_legs where booking_id=(select id from transfer_bookings where reference='${tref}')`) === 'CANCELLED' ? 'PASS' : 'FAIL', msg(cx));
  for (const r of created.transfer.slice(1)) await api('POST', `/api/transfers/bookings/${r}/cancel`, { body: { email: 'qa.guest+transfer2@example.test', reason: 'QA cleanup' } });
  await api('POST', '/api/auth/logout', { token: disp.token });
}

console.log('CREATED', JSON.stringify(created));
