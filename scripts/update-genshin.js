#!/usr/bin/env node
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const COOKIE = process.env.HOYOLAB_COOKIE;
const UID    = process.env.GENSHIN_UID;
const SERVER = process.env.GENSHIN_SERVER;

const API_HOST     = 'sg-public-api.hoyolab.com';
const API_PATH     = '/event/game_record/genshin/api/act_calendar';
const DS_SALT      = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';
const SCHEDULE_PATH = path.join(__dirname, '..', 'genshin', 'banner-schedule.json');

const PAIMON_BANNERS_URL = 'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js';
const PAIMON_DUAL_URL    = 'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/bannersDual.js';

function generateDS() {
  var t = Math.floor(Date.now() / 1000);
  var r = Math.floor(Math.random() * 900000) + 100000;
  return t + ',' + r + ',' + crypto.createHash('md5').update('salt=' + DS_SALT + '&t=' + t + '&r=' + r).digest('hex');
}

function unixToUtc8Str(unix) {
  var d = new Date((unix + 8 * 3600) * 1000);
  var p = function(n) { return String(n).padStart(2, '0'); };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth()+1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

function httpsPost(body, headers) {
  return new Promise(function(resolve, reject) {
    var bodyStr = JSON.stringify(body);
    var opts = {
      hostname: API_HOST, path: API_PATH, method: 'POST', timeout: 20000,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }, headers),
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(new Error('JSON parse: ' + Buffer.concat(chunks).toString().slice(0, 100))); } });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('Timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

function httpsGetText(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 20000 }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks).toString('utf-8')); });
    }).on('error', reject);
  });
}

function parseJsExport(text) {
  var stripped = text.replace(/^export\s+const\s+\w+\s*=\s*/, '__result = ').replace(/;\s*$/, '');
  var ctx = { __result: null };
  vm.runInNewContext(stripped, ctx, { timeout: 5000 });
  return ctx.__result;
}

function dedupKey(b) {
  return (b.type || '') + '|' + (b.start || '').slice(0, 10) + '|' + (b.name || '').toLowerCase();
}

// Convert paimon.moe banners/bannersDual to our schedule format (one-time seed)
function paimonToSchedule(banners, bannersDual) {
  var entries = [];
  var dualRanges = new Set();

  // Dual character banners
  for (var version in (bannersDual || {})) {
    var pairs = bannersDual[version];
    for (var i = 0; i < pairs.length; i++) {
      var b = pairs[i];
      if (!b.start || !b.end) continue;
      dualRanges.add(b.start + '|' + b.end);
      entries.push({ type: 'character', version: version, start: b.start, end: b.end,
        name: b.shortName || b.name, featured: b.featured || [b.shortName || b.name], featuredIds: [] });
    }
  }

  // Single character banners
  for (var i = 0; i < (banners.characters || []).length; i++) {
    var b = banners.characters[i];
    if (!b.start || !b.end) continue;
    if (dualRanges.has(b.start + '|' + b.end)) continue;
    entries.push({ type: 'character', version: null, start: b.start, end: b.end,
      name: b.shortName || b.name, featured: b.featured || [b.shortName || b.name], featuredIds: [] });
  }

  // Weapon banners
  for (var i = 0; i < (banners.weapons || []).length; i++) {
    var b = banners.weapons[i];
    if (!b.start || !b.end) continue;
    entries.push({ type: 'weapon', version: null, start: b.start, end: b.end,
      name: b.shortName || b.name, featured: b.featured || [b.shortName || b.name], featuredIds: [] });
  }

  // Chronicled wish
  for (var i = 0; i < (banners.chronicled || []).length; i++) {
    var b = banners.chronicled[i];
    if (!b.start || !b.end) continue;
    entries.push({ type: 'chronicled', version: null, start: b.start, end: b.end,
      name: b.shortName || b.name, featured: b.featured || [b.shortName || b.name], featuredIds: [] });
  }

  return entries;
}

// Convert HoYoLAB API response to our schedule entries
function apiToSchedule(data) {
  var entries = [];

  function ts(unix) { return unixToUtc8Str(parseInt(unix)); }

  // Character event banners (pool_type 1)
  for (var i = 0; i < (data.avatar_card_pool_list || []).length; i++) {
    var pool = data.avatar_card_pool_list[i];
    var fiveStars = (pool.avatars || []).filter(function(a) { return a.rarity === 5; });
    if (!fiveStars.length) continue;
    var primary = fiveStars[0];
    entries.push({
      _apiId: pool.pool_id,
      type: 'character',
      version: pool.version_name || null,
      start: ts(pool.start_timestamp),
      end:   ts(pool.end_timestamp),
      name: primary.name,
      featured: fiveStars.map(function(a) { return a.name; }),
      featuredIds: fiveStars.map(function(a) { return a.id; }),
    });
  }

  // Weapon event banners (pool_type 2)
  for (var i = 0; i < (data.weapon_card_pool_list || []).length; i++) {
    var pool = data.weapon_card_pool_list[i];
    var fiveStars = (pool.weapon || []).filter(function(w) { return w.rarity === 5; });
    if (!fiveStars.length) continue;
    entries.push({
      _apiId: pool.pool_id,
      type: 'weapon',
      version: pool.version_name || null,
      start: ts(pool.start_timestamp),
      end:   ts(pool.end_timestamp),
      name: fiveStars[0].name,
      featured: fiveStars.map(function(w) { return w.name; }),
      featuredIds: fiveStars.map(function(w) { return w.id; }),
    });
  }

  // Chronicled wish (pool_type 6, mixed_card_pool_list)
  for (var i = 0; i < (data.mixed_card_pool_list || []).length; i++) {
    var pool = data.mixed_card_pool_list[i];
    var fiveStarChars    = (pool.avatars || []).filter(function(a) { return a.rarity === 5; });
    var fiveStarWeapons  = (pool.weapon  || []).filter(function(w) { return w.rarity === 5; });
    var allFiveStars     = fiveStarChars.concat(fiveStarWeapons);
    if (!allFiveStars.length) continue;
    entries.push({
      _apiId: pool.pool_id,
      type: 'chronicled',
      version: pool.version_name || null,
      start: ts(pool.start_timestamp),
      end:   ts(pool.end_timestamp),
      name: allFiveStars[0].name,
      featured: allFiveStars.map(function(x) { return x.name; }),
      featuredIds: allFiveStars.map(function(x) { return x.id || 0; }),
    });
  }

  return entries;
}

async function main() {
  if (!COOKIE || !UID || !SERVER) throw new Error('Missing HOYOLAB_COOKIE, GENSHIN_UID, or GENSHIN_SERVER');

  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });

  // Load existing schedule
  var existing = [];
  if (fs.existsSync(SCHEDULE_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf-8')); } catch(_) {}
  }

  // One-time seed from paimon.moe if schedule is empty
  if (existing.length === 0) {
    console.log('No existing schedule — seeding from paimon.moe (one time only)...');
    try {
      var bt = await httpsGetText(PAIMON_BANNERS_URL);
      var dt = await httpsGetText(PAIMON_DUAL_URL);
      var banners     = parseJsExport(bt);
      var bannersDual = parseJsExport(dt);
      if (banners && typeof banners === 'object') {
        existing = paimonToSchedule(banners, bannersDual);
        console.log('Seeded ' + existing.length + ' historical entries from paimon.moe.');
      }
    } catch(err) {
      console.warn('paimon.moe seed failed: ' + err.message + ' — continuing with empty schedule.');
    }
  }

  // Fetch current banners from HoYoLAB API
  console.log('Fetching Genshin calendar (UID ' + UID + ', server ' + SERVER + ')...');
  var json = await httpsPost({ server: SERVER, role_id: UID }, {
    'Cookie': COOKIE, 'DS': generateDS(),
    'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
    'Referer': 'https://act.hoyolab.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });

  if (json.retcode !== 0) throw new Error('HoYoLAB API error ' + json.retcode + ': ' + json.message);
  console.log('Game version: ' + (json.data.cur_game_version || 'unknown'));

  var apiEntries = apiToSchedule(json.data);

  // Merge: skip entries whose dedup key already exists, or update featuredIds if missing
  var seen = new Map();
  for (var i = 0; i < existing.length; i++) {
    seen.set(dedupKey(existing[i]), i);
  }

  var newEntries = [];
  for (var i = 0; i < apiEntries.length; i++) {
    var entry = apiEntries[i];
    var key = dedupKey(entry);
    if (seen.has(key)) {
      // Update featuredIds if the existing entry lacks them
      var idx = seen.get(key);
      if ((!existing[idx].featuredIds || !existing[idx].featuredIds.length) && entry.featuredIds.length) {
        existing[idx].featuredIds = entry.featuredIds;
      }
      if (!existing[idx].version && entry.version) existing[idx].version = entry.version;
    } else {
      newEntries.push(entry);
      seen.set(key, existing.length + newEntries.length - 1);
    }
  }

  var merged = existing.concat(newEntries);
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(merged, null, 2));
  console.log('Done. ' + newEntries.length + ' new entries added (' + merged.length + ' total).');
  if (newEntries.length > 0) console.log('New: ' + newEntries.map(function(b) { return b.name + ' (' + b.type + ')'; }).join(', '));
}

main().catch(function(e) { console.error(e.message); process.exit(1); });