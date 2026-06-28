// NukeMap - UI string registry (English default)
window.NM = window.NM || {};

NM.STRINGS = {
  'nav.weapon': 'Weapon',
  'nav.effects': 'Effects',
  'nav.results': 'Results',
  'nav.tools': 'Tools',
  'nav.info': 'Info',
  'welcome.step.location': 'Choose a location or target',
  'welcome.step.weapon': 'Set yield, burst type, and wind conditions',
  'welcome.step.det': 'Run the detonation model',
  'welcome.step.explore': 'Review effects, casualties, shelter, and exports',
  'welcome.begin': 'Begin Simulation',
  'welcome.noshow': "Don't show again",
  'section.warhead': 'Warhead',
  'section.physics': 'Physics Model',
  'section.detonation': 'Detonation',
  'button.detonate': 'Detonate Map Center',
  'button.undo': 'Undo Last',
  'button.clear': 'Clear All',
  'button.shareLink': 'Share Link',
  'toggle.multi': 'Multiple detonations',
  'toggle.sound': 'Sound effects',
  'toggle.cloud': '3D mushroom cloud',
  'toggle.heatmap': 'Population heatmap',
  'section.emergencyGuide': 'Emergency Action Guide',
  'section.shareResults': 'Share Results',
  'button.copyLink': 'Copy Link',
  'button.copySummary': 'Copy Summary',
  'button.share': 'Share',
  'section.export': 'Export',
  'export.png': 'Export Map as PNG',
  'export.pngHd': 'Export High-DPI PNG (4x)',
  'export.svg': 'Export SVG for Print',
  'export.kml': 'Export Google Earth KML',
  'export.json': 'Export Data as JSON',
  'export.geojson': 'Export as GeoJSON',
  'export.csv': 'Export Data as CSV',
  'export.report': 'Generate Summary Report',
  'export.print': 'Print / PDF Report',
  'export.importCsv': 'Preview CSV Import',
  'guide.immediate.title': 'Immediate: Flash',
  'guide.immediate.body': 'DO NOT look toward the blast. The thermal flash causes temporary or permanent blindness. Duck behind any solid cover. Close your eyes and cover them.',
  'guide.cover.title': '0-10 seconds: Take Cover',
  'guide.cover.body': 'GET DOWN immediately. Lie flat face-down, away from windows. Cover head and neck. The blast wave arrives seconds after the flash - flying glass is the #1 cause of blast injuries.',
  'guide.down.title': '10 sec - 2 min: Stay Down',
  'guide.down.body': 'Remain in cover until the blast wave passes and reverses. Debris continues falling. Do not move until shaking stops completely.',
  'guide.move.title': '2 - 10 min: Assess & Move',
  'guide.move.body': 'If your building is damaged, move to a more substantial structure. Go to a basement or interior room. Put as many walls between you and the outside as possible. Brick/concrete reduces radiation 10-100x.',
  'guide.shelter.title': '10 min - 1 hr: Shelter In Place',
  'guide.shelter.fallout': 'Fallout begins ~10 min after a surface burst. Visible as ash/dust. Do NOT go outside. Seal windows, turn off ventilation. The first hour is the most dangerous - radiation levels are 1000x higher than at 48 hours.',
  'guide.shelter.airburst': 'Airburst produces minimal fallout. Primary danger is from fires and structural collapse. If safe to move, evacuate away from fires.',
  'guide.stay.title': '1 - 48 hr: Stay Sheltered',
  'guide.stay.fallout': '7:10 Rule: Every 7x increase in time = 10x decrease in radiation. At 49 hours, radiation is 1/100th of the 1-hour level. Stay sheltered for at least 24 hours, ideally 48-72 hours. Ration water and food.',
  'guide.stay.airburst': 'Monitor emergency broadcasts. Assist injured if safe. Do not approach ground zero - fires may burn for days.',
  'guide.supplies.title': 'Supplies to Have Ready',
  'guide.supplies.body': 'Water (1 gal/person/day for 3 days), non-perishable food, battery radio, flashlight, first aid kit, dust masks or cloth, plastic sheeting and duct tape, medications.',
  'guide.fema.title': 'FEMA 72-Hour Response Timeline',
  'guide.fema.body': 'Based on FEMA OET Nuclear Detonation Response Guidance',
};

NM.t = function(key) {
  return Object.prototype.hasOwnProperty.call(NM.STRINGS, key) ? NM.STRINGS[key] : `[[${key}]]`;
};

NM.i18n = {
  apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = NM.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.setAttribute('placeholder', NM.t(el.dataset.i18nPlaceholder)); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', NM.t(el.dataset.i18nAria)); });
    root.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', NM.t(el.dataset.i18nTitle)); });
  },
  missingKeys() {
    return Object.entries(NM.STRINGS).filter(([, value]) => !value || /^\[\[.+\]\]$/.test(value)).map(([key]) => key);
  },
};
