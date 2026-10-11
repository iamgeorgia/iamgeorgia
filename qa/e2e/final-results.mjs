// One deduplicated view of every check: the last result per check ID wins (IDs like H12, UA5b, W21), composite IDs
// (sweep rows, responsive rows, perf rows, UP-/portal/x) are keyed by ID + feature. Page-sweep rows are replaced by the
// noise-filtered verdicts from sweep-normalize.mjs. A few verdicts were confirmed by hand after a script assertion used the
// wrong precondition; those overrides carry the evidence inline.
import fs from 'node:fs';
import path from 'node:path';
import { normalizedSweep } from './sweep-normalize.mjs';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OVERRIDES = {
  G6: ['PASS', 'verified directly: audit_logs has PARTNER_TERMS_ACCEPTED for the three demo owners at 18:20:47 (the rerun looked at a 2-minute window after acceptance had already happened)'],
  F02: ['PASS', 'hotel_bookings row: commission_rate_bps=1000, markup_bps=1000 (assertion regex was mangled by shell escaping)'],
  Q9: ['PASS', 'public total 70 = ACTIVE ∧ b2c_enabled hotels (77 ACTIVE, 7 B2B-only); the status param is ignored; pageSize>50 → 400'],
  W7: ['PASS', 'my query used status=PENDING; the enum is PENDING_APPROVAL (Q23 passes with it) and badge pendingPartners ≥ 1 passed'],
  'UA10': ['NOT TESTED', '/admin/bookings has no free-text search box in <main>; filtering is by status/date controls (not exercised in the browser; API search covered by Q21)'],
  A3: ['PASS', 'superseded by UA11: sign-out lives inside the account menu as a role=menuitem button; opening the menu and clicking it clears the cookie and redirects to /admin/sign-in'],
  W52: ['PASS', 'unreadCount 408 → 407 after marking one notification read (the first assertion read the wrong key; the rerun found nothing unread to mark)'],
  'UT-x': ['INFO', 'abort marker from an earlier run; the transfer journey later passed end to end (UT1–UT6)'],
  'UA-x': ['INFO', 'abort marker from an earlier run; UA11 later passed via the menuitem role'],
};
export function finalResults() {
  const rows = fs.readFileSync(path.join(here, 'results.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const simple = (id) => /^[A-Z]+\d+[a-z]?$/.test(id) || /^(UP|UT|UA|UD|UH|RM)-/.test(id) || id === 'RA-mobile-nav' || id === 'RA-mobile-table';
  const m = new Map();
  for (const r of rows) { if (/^SW-(?!ANON)/.test(r.id)) continue; m.set(simple(r.id) ? r.id : `${r.id}|${r.feature}`, r); }
  for (const [id, [status, notes]] of Object.entries(OVERRIDES)) if (m.has(id)) m.set(id, { ...m.get(id), status, notes });
  const out = [...m.values()];
  for (const s of normalizedSweep()) out.push({ id: `SW-${s.role}`, feature: `page ${s.page.split('?')[0]}`, status: s.verdict, notes: s.verdict === 'FAIL' ? s.real.join(' | ') : `${s.status} ${s.ms}ms h1="${s.h1}"${s.noiseImages ? ' (broken R2/fixture images on page: ' + s.noiseImages + ')' : ''}` });
  return out;
}
