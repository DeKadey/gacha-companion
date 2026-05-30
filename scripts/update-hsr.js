const https = require('https');
const fs    = require('fs');

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

function slugKey(s) { return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function unixToUtc8Str(unix) {
  const d = new Date((unix + 8 * 3600) * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

async function main() {
  console.log('Fetching HSR banner data from api.ennead.cc...');
  fs.mkdirSync('hsr', { recursive: true });
  const nmPath  = 'hsr/name-id-map.json';
  const schPath = 'hsr/banner-schedule.json';
  const storedMap      = fs.existsSync(nmPath)  ? JSON.parse(fs.readFileSync(nmPath,  'utf-8')) : {};
  const storedSchedule = fs.existsSync(schPath) ? JSON.parse(fs.readFileSync(schPath, 'utf-8')) : [];

  const raw     = await httpsGet('https://api.ennead.cc/mihoyo/starrail/calendar');
  const json    = JSON.parse(raw);
  const entries = Array.isArray(json) ? json : Object.values(json).filter(v => v && typeof v === 'object' && v.id);

  const fetchedMap = {};
  const fetched    = [];
  for (const b of entries) {
    const start = b.start_time ? unixToUtc8Str(b.start_time) : null;
    const end   = b.end_time   ? unixToUtc8Str(b.end_time)   : null;
    for (const c of (b.characters  ?? [])) { if (c.id && c.name) fetchedMap[slugKey(c.name)] = { id: c.id, type: 'character' }; }
    for (const l of (b.light_cones ?? [])) { if (l.id && l.name) fetchedMap[slugKey(l.name)] = { id: l.id, type: 'weapon' };    }
    for (const c of (b.characters  ?? []).filter(x => x.rarity === 5)) {
      fetched.push({ _apiId: b.id, name: c.name, type: 'character', version: b.version ?? '', start, end, featured: c.name, featuredId: c.id, featuredType: 'character' });
    }
    for (const l of (b.light_cones ?? []).filter(x => x.rarity === 5)) {
      fetched.push({ _apiId: b.id, name: l.name, type: 'weapon', version: b.version ?? '', start, end, featured: l.name, featuredId: l.id, featuredType: 'weapon' });
    }
  }
  const merged   = { ...storedMap, ...fetchedMap };
  const existing = new Set(storedSchedule.map(b => `${b.featuredId}|${b.start}`));
  const combined = [...storedSchedule, ...fetched.filter(b => !existing.has(`${b.featuredId}|${b.start}`))];
  fs.writeFileSync(nmPath,  JSON.stringify(merged,   null, 2));
  fs.writeFileSync(schPath, JSON.stringify(combined, null, 2));
  console.log(`HSR updated: ${Object.keys(merged).length} entries, ${combined.length} banner schedule entries.`);
}

main().catch(err => { console.error('update-hsr failed:', err.message); process.exit(1); });