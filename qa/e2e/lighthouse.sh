#!/usr/bin/env bash
# Lighthouse (12.x via npx) against the production build on :3000 using Edge, mobile + desktop presets.
set -u
OUT="$(dirname "$0")/lighthouse"
mkdir -p "$OUT"
EDGE="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
export CHROME_PATH="$EDGE"
run() { # name url preset
  local name="$1" url="$2" preset="$3"
  local flags="--quiet --output=json --output-path=$OUT/$name-$preset.json --chrome-flags=--headless=new --only-categories=performance,accessibility,best-practices,seo"
  [ "$preset" = "desktop" ] && flags="$flags --preset=desktop"
  MSYS_NO_PATHCONV=1 npx -y lighthouse@12 "$url" $flags > "$OUT/$name-$preset.log" 2>&1
  node -e '
    const r = require(process.argv[1]); const c = r.categories; const a = r.audits;
    const ms = (k) => Math.round(a[k]?.numericValue ?? -1);
    console.log(JSON.stringify({ page: process.argv[2], preset: process.argv[3], performance: Math.round(c.performance.score*100), accessibility: Math.round(c.accessibility.score*100), bestPractices: Math.round(c["best-practices"].score*100), seo: Math.round(c.seo.score*100), FCP: ms("first-contentful-paint"), LCP: ms("largest-contentful-paint"), TBT: ms("total-blocking-time"), CLS: a["cumulative-layout-shift"]?.numericValue?.toFixed(3), SI: ms("speed-index"), TTFB: ms("server-response-time"), totalBytesKB: Math.round((a["total-byte-weight"]?.numericValue||0)/1024), a11yFails: Object.values(a).filter(x => x.scoreDisplayMode === "binary" && x.score === 0 && r.categories.accessibility.auditRefs.some(ref => ref.id === x.id)).map(x => x.id).slice(0,8) }));
  ' "$OUT/$name-$preset.json" "$name" "$preset" >> "$OUT/summary.jsonl" 2>>"$OUT/errors.log"
}
run home "http://localhost:3000/" mobile
run home "http://localhost:3000/" desktop
run hotels "http://localhost:3000/hotels" mobile
run hotel-detail "http://localhost:3000/hotels/vera-house-tbilisi?checkIn=2026-11-20&checkOut=2026-11-22&adults=2" mobile
run tours "http://localhost:3000/tours" mobile
run transfers-search "http://localhost:3000/transfers/search?from=tbilisi-airport&to=gudauri&date=2026-11-20&time=10:00&adults=2&children=0&luggage=2&cabinBags=0" mobile
run admin-signin "http://localhost:3000/admin/sign-in" mobile
cat "$OUT/summary.jsonl"
