#!/usr/bin/env node
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const COOKIE = process.env.HOYOLAB_COOKIE;
const UID    = process.env.GENSHIN_UID;
const SERVER = process.env.GENSHIN_SERVER;

const API_HOST      = 'sg-public-api.hoyolab.com';
const API_PATH      = '/event/game_record/genshin/api/act_calendar';
const DS_SALT       = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';
const SCHEDULE_PATH = path.join(__dirname, '..', 'genshin', 'banner-schedule.json');

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

function dedupKey(b) {
  return (b.type || '') + '|' + (b.start || '').slice(0, 10) + '|' + (b.name || '').toLowerCase();
}

function apiToSchedule(data) {
  var entries = [];
  function ts(unix) { return unixToUtc8Str(parseInt(unix)); }

  for (var i = 0; i < (data.avatar_card_pool_list || []).length; i++) {
    var pool = data.avatar_card_pool_list[i];
    var fiveStars = (pool.avatars || []).filter(function(a) { return a.rarity === 5; });
    if (!fiveStars.length) continue;
    entries.push({
      _apiId: pool.pool_id, type: 'character', version: pool.version_name || null,
      start: ts(pool.start_timestamp), end: ts(pool.end_timestamp),
      name: fiveStars[0].name,
      featured: fiveStars.map(function(a) { return a.name; }),
      featuredIds: fiveStars.map(function(a) { return a.id; }),
    });
  }

  for (var i = 0; i < (data.weapon_card_pool_list || []).length; i++) {
    var pool = data.weapon_card_pool_list[i];
    var fiveStars = (pool.weapon || []).filter(function(w) { return w.rarity === 5; });
    if (!fiveStars.length) continue;
    entries.push({
      _apiId: pool.pool_id, type: 'weapon', version: pool.version_name || null,
      start: ts(pool.start_timestamp), end: ts(pool.end_timestamp),
      name: fiveStars[0].name,
      featured: fiveStars.map(function(w) { return w.name; }),
      featuredIds: fiveStars.map(function(w) { return w.id; }),
    });
  }

  for (var i = 0; i < (data.mixed_card_pool_list || []).length; i++) {
    var pool = data.mixed_card_pool_list[i];
    var all5 = (pool.avatars || []).filter(function(a) { return a.rarity === 5; })
                .concat((pool.weapon || []).filter(function(w) { return w.rarity === 5; }));
    if (!all5.length) continue;
    entries.push({
      _apiId: pool.pool_id, type: 'chronicled', version: pool.version_name || null,
      start: ts(pool.start_timestamp), end: ts(pool.end_timestamp),
      name: all5[0].name,
      featured: all5.map(function(x) { return x.name; }),
      featuredIds: all5.map(function(x) { return x.id || 0; }),
    });
  }

  return entries;
}

async function main() {
  if (!COOKIE || !UID || !SERVER) throw new Error('Missing HOYOLAB_COOKIE, GENSHIN_UID, or GENSHIN_SERVER');

  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  var existing = [];
  if (fs.existsSync(SCHEDULE_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf-8')); } catch(_) {}
  }
  if (!existing.length) throw new Error('banner-schedule.json is empty — run the paimon.moe seed first (should have happened on initial deploy).');

  console.log('Fetching Genshin calendar (UID ' + UID + ', server ' + SERVER + ')...');
  var json = await httpsPost({ server: SERVER, role_id: UID }, {
    'Cookie': COOKIE, 'DS': generateDS(),
    'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
    'Referer': 'https://act.hoyolab.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  if (json.retcode !== 0) throw new Error('HoYoLAB API error ' + json.retcode + ': ' + json.message);

  var apiEntries = apiToSchedule(json.data);
  var seen = new Map();
  for (var i = 0; i < existing.length; i++) seen.set(dedupKey(existing[i]), i);

  var newEntries = [];
  for (var i = 0; i < apiEntries.length; i++) {
    var entry = apiEntries[i];
    var key = dedupKey(entry);
    if (seen.has(key)) {
      var idx = seen.get(key);
      if ((!existing[idx].featuredIds || !existing[idx].featuredIds.length) && entry.featuredIds.length)
        existing[idx].featuredIds = entry.featuredIds;
      if (!existing[idx].version && entry.version) existing[idx].version = entry.version;
    } else {
      newEntries.push(entry);
    }
  }

  var merged = existing.concat(newEntries);
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(merged, null, 2));
  console.log('Done. ' + newEntries.length + ' new entries added (' + merged.length + ' total).');
  if (newEntries.length > 0) console.log('New: ' + newEntries.map(function(b) { return b.name + ' (' + b.type + ')'; }).join(', '));
}

main().catch(function(e) { console.error(e.message); process.exit(1); });