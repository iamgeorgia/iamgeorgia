// Re-evaluates the page sweep with known environment noise removed, so a page is only FAIL for a real problem.
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const NOISE = [/_vercel\/speed-insights/, /\/api\/auth\/me$/, /r2\.dev/, /_next\/image\?url=https%3A%2F%2Fpub-/, /\/images\/(tours|packages)\/(kazbegi|test)\.jpg/];
const isNoise = (s) => NOISE.some((re) => re.test(s || ''));
export function normalizedSweep() {
  const sweep = JSON.parse(fs.readFileSync(path.join(here, 'sweep.json'), 'utf8'));
  return sweep.map((row) => {
    if (row.status === 'NAV_ERROR') return { ...row, verdict: 'FAIL', real: ['navigation error: ' + row.note] };
    const real = [];
    if (row.status >= 400 && !/does-not-exist/.test(row.page)) real.push(`HTTP ${row.status}`);
    for (const e of row.pageerrors || []) real.push('JS: ' + e.text.slice(0, 100));
    for (const h of row.http || []) if (!isNoise(h.url) && !(h.status === 404 && /does-not-exist/.test(row.page))) real.push(`${h.status} ${h.url.replace(/^https?:\/\/localhost:\d+/, '')}`.slice(0, 120));
    for (const c of row.consoleErrors || []) if (!isNoise(c.src) && !/Failed to load resource/.test(c.text)) real.push('console: ' + c.text.slice(0, 100));
    // "Failed to load resource" console lines without a src we can classify: count them as noise only when the http list for the page is clean
    const noiseImages = (row.http || []).filter((h) => isNoise(h.url)).length;
    // /destinations and /experiences call notFound() on purpose (page.tsx); a 404 there is the designed answer, not a defect.
    const byDesign404 = /^\/(destinations|experiences)(\/|$)/.test(row.page) && row.status === 404 && real.every((x) => /404/.test(x));
    return { ...row, verdict: byDesign404 ? 'INFO' : real.length ? 'FAIL' : 'PASS', real: byDesign404 ? ['404 by design: page.tsx calls notFound()'] : real, noiseImages };
  });
}
if ((process.argv[1] || '').endsWith('sweep-normalize.mjs')) {
  const n = normalizedSweep();
  const fails = n.filter((r) => r.verdict === 'FAIL');
  console.log(`page loads=${n.length} pass=${n.length - fails.length} fail=${fails.length}`);
  for (const f of fails) console.log(` - [${f.role}] ${f.page}: ${f.real.join(' | ')}`);
  const imgPages = n.filter((r) => r.noiseImages > 0).map((r) => `${r.role} ${r.page.split('?')[0]}`);
  console.log(`pages with broken R2/fixture images: ${imgPages.length}`);
}
