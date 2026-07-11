// NukeMap - Blast Wave Animation + Camera Shake + Fireball Glow
window.NM = window.NM || {};

NM.Animation = {
  active: [],
  _reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,

  blastWave(map, lat, lng, effects, duration) {
    if (this._reducedMotion) return;
    duration = duration || 3000;
    const rings = [
      {r: effects.fireball,  color: '#f5e0dc', speed: 0.15, opacity: 0.6, width: 3},
      {r: effects.psi20,     color: '#89b4fa', speed: 0.3,  opacity: 0.5, width: 2},
      {r: effects.psi5,      color: '#cba6f7', speed: 0.5,  opacity: 0.4, width: 2},
      {r: effects.thermal3,  color: '#fab387', speed: 0.55, opacity: 0.35,width: 1.5},
      {r: effects.psi1,      color: '#f9e2af', speed: 0.75, opacity: 0.3, width: 1.5},
      {r: effects.thermal1,  color: '#f5c2e7', speed: 0.85, opacity: 0.25,width: 1},
    ].filter(r => r.r > 0.001);

    const animCircles = [];
    rings.forEach(ring => {
      const c = L.circle([lat, lng], {
        radius: 1,
        color: ring.color,
        weight: ring.width,
        opacity: ring.opacity,
        fill: false,
        className: 'blast-wave-ring'
      }).addTo(map);
      animCircles.push({circle: c, targetR: ring.r * 1000, speed: ring.speed});
    });

    const start = performance.now();
    const anim = {id: Date.now(), done: false};
    this.active.push(anim);

    const tick = (now) => {
      if (anim.done) return;
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      let allDone = true;

      animCircles.forEach(ac => {
        const ringProgress = Math.max(0, Math.min(1, (progress - ac.speed * 0.2) / (1 - ac.speed * 0.2)));
        const eased = 1 - Math.pow(1 - ringProgress, 3); // ease-out cubic
        const currentR = eased * ac.targetR;
        const fade = ringProgress > 0.7 ? 1 - (ringProgress - 0.7) / 0.3 : 1;

        if (ringProgress < 1) allDone = false;
        ac.circle.setRadius(Math.max(1, currentR));
        ac.circle.setStyle({opacity: fade * 0.6});
      });

      if (progress >= 1 || allDone) {
        animCircles.forEach(ac => map.removeLayer(ac.circle));
        anim.done = true;
        const idx = NM.Animation.active.indexOf(anim);
        if (idx !== -1) NM.Animation.active.splice(idx, 1);
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  },

  flash(intensity) {
    if (this._reducedMotion) return;
    const fl = document.getElementById('flash');
    fl.style.background = intensity > 0.5
      ? 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,240,200,0.8) 40%, rgba(255,200,150,0) 70%)'
      : 'white';
    fl.classList.remove('active');
    void fl.offsetWidth;
    fl.classList.add('active');
  },

  shake(map, intensity, duration) {
    if (this._reducedMotion) return;
    duration = duration || 800;
    intensity = intensity || 3;
    const container = map.getContainer();
    const start = performance.now();
    const origTransform = container.style.transform;
    const anim = {id: Date.now(), done: false};
    this.active.push(anim);

    const tick = (now) => {
      if (anim.done) { container.style.transform = origTransform || ''; return; }
      const elapsed = now - start;
      if (elapsed > duration) {
        container.style.transform = origTransform || '';
        anim.done = true;
        return;
      }
      const decay = 1 - elapsed / duration;
      const dx = (Math.random() - 0.5) * intensity * decay * 2;
      const dy = (Math.random() - 0.5) * intensity * decay * 2;
      container.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  fireballGlow(map, lat, lng, radius, duration) {
    if (this._reducedMotion) return;
    duration = duration || 2000;
    const glow = L.circle([lat, lng], {
      radius: radius * 1000,
      color: '#fff',
      weight: 0,
      fillColor: '#ffe4b5',
      fillOpacity: 0.8,
      className: 'fireball-glow'
    }).addTo(map);

    const start = performance.now();
    const anim = {id: Date.now(), done: false};
    this.active.push(anim);
    const tick = (now) => {
      if (anim.done) { try { map.removeLayer(glow); } catch(e) {} return; }
      const elapsed = now - start;
      const p = elapsed / duration;
      if (p >= 1) { map.removeLayer(glow); anim.done = true; return; }
      const scale = 1 + p * 0.3;
      const opacity = p < 0.2 ? p / 0.2 * 0.8 : 0.8 * (1 - (p - 0.2) / 0.8);
      const colorShift = p < 0.3 ? '#fffaf0' : p < 0.6 ? '#ffe4b5' : '#ff8c00';
      glow.setRadius(radius * 1000 * scale);
      glow.setStyle({fillOpacity: Math.max(0, opacity), fillColor: colorShift});
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  _announce(msg) {
    let el = document.getElementById('a11y-announce');
    if (!el) { el = document.createElement('div'); el.id = 'a11y-announce'; el.setAttribute('role', 'log'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'false'); el.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)'; document.body.appendChild(el); }
    while (el.children.length >= 5) el.removeChild(el.firstChild);
    const span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    setTimeout(() => { try { el.removeChild(span); } catch(e) {} }, 8000);
  },

  detonateSequence(map, lat, lng, effects, yieldKt) {
    const intensity = Math.min(1, 0.3 + Math.log10(Math.max(yieldKt, 0.01)) * 0.15);
    const shakeMag = Math.min(8, 2 + Math.log10(Math.max(yieldKt, 0.1)) * 1.5);
    const animDuration = Math.min(5000, 2000 + Math.log10(Math.max(yieldKt, 1)) * 800);

    this._announce(`Detonation: ${NM.fmtYield(yieldKt)} nuclear weapon. Fireball radius ${NM.fmtR(effects.fireball)}. Blast wave expanding to ${NM.fmtR(effects.psi1)}.`);

    this.flash(intensity);
    this.fireballGlow(map, lat, lng, effects.fireball, animDuration * 0.6);
    setTimeout(() => this.shake(map, shakeMag, animDuration * 0.4), 100);
    setTimeout(() => this.blastWave(map, lat, lng, effects, animDuration), 200);
    if (NM.Sound) NM.Sound.detonate(yieldKt);
  },

  cleanup() {
    this.active.forEach(a => a.done = true);
    this.active = [];
  }
};
