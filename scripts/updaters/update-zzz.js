#!/usr/bin/env node
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const COOKIE = process.env.HOYOLAB_COOKIE;
const UID    = process.env.ZZZ_UID;
const REGION = process.env.ZZZ_SERVER;

const SALT          = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';
const SCHEDULE_PATH = path.join(__dirname, '..', '..', 'zzz', 'banner-schedule-zzz.json');
const IMAGES_DIR    = path.join(__dirname, '..', '..', 'zzz', 'images');

function generateDS() {
  const t = Math.floor(Date.now() / 1000);
  const r = Math.floor(Math.random() * 900000) + 100000;
  return t + ',' + r + ',' + crypto.createHash('md5').update('salt=' + SALT + '&t=' + t + '&r=' + r).digest('hex');
}

function unixToUtc8(unix) {
  const d = new Date((parseInt(unix) + 8 * 3600) * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 20000, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://act.hoyolab.com/' } }, res => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Within a version, the pool with the earliest start date is Phase 1, the later one is Phase 2.
// We look at existing character entries for the same version to determine which phase is active.
function determinePhase(version, startDate, existing) {
  const versionChars = existing.filter(e => e.version === version && e.type === 'character');
  if (versionChars.length === 0) return 1;
  const earliest = versionChars.reduce((min, e) => e.start < min ? e.start : min, versionChars[0].start).slice(0, 10);
  return startDate === earliest ? 1 : 2;
}

async function main() {
  if (!COOKIE || !UID || !REGION) throw new Error('Missing HOYOLAB_COOKIE, ZZZ_UID, or ZZZ_SERVER');

  const apiUrl = `https://sg-public-api.hoyolab.com/event/game_record_zzz/api/zzz/gacha_calendar?uid=${UID}&region=${REGION}`;
  console.log('Fetching ZZZ gacha_calendar...');
  const json = await httpsGet(apiUrl, {
    Cookie: COOKIE, DS: generateDS(),
    'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5',
    'x-rpc-language': 'en-us', Referer: 'https://act.hoyolab.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  if (json.retcode !== 0) throw new Error(`API error ${json.retcode}: ${json.message}`);

  console.log('API pools:');
  for (const pool of [...(json.data.avatar_gacha_schedule_list || []), ...(json.data.weapon_gacha_schedule_list || [])]) {
    console.log(`  v${pool.version} start_ts=${pool.start_ts} → ${unixToUtc8(pool.start_ts)}  end_ts=${pool.end_ts} → ${unixToUtc8(pool.end_ts)}`);
  }

  const existing = fs.existsSync(SCHEDULE_PATH) ? JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8')) : [];
  const existingMap = new Map(existing.map(e => [`${e.featuredId}|${(e.start || '').slice(0, 10)}`, e]));

  const fetched = [];
  const iconMap = {};

  for (const pool of (json.data.avatar_gacha_schedule_list || [])) {
    const start   = unixToUtc8(pool.start_ts);
    const end     = unixToUtc8(pool.end_ts);
    const version = pool.version || '';
    const phase   = determinePhase(version, start.slice(0, 10), existing);
    for (const c of (pool.avatar_list || []).filter(c => c.rarity === 'S')) {
      iconMap[c.avatar_id] = c.icon;
      fetched.push({ type: 'character', version, start, end, name: c.avatar_name, featured: [c.avatar_name], featuredId: c.avatar_id, phase });
    }
  }
  for (const pool of (json.data.weapon_gacha_schedule_list || [])) {
    const start   = unixToUtc8(pool.start_ts);
    const end     = unixToUtc8(pool.end_ts);
    const version = pool.version || '';
    const phase   = determinePhase(version, start.slice(0, 10), existing);
    for (const w of (pool.weapon_list || []).filter(w => w.rarity === 'S')) {
      iconMap[w.weapon_id] = w.icon;
      fetched.push({ type: 'weapon', version, start, end, name: w.talent_title, featured: [w.talent_title], featuredId: w.weapon_id, phase });
    }
  }

  let newCount = 0, updatedCount = 0;
  for (const entry of fetched) {
    const key = `${entry.featuredId}|${entry.start.slice(0, 10)}`;
    const existing_entry = existingMap.get(key);
    if (!existing_entry) {
      existing.push(entry);
      existingMap.set(key, entry);
      newCount++;
    } else if (!existing_entry.name && entry.name) {
      existing_entry.name = entry.name;
      existing_entry.featured = entry.featured;
      updatedCount++;
      console.log(`  Updated name: ${entry.featuredId} → "${entry.name}"`);
    }
  }

  const merged = existing.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);

  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(merged, null, 2));
  console.log(`Schedule: ${newCount} new entries added, ${updatedCount} names updated (${merged.length} total).`);
  if (newCount) console.log('New:', fetched.filter(e => !existingMap.has(`${e.featuredId}|${e.start.slice(0,10)}`)).map(e => `${e.name} v${e.version}`).join(', '));

  // Images
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  let saved = 0, skipped = 0;
  for (const { featuredId } of fetched) {
    const dest = path.join(IMAGES_DIR, featuredId + '.png');
    if (fs.existsSync(dest)) { skipped++; continue; }
    const url = iconMap[featuredId];
    if (!url) { console.warn(`  No icon URL for ID ${featuredId}`); continue; }
    try {
      const buf = await downloadImage(url);
      if (buf) { fs.writeFileSync(dest, buf); saved++; console.log(`  Image saved: ${featuredId}.png`); }
    } catch(e) { console.warn(`  Image failed: ${featuredId} — ${e.message}`); }
    await sleep(300);
  }
  console.log(`Images: ${saved} new, ${skipped} already present.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
