#!/usr/bin/env node
// Unit tests for shelter analysis and physics utility functions

const fs = require('fs');
const path = require('path');

global.window = global;
global.NM = {};

eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'physics.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'js', 'shelter.js'), 'utf8'));

let passed = 0, failed = 0;
const failures = [];

function assert(name, condition) {
  if (condition) { passed++; }
  else { console.log(`FAIL: ${name}`); failed++; failures.push(name); }
}

// ---- SHELTER TYPE DATA ----
assert('SHELTER_TYPES exists', Array.isArray(NM.SHELTER_TYPES));
assert('8 shelter types', NM.SHELTER_TYPES.length === 8);
for (const s of NM.SHELTER_TYPES) {
  assert(`Shelter "${s.name}" has psi`, typeof s.psi === 'number' && s.psi > 0);
  assert(`Shelter "${s.name}" has thermal factor`, s.thermal >= 0 && s.thermal <= 1);
  assert(`Shelter "${s.name}" has rad factor`, s.rad >= 0 && s.rad <= 1);
}

// ---- ESTIMATE PSI ----
const effects = NM.calcEffects(100, 'airburst', 0, 50);
assert('estimatePsi at GZ is very high', NM.Shelter.estimatePsi(effects, 0) > 200);
assert('estimatePsi at psi5 radius is ~5', Math.abs(NM.Shelter.estimatePsi(effects, effects.psi5) - 5) < 2);
assert('estimatePsi beyond psi1 is low', NM.Shelter.estimatePsi(effects, effects.psi1 * 3) < 0.5);

// ---- ESTIMATE THERMAL ----
assert('estimateThermalCal at fireball is >100', NM.Shelter.estimateThermalCal(effects, effects.fireball * 0.5) > 100);
assert('estimateThermalCal at thermal3 edge is ~8', Math.abs(NM.Shelter.estimateThermalCal(effects, effects.thermal3) - 8) < 4);
assert('estimateThermalCal beyond thermal1 is 0', NM.Shelter.estimateThermalCal(effects, effects.thermal1 * 2) === 0);

// ---- SHELTER ANALYZE ----
const analysis = NM.Shelter.analyze(effects, effects.psi5);
assert('analyze returns 8 results', analysis.length === 8);
assert('Open air at 5psi has <50% survival', analysis[0].survival < 50);
assert('Deep underground at 5psi has high survival', analysis[7].survival > 80);

const safeAnalysis = NM.Shelter.analyze(effects, effects.psi1 * 2);
assert('Most shelters survive beyond psi1', safeAnalysis.filter(a => a.survival > 50).length >= 6);

// ---- GENERATE REPORT ----
assert('generateReport exists', typeof NM.Shelter.generateReport === 'function');
const report = NM.Shelter.generateReport(effects);
assert('generateReport returns HTML', typeof report === 'string' && report.length > 100);
assert('Report contains shelter names', report.includes('Open Air') && report.includes('Deep Underground'));

// ---- EDGE CASES ----
const tinyEffects = NM.calcEffects(0.001, 'airburst', 0, 50);
assert('Tiny yield produces valid effects', tinyEffects.fireball > 0);
const tinyReport = NM.Shelter.generateReport(tinyEffects);
assert('Tiny yield report is valid', typeof tinyReport === 'string');

const hugeEffects = NM.calcEffects(100000, 'airburst', 0, 50);
assert('100MT yield produces valid effects', hugeEffects.psi1 > 0);
const hugeAnalysis = NM.Shelter.analyze(hugeEffects, hugeEffects.psi5);
assert('100MT analysis has results', hugeAnalysis.length === 8);

// ---- LATENT CANCER ESTIMATES ----
assert('estimateLatentCancer exists', typeof NM.estimateLatentCancer === 'function');
const cancer = NM.estimateLatentCancer(effects, 5000);
assert('Cancer 30yr > Cancer 10yr', cancer.cancers30yr > cancer.cancers10yr);
assert('Cancer exposed > 0', cancer.exposed > 0);
assert('Genetic effects >= 0', cancer.geneticEffects >= 0);

// ---- CONFLAGRATION SCALING ----
const urbanEffects = NM.calcEffects(100, 'airburst', 0, 50, 10000);
const ruralEffects = NM.calcEffects(100, 'airburst', 0, 50, 50);
assert('Urban firestorm > rural firestorm', urbanEffects.firestormR > ruralEffects.firestormR);

console.log(`\nShelter + physics tests: ${passed}/${passed + failed} passed, ${failed} failed`);
if (failures.length) { console.log('Failures:', failures.join(', ')); }
process.exit(failed > 0 ? 1 : 0);
