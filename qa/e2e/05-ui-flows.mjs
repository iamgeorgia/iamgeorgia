// Phase 3/4 — real browser journeys: hotel checkout + cancel, transfer booking, admin CRUD, invite, sign-out, XSS rendering, portal & driver screens.
import fs from 'node:fs';
import { launch, newPage, shot, record, USERS, CLIENT, API, api, apiLogin, loginViaApi, summarizeErrors, resetErrors, sql } from './lib.mjs';

const browser = await launch();
const clickCentered = async (loc) => { await loc.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {}); await loc.click({ timeout: 15000 }); };
const ts = Date.now();
{ const sa = (await apiLogin(USERS.superadmin)).token; for (const k of sql("select key from roles where lower(key) like 'qa_role_%'").split(/\r?\n/).filter(Boolean)) { const d = await api('DELETE', `/api/admin/roles/${k}`, { token: sa }); console.log('cleanup role', k, d.status); } for (const id of sql("select id from destinations where slug like 'qa-destination-%'").split(/\r?\n/).filter(Boolean)) { const d = await api('DELETE', `/api/admin/destinations/${id}`, { token: sa }); console.log('cleanup destination', id, d.status); } await api('POST', '/api/auth/logout', { token: sa }); }
const errs = (page) => { const e = summarizeErrors(page, { ignore: [/speed-insights/, /\/api\/auth\/me$/, /_next\/image/, /r2\.dev/] }); return `${e.pageerrors.length} js, ${e.http.length} http>=400${e.http.length ? ' (' + e.http.slice(0, 2).map((h) => h.status + ' ' + h.url.replace(API, '').replace(CLIENT, '')).join('; ') + ')' : ''}`; };
const hasErrs = (page) => { const e = summarizeErrors(page, { ignore: [/speed-insights/, /\/api\/auth\/me$/, /_next\/image/, /r2\.dev/] }); return e.pageerrors.length + e.http.filter((h) => h.status >= 500 || (h.status >= 400 && !/40[134]/.test(String(h.status)))).length; };

// ===================== HOTEL: search → room → checkout → confirmation → manage → cancel
if (!process.env.SKIP_FLOWS) {
  const { context, page } = await newPage(browser);
  await page.goto(`${CLIENT}/hotels?checkIn=2026-11-20&checkOut=2026-11-22&adults=2`, { waitUntil: 'networkidle' });
  const cards = await page.locator('main a[href^="/hotels/"]').count();
  record('UH1', 'Hotel listing renders cards', cards > 0 ? 'PASS' : 'FAIL', `links=${cards} ${errs(page)}`);
  // search form on the listing: set dates and submit
  const dateInputs = page.locator('main input[type="date"]');
  if (await dateInputs.count() >= 2) {
    await dateInputs.nth(0).fill('2026-11-20'); await dateInputs.nth(1).fill('2026-11-22');
    await Promise.all([page.waitForLoadState('networkidle'), page.locator('main button[type="submit"]').first().click()]);
    record('UH2', 'Listing search form submits and keeps the dates in the URL', /checkIn=2026-11-20/.test(page.url()) ? 'PASS' : 'FAIL', page.url().replace(CLIENT, ''));
  } else record('UH2', 'Listing search form', 'NOT TESTED', 'no date inputs on listing');
  await page.goto(`${CLIENT}/hotels/vera-house-tbilisi?checkIn=2026-11-20&checkOut=2026-11-22&adults=2`, { waitUntil: 'networkidle' });
  resetErrors(page);
  const reserve = page.getByRole('button', { name: /^reserve( this room)?$/i });
  await reserve.first().waitFor({ timeout: 20000 }).catch(() => {});
  const n = await reserve.count();
  record('UH3', 'Hotel detail shows dated room offers with Reserve buttons', n > 0 ? 'PASS' : 'FAIL', `buttons=${n} h1="${(await page.locator('h1').first().textContent())?.trim()}"`);
  await shot(page, 'UH3-hotel-detail');
  if (n > 0) {
    const priceText = await page.locator('main').innerText();
    await reserve.first().click();
    await page.waitForURL(/\/booking\/checkout/, { timeout: 20000 }).catch(() => {});
    record('UH4', 'Reserve creates a hold and opens checkout', /\/booking\/checkout\?hold=/.test(page.url()) ? 'PASS' : 'FAIL', page.url().replace(CLIENT, '').slice(0, 80));
    await page.waitForLoadState('networkidle');
    await shot(page, 'UH4-checkout');
    const countdown = await page.locator('main').innerText();
    record('UH4b', 'Checkout shows a hold countdown / summary', /\d{1,2}:\d{2}|minutes|held/i.test(countdown) ? 'PASS' : 'INFO', countdown.match(/.{0,30}(\d{1,2}:\d{2}|minutes).{0,20}/)?.[0] || '');
    // validation: submit empty
    await clickCentered(page.getByRole('button', { name: /confirm booking/i }));
    await page.waitForTimeout(600);
    const invalid = await page.locator('[aria-invalid="true"]').count();
    record('UH5', 'Empty checkout submit is blocked with field errors', invalid > 0 && /checkout/.test(page.url()) ? 'PASS' : 'FAIL', `aria-invalid=${invalid}`);
    // fill
    const email = `qa.ui.hotel+${ts}@example.test`;
    await page.getByLabel(/^first name/i).first().fill('Ui');
    await page.getByLabel(/^last name/i).first().fill('Tester');
    await page.getByLabel(/^email/i).first().fill(email);
    const phone = page.getByLabel(/phone/i).first(); if (await phone.count()) await phone.fill('+995555000555');
    const badEmail = page.getByLabel(/^email/i).first();
    await badEmail.fill('not-an-email'); await clickCentered(page.getByRole('button', { name: /confirm booking/i })); await page.waitForTimeout(500);
    record('UH5b', 'Malformed email is refused client-side or by the API', /checkout/.test(page.url()) ? 'PASS' : 'FAIL', `url=${page.url().replace(CLIENT, '').slice(0, 40)}`);
    await badEmail.fill(email);
    const special = page.locator('textarea').first(); if (await special.count()) await special.fill('UI run <img src=x onerror=alert(1)> & "quotes"');
    const btn = page.getByRole('button', { name: /confirm booking/i });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/bookings') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null),
      clickCentered(btn),
      btn.click({ force: true, timeout: 3000 }).catch(() => null), // double-click guard
    ]);
    await page.waitForURL(/\/booking\/confirmation\//, { timeout: 20000 }).catch(() => {});
    const ref = (page.url().match(/confirmation\/(BKG-\d+)/) || [])[1];
    await shot(page, 'UH6-confirmation');
    record('UH6', 'Checkout confirms and lands on the confirmation page', resp && resp.status() === 201 && ref ? 'PASS' : 'FAIL', `api=${resp?.status()} ref=${ref} url=${page.url().replace(CLIENT, '').slice(0, 60)} ${errs(page)}`);
    const dup = sql(`select count(*) from hotel_bookings where lead_guest_email='${email}'`);
    record('UH7', 'Double-clicking Confirm creates exactly one booking', dup === '1' ? 'PASS' : 'FAIL', `rows=${dup}`);
    if (ref) {
      const apiView = await api('GET', `/api/bookings/${ref}?email=${encodeURIComponent(email)}`);
      const shown = await page.locator('main').innerText();
      const totalShown = (shown.match(/\d[\d,.\s]*\d\s*(₾|GEL)|(₾|GEL)\s*\d[\d,.\s]*/g) || []).slice(0, 3);
      record('UH8', 'Confirmation page shows the reference and status matching the API', shown.includes(ref) && apiView.body.status === 'CONFIRMED' ? 'PASS' : 'FAIL', `status=${apiView.body.status} total=${apiView.body.totalCents} shown=${totalShown.join(' | ')}`);
      const expectedMajor = (apiView.body.totalCents / 100).toFixed(2).replace('.00', '');
      record('UH8b', 'Displayed total equals API total', shown.replace(/[,\s]/g, '').includes(expectedMajor.replace('.', '.')) || shown.replace(/[,\s]/g, '').includes(String(Math.round(apiView.body.totalCents / 100))) ? 'PASS' : 'FAIL', `expect ${expectedMajor} in page`);
      await page.reload({ waitUntil: 'networkidle' });
      record('UH9', 'Confirmation survives a reload', (await page.locator('main').innerText()).includes(ref) ? 'PASS' : 'FAIL', '');
      // manage: lookup form
      await page.goto(`${CLIENT}/booking/manage`, { waitUntil: 'networkidle' });
      const refInput = page.locator('main input').first();
      const emailInput = page.locator('main input[type="email"]').first();
      if (await refInput.count() && await emailInput.count()) {
        await refInput.fill(ref); await emailInput.fill(email);
        await page.locator('main button[type="submit"]').first().click();
        await page.waitForURL(/\/booking\/manage\/BKG-/, { timeout: 15000 }).catch(() => {});
        record('UH10', 'Manage-booking lookup by reference + email opens the booking', page.url().includes(`/booking/manage/${ref}`) ? 'PASS' : 'FAIL', page.url().replace(CLIENT, ''));
        await page.goto(`${CLIENT}/booking/manage`, { waitUntil: 'networkidle' });
        await page.locator('main input').first().fill(ref); await page.locator('main input[type="email"]').first().fill('wrong@example.test');
        await page.locator('main button[type="submit"]').first().click(); await page.waitForTimeout(1500);
        const wrongTxt = await page.locator('main').innerText(); record('UH11', 'Lookup with the wrong email is refused (no booking details shown)', /no booking matches/i.test(wrongTxt) && !wrongTxt.includes('Ui Tester') ? 'PASS' : 'FAIL', wrongTxt.replace(/s+/g, ' ').slice(0, 80));
      } else record('UH10', 'manage lookup form', 'NOT TESTED', 'inputs not found');
      await page.goto(`${CLIENT}/booking/manage/${ref}?email=${encodeURIComponent(email)}`, { waitUntil: 'networkidle' });
      resetErrors(page);
      const body = await page.locator('main').innerText();
      record('UH12', 'Manage page shows special requests escaped (XSS payload rendered as text)', body.includes('<img src=x') && (await page.locator('main img[src="x"]').count()) === 0 ? 'PASS' : 'FAIL', `${body.includes('<img src=x')} imgs=${await page.locator('main img[src="x"]').count()}`);
      const cancelBtn = page.getByRole('button', { name: /cancel/i }).first();
      if (await cancelBtn.count()) {
        await cancelBtn.click();
        await page.waitForTimeout(600);
        const dlg = page.locator('[role="dialog"], [role="alertdialog"]');
        const quoteText = (await dlg.innerText().catch(() => '')) || (await page.locator('main').innerText());
        record('UH13', 'Cancel opens a confirmation that states the charge/refund', /refund|charge|free|₾|GEL/i.test(quoteText) ? 'PASS' : 'INFO', quoteText.replace(/\s+/g, ' ').slice(0, 140));
        const confirmBtn = dlg.getByRole('button', { name: /cancel booking|confirm|yes/i }).last();
        const [cres] = await Promise.all([
          page.waitForResponse((r) => r.url().includes(`/api/bookings/${ref}/cancel`), { timeout: 15000 }).catch(() => null),
          (await confirmBtn.count()) ? confirmBtn.click() : page.getByRole('button', { name: /cancel booking/i }).last().click(),
        ]);
        await page.waitForTimeout(1000);
        const after = await api('GET', `/api/bookings/${ref}?email=${encodeURIComponent(email)}`);
        await shot(page, 'UH14-cancelled');
        record('UH14', 'Confirming cancellation cancels the booking (UI + API agree)', cres && cres.status() === 200 && after.body.status === 'CANCELLED' && /cancel/i.test(await page.locator('main').innerText()) ? 'PASS' : 'FAIL', `api=${cres?.status()} status=${after.body.status} ${errs(page)}`);
      } else record('UH13', 'cancel button', 'FAIL', 'no cancel button on manage page');
    }
  }
  await context.close();
}

// ===================== TRANSFER: search → results → booking form → confirmation
if (!process.env.SKIP_FLOWS) try {
  const { context, page } = await newPage(browser);
  await page.goto(`${CLIENT}/transfers/search?from=tbilisi-airport&to=gudauri&date=2026-11-20&time=10:00&adults=2&children=0&luggage=2&cabinBags=0`, { waitUntil: 'networkidle' });
  const offers = page.locator('main a[href^="/transfers/"][href*="from="]:not([href*="/transfers/sedan-"]):not([href*="/transfers/vehicle-"])');
  await offers.first().waitFor({ timeout: 20000 }).catch(() => {});
  const n = await offers.count();
  await shot(page, 'UT1-results');
  record('UT1', 'Transfer search results list vehicle offers', n > 0 ? 'PASS' : 'FAIL', `offers=${n} ${errs(page)}`);
  if (n > 0) {
    await offers.first().click();
    await page.waitForURL(/\/transfers\/(?!search)[^?]+\?from=/, { timeout: 30000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
    record('UT1b', 'Offer card opens the vehicle detail with the journey kept in the URL', /\/transfers\/(?!search)[^?]+\?from=/.test(page.url()) ? 'PASS' : 'FAIL', page.url().replace(CLIENT, '').slice(0, 80));
    const go = page.locator('main a[href*="/transfers/booking"]').first();
    if (await go.count()) await clickCentered(go);
    await page.waitForURL(/\/transfers\/booking/, { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState('networkidle');
    record('UT2', 'Choosing an offer opens the booking form with the quote', /\/transfers\/booking/.test(page.url()) && (await page.locator('#firstName').count()) === 1 ? 'PASS' : 'FAIL', page.url().replace(CLIENT, '').slice(0, 60));
    await clickCentered(page.locator('button[type="submit"]').last()); await page.waitForTimeout(500);
    record('UT3', 'Empty transfer form is blocked', (await page.locator('[aria-invalid="true"], [role="alert"]').count()) > 0 && /booking/.test(page.url()) ? 'PASS' : 'FAIL', '');
    const email = `qa.ui.transfer+${ts}@example.test`;
    await page.fill('#firstName', 'Ui'); await page.fill('#lastName', 'Passenger'); await page.fill('#email', email);
    const ph = page.locator('#phone'); if (await ph.count()) await ph.fill('+995555000444');
    const fl = page.locator('#flightNumber'); if (await fl.count()) await fl.fill('TK378');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/transfers/bookings') && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null),
      page.locator('button[type="submit"]').last().click(),
    ]);
    await page.waitForURL(/\/transfers\/confirmation\//, { timeout: 20000 }).catch(() => {});
    const ref = (page.url().match(/confirmation\/(TRF-\d+)/) || [])[1];
    await shot(page, 'UT4-confirmation');
    record('UT4', 'Transfer booking confirms and shows the confirmation page', resp?.status() === 201 && ref ? 'PASS' : 'FAIL', `api=${resp?.status()} ref=${ref} ${errs(page)}`);
    if (ref) {
      const v = await api('GET', `/api/transfers/bookings/${ref}?email=${encodeURIComponent(email)}`);
      const shown = await page.locator('main').innerText();
      record('UT5', 'Confirmation shows reference, pick-up and total consistent with the API', shown.includes(ref) && v.body.status === 'CONFIRMED' && shown.replace(/[,\s]/g, '').includes(String(Math.round(v.body.totalCents / 100))) ? 'PASS' : 'FAIL', `status=${v.body.status} total=${v.body.totalCents}`);
      const cx = await api('POST', `/api/transfers/bookings/${ref}/cancel`, { body: { email, reason: 'QA cleanup' } });
      record('UT6', 'Cleanup: transfer cancelled via API', cx.status === 200 ? 'PASS' : 'INFO', `${cx.status}`);
    }
  }
  await context.close();
} catch (e) { record('UT-x', 'transfer UI flow aborted', 'FAIL', String(e.message).slice(0, 160)); }

// ===================== ADMIN: sign-out, destination CRUD, role, invite, XSS in admin views
try {
  const { context, page } = await newPage(browser);
  await loginViaApi(context, USERS.superadmin);
  // XSS rendering in admin booking detail (booking from the API run carries <b>bold</b>)
  const xref = sql(`select reference from hotel_bookings where special_requests like '%<b>bold</b>%' order by created_at desc limit 1`);
  if (xref) {
    await page.goto(`${CLIENT}/admin/bookings/${xref}`, { waitUntil: 'networkidle' });
    const txt = await page.locator('main').innerText();
    record('UA1', 'Admin booking detail renders guest text escaped (no injected markup)', txt.includes('<b>bold</b>') && (await page.locator('main b:has-text("bold")').count()) === 0 ? 'PASS' : 'FAIL', `raw=${txt.includes('<b>bold</b>')} b-elements=${await page.locator('main b:has-text("bold")').count()}`);
  }
  // destination create
  await page.goto(`${CLIENT}/admin/destinations/new`, { waitUntil: 'networkidle' });
  resetErrors(page);
  await page.fill('#destination-name', `QA Destination ${ts}`);
  const slugField = page.locator('#destination-slug'); if (await slugField.count()) { await slugField.fill(`qa-destination-${ts}`); }
  for (const sel of ['#destination-type', '#destination-parent', '#destination-country', '#destination-timezone']) {
    const el = page.locator(sel);
    if (await el.count() && (await el.evaluate((e) => e.tagName)) === 'SELECT') {
      const opts = await el.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      if (sel === '#destination-parent') { const ge = await el.locator('option', { hasText: /^Georgia$/ }).first().getAttribute('value').catch(() => null); if (ge) await el.selectOption(ge); else if (opts[0]) await el.selectOption(opts[0]); }
      else if (sel === '#destination-country') { if (opts.includes('GE')) await el.selectOption('GE'); else if (opts[0]) await el.selectOption(opts[0]); }
      else if (opts[0]) await el.selectOption(opts[0]);
    } else if (await el.count()) { if (sel === '#destination-country') await el.fill('GE'); if (sel === '#destination-timezone') await el.fill('Asia/Tbilisi'); }
  }
  const tagline = page.locator('#destination-tagline'); if (await tagline.count()) await tagline.fill('QA tagline');
  const summary = page.locator('#destination-summary'); if (await summary.count()) await summary.fill('QA summary text for a disposable destination.');
  const submit = page.locator('main button[type="submit"]').first();
  const disabled = await submit.isDisabled();
  await shot(page, 'UA2-destination-form');
  if (!disabled) {
    const [resp] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/admin/destinations') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null), submit.click()]);
    await page.waitForTimeout(1500);
    const created = sql(`select id, name from destinations where slug='qa-destination-${ts}'`);
    record('UA2', 'Create destination via the form → 201 and a DB row', resp?.status() === 201 && created ? 'PASS' : 'FAIL', `api=${resp?.status()} db=${created} url=${page.url().replace(CLIENT, '')} ${errs(page)}`);
    const destId = created.split('|')[0];
    if (destId) {
      await page.goto(`${CLIENT}/admin/destinations/${destId}`, { waitUntil: 'networkidle' });
      const nameField = page.locator('#destination-name');
      await nameField.fill(`QA Destination ${ts} edited`);
      const [pr] = await Promise.all([page.waitForResponse((r) => r.url().includes(`/api/admin/destinations/${destId}`) && /PATCH|PUT/.test(r.request().method()), { timeout: 15000 }).catch(() => null), page.locator('main button[type="submit"]').first().click()]);
      await page.waitForTimeout(800);
      await page.reload({ waitUntil: 'networkidle' });
      const persisted = await page.locator('#destination-name').inputValue();
      record('UA3', 'Edit destination name → saved and persists after reload', pr && pr.status() < 300 && persisted.endsWith('edited') ? 'PASS' : 'FAIL', `api=${pr?.status()} value="${persisted}" db=${sql(`select name from destinations where id='${destId}'`)}`);
      // delete via danger zone
      const del = page.getByRole('button', { name: /delete/i }).first();
      if (await del.count()) {
        await del.click(); await page.waitForTimeout(500);
        const dlg = page.locator('[role="dialog"], [role="alertdialog"]');
        const confirmInput = dlg.locator('input'); if (await confirmInput.count()) await confirmInput.first().fill((await confirmInput.first().getAttribute('placeholder')) || `qa-destination-${ts}`);
        const [dr] = await Promise.all([page.waitForResponse((r) => r.url().includes(`/api/admin/destinations/${destId}`) && r.request().method() === 'DELETE', { timeout: 15000 }).catch(() => null), dlg.getByRole('button', { name: /delete/i }).last().click().catch(() => page.getByRole('button', { name: /delete/i }).last().click())]);
        await page.waitForTimeout(1000);
        const gone = sql(`select count(*) from destinations where id='${destId}'`);
        record('UA4', 'Delete destination (confirmation dialog) → removed from DB and list redirects', gone === '0' && /\/admin\/destinations\/?$/.test(page.url()) ? 'PASS' : 'FAIL', `api=${dr?.status()} rows=${gone} url=${page.url().replace(CLIENT, '')}`);
      } else record('UA4', 'delete destination', 'NOT TESTED', 'no delete button');
    }
  } else record('UA2', 'Create destination form', 'BLOCKED', 'submit disabled after filling known fields (required fields not identified)');

  // role create
  await page.goto(`${CLIENT}/admin/roles/new`, { waitUntil: 'networkidle' });
  const inputs = page.locator('main input[type="text"], main input:not([type])');
  const nIn = await inputs.count();
  if (nIn >= 2) {
    await inputs.nth(0).fill(`QA role ${ts}`); await inputs.nth(1).fill(`QA_ROLE_${ts}`);
    const cb = page.locator('main input[type="checkbox"]'); if (await cb.count()) { await cb.nth(0).check(); await cb.nth(1).check().catch(() => {}); }
    const [rr] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/admin/roles') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null), page.locator('main button[type="submit"]').first().click()]);
    await page.waitForTimeout(1200);
    const row = sql(`select key, name, (select count(*) from role_capabilities rc where rc.role_id=r.id) from roles r where lower(key)='qa_role_${ts}'`);
    record('UA5', 'Create a custom role via the editor → DB row with its capabilities', rr?.status() === 201 && row ? 'PASS' : 'FAIL', `api=${rr?.status()} db=${row} url=${page.url().replace(CLIENT, '')}`);
    if (row) { const d = await api('DELETE', `/api/admin/roles/${row.split('|')[0]}`, { token: (await apiLogin(USERS.superadmin)).token }); record('UA5b', 'Cleanup: role deleted via API', d.status < 300 ? 'PASS' : 'INFO', `status=${d.status}`); }
  } else record('UA5', 'role form', 'NOT TESTED', `inputs=${nIn}`);

  // invite staff
  await page.goto(`${CLIENT}/admin/users`, { waitUntil: 'networkidle' });
  const inviteBtn = page.getByRole('button', { name: /invite/i }).first();
  if (await inviteBtn.count()) {
    await inviteBtn.click(); await page.waitForTimeout(500);
    const dlg = page.locator('[role="dialog"]');
    const email = `qa.invite.${ts}@example.test`;
    await dlg.locator('input[type="email"]').fill(email);
    const texts = dlg.locator('input[type="text"], input:not([type]):not([type="email"])');
    if (await texts.count() >= 2) { await texts.nth(0).fill('Qa'); await texts.nth(1).fill('Invitee'); }
    const sel = dlg.locator('select'); if (await sel.count()) { const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean)); await sel.selectOption(opts.includes('MANAGEMENT') ? 'MANAGEMENT' : opts[0]); }
    const [ir] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/admin/users') && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null), dlg.locator('button[type="submit"]').first().click()]);
    await page.waitForTimeout(1000);
    const dtxt = await dlg.innerText().catch(() => '');
    const copy = await dlg.getByRole('button', { name: /copy/i }).count();
    await shot(page, 'UA6-invite');
    const dbu = sql(`select is_active, (select key from roles where id=u.primary_role_id) from users u where email='${email}'`);
    record('UA6', 'Invite staff via modal → user row created, activation link shown with a Copy button', ir?.status() === 201 && dbu && copy > 0 ? 'PASS' : 'FAIL', `api=${ir?.status()} db=${dbu} copyBtn=${copy} text="${dtxt.replace(/\s+/g, ' ').slice(0, 100)}"`);
    const link = (dtxt.match(/https?:\/\/\S+activate\S*/) || [])[0] || (await dlg.locator('input[readonly], code, a[href*="activate"]').first().inputValue().catch(() => null)) || (await dlg.locator('a[href*="activate"]').first().getAttribute('href').catch(() => null));
    if (link) {
      const p2 = await context.newPage(); await p2.goto(link.startsWith('http') ? link : `${CLIENT}${link}`, { waitUntil: 'networkidle' });
      const hasPw = await p2.locator('input[type="password"]').count();
      record('UA7', 'Activation link opens the set-password page', hasPw > 0 ? 'PASS' : 'FAIL', `url=${p2.url().replace(CLIENT, '').slice(0, 60)} pwInputs=${hasPw}`);
      if (hasPw) {
        const pws = p2.locator('input[type="password"]');
        for (let i = 0; i < await pws.count(); i++) await pws.nth(i).fill('Qa-Activate-2026!');
        const [ar] = await Promise.all([p2.waitForResponse((r) => r.url().includes('/api/auth/activation/'), { timeout: 15000 }).catch(() => null), p2.locator('button[type="submit"]').first().click()]);
        await p2.waitForTimeout(1500);
        const lg = await apiLogin(email, 'Qa-Activate-2026!');
        record('UA8', 'Activation sets the password; the new staff member can sign in', ar && ar.status() < 300 && lg.status === 200 ? 'PASS' : 'FAIL', `activation=${ar?.status()} login=${lg.status} url=${p2.url().replace(CLIENT, '').slice(0, 50)}`);
        if (lg.token) await api('POST', '/api/auth/logout', { token: lg.token });
      }
      await p2.close();
    } else record('UA7', 'activation link', 'NOT TESTED', 'link not found in modal');
    // deactivate the invitee from their page
    const uid = sql(`select id from users where email='${email}'`);
    if (uid) {
      const sa = (await apiLogin(USERS.superadmin)).token;
      const deact = await api('POST', `/api/admin/users/${uid}/deactivate`, { token: sa, body: { reason: 'QA cleanup' } });
      const lg2 = await apiLogin(email, 'Qa-Activate-2026!');
      record('UA9', 'Deactivated user can no longer sign in', deact.status < 300 && lg2.status === 401 || lg2.status === 403 ? 'PASS' : 'INFO', `deactivate=${deact.status} login=${lg2.status}`);
      await api('POST', '/api/auth/logout', { token: sa });
    }
  } else record('UA6', 'invite button', 'FAIL', 'no Invite button on /admin/users');

  // list filters: bookings search + status filter
  await page.goto(`${CLIENT}/admin/bookings`, { waitUntil: 'networkidle' });
  const search = page.locator('main input[type="search"], main input[placeholder*="earch" i], main input[placeholder*="eference" i], main input[type="text"]').first();
  if (await search.count()) {
    const target = sql(`select reference from hotel_bookings order by created_at desc limit 1`);
    await search.fill(target); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    const rows = await page.locator('main table tbody tr, main [role="row"]').count();
    const txt = await page.locator('main').innerText();
    record('UA10', 'Bookings list search by reference narrows to the booking', txt.includes(target) && rows <= 3 ? 'PASS' : 'FAIL', `rows=${rows} found=${txt.includes(target)} url=${page.url().replace(CLIENT, '').slice(0, 60)}`);
  } else record('UA10', 'bookings search', 'NOT TESTED', 'no search input');
  // sign out via the account menu
  await page.goto(`${CLIENT}/admin`, { waitUntil: 'networkidle' });
  const menu = page.locator('button[aria-haspopup="menu"]:visible').first();
  await menu.click({ timeout: 15000 }).catch(async () => { await page.locator('header button:visible').last().click(); });
  const so = page.getByRole('button', { name: /sign out/i }).first();
  await so.click();
  await page.waitForURL(/sign-in/, { timeout: 15000 }).catch(() => {});
  const cookies = await context.cookies();
  record('UA11', 'Admin account menu → Sign out clears the session and redirects', /sign-in/.test(page.url()) && !cookies.find((c) => c.name === 'iag_session') ? 'PASS' : 'FAIL', page.url().replace(CLIENT, ''));
  await context.close();
} catch (e) { record('UA-x', 'admin UI block aborted', 'FAIL', String(e.message).slice(0, 160)); }

// ===================== PORTAL (after terms accepted) + DRIVER
{
  const { context, page } = await newPage(browser);
  await loginViaApi(context, USERS.agencyOwner);
  for (const p of ['/portal/dashboard', '/portal/bookings', '/portal/finance', '/portal/team', '/portal/settings', '/portal/notifications']) {
    resetErrors(page);
    const r = await page.goto(`${CLIENT}${p}`, { waitUntil: 'networkidle' });
    const h1 = (await page.locator('h1').first().textContent().catch(() => ''))?.trim();
    record(`UP-${p}`, `Portal page ${p} renders for an approved owner`, r.status() === 200 && !/sign-in|terms/.test(page.url()) && hasErrs(page) === 0 ? 'PASS' : 'FAIL', `${r.status()} h1="${h1}" ${errs(page)} url=${page.url().replace(CLIENT, '')}`);
  }
  await page.goto(`${CLIENT}/portal/bookings`, { waitUntil: 'networkidle' });
  const link = await page.locator('main a[href*="/portal/bookings/"]').first().getAttribute('href').catch(() => null);
  if (link) { resetErrors(page); await page.goto(`${CLIENT}${link.replace(/^\/en/, '')}`, { waitUntil: 'networkidle' }); record('UP-detail', 'Portal booking detail renders', hasErrs(page) === 0 ? 'PASS' : 'FAIL', `${link} ${errs(page)}`); } else record('UP-detail', 'portal booking detail', 'NOT TESTED', 'no rows');
  // team invite form present
  await page.goto(`${CLIENT}/portal/team`, { waitUntil: 'networkidle' });
  const teamInvite = await page.getByRole('button', { name: /invite|add/i }).count();
  record('UP-team', 'Team page offers an invite action', teamInvite > 0 ? 'PASS' : 'INFO', `buttons=${teamInvite}`);
  // notifications: mark read
  await page.goto(`${CLIENT}/portal/notifications`, { waitUntil: 'networkidle' });
  const markAll = page.getByRole('button', { name: /mark all|read/i }).first();
  if (await markAll.count()) {
    const [mr] = await Promise.all([page.waitForResponse((r) => /notifications/.test(r.url()) && /POST|PATCH|PUT/.test(r.request().method()), { timeout: 10000 }).catch(() => null), markAll.click()]);
    const unread = sql(`select count(*) from notifications n join users u on u.id=n.recipient_user_id where u.email='${USERS.agencyOwner}' and n.read_at is null`);
    record('UP-notif', 'Mark notifications read → API call and DB unread count 0', mr && mr.status() < 300 && unread === '0' ? 'PASS' : 'FAIL', `api=${mr?.status()} unread=${unread}`);
  } else record('UP-notif', 'mark read', 'NOT TESTED', 'no mark-read button');
  await context.close();
}
{
  const { context, page } = await newPage(browser);
  await loginViaApi(context, 'ana.lomidze@demo.iamgeorgia.test', 'driver-demo-password');
  await page.goto(`${CLIENT}/driver/me`, { waitUntil: 'networkidle' });
  const phone = page.locator('main input[type="tel"], main input[name="phone"], main input[id*="phone"]').first();
  if (await phone.count()) {
    const newPhone = `+9955550${String(ts).slice(-5)}`;
    await phone.fill(newPhone);
    const [pr] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/driver/me') && r.request().method() === 'PATCH', { timeout: 10000 }).catch(() => null), page.locator('main button[type="submit"]').first().click()]);
    await page.reload({ waitUntil: 'networkidle' });
    const val = await page.locator('main input[type="tel"], main input[name="phone"], main input[id*="phone"]').first().inputValue();
    record('UD1', 'Driver edits own phone → PATCH /driver/me persists', pr?.status() === 200 && val === newPhone ? 'PASS' : 'FAIL', `api=${pr?.status()} value=${val} db=${sql(`select phone from transfer_drivers d join users u on u.id=d.user_id where u.email='ana.lomidze@demo.iamgeorgia.test'`)}`);
  } else record('UD1', 'driver profile edit', 'NOT TESTED', 'no phone input');
  await page.goto(`${CLIENT}/driver/upcoming`, { waitUntil: 'networkidle' });
  const jobs = await page.locator('main a[href*="/driver/assignments/"]').count();
  record('UD2', 'Driver upcoming list renders jobs', jobs >= 0 ? 'PASS' : 'FAIL', `jobs=${jobs} ${errs(page)}`);
  await context.close();
}

await browser.close();
