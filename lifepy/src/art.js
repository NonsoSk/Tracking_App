/*
 * Life.py art: lifelike character portraits, Pip, painted scenes, the world map
 * and UI icons. Everything is inline SVG so the game works offline.
 *
 * Portraits are drawn from a small spec ({ age, skin, hair, hairColor, eyes,
 * shirt, ... }) with soft shading, blinking and five expressions that can be
 * switched with the data-expr attribute: neutral, smile, happy, surprised, worried.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- colour helpers ----------

  function hex2rgb(h) {
    let x = h.replace('#', '');
    if (x.length === 3) x = x.split('').map((c) => c + c).join('');
    const n = parseInt(x, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgb2hex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }

  function mix(a, b, t) {
    const A = hex2rgb(a);
    const B = hex2rgb(b);
    return rgb2hex(A.map((v, i) => v + (B[i] - v) * t));
  }

  let uid = 0;
  const nid = () => 'g' + (++uid).toString(36);

  function rng(seed) {
    let s = seed % 2147483647 || 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  function hash(str) {
    let h = 7;
    for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h;
  }

  // ---------- portraits ----------

  const GEOMETRY = {
    adult: { T: 54, B: 190, W: 50, eyeY: 124, eyeDx: 20.5, ew: 11, eh: 5.6, ir: 5.2, browDy: 15, noseBot: 154, mouthY: 172, mw: 16.5, neckW: 25, shY: 222, shW: 106 },
    elder: { T: 54, B: 191, W: 50, eyeY: 124, eyeDx: 20.5, ew: 10.5, eh: 5.1, ir: 5, browDy: 14, noseBot: 156, mouthY: 174, mw: 16, neckW: 24, shY: 222, shW: 102 },
    child: { T: 66, B: 188, W: 52, eyeY: 133, eyeDx: 20.5, ew: 11.8, eh: 6.8, ir: 6.2, browDy: 16, noseBot: 155, mouthY: 169, mw: 12, neckW: 21, shY: 228, shW: 90 },
  };

  // jaw: 0.5 is narrow and pointed, 0.85 is wide and square.
  function facePath(g) {
    const cx = 120;
    const { T, B, W } = g;
    const j = g.jaw;
    const h = B - T;
    return `M${cx} ${T} C${cx + W * 0.8} ${T} ${cx + W} ${T + h * 0.26} ${cx + W} ${T + h * 0.5} ` +
      `C${cx + W} ${T + h * (0.66 + j * 0.12)} ${cx + W * j} ${B - 3 - j * 4} ${cx} ${B} ` +
      `C${cx - W * j} ${B - 3 - j * 4} ${cx - W} ${T + h * (0.66 + j * 0.12)} ${cx - W} ${T + h * 0.5} ` +
      `C${cx - W} ${T + h * 0.26} ${cx - W * 0.8} ${T} ${cx} ${T} Z`;
  }

  // Hair is drawn in two layers: behind the head and over the forehead.
  function hairLayers(spec, g, id, col) {
    const cx = 120;
    const { T, W, B } = g;
    const fill = `url(#${id}-hair)`;
    const r = rng(hash(spec.id || spec.hair));
    let back = '';
    let front = '';
    const cap = (dip, fullness) => `M${cx - W - 3} ${T + 52} C${cx - W - 6} ${T + 4} ${cx - 30} ${T - fullness} ${cx} ${T - fullness} ` +
      `C${cx + 30} ${T - fullness} ${cx + W + 6} ${T + 4} ${cx + W + 3} ${T + 52} ` +
      `C${cx + W - 6} ${T + 26} ${cx + 26} ${T + dip} ${cx} ${T + dip} C${cx - 26} ${T + dip} ${cx - W + 6} ${T + 26} ${cx - W - 3} ${T + 52} Z`;
    const shine = (y) => `<path d="M${cx - 30} ${y} Q${cx - 6} ${y - 8} ${cx + 20} ${y - 3}" stroke="${col.light}" stroke-width="3" fill="none" opacity="0.35" stroke-linecap="round"/>`;
    const fluff = (cxx, cyy, rx, ry, n, size) => {
      let s = '';
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        s += `<circle cx="${(cxx + Math.cos(a) * rx).toFixed(1)}" cy="${(cyy + Math.sin(a) * ry).toFixed(1)}" r="${(size * (0.75 + r() * 0.5)).toFixed(1)}" fill="${fill}"/>`;
      }
      return s;
    };
    const texture = (cxx, cyy, rx, ry, n) => {
      let s = '';
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r());
        s += `<circle cx="${(cxx + Math.cos(a) * rx * d).toFixed(1)}" cy="${(cyy + Math.sin(a) * ry * d).toFixed(1)}" r="${(1.4 + r() * 2).toFixed(1)}" fill="${r() > 0.5 ? col.light : col.dark}" opacity="0.28"/>`;
      }
      return s;
    };

    switch (spec.hair) {
      case 'coily': {
        back = `<ellipse cx="${cx}" cy="${T + 34}" rx="${W + 20}" ry="${62}" fill="${fill}"/>` + fluff(cx, T + 34, W + 18, 60, 30, 9) + texture(cx, T + 30, W + 14, 56, 70);
        front = `<path d="${cap(20, 10)}" fill="${fill}"/>` + texture(cx, T + 6, W - 6, 14, 24);
        break;
      }
      case 'coilyShort': {
        back = `<ellipse cx="${cx}" cy="${T + 30}" rx="${W + 6}" ry="${44}" fill="${fill}"/>` + fluff(cx, T + 30, W + 4, 42, 26, 5) + texture(cx, T + 26, W, 36, 40);
        front = `<path d="${cap(16, 8)}" fill="${fill}"/>` + texture(cx, T + 4, W - 8, 10, 22);
        break;
      }
      case 'short': {
        front = `<path d="${cap(16, 8)}" fill="${fill}"/>` + shine(T + 2);
        for (let k = -6; k <= 6; k++) {
          front += `<path d="M${cx + k * 7.5} ${T + 15 - Math.abs(k) * 0.6 + (k * k) * 0.35} Q${cx + k * 7} ${T + 4} ${cx + k * 5.5 + 6} ${T - 5}" stroke="${k % 2 ? col.dark : col.light}" stroke-width="1.1" fill="none" opacity="${k % 2 ? 0.45 : 0.22}" stroke-linecap="round"/>`;
        }
        for (const sd of [-1, 1]) {
          front += `<path d="M${cx + sd * (W + 1)} ${T + 34} L${cx + sd * (W + 0.5)} ${g.eyeY + 4} Q${cx + sd * (W - 3)} ${g.eyeY + 5} ${cx + sd * (W - 5)} ${g.eyeY + 2} L${cx + sd * (W - 9)} ${T + 40} Z" fill="${fill}"/>`;
        }
        back = `<path d="M${cx - W - 2} ${T + 60} C${cx - W - 4} ${T + 20} ${cx + W + 4} ${T + 20} ${cx + W + 2} ${T + 60} L${cx + W - 2} ${T + 70} L${cx - W + 2} ${T + 70} Z" fill="${fill}"/>`;
        break;
      }
      case 'puffs': {
        back = `<circle cx="${cx - W + 2}" cy="${T + 4}" r="27" fill="${fill}"/><circle cx="${cx + W - 2}" cy="${T + 4}" r="27" fill="${fill}"/>` +
          fluff(cx - W + 2, T + 4, 25, 25, 14, 5) + fluff(cx + W - 2, T + 4, 25, 25, 14, 5) + texture(cx - W + 2, T + 4, 20, 20, 20) + texture(cx + W - 2, T + 4, 20, 20, 20);
        front = `<path d="${cap(14, 6)}" fill="${fill}"/><path d="M${cx} ${T - 4} L${cx} ${T + 14}" stroke="${col.dark}" stroke-width="1.6" opacity="0.6"/>`;
        break;
      }
      case 'braids': {
        for (const s of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            const x = cx + s * (W - 2 + k * 6);
            for (let y = T + 60; y < B + 70; y += 9) back += `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="6.4" fill="${fill}" stroke="${col.dark}" stroke-width="0.8"/>`;
          }
        }
        back = `<ellipse cx="${cx}" cy="${T + 40}" rx="${W + 6}" ry="54" fill="${fill}"/>` + back;
        front = `<path d="${cap(12, 6)}" fill="${fill}"/>`;
        for (let k = -3; k <= 3; k++) front += `<path d="M${cx + k * 9} ${T - 3} Q${cx + k * 13} ${T + 10} ${cx + k * 15} ${T + 20}" stroke="${col.dark}" stroke-width="1.3" fill="none" opacity="0.55"/>`;
        break;
      }
      case 'long': {
        back = `<path d="M${cx - W - 8} ${T + 46} C${cx - W - 14} ${T - 6} ${cx - 30} ${T - 16} ${cx} ${T - 16} C${cx + 30} ${T - 16} ${cx + W + 14} ${T - 6} ${cx + W + 8} ${T + 46} L${cx + W + 14} ${B + 62} C${cx + 40} ${B + 76} ${cx - 40} ${B + 76} ${cx - W - 14} ${B + 62} Z" fill="${fill}"/>`;
        front = `<path d="M${cx - W - 4} ${T + 60} C${cx - W - 6} ${T + 4} ${cx - 24} ${T - 12} ${cx + 6} ${T - 11} C${cx + 34} ${T - 10} ${cx + W + 6} ${T + 8} ${cx + W + 4} ${T + 60} C${cx + W - 4} ${T + 30} ${cx + 30} ${T + 14} ${cx + 4} ${T + 12} C${cx - 18} ${T + 14} ${cx - W + 8} ${T + 28} ${cx - W - 4} ${T + 60} Z" fill="${fill}"/>` +
          `<path d="M${cx + 4} ${T - 10} Q${cx - 14} ${T + 2} ${cx - 30} ${T + 18}" stroke="${col.dark}" stroke-width="1.2" fill="none" opacity="0.25"/>` + shine(T + 1);
        break;
      }
      case 'bun': {
        back = `<circle cx="${cx + 4}" cy="${T - 14}" r="22" fill="${fill}"/><path d="M${cx - 16} ${T - 22} Q${cx + 4} ${T - 32} ${cx + 22} ${T - 18}" stroke="${col.light}" stroke-width="2.4" fill="none" opacity="0.35"/>` +
          `<path d="M${cx - W - 4} ${T + 58} C${cx - W - 8} ${T + 10} ${cx + W + 8} ${T + 10} ${cx + W + 4} ${T + 58} Z" fill="${fill}"/>`;
        front = `<path d="${cap(18, 6)}" fill="${fill}"/><path d="M${cx - 2} ${T - 5} Q${cx - 4} ${T + 6} ${cx - 2} ${T + 17}" stroke="${col.dark}" stroke-width="1.3" fill="none" opacity="0.6"/>` + shine(T + 2);
        break;
      }
      case 'curly': {
        back = `<ellipse cx="${cx}" cy="${T + 58}" rx="${W + 17}" ry="78" fill="${fill}"/>` +
          fluff(cx, T + 58, W + 15, 76, 38, 9) + texture(cx, T + 52, W + 12, 72, 90);
        front = `<path d="${cap(18, 9)}" fill="${fill}"/>` + fluff(cx, T + 10, W - 10, 10, 14, 6);
        break;
      }
      case 'greyCurly': {
        back = `<ellipse cx="${cx}" cy="${T + 30}" rx="${W + 8}" ry="44" fill="${fill}"/>` + fluff(cx, T + 30, W + 6, 42, 28, 7);
        front = `<path d="${cap(18, 9)}" fill="${fill}"/>` + fluff(cx, T + 6, W - 10, 10, 14, 6) + texture(cx, T + 4, W - 10, 12, 20);
        break;
      }
      case 'gele': {
        const c = spec.wrap || '#d9822b';
        const c2 = mix(c, '#000000', 0.25);
        const c3 = mix(c, '#ffffff', 0.25);
        back = `<path d="M${cx - W - 30} ${T + 34} C${cx - W - 46} ${T - 34} ${cx - 16} ${T - 64} ${cx + 8} ${T - 52} C${cx + 46} ${T - 70} ${cx + W + 46} ${T - 26} ${cx + W + 30} ${T + 34} C${cx + 30} ${T + 10} ${cx - 30} ${T + 10} ${cx - W - 30} ${T + 34} Z" fill="url(#${id}-wrap)"/>` +
          `<path d="M${cx - W - 20} ${T + 6} C${cx - 30} ${T - 40} ${cx + 20} ${T - 40} ${cx + W + 22} ${T - 2}" stroke="${c2}" stroke-width="2" fill="none" opacity="0.6"/>` +
          `<path d="M${cx - W - 10} ${T - 14} C${cx - 20} ${T - 54} ${cx + 30} ${T - 52} ${cx + W + 10} ${T - 20}" stroke="${c3}" stroke-width="2.4" fill="none" opacity="0.6"/>`;
        front = `<path d="M${cx - W - 6} ${T + 34} C${cx - W - 4} ${T - 2} ${cx + W + 4} ${T - 2} ${cx + W + 6} ${T + 34} C${cx + 30} ${T + 18} ${cx - 30} ${T + 18} ${cx - W - 6} ${T + 34} Z" fill="url(#${id}-wrap)"/>` +
          `<path d="M${cx - W} ${T + 22} C${cx - 20} ${T + 6} ${cx + 20} ${T + 6} ${cx + W} ${T + 22}" stroke="${c2}" stroke-width="1.6" fill="none" opacity="0.7"/>` +
          `<path d="M${cx - 34} ${T + 4} C${cx - 10} ${T - 6} ${cx + 16} ${T - 6} ${cx + 38} ${T + 6}" stroke="${c3}" stroke-width="2" fill="none" opacity="0.7"/>`;
        break;
      }
      default:
        front = `<path d="${cap(16, 7)}" fill="${fill}"/>`;
    }
    return { back, front };
  }

  function mouths(g, col, lips) {
    const cx = 120;
    const y = g.mouthY;
    const w = g.mw;
    const up = 5 * lips;
    const lo = 8.2 * lips;
    const inside = '#3b1517';
    const lipset = (cy, wd, sm) => {
      // sm: how much the corners rise (smile) or fall (negative)
      const cy0 = cy - sm;
      return `<path d="M${cx - wd} ${cy0} C${cx - wd * 0.7} ${cy - up * 0.7} ${cx - wd * 0.45} ${cy - up * 1.15} ${cx - wd * 0.22} ${cy - up} Q${cx} ${cy - up * 0.65} ${cx + wd * 0.22} ${cy - up} C${cx + wd * 0.45} ${cy - up * 1.15} ${cx + wd * 0.7} ${cy - up * 0.7} ${cx + wd} ${cy0} Q${cx} ${cy + 1.2 + sm * 0.5} ${cx - wd} ${cy0} Z" fill="${col.lipDark}"/>
        <path d="M${cx - wd + 1.5} ${cy0 + 0.3} Q${cx - wd * 0.5} ${cy + lo * 0.95} ${cx} ${cy + lo} Q${cx + wd * 0.5} ${cy + lo * 0.95} ${cx + wd - 1.5} ${cy0 + 0.3} Q${cx} ${cy + 1.6 + sm * 0.5} ${cx - wd + 1.5} ${cy0 + 0.3} Z" fill="${col.lip}"/>
        <ellipse cx="${cx - 1.5}" cy="${cy + lo * 0.5}" rx="${wd * 0.32}" ry="${lo * 0.17}" fill="#ffffff" opacity="0.2" filter="url(#ID-soft1)"/>
        <path d="M${cx - wd - 0.5} ${cy0 - 0.2} Q${cx} ${cy + 1.5 + sm * 0.5} ${cx + wd + 0.5} ${cy0 - 0.2}" stroke="${col.lipLine}" stroke-width="1.15" fill="none" stroke-linecap="round" opacity="0.85"/>`;
    };
    return `<g class="mouth m-neutral">${lipset(y, w, 0)}</g>
      <g class="mouth m-smile">${lipset(y, w + 1.5, 2.6)}
        <path d="M${cx - w - 3} ${y - 3.6} q-1.6 1.6 -0.6 3.6 M${cx + w + 3} ${y - 3.6} q1.6 1.6 0.6 3.6" stroke="${col.skinDeep}" stroke-width="1" fill="none" opacity="0.35" stroke-linecap="round"/></g>
      <g class="mouth m-happy">
        <path d="M${cx - w - 3} ${y - 3} C${cx - w * 0.6} ${y - 4.6} ${cx + w * 0.6} ${y - 4.6} ${cx + w + 3} ${y - 3} C${cx + w * 0.7} ${y + 13 * lips} ${cx - w * 0.7} ${y + 13 * lips} ${cx - w - 3} ${y - 3} Z" fill="${inside}"/>
        <path d="M${cx - w} ${y - 2.6} C${cx - w * 0.5} ${y - 3.8} ${cx + w * 0.5} ${y - 3.8} ${cx + w} ${y - 2.6} L${cx + w - 2} ${y + 1.2} C${cx + w * 0.4} ${y + 3} ${cx - w * 0.4} ${y + 3} ${cx - w + 2} ${y + 1.2} Z" fill="#f3eee6"/>
        <ellipse cx="${cx}" cy="${y + 8.5 * lips}" rx="${w * 0.45}" ry="2.6" fill="#a8474f" opacity="0.9"/>
        <path d="M${cx - w - 3} ${y - 3} C${cx - w * 0.7} ${y + 13 * lips} ${cx + w * 0.7} ${y + 13 * lips} ${cx + w + 3} ${y - 3}" stroke="${col.lip}" stroke-width="${3.2 * lips}" fill="none" stroke-linecap="round"/>
        <path d="M${cx - w - 3} ${y - 3} C${cx - w * 0.6} ${y - 4.6 - up * 0.6} ${cx - w * 0.2} ${y - 5.2 - up * 0.4} ${cx} ${y - 4.6 - up * 0.25} C${cx + w * 0.2} ${y - 5.2 - up * 0.4} ${cx + w * 0.6} ${y - 4.6 - up * 0.6} ${cx + w + 3} ${y - 3}" stroke="${col.lipDark}" stroke-width="${2.6 * lips}" fill="none" stroke-linecap="round"/>
        <path d="M${cx - w - 6} ${y - 5} q-2 3 0 6 M${cx + w + 6} ${y - 5} q2 3 0 6" stroke="${col.skinDeep}" stroke-width="1.1" fill="none" opacity="0.35" stroke-linecap="round"/></g>
      <g class="mouth m-surprised">
        <ellipse cx="${cx}" cy="${y + 2.5}" rx="${w * 0.45}" ry="${w * 0.55}" fill="${inside}"/>
        <ellipse cx="${cx}" cy="${y + 2.5}" rx="${w * 0.45}" ry="${w * 0.55}" fill="none" stroke="${col.lip}" stroke-width="${3.4 * lips}"/>
        <path d="M${cx - w * 0.45} ${y - 0.5} Q${cx} ${y - w * 0.7} ${cx + w * 0.45} ${y - 0.5}" stroke="${col.lipDark}" stroke-width="${2.4 * lips}" fill="none"/></g>
      <g class="mouth m-worried">${lipset(y + 1, w - 1.5, -1.8)}</g>`;
  }

  function brows(g, col) {
    const cx = 120;
    const y = g.eyeY - g.browDy;
    const one = (s, lift, innerLift) => {
      const inX = cx + s * 7.5;
      const outX = cx + s * (g.eyeDx + g.ew + 3);
      const peakX = cx + s * (g.eyeDx + 3);
      const inY = y + 3 - innerLift;
      const peakY = y - 3.5 - lift;
      const outY = y + 2 - lift * 0.4;
      return `<path d="M${inX} ${inY} Q${peakX} ${peakY - 1.5} ${outX} ${outY} Q${peakX} ${peakY + 2.8} ${inX} ${inY + 3.6} Z" fill="${col.brow}"/>`;
    };
    return `<g filter="url(#ID-soft05)"><g class="brows b-normal">${one(-1, 0, 0)}${one(1, 0, 0)}</g>` +
      `<g class="brows b-raised">${one(-1, 3.5, 2)}${one(1, 3.5, 2)}</g>` +
      `<g class="brows b-worried">${one(-1, -1, 4)}${one(1, -1, 4)}</g></g>`;
  }

  function eyes(spec, g, id, col, look) {
    const cx = 120;
    const y = g.eyeY;
    const lidSkin = mix(col.skin, col.skinDeep, 0.14);
    let open = '';
    let happy = '';
    let lids = '';
    let extra = '';
    // One eye: the white, iris and lids clipped to an almond shape. `lift` raises the
    // lower lid for smiling eyes.
    const one = (side, lift, key) => {
      const ex = cx + side * g.eyeDx;
      const ew = g.ew;
      const eh = g.eh;
      const inner = ex - side * ew;
      const outer = ex + side * ew;
      const lowY = y + eh * (1.35 - lift * 1.5);
      const topY = y - eh * (1.8 - lift * 0.35);
      const almond = `M${inner} ${y + 1} Q${ex - side * ew * 0.2} ${topY} ${outer} ${y - 0.6} Q${ex} ${lowY} ${inner} ${y + 1} Z`;
      const ix = ex + look * 1.7;
      const iy = y + 0.2 - lift * 1.5;
      const cid = `${id}-eye${key}${side}`;
      return `<clipPath id="${cid}"><path d="${almond}"/></clipPath>
        <path d="${almond}" fill="#ece3da"/>
        <g clip-path="url(#${cid})">
          <circle cx="${ix}" cy="${iy}" r="${g.ir}" fill="url(#${id}-iris)"/>
          <circle cx="${ix}" cy="${iy}" r="${g.ir * 0.44}" fill="#0a0605"/>
          <circle cx="${ix + g.ir * 0.36}" cy="${iy - g.ir * 0.42}" r="${g.ir * 0.24}" fill="#ffffff" opacity="0.92"/>
          <circle cx="${ix - g.ir * 0.38}" cy="${iy + g.ir * 0.36}" r="${g.ir * 0.1}" fill="#ffffff" opacity="0.45"/>
          <ellipse cx="${ex}" cy="${y - eh * 1.25}" rx="${ew + 2}" ry="${eh * 0.95}" fill="#000000" opacity="0.22" filter="url(#${id}-soft1)"/>
          <ellipse cx="${outer}" cy="${y}" rx="3.5" ry="${eh}" fill="${col.skinDeep}" opacity="0.18" filter="url(#${id}-soft1)"/>
        </g>
        <path d="M${inner - side * 0.6} ${y + 0.9} Q${ex - side * ew * 0.2} ${topY - eh * 0.15} ${outer + side * 1.6} ${y - 1}" stroke="${col.lash}" stroke-width="${spec.lashes ? 2.6 : 2}" fill="none" stroke-linecap="round"/>
        ${spec.lashes ? `<path d="M${ex + side * ew * 0.35} ${topY + eh * 0.55} Q${outer} ${y - eh * 0.9} ${outer + side * 2.6} ${y - 1.6}" stroke="${col.lash}" stroke-width="2.6" fill="none" stroke-linecap="round"/>` : ''}
        <path d="M${inner + side * 4} ${y + eh * (0.95 - lift * 1.3)} Q${ex} ${lowY + eh * 0.2} ${outer - side * 2.5} ${y + eh * (0.45 - lift * 0.8)}" stroke="${col.skinDeep}" stroke-width="${0.9 + lift * 0.4}" fill="none" opacity="${0.35 + lift * 0.15}" stroke-linecap="round"/>`;
    };
    [-1, 1].forEach((side) => {
      const ex = cx + side * g.eyeDx;
      const ew = g.ew;
      const eh = g.eh;
      const inner = ex - side * ew;
      const outer = ex + side * ew;
      open += one(side, 0, 'o');
      happy += one(side, 0.62, 'h');
      extra += `<path d="M${inner + side * 1.5} ${y - eh * 1.7} Q${ex - side * ew * 0.1} ${y - eh * 2.75} ${outer - side * 0.5} ${y - eh * 1.6}" stroke="${col.skinDeep}" stroke-width="1.1" fill="none" opacity="0.35" stroke-linecap="round" filter="url(#${id}-soft05)"/>
        ${spec.age === 'elder' ? `<path d="M${inner + side * 3} ${y + eh * 2} Q${ex} ${y + eh * 2.9} ${outer - side * 3} ${y + eh * 1.8}" stroke="${col.skinDeep}" stroke-width="1" fill="none" opacity="0.3" filter="url(#${id}-soft05)"/>
          <path d="M${outer + side * 3} ${y - 1} l${side * 5} -2 M${outer + side * 3} ${y + 2} l${side * 5} 1.5" stroke="${col.skinDeep}" stroke-width="0.9" opacity="0.3"/>` : ''}`;
      const top = y - eh * 2;
      lids += `<g class="lid" style="transform-origin:${ex}px ${top}px"><path d="M${inner - side * 2} ${y + 1.3} Q${ex - side * ew * 0.2} ${y - eh * 2.1} ${outer + side * 2} ${y - 1} L${outer + side * 2} ${y + 0.5} Q${ex} ${y + eh * 1.55} ${inner - side * 2} ${y + 1.3} Z" fill="${lidSkin}"/>
        <path d="M${inner - side * 1} ${y + 1.2} Q${ex} ${y + eh * 1.35} ${outer + side * 1.4} ${y - 0.4}" stroke="${col.lash}" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;
    });
    return `${extra}<g class="eyes-open">${open}<g class="lids">${lids}</g></g><g class="eyes-happy">${happy}</g>`;
  }

  function lightness(hex) {
    const [r, g, b] = hex2rgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function portrait(spec, opts) {
    opts = opts || {};
    const id = nid();
    const age = spec.age || 'adult';
    const base = GEOMETRY[age];
    const g = Object.assign({}, base, {
      W: base.W * (spec.faceW || 1),
      jaw: spec.jaw != null ? spec.jaw : (spec.beard || spec.mustache ? 0.72 : 0.6),
    });
    const cx = 120;
    const skin = spec.skin;
    const hair = spec.hairColor || '#1c1411';
    const L = lightness(skin);
    const col = {
      skin,
      skinLight: mix(skin, '#fff3e6', 0.2),
      skinDark: mix(skin, '#2a1208', 0.24),
      skinDeep: mix(skin, '#1a0a05', 0.55),
      lip: mix(skin, '#a3404a', 0.18 + L * 0.3),
      lipDark: mix(mix(skin, '#8a3040', 0.18 + L * 0.3), '#1a0505', 0.3),
      lipLine: mix(skin, '#1a0505', 0.62),
      light: mix(hair, '#ffffff', 0.32),
      dark: mix(hair, '#000000', 0.4),
      brow: lightness(hair) > 0.55 ? mix(hair, '#3a3330', 0.55) : mix(hair, '#000000', 0.15),
      lash: mix(hair, '#0a0605', 0.75),
    };
    const blush = spec.blush != null ? spec.blush : 0.04 + Math.max(0, L - 0.35) * 0.45;
    const shirt = spec.shirt || '#3d6fb6';
    const look = opts.look || 0;
    const lips = spec.lips || 1;
    const hairL = hairLayers(spec, g, id, col);
    const { T, B, W, eyeY, shY, shW, neckW, noseBot, mouthY } = g;
    const H = B - T;
    const neckTop = B - 34;
    const face = facePath(g);
    const necklineD = spec.collar === 'v' ? `L${cx} ${shY + 34}` : `Q${cx} ${shY + 24}`;
    const bodyPath = `M${cx - shW - 34} 300 C${cx - shW - 30} ${shY + 30} ${cx - shW + 10} ${shY - 2} ${cx - neckW - 10} ${shY - 10} ${necklineD} ${cx + neckW + 10} ${shY - 10} C${cx + shW - 10} ${shY - 2} ${cx + shW + 30} ${shY + 30} ${cx + shW + 34} 300 Z`;
    const collar = spec.collar === 'shirt'
      ? `<path d="M${cx - neckW - 10} ${shY - 10} L${cx - 3} ${shY + 24} L${cx - neckW - 22} ${shY + 16} Z" fill="${mix(shirt, '#ffffff', 0.18)}"/><path d="M${cx + neckW + 10} ${shY - 10} L${cx + 3} ${shY + 24} L${cx + neckW + 22} ${shY + 16} Z" fill="${mix(shirt, '#ffffff', 0.1)}"/>`
      : `<path d="M${cx - neckW - 10} ${shY - 10} ${necklineD} ${cx + neckW + 10} ${shY - 10}" stroke="${mix(shirt, '#000000', 0.25)}" stroke-width="3" fill="none"/>`;
    const pattern = spec.pattern
      ? `<pattern id="${id}-pat" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><circle cx="6" cy="6" r="3.2" fill="${spec.pattern}"/><path d="M14 16 l5 -5 l5 5 l-5 5 z" fill="${spec.pattern}"/></pattern>`
      : '';
    const glasses = spec.glasses
      ? `<g class="glasses">${[-1, 1].map((sd) => {
        const ex = cx + sd * g.eyeDx;
        return `<rect x="${ex - g.ew - 5}" y="${eyeY - g.eh - 6}" width="${(g.ew + 5) * 2}" height="${g.eh * 2 + 11}" rx="7" fill="#ffffff" fill-opacity="0.06" stroke="#3a302b" stroke-width="2"/>` +
          `<path d="M${ex - g.ew - 1} ${eyeY - g.eh - 3} l6 0" stroke="#ffffff" stroke-width="1.5" opacity="0.35"/>`;
      }).join('')}<path d="M${cx - g.eyeDx + g.ew + 5} ${eyeY - 2} Q${cx} ${eyeY - 6} ${cx + g.eyeDx - g.ew - 5} ${eyeY - 2}" stroke="#3a302b" stroke-width="2" fill="none"/>
        <path d="M${cx - g.eyeDx - g.ew - 5} ${eyeY - 3} L${cx - W} ${eyeY - 1}" stroke="#3a302b" stroke-width="2"/><path d="M${cx + g.eyeDx + g.ew + 5} ${eyeY - 3} L${cx + W} ${eyeY - 1}" stroke="#3a302b" stroke-width="2"/></g>`
      : '';
    const earrings = spec.earrings
      ? `<circle cx="${cx - W + 1}" cy="${eyeY + 21}" r="3.2" fill="url(#${id}-gold)"/><circle cx="${cx + W - 1}" cy="${eyeY + 21}" r="3.2" fill="url(#${id}-gold)"/>`
      : '';
    const beard = spec.beard
      ? `<g filter="url(#${id}-soft05)"><path d="M${cx - W + 2} ${eyeY + 16} C${cx - W + 4} ${B - 4} ${cx - 24} ${B + 10} ${cx} ${B + 10} C${cx + 24} ${B + 10} ${cx + W - 4} ${B - 4} ${cx + W - 2} ${eyeY + 16} L${cx + W - 8} ${eyeY + 22} C${cx + W - 12} ${mouthY + 6} ${cx + 18} ${mouthY + 14} ${cx} ${mouthY + 14} C${cx - 18} ${mouthY + 14} ${cx - W + 12} ${mouthY + 6} ${cx - W + 8} ${eyeY + 22} Z" fill="${hair}" opacity="0.94"/>` +
        Array.from({ length: 34 }, (_, i) => {
          const a = -0.1 + (i / 33) * (Math.PI + 0.2);
          const rr = W - 12 - (i % 3) * 4;
          const x = cx + Math.cos(a) * rr;
          const y = mouthY + 2 + Math.sin(a) * (B - mouthY - 6);
          return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} l${(Math.cos(a) * 2.5).toFixed(1)} ${(Math.sin(a) * 4).toFixed(1)}" stroke="${i % 2 ? col.light : col.dark}" stroke-width="1" opacity="0.35"/>`;
        }).join('') + '</g>'
      : '';
    const mustache = spec.beard || spec.mustache
      ? `<path d="M${cx - g.mw - 5} ${mouthY - 1} C${cx - g.mw} ${mouthY - 8} ${cx - 8} ${mouthY - 11} ${cx} ${mouthY - 8.5} C${cx + 8} ${mouthY - 11} ${cx + g.mw} ${mouthY - 8} ${cx + g.mw + 5} ${mouthY - 1} C${cx + g.mw - 2} ${mouthY - 5} ${cx + 8} ${mouthY - 5.5} ${cx} ${mouthY - 4.5} C${cx - 8} ${mouthY - 5.5} ${cx - g.mw + 2} ${mouthY - 5} ${cx - g.mw - 5} ${mouthY - 1} Z" fill="${hair}" filter="url(#${id}-soft05)"/>`
      : '';
    const elderLines = age === 'elder'
      ? `<g filter="url(#${id}-soft05)"><path d="M${cx - 15} ${noseBot + 2} Q${cx - 23} ${mouthY - 2} ${cx - 20} ${mouthY + 9}" stroke="${col.skinDeep}" stroke-width="1.4" fill="none" opacity="0.32"/>
         <path d="M${cx + 15} ${noseBot + 2} Q${cx + 23} ${mouthY - 2} ${cx + 20} ${mouthY + 9}" stroke="${col.skinDeep}" stroke-width="1.4" fill="none" opacity="0.32"/>
         <path d="M${cx - 22} ${T + 28} Q${cx} ${T + 23} ${cx + 22} ${T + 28} M${cx - 18} ${T + 36} Q${cx} ${T + 32} ${cx + 18} ${T + 36}" stroke="${col.skinDeep}" stroke-width="1" fill="none" opacity="0.2"/></g>`
      : '';
    const ns = age === 'child' ? 0.8 : 1;
    const nw = (spec.nose || 1) * ns;
    // Light comes from the upper left: soft painted shading is blurred, then clipped to the face.
    const shading = `<g clip-path="url(#${id}-face)"><g filter="url(#${id}-soft3)">
        <ellipse cx="${cx + W * 0.95}" cy="${T + H * 0.55}" rx="${W * 0.42}" ry="${H * 0.62}" fill="${col.skinDeep}" opacity="0.32"/>
        <ellipse cx="${cx - W * 1.05}" cy="${T + H * 0.6}" rx="${W * 0.22}" ry="${H * 0.5}" fill="${col.skinDeep}" opacity="0.18"/>
        <ellipse cx="${cx}" cy="${B + 4}" rx="${W * 0.9}" ry="14" fill="${col.skinDeep}" opacity="0.3"/>
        <ellipse cx="${cx}" cy="${T + 4}" rx="${W * 0.95}" ry="${age === 'child' ? 10 : 12}" fill="${col.skinDeep}" opacity="0.32"/>
        <ellipse cx="${cx - 8}" cy="${T + H * 0.2}" rx="${W * 0.5}" ry="${H * 0.1}" fill="${col.skinLight}" opacity="0.55"/>
        ${[-1, 1].map((sd) => `<ellipse cx="${cx + sd * g.eyeDx}" cy="${eyeY - 3}" rx="${g.ew + 5}" ry="${g.eh + 6}" fill="${col.skinDeep}" opacity="${sd < 0 ? 0.2 : 0.28}"/>`).join('')}
        <ellipse cx="${cx - g.eyeDx - 4}" cy="${eyeY + 20}" rx="15" ry="9" fill="${col.skinLight}" opacity="0.5"/>
        <ellipse cx="${cx + g.eyeDx + 6}" cy="${eyeY + 20}" rx="12" ry="8" fill="${col.skinLight}" opacity="0.22"/>
        <ellipse cx="${cx - g.eyeDx - 4}" cy="${eyeY + 24}" rx="14" ry="8" fill="#d0505a" opacity="${blush}"/>
        <ellipse cx="${cx + g.eyeDx + 4}" cy="${eyeY + 24}" rx="14" ry="8" fill="#d0505a" opacity="${blush}"/>
        <path d="M${cx + 5 * nw} ${eyeY + 2} Q${cx + 8 * nw} ${noseBot - 12} ${cx + 10 * nw} ${noseBot - 3}" stroke="${col.skinDeep}" stroke-width="${6 * nw}" fill="none" opacity="0.32"/>
        <path d="M${cx - 2} ${eyeY + 4} L${cx - 3} ${noseBot - 8}" stroke="${col.skinLight}" stroke-width="4" opacity="0.5"/>
        <ellipse cx="${cx + 2}" cy="${noseBot + 6}" rx="${11 * nw}" ry="3.6" fill="${col.skinDeep}" opacity="0.35"/>
        <ellipse cx="${cx}" cy="${mouthY + 10 * lips}" rx="${g.mw * 0.7}" ry="3.2" fill="${col.skinDeep}" opacity="0.32"/>
        <ellipse cx="${cx - 3}" cy="${B - 13}" rx="11" ry="6" fill="${col.skinLight}" opacity="0.45"/>
        <ellipse cx="${cx + W * 0.62}" cy="${mouthY + 2}" rx="10" ry="18" fill="${col.skinDeep}" opacity="0.18"/>
      </g></g>`;
    const nose = `<g transform="translate(${cx} ${noseBot}) scale(${nw} ${ns}) translate(${-cx} ${-noseBot})">
      <path d="M${cx - 11} ${noseBot - 4} Q${cx - 13.5} ${noseBot + 4} ${cx - 6} ${noseBot + 4} M${cx + 11} ${noseBot - 4} Q${cx + 13.5} ${noseBot + 4} ${cx + 6} ${noseBot + 4}" stroke="${col.skinDeep}" stroke-width="1.6" fill="none" opacity="0.4" stroke-linecap="round" filter="url(#${id}-soft05)"/>
      <ellipse cx="${cx - 5.2}" cy="${noseBot + 2.6}" rx="2.9" ry="1.5" fill="${col.skinDeep}" opacity="0.7" filter="url(#${id}-soft05)"/>
      <ellipse cx="${cx + 5.2}" cy="${noseBot + 2.6}" rx="2.9" ry="1.5" fill="${col.skinDeep}" opacity="0.75" filter="url(#${id}-soft05)"/>
      <ellipse cx="${cx - 1.5}" cy="${noseBot - 4}" rx="3.6" ry="2.6" fill="#ffffff" opacity="0.18" filter="url(#${id}-soft1)"/></g>`;
    const ears = [-1, 1].map((sd) => `<ellipse cx="${cx + sd * (W - 1)}" cy="${eyeY + 7}" rx="7.5" ry="13" fill="${sd < 0 ? col.skin : col.skinDark}"/><path d="M${cx + sd * (W + 1.5)} ${eyeY - 1} q${sd * 3.4} 7 0 15" stroke="${col.skinDeep}" stroke-width="1.6" fill="none" opacity="0.45" filter="url(#${id}-soft05)"/>`).join('');

    return `<svg class="actor" data-expr="${opts.expr || 'neutral'}" viewBox="0 0 240 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="${id}-face"><path d="${face}"/></clipPath>
        <filter id="${id}-soft3" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${age === 'child' ? 4 : 3.4}"/></filter>
        <filter id="${id}-soft1" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1"/></filter>
        <filter id="${id}-soft05" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.55"/></filter>
        <radialGradient id="${id}-skin" cx="0.42" cy="0.38" r="0.72"><stop offset="0" stop-color="${mix(skin, '#fff3e6', 0.08)}"/><stop offset="0.7" stop-color="${skin}"/><stop offset="1" stop-color="${col.skinDark}"/></radialGradient>
        <linearGradient id="${id}-neck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0.38"/><stop offset="0.45" stop-color="#000000" stop-opacity="0.08"/><stop offset="1" stop-color="#000000" stop-opacity="0.02"/></linearGradient>
        <linearGradient id="${id}-neckside" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000000" stop-opacity="0.05"/><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.25"/></linearGradient>
        <radialGradient id="${id}-iris" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${mix(spec.eyes || '#3b2416', '#000000', 0.5)}"/><stop offset="0.5" stop-color="${spec.eyes || '#3b2416'}"/><stop offset="0.8" stop-color="${mix(spec.eyes || '#3b2416', '#ffffff', 0.14)}"/><stop offset="1" stop-color="${mix(spec.eyes || '#3b2416', '#000000', 0.6)}"/></radialGradient>
        <linearGradient id="${id}-hair" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${mix(hair, '#ffffff', 0.12)}"/><stop offset="0.55" stop-color="${hair}"/><stop offset="1" stop-color="${col.dark}"/></linearGradient>
        <linearGradient id="${id}-cloth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(shirt, '#ffffff', 0.1)}"/><stop offset="1" stop-color="${mix(shirt, '#000000', 0.3)}"/></linearGradient>
        <radialGradient id="${id}-clothshade" cx="0.32" cy="0.15" r="0.95"><stop offset="0" stop-color="#ffffff" stop-opacity="0.12"/><stop offset="0.6" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.3"/></radialGradient>
        <linearGradient id="${id}-wrap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(spec.wrap || '#d9822b', '#ffffff', 0.2)}"/><stop offset="0.6" stop-color="${spec.wrap || '#d9822b'}"/><stop offset="1" stop-color="${mix(spec.wrap || '#d9822b', '#000000', 0.3)}"/></linearGradient>
        <radialGradient id="${id}-gold" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#fff1b8"/><stop offset="1" stop-color="#b8862b"/></radialGradient>
        ${pattern}
      </defs>
      <g class="breathe">
        ${hairL.back}
        <path d="M${cx - neckW} ${neckTop} C${cx - neckW - 1} ${shY - 14} ${cx - neckW - 4} ${shY - 4} ${cx - neckW - 12} ${shY} Q${cx} ${shY + 22} ${cx + neckW + 12} ${shY} C${cx + neckW + 4} ${shY - 4} ${cx + neckW + 1} ${shY - 14} ${cx + neckW} ${neckTop} Z" fill="${skin}"/>
        <path d="M${cx - neckW} ${neckTop} C${cx - neckW - 1} ${shY - 14} ${cx - neckW - 4} ${shY - 4} ${cx - neckW - 12} ${shY} Q${cx} ${shY + 22} ${cx + neckW + 12} ${shY} C${cx + neckW + 4} ${shY - 4} ${cx + neckW + 1} ${shY - 14} ${cx + neckW} ${neckTop} Z" fill="url(#${id}-neck)"/>
        <path d="M${cx - neckW} ${neckTop} C${cx - neckW - 1} ${shY - 14} ${cx - neckW - 4} ${shY - 4} ${cx - neckW - 12} ${shY} Q${cx} ${shY + 22} ${cx + neckW + 12} ${shY} C${cx + neckW + 4} ${shY - 4} ${cx + neckW + 1} ${shY - 14} ${cx + neckW} ${neckTop} Z" fill="url(#${id}-neckside)"/>
        <path d="${bodyPath}" fill="url(#${id}-cloth)"/>
        ${spec.pattern ? `<path d="${bodyPath}" fill="url(#${id}-pat)" opacity="0.35"/>` : ''}
        <path d="${bodyPath}" fill="url(#${id}-clothshade)"/>
        <path d="M${cx - shW + 12} ${shY + 36} q-8 30 -12 60 M${cx + shW - 12} ${shY + 36} q8 30 12 60" stroke="${mix(shirt, '#000000', 0.3)}" stroke-width="2.5" fill="none" opacity="0.3" filter="url(#${id}-soft1)"/>
        ${collar}
        ${ears}
        <path d="${face}" fill="url(#${id}-skin)"/>
        ${shading}
        ${eyes(spec, g, id, col, look)}
        ${brows(g, col).replace(/ID-/g, id + '-')}
        ${nose}
        ${elderLines}
        ${beard}
        ${mustache}
        ${mouths(g, col, lips).replace(/ID-/g, id + '-')}
        <g filter="url(#${id}-soft05)">${hairL.front}</g>
        ${earrings}
        ${glasses}
      </g>
    </svg>`;
  }

  // ---------- Pip ----------

  function pip(state, opts) {
    const id = nid();
    const label = opts && opts.label;
    return `<svg class="pip3d" data-state="${state || 'idle'}" viewBox="0 0 160 200" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'} focusable="false">
      <defs>
        <radialGradient id="${id}-b" cx="0.35" cy="0.25" r="0.85"><stop offset="0" stop-color="#7e9dff"/><stop offset="0.55" stop-color="#3559de"/><stop offset="1" stop-color="#1c2f8f"/></radialGradient>
        <linearGradient id="${id}-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16244f"/><stop offset="1" stop-color="#080d22"/></linearGradient>
        <radialGradient id="${id}-bulb" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="#f2b42c"/></radialGradient>
        <filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <ellipse class="pip-shadow" cx="80" cy="190" rx="34" ry="6" fill="#000000" opacity="0.22"/>
      <g class="pip-float">
        <line x1="80" y1="30" x2="80" y2="14" stroke="#24379e" stroke-width="4" stroke-linecap="round"/>
        <circle class="pip-bulb" cx="80" cy="11" r="7" fill="url(#${id}-bulb)" filter="url(#${id}-glow)"/>
        <rect x="58" y="120" width="44" height="44" rx="18" fill="url(#${id}-b)"/>
        <circle cx="80" cy="140" r="6" fill="#ffd76a" filter="url(#${id}-glow)" opacity="0.9"/>
        <rect class="pip-arm-l" x="36" y="128" width="22" height="12" rx="6" fill="url(#${id}-b)"/>
        <rect class="pip-arm-r" x="102" y="128" width="22" height="12" rx="6" fill="url(#${id}-b)"/>
        <rect x="18" y="26" width="124" height="98" rx="36" fill="url(#${id}-b)"/>
        <path d="M38 40 Q62 30 96 32" stroke="#ffffff" stroke-width="6" fill="none" opacity="0.28" stroke-linecap="round"/>
        <rect x="32" y="42" width="96" height="68" rx="24" fill="url(#${id}-s)"/>
        <path d="M44 52 Q70 46 100 49" stroke="#ffffff" stroke-width="3" fill="none" opacity="0.1" stroke-linecap="round"/>
        <g class="pface" fill="#ffd76a" stroke="#ffd76a" filter="url(#${id}-glow)">
          <g class="pe pe-open"><rect x="58" y="62" width="10" height="16" rx="5" stroke="none"/><rect x="92" y="62" width="10" height="16" rx="5" stroke="none"/></g>
          <g class="pe pe-happy"><path d="M56 74 q7 -10 14 0 M90 74 q7 -10 14 0" fill="none" stroke-width="4" stroke-linecap="round"/></g>
          <g class="pe pe-closed"><path d="M56 70 q7 6 14 0 M90 70 q7 6 14 0" fill="none" stroke-width="4" stroke-linecap="round"/></g>
          <g class="pm pm-smile"><path d="M70 90 q10 8 20 0" fill="none" stroke-width="4" stroke-linecap="round"/></g>
          <g class="pm pm-open"><ellipse cx="80" cy="92" rx="6" ry="6.5" stroke="none"/></g>
          <g class="pm pm-flat"><path d="M71 93 h18" fill="none" stroke-width="4" stroke-linecap="round"/></g>
          <g class="pm pm-talk"><rect class="talkbar" x="70" y="88" width="20" height="8" rx="4" stroke="none"/></g>
          <g class="pbrow"><path d="M90 56 l14 -4" fill="none" stroke-width="3.5" stroke-linecap="round"/></g>
        </g>
      </g>
    </svg>`;
  }

  // ---------- painted scenes ----------

  // Backgrounds are softly blurred and muted so the characters stand out.
  function frame(id, inner, tone) {
    return `<svg class="scene" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <filter id="${id}-dof" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.4"/><feColorMatrix type="saturate" values="0.82"/></filter>
        <radialGradient id="${id}-vig" cx="0.5" cy="0.45" r="0.75"><stop offset="0.55" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${tone || 0.32}"/></radialGradient>
        <radialGradient id="${id}-bokeh" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffe2a8" stop-opacity="0.9"/><stop offset="1" stop-color="#ffe2a8" stop-opacity="0"/></radialGradient>
      </defs>
      <g filter="url(#${id}-dof)">${inner}</g>
      <rect width="800" height="500" fill="url(#${id}-vig)"/>
    </svg>`;
  }

  function homeScene() {
    const id = nid();
    let s = `<defs>
      <linearGradient id="${id}-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9b29c"/><stop offset="1" stop-color="#b39478"/></linearGradient>
      <linearGradient id="${id}-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7f583d"/><stop offset="1" stop-color="#5c3d29"/></linearGradient>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bcd6e6"/><stop offset="1" stop-color="#f1dcc0"/></linearGradient>
      <linearGradient id="${id}-sofa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f7f7d"/><stop offset="1" stop-color="#3f5958"/></linearGradient>
      <linearGradient id="${id}-beam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4dc" stop-opacity="0.5"/><stop offset="1" stop-color="#fff4dc" stop-opacity="0"/></linearGradient>
      <radialGradient id="${id}-bal1" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#f3a99c"/><stop offset="1" stop-color="#c9634f"/></radialGradient>
      <radialGradient id="${id}-bal2" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#a8c4e8"/><stop offset="1" stop-color="#5a7fb8"/></radialGradient>
      <radialGradient id="${id}-bal3" cx="0.35" cy="0.3" r="0.7"><stop offset="0" stop-color="#f2d59a"/><stop offset="1" stop-color="#c79a3d"/></radialGradient>
    </defs>
    <rect width="800" height="500" fill="url(#${id}-wall)"/>
    <rect x="470" y="70" width="200" height="230" rx="4" fill="url(#${id}-sky)"/>
    <path d="M490 300 L520 210 L560 240 L600 190 L650 300 Z" fill="#9db58f" opacity="0.6"/>
    <path d="M570 70 v230 M470 185 h200" stroke="#e8ddd0" stroke-width="8"/>
    <rect x="462" y="62" width="216" height="246" rx="6" fill="none" stroke="#efe6da" stroke-width="10"/>
    <path d="M440 50 C455 150 450 260 430 330 L470 330 C478 240 476 140 470 50 Z" fill="#8c5b4a"/>
    <path d="M700 50 C685 150 690 260 710 330 L670 330 C662 240 664 140 670 50 Z" fill="#8c5b4a"/>
    <polygon points="470,80 670,80 790,500 330,500" fill="url(#${id}-beam)" opacity="0.5"/>
    <rect x="120" y="96" width="92" height="70" rx="3" fill="#8a6a52"/><rect x="128" y="104" width="76" height="54" fill="#d9c7a8"/>
    <rect x="236" y="120" width="60" height="78" rx="3" fill="#8a6a52"/><rect x="242" y="126" width="48" height="66" fill="#b7c3b2"/>
    <rect y="350" width="800" height="150" fill="url(#${id}-floor)"/>
    <path d="M0 380 h800 M0 420 h800 M0 465 h800" stroke="#4c3222" stroke-width="2" opacity="0.4"/>
    <ellipse cx="400" cy="440" rx="330" ry="46" fill="#a0786b" opacity="0.55"/>
    <path d="M30 360 L30 270 C30 240 60 232 90 232 L330 232 C360 232 380 240 380 270 L380 360 Z" fill="url(#${id}-sofa)"/>
    <rect x="16" y="290" width="380" height="80" rx="20" fill="#4f6b69"/>
    <rect x="60" y="250" width="120" height="52" rx="14" fill="#6f8f8c"/><rect x="200" y="250" width="120" height="52" rx="14" fill="#6f8f8c"/>
    <rect x="690" y="290" width="90" height="10" rx="3" fill="#6b4a33"/><rect x="700" y="300" width="8" height="60" fill="#5b3e2b"/><rect x="762" y="300" width="8" height="60" fill="#5b3e2b"/>
    <rect x="708" y="258" width="58" height="32" rx="5" fill="#e9c6c3"/><rect x="708" y="258" width="58" height="10" rx="5" fill="#f6ece6"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${716 + i * 10}" y="244" width="3" height="14" fill="#f2d59a"/><circle cx="${717.5 + i * 10}" cy="240" r="3" fill="#ffd27a"/>`).join('')}
    <path d="M110 40 L112 120 M150 30 L148 116 M190 44 L186 124" stroke="#d6c7b6" stroke-width="1.2"/>
    <ellipse cx="110" cy="40" rx="24" ry="29" fill="url(#${id}-bal1)"/><ellipse cx="150" cy="30" rx="22" ry="27" fill="url(#${id}-bal2)"/><ellipse cx="190" cy="44" rx="20" ry="25" fill="url(#${id}-bal3)"/>
    <path d="M0 22 Q200 60 400 30 T800 40" stroke="#7a5c48" stroke-width="1.5" fill="none" opacity="0.6"/>`;
    for (let i = 0; i < 16; i++) {
      const x = i * 52 + 10;
      const y = 26 + Math.sin(i * 0.9) * 10 + (i % 2) * 8;
      s += `<circle cx="${x}" cy="${y}" r="${10 + (i % 3) * 4}" fill="url(#${'BOKEH'})"/>`;
    }
    return { id, s };
  }

  function kitchenScene() {
    const id = nid();
    let s = `<defs>
      <linearGradient id="${id}-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8c4aa"/><stop offset="1" stop-color="#9dac8e"/></linearGradient>
      <linearGradient id="${id}-counter" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a6b48"/><stop offset="1" stop-color="#7a5236"/></linearGradient>
      <linearGradient id="${id}-cab" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e1d6c3"/><stop offset="1" stop-color="#c7b89f"/></linearGradient>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c7dfe8"/><stop offset="1" stop-color="#eee2c8"/></linearGradient>
      <linearGradient id="${id}-glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity="0.45"/><stop offset="0.4" stop-color="#ffffff" stop-opacity="0.1"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.3"/></linearGradient>
    </defs>
    <rect width="800" height="500" fill="url(#${id}-wall)"/>
    <rect x="300" y="60" width="200" height="170" rx="4" fill="url(#${id}-sky)"/>
    <path d="M400 60 v170 M300 145 h200" stroke="#eee8dc" stroke-width="8"/><rect x="292" y="52" width="216" height="186" rx="6" fill="none" stroke="#f1ebe0" stroke-width="10"/>
    <rect x="296" y="230" width="208" height="12" fill="#e9e1d2"/>
    <path d="M330 230 q10 -40 30 -30 q-10 20 -30 30 M350 230 q20 -50 40 -30 q-20 10 -40 30" fill="#6f8f5a"/><rect x="335" y="214" width="40" height="18" rx="4" fill="#b8664b"/>
    <rect x="40" y="70" width="200" height="10" rx="2" fill="#8a6446"/><rect x="40" y="150" width="200" height="10" rx="2" fill="#8a6446"/>
    <rect x="560" y="70" width="200" height="10" rx="2" fill="#8a6446"/><rect x="560" y="150" width="200" height="10" rx="2" fill="#8a6446"/>`;
    const jar = (x, y, h, c) => `<rect x="${x}" y="${y - h}" width="34" height="${h}" rx="7" fill="#e8eef0" opacity="0.55"/><rect x="${x + 3}" y="${y - h * 0.6}" width="28" height="${h * 0.6 - 3}" rx="5" fill="${c}" opacity="0.8"/><rect x="${x + 2}" y="${y - h - 6}" width="30" height="8" rx="3" fill="#9a5a3c"/><rect x="${x}" y="${y - h}" width="34" height="${h}" rx="7" fill="url(#${id}-glass)"/>`;
    s += jar(52, 70, 46, '#d98c5f') + jar(96, 70, 36, '#e3c46a') + jar(140, 70, 50, '#b6584f') + jar(186, 70, 40, '#86a86a');
    s += jar(52, 150, 40, '#e3c46a') + jar(98, 150, 52, '#d98c5f') + jar(146, 150, 36, '#86a86a');
    s += jar(572, 70, 40, '#b6584f') + jar(618, 70, 50, '#e3c46a') + jar(666, 70, 34, '#d98c5f') + jar(712, 70, 46, '#86a86a');
    s += jar(580, 150, 46, '#d98c5f') + jar(630, 150, 36, '#b6584f') + jar(680, 150, 50, '#e3c46a');
    for (let r = 0; r < 4; r++) for (let c = 0; c < 20; c++) s += `<rect x="${c * 40 + (r % 2) * 20 - 20}" y="${250 + r * 26}" width="38" height="24" rx="2" fill="#eae4d6" opacity="0.5"/>`;
    s += `<rect y="352" width="800" height="22" fill="url(#${id}-counter)"/><rect y="374" width="800" height="126" fill="url(#${id}-cab)"/>
      <path d="M200 374 v126 M400 374 v126 M600 374 v126" stroke="#a89780" stroke-width="3"/>
      <rect x="180" y="420" width="10" height="34" rx="4" fill="#8a7a64"/><rect x="410" y="420" width="10" height="34" rx="4" fill="#8a7a64"/><rect x="610" y="420" width="10" height="34" rx="4" fill="#8a7a64"/>
      <path d="M560 300 q20 -24 46 -20 q16 4 14 22 l-4 40 l-50 0 z" fill="#c96f4e"/><ellipse cx="594" cy="296" rx="26" ry="6" fill="#a5543a"/>
      <polygon points="300,240 500,240 640,500 160,500" fill="#fff6e2" opacity="0.18"/>`;
    return { id, s };
  }

  function parkScene() {
    const id = nid();
    let s = `<defs>
      <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fbfd6"/><stop offset="0.6" stop-color="#e9cfa6"/><stop offset="1" stop-color="#f0c896"/></linearGradient>
      <radialGradient id="${id}-sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff2c9" stop-opacity="0.95"/><stop offset="1" stop-color="#fff2c9" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#94a86a"/><stop offset="1" stop-color="#6c8148"/></linearGradient>
    </defs>
    <rect width="800" height="500" fill="url(#${id}-sky)"/>
    <circle cx="640" cy="230" r="150" fill="url(#${id}-sun)"/>
    <path d="M0 300 C140 250 260 270 400 285 C540 300 660 250 800 270 L800 360 L0 360 Z" fill="#9aae9a" opacity="0.7"/>
    <path d="M0 330 C160 300 320 320 460 312 C600 304 700 290 800 300 L800 380 L0 380 Z" fill="#7f9878" opacity="0.8"/>`;
    const tree = (x, y, r, c) => `<rect x="${x - 6}" y="${y}" width="12" height="${r * 1.4}" fill="#5e4632"/><circle cx="${x}" cy="${y - r * 0.2}" r="${r}" fill="${c}"/><circle cx="${x - r * 0.6}" cy="${y + r * 0.2}" r="${r * 0.7}" fill="${c}"/><circle cx="${x + r * 0.6}" cy="${y + r * 0.15}" r="${r * 0.75}" fill="${mix(c, '#000000', 0.12)}"/>`;
    s += tree(80, 250, 60, '#5f7d4a') + tree(200, 270, 44, '#6c8a52') + tree(720, 250, 64, '#58744a') + tree(610, 280, 40, '#6c8a52');
    s += `<rect y="360" width="800" height="140" fill="url(#${id}-grass)"/>
      <path d="M300 500 C340 440 380 400 420 360 L470 360 C460 400 470 450 520 500 Z" fill="#cdb48c" opacity="0.7"/>
      <path d="M470 250 L470 360 M560 250 L560 360 M460 252 L570 252" stroke="#8a4e3e" stroke-width="7" stroke-linecap="round"/>
      <path d="M492 252 L492 320 M512 252 L512 320 M482 320 h40" stroke="#5b5048" stroke-width="2.5"/>
      <path d="M180 360 L200 280 L222 280 L208 360 M200 290 C240 300 260 330 280 360" stroke="#c9774a" stroke-width="8" fill="none" stroke-linecap="round"/>`;
    for (let i = 0; i < 40; i++) s += `<path d="M${(i * 37) % 800} ${380 + (i * 53) % 110} q2 -8 4 0" stroke="#5c7040" stroke-width="2" fill="none" opacity="0.5"/>`;
    return { id, s };
  }

  const SCENES = { home: homeScene, kitchen: kitchenScene, park: parkScene };

  function scene(name) {
    const make = SCENES[name] || homeScene;
    const { id, s } = make();
    return frame(id, s.replace(/BOKEH/g, `${id}-bokeh`), 0.34);
  }

  // ---------- world map ----------

  // Landmarks for each chapter, drawn small and soft.
  function landmark(kind, x, y, locked) {
    const op = locked ? 0.55 : 1;
    switch (kind) {
      case 'house':
        return `<g opacity="${op}"><rect x="${x - 34}" y="${y - 30}" width="68" height="44" rx="3" fill="#e9dccb"/><path d="M${x - 42} ${y - 28} L${x} ${y - 62} L${x + 42} ${y - 28} Z" fill="#b5654c"/><rect x="${x - 8}" y="${y - 10}" width="16" height="24" rx="2" fill="#7a5238"/><rect x="${x + 14}" y="${y - 22}" width="13" height="12" rx="2" fill="#bcd3e0"/><rect x="${x - 27}" y="${y - 22}" width="13" height="12" rx="2" fill="#bcd3e0"/></g>`;
      case 'park':
        return `<g opacity="${op}"><circle cx="${x - 30}" cy="${y - 36}" r="24" fill="#6d8f55"/><rect x="${x - 33}" y="${y - 16}" width="6" height="26" fill="#6b4c34"/><path d="M${x} ${y + 10} L${x + 6} ${y - 34} L${x + 46} ${y - 34} L${x + 52} ${y + 10} M${x + 14} ${y - 34} L${x + 14} ${y - 8} M${x + 36} ${y - 34} L${x + 36} ${y - 8} M${x + 10} ${y - 8} h8 M${x + 32} ${y - 8} h8" stroke="#a65a44" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>`;
      case 'school':
        return `<g opacity="${op}"><rect x="${x - 46}" y="${y - 34}" width="92" height="48" fill="#d9c3a1"/><path d="M${x - 52} ${y - 34} L${x} ${y - 58} L${x + 52} ${y - 34} Z" fill="#8f6a4c"/><rect x="${x - 7}" y="${y - 8}" width="14" height="22" fill="#6b4a33"/>${[-34, -20, 12, 26].map((d) => `<rect x="${x + d}" y="${y - 26}" width="9" height="10" fill="#bcd3e0"/>`).join('')}<path d="M${x} ${y - 58} v-16 l14 4 l-14 4" stroke="#6b4a33" stroke-width="2" fill="#c9634f"/></g>`;
      case 'college':
        return `<g opacity="${op}"><rect x="${x - 50}" y="${y - 10}" width="100" height="24" fill="#e4dacb"/><path d="M${x - 56} ${y - 34} L${x} ${y - 56} L${x + 56} ${y - 34} Z" fill="#c9b8a0"/><rect x="${x - 50}" y="${y - 36}" width="100" height="6" fill="#d7c9b4"/>${[-40, -20, 0, 20, 40].map((d) => `<rect x="${x + d - 4}" y="${y - 30}" width="8" height="22" fill="#efe6d8"/>`).join('')}</g>`;
      case 'office':
        return `<g opacity="${op}"><rect x="${x - 22}" y="${y - 70}" width="44" height="84" fill="#9fb2c4"/><rect x="${x + 22}" y="${y - 40}" width="30" height="54" fill="#b7c6d4"/>${Array.from({ length: 12 }, (_, i) => `<rect x="${x - 16 + (i % 3) * 12}" y="${y - 62 + Math.floor(i / 3) * 16}" width="7" height="9" fill="#e7eef4"/>`).join('')}</g>`;
      case 'cafe':
        return `<g opacity="${op}"><rect x="${x - 38}" y="${y - 28}" width="76" height="42" fill="#e9d6c2"/><path d="M${x - 44} ${y - 28} h88 l-8 -12 h-72 z" fill="#c76e5b"/><path d="M${x - 40} ${y - 28} q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0 q5 8 10 0" fill="#f3ece3"/><path d="M${x} ${y - 6} c-6 -8 -16 -2 -8 6 l8 7 l8 -7 c8 -8 -2 -14 -8 -6z" fill="#d9675b"/></g>`;
      default:
        return `<g opacity="${op}"><path d="M${x - 40} ${y + 14} L${x - 40} ${y - 30} Q${x} ${y - 76} ${x + 40} ${y - 30} L${x + 40} ${y + 14}" stroke="#e8d7c4" stroke-width="9" fill="none"/>${[-36, -18, 0, 18, 36].map((d, i) => `<circle cx="${x + d}" cy="${y - 34 - (i === 2 ? 22 : i % 2 ? 14 : 0)}" r="6" fill="${['#f2b8c0', '#fff3d6', '#f2b8c0', '#fff3d6', '#f2b8c0'][i]}"/>`).join('')}</g>`;
    }
  }

  function smoothPath(pts) {
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  // Returns { svg, nodes: [{ id, x, y }], height } in a 400-wide coordinate space.
  function worldMap(chapters) {
    const id = nid();
    const xs = [200, 290, 230, 120, 170, 280, 310, 220, 110, 150, 260];
    const pts = [];
    const nodes = [];
    const marks = [];
    let y = 0;
    const regions = [];
    const playable = chapters.filter((c) => !c.locked);
    const locked = chapters.filter((c) => c.locked);
    // Build from the top (future) down to the start (bottom), then flip.
    const LMK = { 1: 'house', 2: 'park', 3: 'school', 4: 'school', 5: 'college', 6: 'office', 7: 'cafe', 8: 'wedding' };
    y = 90;
    locked.slice().reverse().forEach((ch, i) => {
      const x = i % 2 ? 120 : 280;
      pts.push([x, y]);
      marks.push({ kind: LMK[ch.n], x: x === 120 ? 270 : 130, y: y + 10, locked: true, ch });
      y += 120;
    });
    const fogBottom = y - 40;
    playable.slice().reverse().forEach((ch) => {
      const top = y;
      const lv = ch.levels.slice().reverse();
      lv.forEach((lid, i) => {
        const x = xs[(i + ch.n * 3) % xs.length];
        pts.push([x, y]);
        nodes.push({ id: lid, x, y, chapter: ch.id });
        y += 92;
      });
      regions.push({ ch, top: top - 50, bottom: y - 40 });
      marks.push({ kind: LMK[ch.n], x: nodes[nodes.length - 1].x > 200 ? 90 : 310, y: y - 70, locked: false, ch });
      y += 30;
    });
    const height = y + 40;
    let s = `<svg class="world-svg" viewBox="0 0 400 ${height}" preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${id}-land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8d2bf"/><stop offset="${(fogBottom / height).toFixed(2)}" stop-color="#b9c9a6"/><stop offset="1" stop-color="#a9c08e"/></linearGradient>
        <linearGradient id="${id}-fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1ec" stop-opacity="0.85"/><stop offset="1" stop-color="#eef1ec" stop-opacity="0"/></linearGradient>
        <filter id="${id}-soft"><feGaussianBlur stdDeviation="1.2"/></filter>
      </defs>
      <rect width="400" height="${height}" fill="url(#${id}-land)"/>`;
    const r = rng(42);
    for (let i = 0; i < 60; i++) {
      const tx = r() * 400;
      const ty = r() * height;
      s += `<circle cx="${tx.toFixed(0)}" cy="${ty.toFixed(0)}" r="${(10 + r() * 16).toFixed(0)}" fill="${r() > 0.5 ? '#9db48a' : '#b4c49e'}" opacity="0.5" filter="url(#${id}-soft)"/>`;
    }
    for (let i = 0; i < 26; i++) {
      const tx = r() * 400;
      const ty = 40 + r() * (height - 80);
      if (pts.some((p) => Math.abs(p[0] - tx) < 44 && Math.abs(p[1] - ty) < 44)) continue;
      s += `<g opacity="0.85"><rect x="${(tx - 2).toFixed(0)}" y="${ty.toFixed(0)}" width="4" height="12" fill="#6b5240"/><circle cx="${tx.toFixed(0)}" cy="${(ty - 4).toFixed(0)}" r="${(9 + r() * 6).toFixed(0)}" fill="${r() > 0.5 ? '#6f8c57' : '#7f9b62'}"/></g>`;
    }
    const d = smoothPath(pts);
    s += `<path d="${d}" stroke="#8d7a5e" stroke-width="30" fill="none" stroke-linecap="round" opacity="0.25"/>
      <path d="${d}" stroke="#e7dcc4" stroke-width="22" fill="none" stroke-linecap="round"/>
      <path d="${d}" stroke="#d3c4a4" stroke-width="2" fill="none" stroke-dasharray="2 10" stroke-linecap="round"/>`;
    for (const m of marks) s += landmark(m.kind, m.x, m.y, m.locked);
    s += `<rect width="400" height="${fogBottom}" fill="url(#${id}-fog)"/></svg>`;
    return { svg: s, nodes, height, marks, regions };
  }

  // ---------- UI icons ----------

  const ICONS = {
    map: '<path d="M9 4.5L3.5 6.5v13l5.5-2 6 2 5.5-2v-13l-5.5 2-6-2z"/><path d="M9 4.5v13M15 6.5v13"/>',
    album: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8"/>',
    book: '<path d="M5 4.5h10.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h10.5"/><path d="M8.5 8.5h5.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    sound: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
    flame: '<path d="M12.5 3c.6 3.4 5 5.3 5 10.1a5.5 5.5 0 0 1-11 0c0-2.3 1.2-3.8 2.5-4.8-.1 1.7.6 3 1.7 3.5-.3-3.9 1.2-6.9 1.8-8.8z"/>',
    bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
    chat: '<path d="M4 5h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 17h-9l-5 4v-4H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 5z"/>',
    cake: '<path d="M4 20.5v-7A1.5 1.5 0 0 1 5.5 12h13a1.5 1.5 0 0 1 1.5 1.5v7M2.5 20.5h19"/><path d="M4 16c2 1.5 4 1.5 5.3 0 1.4 1.5 4 1.5 5.4 0 1.3 1.5 3.3 1.5 5.3 0M8 12V9M12 12V9M16 12V9"/>',
    city: '<path d="M3 21h18M5 21V9l5-3v15M10 21V4h9v17M13 8h3M13 11.5h3M13 15h3"/>',
    pot: '<path d="M4 10h16v7a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 17zM2.5 10h19"/><path d="M9 6.5c0-1.5 1.5-1.5 1.5-3M14 6.5c0-1.5 1.5-1.5 1.5-3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  };

  function icon(name, cls) {
    return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.chat}</svg>`;
  }

  root.LifePyArt = { portrait, pip, scene, worldMap, icon, esc, mix };
})(typeof window !== 'undefined' ? window : globalThis);
