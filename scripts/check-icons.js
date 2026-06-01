#!/usr/bin/env node
const https  = require('https');
const crypto = require('crypto');

const COOKIE     = process.env.HOYOLAB_COOKIE;
const ZZZ_UID    = process.env.ZZZ_UID;
const ZZZ_SERVER = process.env.ZZZ_SERVER;
const DS_SALT_HSR = '6s25p5ox5y14umn1p61aqyyvbvvl3lrt';

function generateDS(salt) {
  var t = Math.floor(Date.now() / 1000);
  var r = Math.floor(Math.random() * 900000) + 100000;
  return t + ',' + r + ',' + crypto.createHash('md5').update('salt=' + salt + '&t=' + t + '&r=' + r).digest('hex');
}

function httpsGet(path) {
  return new Promise(function(resolve, reject) {
    var req = https.request({
      hostname: 'sg-public-api.hoyolab.com', path, method: 'GET', timeout: 20000,
      headers: {
        'Cookie': COOKIE, 'DS': generateDS(DS_SALT_HSR),
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

async function main() {
  if (!COOKIE || !ZZZ_UID || !ZZZ_SERVER) { console.error('Missing env vars'); process.exit(1); }
  var json = await httpsGet('/event/game_record_zzz/api/zzz/gacha_calendar?uid=' + ZZZ_UID + '&region=' + ZZZ_SERVER);
  if (json.retcode !== 0) { console.error('API error', json.retcode, json.message); process.exit(1); }

  console.log('Top-level data keys:', Object.keys(json.data));
  console.log('\n=== FULL DATA (first banner of each array key) ===');
  for (var key in json.data) {
    var val = json.data[key];
    if (Array.isArray(val) && val.length > 0) {
      console.log('\n--- data.' + key + '[0] ---');
      console.log(JSON.stringify(val[0], null, 2));
    }
  }
}

main().catch(function(e) { console.error(e.message); process.exit(1); });