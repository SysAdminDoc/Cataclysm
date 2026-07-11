#!/usr/bin/env python3
"""
NukeMap Build Script - Bundles all files into a single offline HTML.
Usage: python build.py
Output: NukeMap-offline.html (fully self-contained)
"""
import os, re, urllib.request, sys

ROOT = os.path.dirname(os.path.abspath(__file__))

def read(path):
    with open(os.path.join(ROOT, path), 'r', encoding='utf-8') as f:
        return f.read()

def download(url):
    print(f'  Downloading {url}...')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'NukeMap-Builder/1.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode('utf-8')
    except Exception as e:
        print(f'  Warning: Could not download {url}: {e}')
        return None

def get_version():
    html = read('index.html')
    m = re.search(r'<title>NukeMap (v[\d.]+)</title>', html)
    return m.group(1) if m else 'unknown'

def build():
    version = get_version()
    print(f'NukeMap Offline Builder {version}')
    print('=' * 40)

    # Read HTML template
    html = read('index.html')

    # Download CDN resources
    leaflet_css = download('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css') or '/* Leaflet CSS unavailable */'
    leaflet_js = download('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js') or '/* Leaflet JS unavailable */'

    # Read local files
    css = read('css/styles.css')
    js_files = ['zipcodes.js','data.js','physics.js','search.js','effects.js','animation.js','sound.js',
                'mushroom3d.js','mirv.js','shelter.js','compare.js','heatmap.js',
                'extras.js','advanced.js','premium.js','immersive.js','ww3.js','app.js']
    js_all = '\n'.join(read(f'js/{f}') for f in js_files)

    # Replace CDN links with inline (lambda avoids regex backreference interpretation in replacement)
    html = re.sub(r'<link rel="stylesheet" href="https://unpkg\.com/leaflet[^"]*"[^/]*/>', lambda m: f'<style>{leaflet_css}</style>', html)
    html = re.sub(r'<link rel="stylesheet" href="css/styles\.css"\s*/>', lambda m: f'<style>{css}</style>', html)
    html = re.sub(r'<script src="https://unpkg\.com/leaflet[^"]*"[^>]*></script>', lambda m: f'<script>{leaflet_js}</script>', html)

    # Remove Three.js comment line if present
    html = re.sub(r'<!--\s*Three\.js removed[^>]*-->\s*\n?', '', html)

    # Replace local JS includes with inline
    for f in js_files:
        html = re.sub(rf'<script src="js/{re.escape(f)}"></script>', '', html)

    # Add all JS before </body>
    html = html.replace('</body>', f'<script>\n{js_all}\n</script>\n</body>')

    # Write output
    out_path = os.path.join(ROOT, 'NukeMap-offline.html')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)

    size_kb = os.path.getsize(out_path) / 1024
    print(f'\nBuilt: {out_path}')
    print(f'Size: {size_kb:.0f} KB')
    print('Done!')

if __name__ == '__main__':
    build()
