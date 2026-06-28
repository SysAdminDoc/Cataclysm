// NukeMap v3.6.0 - Main Application Controller
window.NM = window.NM || {};

(function() {
'use strict';

let map, currentDets = [], windAngle = 0, multiMode = false, mirvMode = false, currentMirvPreset = null;
NM._nightMode = false;
let pendingCSVImport = null;

function syncAppMetadata() {
  const weaponCount = Math.max(0, (NM.WEAPONS || []).filter(w => w.name !== 'Custom').length);
  const weaponCountTag = $('weapon-count-tag');
  if (weaponCountTag) weaponCountTag.textContent = `${weaponCount} Weapons`;
}

function _genCumulative(dets) {
  const totalY = dets.reduce((s,d) => s + d.yieldKt, 0);
  const hiro = totalY / 15;
  const areas = {};
  const zoneNames = ['fireball','psi20','psi5','psi1','thermal3','thermal1','emp'];
  const zoneLabels = {fireball:'Fireball',psi20:'20 psi',psi5:'5 psi',psi1:'1 psi',thermal3:'3rd° Burns',thermal1:'1st° Burns',emp:'EMP'};
  for (const d of dets) { for (const z of zoneNames) { const r = d.effects[z]; if (r > 0.001) areas[z] = (areas[z]||0) + Math.PI * r * r; } }
  const totalFallout = dets.filter(d => d.effects.fallout).reduce((s,d) => {
    const f = d.effects.fallout; return s + Math.PI * f.heavy.length * f.heavy.width / 4 + Math.PI * f.light.length * f.light.width / 4;
  }, 0);
  let html = '<div class="cum-grid">';
  html += `<div class="cum-stat"><span class="cum-val">${dets.length}</span><span class="cum-lbl">Detonations</span></div>`;
  html += `<div class="cum-stat"><span class="cum-val">${NM.fmtYield(totalY)}</span><span class="cum-lbl">Total Yield</span></div>`;
  html += `<div class="cum-stat"><span class="cum-val">${hiro >= 10 ? hiro.toFixed(0) : hiro.toFixed(1)}x</span><span class="cum-lbl">Hiroshima Equiv.</span></div>`;
  if (totalFallout > 0.01) html += `<div class="cum-stat"><span class="cum-val">${NM.fmtArea(Math.sqrt(totalFallout/Math.PI))}</span><span class="cum-lbl">Fallout Area</span></div>`;
  html += '</div>';
  html += '<div class="cum-zones"><div class="cum-zones-title">Area by Damage Zone</div>';
  for (const z of zoneNames) {
    if (!areas[z] || areas[z] < 0.01) continue;
    html += `<div class="cum-zone-row"><span class="cum-zone-name">${zoneLabels[z]}</span><span class="cum-zone-area">${(areas[z]).toFixed(1)} km²</span></div>`;
  }
  html += '</div>';
  if (totalY > 10) {
    const sootTg = totalY > 50000 ? 150 : totalY > 5000 ? 47 : totalY > 500 ? 15 : 5;
    html += `<div class="cum-nw"><span class="cum-nw-label">Est. Nuclear Winter Soot</span><span class="cum-nw-val">${sootTg} Tg</span></div>`;
  }
  return html;
}

const _panelDefs = [
  {s:'altitude-section', c:'altitude-profile', fn:(d)=>NM.AltitudeProfile.generate(d.effects,d.yieldKt)},
  {s:'zonecas-section', c:'zonecas-content', fn:(d)=>NM.ZoneCasualties.generate(d.effects,d.casualties.density)},
  {s:'destruction-section', c:'destruction-content', fn:(d)=>NM.DestructionStats.generate(d.effects,d.casualties)},
  {s:'emp-section', c:'emp-content', fn:(d)=>NM.EMPDetails.generate(d.effects.emp)},
  {s:'survival-section', c:'survival-content', fn:(d)=>NM.SurvivalCalc.generateHTML(d.effects)},
  {s:'ground-section', c:'ground-content', fn:(d)=>NM.GroundReport.generate(d.effects,d.yieldKt)},
  {s:'cloudcompare-section', c:'cloudcompare-content', fn:(d)=>NM.CloudCompare.generate(d.effects)},
  {s:'guide-section', c:'guide-content', fn:(d)=>NM.EmergencyGuide.generate(d)},
  {s:'seismic-section', c:'seismic-content', fn:(d)=>NM.Seismic.generateHTML(d.yieldKt,d.effects.isSurface)},
  {s:'conventional-section', c:'conventional-content', fn:(d)=>NM.ConventionalCompare.generate(d.yieldKt)},
  {s:'bldgdmg-section', c:'bldgdmg-content', fn:(d)=>NM.BuildingDamage.generate(d.yieldKt)},
  {s:'sizecompare-section', c:'sizecompare-content', fn:(d)=>NM.SizeCompare.generate(d.effects)},
  {s:'escape-section', c:'escape-content', fn:(d)=>NM.EscapeTime.generate(d.effects)},
  {s:'cancer-section', c:'cancer-content', fn:(d)=>{const c=NM.estimateLatentCancer(d.effects,d.casualties.density);return'<div class="zone-table"><div class="zt-row zt-head"><span>Horizon</span><span>Latent Cancer Fatalities</span></div><div class="zt-row"><span>10 years</span><span class="zt-d">'+NM.fmtNum(c.cancers10yr)+'</span></div><div class="zt-row"><span>30 years</span><span class="zt-d">'+NM.fmtNum(c.cancers30yr)+'</span></div><div class="zt-row"><span>Hereditary effects</span><span class="zt-i">'+NM.fmtNum(c.geneticEffects)+'</span></div></div><div class="emp-note">BEIR VII linear no-threshold model: ~5.5% excess cancer mortality per Sv. Exposed population: '+NM.fmtNum(c.exposed)+'. Genetic effects per UNSCEAR.</div>';}},
  {s:'psi-section', c:'psi-result', fn:(d)=>NM.CustomPsi.generateHTML(d.yieldKt)},
  {s:'yieldchart-section', c:'yield-chart', fn:(d)=>NM.YieldChart.generate(d.yieldKt)},
  {s:'weaponinfo-section', c:'weaponinfo-content', fn:(d)=>NM.WeaponInfo.generate(d.weapon), hideIfEmpty:true},
  {s:'raddecay-section', show:(d)=>d.effects.isSurface},
  {s:'dosecalc-section', show:(d)=>d.effects.isSurface},
  {s:'fallout-timelapse', show:(d)=>!!d.effects.fallout},
  {s:'nw-section', c:'nw-result', show:(_d,all)=>all.reduce((s,x)=>s+x.yieldKt,0)>10, fn:(_d,all)=>{const ty=all.reduce((s,x)=>s+x.yieldKt,0);return NM.NuclearWinter.generateHTML(ty,all.length)}},
  {s:'cumulative-section', c:'cumulative-content', show:(_d,all)=>all.length>0, fn:(_d,all)=>_genCumulative(all)},
  {s:'dets-section'}, {s:'cloud-section'}, {s:'timeline-section'}, {s:'crater-section'},
  {s:'shelter-section'}, {s:'nearby-section'},
];

function _updatePanels(det, allDets) {
  for (let i = 0; i < _panelDefs.length; i++) {
    const p = _panelDefs[i];
    if (!p.fn && !p.show) continue;
    const el = $(p.s); if (!el) continue;
    if (p.show && !p.show(det, allDets)) continue;
    if (p.fn) {
      try {
        const html = p.fn(det, allDets);
        if (p.hideIfEmpty && !html) { el.style.display = 'none'; continue; }
        if (p.c) $(p.c).innerHTML = html;
      } catch(e) { continue; }
    }
    el.style.display = '';
  }
}

function _resetAllPanels() {
  for (const p of _panelDefs) { const el = $(p.s); if (el) el.style.display = 'none'; }
  $('legend-items').innerHTML = emptyState('Detonate a weapon to see modeled effect rings.');
  $('info-bar').classList.remove('active');
  syncActionStates();
}

// ---- MAP INIT ----
function initMap() {
  map = L.map('map', {center: [39.83, -98.58], zoom: 5, zoomControl: true, attributionControl: true, zoomSnap: 0.5, preferCanvas: true});
  L.control.scale({position: 'bottomleft', imperial: true, metric: true, maxWidth: 200}).addTo(map);
  NM._map = map; // expose for mushroom3d positioning
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://osm.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19
  });

  // Offline canvas tiles with cache
  const _tileCache = new Map();
  const Offline = L.TileLayer.extend({
    createTile(coords) {
      const key = `${coords.x},${coords.y},${coords.z}`;
      const cached = _tileCache.get(key);
      if (cached) { _tileCache.delete(key); _tileCache.set(key, cached); const clone = document.createElement('canvas'); clone.width = cached.width; clone.height = cached.height; clone.getContext('2d').drawImage(cached, 0, 0); return clone; }
      const c = document.createElement('canvas'), s = this.getTileSize(); c.width = s.x; c.height = s.y;
      const ctx = c.getContext('2d'), z = coords.z;
      ctx.fillStyle = '#11111b'; ctx.fillRect(0, 0, s.x, s.y);
      ctx.strokeStyle = 'rgba(69,71,90,0.25)'; ctx.lineWidth = 0.5;
      const gs = z < 3 ? 30 : z < 6 ? 10 : 5;
      for (let lat = -80; lat <= 80; lat += gs) { const y = (this._l2y(lat, z) - coords.y) * s.y; if (y > -s.y && y < s.y * 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s.x, y); ctx.stroke(); if (z >= 2) { ctx.fillStyle = 'rgba(108,112,134,0.4)'; ctx.font = '8px sans-serif'; ctx.fillText(lat + '\u00B0', 2, y - 1); ctx.fillStyle = 'transparent'; } } }
      for (let lng = -180; lng <= 180; lng += gs) { const x = (this._l2x(lng, z) - coords.x) * s.x; if (x > -s.x && x < s.x * 2) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s.y); ctx.stroke(); } }
      ctx.strokeStyle = 'rgba(137,180,250,0.35)'; ctx.lineWidth = 1; ctx.fillStyle = 'rgba(49,50,68,0.5)';
      for (const sh of Object.values(NM.WORLD)) { ctx.beginPath(); let f = true; for (const [lng, lat] of sh) { const px = (this._l2x(lng, z) - coords.x) * s.x, py = (this._l2y(lat, z) - coords.y) * s.y; f ? (ctx.moveTo(px, py), f = false) : ctx.lineTo(px, py); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
      if (_tileCache.size >= 500) {
        const iter = _tileCache.keys();
        for (let i = 0; i < 100; i++) _tileCache.delete(iter.next().value);
      }
      _tileCache.set(key, c);
      return c;
    },
    _l2y(lat, z) { const n = Math.pow(2, z), r = lat * Math.PI / 180; return n * (1 - (Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI)) / 2; },
    _l2x(lng, z) { return Math.pow(2, z) * ((lng + 180) / 360); }
  });
  const offline = new Offline('', {maxZoom: 12, attribution: 'Offline | NukeMap'});

  let loaded = false;
  dark.on('tileerror', () => { if (!loaded) { loaded = true; map.removeLayer(dark); offline.addTo(map); showBadge(false); } });
  dark.on('tileload', () => { loaded = true; });
  if (!navigator.onLine) { offline.addTo(map); showBadge(false); }
  else { dark.addTo(map); showBadge(true); }
  window.addEventListener('online', () => showBadge(true));
  window.addEventListener('offline', () => showBadge(false));

  map.on('click', e => onMapClick(e.latlng.lat, e.latlng.lng));
  map.on('contextmenu', e => { e.originalEvent.preventDefault(); onMapClick(e.latlng.lat, e.latlng.lng); });
  map.on('mousemove', e => { document.getElementById('coords').textContent = `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`; });
  map.on('moveend zoomend', () => { if (NM.Mushroom3D.active) NM.Mushroom3D.onMapMove(); });
  map.getContainer().classList.add('crosshair');

  // Dismiss loading overlay once first tile loads
  const lo = document.getElementById('loading-overlay');
  if (lo) {
    const dismiss = () => { lo.classList.add('hidden'); setTimeout(() => lo.remove(), 600); };
    dark.once('load', dismiss);
    setTimeout(dismiss, 4000); // fallback
  }

  NM.Heatmap.init(map);
  loadFromURL();
}

function showBadge(on) {
  const b = document.getElementById('offline-badge'), d = b.querySelector('.ob-dot'), l = b.querySelector('.ob-lbl');
  b.classList.add('show'); d.className = 'ob-dot ' + (on ? 'on' : 'off'); l.textContent = on ? 'Online' : 'Offline';
  if (on) setTimeout(() => b.classList.remove('show'), 3000);
}

// ---- MAP CLICK ----
function onMapClick(lat, lng) {
  // Experience mode: analyze click point vs last detonation
  if (NM.Experience.active && currentDets.length) {
    NM.Experience.analyze(map, lat, lng, currentDets[currentDets.length - 1]);
    return;
  }
  // Measurement tool
  if (NM.Measure.active) {
    NM.Measure.addPoint(map, lat, lng);
    return;
  }
  // MIRV mode
  if (mirvMode && currentMirvPreset) {
    NM.MIRV.execute(map, lat, lng, currentMirvPreset, (la, ln, yk) => {
      const origYield = getYield();
      setYield(yk || origYield);
      triggerDetonation(la, ln);
      setYield(origYield);
    });
    return;
  }
  triggerDetonation(lat, lng);
}

// ---- DETONATION ----
function triggerDetonation(lat, lng) {
  const Y = getYield();
  let burst = getBurst();
  const isHEMP = burst === 'hemp';
  const isWater = burst === 'water';
  if (isHEMP) burst = 'airburst';
  const hM = burst === 'custom' ? (+$('burst-height').value || 0) : 0;
  const fission = +$('fission-pct').value || 50;
  const density = NM.estimateDensity(lat, lng);
  const effects = NM.calcEffects(Y, isHEMP ? 'airburst' : (isWater ? 'water' : burst), hM, fission, density);

  // HEMP override: no blast/thermal at ground level, massive EMP
  if (isHEMP) {
    effects.fireball = 0; effects.psi200 = 0; effects.psi20 = 0; effects.psi5 = 0;
    effects.psi3 = 0; effects.psi1 = 0; effects.thermal3 = 0; effects.thermal2 = 0;
    effects.thermal1 = 0; effects.radiation = 0; effects.craterR = 0; effects.craterDepth = 0;
    effects.firestormR = 0; effects.flashBlindDay = 0; effects.flashBlindNight = 0;
    effects.fallout = null;
    effects.emp = Math.min(2200, 40 * Math.pow(Y, 0.25));
    effects.burstHeight = 400000;
    effects.isSurface = false;
  }
  // Water burst: reduced blast/thermal (absorbed by water), no crater
  if (isWater) {
    effects.psi200 *= 0.3; effects.psi20 *= 0.5; effects.psi5 *= 0.6;
    effects.psi3 *= 0.65; effects.psi1 *= 0.7;
    effects.thermal3 *= 0.4; effects.thermal2 *= 0.5; effects.thermal1 *= 0.6;
    effects.craterR = 0; effects.craterDepth = 0;
  }
  const cas = (isHEMP) ? {deaths: 0, injuries: 0, density: 0} : NM.estimateCasualties(lat, lng, effects);

  if (!multiMode) {
    currentDets.forEach(d => d.layers.forEach(l => map.removeLayer(l)));
    currentDets = [];
    NM.Mushroom3D.hide();
  }

  const det = {
    id: Date.now(), lat, lng, yieldKt: Y, burstType: isHEMP ? 'hemp' : (isWater ? 'water' : burst), heightM: hM, fission, effects, casualties: cas, layers: [],
    weapon: $('weapon-select').selectedOptions[0]?.textContent || 'Custom', isHEMP, isWater
  };

  // Draw static effect rings
  const ringLayers = NM.Effects.drawRings(map, det);
  det.layers.push(...ringLayers);

  // Fallout
  if (effects.fallout) {
    const fl = NM.Effects.drawFallout(map, lat, lng, effects.fallout, windAngle);
    if (fl) { fl.addTo(map); det.layers.push(fl); }
  }

  // GZ marker
  const marker = NM.Effects.drawMarker(map, lat, lng).bindPopup(NM.Effects.buildPopup(det)).addTo(map);
  det.layers.push(marker);

  currentDets.push(det);

  // Animations
  NM.Animation.detonateSequence(map, lat, lng, effects, Y);

  // 3D mushroom cloud
  if ($('cloud-toggle')?.checked) {
    setTimeout(() => NM.Mushroom3D.show(det, multiMode), 500);
  }

  // Update all UI panels
  updateDetsList();
  updateLegend(det);
  updateStats();
  updateCloud(det);
  updateTimeline(det);
  updateCrater(det);
  updateShelter(det);

  $('dets-section').style.display = '';

  // Extras: update overlays based on toggle state
  if ($('ringlabels-check').checked) NM.RingLabels.draw(map, det);
  if ($('distrings-check').checked) {
    const maxR = Math.max(effects.psi1, effects.thermal1, effects.emp);
    NM.DistanceRings.draw(map, det.lat, det.lng, maxR);
  }
  if ($('distfromgz-check').checked) NM.DistanceIndicator.start(map, det.lat, det.lng);
  if ($('thermal-check').checked) NM.ThermalOverlay.draw(map, det.lat, det.lng, effects);
  if ($('falloutanim-check').checked && effects.fallout) NM.FalloutParticles.start(map, det.lat, det.lng, effects.fallout, windAngle);
  if ($('radoverlay-check').checked) NM.RadiationOverlay.draw(map, det.lat, det.lng, effects);
  if ($('dmgheatmap-check').checked) NM.DamageHeatmap.draw(map, currentDets);

  // Update all registered analysis panels
  _updatePanels(det, currentDets);
  updateNearbyTargets(det);

  // Casualty counter animation
  NM.CasualtyCounter.animate(cas.deaths, cas.injuries);

  // Shockwave ring
  if ($('shockwave-check')?.checked) NM.ShockwaveRing.draw(map, lat, lng, effects);

  // Fallout contours
  if ($('contours-check')?.checked && effects.fallout) NM.FalloutContours.draw(map, lat, lng, effects.fallout, windAngle);

  // Store last det ref for GPS/Geiger
  NM._lastDet = det;

  // Draggable GZ
  if ($('draggable-check').checked) {
    NM.DraggableGZ.enable(map, det, (newLat, newLng) => {
      removeDet(currentDets.length - 1);
      triggerDetonation(newLat, newLng);
    });
  }

  // Auto-switch to Effects tab after first detonation
  if (currentDets.length === 1) switchTab('effects');

  // Detonation toast
  showDetToast(det);

  // Focus management: move focus to results for screen reader users
  const statsEl = $('stat-deaths');
  if (statsEl) setTimeout(() => statsEl.focus(), 300);

  updateURL();
}

// ---- UI HELPERS ----
function $(id) { return document.getElementById(id); }
function emptyState(text, tone = '') { return `<div class="empty-state${tone ? ' ' + tone : ''}">${NM.esc(text)}</div>`; }
function compactState(text, tone = '') { return `<div class="empty-state compact${tone ? ' ' + tone : ''}">${NM.esc(text)}</div>`; }
function setButtonDisabled(id, disabled) {
  const el = $(id);
  if (!el) return;
  el.disabled = disabled;
  el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
}
function syncActionStates() {
  const hasDets = currentDets.length > 0;
  document.body.classList.toggle('has-results', hasDets);
  ['undo-btn','clear-btn','share-btn','save-btn','export-kml','export-json','export-geojson','export-csv','export-report','export-print','export-png','export-png-hd','export-svg'].forEach(id => setButtonDisabled(id, !hasDets));
  ['flight-us','flight-ru','flight-cn','raddecay-calc','dose-calc'].forEach(id => setButtonDisabled(id, !hasDets));
}
function getYield() { return NM.sliderToYield(+$('yield-slider').value); }
function getBurst() { return document.querySelector('.burst-btn.active')?.dataset.burst || 'airburst'; }

function setYield(kt) {
  $('yield-slider').value = NM.yieldToSlider(kt);
  updateYieldUI(kt);
  syncYieldInput(kt);
}

function updateYieldUI(kt) {
  const v = $('yield-val'), u = $('yield-unit');
  if (kt >= 1000) { v.textContent = (kt / 1000).toFixed(kt >= 10000 ? 0 : 1); u.textContent = 'MT'; }
  else if (kt >= 1) { v.textContent = kt.toFixed(kt >= 100 ? 0 : 1); u.textContent = 'kT'; }
  else { v.textContent = (kt * 1000).toFixed(kt < 0.01 ? 1 : 0); u.textContent = 'tons'; }
}

function syncYieldInput(kt) {
  const yi = $('yield-input'), yu = $('yield-unit-select');
  if (kt >= 1000) { yi.value = (kt / 1000).toFixed(2); yu.value = 'mt'; }
  else if (kt >= 1) { yi.value = kt.toFixed(2); yu.value = 'kt'; }
  else { yi.value = (kt * 1000).toFixed(1); yu.value = 't'; }
}

// ---- CONTROLS INIT ----
function initControls() {
  // Tabs (WAI-ARIA tabs pattern: click + arrow keys)
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelector('.tabs').addEventListener('keydown', e => {
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next >= 0) { e.preventDefault(); tabs[next].focus(); switchTab(tabs[next].dataset.tab); }
  });

  // Weapon select (grouped by country)
  const sel = $('weapon-select');
  const groups = {};
  NM.WEAPONS.forEach((w, i) => { const g = w.country || 'Custom'; if (!groups[g]) groups[g] = []; groups[g].push({...w, idx: i}); });
  for (const [g, ws] of Object.entries(groups)) {
    const og = document.createElement('optgroup'); og.label = g;
    ws.forEach(w => { const o = document.createElement('option'); o.value = w.idx; o.textContent = `${w.name} (${NM.fmtYield(w.yield_kt)})`; o.title = w.desc; og.appendChild(o); });
    sel.appendChild(og);
  }
  sel.addEventListener('change', () => setYield(NM.WEAPONS[sel.value].yield_kt));

  // Weapon filter
  $('weapon-filter').addEventListener('input', () => {
    const q = $('weapon-filter').value.toLowerCase();
    sel.querySelectorAll('option').forEach(o => {
      o.hidden = q && !o.textContent.toLowerCase().includes(q);
    });
    sel.querySelectorAll('optgroup').forEach(g => {
      const visible = [...g.querySelectorAll('option')].some(o => !o.hidden);
      g.hidden = !visible;
    });
  });

  // Yield slider with live preview
  let yieldPreviewRing = null;
  $('yield-slider').addEventListener('input', () => {
    const kt = NM.sliderToYield(+$('yield-slider').value);
    updateYieldUI(kt); syncYieldInput(kt);
    // Show preview circle at map center
    const c = map.getCenter();
    const previewR = (NM.BLAST_MODELS[NM._physicsModel] || NM.BLAST_MODELS.nwfaq).psi5 * Math.pow(kt, 1/3);
    if (yieldPreviewRing) map.removeLayer(yieldPreviewRing);
    yieldPreviewRing = L.circle([c.lat, c.lng], {
      radius: previewR * 1000, color: '#cba6f7', weight: 1.5, opacity: 0.4,
      fill: false, dashArray: '6 6', className: 'yield-preview-ring', interactive: false
    }).addTo(map);
  });
  $('yield-slider').addEventListener('change', () => {
    if (yieldPreviewRing) { map.removeLayer(yieldPreviewRing); yieldPreviewRing = null; }
  });

  // Direct yield input
  const syncFromInput = () => {
    let kt = +$('yield-input').value;
    if (!isFinite(kt) || kt <= 0) { kt = 0.001; $('yield-input').value = kt; }
    if ($('yield-unit-select').value === 'mt') kt *= 1000;
    else if ($('yield-unit-select').value === 't') kt /= 1000;
    kt = Math.max(0.001, Math.min(100000, kt));
    $('yield-slider').value = NM.yieldToSlider(kt);
    updateYieldUI(kt);
    syncYieldInput(kt);
  };
  $('yield-input').addEventListener('change', syncFromInput);
  $('yield-unit-select').addEventListener('change', syncFromInput);

  updateYieldUI(NM.sliderToYield(+$('yield-slider').value));
  syncYieldInput(NM.sliderToYield(+$('yield-slider').value));

  // Burst buttons
  document.querySelectorAll('.burst-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.burst-btn').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
    b.classList.add('active'); b.setAttribute('aria-checked', 'true');
    $('height-row').style.display = b.dataset.burst === 'custom' ? '' : 'none';
    $('wind-wrap').style.display = (b.dataset.burst === 'surface' || b.dataset.burst === 'water') ? '' : 'none';
    $('hemp-info').style.display = b.dataset.burst === 'hemp' ? '' : 'none';
    $('water-info').style.display = b.dataset.burst === 'water' ? '' : 'none';
  }));

  // Detonate / Undo / Clear / Share
  $('detonate-btn').addEventListener('click', () => { const c = map.getCenter(); onMapClick(c.lat, c.lng); });
  $('undo-btn').addEventListener('click', () => { if (currentDets.length) removeDet(currentDets.length - 1); });
  $('clear-btn').addEventListener('click', clearAll);
  $('share-btn').addEventListener('click', showShareLink);
  $('share-copy').addEventListener('click', copyShareLink);
  $('share-text').addEventListener('click', () => {
    const text = getShareText();
    if (text) { navigator.clipboard?.writeText(text); $('share-text').textContent = 'Copied!'; setTimeout(() => $('share-text').textContent = 'Copy Summary', 2000); }
  });
  $('share-native').addEventListener('click', async () => {
    const text = getShareText();
    await shareOrCopy({title: 'NukeMap Simulation', text, url: location.href}, text, $('share-native'), 'Share Native');
  });

  // Multi-detonation toggle
  $('multi-check').addEventListener('change', () => { multiMode = $('multi-check').checked; });

  // Sound toggle
  $('sound-check').addEventListener('change', () => { NM.Sound.enabled = $('sound-check').checked; });

  // Cloud toggle
  $('cloud-toggle').addEventListener('change', () => {
    if ($('cloud-toggle').checked && currentDets.length) NM.Mushroom3D.show(currentDets[currentDets.length - 1]);
    else NM.Mushroom3D.hide();
  });

  // Heatmap toggle
  $('heatmap-check').addEventListener('change', () => {
    const on = NM.Heatmap.toggle(map);
    $('heatmap-label').textContent = on ? 'Population heatmap ON' : 'Population heatmap';
  });

  // Panel toggle
  $('panel-toggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));

  // Coords click-to-copy
  $('coords').addEventListener('click', () => {
    const t = $('coords').textContent;
    if (t && t !== '--') { navigator.clipboard?.writeText(t); $('coords').classList.add('copied'); setTimeout(() => $('coords').classList.remove('copied'), 1200); }
  });

  // Fullscreen
  if ($('fullscreen-btn')) $('fullscreen-btn').addEventListener('click', toggleFullscreen);

  // MIRV controls
  initMIRV();

  // Compare
  initCompare();

  // Wind compass
  initWindCompass();

  // Quick targets, presets, historical
  initQuickTargets();
  initPresets();
  initHistorical();
  initSearch();

  // ---- EXTRAS ----
  NM.DistanceIndicator.init();
  NM.LayerSwitcher.init(map);

  // Layer switcher buttons (panel)
  document.querySelectorAll('#layer-switcher .layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      NM.LayerSwitcher.switchTo(btn.dataset.layer);
    });
  });

  // Floating map switcher
  $('ms-toggle').addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = $('ms-panel').classList.contains('open');
    $('ms-toggle').classList.toggle('open', !isOpen);
    $('ms-panel').classList.toggle('open', !isOpen);
  });
  $('ms-panel').addEventListener('click', e => e.stopPropagation());
  document.querySelectorAll('.ms-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      NM.LayerSwitcher.switchTo(btn.dataset.layer);
      $('ms-toggle').classList.remove('open');
      $('ms-panel').classList.remove('open');
    });
  });
  document.addEventListener('click', () => {
    $('ms-toggle').classList.remove('open');
    $('ms-panel').classList.remove('open');
  });

  // Ring labels toggle
  $('ringlabels-check').addEventListener('change', () => {
    if ($('ringlabels-check').checked && currentDets.length) NM.RingLabels.draw(map, currentDets[currentDets.length - 1]);
    else NM.RingLabels.clear(map);
  });

  // Distance reference rings toggle
  $('distrings-check').addEventListener('change', () => {
    if ($('distrings-check').checked && currentDets.length) {
      const det = currentDets[currentDets.length - 1];
      const maxR = Math.max(det.effects.psi1, det.effects.thermal1, det.effects.emp);
      NM.DistanceRings.draw(map, det.lat, det.lng, maxR);
    } else NM.DistanceRings.clear(map);
  });

  // Distance from GZ toggle
  $('distfromgz-check').addEventListener('change', () => {
    if ($('distfromgz-check').checked && currentDets.length) {
      const det = currentDets[currentDets.length - 1];
      NM.DistanceIndicator.start(map, det.lat, det.lng);
    } else NM.DistanceIndicator.stop(map);
  });

  // Thermal flash gradient toggle
  $('thermal-check').addEventListener('change', () => {
    if ($('thermal-check').checked && currentDets.length) {
      const det = currentDets[currentDets.length - 1];
      NM.ThermalOverlay.draw(map, det.lat, det.lng, det.effects);
    } else NM.ThermalOverlay.clear(map);
  });

  // Fallout particle animation toggle
  $('falloutanim-check').addEventListener('change', () => {
    if ($('falloutanim-check').checked && currentDets.length) {
      const det = currentDets[currentDets.length - 1];
      if (det.effects.fallout) NM.FalloutParticles.start(map, det.lat, det.lng, det.effects.fallout, windAngle);
    } else NM.FalloutParticles.stop(map);
  });

  // Screenshot mode
  $('screenshot-check').addEventListener('change', () => NM.Screenshot.toggle());
  $('screenshot-hint').addEventListener('click', () => { $('screenshot-check').checked = false; NM.Screenshot.toggle(); });

  // Radiation decay calculator
  $('raddecay-calc').addEventListener('click', () => {
    if (!currentDets.length) return;
    const det = currentDets[currentDets.length - 1];
    const dist = +$('raddecay-dist').value || 10;
    $('raddecay-result').innerHTML = NM.RadDecay.generateHTML(det.yieldKt, det.fission, dist);
  });

  // ---- ADVANCED FEATURES ----

  // Experience mode toggle
  $('experience-check').addEventListener('change', () => {
    const on = NM.Experience.toggle(map);
    if (!on) map.getContainer().classList.add('crosshair');
  });

  // Measurement tool
  $('measure-toggle').addEventListener('click', () => {
    const on = NM.Measure.toggle(map);
    $('measure-toggle').textContent = on ? 'Disable Ruler' : 'Enable Ruler';
    if (on) map.getContainer().style.cursor = 'crosshair';
    else { map.getContainer().style.cursor = ''; map.getContainer().classList.add('crosshair'); }
  });
  $('measure-clear').addEventListener('click', () => NM.Measure.clear(map));

  // Attack scenarios
  const scenList = $('scenario-list');
  NM.Scenarios.forEach(sc => {
    const div = document.createElement('div');
    div.className = 'scenario-chip';
    div.innerHTML = `<div class="sc-name">${NM.esc(sc.name)}</div><div class="sc-desc">${NM.esc(sc.desc)} (${sc.dets.length} warheads)</div>`;
    div.addEventListener('click', () => {
      clearAll();
      multiMode = true; $('multi-check').checked = true;
      // Zoom to first target
      map.flyTo([sc.dets[0].lat, sc.dets[0].lng], sc.dets.length > 2 ? 6 : 9, {duration: 1});
      setTimeout(() => {
        sc.dets.forEach((d, i) => {
          setTimeout(() => {
            setYield(d.yield_kt);
            document.querySelectorAll('.burst-btn').forEach(b => b.classList.toggle('active', b.dataset.burst === d.burst));
            $('wind-wrap').style.display = d.burst === 'surface' ? '' : 'none';
            triggerDetonation(d.lat, d.lng);
          }, i * 600);
        });
      }, 1200);
    });
    scenList.appendChild(div);
  });

  // Missile flight time
  const launchSites = {
    us: {lat: 41.145, lng: -104.862, name: 'F.E. Warren AFB'},
    ru: {lat: 62.5, lng: 40.3, name: 'Plesetsk Cosmodrome'},
    cn: {lat: 28.2, lng: 102.0, name: 'Xichang (est.)'},
  };
  ['us', 'ru', 'cn'].forEach(key => {
    $('flight-' + key).addEventListener('click', () => {
      if (!currentDets.length) { $('flight-result').innerHTML = compactState('Detonate first to set a target.'); return; }
      const det = currentDets[currentDets.length - 1];
      const site = launchSites[key];
      const type = $('missile-type').value;
      const result = NM.MissileFlight.calculate(site.lat, site.lng, det.lat, det.lng, type);
      $('flight-result').innerHTML = `<div style="font-size:10px;color:var(--overlay0);margin-bottom:4px">From ${site.name}</div>` + NM.MissileFlight.generateHTML(result);
    });
  });

  // Draggable GZ toggle
  $('draggable-check').addEventListener('change', () => {
    if ($('draggable-check').checked && currentDets.length) {
      const det = currentDets[currentDets.length - 1];
      NM.DraggableGZ.enable(map, det, (newLat, newLng) => {
        removeDet(currentDets.length - 1);
        triggerDetonation(newLat, newLng);
      });
    } else NM.DraggableGZ.disable(map);
  });

  // Export PNG + KML + JSON + Report
  $('export-png').addEventListener('click', () => NM.ExportPNG.capture());
  $('export-png-hd').addEventListener('click', () => NM.ExportPNG.capture(true));
  $('export-svg').addEventListener('click', () => NM.ExportPNG.exportSVG());
  $('export-kml').addEventListener('click', () => { if (currentDets.length) NM.KMLExport.download(currentDets); });
  $('export-json').addEventListener('click', () => { if (currentDets.length) exportJSON(); });
  if ($('export-geojson')) $('export-geojson').addEventListener('click', () => { if (currentDets.length) exportGeoJSON(); });
  $('export-report').addEventListener('click', () => { if (currentDets.length) exportReport(); });
  $('export-csv').addEventListener('click', () => { if (currentDets.length) exportCSV(); });
  $('export-print').addEventListener('click', () => { if (currentDets.length) exportPrintReport(); });
  $('import-csv').addEventListener('change', (e) => { if (e.target.files[0]) { importCSV(e.target.files[0]); e.target.value = ''; } });
  $('csv-import-status')?.addEventListener('click', e => {
    if (e.target.id === 'csv-import-run' && pendingCSVImport) runCSVImport();
    if (e.target.id === 'csv-import-cancel') resetCSVImportStatus();
  });

  // GPS check
  $('gps-check').addEventListener('click', () => NM.GPSSafe.check(map));

  // Geiger counter
  $('geiger-check').addEventListener('change', () => {
    if ($('geiger-check').checked) NM.Geiger.start(map);
    else NM.Geiger.stop(map);
  });

  // Shockwave (on by default, handled in triggerDetonation)

  // Fallout contours
  $('contours-check').addEventListener('change', () => {
    if ($('contours-check').checked && NM._lastDet?.effects.fallout) {
      NM.FalloutContours.draw(map, NM._lastDet.lat, NM._lastDet.lng, NM._lastDet.effects.fallout, windAngle);
    } else NM.FalloutContours.clear(map);
  });

  // Radiation overlay
  $('radoverlay-check').addEventListener('change', () => {
    if ($('radoverlay-check').checked && currentDets.length) {
      const det = currentDets[currentDets.length - 1];
      NM.RadiationOverlay.draw(map, det.lat, det.lng, det.effects);
    } else NM.RadiationOverlay.clear(map);
  });

  // Damage heatmap
  $('dmgheatmap-check').addEventListener('change', () => {
    if ($('dmgheatmap-check').checked && currentDets.length) NM.DamageHeatmap.draw(map, currentDets);
    else NM.DamageHeatmap.clear(map);
  });

  // Test timeline
  $('test-timeline-btn').addEventListener('click', () => NM.TestTimeline.play(map));
  $('test-timeline-stop').addEventListener('click', () => NM.TestTimeline.stop(map));

  // Blast wave arrival indicator
  $('blastwaveinfo-check').addEventListener('change', () => {
    if ($('blastwaveinfo-check').checked && currentDets.length) NM.BlastArrival.start(map);
    else NM.BlastArrival.stop(map);
  });

  // Fallout time-lapse
  $('ft-slider').addEventListener('input', () => {
    const hr = +$('ft-slider').value;
    $('ft-label').textContent = hr < 24 ? hr + ' hr' : (hr / 24).toFixed(1) + ' d';
    $('ft-info').textContent = `Fallout extent at ${hr} hour${hr > 1 ? 's' : ''} after detonation`;
    if (NM._lastDet?.effects.fallout) {
      NM.FalloutTimelapse.draw(map, NM._lastDet.lat, NM._lastDet.lng, NM._lastDet.effects.fallout, windAngle, hr);
    }
  });
  $('ft-play').addEventListener('click', () => {
    if (!NM._lastDet?.effects.fallout) return;
    NM.FalloutTimelapse.playAnimation(map, NM._lastDet.lat, NM._lastDet.lng, NM._lastDet.effects.fallout, windAngle, (hr) => {
      $('ft-slider').value = Math.min(48, Math.round(hr));
      $('ft-label').textContent = hr < 24 ? Math.round(hr) + ' hr' : (hr / 24).toFixed(1) + ' d';
      $('ft-info').textContent = `Fallout extent at ${Math.round(hr)} hours after detonation`;
    });
  });

  // Night mode toggle
  $('night-check').addEventListener('change', () => {
    NM._nightMode = $('night-check').checked;
    $('night-label').textContent = NM._nightMode ? 'Night mode ON (flash blindness 20x)' : 'Night mode (flash blindness)';
    if (currentDets.length) { updateLegend(currentDets[currentDets.length - 1]); }
  });

  // High contrast theme (WCAG AAA)
  const hcCheck = $('hc-check');
  if (localStorage.getItem('nukemap-hc') === '1') { hcCheck.checked = true; document.documentElement.classList.add('high-contrast'); }
  hcCheck.addEventListener('change', () => {
    document.documentElement.classList.toggle('high-contrast', hcCheck.checked);
    localStorage.setItem('nukemap-hc', hcCheck.checked ? '1' : '0');
  });

  // Educator mode: suppress animations/sound, show citations in tooltips
  NM._educatorMode = false;
  const eduCheck = $('educator-check');
  if (localStorage.getItem('nukemap-edu') === '1') { eduCheck.checked = true; NM._educatorMode = true; NM.Sound.enabled = false; }
  eduCheck.addEventListener('change', () => {
    NM._educatorMode = eduCheck.checked;
    NM.Sound.enabled = !eduCheck.checked;
    NM.Animation._reducedMotion = eduCheck.checked || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    localStorage.setItem('nukemap-edu', eduCheck.checked ? '1' : '0');
  });

  // Dose calculator
  $('dose-calc').addEventListener('click', () => {
    if (!currentDets.length) return;
    const det = currentDets[currentDets.length - 1];
    if (!det.effects.isSurface) { $('dose-result').innerHTML = compactState('Dose calculator requires a surface burst with fallout.', 'warn'); return; }
    const dist = +$('dose-dist').value || 5;
    const arrive = +$('dose-arrive').value || 1;
    const stay = +$('dose-stay').value || 4;
    $('dose-result').innerHTML = NM.DoseCalc.generateHTML(det.yieldKt, det.fission, dist, arrive, stay);
  });

  // Test database
  $('testdb-check').addEventListener('change', () => NM.TestDB.toggle(map));

  // WW3 Simulation
  const ww3Sel = $('ww3-scenario');
  NM.WW3_SCENARIOS.forEach(s => {
    const o = document.createElement('option'); o.value = s.id;
    o.textContent = s.name + ' (' + NM.WW3.countWarheads(s.id) + ' warheads)';
    ww3Sel.appendChild(o);
  });
  ww3Sel.addEventListener('change', () => {
    const s = NM.WW3_SCENARIOS.find(sc => sc.id === ww3Sel.value);
    $('ww3-scenario-desc').textContent = s ? s.desc : '';
    setButtonDisabled('ww3-launch', !ww3Sel.value);
  });
  setButtonDisabled('ww3-launch', !ww3Sel.value);
  $('ww3-launch').addEventListener('click', () => {
    if (!ww3Sel.value) return;
    clearAll();
    NM.WW3.start(map, ww3Sel.value);
    $('ww3-pause').style.display = '';
    $('ww3-pause').textContent = 'Pause';
  });
  $('ww3-stop').addEventListener('click', () => { NM.WW3.stop(map); $('ww3-pause').style.display = 'none'; });
  $('ww3-pause').addEventListener('click', () => {
    if (!NM.WW3.active) return;
    NM.WW3.paused = !NM.WW3.paused;
    $('ww3-pause').textContent = NM.WW3.paused ? 'Resume' : 'Pause';
  });

  // Collapsible sections in Effects/Encyclopedia tabs
  const alwaysOpen = new Set(['legend-section','cloud-section','timeline-section','shelter-section']);
  document.querySelectorAll('#tab-effects .section, #tab-encyclopedia .section').forEach(sec => {
    const title = sec.querySelector('.section-title');
    if (!title) return;
    title.classList.add('collapsible');
    title.setAttribute('role', 'button');
    title.tabIndex = 0;
    const toggleSection = () => {
      title.classList.toggle('collapsed');
      sec.classList.toggle('sec-collapsed');
      title.setAttribute('aria-expanded', String(!sec.classList.contains('sec-collapsed')));
    };
    title.addEventListener('click', toggleSection);
    title.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggleSection();
    });
    // Auto-collapse secondary sections
    if (!alwaysOpen.has(sec.id)) {
      title.classList.add('collapsed');
      sec.classList.add('sec-collapsed');
    }
    title.setAttribute('aria-expanded', String(!sec.classList.contains('sec-collapsed')));
  });

  // WW3 quick-launch button
  $('ww3-quick-btn').addEventListener('click', () => {
    switchTab('tools');
    // Scroll WW3 section into view
    const ww3Sec = $('ww3-scenario')?.closest('.section');
    if (ww3Sec) ww3Sec.scrollIntoView({behavior: 'smooth', block: 'start'});
    // If panel is collapsed, open it
    $('panel').classList.remove('collapsed');
  });

  // Quick weapon bar
  document.querySelectorAll('.qw-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const kt = +chip.dataset.kt;
      setYield(kt);
      const i = NM.WEAPONS.findIndex(w => Math.abs(w.yield_kt - kt) < 0.01);
      if (i >= 0) $('weapon-select').value = i;
      document.querySelectorAll('.qw-chip').forEach(c => c.classList.remove('qw-active'));
      chip.classList.add('qw-active');
    });
  });

  // Save/Load scenarios
  $('save-btn').addEventListener('click', () => {
    if (!currentDets.length) return;
    const name = $('save-name').value.trim() || `Scenario ${new Date().toLocaleDateString()}`;
    const folder = $('save-folder') ? $('save-folder').value.trim() : '';
    _scenarioDB.add({
      name, folder, date: Date.now(),
      dets: currentDets.map(d => ({lat:d.lat,lng:d.lng,yieldKt:d.yieldKt,burstType:d.burstType,weapon:d.weapon}))
    }).then(() => { $('save-name').value = ''; renderSavedList(); })
    .catch(() => { $('saved-list').innerHTML = compactState('Storage is full. Delete saved scenarios or clear browser data.', 'warn'); });
  });
  renderSavedList();
  if ($('save-search')) $('save-search').addEventListener('input', () => renderSavedList($('save-search').value));
  initEncyclopedia();
  initHistoricTests();
  initMethodology();

  // D-pad pan controls (WCAG 2.5.7)
  document.querySelectorAll('.dpad-btn').forEach(btn => {
    const panAmount = 100;
    const dirs = {up:[0,-panAmount], down:[0,panAmount], left:[-panAmount,0], right:[panAmount,0]};
    btn.addEventListener('click', () => { const d = dirs[btn.dataset.dir]; if (d) map.panBy(d, {animate: true}); });
  });

  // Physics model selector
  const modelSel = $('physics-model');
  const modelHints = {
    nwfaq: 'Mach stem enhancement at optimal burst height. Validated against HSAJ 10kT.',
    freeair: 'Free-air blast without Mach stem. ~17% smaller blast radii. G&D Ch.3.',
    soviet: 'Soviet military coefficients (HeWu). ~7% larger blast radii than NWFAQ.',
  };
  if (modelSel) modelSel.addEventListener('change', () => {
    NM._physicsModel = modelSel.value;
    $('model-hint').textContent = modelHints[modelSel.value] || '';
  });

  // Rotating facts banner
  let factIdx = Math.floor(Math.random() * NM.Facts.length);
  function showFact() {
    const banner = $('fact-banner');
    $('fact-text').textContent = NM.Facts[factIdx % NM.Facts.length];
    banner.classList.add('show');
    factIdx++;
    setTimeout(() => banner.classList.remove('show'), 12000);
  }
  showFact();
  setInterval(showFact, 30000);
  $('fact-banner').addEventListener('click', () => { $('fact-banner').classList.remove('show'); showFact(); });
  syncActionStates();
}

function switchTab(id) {
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.tab === id;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
    t.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    const active = c.id === 'tab-' + id;
    c.classList.toggle('active', active);
    c.hidden = !active;
  });
}

// ---- MIRV ----
function initMIRV() {
  const grid = $('mirv-grid');
  NM.MIRV_PRESETS.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'preset-chip';
    chip.innerHTML = `${NM.esc(p.name)}<span class="chip-yield">${p.warheads}x ${NM.fmtYield(p.yield_kt)}</span>`;
    chip.addEventListener('click', () => {
      document.querySelectorAll('#mirv-grid .preset-chip').forEach(c => c.classList.remove('mirv-active'));
      if (currentMirvPreset === p) {
        mirvMode = false; currentMirvPreset = null;
        $('mirv-status').textContent = 'Select a MIRV preset, then click the map';
        NM.MIRV.clearPreview(map);
      } else {
        mirvMode = true; currentMirvPreset = p;
        chip.classList.add('mirv-active');
        $('mirv-status').textContent = `${p.name} armed. Click map to deploy ${p.warheads} warheads.`;
        multiMode = true; $('multi-check').checked = true;
        setYield(p.yield_kt);
      }
    });
    grid.appendChild(chip);
  });
}

// ---- COMPARE ----
function initCompare() {
  const selA = $('compare-a'), selB = $('compare-b');
  NM.WEAPONS.forEach((w, i) => {
    if (!w.country) return;
    const oA = document.createElement('option'); oA.value = i; oA.textContent = w.name + ' (' + NM.fmtYield(w.yield_kt) + ')';
    const oB = oA.cloneNode(true);
    selA.appendChild(oA); selB.appendChild(oB);
  });
  selA.value = 3; selB.value = 22; // Little Boy vs Tsar Bomba default

  const doCompare = () => {
    const wA = NM.WEAPONS[selA.value], wB = NM.WEAPONS[selB.value];
    if (!wA || !wB) return;
    $('compare-result').innerHTML = NM.Compare.generateTable(wA, wB);
    // Draw overlay at current map center
    const c = map.getCenter();
    NM.Compare.drawOverlay(map, c.lat, c.lng, wA, wB);
  };
  $('compare-go').addEventListener('click', doCompare);
  $('compare-clear').addEventListener('click', () => { NM.Compare.clearOverlay(map); $('compare-result').innerHTML = ''; });
}

// ---- WIND ----
function initWindCompass() {
  const comp = $('wind-compass'), arr = $('wind-arrow'), lbl = $('wind-dir-label');
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function upd() { arr.style.transform = `rotate(${windAngle}deg)`; lbl.textContent = `From ${dirs[Math.round(windAngle / 45) % 8]} (${Math.round(windAngle)}\u00B0)`; }
  comp.addEventListener('click', e => { const r = comp.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; windAngle = (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180 / Math.PI + 360) % 360; upd(); });
  upd();

  // Real wind from Open-Meteo (free, no auth, 10K calls/day) with debounce + cache
  let _windCache = null, _windCacheTime = 0, _windDebounce = 0;
  $('realwind-check').addEventListener('change', () => {
    if (!$('realwind-check').checked) { $('realwind-label').textContent = 'Use real wind (Open-Meteo)'; return; }
    const now = Date.now();
    if (now - _windDebounce < 5000) { $('realwind-label').textContent = 'Please wait...'; return; }
    _windDebounce = now;
    const center = map.getCenter();
    if (_windCache && now - _windCacheTime < 300000 && NM.haversine(_windCache.lat, _windCache.lng, center.lat, center.lng) < 10) {
      windAngle = _windCache.dir; $('wind-speed').value = Math.round(_windCache.spd); upd();
      $('realwind-label').textContent = `Real wind: ${Math.round(_windCache.spd)} km/h from ${dirs[Math.round(windAngle / 45) % 8]} (cached)`;
      return;
    }
    $('realwind-label').textContent = 'Fetching wind...';
    const _windAbort = new AbortController();
    setTimeout(() => _windAbort.abort(), 8000);
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}&current=wind_speed_10m,wind_direction_10m`, {signal: _windAbort.signal})
      .then(r => r.json())
      .then(data => {
        if (data.current) {
          windAngle = data.current.wind_direction_10m;
          const speed = data.current.wind_speed_10m;
          _windCache = {lat: center.lat, lng: center.lng, dir: windAngle, spd: speed};
          _windCacheTime = Date.now();
          $('wind-speed').value = Math.round(speed);
          upd();
          $('realwind-label').textContent = `Real wind: ${Math.round(speed)} km/h from ${dirs[Math.round(windAngle / 45) % 8]}`;
        }
      })
      .catch(() => {
        $('realwind-check').checked = false;
        $('realwind-label').textContent = 'Wind fetch failed (offline?)';
        setTimeout(() => { $('realwind-label').textContent = 'Use real wind (Open-Meteo)'; }, 3000);
      });
  });
}

// ---- QUICK TARGETS / PRESETS / HISTORICAL ----
function initQuickTargets() {
  const c = $('target-pills');
  NM.QUICK_TARGETS.forEach(t => {
    const p = document.createElement('div'); p.className = 'target-pill'; p.textContent = t.name;
    p.addEventListener('click', () => map.flyTo([t.lat, t.lng], 12, {duration: 1}));
    c.appendChild(p);
  });
}

function initPresets() {
  const g = $('preset-grid');
  [{name: 'Davy Crockett', y: 0.02}, {name: 'Hiroshima', y: 15}, {name: 'W76-1', y: 100}, {name: 'W88', y: 455}, {name: 'B83', y: 1200}, {name: 'Castle Bravo', y: 15000}, {name: 'Tsar Bomba', y: 50000}, {name: '100 MT', y: 100000}].forEach(p => {
    const ch = document.createElement('div'); ch.className = 'preset-chip';
    ch.innerHTML = `${NM.esc(p.name)}<span class="chip-yield">${NM.fmtYield(p.y)}</span>`;
    ch.addEventListener('click', () => { setYield(p.y); const i = NM.WEAPONS.findIndex(w => Math.abs(w.yield_kt - p.y) < 0.01); if (i >= 0) $('weapon-select').value = i; });
    g.appendChild(ch);
  });
}

function initHistorical() {
  const g = $('historical-grid');
  NM.HISTORICAL.forEach(h => {
    const ch = document.createElement('div'); ch.className = 'preset-chip';
    ch.innerHTML = `${NM.esc(h.name)}<span class="chip-yield">${h.year} \u2014 ${NM.fmtYield(h.yield_kt)}</span>`;
    ch.addEventListener('click', () => {
      setYield(h.yield_kt);
      document.querySelectorAll('.burst-btn').forEach(b => b.classList.toggle('active', b.dataset.burst === h.burst));
      $('height-row').style.display = h.burst === 'custom' ? '' : 'none';
      $('wind-wrap').style.display = h.burst === 'surface' ? '' : 'none';
      if (h.height) $('burst-height').value = h.height;
      map.flyTo([h.lat, h.lng], h.yield_kt > 5000 ? 8 : 11, {duration: 1.2});
      setTimeout(() => triggerDetonation(h.lat, h.lng), 1300);
    });
    g.appendChild(ch);
  });
}

function initSearch() {
  const inp = $('search'), res = $('search-results'); let si = -1;
  inp.addEventListener('input', () => {
    const items = NM.searchLocations(inp.value); si = -1;
    if (!items.length) { res.classList.remove('active'); return; }
    res.innerHTML = items.map((it, i) => `<div class="sr-item" data-idx="${i}" role="option"><div><div class="sr-name">${it.isTarget ? '<span class="sr-target-mark">&#9733;</span>' : ''}${NM.esc(it.name)}</div><div class="sr-detail">${NM.esc(it.detail)}</div></div>${it.pop ? `<div class="sr-pop">${NM.fmtNum(it.pop)}</div>` : ''}</div>`).join('');
    res.classList.add('active');
    res.querySelectorAll('.sr-item').forEach(el => el.addEventListener('click', () => { const it = items[+el.dataset.idx]; selectResult(it); }));
  });
  inp.addEventListener('keydown', e => { const items = res.querySelectorAll('.sr-item'); if (!items.length) return; if (e.key === 'ArrowDown') { e.preventDefault(); si = Math.min(si + 1, items.length - 1); items.forEach((el, i) => el.classList.toggle('selected', i === si)); } else if (e.key === 'ArrowUp') { e.preventDefault(); si = Math.max(si - 1, 0); items.forEach((el, i) => el.classList.toggle('selected', i === si)); } else if (e.key === 'Enter') { e.preventDefault(); (si >= 0 ? items[si] : items[0])?.click(); } });
  inp.addEventListener('blur', () => setTimeout(() => res.classList.remove('active'), 200));
  inp.addEventListener('focus', () => { if (inp.value.trim()) inp.dispatchEvent(new Event('input')); });
}

function selectResult(it) {
  $('search').value = it.name + (it.detail ? ', ' + it.detail : '');
  $('search-results').classList.remove('active');
  map.flyTo([it.lat, it.lng], it.pop > 1e6 ? 11 : it.pop > 1e5 ? 12 : 10, {duration: 1});
}

// ---- UPDATE UI PANELS ----
function updateDetsList() {
  const list = $('dets-list'); list.innerHTML = '';
  currentDets.forEach((d, i) => {
    const nc = NM.findNearestCity(d.lat, d.lng);
    const nm = nc && nc.dist < 50 ? nc.name : `${d.lat.toFixed(2)}, ${d.lng.toFixed(2)}`;
    const el = document.createElement('div'); el.className = 'det-item';
    const wShort = d.weapon ? d.weapon.split('(')[0].trim() : '';
    el.innerHTML = `<span class="det-idx">${i + 1}</span><div class="det-info"><span class="det-name">${NM.esc(nm)}</span><span class="det-weapon">${NM.esc(wShort)}</span></div>${d.isHEMP ? '<span class="det-badge">HEMP</span>' : ''}${d.isWater ? '<span class="det-badge water">WATER</span>' : ''}<span class="det-yield">${NM.fmtYield(d.yieldKt)}</span><button class="det-remove" data-i="${i}" aria-label="Remove detonation">&times;</button>`;
    el.querySelector('.det-remove').addEventListener('click', e => { e.stopPropagation(); removeDet(i); });
    el.addEventListener('click', e => { if (!e.target.classList.contains('det-remove')) map.flyTo([d.lat, d.lng], map.getZoom(), {duration: 0.6}); });
    list.appendChild(el);
  });
}

function updateLegend(det) {
  const c = $('legend-items'); c.innerHTML = '';
  const e = det.effects;
  const flashR = NM._nightMode ? e.flashBlindNight : e.flashBlindDay;
  const items = [
    {id: 'fireball', r: e.fireball, color: '#f5e0dc'}, {id: 'radiation', r: e.radiation, color: '#a6e3a1'},
    {id: 'psi200', r: e.psi200, color: '#89dceb'}, {id: 'psi20', r: e.psi20, color: '#89b4fa'},
    {id: 'firestorm', r: e.firestormR, color: '#e64553'},
    {id: 'psi5', r: e.psi5, color: '#cba6f7'}, {id: 'thermal3', r: e.thermal3, color: '#fab387'},
    {id: 'psi1', r: e.psi1, color: '#f9e2af'}, {id: 'thermal1', r: e.thermal1, color: '#f5c2e7'},
    {id: 'emp', r: e.emp, color: '#94e2d5'},
    {id: 'flashblind', r: flashR, color: '#b4befe'},
  ];
  if (e.craterR > 0) items.unshift({id: 'crater', r: e.craterR, color: '#585b70'});

  items.forEach(it => {
    if (it.r < 0.0005) return;
    const def = NM.EFFECTS_DEF.find(d => d.id === it.id); if (!def) return;
    const div = document.createElement('div'); div.className = 'legend-item';
    const popEst = Math.round(Math.PI * it.r * it.r * (det.casualties.density || 40));
    div.innerHTML = `<div class="legend-dot" style="background:${it.color}"></div><div class="legend-label">${def.label}<span class="legend-desc">${def.desc.split('.')[0]}</span><span class="legend-pop">~${NM.fmtNum(popEst)} people in zone</span></div><div class="legend-value">${NM.fmtR(it.r)}<span class="legend-area">${NM.fmtArea(it.r)}</span></div><button class="legend-eye on" data-eid="${it.id}">&#10003;</button>`;
    div.querySelector('.legend-eye').addEventListener('click', ev => {
      const btn = ev.currentTarget; btn.classList.toggle('on');
      div.classList.toggle('dimmed', !btn.classList.contains('on'));
      toggleEffect(it.id, btn.classList.contains('on'));
    });
    c.appendChild(div);
  });
}

function updateCloud(det) {
  $('cloud-section').style.display = '';
  $('cloud-panel').innerHTML = [
    ['Cloud top altitude', NM.fmtDist(det.effects.cloudTopH)],
    ['Cloud cap radius', NM.fmtDist(det.effects.cloudTopR)],
    ['Stem radius', NM.fmtDist(det.effects.stemR)],
    ['Burst height', det.effects.isSurface ? 'Surface (0 m)' : Math.round(det.effects.burstHeight) + ' m'],
    ['Fireball max radius', NM.fmtDist(det.effects.fireball)],
  ].map(([l, v]) => `<div class="cloud-row"><span class="cl">${l}</span><span class="cv">${v}</span></div>`).join('');
}

function updateTimeline(det) {
  $('timeline-section').style.display = '';
  const items = NM.calcTimeline(det.yieldKt, det.effects);
  $('timeline').innerHTML = items.map(it => `<div class="tl-item"><span class="tl-time">${it.time}</span><span class="tl-desc">${it.desc}</span></div>`).join('');
}

function updateCrater(det) {
  const e = det.effects;
  if (e.craterR <= 0) { $('crater-section').style.display = 'none'; return; }
  $('crater-section').style.display = '';
  const stats = [
    ['Crater radius', NM.fmtDist(e.craterR)], ['Crater depth', NM.fmtDist(e.craterDepth)],
    ['Lip height', '~' + NM.fmtR(e.craterDepth * 0.5)], ['Ejecta radius', '~' + NM.fmtR(e.craterR * 2)],
  ].map(([l, v]) => `<div class="cloud-row"><span class="cl">${l}</span><span class="cv">${v}</span></div>`).join('');

  // SVG crater cross-section
  if (e.craterR < 0.001 || e.craterDepth < 0.001) { $('crater-panel').innerHTML = stats; return; }
  const W = 280, H = 100;
  const rPx = 120, dPx = Math.max(10, 50);
  const lipH = dPx * 0.35;
  const ejectaR = rPx * 1.6;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="crater-svg">
    <rect x="0" y="0" width="${W}" height="${H}" fill="var(--mantle)" rx="6"/>
    <line x1="10" y1="${H*0.55}" x2="${W-10}" y2="${H*0.55}" stroke="var(--surface1)" stroke-width="0.5" stroke-dasharray="4 4"/>
    <text x="12" y="${H*0.55-3}" fill="var(--overlay0)" font-size="7">Ground level</text>
    <path d="M${W/2 - ejectaR} ${H*0.55} Q${W/2 - rPx} ${H*0.55 - lipH} ${W/2 - rPx*0.8} ${H*0.55 + 2} Q${W/2} ${H*0.55 + dPx} ${W/2 + rPx*0.8} ${H*0.55 + 2} Q${W/2 + rPx} ${H*0.55 - lipH} ${W/2 + ejectaR} ${H*0.55}" fill="none" stroke="var(--surface2)" stroke-width="1.5"/>
    <path d="M${W/2 - rPx*0.8} ${H*0.55 + 2} Q${W/2} ${H*0.55 + dPx} ${W/2 + rPx*0.8} ${H*0.55 + 2}" fill="rgba(88,91,112,0.3)" stroke="var(--overlay0)" stroke-width="1"/>
    <line x1="${W/2 - rPx*0.8}" y1="${H*0.55 + 5}" x2="${W/2 + rPx*0.8}" y2="${H*0.55 + 5}" stroke="var(--peach)" stroke-width="0.8" stroke-dasharray="3 2"/>
    <text x="${W/2}" y="${H*0.55 + 14}" fill="var(--peach)" font-size="7" text-anchor="middle">${NM.fmtR(e.craterR * 2)} diameter</text>
    <line x1="${W/2 + 2}" y1="${H*0.55}" x2="${W/2 + 2}" y2="${H*0.55 + dPx - 3}" stroke="var(--red)" stroke-width="0.8" stroke-dasharray="3 2"/>
    <text x="${W/2 + 8}" y="${H*0.55 + dPx/2 + 2}" fill="var(--red)" font-size="7">${NM.fmtR(e.craterDepth)}</text>
    <text x="${W/2 - ejectaR + 5}" y="${H*0.55 - lipH - 3}" fill="var(--overlay0)" font-size="6">Lip</text>
    <text x="${W/2 + rPx + 5}" y="${H*0.55 - 5}" fill="var(--overlay0)" font-size="6">Ejecta</text>
  </svg>`;

  $('crater-panel').innerHTML = stats + svg;
}

function updateShelter(det) {
  $('shelter-section').style.display = '';
  $('shelter-content').innerHTML = NM.Shelter.generateReport(det.effects);
}

function updateNearbyTargets(det) {
  const allTargets = [
    ...(NM.WW3_TARGETS_US || []).map(t => ({...t, side: 'US'})),
    ...(NM.WW3_TARGETS_RU || []).map(t => ({...t, side: 'Russia'})),
    ...(NM.WW3_TARGETS_NATO || []).map(t => ({...t, side: 'NATO'})),
    ...(NM.WW3_TARGETS_CN || []).map(t => ({...t, side: 'China'})),
  ];
  const nearby = allTargets.map(t => ({...t, dist: NM.haversine(det.lat, det.lng, t.lat, t.lng)}))
    .filter(t => t.dist < 200)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 12);

  if (!nearby.length) { $('nearby-section').style.display = 'none'; return; }
  $('nearby-section').style.display = '';

  const typeColors = {icbm:'#f38ba8',bomber:'#fab387',sub:'#89b4fa',c2:'#cba6f7',nuclear:'#a6e3a1',military:'#f9e2af',infra:'#94e2d5',city:'#f5c2e7'};
  const typeLabels = {icbm:'ICBM',bomber:'Bomber',sub:'Submarine',c2:'Command',nuclear:'Nuclear',military:'Military',infra:'Infrastructure',city:'City'};

  let html = '<div class="nearby-list">';
  for (const t of nearby) {
    const c = typeColors[t.type] || '#cdd6f4';
    const inBlast = t.dist <= det.effects.psi1;
    html += `<div class="nearby-item${inBlast ? ' nearby-hit' : ''}">
      <div class="nb-header"><span class="nb-type" style="color:${c}">${typeLabels[t.type] || t.type}</span><span class="nb-dist">${NM.fmtR(t.dist)}</span></div>
      <div class="nb-name">${NM.esc(t.name)}</div>
      ${t.cat ? `<div class="nb-cat">${NM.esc(t.cat.substring(0, 80))}${t.cat.length > 80 ? '...' : ''}</div>` : ''}
      ${inBlast ? '<div class="nb-status">WITHIN BLAST ZONE</div>' : ''}
    </div>`;
  }
  html += '</div>';
  $('nearby-content').innerHTML = html;
}

function updateStats() {
  let td = 0, ti = 0, ty = 0;
  currentDets.forEach((d, i) => {
    let overlapFrac = 0;
    if (i > 0) {
      const rKm = Math.max(d.effects.psi1, d.effects.thermal1);
      for (let j = 0; j < i; j++) {
        const dist = NM.haversine(d.lat, d.lng, currentDets[j].lat, currentDets[j].lng);
        const rPrev = Math.max(currentDets[j].effects.psi1, currentDets[j].effects.thermal1);
        const combined = rKm + rPrev;
        if (dist < combined && combined > 0) {
          const overlap = Math.max(0, 1 - dist / combined);
          overlapFrac = Math.max(overlapFrac, overlap * 0.7);
        }
      }
    }
    const dedup = 1 - overlapFrac;
    td += d.casualties.deaths * dedup;
    ti += d.casualties.injuries * dedup;
    ty += d.yieldKt;
  });
  td = Math.round(td); ti = Math.round(ti);
  const hiro = ty / 15; // Hiroshima equivalents
  $('stat-deaths').textContent = NM.fmtNum(td);
  $('stat-injuries').textContent = NM.fmtNum(ti);
  $('stat-total').textContent = NM.fmtNum(td + ti);
  $('stat-yield').textContent = ty > 0 ? NM.fmtYield(ty) : '--';
  $('stat-note').textContent = currentDets.length > 1 ? `${currentDets.length} detonations | ${hiro >= 10 ? hiro.toFixed(0) : hiro.toFixed(1)}x Hiroshima` : currentDets.length === 1 ? (hiro >= 0.01 ? `${hiro >= 10 ? hiro.toFixed(0) : hiro.toFixed(1)}x Hiroshima equivalent` : 'Sub-tactical yield') : 'Detonate a weapon to see estimates';

  // Detonation counter badge
  const dc = $('det-counter');
  if (currentDets.length) {
    $('det-counter-num').textContent = currentDets.length;
    dc.querySelector('.dc-label').textContent = currentDets.length === 1 ? 'strike' : 'strikes';
    dc.style.display = '';
  } else dc.style.display = 'none';

  // Info bar
  const bar = $('info-bar');
  if (currentDets.length) {
    const hiroStr = hiro >= 10 ? hiro.toFixed(0) : hiro >= 0.1 ? hiro.toFixed(1) : hiro.toFixed(2);
    bar.innerHTML = `<div class="ib-stat"><div class="ib-val deaths">${NM.fmtNum(td)}</div><div class="ib-lbl">Fatalities</div></div><div class="ib-div"></div><div class="ib-stat"><div class="ib-val injuries">${NM.fmtNum(ti)}</div><div class="ib-lbl">Injuries</div></div><div class="ib-div"></div><div class="ib-stat"><div class="ib-val yield">${hiroStr}x</div><div class="ib-lbl">Hiroshimas</div></div><div class="ib-div"></div><div class="ib-stat"><div class="ib-val count">${currentDets.length}</div><div class="ib-lbl">${currentDets.length === 1 ? 'Detonation' : 'Detonations'}</div></div>`;
    bar.classList.add('active');
  } else bar.classList.remove('active');
  syncActionStates();
}

function toggleEffect(eid, vis) { currentDets.forEach(d => d.layers.forEach(l => { if (l._effectId === eid) { vis ? l.addTo(map) : map.removeLayer(l); } })); }

function removeDet(i) {
  const d = currentDets[i]; if (d) d.layers.forEach(l => map.removeLayer(l));
  NM.Mushroom3D.removeAt(i);
  currentDets.splice(i, 1); updateDetsList(); updateStats();
  if (!currentDets.length) resetPanels();
  else { const last = currentDets[currentDets.length - 1]; updateLegend(last); updateCloud(last); updateTimeline(last); updateCrater(last); updateShelter(last); }
  updateURL();
}

function clearAll() {
  _loadTimers.forEach(t => clearTimeout(t)); _loadTimers = [];
  currentDets.forEach(d => d.layers.forEach(l => map.removeLayer(l))); currentDets = [];
  NM.Mushroom3D.hide();
  NM.Compare.clearOverlay(map);
  NM.MIRV.clearPreview(map);
  NM.Animation.cleanup();
  NM.RingLabels.clear(map);
  NM.DistanceRings.clear(map);
  NM.DistanceIndicator.stop(map);
  NM.ThermalOverlay.clear(map);
  NM.FalloutParticles.stop(map);
  NM.DraggableGZ.disable(map);
  NM.DeliveryArc.layer && map.removeLayer(NM.DeliveryArc.layer);
  NM.ShockwaveRing.clear(map);
  NM.FalloutContours.clear(map);
  NM.Geiger.stop(map);
  NM.WW3.stop(map);
  NM.FalloutTimelapse.clear(map);
  NM.BlastArrival.stop(map);
  NM.RadiationOverlay.clear(map);
  NM.DamageHeatmap.clear(map);
  NM.TestTimeline.stop(map);
  $('fallout-timelapse').style.display = 'none';
  NM._lastDet = null;
  updateDetsList(); updateStats(); resetPanels(); updateURL();
}

function resetPanels() { _resetAllPanels(); }

// ---- URL STATE ----
function updateURL() {
  if (NM.WW3.active && NM.WW3._scenario) {
    const targeting = ($('ww3-targeting') || {}).value || 'all';
    const speed = ($('ww3-speed') || {}).value || '5';
    let qs = `?ww3=${NM.WW3._scenario.id}`;
    if (targeting !== 'all') qs += `&targeting=${targeting}`;
    if (speed !== '5') qs += `&speed=${speed}`;
    history.replaceState(null, '', qs);
    return;
  }
  if (!currentDets.length) { history.replaceState(null, '', location.pathname); return; }
  const params = currentDets.map(d => {
    let seg = `${d.lat.toFixed(4)},${d.lng.toFixed(4)},${d.yieldKt},${d.burstType[0]}`;
    if (d.heightM || d.fission !== 50) seg += `,${d.heightM || 0},${d.fission || 50}`;
    return seg;
  }).join(';');
  let qs = `?d=${params}`;
  if (windAngle !== 0) qs += `&w=${Math.round(windAngle)}`;
  if (NM._physicsModel !== 'nwfaq') qs += `&pm=${NM._physicsModel}`;
  history.replaceState(null, '', qs);
}

function loadFromURL() {
  const p = new URLSearchParams(location.search);
  // WW3 scenario from URL
  const ww3Id = p.get('ww3');
  if (ww3Id) {
    const targeting = p.get('targeting') || 'all';
    const speed = p.get('speed') || '5';
    setTimeout(() => {
      const ww3Sel = $('ww3-scenario');
      if (ww3Sel) ww3Sel.value = ww3Id;
      const tgtSel = $('ww3-targeting');
      if (tgtSel) tgtSel.value = targeting;
      const spdSel = $('ww3-speed');
      if (spdSel) spdSel.value = speed;
      NM.WW3.start(map, ww3Id);
      $('ww3-pause').style.display = '';
    }, 1500);
    return;
  }
  // Restore physics model and wind from URL
  const pm = p.get('pm');
  if (pm && NM.BLAST_MODELS[pm]) { NM._physicsModel = pm; const sel = $('physics-model'); if (sel) sel.value = pm; }
  const w = p.get('w');
  if (w && isFinite(+w)) { windAngle = +w; const compass = $('wind-compass'); if (compass) compass.value = windAngle; }

  const d = p.get('d');
  if (!d) return;
  multiMode = true; $('multi-check').checked = true;
  d.split(';').forEach(seg => {
    const parts = seg.split(',');
    const la = +parts[0], ln = +parts[1], yk = +parts[2], bt = parts[3];
    const hm = parts[4] ? +parts[4] : 0;
    const ff = parts[5] ? +parts[5] : 50;
    if (!isFinite(la) || !isFinite(ln) || !isFinite(yk)) return;
    if (la < -90 || la > 90 || ln < -180 || ln > 180) return;
    if (yk < 0.001 || yk > 100000) return;
    const burst = bt === 's' ? 'surface' : bt === 'c' ? 'custom' : bt === 'h' ? 'hemp' : bt === 'w' ? 'water' : 'airburst';
    setYield(yk);
    if (hm) $('burst-height').value = hm;
    $('fission-pct').value = ff;
    document.querySelectorAll('.burst-btn').forEach(b => b.classList.toggle('active', b.dataset.burst === burst));
    triggerDetonation(la, ln);
  });
}

function showShareLink() {
  if (!currentDets.length) return;
  $('share-section').style.display = ''; $('share-input').value = location.href; switchTab('results');
  // Show native share button if Web Share API available
  if (navigator.share) $('share-native').style.display = '';
}
function copyShareLink() { $('share-input').select(); navigator.clipboard?.writeText($('share-input').value); $('share-copy').textContent = 'Copied!'; setTimeout(() => $('share-copy').textContent = 'Copy Link', 2000); }
async function shareOrCopy(data, fallbackText, statusEl, originalLabel) {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'aborted';
    }
  }
  if (fallbackText && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(fallbackText);
    if (statusEl) {
      statusEl.textContent = 'Copied!';
      setTimeout(() => { statusEl.textContent = originalLabel; }, 2000);
    }
    return 'copied';
  }
  return 'unavailable';
}
function getShareText() {
  if (!currentDets.length) return '';
  let td = 0, ti = 0, ty = 0;
  currentDets.forEach(d => { td += d.casualties.deaths; ti += d.casualties.injuries; ty += d.yieldKt; });
  const hiro = (ty / 15);
  const nc = NM.findNearestCity(currentDets[0].lat, currentDets[0].lng);
  const loc = nc && nc.dist < 50 ? nc.name : `${currentDets[0].lat.toFixed(2)}, ${currentDets[0].lng.toFixed(2)}`;
  let text = `NukeMap: ${NM.fmtYield(ty)} (${hiro >= 10 ? hiro.toFixed(0) : hiro.toFixed(1)}x Hiroshima)`;
  if (currentDets.length === 1) text += ` on ${loc}`;
  else text += ` across ${currentDets.length} targets`;
  text += ` | ${NM.fmtNum(td)} killed, ${NM.fmtNum(ti)} injured`;
  text += `\n${location.href}`;
  return text;
}

// ---- WEAPON ENCYCLOPEDIA ----
function initEncyclopedia() {
  const list = $('encyclopedia-list'); if (!list) return;
  const groups = {};
  const countryOrder = ['US','RU','CN','UK','FR','IN','PK','KP','IL'];
  const countryNames = {US:'United States',RU:'Russia',CN:'China',UK:'United Kingdom',FR:'France',IN:'India',PK:'Pakistan',KP:'North Korea',IL:'Israel'};
  NM.WEAPONS.forEach((w, i) => {
    if (!w.country) return;
    if (!groups[w.country]) groups[w.country] = [];
    groups[w.country].push({...w, idx: i});
  });

  let html = '';
  for (const code of countryOrder) {
    const ws = groups[code];
    if (!ws) continue;
    html += `<div class="enc-country"><div class="enc-country-name">${countryNames[code] || code} (${ws.length})</div>`;
    for (const w of ws) {
      html += `<div class="enc-weapon" data-idx="${w.idx}" data-yield="${w.yield_kt}">
        <span class="enc-w-name">${NM.esc(w.name)}</span>
        <span class="enc-w-year">${w.year || ''}</span>
        <span class="enc-w-yield">${NM.fmtYield(w.yield_kt)}</span>
      </div>`;
    }
    html += '</div>';
  }
  list.innerHTML = html;

  list.querySelectorAll('.enc-weapon').forEach(el => {
    el.addEventListener('click', () => {
      const idx = +el.dataset.idx;
      $('weapon-select').value = idx;
      setYield(NM.WEAPONS[idx].yield_kt);
      switchTab('weapon');
      list.querySelectorAll('.enc-weapon').forEach(e => e.classList.remove('enc-selected'));
      el.classList.add('enc-selected');
    });
  });
}

// ---- HISTORIC TESTS WITH CONTEXT CARDS ----
function initHistoricTests() {
  const el = $('historic-tests-list'); if (!el || !NM.HISTORICAL) return;
  let html = '';
  for (const h of NM.HISTORICAL) {
    html += `<div class="hist-card" data-lat="${h.lat}" data-lng="${h.lng}" data-yield="${h.yield_kt}" data-burst="${h.burst}">
      <div class="hist-header"><span class="hist-name">${NM.esc(h.name)}</span><span class="hist-year">${h.year}</span><span class="hist-yield">${NM.fmtYield(h.yield_kt)}</span></div>
      <div class="hist-desc">${NM.esc(h.desc)}</div>
      ${h.context ? `<div class="hist-context">${NM.esc(h.context)}</div>` : ''}
      ${h.physics ? `<div class="hist-physics"><b>Physics:</b> ${NM.esc(h.physics)}</div>` : ''}
      ${h.source ? `<div class="hist-source">${NM.esc(h.source)}</div>` : ''}
    </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.hist-card').forEach(card => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      setYield(+card.dataset.yield);
      const burst = card.dataset.burst;
      document.querySelectorAll('.burst-btn').forEach(b => b.classList.toggle('active', b.dataset.burst === burst));
      map.setView([+card.dataset.lat, +card.dataset.lng], 8);
      triggerDetonation(+card.dataset.lat, +card.dataset.lng);
      switchTab('effects');
    });
  });
}

// ---- PHYSICS METHODOLOGY ----
function initMethodology() {
  const el = $('methodology-list'); if (!el || !NM.CITATIONS) return;
  const labels = {
    fireball:'Fireball Radius', psi200:'200 psi', psi20:'20 psi', psi5:'5 psi', psi3:'3 psi', psi1:'1 psi',
    thermal3:'3rd° Burns', thermal2:'2nd° Burns', thermal1:'1st° Burns',
    radiation:'500 rem Radiation', neutronRad:'Neutron Radiation', gammaRad:'Gamma Radiation',
    emp:'EMP Radius', craterR:'Crater Radius', craterD:'Crater Depth',
    cloudTop:'Cloud Top Height', fallout:'Fallout Scaling', flashBlind:'Flash Blindness',
    firestorm:'Firestorm Zone', surfaceFactor:'Surface Burst Factor', baseSurge:'Base Surge',
    waveHeight:'Wave Height', optHeight:'Optimal Burst Height', mortality:'Casualty Model',
  };
  let html = '';
  for (const [key, cite] of Object.entries(NM.CITATIONS)) {
    const name = labels[key] || key;
    html += `<div class="meth-item"><div class="meth-name">${NM.esc(name)}</div><div class="meth-ref">${NM.esc(cite.ref)}</div><div class="meth-note">${NM.esc(cite.note)}</div></div>`;
  }
  el.innerHTML = html;
}

// ---- EXPORT JSON ----
function exportJSON() {
  const provenance = NM.getModelProvenance();
  const data = currentDets.map(d => {
    const nc = NM.findNearestCity(d.lat, d.lng);
    return {
      location: {lat: d.lat, lng: d.lng, nearestCity: nc && nc.dist < 50 ? nc.name : null},
      weapon: d.weapon, yieldKt: d.yieldKt, burstType: d.burstType,
      provenance: NM.getModelProvenance(d.effects),
      effects: {
        fireball_km: +d.effects.fireball.toFixed(3), psi20_km: +d.effects.psi20.toFixed(3),
        psi5_km: +d.effects.psi5.toFixed(3), psi1_km: +d.effects.psi1.toFixed(3),
        thermal3_km: +d.effects.thermal3.toFixed(3), thermal1_km: +d.effects.thermal1.toFixed(3),
        radiation_km: +d.effects.radiation.toFixed(3), emp_km: +d.effects.emp.toFixed(3),
        firestorm_km: +d.effects.firestormR.toFixed(3),
        cloudTop_km: +d.effects.cloudTopH.toFixed(2),
      },
      casualties: d.casualties, hiroshimaEquivalent: +(d.yieldKt / 15).toFixed(2)
    };
  });
  const blob = new Blob([JSON.stringify({version:NM.APP_VERSION, generated: new Date().toISOString(), provenance, detonations: data}, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nukemap-data.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---- EXPORT GEOJSON ----
function exportGeoJSON() {
  const provenance = NM.getModelProvenance();
  const features = [];
  const ringDefs = [
    {key:'fireball',label:'Fireball'},{key:'psi20',label:'20 psi'},{key:'psi5',label:'5 psi'},
    {key:'psi1',label:'1 psi'},{key:'thermal3',label:'3rd° Burns'},{key:'thermal1',label:'1st° Burns'},
    {key:'radiation',label:'500 rem'},{key:'emp',label:'EMP'},{key:'firestormR',label:'Firestorm'},
  ];
  currentDets.forEach((d, i) => {
    features.push({type:'Feature',geometry:{type:'Point',coordinates:[d.lng,d.lat]},properties:{
      detonation:i+1,weapon:d.weapon,yieldKt:d.yieldKt,burstType:d.burstType,
      deaths:d.casualties.deaths,injuries:d.casualties.injuries,
      appVersion: provenance.appVersion, physicsModel: provenance.physicsModelLabel,
      falloutModel: provenance.falloutModel, citationKeys: NM.getEffectCitationKeys(d.effects).join('|'),
    }});
    for (const rd of ringDefs) {
      const r = d.effects[rd.key];
      if (!r || r < 0.001) continue;
      const pts = [];
      for (let a = 0; a <= 360; a += 5) {
        const rad = a * Math.PI / 180;
        const dlat = (r / 6371) * Math.cos(rad) * (180 / Math.PI);
        const dlng = (r / 6371) * Math.sin(rad) * (180 / Math.PI) / Math.cos(d.lat * Math.PI / 180);
        pts.push([+(d.lng + dlng).toFixed(6), +(d.lat + dlat).toFixed(6)]);
      }
      pts.push(pts[0]);
      features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[pts]},properties:{
        detonation:i+1,effect:rd.label,radius_km:+r.toFixed(3),
        appVersion: provenance.appVersion, physicsModel: provenance.physicsModelLabel,
        falloutModel: provenance.falloutModel, citationKeys: NM.getEffectCitationKeys(d.effects).join('|'),
      }});
    }
  });
  const geojson = {type:'FeatureCollection',provenance,features};
  const blob = new Blob([JSON.stringify(geojson, null, 2)], {type:'application/geo+json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nukemap-data.geojson';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---- EXPORT CSV ----
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function exportCSV() {
  const provenance = NM.getModelProvenance();
  const header = 'lat,lng,yield_kt,burst_type,weapon,deaths,injuries,fireball_km,psi5_km,psi1_km,thermal3_km,emp_km,app_version,physics_model,fallout_model,citation_keys,assumptions';
  const rows = currentDets.map(d =>
    [d.lat.toFixed(4), d.lng.toFixed(4), d.yieldKt, d.burstType, csvCell(d.weapon),
     d.casualties.deaths, d.casualties.injuries,
     d.effects.fireball.toFixed(3), d.effects.psi5.toFixed(3), d.effects.psi1.toFixed(3),
     d.effects.thermal3.toFixed(3), d.effects.emp.toFixed(3), provenance.appVersion,
     csvCell(provenance.physicsModelLabel), csvCell(provenance.falloutModel),
     csvCell(NM.getEffectCitationKeys(d.effects).join('|')), csvCell(provenance.assumptions.join(' '))].join(',')
  );
  const csv = header + '\n' + rows.join('\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nukemap-data.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---- IMPORT CSV ----
function resetCSVImportStatus() {
  pendingCSVImport = null;
  const el = $('csv-import-status');
  if (el) el.textContent = 'CSV import limit: 500 rows, 256 KB. Required columns: lat, lng, yield_kt, burst_type.';
}

function renderCSVImportPreview(result) {
  const el = $('csv-import-status');
  if (!el) return;
  if (!result.ok) {
    pendingCSVImport = null;
    el.innerHTML = `<div class="csv-preview warn"><strong>Import rejected.</strong><span>${NM.esc(result.error)}</span></div>`;
    return;
  }
  pendingCSVImport = result.validRows;
  const skipped = result.skippedRows.slice(0, 5).map(r => `<li>Row ${r.row}: ${NM.esc(r.reason)}</li>`).join('');
  el.innerHTML = `<div class="csv-preview">
    <strong>${result.validRows.length} valid row${result.validRows.length === 1 ? '' : 's'} ready to import</strong>
    <span>${result.skippedRows.length} skipped of ${result.totalRows} data row${result.totalRows === 1 ? '' : 's'}.</span>
    ${skipped ? `<ul class="csv-skip-list">${skipped}</ul>` : ''}
    ${result.skippedRows.length > 5 ? `<span>Plus ${result.skippedRows.length - 5} more skipped row${result.skippedRows.length - 5 === 1 ? '' : 's'}.</span>` : ''}
    <div class="csv-actions"><button class="btn-secondary" id="csv-import-run" type="button">Import Valid Rows</button><button class="btn-secondary" id="csv-import-cancel" type="button">Cancel</button></div>
  </div>`;
}

function runCSVImport() {
  if (!pendingCSVImport || !pendingCSVImport.length) return;
  const rows = pendingCSVImport;
  pendingCSVImport = null;
  clearAll();
  multiMode = true; $('multi-check').checked = true;
  rows.forEach(row => {
    setYield(row.yieldKt);
    document.querySelectorAll('.burst-btn').forEach(b => b.classList.toggle('active', b.dataset.burst === row.burstType));
    $('wind-wrap').style.display = row.burstType === 'surface' || row.burstType === 'water' ? '' : 'none';
    triggerDetonation(row.lat, row.lng);
  });
  const el = $('csv-import-status');
  if (el) el.innerHTML = `<div class="csv-preview success"><strong>Imported ${rows.length} valid row${rows.length === 1 ? '' : 's'}.</strong><span>Invalid rows were skipped before detonation.</span></div>`;
}

function importCSV(file) {
  if (file.size > NM.CSV_IMPORT_LIMITS.maxBytes) {
    renderCSVImportPreview(NM.validateCSVImport('', file.size));
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    renderCSVImportPreview(NM.validateCSVImport(e.target.result, file.size));
  };
  reader.onerror = () => renderCSVImportPreview({ok:false, error:'Could not read CSV file.', validRows:[], skippedRows:[], totalRows:0});
  reader.readAsText(file);
}

// ---- SUMMARY REPORT ----
function exportReport() {
  let td = 0, ti = 0, ty = 0;
  currentDets.forEach(d => { td += d.casualties.deaths; ti += d.casualties.injuries; ty += d.yieldKt; });
  const hiro = ty / 15;
  const provenance = NM.getModelProvenance();

  let report = `NUKEMAP DETONATION REPORT\n`;
  report += `Generated: ${new Date().toLocaleString()}\n`;
  report += `${'='.repeat(50)}\n\n`;
  report += `MODEL PROVENANCE\n`;
  report += `  App Version: ${provenance.appVersion}\n`;
  report += `  Physics Model: ${provenance.physicsModelLabel}\n`;
  report += `  Fallout Model: ${provenance.falloutModel}\n`;
  report += `  Casualty Model: ${provenance.casualtyModel}\n`;
  report += `  Confidence: ${provenance.confidence}\n`;
  report += `  Citation Keys: ${provenance.citationKeys.join(', ')}\n`;
  report += `  Assumptions: ${provenance.assumptions.join(' ')}\n\n`;
  report += `SUMMARY\n`;
  report += `  Detonations: ${currentDets.length}\n`;
  report += `  Total Yield: ${NM.fmtYield(ty)} (${hiro.toFixed(1)}x Hiroshima)\n`;
  report += `  Est. Fatalities: ${NM.fmtNum(td)}\n`;
  report += `  Est. Injuries: ${NM.fmtNum(ti)}\n`;
  report += `  Total Affected: ${NM.fmtNum(td + ti)}\n\n`;

  currentDets.forEach((d, i) => {
    const nc = NM.findNearestCity(d.lat, d.lng);
    const loc = nc && nc.dist < 50 ? `${nc.name}, ${nc.state}` : `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`;
    report += `DETONATION ${i + 1}: ${d.weapon}\n`;
    report += `${'-'.repeat(40)}\n`;
    report += `  Location: ${loc}\n`;
    report += `  Coordinates: ${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}\n`;
    report += `  Yield: ${NM.fmtYield(d.yieldKt)} (${(d.yieldKt/15).toFixed(1)}x Hiroshima)\n`;
    report += `  Burst Type: ${d.burstType}\n`;
    report += `  Fatalities: ${NM.fmtNum(d.casualties.deaths)}\n`;
    report += `  Injuries: ${NM.fmtNum(d.casualties.injuries)}\n`;
    report += `  Effect Radii:\n`;
    report += `    Fireball: ${NM.fmtDist(d.effects.fireball)}\n`;
    report += `    20 psi: ${NM.fmtDist(d.effects.psi20)}\n`;
    report += `    5 psi: ${NM.fmtDist(d.effects.psi5)}\n`;
    report += `    1 psi: ${NM.fmtDist(d.effects.psi1)}\n`;
    report += `    3rd deg burns: ${NM.fmtDist(d.effects.thermal3)}\n`;
    report += `    Firestorm: ${NM.fmtDist(d.effects.firestormR)}\n`;
    report += `    EMP: ${NM.fmtDist(d.effects.emp)}\n`;
    report += `    Cloud top: ${NM.fmtDist(d.effects.cloudTopH)}\n`;
    if (d.effects.fallout) {
      report += `    Fallout (heavy): ${NM.fmtDist(d.effects.fallout.heavy.length)} downwind\n`;
      report += `    Fallout (light): ${NM.fmtDist(d.effects.fallout.light.length)} downwind\n`;
    }
    report += `\n`;
  });

  report += `\nPhysics: Glasstone & Dolan, "The Effects of Nuclear Weapons"; NWFAQ; HSAJ; model-specific citations listed above.\n`;
  report += `Generated by NukeMap v${provenance.appVersion} - https://sysadmindoc.github.io/NukeMap/\n`;

  if (navigator.share) {
    shareOrCopy({title:'NukeMap Detonation Report', text: report, url: location.href}, report, $('export-report'), 'Generate Report')
      .then(status => { if (status === 'unavailable') downloadTextFile(report, 'nukemap-report.txt'); });
    return;
  }
  downloadTextFile(report, 'nukemap-report.txt');
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], {type:'text/plain'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function handleLaunchAction(action) {
  if (!action) return;
  const target = {
    detonate: {tab: 'weapon', selector: '#detonate-btn'},
    ww3: {tab: 'tools', selector: '#ww3-scenario'},
    saved: {tab: 'results', selector: '#saved-list'},
    guide: {tab: 'effects', selector: '#guide-section'},
  }[action];
  if (!target) return;
  switchTab(target.tab);
  setTimeout(() => {
    const el = document.querySelector(target.selector);
    if (el) {
      el.scrollIntoView({block: 'center'});
      if (typeof el.focus === 'function') el.focus({preventScroll: true});
    }
  }, 100);
}

function exportPrintReport() {
  let td = 0, ti = 0, ty = 0;
  currentDets.forEach(d => { td += d.casualties.deaths; ti += d.casualties.injuries; ty += d.yieldKt; });
  const hiro = ty / 15;
  const provenance = NM.getModelProvenance();
  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NukeMap Report</title><style>
    body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:20px;color:#111;line-height:1.6}
    h1{font-size:22px;border-bottom:2px solid #333;padding-bottom:8px}
    h2{font-size:16px;margin-top:24px;color:#333;border-bottom:1px solid #ccc;padding-bottom:4px}
    table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;font-size:12px}
    th{background:#f0f0f0;font-weight:bold}.val{text-align:right;font-variant-numeric:tabular-nums}
    .note{font-size:10px;color:#666;margin-top:16px;border-top:1px solid #ccc;padding-top:8px}
    @media print{body{margin:0;padding:10px}}
  </style></head><body>`;
  html += `<h1>NukeMap Detonation Report</h1>`;
  html += `<p>Generated: ${new Date().toLocaleString()} | ${currentDets.length} detonation${currentDets.length>1?'s':''}</p>`;
  html += `<h2>Model Provenance</h2><table><tr><th>App Version</th><td>${NM.esc(provenance.appVersion)}</td></tr>`;
  html += `<tr><th>Physics Model</th><td>${NM.esc(provenance.physicsModelLabel)}</td></tr>`;
  html += `<tr><th>Fallout Model</th><td>${NM.esc(provenance.falloutModel)}</td></tr>`;
  html += `<tr><th>Casualty Model</th><td>${NM.esc(provenance.casualtyModel)}</td></tr>`;
  html += `<tr><th>Confidence</th><td>${NM.esc(provenance.confidence)}</td></tr>`;
  html += `<tr><th>Citation Keys</th><td>${NM.esc(provenance.citationKeys.join(', '))}</td></tr></table>`;
  html += `<h2>Summary</h2><table><tr><th>Total Yield</th><td class="val">${NM.fmtYield(ty)} (${hiro.toFixed(1)}x Hiroshima)</td></tr>`;
  html += `<tr><th>Est. Fatalities</th><td class="val">${NM.fmtNum(td)}</td></tr>`;
  html += `<tr><th>Est. Injuries</th><td class="val">${NM.fmtNum(ti)}</td></tr>`;
  html += `<tr><th>Total Affected</th><td class="val">${NM.fmtNum(td+ti)}</td></tr></table>`;
  currentDets.forEach((d, i) => {
    const nc = NM.findNearestCity(d.lat, d.lng);
    const loc = nc && nc.dist < 50 ? `${nc.name}, ${nc.state}` : `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`;
    html += `<h2>Detonation ${i+1}: ${NM.esc(d.weapon)}</h2>`;
    html += `<table><tr><th>Location</th><td>${NM.esc(loc)} (${d.lat.toFixed(4)}, ${d.lng.toFixed(4)})</td></tr>`;
    html += `<tr><th>Yield</th><td class="val">${NM.fmtYield(d.yieldKt)}</td></tr>`;
    html += `<tr><th>Burst Type</th><td>${d.burstType}</td></tr>`;
    html += `<tr><th>Fatalities</th><td class="val">${NM.fmtNum(d.casualties.deaths)}</td></tr>`;
    html += `<tr><th>Injuries</th><td class="val">${NM.fmtNum(d.casualties.injuries)}</td></tr></table>`;
    html += `<table><tr><th>Effect</th><th>Radius</th><th>Area</th></tr>`;
    const rows = [['Fireball',d.effects.fireball],['20 psi',d.effects.psi20],['5 psi',d.effects.psi5],['1 psi',d.effects.psi1],
      ['3rd° Burns',d.effects.thermal3],['Firestorm',d.effects.firestormR],['EMP',d.effects.emp]];
    for (const [name, r] of rows) { if (r > 0.001) html += `<tr><td>${name}</td><td class="val">${NM.fmtDist(r)}</td><td class="val">${NM.fmtArea(r)}</td></tr>`; }
    html += `</table>`;
  });
  html += `<div class="note">Assumptions: ${NM.esc(provenance.assumptions.join(' '))}<br>`;
  html += `Physics: Glasstone & Dolan, "The Effects of Nuclear Weapons" (1977), NWFAQ, HSAJ, and model-specific citations listed above.<br>`;
  html += `Generated by NukeMap v${NM.esc(provenance.appVersion)} â€” <a href="https://sysadmindoc.github.io/NukeMap/">sysadmindoc.github.io/NukeMap</a></div>`;
  html += `</body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow popups for this site to generate the report.'); return; }
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 300);
}

// ---- SAVE/LOAD SCENARIOS (IndexedDB with localStorage fallback) ----
const _scenarioDB = {
  _db: null,
  _storeName: 'scenarios',
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { resolve(null); return; }
      const req = indexedDB.open('nukemap-scenarios', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(this._storeName, {keyPath: 'id', autoIncrement: true}); };
      req.onsuccess = () => { this._db = req.result; this._migrate(); resolve(this._db); };
      req.onerror = () => resolve(null);
    });
  },
  _migrate() {
    const old = localStorage.getItem('nukemap-saves');
    if (!old) return;
    try {
      const saves = JSON.parse(old);
      if (saves.length) {
        const tx = this._db.transaction(this._storeName, 'readwrite');
        saves.forEach(s => tx.objectStore(this._storeName).add(s));
        tx.oncomplete = () => localStorage.removeItem('nukemap-saves');
      }
    } catch(e) {}
  },
  getAll() {
    if (!this._db) return Promise.resolve(JSON.parse(localStorage.getItem('nukemap-saves') || '[]'));
    return new Promise(resolve => {
      const tx = this._db.transaction(this._storeName, 'readonly');
      const req = tx.objectStore(this._storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },
  add(scenario) {
    if (!this._db) {
      const saves = JSON.parse(localStorage.getItem('nukemap-saves') || '[]');
      saves.push(scenario);
      localStorage.setItem('nukemap-saves', JSON.stringify(saves));
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).add(scenario);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
  delete(id) {
    if (!this._db) {
      const saves = JSON.parse(localStorage.getItem('nukemap-saves') || '[]');
      saves.splice(id, 1);
      localStorage.setItem('nukemap-saves', JSON.stringify(saves));
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const tx = this._db.transaction(this._storeName, 'readwrite');
      tx.objectStore(this._storeName).delete(id);
      tx.oncomplete = resolve;
    });
  }
};

function renderSavedList(filter) {
  const list = $('saved-list'); if (!list) return;
  _scenarioDB.getAll().then(saves => {
    if (!saves.length) { list.innerHTML = compactState('No saved scenarios yet.'); return; }
    const q = (filter || '').toLowerCase();
    const filtered = q ? saves.filter(s => (s.name||'').toLowerCase().includes(q) || (s.folder||'').toLowerCase().includes(q)) : saves;
    if (!filtered.length) { list.innerHTML = compactState('No matches.'); return; }
    list.innerHTML = '';
    const folders = {};
    for (const s of filtered) { const f = s.folder || ''; (folders[f] = folders[f] || []).push(s); }
    const sortedFolders = Object.keys(folders).sort((a, b) => a === '' ? 1 : b === '' ? -1 : a.localeCompare(b));
    for (const f of sortedFolders) {
      if (f && sortedFolders.length > 1) {
        const hdr = document.createElement('div');
        hdr.className = 'si-folder';
        hdr.textContent = f;
        list.appendChild(hdr);
      }
      for (const s of folders[f]) {
        const el = document.createElement('div'); el.className = 'saved-item';
        const folderTag = s.folder ? `<span class="si-folder-tag">${NM.esc(s.folder)}</span>` : '';
        el.innerHTML = `<span class="si-name">${NM.esc(s.name)}</span>${folderTag}<span class="si-meta">${s.dets.length} det${s.dets.length > 1 ? 's' : ''}</span><button class="si-del" data-i="${s.id ?? filtered.indexOf(s)}">&times;</button>`;
        el.addEventListener('click', e => { if (!e.target.classList.contains('si-del')) loadScenario(s); });
        el.querySelector('.si-del').addEventListener('click', e => { e.stopPropagation(); deleteSave(s.id ?? filtered.indexOf(s)); });
        list.appendChild(el);
      }
    }
  });
}

let _loadTimers = [];
function loadScenario(s) {
  _loadTimers.forEach(t => clearTimeout(t));
  _loadTimers = [];
  clearAll();
  multiMode = true; $('multi-check').checked = true;
  if (s.dets.length) map.flyTo([s.dets[0].lat, s.dets[0].lng], s.dets.length > 2 ? 6 : 9, {duration: 1});
  _loadTimers.push(setTimeout(() => {
    s.dets.forEach((d, i) => {
      _loadTimers.push(setTimeout(() => {
        setYield(d.yieldKt);
        document.querySelectorAll('.burst-btn').forEach(b => b.classList.toggle('active', b.dataset.burst === d.burstType));
        $('wind-wrap').style.display = d.burstType === 'surface' ? '' : 'none';
        triggerDetonation(d.lat, d.lng);
      }, i * 400));
    });
  }, 1200));
}

function deleteSave(id) {
  _scenarioDB.delete(id).then(() => renderSavedList());
}

// ---- DETONATION TOAST ----
function showDetToast(det) {
  const nc = NM.findNearestCity(det.lat, det.lng);
  const loc = nc && nc.dist < 50 ? nc.name : `${det.lat.toFixed(2)}, ${det.lng.toFixed(2)}`;
  const hiro = det.yieldKt / 15;
  const hiroStr = hiro >= 10 ? hiro.toFixed(0) + 'x Hiroshima' : hiro >= 1 ? hiro.toFixed(1) + 'x Hiroshima' : '';
  const el = document.createElement('div');
  el.className = 'det-toast';
  el.setAttribute('role', 'alert');
  el.setAttribute('aria-live', 'assertive');
  el.innerHTML = `<span class="dt-yield">${NM.fmtYield(det.yieldKt)}</span> <span class="dt-loc">${NM.esc(loc)}</span>${hiroStr ? ` <span class="dt-hiro">${hiroStr}</span>` : ''}`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 3000);
}

// ---- FULLSCREEN ----
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.();
  } else {
    document.exitFullscreen?.() || document.webkitExitFullscreen?.();
  }
}

// ---- INIT ----
function init() {
  syncAppMetadata();
  NM.i18n?.apply();
  NM.Sound.init();
  NM.Mushroom3D.init();
  initMap();
  initControls();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const toast = document.createElement('div');
      toast.className = 'det-toast';
      toast.setAttribute('role', 'alert');
      toast.innerHTML = '<span class="dt-yield">Update available</span> <span class="dt-loc" style="cursor:pointer;text-decoration:underline">Reload to apply</span>';
      toast.querySelector('.dt-loc').addEventListener('click', () => location.reload());
      document.body.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('show'));
    });
  }
  _scenarioDB.open().then(() => renderSavedList());

  // Lazy-load ZIP code database (1.5MB) after app is interactive
  // Skip if already loaded (e.g., inlined by build.py offline bundler)
  if (!NM.ZIPDB) {
    setTimeout(() => {
      const s = document.createElement('script'); s.src = 'js/zipcodes.js'; document.body.appendChild(s);
    }, 2000);
  }

  // Welcome overlay
  const wo = $('welcome-overlay');
  const params = new URLSearchParams(location.search);
  const launchAction = params.get('action');
  const hasUrlDets = params.get('d') || launchAction;
  handleLaunchAction(launchAction);
  if (wo && !localStorage.getItem('nukemap-welcomed')) {
    wo.style.display = '';
    $('welcome-dismiss').addEventListener('click', () => {
      if ($('welcome-noshow').checked) localStorage.setItem('nukemap-welcomed', '1');
      wo.classList.add('hidden');
      // Demo detonation on first visit
      if (!hasUrlDets && !currentDets.length) {
        setTimeout(() => {
          if (currentDets.length) return;
          map.flyTo([40.7128, -74.006], 11, {duration: 1.2});
          setTimeout(() => {
            if (currentDets.length) return;
            setYield(455);
            triggerDetonation(40.7128, -74.006);
          }, 1400);
        }, 300);
      }
    });
  } else if (wo) wo.classList.add('hidden');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

})();
