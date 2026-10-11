// Aggregates the deduplicated check results into Markdown fragments for QA_REPORT.md.
import fs from 'node:fs';
import { finalResults } from './final-results.mjs';
const here = new URL('./', import.meta.url);
const final = finalResults();
const groups = {
  'Auth & sessions (A*)': /^A\d/, 'Page sweep, all roles (SW-*)': /^SW-/, 'Hotel booking API + DB (H*)': /^H\d/, 'Transfer API + dispatch + driver (T*)': /^T\d/, 'Terms gate (G*)': /^G\d/,
  'Tours (U*)': /^U\d/, 'Packages / orders (P*)': /^P\d/, 'Finance: payments, approvals, credit (F*)': /^F\d/, 'RBAC / IDOR (R*)': /^R\d/, 'Input hardening & headers (S*)': /^S\d/,
  'Partner lifecycle, rates, publish, notifications (W*)': /^W\d/, 'Pagination, filters, catalogue rules (Q*)': /^Q\d/, 'UI: hotel journey (UH*)': /^UH/, 'UI: transfer journey (UT*)': /^UT/,
  'UI: admin CRUD, invite, activation, sign-out (UA*)': /^UA/, 'UI: partner portal (UP*)': /^UP/, 'UI: driver panel (UD*)': /^UD/, 'Responsive (RV/RM/RS/RT/RA/RP)': /^R[VMSTAP]-/, 'Performance (PF/PA)': /^P[FA]/,
};
const count = (list) => { const c = { PASS: 0, FAIL: 0, INFO: 0, 'NOT TESTED': 0, BLOCKED: 0 }; for (const r of list) c[r.status] = (c[r.status] || 0) + 1; return c; };
let md = '| Group | Checks | Pass | Fail | Info | Not tested | Blocked |\n|---|---|---|---|---|---|---|\n';
const total = count(final);
for (const [name, re] of Object.entries(groups)) { const list = final.filter((r) => re.test(r.id)); if (!list.length) continue; const c = count(list); md += `| ${name} | ${list.length} | ${c.PASS} | ${c.FAIL} | ${c.INFO} | ${c['NOT TESTED']} | ${c.BLOCKED} |\n`; }
md += `| **Total** | **${final.length}** | **${total.PASS}** | **${total.FAIL}** | **${total.INFO}** | **${total['NOT TESTED']}** | **${total.BLOCKED}** |\n`;
fs.writeFileSync(new URL('summary.md', here), md);
const esc = (s) => String(s).replace(/\|/g, '/').replace(/\r?\n/g, ' ').replace(/\x1b\[[0-9;]*m/g, '');
let fails = '| ID | Check | Evidence |\n|---|---|---|\n';
for (const r of final.filter((r) => r.status === 'FAIL')) fails += `| ${r.id} | ${esc(r.feature)} | ${esc(r.notes).slice(0, 220)} |\n`;
fs.writeFileSync(new URL('fails.md', here), fails);
let nt = '| ID | Check | Reason |\n|---|---|---|\n';
for (const r of final.filter((r) => r.status === 'NOT TESTED' || r.status === 'BLOCKED')) nt += `| ${r.id} | ${esc(r.feature)} | ${esc(r.notes).slice(0, 160)} |\n`;
fs.writeFileSync(new URL('not-tested.md', here), nt);
let all = '| ID | Status | Check | Evidence |\n|---|---|---|---|\n';
for (const r of [...final].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))) all += `| ${r.id} | ${r.status} | ${esc(r.feature)} | ${esc(r.notes).slice(0, 200)} |\n`;
fs.writeFileSync(new URL('all-checks.md', here), all);
console.log(md); console.log('FAILS:\n' + fails); console.log('NOT TESTED:\n' + nt);
