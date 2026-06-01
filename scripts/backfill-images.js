#!/usr/bin/env node
// Manual backfill: downloads images for every character/LC in the game.
// Run via GitHub Actions workflow_dispatch only.
// Usage: node scripts/backfill-images.js --game=hsr
//        node scripts/backfill-images.js --game=genshin
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const GAME = (process.argv.find(a => a.startsWith('--game=')) || '--game=hsr').split('=')[1];

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

const CONFIG = {
  hsr: {
    imagesDir: path.join(__dirname, '..', 'hsr', 'images'),
    async fetchItems() {
      console.log('Fetching HSR character list...');
      var characters = await httpsGetJson('https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/en/characters.json');
      console.log('Fetching HSR light cone list...');
      var lightCones = await httpsGetJson('https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/en/light_cones.json');
      var items = [];
      for (var id in characters)
        items.push({ id, name: characters[id].name || id, imageUrl: 'https://enka.network/ui/hsr/SpriteOutput/AvatarDrawCard/' + id + '.png' });
      for (var id in lightCones)
        items.push({ id, name: lightCones[id].name || id, imageUrl: 'https://enka.network/ui/hsr/SpriteOutput/LightConeFigures/' + id + '.png' });
      return items;
    },
  },
  genshin: {
    imagesDir: path.join(__dirname, '..', 'genshin', 'images'),
    async fetchItems() {
      console.log('Fetching Genshin character list...');
      var chars = await httpsGetJson('https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/characters.json');
      var items = [];
      for (var id in chars) {
        var internalName = (chars[id].SideIconName || '').replace('UI_AvatarIcon_Side_', '');
        if (!internalName) continue;
        items.push({ id, name: chars[id].name || id, imageUrl: 'https://enka.network/ui/UI_Gacha_AvatarImg_' + internalName + '.png' });
      }
      return items;
    },
  },
};

if (!CONFIG[GAME]) {
  console.error('Unknown game: ' + GAME + '. Supported: ' + Object.keys(CONFIG).join(', '));
  process.exit(1);
}

async function main() {
  var cfg = CONFIG[GAME];
  console.log('Backfill images for: ' + GAME);
  fs.mkdirSync(cfg.imagesDir, { recursive: true });

  var items = await cfg.fetchItems();
  console.log('Total items to check: ' + items.length);

  var downloaded = 0, skipped = 0, missing = 0;
  for (var item of items) {
    var imgPath = path.join(cfg.imagesDir, item.id + '.png');
    if (fs.existsSync(imgPath)) { skipped++; continue; }
    try {
      var buf = await httpsGetBuffer(item.imageUrl);
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
