#!/usr/bin/env node
// Unit tests for URL parsing (loadFromURL format) and search (searchLocations)

const fs = require('fs');
const path = require('path');

global.window = global;
global.NM = {};
global.document = { getElementById: () => null, querySelectorAll: () => [], createElement: (t) => ({textContent:'',innerHTML:'',get innerHTML_() { return '' }}) };

// Load data module (cities, weapons)
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8'));
// Load physics (needed by search for findNearestCity)
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'physics.js'), 'utf8'));
// Load search module
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'search.js'), 'utf8'));

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const immersiveJs = fs.readFileSync(path.join(__dirname, '..', 'js', 'immersive.js'), 'utf8');
const swJs = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

let passed = 0, failed = 0;
const failures = [];

function assert(name, condition) {
  if (condition) { passed++; }
  else { console.log(`FAIL: ${name}`); failed++; failures.push(name); }
}

// ---- METADATA DRIFT TESTS ----
const titleVersion = (indexHtml.match(/<title>NukeMap v([\d.]+)<\/title>/) || [])[1];
const cacheVersion = (swJs.match(/nukemap-v([\d.]+)/) || [])[1];
const welcomeWeaponCount = +(indexHtml.match(/id="weapon-count-tag"[^>]*>(\d+) Weapons/) || [])[1];
const presetWeaponCount = NM.WEAPONS.filter(w => w.name !== 'Custom').length;

assert('Metadata: app version constant matches title', NM.APP_VERSION === titleVersion);
assert('Metadata: service worker cache matches app version', cacheVersion === NM.APP_VERSION);
assert('Metadata: welcome weapon count matches presets', welcomeWeaponCount === presetWeaponCount);
assert('Metadata: JSON export uses shared app version', /version\s*:\s*NM\.APP_VERSION/.test(appJs) && !/version\s*:\s*['"]3\./.test(appJs));
assert('Metadata: welcome weapon count is runtime-synced', /weapon-count-tag/.test(indexHtml) && /weaponCountTag\.textContent/.test(appJs));
assert('Exports: JSON includes provenance', /provenance/.test(appJs) && /NM\.getModelProvenance\(d\.effects\)/.test(appJs));
assert('Exports: GeoJSON includes provenance', /type:'FeatureCollection',provenance,features/.test(appJs));
assert('Exports: CSV includes model provenance columns', /app_version,physics_model,fallout_model,citation_keys,assumptions/.test(appJs));
assert('Exports: text and print reports include model provenance', /MODEL PROVENANCE/.test(appJs) && /Model Provenance/.test(appJs));
assert('Exports: KML includes model provenance', /physicsModel/.test(immersiveJs) && /citationKeys/.test(immersiveJs));
assert('Privacy: GPS and live wind controls show pre-use notices', /Your GPS coordinates stay in this browser/.test(indexHtml) && /map center coordinates to Open-Meteo/.test(indexHtml));
assert('Privacy: GPS error path does not render browser error HTML', /_setTextStatus/.test(immersiveJs) && !/Location error:\s*\$\{err\.message\}/.test(immersiveJs));
assert('Privacy: GPS status helper uses textContent', /msg\.textContent\s*=\s*text/.test(immersiveJs) && /replaceChildren\(\)/.test(immersiveJs));

// ---- CSV IMPORT VALIDATION TESTS ----
const validCsv = 'lat,lng,yield_kt,burst_type,weapon\n40.7128,-74.0060,455,airburst,"W88, Trident"\n33,-118,50,water,Imported';
const validImport = NM.validateCSVImport(validCsv, validCsv.length);
assert('CSV: valid rows accepted', validImport.ok && validImport.validRows.length === 2 && validImport.skippedRows.length === 0);
assert('CSV: quoted weapon field parsed', validImport.validRows[0].weapon === 'W88, Trident');

const mixedCsv = 'lat,lng,yield_kt,burst_type\n91,-74,455,airburst\n40,-181,455,surface\n40,-74,200000,airburst\n40,-74,10,bogus\n40,-74,10,hemp';
const mixedImport = NM.validateCSVImport(mixedCsv, mixedCsv.length);
assert('CSV: invalid rows skipped and valid rows retained', mixedImport.ok && mixedImport.validRows.length === 1 && mixedImport.skippedRows.length === 4);
assert('CSV: oversize file rejected before import', NM.validateCSVImport(validCsv, NM.CSV_IMPORT_LIMITS.maxBytes + 1).ok === false);

const tooManyRowsCsv = 'lat,lng,yield_kt,burst_type\n' + Array.from({length: NM.CSV_IMPORT_LIMITS.maxRows + 1}, () => '40,-74,10,airburst').join('\n');
assert('CSV: row cap rejected', NM.validateCSVImport(tooManyRowsCsv, tooManyRowsCsv.length).ok === false);

// ---- URL PARSING TESTS ----
// Test the URL format: lat,lng,yield,burst[,height,fission]
function parseDetParam(seg) {
  const parts = seg.split(',');
  const la = +parts[0], ln = +parts[1], yk = +parts[2], bt = parts[3];
  const hm = parts[4] ? +parts[4] : 0;
  const ff = parts[5] ? +parts[5] : 50;
  if (!isFinite(la) || !isFinite(ln) || !isFinite(yk)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  if (yk < 0.001 || yk > 100000) return null;
  const burst = bt === 's' ? 'surface' : bt === 'c' ? 'custom' : bt === 'h' ? 'hemp' : bt === 'w' ? 'water' : 'airburst';
  return { lat: la, lng: ln, yield: yk, burst, height: hm, fission: ff };
}

// Valid URLs
assert('URL: basic airburst', (() => { const r = parseDetParam('40.7128,-74.0060,100,a'); return r && r.burst === 'airburst' && r.yield === 100; })());
assert('URL: surface burst', (() => { const r = parseDetParam('38.8977,-77.0366,455,s'); return r && r.burst === 'surface'; })());
assert('URL: custom burst with height', (() => { const r = parseDetParam('39.0,-104.0,300,c,5000,60'); return r && r.burst === 'custom' && r.height === 5000 && r.fission === 60; })());
assert('URL: hemp burst', (() => { const r = parseDetParam('35.0,-100.0,1400,h'); return r && r.burst === 'hemp'; })());
assert('URL: water burst', (() => { const r = parseDetParam('33.0,-118.0,50,w'); return r && r.burst === 'water'; })());
assert('URL: very small yield (1 ton)', (() => { const r = parseDetParam('40.0,-74.0,0.001,a'); return r && r.yield === 0.001; })());
assert('URL: very large yield (100 MT)', (() => { const r = parseDetParam('40.0,-74.0,100000,a'); return r && r.yield === 100000; })());

// Invalid URLs (should return null)
assert('URL: reject NaN lat', parseDetParam('NaN,-74.0,100,a') === null);
assert('URL: reject Infinity', parseDetParam('Infinity,-74.0,100,a') === null);
assert('URL: reject lat > 90', parseDetParam('91.0,-74.0,100,a') === null);
assert('URL: reject lat < -90', parseDetParam('-91.0,-74.0,100,a') === null);
assert('URL: reject lng > 180', parseDetParam('40.0,181.0,100,a') === null);
assert('URL: reject yield < 0.001', parseDetParam('40.0,-74.0,0.0001,a') === null);
assert('URL: reject yield > 100000', parseDetParam('40.0,-74.0,200000,a') === null);
assert('URL: reject yield NaN', parseDetParam('40.0,-74.0,abc,a') === null);

// Default fission when not specified
assert('URL: default fission=50', (() => { const r = parseDetParam('40.0,-74.0,100,a'); return r && r.fission === 50; })());

// ---- SEARCH TESTS ----
assert('Search: find New York', (() => { const r = NM.searchLocations('New York'); return r.length > 0 && r[0].name.includes('New York'); })());
assert('Search: alias nyc', (() => { const r = NM.searchLocations('nyc'); return r.length > 0 && r[0].name.includes('New York'); })());
assert('Search: alias la', (() => { const r = NM.searchLocations('la'); return r.length > 0 && r[0].name.includes('Los Angeles'); })());
assert('Search: coordinates', (() => { const r = NM.searchLocations('40.7128, -74.006'); return r.length === 1 && Math.abs(r[0].lat - 40.7128) < 0.001; })());
assert('Search: empty returns empty', NM.searchLocations('').length === 0);
assert('Search: fuzzy partial match', (() => { const r = NM.searchLocations('Chica'); return r.length > 0 && r.some(x => x.name.includes('Chicago')); })());
assert('Search: Washington', (() => { const r = NM.searchLocations('Washington'); return r.length > 0; })());

// Target search (military)
assert('Search: Pentagon target', (() => { const r = NM.searchLocations('Pentagon'); return r.length > 0; })());

const total = passed + failed;
console.log(`\nURL + search tests: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  console.error('FAILURES:', failures.join(', '));
  process.exit(1);
}
