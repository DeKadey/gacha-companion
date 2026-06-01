#!/usr/bin/env node
// Diagnostic: logs Genshin act_calendar API response structure.
// Will be replaced with full parser once structure is confirmed.
const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const vm     = require('vm');

const COOKIE = process.env.HOYOLAB_COOKIE;
const UID    = process.env.GENSHIN_UID;
const SERVER = process.env.GENSHIN_SERVER;

const API_URL = 'https://sg-public-api.hoyolab.com/event/game_record/genshin/api/act_calendar';
const DS_SALT = 'xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs';

const PAIMON_BANNERS_URL = 'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js';
const PAIMON_DUAL_URL    = 'https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/bannersDual.js';

function generateDS() {
  var t = Math.floor(Date.now() / 1000);
  var r = Math.floor(Math.random() * 900000) + 100000;
  var hash = crypto.createHash('md5').update('salt=' + DS_SALT + '&t=' + t + '&r=' + r).digest('hex');
  return t + ',' + r + ',' + hash;
}

function httpsGetJson(url, headers) {
  return new Promise(function(resolve, reject) {
    https.get(url, { headers: headers || {}, timeout: 20000 }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    }).on('error', reject);
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

function logStructure(key, val, depth) {
  if (depth === undefined) depth = 0;
  var indent = '  '.repeat(depth);
  if (Array.isArray(val)) {
    console.log(indent + key + ': array[' + val.length + ']');
    if (val.length > 0) {
      console.log(indent + '  [0] keys: ' + Object.keys(val[0]).join(', '));
      var sample = JSON.stringify(val[0]).slice(0, 500);
      console.log(indent + '  [0] sample: ' + sample);
    }
  } else if (val && typeof val === 'object') {
    console.log(indent + key + ': {' + Object.keys(val).join(', ') + '}');
    for (var k in val) logStructure(k, val[k], depth + 1);
  } else {
    console.log(indent + key + ': ' + String(val).slice(0, 200));
  }
}

async function fallbackPaimonMoe() {
  console.log('Running paimon.moe fallback to keep data current...');
  var bt = await httpsGetText(PAIMON_BANNERS_URL);
  var dt = await httpsGetText(PAIMON_DUAL_URL);
  var banners     = parseJsExport(bt);
  var bannersDual = parseJsExport(dt);
  if (!banners || typeof banners !== 'object') throw new Error('Unexpected format from paimon.moe');
  fs.mkdirSync('genshin', { recursive: true });
  fs.writeFileSync('genshin/banners.json',      JSON.stringify(banners,     null, 2));
  fs.writeFileSync('genshin/banners-dual.json', JSON.stringify(bannersDual, null, 2));
  console.log('paimon.moe data written.');
}

async function main() {
  if (!COOKIE || !UID || !SERVER) {
    console.log('No HoYoLAB credentials — running paimon.moe only.');
    await fallbackPaimonMoe();
    return;
  }

  console.log('Fetching Genshin act_calendar (UID ' + UID + ', server ' + SERVER + ')...');
  var json;
  try {
    json = await httpsGetJson(API_URL + '?server=' + SERVER + '&role_id=' + UID, {
      'Cookie':            COOKIE,
      'DS':                generateDS(),
      'x-rpc-app_version': '1.5.0',
      'x-rpc-client_type': '5',
      'x-rpc-language':    'en-us',
      'Referer':           'https://act.hoyolab.com/',
      'User-Agent':        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
  } catch(err) {
    console.error('API request failed: ' + err.message);
    await fallbackPaimonMoe();
    return;
  }

  console.log('retcode: ' + json.retcode + ' | message: ' + json.message);
  if (json.retcode !== 0) {
    console.error('API error — falling back to paimon.moe');
    await fallbackPaimonMoe();
    return;
  }

  console.log('=== GENSHIN API RESPONSE STRUCTURE ===');
  console.log('Top-level data keys: ' + Object.keys(json.data || {}).join(', '));
  for (var k in json.data) logStructure(k, json.data[k], 1);
  console.log('=== END STRUCTURE ===');

  // Keep paimon.moe data current until real parser is written
  await fallbackPaimonMoe();
}

main().catch(function(e) { console.error(e.message); process.exit(1); });