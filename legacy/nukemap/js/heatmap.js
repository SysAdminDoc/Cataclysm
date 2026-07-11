// NukeMap - Population Heatmap Overlay (OffscreenCanvas WebWorker rendering)
window.NM = window.NM || {};

NM.Heatmap = {
  layer: null,
  visible: false,
  _worker: null,

  init(map) {
    this.map = map;
    const self = this;

    const workerCode = `
      let oc = null, ctx = null;
      self.onmessage = function(e) {
        const {type, width, height, points, zoom} = e.data;
        if (type === 'init') { oc = e.data.canvas; ctx = oc.getContext('2d'); return; }
        if (type === 'render') {
          if (!ctx) return;
          oc.width = width; oc.height = height;
          for (const p of points) {
            const intensity = Math.min(1, Math.log10(p.pop) / 7.5);
            const baseRadius = Math.max(3, Math.min(80, Math.pow(p.pop, 0.25) * (zoom / 10)));
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, baseRadius);
            g.addColorStop(0, 'rgba(243,139,168,' + (intensity * 0.6) + ')');
            g.addColorStop(0.4, 'rgba(250,179,135,' + (intensity * 0.3) + ')');
            g.addColorStop(1, 'rgba(250,179,135,0)');
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
          }
          self.postMessage({type: 'done'});
        }
      };
    `;

    const HeatLayer = L.Layer.extend({
      onAdd(map) {
        this._map = map;
        this._canvas = L.DomUtil.create('canvas', 'pop-heatmap');
        this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:400;mix-blend-mode:screen';
        map.getPanes().overlayPane.appendChild(this._canvas);

        if (typeof OffscreenCanvas !== 'undefined' && this._canvas.transferControlToOffscreen) {
          try {
            const blob = new Blob([workerCode], {type: 'application/javascript'});
            this._workerUrl = URL.createObjectURL(blob);
            this._worker = new Worker(this._workerUrl);
            this._offscreen = this._canvas.transferControlToOffscreen();
            this._worker.postMessage({type: 'init', canvas: this._offscreen}, [this._offscreen]);
            this._useWorker = true;
          } catch(e) { this._useWorker = false; }
        } else {
          this._useWorker = false;
        }

        map.on('moveend zoomend resize', this._update, this);
        this._update();
      },
      onRemove(map) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend zoomend resize', this._update, this);
        if (this._worker) { this._worker.terminate(); this._worker = null; }
        if (this._workerUrl) { URL.revokeObjectURL(this._workerUrl); this._workerUrl = null; }
      },
      _pendingRender: 0,
      _update() {
        if (this._pendingRender) cancelAnimationFrame(this._pendingRender);
        this._pendingRender = requestAnimationFrame(() => this._render());
      },
      _render() {
        this._pendingRender = 0;
        const map = this._map;
        const size = map.getSize();
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        if (zoom < 3) return;

        const points = [];
        for (const city of NM.CITIES) {
          const pop = city[4];
          if (pop < 1000) continue;
          if (!bounds.contains([city[2], city[3]])) continue;
          const pt = map.latLngToContainerPoint([city[2], city[3]]);
          points.push({x: pt.x, y: pt.y, pop});
        }

        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);

        if (this._useWorker && this._worker) {
          this._worker.postMessage({type: 'render', width: size.x, height: size.y, points, zoom});
        } else {
          this._canvas.width = size.x;
          this._canvas.height = size.y;
          const ctx = this._canvas.getContext('2d');
          for (const p of points) {
            const intensity = Math.min(1, Math.log10(p.pop) / 7.5);
            const baseRadius = Math.max(3, Math.min(80, Math.pow(p.pop, 0.25) * (zoom / 10)));
            const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, baseRadius);
            gradient.addColorStop(0, `rgba(243,139,168,${intensity * 0.6})`);
            gradient.addColorStop(0.4, `rgba(250,179,135,${intensity * 0.3})`);
            gradient.addColorStop(1, 'rgba(250,179,135,0)');
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseRadius, 0, Math.PI * 2);
            ctx.fillStyle = gradient;
            ctx.fill();
          }
        }
      }
    });

    this.layer = new HeatLayer();
  },

  toggle(map) {
    this.visible = !this.visible;
    if (this.visible) {
      this.layer.addTo(map);
    } else {
      map.removeLayer(this.layer);
    }
    return this.visible;
  }
};
