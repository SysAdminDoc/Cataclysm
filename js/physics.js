// NukeMap - Nuclear Physics Module (Glasstone & Dolan + Brode)
// Sources: G&D = "The Effects of Nuclear Weapons" 3rd ed. (1977)
//          NWFAQ = Nuclear Weapon Archive FAQ Section 5
//          HSAJ = Homeland Security Affairs Journal (peer-reviewed)
//          OTA = Office of Technology Assessment "Effects of Nuclear War" (1979)
window.NM = window.NM || {};

// Physics citation database — every constant linked to its source
NM.CITATIONS = {
  fireball:  {ref:'G&D Ch.2 §2.127–2.128', note:'Maximum fireball radius ≈ 2× breakaway. Air: 0.066·Y^0.4 km, Surface: 0.05·Y^0.4 km.'},
  psi200:    {ref:'NWFAQ §5.2', note:'200 psi overpressure at optimum burst height with Mach stem. Coefficient 0.13.'},
  psi20:     {ref:'NWFAQ §5.2; HSAJ 10kT', note:'20 psi radius. NWFAQ coefficient 0.28. HSAJ 10kT: 0.60 km.'},
  psi5:      {ref:'NWFAQ §5.2; HSAJ 10kT', note:'5 psi radius. NWFAQ coefficient 0.71. HSAJ 10kT: 1.51 km. Buildings destroyed, 160 mph winds.'},
  psi3:      {ref:'NWFAQ §5.2', note:'3 psi radius. NWFAQ coefficient 0.95. Moderate structural damage.'},
  psi1:      {ref:'NWFAQ §5.2; HSAJ 10kT', note:'1 psi radius. NWFAQ coefficient 2.2. HSAJ 10kT: 4.58 km. Window breakage, glass shrapnel.'},
  thermal3:  {ref:'NWFAQ §5.3; G&D Ch.7', note:'3rd degree burns (8 cal/cm²). Coefficient 0.67, exponent 0.41.'},
  thermal2:  {ref:'NWFAQ §5.3', note:'2nd degree burns (5 cal/cm²). Coefficient 0.87, exponent 0.40.'},
  thermal1:  {ref:'NWFAQ §5.3', note:'1st degree burns (2.5 cal/cm²). Coefficient 1.20, exponent 0.38.'},
  radiation: {ref:'NWFAQ §5.4; G&D Ch.8', note:'500 rem lethal dose radius. Coefficient 1.15, exponent 0.19. Attenuated by atmosphere.'},
  neutronRad:{ref:'NWFAQ §5.4', note:'Neutron radiation radius. Coefficient 0.7, capped at 2.5 km. Dominant for low yields.'},
  gammaRad:  {ref:'NWFAQ §5.4', note:'Initial gamma radiation radius. Coefficient 1.0, capped at 3.0 km.'},
  emp:       {ref:'G&D Ch.11 §11.01–11.71', note:'EMP radius ≈ 2.5·Y^0.33 km, capped at 500 km for low-altitude. HEMP extends to 2200 km.'},
  craterR:   {ref:'G&D Ch.6 §6.63–6.65', note:'Apparent crater radius. Surface burst only. 0.038·Y^(1/3.4) km.'},
  craterD:   {ref:'G&D Ch.6 §6.63–6.65', note:'Apparent crater depth. Surface burst only. 0.013·Y^(1/3.4) km.'},
  cloudTop:  {ref:'G&D Ch.2 §2.16', note:'Cloud top height. Air: 0.29·Y^0.42 km. Surface: 0.24·Y^0.42 km.'},
  fallout:   {ref:'G&D Ch.9; Miller SFSS', note:'Simplified fallout scaling. Heavy zone: 1.3·(Y·f)^0.45 km downwind.'},
  flashBlind:{ref:'G&D Ch.12 §12.40–12.44', note:'Temporary flash blindness. Day: 2.1·Y^0.4 km. Night (scotopic): 55·Y^0.25 km.'},
  firestorm: {ref:'G&D Ch.7 §7.58–7.60', note:'Firestorm zone ≈ 85% of 3rd-degree thermal radius. Requires >8 cal/cm² + urban fuel load.'},
  surfaceFactor: {ref:'NWFAQ §5.2; HSAJ §3', note:'Surface burst blast radii ≈ 0.8× airburst (enhanced ground coupling, no Mach stem).'},
  baseSurge: {ref:'G&D Ch.6 §6.43–6.50', note:'Water burst base surge: radioactive mist cloud. Radius ≈ 0.34·Y^0.4 km. Height ≈ 0.06·Y^0.4 km.'},
  waveHeight: {ref:'G&D Ch.6 §6.50–6.57', note:'Water surface wave at 1 km ≈ 10·Y^0.54 meters. Decays as ~1/distance. Shallow-water enhanced.'},
  optHeight: {ref:'G&D Ch.3 §3.73', note:'Optimal burst height for max 5-psi radius ≈ 0.22·Y^(1/3) km.'},
  mortality: {ref:'Harney 2009; Nuclear Radius Pro', note:'Bayesian combined mortality: P(death)=1-(1-Pb)(1-Pt)(1-Pr). Indoor PF=0.4, indoor fraction=80%.'},
};

NM.calcEffects = function(Y, burstType, heightM, fissionFrac) {
  Y = Math.max(Y, 0.001);
  fissionFrac = (fissionFrac ?? 50) / 100;
  const isWater = burstType === 'water';
  const isSurface = burstType === 'surface' || isWater;
  const optH = 0.22 * Math.pow(Y, 1/3) * 1000;  // G&D Ch.3 §3.73
  const h = burstType === 'airburst' ? optH : (heightM || 0);
  const hf = isSurface ? 0.8 : 1.0;  // NWFAQ §5.2: surface burst factor

  return {
    fireball:  isSurface ? 0.05*Math.pow(Y,0.4) : 0.066*Math.pow(Y,0.4),  // G&D Ch.2
    psi200:    hf * 0.13 * Math.pow(Y, 1/3),  // NWFAQ §5.2
    psi20:     hf * 0.28 * Math.pow(Y, 1/3),  // NWFAQ §5.2
    psi5:      hf * 0.71 * Math.pow(Y, 1/3),  // NWFAQ §5.2
    psi3:      hf * 0.95 * Math.pow(Y, 1/3),  // NWFAQ §5.2
    psi1:      hf * 2.2 * Math.pow(Y, 1/3),   // NWFAQ §5.2
    thermal3:  0.67 * Math.pow(Y, 0.41),  // NWFAQ §5.3: 8 cal/cm²
    thermal2:  0.87 * Math.pow(Y, 0.40),  // NWFAQ §5.3: 5 cal/cm²
    thermal1:  1.20 * Math.pow(Y, 0.38),  // NWFAQ §5.3: 2.5 cal/cm²
    radiation: 1.15 * Math.pow(Y, 0.19),  // NWFAQ §5.4: 500 rem
    neutronRad: Math.min(2.5, 0.7 * Math.pow(Y, 0.19)),  // NWFAQ §5.4
    gammaRad: Math.min(3.0, 1.0 * Math.pow(Y, 0.19)),  // NWFAQ §5.4
    emp:       Math.min(2.5 * Math.pow(Y, 0.33), 500),  // G&D Ch.11
    craterR:   isSurface ? 0.038*Math.pow(Y,1/3.4) : 0,  // G&D Ch.6
    craterDepth: isSurface ? 0.013*Math.pow(Y,1/3.4) : 0,  // G&D Ch.6
    cloudTopH: (isSurface?0.24:0.29) * Math.pow(Y, 0.42),
    cloudTopR: 0.19 * Math.pow(Y, 0.4),
    stemR:     0.05 * Math.pow(Y, 0.35),
    cloudH:    0.29 * Math.pow(Y, 0.4),
    fallout:   (isSurface || (heightM !== undefined && heightM < (isSurface?0.05:0.066)*Math.pow(Y,0.4)*1000))
      ? { heavy:{length:1.3*Math.pow(Y*fissionFrac,0.45), width:0.39*Math.pow(Y*fissionFrac,0.35)},
          light:{length:4.6*Math.pow(Y*fissionFrac,0.45), width:1.1*Math.pow(Y*fissionFrac,0.35)} }
      : null,
    flashBlindDay:  2.1 * Math.pow(Y, 0.4),   // km - temporary blindness in daylight
    flashBlindNight: 55 * Math.pow(Y, 0.25),  // km - temporary blindness at night (much larger)
    firestormR: isWater ? 0 : 0.67 * Math.pow(Y, 0.41) * 0.85, // km - ~85% of thermal3 radius (G&D Ch.7)
    burstHeight: h, optimalHeight: optH, isSurface, yieldKt: Y,
    isWater,
    baseSurge: isWater ? 0.34 * Math.pow(Y, 0.4) : 0,  // G&D Ch.6 §6.43: base surge radius
    baseSurgeH: isWater ? 0.06 * Math.pow(Y, 0.4) : 0, // G&D Ch.6: base surge cloud height km
    waveHeight: isWater ? 10 * Math.pow(Y, 0.54) : 0,  // G&D Ch.6 §6.50: wave height meters at 1km
  };
};

NM.calcTimeline = function(Y, e) {
  const items = [
    {time:'0 ms', desc:'Detonation. X-ray pulse heats air to millions of degrees.'},
    {time:'0.01 ms', desc:'Prompt neutron/gamma pulse. Lethal radiation (500+ rem) to '+NM.fmtR(e.neutronRad)+' (neutrons) and '+NM.fmtR(e.gammaRad)+' (gamma). Travels at speed of light.'},
    {time:'0.1 ms', desc:'Thermal flash. Temporary blindness to '+NM.fmtR(e.flashBlindDay)+' (day) or '+NM.fmtR(e.flashBlindNight)+' (night).'},
    {time: (0.0013*Math.pow(Y,0.4)*1000).toFixed(0)+' ms', desc:'Fireball reaches max size ('+NM.fmtR(e.fireball)+' radius). Surface temperature ~10,000,000\u00B0C.'},
    {time: NM.fmtTime(e.psi5/0.34), desc:'Blast wave at 5 psi ('+NM.fmtR(e.psi5)+'). Buildings destroyed. 160 mph winds.'},
    {time: NM.fmtTime(e.psi1/0.34), desc:'Blast wave at 1 psi ('+NM.fmtR(e.psi1)+'). Windows shatter into shrapnel.'},
  ];
  if (e.firestormR > 0.1) items.push({time:'~5 min', desc:'Firestorm ignites within '+NM.fmtR(e.firestormR)+'. Hurricane-force inward winds feed the fire.'});
  if (e.isSurface && e.fallout) {
    items.push({time:'~10 min', desc:'Mushroom cloud stabilizes at ~'+e.cloudTopH.toFixed(1)+' km. Fallout begins.'});
    items.push({time:'~30 min', desc:'Heaviest fallout within '+NM.fmtR(e.fallout.heavy.length)+' downwind.'});
    items.push({time:'~24 hrs', desc:'Light fallout extends '+NM.fmtR(e.fallout.light.length)+' downwind. 7:10 decay rule applies.'});
  } else {
    items.push({time:'~10 min', desc:'Mushroom cloud reaches ~'+e.cloudTopH.toFixed(1)+' km altitude.'});
  }
  return items;
};

NM.estimateCasualties = function(lat, lng, effects) {
  const nc = NM.findNearestCity(lat, lng);
  let density = 40;
  if (nc) {
    const d=nc.dist, p=nc.pop;
    if(d<3&&p>1e6)density=15000;else if(d<5&&p>5e5)density=10000;else if(d<10&&p>5e5)density=5000;
    else if(d<15&&p>1e5)density=3000;else if(d<25&&p>1e5)density=1500;else if(d<40&&p>5e4)density=500;
    else if(d<60&&p>1e4)density=200;else if(d<100)density=80;
  }
  // Urban shielding factor: dense areas have buildings that reduce exposure (Harney 2009)
  const shieldF = density > 5000 ? 0.65 : density > 1000 ? 0.75 : density > 200 ? 0.85 : 1.0;
  // Indoor fraction (~80% indoors) with protection factor reducing thermal/radiation
  const indoorFrac = 0.8, indoorPF = 0.4;

  const radii = [
    {r: effects.fireball, label: 'fireball'},
    {r: effects.psi200 || 0, label: 'psi200'},
    {r: effects.psi20, label: 'psi20'},
    {r: effects.psi5, label: 'psi5'},
    {r: Math.max(effects.thermal3, effects.psi3), label: 'psi3_thermal3'},
    {r: effects.psi1, label: 'psi1'},
    {r: effects.thermal1, label: 'thermal1'},
  ];
  // Combined mortality: P(death) = 1 - (1-Pblast)(1-Pthermal)(1-Pradiation) per zone
  const zoneProbs = [
    {r: effects.fireball,                       pBlast: 1.0,  pTherm: 1.0,  pRad: 1.0,  pInjB: 0,    pInjT: 0},
    {r: effects.psi200 || 0,                    pBlast: 0.98, pTherm: 0.9,  pRad: 0.8,  pInjB: 0.02, pInjT: 0.05},
    {r: effects.psi20,                          pBlast: 0.85, pTherm: 0.6,  pRad: 0.3,  pInjB: 0.12, pInjT: 0.15},
    {r: effects.psi5,                           pBlast: 0.40, pTherm: 0.3,  pRad: 0.05, pInjB: 0.45, pInjT: 0.20},
    {r: Math.max(effects.thermal3, effects.psi3), pBlast: 0.15, pTherm: 0.25, pRad: 0.02, pInjB: 0.35, pInjT: 0.30},
    {r: effects.psi1,                           pBlast: 0.02, pTherm: 0.05, pRad: 0.0,  pInjB: 0.20, pInjT: 0.15},
    {r: effects.thermal1,                       pBlast: 0.0,  pTherm: 0.01, pRad: 0.0,  pInjB: 0.05, pInjT: 0.10},
  ];
  let deaths = 0, injuries = 0, prevA = 0;
  for (const z of zoneProbs) {
    if (z.r < 0.001) continue;
    const a = Math.PI * z.r * z.r, ring = Math.max(0, a - prevA);
    const pop = ring * density;
    // Outdoor population: full exposure
    const outPop = pop * (1 - indoorFrac);
    const outDeath = 1 - (1 - z.pBlast) * (1 - z.pTherm) * (1 - z.pRad);
    const outInj = Math.min(1 - outDeath, z.pInjB + z.pInjT);
    // Indoor population: reduced thermal/radiation by protection factor
    const inPop = pop * indoorFrac;
    const inDeath = 1 - (1 - z.pBlast) * (1 - z.pTherm * indoorPF) * (1 - z.pRad * indoorPF);
    const inInj = Math.min(1 - inDeath, z.pInjB + z.pInjT * indoorPF);
    deaths += (outPop * outDeath + inPop * inDeath) * shieldF;
    injuries += (outPop * outInj + inPop * inInj) * shieldF;
    prevA = a;
  }
  return {deaths: Math.round(deaths), injuries: Math.round(injuries), density};
};

// Helpers
NM.haversine = function(lat1,lng1,lat2,lng2){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
};
NM.findNearestCity = function(lat,lng){
  let best=null,bd=Infinity;
  for(const c of NM.CITIES){if(!c[4])continue;const d=NM.haversine(lat,lng,c[2],c[3]);if(d<bd){bd=d;best={name:c[0],state:c[1],lat:c[2],lng:c[3],pop:c[4],dist:d}}}
  return best;
};

// Formatting
NM.fmtR = function(km){if(!isFinite(km))return'--';if(km<0.01)return Math.round(km*1000)+' m';if(km<1)return(km*1000).toFixed(0)+' m';if(km<10)return km.toFixed(2)+' km';if(km<100)return km.toFixed(1)+' km';return km.toFixed(0)+' km'};
NM.fmtArea = function(km){if(!isFinite(km))return'--';const a=Math.PI*km*km;if(a<0.01)return(a*1e6).toFixed(0)+' m\u00B2';if(a<1)return(a*100).toFixed(0)+' ha';return a.toFixed(1)+' km\u00B2'};
NM.fmtYield = function(kt){if(!isFinite(kt)||isNaN(kt))return'--';if(kt<0.001)return(kt*1e6).toFixed(0)+' g';if(kt<1)return(kt<0.01?(kt*1000).toFixed(1):(kt*1000).toFixed(0))+' tons';if(kt<1000)return(kt>=100?kt.toFixed(0):kt.toFixed(1))+' kT';return(kt/1000).toFixed(kt>=10000?0:1)+' MT'};
NM.fmtNum = function(n){if(!isFinite(n)||isNaN(n))return'--';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(n>=1e4?0:1)+'K';return Math.round(n).toLocaleString()};
NM.fmtDist = function(km){const mi=km*0.621371;return NM.fmtR(km)+' ('+(mi<1?(mi*5280).toFixed(0)+' ft':mi.toFixed(mi<10?1:0)+' mi')+')'};
NM.fmtTime = function(s){if(s<1)return(s*1000).toFixed(0)+' ms';if(s<60)return s.toFixed(1)+' sec';return(s/60).toFixed(1)+' min'};
NM.sliderToYield = function(v){return Math.pow(10,-3+(v/1000)*8)};
NM.yieldToSlider = function(kt){return((Math.log10(Math.max(kt,0.001))+3)/8)*1000};
NM.esc = function(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML};
