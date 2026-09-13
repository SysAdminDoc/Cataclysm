# Cataclysm marketing and product design audit

## Evidence

This review used a fresh production build at a 1600 x 1000 viewport. Every image below came from the current app during this audit run:

1. `simulator-workspace-dark.png`
2. `simulator-workspace-light.png`
3. `science-evidence-dark.png`
4. `run-history-dark.png`
5. `asteroid-results-dark.png`
6. `nuclear-results-dark.png`
7. `settings-dark.png`

The older README screenshots were copied to `before/` before they were replaced.

## Walkthrough

1. Open the production browser build with the first-run notices already acknowledged.
2. Choose the Tohoku Earthquake & Tsunami scenario.
3. Run the model and wait for the Prepare, Calculate, Watch, and Understand path to finish.
4. Review the outcome, then switch to the source science view.
5. Open the local run archive and confirm the accepted run has frames, a quality state, and an identity digest.
6. Switch to Impact, pick a location near Tokyo, and review the calculated asteroid effects.
7. Switch to Nuclear, pick a location in New York, and review the calculated airburst effects.
8. Inspect the renderer settings and repeat the main tsunami state in the light theme.

## What already works

- The globe is the visual center of the product. It reads immediately as a serious simulation tool.
- Tsunami, Impact, and Nuclear are easy to find. The selected mode stays obvious.
- Results lead with the modeled outcome while still exposing uncertainty, citations, and safety limits.
- The source-science panel and immutable run archive make the work feel inspectable instead of decorative.
- The retained wavefront and fault logo fits the interface. Its cyan rings, diagonal fault line, and orange source point are distinctive at app-icon size.
- Dark and light themes are both coherent. The dark theme gives the strongest first impression for GitHub marketing.

## Marketing findings

### 1. Critical: the README did not show the product at first glance

The old README opened with a small centered logo. Readers had to scroll before seeing the simulator. A wide, version-free hero should come first and show both the brand promise and a real product state.

### 2. High: the screenshots advertised old software

The previous images displayed an older app version while the source had moved ahead. That weakens confidence in the release. The capture script now rebuilds the production app and records each major state from the current source.

### 3. High: the README buried the buying decision

The prior README was more than 46 KB and led with a very long feature inventory. The strongest reasons to try Cataclysm were hard to scan. The revised structure should answer five questions quickly: what it models, what makes it credible, what it looks like, where to download it, and what its limits are.

### 4. High: repeated screenshots would undersell the breadth

One tsunami view cannot communicate a multi-hazard simulator. The README gallery should use distinct real states: tsunami outcome, asteroid result, nuclear result, and source science. History, settings, and the light theme remain available as supporting evidence without crowding the main page.

### 5. Medium: interface text becomes dense at README scale

The app is appropriately information-rich at full size, but labels in the side panels become small when GitHub scales a screenshot. Gallery images should remain clickable at full resolution, and the hero should carry the main message in larger type rather than asking the embedded UI to do that work.

### 6. Medium: the light theme is credible but less cinematic

The light theme has good contrast and clean panel boundaries. The dark theme better supports the globe imagery, analytical overlays, and existing identity, so it should lead the marketing set.

## Accessibility risks

- Screenshot text will be difficult to read on a phone. Every README image needs descriptive alt text and nearby prose that carries the same meaning.
- Hazard rings use color heavily. The live product supplies labels and legends, but marketing copy should not describe a ring by color alone.
- The scientific panels contain long passages and compact values. They work as supporting proof, not as the first image a new user sees.
- The blurred modal backdrop preserves focus in the live interface. In a static screenshot it reduces context, so the history and settings captures should remain secondary.

## Visual selection

Candidate A was selected for the hero. Its editorial split gives the product promise enough weight while keeping a real Tohoku result visible. Candidate B is polished, but the staged screenshot dominates the headline and becomes harder to read at repository-card scale.

The selected hero contains no release number. Its screenshot is cropped below the app header, so a future version bump cannot make the hero stale.

## Evidence limits

These images came from the production web bundle in headless Chromium with the same React, Cesium, and browser physics used by the desktop UI. They do not prove Windows installer behavior, native file dialogs, signing, or GPU performance. Those checks belong to the packaged release verification and are recorded separately.
