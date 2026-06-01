#!/usr/bin/env node
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const COOKIE = process.env.HOYOLAB_COOKIE;
const UID    = process.env.HSR_UID;
const SERVER = process.env.HSR_SERVER;
const API_URL       = 'https://sg-public-api.hoyolab.com/event/game_record/hkrpg/api/get_act_calender';
const DS_SALT       = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';
const SCHEDULE_PATH = path.join(__dirname, '..', 'hsr', 'banner-schedule.json');
const NAME_MAP_PATH = path.join(__dirname, '..', 'hsr', 'name-id-map.json');
const IMAGES_DIR    = path.join(__dirname, '..', 'hsr', 'images');
function generateDS() {
  const t = Math.floor(Date.now() / 1000);
  const r = Math.floor(Math.random() * 900000) + 100000;
  const hash = crypto.createHash('md5').update('salt=' + DS_SALT + '&t=' + t + '&r=' + r).digest('hex');
  return t + ',' + r + ',' + hash;
}
function unixToUtc8Str(unix) {
  const d = new Date((unix + 8 * 3600) * 1000);
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth()+1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}
function slugKey(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function httpsGetJson(url, headers) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: headers }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}
function httpsGetBuffer(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 20000 }, function(res) {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(Buffer.concat(chunks)); });
    }).on('error', reject);
  });
}
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
async function main() {
  if (!COOKIE || !UID || !SERVER) throw new Error('Missing HOYOLAB_COOKIE, HSR_UID, or HSR_SERVER');
  console.log('Fetching HSR calendar (UID ' + UID + ', server ' + SERVER + ')...');
  var json = await httpsGetJson(API_URL + '?server=' + SERVER + '&role_id=' + UID, {
    'Cookie': COOKIE, 'DS': generateDS(), 'x-rpc-app_version': '1.5.0',
    'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
    'Referer': 'https://act.hoyolab.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  if (json.retcode !== 0) throw new Error('HoYoLAB API error ' + json.retcode + ': ' + json.message);
  var avatar_card_pool_list = json.data.avatar_card_pool_list;
  var equip_card_pool_list  = json.data.equip_card_pool_list;
  var cur_game_version      = json.data.cur_game_version;
  console.log('Game version: ' + cur_game_version);
  var nameIdMap = {};
  var fetched   = [];
  for (var pool of avatar_card_pool_list) {
    var start = unixToUtc8Str(parseInt(pool.time_info.start_ts));
    var end   = unixToUtc8Str(parseInt(pool.time_info.end_ts));
    for (var c of pool.avatar_list)
      if (c.item_id && c.item_name) nameIdMap[slugKey(c.item_name)] = { id: parseInt(c.item_id), type: 'character' };
    for (var c of pool.avatar_list.filter(function(c) { return c.rarity === '5'; }))
      fetched.push({ _apiId: pool.id, name: c.item_name, type: 'character', version: pool.version, start: start, end: end, featured: c.item_name, featuredId: parseInt(c.item_id), featuredType: 'character', isForward: c.is_forward });
  }
  for (var pool of equip_card_pool_list) {
    var start = unixToUtc8Str(parseInt(pool.time_info.start_ts));
    var end   = unixToUtc8Str(parseInt(pool.time_info.end_ts));
    for (var lc of pool.equip_list)
      if (lc.item_id && lc.item_name) nameIdMap[slugKey(lc.item_name)] = { id: parseInt(lc.item_id), type: 'weapon' };
    for (var lc of pool.equip_list.filter(function(l) { return l.rarity === '5'; }))
      fetched.push({ _apiId: pool.id, name: lc.item_name, type: 'weapon', version: pool.version, start: start, end: end, featured: lc.item_name, featuredId: parseInt(lc.item_id), featuredType: 'weapon', isForward: lc.is_forward });
  }
  var existing = fs.existsSync(SCHEDULE_PATH) ? JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf-8')) : [];
  var seen = new Set(existing.map(function(b) { return b.featuredId + '|' + (b.start || '').slice(0, 10); }));
  var newEntries = fetched.filter(function(b) { return !seen.has(b.featuredId + '|' + (b.start || '').slice(0, 10)); });
  var merged = existing.concat(newEntries);
  var existingNameMap = fs.existsSync(NAME_MAP_PATH) ? JSON.parse(fs.readFileSync(NAME_MAP_PATH, 'utf-8')) : {};
  fs.mkdirSync(path.dirname(SCHEDULE_PATH), { recursive: true });
  fs.writeFileSync(SCHEDULE_PATH, JSON.stringify(merged, null, 2));
  fs.writeFileSync(NAME_MAP_PATH, JSON.stringify(Object.assign({}, existingNameMap, nameIdMap), null, 2));
  console.log('Done. ' + newEntries.length + ' new entries added (' + merged.length + ' total).');
  if (newEntries.length > 0) console.log('New: ' + newEntries.map(function(b) { return b.name + ' v' + b.version; }).join(', '));
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  var uniqueItems = new Map();
  for (var entry of merged)
    if (entry.featuredId && !uniqueItems.has(entry.featuredId))
      uniqueItems.set(entry.featuredId, entry.featuredType || (entry.type === 'weapon' ? 'weapon' : 'character'));
  var imgDownloaded = 0, imgSkipped = 0;
  for (var [id, type] of uniqueItems) {
    var imgPath = path.join(IMAGES_DIR, id + '.png');
    if (fs.existsSync(imgPath)) { imgSkipped++; continue; }
    var spritePath = type === 'weapon' ? 'LightConeFigures/' + id : 'AvatarDrawCard/' + id;
    try {
      var buf = await httpsGetBuffer('https://enka.network/ui/hsr/SpriteOutput/' + spritePath + '.png');
      fs.writeFileSync(imgPath, buf);
      imgDownloaded++;
      console.log('  Image saved: ' + id + ' (' + type + ')');
    } catch(err) {
      console.warn('  Image failed: ' + id + ' -- ' + err.message);
    }
    await sleep(150);
  }
  console.log('Images: ' + imgDownloaded + ' new, ' + imgSkipped + ' already present.');
}
main().catch(function(e) { console.error(e.message); process.exit(1); });