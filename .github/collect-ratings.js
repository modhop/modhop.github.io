// Runs in GitHub Actions every hour (workflows/ratings.yml): reads the star ratings visitors sent to the relay
// topic (it keeps messages ~12 hours), keeps one rating per browser (the newest), and writes:
//   ratings-raw.json  every browser's rating, by its random id
//   ratings.json      count, average and how many of each star, for the page
// and puts the rating into the pages' structured data, so search engines can show it. It also counts the
// different players who have used ModHop (users.json; see the end).
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

  // How many different players have used ModHop: every running ModHop announces its player's Minecraft name on
  // the directory topic every few hours (for friend-name suggestions). Only a hash of each name is kept.
  const USERS_RAW = path.join(ROOT, 'users-raw.json'), USERS = path.join(ROOT, 'users.json');
  const users = fs.existsSync(USERS_RAW) ? JSON.parse(fs.readFileSync(USERS_RAW, 'utf8')) : { since: new Date().toISOString().slice(0, 10), seen: {} };
  const dir = await fetch(`https://ntfy.sh/${process.env.DIRECTORY_TOPIC || 'dmm-directory-v1'}/json?poll=1&since=all`);
  if (dir.ok) {
    for (const line of (await dir.text()).split('\n')) {
      let ev, m;
      try { ev = JSON.parse(line); m = JSON.parse(ev.message); } catch { continue; }
      if (ev.event !== 'message' || !m || m.kind !== 'dmm-here' || !/^[A-Za-z0-9_]{2,16}$/.test(String(m.name))) continue;
      const h = require('crypto').createHash('sha256').update('modhop:' + m.name.toLowerCase()).digest('hex').slice(0, 20);
      if (!users.seen[h]) users.seen[h] = new Date(ev.time * 1000).toISOString().slice(0, 10);
    }
    fs.writeFileSync(USERS_RAW, JSON.stringify(users, null, 1) + '\n');
    fs.writeFileSync(USERS, JSON.stringify({ players: Object.keys(users.seen).length, since: users.since }) + '\n');
    console.log(`players: ${Object.keys(users.seen).length} since ${users.since}`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
