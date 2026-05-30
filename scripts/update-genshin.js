const https = require('https');
const fs    = require('fs');
const vm    = require('vm');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve(Buffer.concat(c).toString('utf-8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
  });
}

function parseJsExport(text) {
  const stripped = text
    .replace(/^export\s+const\s+\w+\s*=\s*/, '__result = ')
    .replace(/;\s*$/, '');
  const ctx = { __result: null };
  vm.runInNewContext(stripped, ctx, { timeout: 5000 });
  return ctx.__result;
}

async function main() {
  console.log('Fetching Genshin banner data from paimon.moe...');
  const [bt, dt] = await Promise.all([
    httpsGet('https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/banners.js'),
    httpsGet('https://raw.githubusercontent.com/MadeBaruna/paimon-moe/main/src/data/bannersDual.js'),
  ]);
  const banners     = parseJsExport(bt);
  const bannersDual = parseJsExport(dt);
  if (!banners || typeof banners !== 'object') throw new Error('Unexpected format');
  fs.mkdirSync('genshin', { recursive: true });
  fs.writeFileSync('genshin/banners.json',     JSON.stringify(banners,     null, 2));
  fs.writeFileSync('genshin/banners-dual.json', JSON.stringify(bannersDual, null, 2));
  console.log('Genshin data updated.');
}

main().catch(err => { console.error('update-genshin failed:', err.message); process.exit(1); });