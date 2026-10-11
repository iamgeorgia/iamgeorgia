// Phase 4.1 — authentication workflows through the real UI and the API.
import { launch, newPage, shot, record, USERS, PASSWORD, CLIENT, API, api, apiLogin, summarizeErrors } from './lib.mjs';

const browser = await launch();

async function uiLogin(page, path, email, password) {
  await page.goto(`${CLIENT}${path}`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/login')).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
}

// --- A1 admin login valid
{
  const { context, page } = await newPage(browser);
  await uiLogin(page, '/admin/sign-in', USERS.superadmin, PASSWORD);
  await page.waitForURL(/\/admin(\/)?$/, { timeout: 15000 }).catch(() => {});
  const ok = /\/admin\/?$/.test(page.url());
  await shot(page, 'A1-admin-login');
  record('A1', 'Admin sign-in valid → dashboard', ok ? 'PASS' : 'FAIL', `landed ${page.url()}`);
  // session persistence after reload
  await page.reload({ waitUntil: 'networkidle' });
  record('A2', 'Admin session persists after reload', /\/admin\/?$/.test(page.url()) ? 'PASS' : 'FAIL', page.url());
  // logout via UI
  const logoutBtn = page.getByRole('button', { name: /sign out|log out/i }).first();
  const hasLogout = await logoutBtn.count();
  if (hasLogout) {
    await logoutBtn.click();
    await page.waitForURL(/sign-in/, { timeout: 15000 }).catch(() => {});
    const cookies = await context.cookies();
    const sess = cookies.find((c) => c.name === 'iag_session');
    record('A3', 'Admin sign-out clears session and redirects', /sign-in/.test(page.url()) && !sess ? 'PASS' : 'FAIL', `url=${page.url()} cookie=${sess ? 'still present' : 'cleared'}`);
    await page.goto(`${CLIENT}/admin/bookings`, { waitUntil: 'networkidle' });
    record('A4', 'Protected admin route after logout redirects to sign-in', /sign-in/.test(page.url()) ? 'PASS' : 'FAIL', page.url());
  } else {
    await shot(page, 'A3-no-logout-button');
    record('A3', 'Admin sign-out button exists', 'FAIL', 'no sign out button found');
  }
  const e = summarizeErrors(page);
  record('A1e', 'Admin auth pages: no JS errors', e.pageerrors.length ? 'FAIL' : 'PASS', JSON.stringify(e.pageerrors.slice(0, 3)));
  await context.close();
}

// --- A5 admin login invalid password
{
  const { context, page } = await newPage(browser);
  await uiLogin(page, '/admin/sign-in', USERS.superadmin, 'wrong-password-123');
  await page.waitForTimeout(1500);
  const err = await page.locator('#admin-signin-error, [role="alert"]').first().textContent().catch(() => '');
  await shot(page, 'A5-admin-invalid');
  record('A5', 'Admin sign-in wrong password shows error, stays on page', /sign-in/.test(page.url()) && err?.trim() ? 'PASS' : 'FAIL', `url=${page.url()} msg="${(err || '').trim().slice(0, 80)}"`);
  await context.close();
}

// --- A6 partner user cannot use admin sign-in
{
  const { context, page } = await newPage(browser);
  await uiLogin(page, '/admin/sign-in', USERS.agencyOwner, PASSWORD);
  await page.waitForTimeout(2500);
  const url = page.url();
  const err = await page.locator('#admin-signin-error, [role="alert"]').first().textContent().catch(() => '');
  await shot(page, 'A6-partner-on-admin');
  record('A6', 'Partner account on admin sign-in is not admitted to /admin', /\/admin\/?$/.test(url) ? 'FAIL' : 'PASS', `url=${url} msg="${(err || '').trim().slice(0, 80)}"`);
  await context.close();
}

// --- A7 portal login valid + reload + A8 suspended partner
{
  const { context, page } = await newPage(browser);
  await uiLogin(page, '/portal/sign-in', USERS.agencyOwner, PASSWORD);
  await page.waitForURL(/\/portal/, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, 'A7-portal-login');
  record('A7', 'Portal sign-in valid → portal', /\/portal(?!\/sign-in)/.test(page.url()) ? 'PASS' : 'FAIL', page.url());
  await page.goto(`${CLIENT}/admin`, { waitUntil: 'networkidle' });
  record('A7b', 'Partner session visiting /admin is redirected away', /\/admin\/?$/.test(page.url()) && !/sign-in/.test(page.url()) ? 'FAIL' : 'PASS', page.url());
  await context.close();
}
{
  const { context, page } = await newPage(browser);
  await uiLogin(page, '/portal/sign-in', USERS.suspendedOwner, PASSWORD);
  await page.waitForTimeout(2500);
  await shot(page, 'A8-suspended-portal');
  const text = (await page.locator('main').innerText().catch(() => '')).slice(0, 300);
  record('A8', 'Suspended partner: login shows suspended state (no bookings access)', 'INFO', `url=${page.url()} text="${text.replace(/\s+/g, ' ').slice(0, 160)}"`);
  await context.close();
}

// --- A9 driver login
{
  const { context, page } = await newPage(browser);
  await uiLogin(page, '/driver/sign-in', 'ana.lomidze@demo.iamgeorgia.test', 'driver-demo-password');
  await page.waitForURL(/\/driver(?!\/sign-in)/, { timeout: 15000 }).catch(() => {});
  await shot(page, 'A9-driver-login');
  record('A9', 'Driver sign-in valid → driver panel', /\/driver(?!\/sign-in)/.test(page.url()) ? 'PASS' : 'FAIL', page.url());
  await page.goto(`${CLIENT}/admin`, { waitUntil: 'networkidle' });
  record('A9b', 'Driver session visiting /admin is redirected away', /\/admin\/?$/.test(page.url()) && !/sign-in/.test(page.url()) ? 'FAIL' : 'PASS', page.url());
  await context.close();
}

// --- A10 forgot password page + submit
{
  const { context, page } = await newPage(browser);
  await page.goto(`${CLIENT}/forgot-password`, { waitUntil: 'networkidle' });
  const hasForm = await page.locator('input[type="email"]').count();
  if (hasForm) {
    await page.fill('input[type="email"]', USERS.agencyAgent);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/'), { timeout: 10000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(800);
    const text = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    await shot(page, 'A10-forgot');
    record('A10', 'Forgot password submits and shows neutral confirmation', res && res.status() < 400 ? 'PASS' : 'FAIL', `status=${res?.status()} text="${text.slice(0, 120)}"`);
  } else {
    record('A10', 'Forgot password page has a form', 'FAIL', 'no email input');
  }
  await context.close();
}

// --- API-level auth checks
{
  const noAuth = await api('GET', '/api/auth/me');
  record('A11', 'GET /me without session → 401', noAuth.status === 401 ? 'PASS' : 'FAIL', `status=${noAuth.status}`);
  const bad = await apiLogin(USERS.admin, 'nope');
  record('A12', 'Login wrong password → 401, no cookie', bad.status === 401 && !bad.token ? 'PASS' : 'FAIL', `status=${bad.status} body=${JSON.stringify(bad.body).slice(0, 100)}`);
  const unknown = await apiLogin('nobody@nowhere.test', 'nope');
  record('A13', 'Login unknown email → same status/body as wrong password (no enumeration)', unknown.status === bad.status && JSON.stringify(unknown.body) === JSON.stringify(bad.body) ? 'PASS' : 'FAIL', `${unknown.status} ${JSON.stringify(unknown.body).slice(0, 100)}`);
  const good = await apiLogin(USERS.admin);
  const me = await api('GET', '/api/auth/me', { token: good.token });
  record('A14', 'Login valid → /me returns user with capabilities', me.status === 200 && Array.isArray(me.body?.user?.capabilities || me.body?.capabilities) ? 'PASS' : 'FAIL', `status=${me.status} keys=${Object.keys(me.body || {}).join(',')}`);
  const lo = await api('POST', '/api/auth/logout', { token: good.token });
  const after = await api('GET', '/api/auth/me', { token: good.token });
  record('A15', 'Logout invalidates session server-side', lo.status < 300 && after.status === 401 ? 'PASS' : 'FAIL', `logout=${lo.status} me-after=${after.status}`);
  // CSRF: cross-origin POST with cookie must be refused
  const good2 = await apiLogin(USERS.admin);
  const csrf = await api('POST', '/api/auth/logout', { token: good2.token, headers: { origin: 'https://evil.example' } });
  record('A16', 'Cross-origin state-changing request refused (CSRF origin check)', csrf.status === 403 ? 'PASS' : 'FAIL', `status=${csrf.status}`);
  const noOrigin = await fetch(`${API}/api/auth/me`, { headers: { cookie: `iag_session=${good2.token}` } });
  record('A17', 'Same-site GET without Origin still works', noOrigin.status === 200 ? 'PASS' : 'FAIL', `status=${noOrigin.status}`);
  // validation
  const v = await api('POST', '/api/auth/login', { body: { email: 'not-an-email', password: '' } });
  record('A18', 'Login validation: 400 on malformed body', v.status === 400 ? 'PASS' : 'FAIL', `status=${v.status} ${JSON.stringify(v.body).slice(0, 120)}`);
  // tampered cookie
  const t = await api('GET', '/api/auth/me', { token: good2.token.slice(0, -4) + 'zzzz' });
  record('A19', 'Tampered session token → 401', t.status === 401 ? 'PASS' : 'FAIL', `status=${t.status}`);
  await api('POST', '/api/auth/logout', { token: good2.token });
}

await browser.close();
