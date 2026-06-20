#!/usr/bin/env python3
"""Convert researched target JSON files into ww3.js target arrays."""
import json, re

def load(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

# Warhead/yield assignment by target type
def assign_wh(cat, name='', desc=''):
    cat_l = cat.lower()
    name_l = name.lower()
    desc_l = desc.lower()
    # ICBM silo fields get heavy targeting
    if 'icbm' in cat_l or 'silo' in cat_l or 'missile div' in cat_l or 'regiment' in name_l:
        return 'icbm', 2, 455
    if 'mobile icbm' in cat_l or 'garrison' in cat_l:
        return 'icbm', 2, 455
    if 'submarine' in cat_l or 'ssbn' in cat_l or 'sub base' in desc_l:
        return 'sub', 3, 455
    if 'bomber' in cat_l or 'strategic bomber' in cat_l:
        return 'bomber', 2, 455
    if 'command' in cat_l or 'c2' in cat_l or 'national command' in desc_l or 'kremlin' in name_l or 'pentagon' in name_l or 'norad' in name_l or 'stratcom' in desc_l:
        return 'c2', 2, 455
    if 'nuclear' in cat_l and 'city' not in cat_l:
        return 'nuclear', 1, 300
    if 'weapons' in cat_l or 'production' in cat_l or 'warhead' in desc_l or 'enrichment' in desc_l or 'tritium' in desc_l:
        return 'nuclear', 1, 300
    if 'military' in cat_l or 'naval' in cat_l or 'fleet' in cat_l or 'air base' in cat_l or 'army' in cat_l:
        return 'military', 1, 300
    if 'hq' in cat_l or 'nato' in cat_l:
        return 'c2', 2, 300
    if 'refiner' in cat_l:
        return 'infra', 1, 300
    if 'port' in cat_l:
        return 'infra', 1, 300
    if 'metro' in cat_l or 'city' in cat_l or 'capital' in cat_l:
        # Scale warheads by population
        pop = 0
        m = re.search(r'(\d+(?:\.\d+)?)\s*M', desc)
        if m:
            pop = float(m.group(1)) * 1e6
        m2 = re.search(r'(\d+(?:,\d+)*)K', desc)
        if m2:
            pop = int(m2.group(1).replace(',', '')) * 1000
        m3 = re.search(r'Pop[:\s~]*(\d+(?:\.\d+)?)\s*M', desc)
        if m3:
            pop = float(m3.group(1)) * 1e6
        m4 = re.search(r'Pop[:\s~]+(\d[\d,]+)', desc)
        if m4 and not m3:
            pop = int(m4.group(1).replace(',', ''))
        if pop > 10e6: return 'city', 6, 800
        if pop > 5e6: return 'city', 4, 800
        if pop > 2e6: return 'city', 3, 800
        if pop > 1e6: return 'city', 2, 800
        if pop > 500e3: return 'city', 1, 300
        return 'city', 1, 300
    return 'military', 1, 300

def fmt_entry(name, lat, lng, typ, wh, yt, cat):
    cat_s = cat.replace("'", "\\'")[:120]
    name_s = name.replace("'", "\\'")
    return f"  {{name:'{name_s}',lat:{lat:.4f},lng:{lng:.4f},type:'{typ}',warheads:{wh},yieldKt:{yt},cat:'{cat_s}'}},"

# ---- US TARGETS ----
us_data = load('data/us_targets.json')
us_lines = []
seen_us = set()
for group in us_data['targets']:
    cat = group['category']
    for t in group['targets']:
        key = f"{t['lat']:.3f},{t['lng']:.3f}"
        if key in seen_us: continue
        seen_us.add(key)
        typ, wh, yt = assign_wh(cat, t['name'], t.get('description', ''))
        # Override specific high-value targets
        n = t['name'].lower()
        if 'new york' in n: wh, yt = 6, 800
        elif 'los angeles' in n and 'port' not in n: wh, yt = 4, 800
        elif 'chicago' in n and 'refin' not in n: wh, yt = 4, 800
        elif 'washington' in n: wh, yt = 4, 800
        elif 'pentagon' in n: wh, yt = 3, 800
        elif 'icbm' in t.get('type','').lower() or 'icbm' in t['name'].lower(): wh = max(wh, 8); yt = 800
        elif 'ssbn' in t.get('type','').lower(): wh = max(wh, 3); yt = 800
        us_lines.append(fmt_entry(t['name'], t['lat'], t['lng'], typ, wh, yt, t.get('description', cat)[:120]))

# ---- RUSSIA TARGETS ----
ru_data = load('data/russia_targets.json')
ru_lines = []
seen_ru = set()
for t in ru_data['targets']:
    key = f"{t['lat']:.3f},{t['lng']:.3f}"
    if key in seen_ru: continue
    seen_ru.add(key)
    cat = t['category']
    desc = t.get('description', '')
    # Skip decommissioned
    if 'decommission' in desc.lower() or 'disbanded' in desc.lower():
        continue
    typ, wh, yt = assign_wh(cat, t['name'], desc)
    ru_lines.append(fmt_entry(t['name'], t['lat'], t['lng'], typ, wh, yt, desc[:60]))

# ---- NATO TARGETS ----
nato_data = load('data/targets.json')
nato_lines = []
seen_nato = set()
for section_key in ['nuclear_sharing_bases', 'nato_military_hq', 'uk_nuclear_facilities',
                     'french_nuclear_facilities', 'major_nato_air_bases', 'nato_capitals',
                     'major_cities_500k']:
    items = nato_data.get('nato_europe', {}).get(section_key, [])
    for t in items:
        key = f"{t['lat']:.3f},{t['lng']:.3f}"
        if key in seen_nato: continue
        seen_nato.add(key)
        typ_hint = t.get('type', section_key)
        desc = t.get('desc', '')
        typ, wh, yt = assign_wh(typ_hint, t['name'], desc)
        # Nuclear sharing bases are high priority
        if 'nuclear_sharing' in typ_hint: typ, wh, yt = 'nuclear', 2, 300
        elif 'nato_hq' in typ_hint: typ, wh, yt = 'c2', 2, 300
        elif 'uk_nuclear' in typ_hint: typ, wh, yt = 'nuclear', 2, 300
        elif 'fr_nuclear' in typ_hint: typ, wh, yt = 'nuclear', 2, 300
        elif 'capital' in typ_hint:
            # Major capitals get more
            n = t['name'].lower()
            if 'london' in n: wh, yt = 4, 800
            elif 'paris' in n: wh, yt = 3, 800
            elif 'berlin' in n: wh, yt = 2, 800
            elif 'rome' in n or 'madrid' in n or 'warsaw' in n: wh, yt = 2, 800
            else: typ = 'city'
        nato_lines.append(fmt_entry(t['name'], t['lat'], t['lng'], typ, wh, yt, desc[:60]))

# ---- CHINA TARGETS ----
cn_lines = []
seen_cn = set()
for section_key in ['icbm_silo_fields', 'mobile_icbm_bases', 'submarine_bases', 'bomber_bases',
                     'nuclear_weapons_facilities', 'command_control', 'cities_over_2m']:
    items = nato_data.get('china', {}).get(section_key, [])
    for t in items:
        key = f"{t['lat']:.3f},{t['lng']:.3f}"
        if key in seen_cn: continue
        seen_cn.add(key)
        typ_hint = t.get('type', section_key)
        desc = t.get('desc', '')
        typ, wh, yt = assign_wh(typ_hint + ' ' + section_key, t['name'], desc)
        if 'silo' in section_key: typ, wh, yt = 'icbm', 4, 455
        elif 'mobile_icbm' in section_key: typ, wh, yt = 'icbm', 2, 455
        elif 'submarine' in section_key: typ, wh, yt = 'sub', 3, 455
        elif 'bomber' in section_key: typ, wh, yt = 'bomber', 2, 455
        elif 'command' in section_key: typ, wh, yt = 'c2', 2, 455
        elif 'nuclear' in section_key or 'weapon' in section_key: typ, wh, yt = 'nuclear', 1, 300
        cn_lines.append(fmt_entry(t['name'], t['lat'], t['lng'], typ, wh, yt, desc[:60]))

print(f"US: {len(us_lines)} targets")
print(f"RU: {len(ru_lines)} targets")
print(f"NATO: {len(nato_lines)} targets")
print(f"CN: {len(cn_lines)} targets")
print(f"TOTAL: {len(us_lines)+len(ru_lines)+len(nato_lines)+len(cn_lines)} targets")

# Write output
with open('data/compiled_targets.js', 'w', encoding='utf-8') as f:
    f.write("// Auto-generated target database from verified research data\n\n")
    f.write(f"// US targets ({len(us_lines)} targets)\n")
    f.write("NM.WW3_TARGETS_US = [\n")
    f.write('\n'.join(us_lines))
    f.write("\n];\n\n")
    f.write(f"// Russian targets ({len(ru_lines)} targets)\n")
    f.write("NM.WW3_TARGETS_RU = [\n")
    f.write('\n'.join(ru_lines))
    f.write("\n];\n\n")
    f.write(f"// NATO Europe targets ({len(nato_lines)} targets)\n")
    f.write("NM.WW3_TARGETS_NATO = [\n")
    f.write('\n'.join(nato_lines))
    f.write("\n];\n\n")
    f.write(f"// Chinese targets ({len(cn_lines)} targets)\n")
    f.write("NM.WW3_TARGETS_CN = [\n")
    f.write('\n'.join(cn_lines))
    f.write("\n];\n")

print("Written to data/compiled_targets.js")
