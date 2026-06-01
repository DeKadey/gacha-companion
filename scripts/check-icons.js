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

const DS_SALT = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';

function generateDS() {
  var t = Math.floor(Date.now() / 1000);
  var r = Math.floor(Math.random() * 900000) + 100000;
  return t + ',' + r + ',' + crypto.createHash('md5').update('salt=' + DS_SALT + '&t=' + t + '&r=' + r).digest('hex');
}

function httpsPost(path, body, extraHeaders) {
  return new Promise(function(resolve, reject) {
    var bodyStr = JSON.stringify(body);
    var req = https.request({
      hostname: 'sg-public-api.hoyolab.com', path, method: 'POST', timeout: 20000,
      headers: Object.assign({
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr),
        'Cookie': COOKIE, 'DS': generateDS(),
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

function httpsGet(path) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: 'sg-public-api.hoyolab.com', path, method: 'GET', timeout: 20000,
      headers: {
        'Cookie': COOKIE, 'DS': generateDS(),
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
  console.log('\n--- ' + label + ' (ALL fields) ---');
  console.log(JSON.stringify(obj, null, 2));
}

async function checkGenshin() {
  console.log('\n======= GENSHIN =======');
  if (!GENSHIN_UID || !GENSHIN_SERVER) { console.log('Skipped: missing GENSHIN_UID or GENSHIN_SERVER'); return; }
  var json = await httpsPost('/event/game_record/genshin/api/act_calendar', { server: GENSHIN_SERVER, role_id: GENSHIN_UID });
  if (json.retcode !== 0) { console.error('API error', json.retcode, json.message); return; }

  var pool = (json.data.avatar_card_pool_list || [])[0];
  if (pool) printFirst('character pool keys', Object.keys(pool));
  if (pool) printFirst('first avatar', (pool.avatars || [])[0]);

  var wpool = (json.data.weapon_card_pool_list || [])[0];
  if (wpool) printFirst('first weapon', (wpool.weapon || [])[0]);
}

async function checkHSR() {
  console.log('\n======= HSR =======');
  if (!HSR_UID || !HSR_SERVER) { console.log('Skipped: missing HSR_UID or HSR_SERVER'); return; }
  var json = await httpsGet('/event/game_record/hkrpg/api/get_act_calender?uid=' + HSR_UID + '&region=' + HSR_SERVER);
  if (json.retcode !== 0) { console.error('API error', json.retcode, json.message); return; }

  var pool = (json.data.avatar_card_pool_list || [])[0];
  if (pool) printFirst('character pool keys', Object.keys(pool));
  if (pool) printFirst('first avatar', (pool.avatar_list || [])[0]);

  var wpool = (json.data.equip_card_pool_list || [])[0];
  if (wpool) printFirst('first weapon', (wpool.equip_list || [])[0]);
}

async function checkZZZ() {
  console.log('\n======= ZZZ =======');
  if (!ZZZ_UID || !ZZZ_SERVER) { console.log('Skipped: missing ZZZ_UID or ZZZ_SERVER'); return; }
  var json = await httpsGet('/event/game_record_zzz/api/zzz/gacha_calendar?uid=' + ZZZ_UID + '&region=' + ZZZ_SERVER);
  if (json.retcode !== 0) { console.error('API error', json.retcode, json.message); return; }

  console.log('\nTop-level data keys:', Object.keys(json.data));
  // Print first item from each array field we find
  for (var key in json.data) {
    var val = json.data[key];
    if (Array.isArray(val) && val.length > 0) {
      var item = val[0];
      if (typeof item === 'object') printFirst('data.' + key + '[0]', item);
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
