// Runs in GitHub Actions every hour (workflows/ratings.yml): reads the star ratings visitors sent to the relay
// topic (it keeps messages ~12 hours), keeps one rating per browser (the newest), and writes:
//   ratings-raw.json  every browser's rating, by its random id
//   ratings.json      count, average and how many of each star, for the page
// and puts the rating into the pages' structured data, so search engines can show it.
'use strict';
const fs = require('fs');
const path = require('path');

const TOPIC = `https://ntfy.sh/${process.env.RATINGS_TOPIC || 'modhop-ratings-v1'}/json?poll=1&since=all`; // tests use their own topic
const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'ratings-raw.json');
const OUT = path.join(ROOT, 'ratings.json');
const ID = /^[0-9a-f]{16}$/;

(async () => {
  const raw = fs.existsSync(RAW) ? JSON.parse(fs.readFileSync(RAW, 'utf8')) : { byId: {} };
  const res = await fetch(TOPIC);
  if (!res.ok) throw new Error(`relay: ${res.status}`);
  for (const line of (await res.text()).split('\n')) {
    let ev, m;
    try { ev = JSON.parse(line); m = JSON.parse(ev.message); } catch { continue; }
    if (ev.event !== 'message' || !m || m.kind !== 'rating' || !ID.test(String(m.id)) || ![1, 2, 3, 4, 5].includes(m.stars)) continue;
    const prev = raw.byId[m.id];
    if (!prev || prev[1] <= ev.time) raw.byId[m.id] = [m.stars, ev.time];
  }
  const all = Object.values(raw.byId).map(([s]) => s);
  const count = all.length;
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of all) dist[s]++;
  const average = count ? Math.round(all.reduce((a, b) => a + b, 0) / count * 10) / 10 : 0;
  fs.writeFileSync(RAW, JSON.stringify(raw, null, 1) + '\n');
  fs.writeFileSync(OUT, JSON.stringify({ count, average, dist }) + '\n');

  const agg = count ? `,"aggregateRating":{"@type":"AggregateRating","ratingValue":"${average}","ratingCount":"${count}","bestRating":"5","worstRating":"1"}` : '';
  const pages = [path.join(ROOT, 'index.html'), ...fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(ROOT, e.name, 'index.html'))).map(e => path.join(ROOT, e.name, 'index.html'))];
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    const next = html.replace(/"applicationCategory":"GameApplication"(,"aggregateRating":\{[^}]*\})?/, '"applicationCategory":"GameApplication"' + agg);
    if (next !== html) fs.writeFileSync(p, next);
  }
  console.log(`ratings: ${count}, average ${average}`);
})().catch(e => { console.error(e.message); process.exit(1); });
