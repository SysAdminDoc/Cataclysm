#!/usr/bin/env node
// Unit tests for WW3 simulation data integrity
// Validates target databases, scenario configurations, and warhead counts

const fs = require('fs');
const path = require('path');

global.window = global;
global.NM = {};
global.document = { getElementById: () => null, querySelectorAll: () => [], createElement: () => ({textContent:'',innerHTML:''}) };
global.L = { Layer: { extend: () => ({}) }, DomUtil: { create: () => ({style:{}}) }, circle: () => ({addTo:()=>({}),bindTooltip:()=>({})}), circleMarker: () => ({addTo:()=>({}),bindTooltip:()=>({})}) };

eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'physics.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'ww3.js'), 'utf8'));

let passed = 0, failed = 0;
const failures = [];

function assert(name, condition) {
  if (condition) { passed++; }
  else { console.log(`FAIL: ${name}`); failed++; failures.push(name); }
}

// ---- TARGET DATABASE TESTS ----
const targetSets = [
  {name: 'US', arr: NM.WW3_TARGETS_US, minCount: 170},
  {name: 'Russia', arr: NM.WW3_TARGETS_RU, minCount: 95},
  {name: 'NATO', arr: NM.WW3_TARGETS_NATO, minCount: 70},
  {name: 'China', arr: NM.WW3_TARGETS_CN, minCount: 60},
];

for (const ts of targetSets) {
  assert(`${ts.name} targets exist (>=${ts.minCount})`, ts.arr && ts.arr.length >= ts.minCount);
  if (!ts.arr) continue;
  for (const t of ts.arr) {
    assert(`${ts.name}/${t.name} has valid lat`, t.lat >= -90 && t.lat <= 90);
    assert(`${ts.name}/${t.name} has valid lng`, t.lng >= -180 && t.lng <= 180);
    assert(`${ts.name}/${t.name} has warheads >= 0`, t.warheads >= 0);
    assert(`${ts.name}/${t.name} has yieldKt > 0`, t.yieldKt > 0);
    assert(`${ts.name}/${t.name} has a name`, typeof t.name === 'string' && t.name.length > 0);
    assert(`${ts.name}/${t.name} has a type`, typeof t.type === 'string' && t.type.length > 0);
  }
}

// ---- SCENARIO TESTS ----
assert('WW3_SCENARIOS exists', Array.isArray(NM.WW3_SCENARIOS));
assert('At least 7 scenarios', NM.WW3_SCENARIOS.length >= 7);

for (const s of NM.WW3_SCENARIOS) {
  assert(`Scenario ${s.id} has name`, typeof s.name === 'string');
  assert(`Scenario ${s.id} has phases`, Array.isArray(s.phases) && s.phases.length > 0);
  assert(`Scenario ${s.id} has targetSets`, typeof s.targetSets === 'object');
  assert(`Scenario ${s.id} has launchSets`, typeof s.launchSets === 'object');

  // Validate phase ordering
  let lastDelay = -1;
  for (const p of s.phases) {
    assert(`Scenario ${s.id} phase "${p.name}" delay >= previous`, p.delay >= lastDelay);
    lastDelay = p.delay;
  }
}

// ---- WARHEAD COUNT TESTS ----
assert('countWarheads function exists', typeof NM.WW3.countWarheads === 'function');

const globalWh = NM.WW3.countWarheads('global');
assert('Global scenario has 600+ warheads', globalWh >= 600);

const usruWh = NM.WW3.countWarheads('us_ru_full');
assert('US-Russia has 200+ warheads', usruWh >= 200);

const cfWh = NM.WW3.countWarheads('counterforce_only');
assert('Counterforce has warheads', cfWh > 0);

// ---- LAUNCHERS ----
assert('WW3_LAUNCHERS exists', typeof NM.WW3_LAUNCHERS === 'object');
const expectedSites = ['us_icbm','us_slbm','ru_icbm','ru_slbm','cn_icbm','cn_slbm'];
for (const key of expectedSites) {
  assert(`Launcher ${key} exists`, NM.WW3_LAUNCHERS[key] && NM.WW3_LAUNCHERS[key].length > 0);
  for (const site of (NM.WW3_LAUNCHERS[key] || [])) {
    assert(`Launcher ${key}/${site.name} has valid coords`, site.lat >= -90 && site.lat <= 90 && site.lng >= -180 && site.lng <= 180);
  }
}

// ---- SUMMARY ----
console.log(`\nWW3 tests: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:', failures.join(', ')); }
process.exit(failed > 0 ? 1 : 0);
