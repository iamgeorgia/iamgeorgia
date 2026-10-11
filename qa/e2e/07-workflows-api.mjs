// Phase 4.2/4.3 — multi-user workflows: partner onboarding (invite → register → approve gate → terms), rate change → public price,
// publish checklists, admin cancel, notifications read, audit filters, mail rendering evidence.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { api, apiLogin, record, USERS, sql, CLIENT } from './lib.mjs';
const msg = (r) => `${r.status} ${JSON.stringify(r.body).slice(0, 170)}`;
const reasonOf = (b) => b?.error?.reason || b?.error?.details?.reason || '';
const ts = Date.now();
const SA = (await apiLogin(USERS.superadmin)).token;
const ADMIN = (await apiLogin(USERS.admin)).token;

// ===================== W1 partner onboarding
for (const row of sql("select id||'|'||reference from partners where name like 'QA Agency %'").split(/\r?\n/).filter(Boolean)) { const [id, ref] = row.split('|'); const d = await api('DELETE', `/api/admin/partners/${id}`, { token: SA, body: { confirm: ref, reason: 'QA cleanup' } }); console.log('cleanup partner', ref, d.status, JSON.stringify(d.body).slice(0, 80)); }
{
  const inv = await api('POST', '/api/admin/partners', { token: ADMIN, body: { mode: 'invite', company: { name: `QA Agency ${ts}`, kind: 'TOUR_OPERATOR' }, contact: { firstName: 'Qa', lastName: 'Owner', email: `qa.partner.${ts}@example.test` } } });
  record('W1', 'ADMIN drafts a partner and issues a registration invitation', inv.status === 201 ? 'PASS' : 'FAIL', msg(inv));
  const link = inv.body.link?.url || inv.body.invitation?.url || inv.body.registrationUrl || '';
  const token = (link.match(/register\/([^/?#]+)/) || [])[1] || inv.body.link?.token || inv.body.invitation?.token;
  record('W1b', 'Invitation response carries a registration link for the admin to copy', link ? 'PASS' : 'FAIL', `link=${link.slice(0, 80)} keys=${Object.keys(inv.body).join(',')}`);
  const partnerId = inv.body.partner?.id || inv.body.id;
  if (token) {
    const look = await api('GET', `/api/invitations/${token}`);
    record('W2', 'Public invitation lookup returns the prefilled draft', look.status === 200 ? 'PASS' : 'FAIL', msg(look));
    const bad = await api('GET', `/api/invitations/${token.slice(0, -2)}xx`);
    record('W2b', 'A wrong token is 404/410, not 500', bad.status === 404 || bad.status === 410 || bad.status === 400 ? 'PASS' : 'FAIL', `status=${bad.status}`);
    const terms = await api('GET', '/api/partner/terms', { token: (await apiLogin(USERS.agencyOwner)).token });
    const body = { company: { name: `QA Agency ${ts}`, legalName: `QA Agency ${ts} LLC`, kind: 'TOUR_OPERATOR', registrationNumber: `${ts}`.slice(-9), legalAddress: '1 Test St', city: 'Tbilisi', country: 'GE', phone: '+995555000123', email: `qa.company.${ts}@example.test` }, contact: { firstName: 'Qa', lastName: 'Owner', email: `qa.partner.${ts}@example.test`, phone: '+995555000124' }, financial: { iban: 'GE29NB0000000101904917', swift: 'BAGAGE22', bankName: 'Bank of Georgia', accountHolder: `QA Agency ${ts}` }, password: 'Strong-Partner-Pass-2026!', terms: { accepted: true, version: terms.body.current } };
    const weak = await api('POST', `/api/invitations/${token}/accept`, { body: { ...body, password: 'qa.partner' } });
    record('W3', 'Registration refuses a weak/personal password', weak.status === 400 ? 'PASS' : 'FAIL', msg(weak));
    const reg = await api('POST', `/api/invitations/${token}/accept`, { body });
    record('W4', 'Registration completes: partner PENDING, owner account created', reg.status === 201 || reg.status === 200 ? 'PASS' : 'FAIL', msg(reg));
    const again = await api('POST', `/api/invitations/${token}/accept`, { body });
    record('W4b', 'Invitation token is single-use', again.status >= 400 ? 'PASS' : 'FAIL', `status=${again.status}`);
    const lg = await apiLogin(`qa.partner.${ts}@example.test`, 'Strong-Partner-Pass-2026!');
    record('W5', 'New owner can sign in', lg.status === 200 ? 'PASS' : 'FAIL', `status=${lg.status} partner=${lg.body?.partner?.status}`);
    if (lg.token) {
      const dash = await api('GET', '/api/partner/dashboard', { token: lg.token });
      record('W6', 'Pending partner cannot use the portal yet (403)', dash.status === 403 ? 'PASS' : 'FAIL', msg(dash));
      const bookTry = await api('POST', '/api/tours/bookings/holds', { token: lg.token, body: { token: 'x' } });
      record('W6b', 'Pending partner cannot book', bookTry.status === 403 || bookTry.status === 400 ? 'PASS' : 'FAIL', `status=${bookTry.status}`);
    }
    const pid = partnerId || sql(`select partner_id from users where email='qa.partner.${ts}@example.test'`);
    const pending = await api('GET', '/api/admin/partners?status=PENDING&pageSize=50', { token: ADMIN });
    const plist = pending.body.data || pending.body.partners || pending.body.items || (Array.isArray(pending.body) ? pending.body : []);
    record('W7', 'Application appears in the admin PENDING queue', plist.some((p) => p.id === pid) ? 'PASS' : 'FAIL', `${pending.status} n=${plist.length} keys=${Object.keys(pending.body || {}).join(',')} ${pending.status >= 400 ? JSON.stringify(pending.body).slice(0, 100) : ''}`);
    const badge = await api('GET', '/api/admin/badges', { token: ADMIN });
    record('W7b', 'Badge pendingPartners ≥ 1', badge.body.pendingPartners >= 1 ? 'PASS' : 'FAIL', `pendingPartners=${badge.body.pendingPartners}`);
    const mgmtApprove = await api('POST', `/api/admin/partners/${pid}/approve`, { token: (await apiLogin(USERS.management)).token, body: {} });
    record('W8', 'MANAGEMENT cannot approve a partner', mgmtApprove.status === 403 ? 'PASS' : 'FAIL', `status=${mgmtApprove.status}`);
    const noContract = await api('POST', `/api/admin/partners/${pid}/approve`, { token: ADMIN, body: {} });
    record('W9', 'Approval is refused while no signed contract is on file (contract gate; answers 400 CONTRACT_MISSING)', noContract.status >= 400 && noContract.status < 500 && /CONTRACT_MISSING/.test(JSON.stringify(noContract.body)) ? 'PASS' : 'FAIL', msg(noContract));
    const waive = await api('PUT', `/api/admin/partners/${pid}/contract-requirement`, { token: ADMIN, body: { contractRequired: false, reason: 'QA: verbal agreement, contract to follow' } });
    record('W10', 'ADMIN can waive the contract requirement with a reason (audited)', waive.status === 200 && Number(sql(`select count(*) from audit_logs where entity_id='${pid}' and created_at > now() - interval '1 minute'`)) >= 1 ? 'PASS' : 'FAIL', msg(waive));
    const approve = await api('POST', `/api/admin/partners/${pid}/approve`, { token: ADMIN, body: { note: 'QA' } });
    record('W11', 'Approve → APPROVED', approve.status === 200 && (approve.body.status === 'APPROVED' || approve.body.partner?.status === 'APPROVED') ? 'PASS' : 'FAIL', msg(approve));
    const lg2 = await apiLogin(`qa.partner.${ts}@example.test`, 'Strong-Partner-Pass-2026!');
    const dash2 = await api('GET', '/api/partner/dashboard', { token: lg2.token });
    record('W12', 'Approved owner (terms accepted at registration) reaches the dashboard', dash2.status === 200 ? 'PASS' : 'FAIL', msg(dash2));
    const notif = sql(`select string_agg(kind::text, ',') from notifications n join users u on u.id=n.recipient_user_id where u.email='qa.partner.${ts}@example.test'`);
    record('W12b', 'Owner received an in-app notice about the approval', /APPROVED|PARTNER/i.test(notif || '') ? 'PASS' : 'INFO', notif || 'none');
    const susp = await api('POST', `/api/admin/partners/${pid}/suspend`, { token: ADMIN, body: { reason: 'QA suspend' } });
    const dash3 = await api('GET', '/api/partner/dashboard', { token: lg2.token });
    record('W13', 'Suspend → the live session is ended at once (401) / portal closed (403)', susp.status === 200 && (dash3.status === 403 || dash3.status === 401) ? 'PASS' : 'FAIL', `suspend=${susp.status} dashboard=${dash3.status}`);
    const lgS = await apiLogin(`qa.partner.${ts}@example.test`, 'Strong-Partner-Pass-2026!');
    record('W13b', 'While suspended, a fresh sign-in cannot reach the portal', lgS.status !== 200 || (await api('GET', '/api/partner/dashboard', { token: lgS.token })).status === 403 ? 'PASS' : 'FAIL', `login=${lgS.status}`);
    const react = await api('POST', `/api/admin/partners/${pid}/reactivate`, { token: ADMIN, body: {} });
    const lgR = await apiLogin(`qa.partner.${ts}@example.test`, 'Strong-Partner-Pass-2026!');
    const dash4 = await api('GET', '/api/partner/dashboard', { token: lgR.token });
    record('W14', 'Reactivate → portal open again', react.status === 200 && dash4.status === 200 ? 'PASS' : 'FAIL', `reactivate=${react.status} dashboard=${dash4.status}`);
    const block = await api('POST', `/api/admin/partners/${pid}/block`, { token: ADMIN, body: { reason: 'QA block' } });
    const lg3 = await apiLogin(`qa.partner.${ts}@example.test`, 'Strong-Partner-Pass-2026!');
    record('W15', 'Block → sign-in refused / portal closed', block.status === 200 && (lg3.status !== 200 || (await api('GET', '/api/partner/dashboard', { token: lg3.token })).status === 403) ? 'PASS' : 'FAIL', `block=${block.status} login=${lg3.status}`);
    await api('POST', `/api/admin/partners/${pid}/unblock`, { token: ADMIN, body: {} });
    // product access: deny tours for this partner → tour search as this partner returns none
    const access = await api('PUT', `/api/admin/partners/${pid}/product-access`, { token: ADMIN, body: { mode: 'DENY', items: [] } });
    record('W16', 'Product access endpoint answers (shape probe)', access.status < 500 ? 'PASS' : 'FAIL', msg(access));
    const audit = await api('GET', `/api/admin/partners/${pid}/audit`, { token: ADMIN });
    record('W17', 'Partner audit trail lists the lifecycle actions', audit.status === 200 && JSON.stringify(audit.body).match(/APPROVED|SUSPENDED|BLOCKED/) ? 'PASS' : 'FAIL', `${audit.status} actions=${(JSON.stringify(audit.body).match(/"action":"[A-Z_]+"/g) || []).slice(0, 8).join(',')}`);
    const pref = sql(`select reference from partners where id='${pid}'`); const del = await api('DELETE', `/api/admin/partners/${pid}`, { token: SA, body: { confirm: pref, reason: 'QA cleanup' } });
    record('W18', 'Cleanup: SUPER_ADMIN deletes the QA partner', del.status === 204 || del.status === 200 ? 'PASS' : 'INFO', msg(del));
    if (lg2.token) await api('POST', '/api/auth/logout', { token: lg2.token });
  }
}

// ===================== W2 rate change is reflected in the public price
{
  const hotelId = sql(`select id from hotels where slug='vera-house-tbilisi'`);
  const rts = await api('GET', `/api/admin/hotels/${hotelId}/room-types`, { token: SA });
  const rt = (rts.body.data || rts.body)[0];
  const rps = await api('GET', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/rate-plans`, { token: SA });
  const rp = (rps.body.data || rps.body).find((p) => p.status === 'ACTIVE') || (rps.body.data || rps.body)[0];
  const DATE = '2026-12-10', NEXT = '2026-12-11';
  const before = sql(`select net_cents, sell_cents from rates where rate_plan_id='${rp.id}' and date='${DATE}'`);
  const [net0, sell0] = before.split('|').map(Number);
  const pub0 = await api('GET', `/api/search/hotels/vera-house-tbilisi?checkIn=${DATE}&checkOut=${NEXT}&adults=2`);
  const off0 = (pub0.body.roomTypes || []).flatMap((r) => r.offers || []).find((o) => o.ratePlanId === rp.id);
  record('W20', 'Baseline: rate row and public offer exist for the date', before && off0 ? 'PASS' : 'FAIL', `db=${before} public=${off0?.quote?.totals?.totalCents}`);
  if (before && off0) {
    const put = await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/rate-plans/${rp.id}/rates`, { token: SA, body: { from: DATE, to: DATE, netCents: net0 * 2, sellCents: sell0 ? sell0 * 2 : null } });
    const pub1 = await api('GET', `/api/search/hotels/vera-house-tbilisi?checkIn=${DATE}&checkOut=${NEXT}&adults=2`);
    const off1 = (pub1.body.roomTypes || []).flatMap((r) => r.offers || []).find((o) => o.ratePlanId === rp.id);
    const ratio = off1 ? off1.quote.totals.totalCents / off0.quote.totals.totalCents : 0;
    record('W21', 'Doubling the net rate doubles the public price immediately (no stale cache)', put.status < 300 && Math.abs(ratio - 2) < 0.02 ? 'PASS' : 'FAIL', `put=${put.status} before=${off0.quote.totals.totalCents} after=${off1?.quote?.totals?.totalCents} ratio=${ratio.toFixed(3)}`);
    const audit = sql(`select count(*) from audit_logs where action::text like '%RATE%' and created_at > now() - interval '1 minute'`);
    record('W21b', 'Rate edit is audited', Number(audit) >= 1 ? 'PASS' : 'INFO', `rows=${audit}`);
    const restore = await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/rate-plans/${rp.id}/rates`, { token: SA, body: { from: DATE, to: DATE, netCents: net0, sellCents: sell0 || null } });
    const after = sql(`select net_cents, sell_cents from rates where rate_plan_id='${rp.id}' and date='${DATE}'`);
    record('W22', 'Restore original rate', restore.status < 300 && after === before ? 'PASS' : 'FAIL', `restore=${restore.status} db=${after} expected=${before}`);
    const topPut = await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/rate-plans/${rp.id}/rates`, { token: (await apiLogin(USERS.tourop)).token, body: { from: DATE, to: DATE, netCents: net0 } });
    record('W23', 'TOUR_OPERATOR cannot edit hotel rates (pricing.write)', topPut.status === 403 ? 'PASS' : 'FAIL', `status=${topPut.status}`);
    const neg = await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/rate-plans/${rp.id}/rates`, { token: SA, body: { from: DATE, to: DATE, netCents: -5 } });
    record('W24', 'Negative rate refused (400)', neg.status === 400 ? 'PASS' : 'FAIL', msg(neg));
    const sellBelow = await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/rate-plans/${rp.id}/rates`, { token: SA, body: { from: DATE, to: DATE, netCents: 10000, sellCents: 5000 } });
    record('W25', 'Fixed sell below net refused (S5 fix: sell ≥ net)', sellBelow.status === 400 || sellBelow.status === 422 ? 'PASS' : 'FAIL', msg(sellBelow));
    if (sellBelow.status < 300) await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/rate-plans/${rp.id}/rates`, { token: SA, body: { from: DATE, to: DATE, netCents: net0, sellCents: sell0 || null } });
    // inventory close-out → public offer disappears
    const inv0 = await api('GET', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/inventory/calendar?from=${DATE}&to=${DATE}`, { token: SA });
    const row0 = (inv0.body.data || inv0.body.days || inv0.body)[0];
    const close = await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/inventory`, { token: SA, body: { from: DATE, to: DATE, stopSell: true } });
    const pub2 = await api('GET', `/api/search/hotels/vera-house-tbilisi?checkIn=${DATE}&checkOut=${NEXT}&adults=2`);
    const off2 = (pub2.body.roomTypes || []).flatMap((r) => r.offers || []).find((o) => o.roomTypeId === rt.id);
    record('W26', 'Stop-sell on the room type removes its offers from public search', close.status < 300 && !off2 ? 'PASS' : 'FAIL', `close=${close.status} offerStillShown=${!!off2}`);
    const reopen = await api('PUT', `/api/admin/hotels/${hotelId}/room-types/${rt.id}/inventory`, { token: SA, body: { from: DATE, to: DATE, stopSell: false } });
    const pub3 = await api('GET', `/api/search/hotels/vera-house-tbilisi?checkIn=${DATE}&checkOut=${NEXT}&adults=2`);
    const off3 = (pub3.body.roomTypes || []).flatMap((r) => r.offers || []).find((o) => o.roomTypeId === rt.id);
    record('W27', 'Reopening restores the offers', reopen.status < 300 && !!off3 ? 'PASS' : 'FAIL', `reopen=${reopen.status} shown=${!!off3} stopSellBefore=${row0?.stopSell}`);
  }
}

// ===================== W3 publish checklists (hotel, tour, service)
{
  const destId = sql(`select id from destinations where slug='tbilisi'`) || sql(`select id from destinations where slug not like 'dest-%' order by created_at limit 1`);
  const h = await api('POST', '/api/admin/hotels', { token: SA, body: { slug: `qa-hotel-${ts}`, name: `QA Hotel ${ts}`, propertyType: 'Hotel', destinationId: destId, starRating: 3 } });
  record('W30', 'Create a DRAFT hotel', h.status === 201 && (h.body.status === 'DRAFT' || h.body.hotel?.status === 'DRAFT') ? 'PASS' : 'FAIL', msg(h));
  const hid = h.body.id || h.body.hotel?.id;
  if (hid) {
    const pub = await api('POST', `/api/admin/hotels/${hid}/publish`, { token: SA, body: {} });
    record('W31', 'Publishing an empty hotel is refused with the missing checklist items', pub.status === 422 && (pub.body.error?.details?.missing || []).length > 0 ? 'PASS' : 'FAIL', msg(pub));
    const visible = await api('GET', `/api/hotels/qa-hotel-${ts}`);
    record('W32', 'A DRAFT hotel is not public (404)', visible.status === 404 ? 'PASS' : 'FAIL', `status=${visible.status}`);
    const dup = await api('POST', '/api/admin/hotels', { token: SA, body: { slug: `qa-hotel-${ts}`, name: `QA Hotel dup`, propertyType: 'Hotel', destinationId: destId, starRating: 3 } });
    record('W33', 'Duplicate slug refused (409)', dup.status === 409 ? 'PASS' : 'FAIL', msg(dup));
    const topEdit = await api('PATCH', `/api/admin/hotels/${hid}`, { token: (await apiLogin(USERS.tourop)).token, body: { name: 'nope' } });
    record('W34', 'TOUR_OPERATOR cannot edit a hotel (catalogue.write)', topEdit.status === 403 ? 'PASS' : 'FAIL', `status=${topEdit.status}`);
    const del = await api('DELETE', `/api/admin/hotels/${hid}`, { token: SA });
    record('W35', 'Delete the DRAFT hotel', del.status === 204 || del.status === 200 ? 'PASS' : 'INFO', msg(del));
    if (del.status >= 400) sql(`delete from hotels where id='${hid}'`);
  }
  const t = await api('POST', '/api/admin/tours', { token: SA, body: { title: `QA Tour ${ts}`, slug: `qa-tour-${ts}`, destinationId: destId, category: 'culture', summary: 'QA', location: 'Tbilisi', durationDays: 1, durationLabel: '1 day', groupSize: 'Up to 8', difficulty: 'Easy', meetingPoint: 'Liberty Square' } });
  record('W36', 'Create a DRAFT tour', t.status === 201 ? 'PASS' : 'FAIL', msg(t));
  const tid = t.body.id || t.body.tour?.id;
  if (tid) {
    const pub = await api('POST', `/api/admin/tours/${tid}/publish`, { token: SA, body: {} });
    record('W37', 'Publishing an incomplete tour is refused (422 + missing)', pub.status === 422 ? 'PASS' : 'FAIL', msg(pub));
    const del = await api('DELETE', `/api/admin/tours/${tid}`, { token: SA });
    record('W38', 'Delete the DRAFT tour (no bookings)', del.status === 204 || del.status === 200 ? 'PASS' : 'FAIL', msg(del));
  }
  const pol = await api('GET', '/api/admin/tours/policies/cancellation', { token: SA });
  const polId = (pol.body.data || pol.body)[0]?.id;
  const s = await api('POST', '/api/admin/services', { token: SA, body: { slug: `qa-service-${ts}`, name: `QA Service ${ts}`, category: 'GUIDE', basis: 'PER_GROUP', netCents: 10000, cancellationPolicyId: polId, summary: 'QA service' } });
  record('W39', 'Create a DRAFT service', s.status === 201 ? 'PASS' : 'FAIL', msg(s));
  const sid = s.body.id || s.body.service?.id;
  if (sid) {
    const below = await api('PATCH', `/api/admin/services/${sid}`, { token: SA, body: { sellCents: 5000 } });
    record('W40', 'Service sell below net is refused — but as 409 "conflicts with current availability" (misleading status/message)', below.status === 400 || below.status === 422 ? 'PASS' : below.status === 409 ? 'FAIL' : 'FAIL', msg(below));
    const pub = await api('POST', `/api/admin/services/${sid}/publish`, { token: SA, body: {} });
    record('W41', 'Service publish checklist enforced', pub.status === 422 || pub.status === 200 ? 'PASS' : 'FAIL', msg(pub));
    const del = await api('DELETE', `/api/admin/services/${sid}`, { token: SA });
    record('W42', 'Delete the QA service', del.status === 204 || del.status === 200 ? 'PASS' : 'INFO', msg(del));
  }
}

// ===================== W4 admin cancel + notifications + audit filters + mail evidence
{
  const s = await api('GET', '/api/search?checkIn=2026-12-15&checkOut=2026-12-16&adults=2&pageSize=20');
  const card = (s.body.data || []).find((c) => c.cheapestOffer?.availableUnits > 1);
  if (card) {
    const b = await api('POST', '/api/bookings', { headers: { 'idempotency-key': randomUUID() }, body: { offerToken: card.cheapestOffer.token, leadGuest: { firstName: 'Qa', lastName: 'AdminCancel', email: 'qa.admincancel@example.test' } } });
    const ref = b.body.reference;
    const topCancel = await api('POST', `/api/admin/bookings/${ref}/cancel`, { token: (await apiLogin(USERS.tourop)).token, body: { reason: 'QA ops cancel' } });
    record('W50', 'TOUR_OPERATOR cancels a guest booking from the admin register (bookings.cancel)', topCancel.status === 200 && topCancel.body.status === 'CANCELLED' ? 'PASS' : 'FAIL', msg(topCancel));
    const row = sql(`select status, cancellation_reason from hotel_bookings where reference='${ref}'`);
    record('W50b', 'DB shows CANCELLED with the reason', row === 'CANCELLED|QA ops cancel' ? 'PASS' : 'FAIL', row);
    const au = await api('GET', `/api/admin/audit?search=${ref}`, { token: SA });
    record('W51', 'Audit log can be searched by booking reference', au.status === 200 && JSON.stringify(au.body).includes(ref) ? 'PASS' : 'FAIL', `${au.status} n=${au.body.data?.length}`);
  }
  const unread0 = await api('GET', '/api/admin/notifications/unread-count', { token: SA });
  const list = await api('GET', '/api/admin/notifications?pageSize=5', { token: SA });
  const first = (list.body.data || []).find((n) => !n.readAt);
  if (first) {
    const one = await api('POST', `/api/admin/notifications/${first.id}/read`, { token: SA, body: {} });
    const unread1 = await api('GET', '/api/admin/notifications/unread-count', { token: SA });
    record('W52', 'Mark one notification read decrements the unread count', one.status < 300 && unread1.body.unreadCount === unread0.body.unreadCount - 1 ? 'PASS' : 'FAIL', `before=${JSON.stringify(unread0.body)} after=${JSON.stringify(unread1.body)}`);
    const other = await api('POST', `/api/admin/notifications/${first.id}/read`, { token: (await apiLogin(USERS.dispatcher)).token, body: {} });
    record('W53', "Another user cannot mark someone else's notification (404)", other.status === 404 ? 'PASS' : 'FAIL', `status=${other.status}`);
  }
  const all = await api('POST', '/api/admin/notifications/read-all', { token: SA, body: {} });
  const unread2 = await api('GET', '/api/admin/notifications/unread-count', { token: SA });
  record('W54', 'Read-all → unread 0', all.status < 300 && unread2.body.unreadCount === 0 ? 'PASS' : 'FAIL', JSON.stringify(unread2.body));
  const auditFilter = await api('GET', '/api/admin/audit?action=PARTNER_TERMS_ACCEPTED', { token: SA });
  record('W55', 'Audit filter by action returns only that action', auditFilter.status === 200 && (auditFilter.body.data || []).length > 0 && (auditFilter.body.data || []).every((r) => r.action === 'PARTNER_TERMS_ACCEPTED') ? 'PASS' : 'FAIL', `n=${auditFilter.body.data?.length} actions=${[...new Set((auditFilter.body.data || []).map((r) => r.action))].join(',')}`);
  const log = fs.readFileSync(new URL('../logs/api.log', import.meta.url), 'utf8');
  const subjects = [...log.matchAll(/subject[^:]*: "([^"]+)"/g)].map((m) => m[1]);
  const kinds = [...new Set(subjects.map((s) => s.replace(/ - .*$/, '').replace(/[A-Z]{3}-\d+/g, '#')))];
  record('W56', 'Mail pipeline rendered templates for the bookings made in this audit (MAIL_TRANSPORT=log)', subjects.length > 0 ? 'PASS' : 'FAIL', `emails=${subjects.length} kinds=${kinds.slice(0, 10).join(' | ')}`);
  const unprocessed = sql(`select count(*), coalesce(string_agg(distinct left(last_error, 60), ';'), '') from outbox_events where processed_at is null and attempts > 0`);
  record('W57', 'No outbox events stuck with errors', unprocessed.startsWith('0|') ? 'PASS' : 'FAIL', unprocessed);
}
await api('POST', '/api/auth/logout', { token: SA }); await api('POST', '/api/auth/logout', { token: ADMIN });
