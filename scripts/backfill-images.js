#!/usr/bin/env node
// Manual backfill: downloads images for every character and LC in the game.
// Run via GitHub Actions workflow_dispatch only.
// Usage: node scripts/backfill-images.js --game hsr
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GAME = (process.argv.find(a => a.startsWith('--game=')) || '--game=hsr').split('=')[1];

const CONFIG = {
  hsr: {
    charactersUrl: 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/en/characters.json',
    lightConesUrl: 'https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/en/light_cones.json',
    imagesDir:     path.join(__dirname, '..', 'hsr', 'images'),
    charImageUrl:  function(id) { return 'https://enka.network/ui/hsr/SpriteOutput/AvatarDrawCard/' + id + '.png'; },
    lcImageUrl:    function(id) { return 'https://enka.network/ui/hsr/SpriteOutput/LightConeFigures/' + id + '.png'; },
    isLC:          function(id) { return parseInt(id) >= 20000; },
  },
};

if (!CONFIG[GAME]) {
  console.error('Unknown game: ' + GAME + '. Supported: ' + Object.keys(CONFIG).join(', '));
  process.exit(1);
}

const cfg = CONFIG[GAME];

function httpsGetJson(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 20000, headers: { 'User-Agent': 'gacha-companion-backfill' } }, function(res) {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode + ' from ' + url)); return; }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

function httpsGetBuffer(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, { timeout: 20000, headers: { 'User-Agent': 'gacha-companion-backfill' } }, function(res) {
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
  console.log('Backfill images for: ' + GAME);
  fs.mkdirSync(cfg.imagesDir, { recursive: true });

  console.log('Fetching character list...');
  var characters = await httpsGetJson(cfg.charactersUrl);
  console.log('Fetching light cone list...');
  var lightCones = await httpsGetJson(cfg.lightConesUrl);

  var items = [];
  for (var id in characters) {
    if (id.startsWith('8') && parseInt(id) >= 8000) {
      // Trailblazer variants - include all
    }
    items.push({ id: id, name: characters[id].name || id, isLC: false });
  }
  for (var id in lightCones) {
    items.push({ id: id, name: lightCones[id].name || id, isLC: true });
  }

  console.log('Total items to check: ' + items.length);

  var downloaded = 0, skipped = 0, missing = 0;
  for (var item of items) {
    var imgPath = path.join(cfg.imagesDir, item.id + '.png');
    if (fs.existsSync(imgPath)) { skipped++; continue; }
    var url = item.isLC ? cfg.lcImageUrl(item.id) : cfg.charImageUrl(item.id);
    try {
      var buf = await httpsGetBuffer(url);
      if (buf === null) {
        missing++;
        console.log('  No image: ' + item.id + ' ' + item.name);
      } else {
        fs.writeFileSync(imgPath, buf);
        downloaded++;
        console.log('  Saved: ' + item.id + ' ' + item.name);
      }
    } catch(err) {
      missing++;
      console.warn('  Failed: ' + item.id + ' ' + item.name + ' -- ' + err.message);
    }
    await sleep(150);
  }

  console.log('');
  console.log('Done. Downloaded: ' + downloaded + ', already present: ' + skipped + ', no image available: ' + missing);
}

main().catch(function(e) { console.error(e.message); process.exit(1); });