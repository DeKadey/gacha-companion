#!/usr/bin/env node
// Diagnostic: prints raw character/weapon objects from each game's banner API
// so we can see what icon URL fields are available.
const https  = require('https');
const crypto = require('crypto');

const COOKIE         = process.env.HOYOLAB_COOKIE;
const GENSHIN_UID    = process.env.GENSHIN_UID;
const GENSHIN_SERVER = process.env.GENSHIN_SERVER;
const HSR_UID        = process.env.HSR_UID;
const HSR_SERVER     = process.env.HSR_SERVER;
const ZZZ_UID        = process.env.ZZZ_UID;
const ZZZ_SERVER     = process.env.ZZZ_SERVER;

const DS_SALT_GENSHIN = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';
const DS_SALT_HSR     = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';

function generateDS(salt) {
  var t = Math.floor(Date.now() / 1000);
  var r = Math.floor(Math.random() * 900000) + 100000;
  return t + ',' + r + ',' + crypto.createHash('md5').update('salt=' + salt + '&t=' + t + '&r=' + r).digest('hex');
}

function httpsPost(path, body, extraHeaders) {
  return new Promise(function(resolve, reject) {
    var bodyStr = JSON.stringify(body);
    var req = https.request({
      hostname: 'sg-public-api.hoyolab.com', path, method: 'POST', timeout: 20000,
      headers: Object.assign({
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr),
        'Cookie': COOKIE, 'DS': generateDS(DS_SALT_GENSHIN),
        'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
        'Referer': 'https://act.hoyolab.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }, extraHeaders),
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(JSON.parse(Buffer.concat(chunks).toString())); });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(path, salt) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: 'sg-public-api.hoyolab.com', path, method: 'GET', timeout: 20000,
      headers: {
        'Cookie': COOKIE, 'DS': generateDS(salt || DS_SALT_HSR),
        'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
        'Referer': 'https://act.hoyolab.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(JSON.parse(Buffer.concat(chunks).toString())); });
    });
    req.on('error', reject);
    req.end();
  });
}

function printFirst(label, obj) {
  console.log('\n--- ' + label + ' ---');
  console.log(JSON.stringify(obj, null, 2));
}

function unixToUtc8Str(unix) {
  var d = new Date((unix + 8 * 3600) * 1000);
  var p = function(n) { return String(n).padStart(2, '0'); };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth()+1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

async function checkGenshin() {
  console.log('\n======= GENSHIN =======');
  if (!GENSHIN_UID || !GENSHIN_SERVER) { console.log('Skipped: missing GENSHIN_UID or GENSHIN_SERVER'); return; }
  var json = await httpsPost('/event/game_record/genshin/api/act_calendar', { server: GENSHIN_SERVER, role_id: GENSHIN_UID });
  if (json.retcode !== 0) { console.error('API error', json.retcode, json.message); return; }

  var pool = (json.data.avatar_card_pool_list || [])[0];
  if (pool) {
    console.log('\nCharacter pool (excluding arrays):');
    var poolMeta = {};
    for (var k in pool) { if (!Array.isArray(pool[k])) poolMeta[k] = pool[k]; }
    console.log(JSON.stringify(poolMeta, null, 2));
    if (pool.start_timestamp) console.log('  start UTC+8:', unixToUtc8Str(parseInt(pool.start_timestamp)));
    if (pool.end_timestamp)   console.log('  end UTC+8:  ', unixToUtc8Str(parseInt(pool.end_timestamp)));
    printFirst('first avatar', (pool.avatars || [])[0]);
  }

  var wpool = (json.data.weapon_card_pool_list || [])[0];
  if (wpool) {
    console.log('\nWeapon pool timestamps:');
    if (wpool.start_timestamp) console.log('  start UTC+8:', unixToUtc8Str(parseInt(wpool.start_timestamp)));
    if (wpool.end_timestamp)   console.log('  end UTC+8:  ', unixToUtc8Str(parseInt(wpool.end_timestamp)));
  }
}

async function checkHSR() {
  console.log('\n======= HSR =======');
  if (!HSR_UID || !HSR_SERVER) { console.log('Skipped: missing HSR_UID or HSR_SERVER'); return; }
  var json = await httpsGet('/event/game_record/hkrpg/api/get_act_calender?server=' + HSR_SERVER + '&role_id=' + HSR_UID);
  if (json.retcode !== 0) { console.error('API error', json.retcode, json.message); return; }

  var pool = (json.data.avatar_card_pool_list || [])[0];
  if (pool) {
    console.log('\nCharacter pool (excluding arrays):');
    var poolMeta = {};
    for (var k in pool) { if (!Array.isArray(pool[k])) poolMeta[k] = pool[k]; }
    console.log(JSON.stringify(poolMeta, null, 2));
    // Try common timestamp field names
    var startField = pool.start_timestamp || pool.begin_timestamp || pool.start_time || pool.begin_time;
    var endField   = pool.end_timestamp || pool.finish_timestamp || pool.end_time || pool.finish_time;
    if (typeof startField === 'number') console.log('  start UTC+8:', unixToUtc8Str(startField));
    if (typeof endField   === 'number') console.log('  end UTC+8:  ', unixToUtc8Str(endField));
    printFirst('first avatar', (pool.avatar_list || [])[0]);
  }

  var wpool = (json.data.equip_card_pool_list || [])[0];
  if (wpool) {
    console.log('\nWeapon pool (excluding arrays):');
    var wpoolMeta = {};
    for (var k in wpool) { if (!Array.isArray(wpool[k])) wpoolMeta[k] = wpool[k]; }
    console.log(JSON.stringify(wpoolMeta, null, 2));
  }
}

async function checkZZZ() {
  console.log('\n======= ZZZ =======');
  if (!ZZZ_UID || !ZZZ_SERVER) { console.log('Skipped: missing ZZZ_UID or ZZZ_SERVER'); return; }
  var json = await httpsGet('/event/game_record_zzz/api/zzz/gacha_calendar?uid=' + ZZZ_UID + '&region=' + ZZZ_SERVER);
  if (json.retcode !== 0) { console.error('API error', json.retcode, json.message); return; }

  console.log('\nTop-level data keys:', Object.keys(json.data));
  for (var key in json.data) {
    var val = json.data[key];
    if (Array.isArray(val) && val.length > 0) {
      var item = val[0];
      if (typeof item === 'object') {
        if (item.start_ts) {
          console.log('\n' + key + '[0] timestamps:');
          console.log('  start_ts:', item.start_ts, ' =>', unixToUtc8Str(parseInt(item.start_ts)));
          console.log('  end_ts:  ', item.end_ts,   ' =>', unixToUtc8Str(parseInt(item.end_ts)));
        }
        printFirst('data.' + key + '[0]', item);
      }
    }
  }
}

async function main() {
  if (!COOKIE) { console.error('Missing HOYOLAB_COOKIE'); process.exit(1); }
  await checkGenshin();
  await checkHSR();
  await checkZZZ();
  console.log('\n======= DONE =======');
}

main().catch(function(e) { console.error(e.message); process.exit(1); });