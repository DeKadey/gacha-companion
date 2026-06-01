#!/usr/bin/env node
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const COOKIE = process.env.HOYOLAB_COOKIE;
const UID    = process.env.ZZZ_UID;
const SERVER = process.env.ZZZ_SERVER;

const API_HOST      = 'sg-public-api.hoyolab.com';
const API_PATH      = '/event/game_record_zzz/api/zzz/gacha_calendar';
const DS_SALT       = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';
const SCHEDULE_PATH = path.join(__dirname, '..', 'zzz', 'banner-schedule.json');
const IMAGES_DIR    = path.join(__dirname, '..', 'zzz', 'images');

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

function slugKey(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function httpsGetJson(url, headers) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: headers, timeout: 20000 }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function httpsGetBuffer(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 20000, headers: { 'User-Agent': 'gacha-companion-update' } }, function(res) {
      if (res.statusCode === 404) { res.resume(); resolve(null); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

async function main() {
  if (!COOKIE || !UID || !SERVER) throw new Error('Missing HOYOLAB_COOKIE, ZZZ_UID, or ZZZ_SERVER');

  var existing = fs.existsSync(SCHEDULE_PATH) ? JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf-8')) : [];
  if (!existing.length) throw new Error('zzz/banner-schedule.json is empty — seed file must exist first.');

  console.log('Fetching ZZZ calendar (UID ' + UID + ', server ' + SERVER + ')...');
  var json = await httpsGetJson(
    'https://' + API_HOST + API_PATH + '?uid=' + UID + '&region=' + SERVER,
    {
      'Cookie': COOKIE, 'DS': generateDS(),
      'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
      'Referer': 'https://act.hoyolab.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  );
  if (json.retcode !== 0) throw new Error('HoYoLAB API error ' + json.retcode + ': ' + json.message);

  var fetched = [];
  var iconMap = {};

  for (var pool of (json.data.avatar_gacha_schedule_list || [])) {
    var start = unixToUtc8Str(parseInt(pool.start_ts));
    var end   = unixToUtc8Str(parseInt(pool.end_ts));
    for (var c of (pool.avatar_list || []).filter(function(c) { return c.rarity === 'S'; })) {
      iconMap[c.avatar_id] = c.icon;
      fetched.push({ type: 'character', version: pool.version || null, start: start, end: end, name: c.avatar_name, featuredId: c.avatar_id });
    }
  }

  for (var pool of (json.data.weapon_gacha_schedule_list || [])) {
    var start = unixToUtc8Str(parseInt(pool.start_ts));
    var end   = unixToUtc8Str(parseInt(pool.end_ts));
    for (var w of (pool.weapon_list || []).filter(function(w) { return w.rarity === 'S'; })) {
      iconMap[w.weapon_id] = w.icon;
      fetched.push({ type: 'wengine', version: pool.version || null, start: start, end: end, name: w.talent_title, featuredId: w.weapon_id });
    }
  }

  // Build dedup index from existing entries: slugKey(name)|date -> array index
  var seen = new Map();
  for (var i = 0; i < existing.length; i++) {
    var e = existing[i];
    var key = slugKey(e.name) + '|' + (e.start || '').slice(0, 10);
    seen.set(key, i);
  }

  // Names already present (for determining is_forward on genuinely new entries)
  var priorNames = new Set(existing.map(function(e) { return slugKey(e.name); }));

  var newEntries = [];
  for (var entry of fetched) {
    var key = slugKey(entry.name) + '|' + entry.start.slice(0, 10);
    if (seen.has(key)) {
      var idx = seen.get(key);
      existing[idx].featuredId = entry.featuredId;
      existing[idx].name       = entry.name;
      existing[idx].version    = entry.version;
      existing[idx].start      = entry.start;
      existing[idx].end        = entry.end;
    } else {
      entry._apiId     = null;
      entry.is_forward = !priorNames.has(slugKey(entry.name));
      newEntries.push(entry);
    }
  }

  var merged = existing.concat(newEntries);
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(merged, null, 2));
  console.log('Done. ' + newEntries.length + ' new entries added (' + merged.length + ' total).');
  if (newEntries.length > 0) console.log('New: ' + newEntries.map(function(b) { return b.name + ' (' + b.type + ')'; }).join(', '));

  // Image downloads — only for entries where we have a CDN URL from this run
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  var downloaded = 0, skipped = 0;
  var seen_ids = new Set();
  for (var entry of merged) {
    if (!entry.featuredId || !iconMap[entry.featuredId]) continue;
    if (seen_ids.has(entry.featuredId)) continue;
    seen_ids.add(entry.featuredId);
    var imgPath = path.join(IMAGES_DIR, entry.featuredId + '.png');
    if (fs.existsSync(imgPath)) { skipped++; continue; }
    try {
      var buf = await httpsGetBuffer(iconMap[entry.featuredId]);
      if (buf) {
        fs.writeFileSync(imgPath, buf);
        downloaded++;
        console.log('  Image saved: ' + entry.featuredId + ' ' + entry.name);
      } else {
        console.warn('  No image: ' + entry.featuredId + ' ' + entry.name);
      }
    } catch(err) {
      console.warn('  Image failed: ' + entry.featuredId + ' -- ' + err.message);
    }
    await sleep(150);
  }
  console.log('Images: ' + downloaded + ' new, ' + skipped + ' already present.');
}

main().catch(function(e) { console.error(e.message); process.exit(1); });
