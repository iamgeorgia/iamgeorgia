// Shared harness for the QA browser/API runs. Playwright 1.62 via Edge.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export const CLIENT = 'http://localhost:3000';
export const API = 'http://localhost:5000';
export const PASSWORD = 'Demo-Georgia-2026';
export const USERS = {
  superadmin: 'superadmin@demo-b2b.iamgeorgia.test',
  admin: 'admin@demo-b2b.iamgeorgia.test',
  management: 'management@demo-b2b.iamgeorgia.test',
  tourop: 'reservations@demo-b2b.iamgeorgia.test',
  accountant: 'finance@demo-b2b.iamgeorgia.test',
  finop: 'finance-operator@demo-b2b.iamgeorgia.test',
  dispatcher: 'dispatcher@demo-b2b.iamgeorgia.test',
  agencyOwner: 'agency.owner@demo-b2b.iamgeorgia.test',
  agencyAdmin: 'agency.admin@demo-b2b.iamgeorgia.test',
  agencyAgent: 'agency.agent@demo-b2b.iamgeorgia.test',
  agencyFinance: 'agency.finance@demo-b2b.iamgeorgia.test',
  suspendedOwner: 'suspended.owner@demo-b2b.iamgeorgia.test',
  hotelOwner: 'hotel.owner@demo-b2b.iamgeorgia.test',
  transferOwner: 'transfer.owner@demo-b2b.iamgeorgia.test',
};

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const SHOTS = path.join(ROOT, 'shots');
export const RESULTS = path.join(ROOT, 'results.jsonl');
fs.mkdirSync(SHOTS, { recursive: true });

export function record(id, feature, status, notes = '', extra = {}) {
  const row = { id, feature, status, notes, at: new Date().toISOString(), ...extra };
  fs.appendFileSync(RESULTS, JSON.stringify(row) + '\n');
  const tag = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : status;
  console.log(`[${tag}] ${id} ${feature}${notes ? ' — ' + notes : ''}`);
}

export async function launch(opts = {}) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, ...opts });
  return browser;
}

export function attachCollectors(page) {
  const errors = { console: [], pageerrors: [], failed: [], http: [] };
  page.__errors = errors;
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.console.push({ type: m.type(), text: m.text().slice(0, 400), src: m.location()?.url || '', url: page.url() });
  });
  page.on('pageerror', (e) => errors.pageerrors.push({ text: String(e.message || e).slice(0, 400), url: page.url() }));
  page.on('requestfailed', (r) => errors.failed.push({ url: r.url(), err: r.failure()?.errorText, page: page.url() }));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.http.push({ status: r.status(), url: r.url(), method: r.request().method(), page: page.url() });
  });
  return errors;
}

export async function newPage(browser, { viewport = { width: 1366, height: 768 }, locale = 'en-US', storageState } = {}) {
  const context = await browser.newContext({ viewport, locale, storageState });
  const page = await context.newPage();
  attachCollectors(page);
  return { context, page };
}

export async function shot(page, name) {
  const file = path.join(SHOTS, `${name.replace(/[^a-z0-9_-]+/gi, '_')}.png`);
  try { await page.screenshot({ path: file, fullPage: false }); } catch {}
  return file;
}

/** Sign in against the API and plant the session cookie into the context. */
export async function loginViaApi(context, email, password = PASSWORD) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: CLIENT },
    body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = /iag_session=([^;]+)/.exec(setCookie);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !m) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  await context.addCookies([{ name: 'iag_session', value: m[1], domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  return { token: m[1], user: body.user || body };
}

/** Plain API client (no browser). Returns {status, body, headers}. */
export async function api(method, p, { body, token, headers = {}, raw = false } = {}) {
  const h = { origin: CLIENT, ...headers };
  if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json';
  if (token) h.cookie = `iag_session=${token}`;
  const res = await fetch(`${API}${p}`, { method, headers: h, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = raw ? text : { _raw: text.slice(0, 300) }; }
  return { status: res.status, body: json, headers: Object.fromEntries(res.headers.entries()) };
}

export async function apiLogin(email, password = PASSWORD) {
  const res = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: CLIENT }, body: JSON.stringify({ email, password }) });
  const m = /iag_session=([^;]+)/.exec(res.headers.get('set-cookie') || '');
  const body = await res.json().catch(() => ({}));
  return { status: res.status, token: m?.[1], body };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function summarizeErrors(page, { ignore = [] } = {}) {
  const e = page.__errors;
  const filt = (arr, key) => arr.filter((x) => !ignore.some((re) => re.test(x[key] || x.text || x.url || '')));
  return {
    pageerrors: filt(e.pageerrors, 'text'),
    console: filt(e.console.filter((c) => c.type === 'error'), 'text'),
    http: filt(e.http, 'url'),
    failed: filt(e.failed, 'url'),
  };
}

export function resetErrors(page) {
  for (const k of Object.keys(page.__errors)) page.__errors[k].length = 0;
}

import { execFileSync } from 'node:child_process';
export function sql(q) { return execFileSync('docker', ['exec', 'iamgeorgia-postgres', 'psql', '-U', 'postgres', '-d', 'iamgeorgia', '-At', '-F', '|', '-c', q], { encoding: 'utf8' }).trim(); }
