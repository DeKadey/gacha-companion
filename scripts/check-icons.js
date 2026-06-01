#!/usr/bin/env node
// Diagnostic: prints the raw character/weapon objects from each game's banner API
// so we can see what icon URL fields are available.
const https  = require('https');
const crypto = require('crypto');

const COOKIE = process.env.HOYOLAB_COOKIE;
const GENSHIN_UID    = process.env.GENSHIN_UID;
const GENSHIN_SERVER = process.env.GENSHIN_SERVER;
const HSR_UID        = process.env.HSR_UID;
const HSR_SERVER     = process.env.HSR_SERVER;

const DS_SALT_GENSHIN = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';

function generateDS(salt) {
  var t = Math.floor(Date.now() / 1000);
  var r = Math.floor(Math.random() * 900000) + 100000;
  return t + ',' + r + ',' + crypto.createHash('md5').update('salt=' + salt + '&t=' + t + '&r=' + r).digest('hex');
}

function httpsPost(hostname, path, body, headers) {
  return new Promise(function(resolve, reject) {
    var bodyStr = JSON.stringify(body);
    var req = https.request({
      hostname, path, method: 'POST', timeout: 20000,
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }, headers),
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

function httpsGet(hostname, path, headers) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname, path, method: 'GET', timeout: 20000, headers,
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve(JSON.parse(Buffer.concat(chunks).toString())); });
    });
    req.on('error', reject);
    req.end();
  });
}

async function checkGenshin() {
  console.log('\n======= GENSHIN =======');
  var json = await httpsPost(
    'sg-public-api.hoyolab.com',
    '/event/game_record/genshin/api/act_calendar',
    { server: GENSHIN_SERVER, role_id: GENSHIN_UID },
    {
      'Cookie': COOKIE, 'DS': generateDS(DS_SALT_GENSHIN),
      'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
      'Referer': 'https://act.hoyolab.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  );
  if (json.retcode !== 0) { console.error('Genshin API error:', json.retcode, json.message); return; }

  var pool = (json.data.avatar_card_pool_list || [])[0];
  if (pool) {
    console.log('--- First character banner pool ---');
    console.log('Pool keys:', Object.keys(pool));
    var avatar = (pool.avatars || [])[0];
    if (avatar) {
      console.log('\nFirst avatar object (ALL fields):');
      console.log(JSON.stringify(avatar, null, 2));
    }
  }

  var wpool = (json.data.weapon_card_pool_list || [])[0];
  if (wpool) {
    var weapon = (wpool.weapon || [])[0];
    if (weapon) {
      console.log('\nFirst weapon object (ALL fields):');
      console.log(JSON.stringify(weapon, null, 2));
    }
  }
}

async function checkHSR() {
  console.log('\n======= HSR =======');
  var json = await httpsGet(
    'sg-public-api.hoyolab.com',
    '/event/game_record/hkrpg/api/get_act_calender?uid=' + HSR_UID + '&region=' + HSR_SERVER,
    {
      'Cookie': COOKIE,
      'x-rpc-app_version': '1.5.0', 'x-rpc-client_type': '5', 'x-rpc-language': 'en-us',
      'Referer': 'https://act.hoyolab.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  );
  if (json.retcode !== 0) { console.error('HSR API error:', json.retcode, json.message); return; }

  var pool = (json.data.avatar_card_pool_list || [])[0];
  if (pool) {
    console.log('--- First character banner pool ---');
    console.log('Pool keys:', Object.keys(pool));
    var avatar = (pool.avatar_list || [])[0];
    if (avatar) {
      console.log('\nFirst avatar object (ALL fields):');
      console.log(JSON.stringify(avatar, null, 2));
    }
  }

  var wpool = (json.data.equip_card_pool_list || [])[0];
  if (wpool) {
    var equip = (wpool.equip_list || [])[0];
    if (equip) {
      console.log('\nFirst weapon object (ALL fields):');
      console.log(JSON.stringify(equip, null, 2));
    }
  }
}

async function main() {
  if (!COOKIE) { console.error('Missing HOYOLAB_COOKIE'); process.exit(1); }
  await checkGenshin();
  await checkHSR();
}

main().catch(function(e) { console.error(e.message); process.exit(1); });
