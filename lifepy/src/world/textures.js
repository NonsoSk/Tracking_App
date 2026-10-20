// Every surface is painted on a canvas at start-up: the published page may not
// download images, and this keeps the game one small, offline file.
import * as THREE from 'three';
import { noise2, fbm, rng, clamp } from './noise.js';

const cache = new Map();
let aniso = 4;
export const setAnisotropy = (n) => { aniso = n; };

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h || w;
  return c;
}

export function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const shade = (c, f) => c.map((v) => clamp(v * f, 0, 255));
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function memo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function texture(c, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// The same picture repeated a different number of times, without uploading it twice.
export function tiled(tex, x, y) {
  const t = tex.clone();
  t.repeat.set(x, y == null ? x : y);
  t.needsUpdate = true;
  return t;
}

function pixels(size, fn) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      d[i] = p[0];
      d[i + 1] = p[1];
      d[i + 2] = p[2];
      d[i + 3] = p.length > 3 ? p[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Draws a shape at every wrapped position so the texture tiles without seams.
function wrapDraw(size, x, y, r, draw) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      if (x + dx < -r || x + dx > size + r || y + dy < -r || y + dy > size + r) continue;
      draw(x + dx, y + dy);
    }
  }
}

// ---------- ground ----------

export const grass = (base = '#5d8a3c') => memo('grass' + base, () => {
  const size = 512;
  const b = rgb(base);
  const dark = shade(b, 0.72);
  const light = mixc(b, [190, 200, 110], 0.28);
  const c = pixels(size, (u, v) => {
    const big = fbm(u * 4, v * 4, 4, 3, 4);
    const fine = noise2(u * 128, v * 128, 9, 128);
    let col = mixc(dark, light, clamp(big * 1.4 - 0.2, 0, 1));
    col = shade(col, 0.88 + fine * 0.24);
    return col;
  });
  const ctx = c.getContext('2d');
  const r = rng(11);
  ctx.lineCap = 'round';
  for (let i = 0; i < 5200; i++) {
    const x = r() * size;
    const y = r() * size;
    const len = 4 + r() * 9;
    const ang = -Math.PI / 2 + (r() - 0.5) * 1.1;
    const col = mixc(dark, light, r());
    ctx.strokeStyle = css(shade(col, 0.85 + r() * 0.35), 0.75);
    ctx.lineWidth = 0.8 + r() * 1.2;
    wrapDraw(size, x, y, 14, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    });
  }
  return texture(c);
});

export const asphalt = () => memo('asphalt', () => {
  const c = pixels(512, (u, v) => {
    const n = fbm(u * 8, v * 8, 3, 21, 8);
    const g = noise2(u * 256, v * 256, 4, 256);
    const k = 52 + n * 22 + (g > 0.82 ? 30 : g < 0.12 ? -14 : 0);
    return [k, k + 1, k + 4];
  });
  return texture(c);
});

// Interlocking paving stones, the classic driveway finish.
export const pavers = (base = '#9a8f84') => memo('pavers' + base, () => {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const b = rgb(base);
  ctx.fillStyle = css(shade(b, 0.55));
  ctx.fillRect(0, 0, size, size);
  const r = rng(5);
  const w = 64;
  const h = 32;
  for (let row = 0; row < size / h; row++) {
    const off = row % 2 ? w / 2 : 0;
    for (let col = -1; col <= size / w; col++) {
      const x = col * w + off;
      const y = row * h;
      const tone = shade(b, 0.82 + r() * 0.3);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, css(shade(tone, 1.08)));
      g.addColorStop(1, css(shade(tone, 0.9)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, w - 4, h - 4, 4);
      ctx.fill();
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return texture(c);
});

export const gravel = (base = '#c9b48f') => memo('gravel' + base, () => {
  const b = rgb(base);
  const c = pixels(256, (u, v) => {
    const n = noise2(u * 96, v * 96, 2, 96);
    const m = fbm(u * 4, v * 4, 3, 8, 4);
    return shade(b, 0.78 + n * 0.32 + m * 0.12);
  });
  return texture(c);
});

// ---------- walls and roofs ----------

export const plaster = (base = '#f1ece4') => memo('plaster' + base, () => {
  const b = rgb(base);
  const c = pixels(256, (u, v) => {
    const n = fbm(u * 6, v * 6, 4, 31, 6);
    const g = noise2(u * 200, v * 200, 7, 200);
    return shade(b, 0.94 + n * 0.08 + g * 0.03);
  });
  return texture(c);
});

export const brick = (base = '#9c4a33') => memo('brick' + base, () => {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const b = rgb(base);
  ctx.fillStyle = '#cfc6b8';
  ctx.fillRect(0, 0, size, size);
  const r = rng(77);
  const w = 64;
  const h = 21.33;
  for (let row = 0; row < 24; row++) {
    const off = row % 2 ? w / 2 : 0;
    for (let col = -1; col <= 8; col++) {
      const x = col * w + off;
      const y = row * h;
      const tone = mixc(shade(b, 0.75 + r() * 0.4), [70, 40, 30], r() * 0.25);
      ctx.fillStyle = css(tone);
      ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.fillStyle = css(shade(tone, 1.15), 0.35);
      ctx.fillRect(x + 1.5, y + 1.5, w - 3, 2);
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n * 0.8;
    img.data[i + 2] += n * 0.7;
  }
  ctx.putImageData(img, 0, 0);
  return texture(c);
});

export const stone = (base = '#d6c3a0') => memo('stone' + base, () => {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const b = rgb(base);
  ctx.fillStyle = css(shade(b, 0.7));
  ctx.fillRect(0, 0, size, size);
  const r = rng(13);
  const h = 64;
  for (let row = 0; row < size / h; row++) {
    let x = row % 2 ? -64 : 0;
    while (x < size) {
      const w = 96 + Math.floor(r() * 4) * 32;
      ctx.fillStyle = css(shade(b, 0.88 + r() * 0.2));
      ctx.fillRect(x + 2, row * h + 2, w - 4, h - 4);
      x += w;
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = (fbm(x / 64, y / 64, 3, 5, 8) - 0.5) * 30 + (Math.random() - 0.5) * 10;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
  }
  ctx.putImageData(img, 0, 0);
  return texture(c);
});

// Barrel clay tiles in rows, for Spanish colonial roofs.
export const clayTiles = (base = '#b5562f') => memo('clay' + base, () => {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const b = rgb(base);
  const r = rng(3);
  const rowH = 42.67;
  const tileW = 42.67;
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 12; col++) {
      const x = col * tileW;
      const y = row * rowH;
      const tone = mixc(shade(b, 0.8 + r() * 0.35), [120, 90, 70], r() * 0.2);
      const g = ctx.createLinearGradient(x, 0, x + tileW, 0);
      g.addColorStop(0, css(shade(tone, 0.55)));
      g.addColorStop(0.35, css(shade(tone, 1.12)));
      g.addColorStop(0.65, css(shade(tone, 1.0)));
      g.addColorStop(1, css(shade(tone, 0.5)));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, tileW, rowH + 4);
      ctx.fillStyle = 'rgba(30,15,8,0.35)';
      ctx.fillRect(x, y + rowH - 4, tileW, 4);
    }
  }
  return texture(c);
});

export const slate = (base = '#59606a') => memo('slate' + base, () => {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const b = rgb(base);
  ctx.fillStyle = css(shade(b, 0.5));
  ctx.fillRect(0, 0, size, size);
  const r = rng(9);
  const h = 32;
  for (let row = 0; row < size / h; row++) {
    const off = row % 2 ? 24 : 0;
    for (let col = -1; col < size / 48; col++) {
      const x = col * 48 + off;
      ctx.fillStyle = css(shade(b, 0.8 + r() * 0.35));
      ctx.fillRect(x + 1, row * h + 1, 46, h - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x + 1, row * h + h - 5, 46, 4);
    }
  }
  return texture(c);
});

export const wood = (base = '#8a5a3a') => memo('wood' + base, () => {
  const size = 512;
  const b = rgb(base);
  const r = rng(4);
  const planks = Array.from({ length: 8 }, () => 0.82 + r() * 0.3);
  const c = pixels(size, (u, v, x, y) => {
    const p = Math.floor(v * 8);
    const grain = fbm(u * 2, v * 64, 3, 50 + p, 0);
    const streak = noise2(u * 8, v * 256, 3, 0);
    let col = shade(b, planks[p] * (0.85 + grain * 0.3 + streak * 0.08));
    if (y % 64 < 2) col = shade(col, 0.55);
    return col;
  });
  return texture(c);
});

export const tiles = (kind = 'white') => memo('tiles' + kind, () => {
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const r = rng(2);
  if (kind === 'talavera') {
    const n = 4;
    const s = size / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = i * s;
        const y = j * s;
        ctx.fillStyle = '#f4efe2';
        ctx.fillRect(x, y, s, s);
        ctx.strokeStyle = '#1f4f9c';
        ctx.fillStyle = '#2a5fb0';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s * 0.22, 0, Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.ellipse(x + s / 2 + Math.cos(a) * s * 0.33, y + s / 2 + Math.sin(a) * s * 0.33, s * 0.1, s * 0.05, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#e7a632';
        ctx.beginPath();
        ctx.arc(x + s / 2, y + s / 2, s * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,70,60,0.5)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, s, s);
      }
    }
  } else if (kind === 'terracotta') {
    const s = size / 4;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = css(shade(rgb('#b8653e'), 0.85 + r() * 0.25));
        ctx.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      }
    }
  } else {
    // White subway tiles with grey grout.
    ctx.fillStyle = '#bdb8b0';
    ctx.fillRect(0, 0, size, size);
    const w = 128;
    const h = 64;
    for (let row = 0; row < size / h; row++) {
      const off = row % 2 ? w / 2 : 0;
      for (let col = -1; col <= size / w; col++) {
        const g = ctx.createLinearGradient(0, row * h, 0, row * h + h);
        const tone = kind === 'green' ? rgb('#5f8f7a') : rgb('#f3f1ec');
        g.addColorStop(0, css(shade(tone, 1.03)));
        g.addColorStop(1, css(shade(tone, 0.94 + r() * 0.05)));
        ctx.fillStyle = g;
        ctx.fillRect(col * w + off + 3, row * h + 3, w - 6, h - 6);
      }
    }
  }
  return texture(c);
});

export const poolTiles = () => memo('pooltiles', () => {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8fd0dd';
  ctx.fillRect(0, 0, size, size);
  const r = rng(6);
  const s = 16;
  for (let i = 0; i < size / s; i++) {
    for (let j = 0; j < size / s; j++) {
      ctx.fillStyle = css(mixc(rgb('#3fa8c4'), rgb('#7fd3e0'), r()));
      ctx.fillRect(i * s + 1, j * s + 1, s - 2, s - 2);
    }
  }
  return texture(c);
});

export const fabric = (base = '#f7f3ec') => memo('fabric' + base, () => {
  const b = rgb(base);
  const c = pixels(128, (u, v, x, y) => shade(b, 0.95 + ((x + y) % 2) * 0.03 + noise2(u * 32, v * 32, 1, 32) * 0.04));
  return texture(c);
});

// A carved stone lattice (jaali) with star-shaped openings, cut out with alpha.
export const jaali = () => memo('jaali', () => {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e4d3b4';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'destination-out';
  const s = size / 4;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const cx = i * s + s / 2;
      const cy = j * s + s / 2;
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = k % 2 ? s * 0.18 : s * 0.4;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  return texture(c);
});

// ---------- plants ----------

const LEAF_SETS = {
  broadleaf: { colors: ['#3d6b2a', '#4e7f33', '#5d8f3a', '#2f5a24', '#6f9a44'], len: 26, wid: 12, count: 900 },
  mango: { colors: ['#2d5a26', '#3a6b2c', '#24481f', '#4a7a34'], len: 40, wid: 10, count: 700 },
  oak: { colors: ['#47702f', '#5b8438', '#3a5f27', '#6c9443'], len: 22, wid: 13, count: 950 },
  hedge: { colors: ['#36602a', '#43712f', '#2c5223', '#557f38'], len: 14, wid: 8, count: 1600 },
  bougainvillea: { colors: ['#c4246f', '#d63a85', '#b01d63', '#e04f97', '#5a8a3a', '#4a7a32'], len: 18, wid: 14, count: 1100 },
  jacaranda: { colors: ['#8e74c9', '#a28bd6', '#7b63b8', '#b49ee0', '#6d8f45'], len: 16, wid: 12, count: 1200 },
  flamboyant: { colors: ['#e2462a', '#f05a2f', '#c83a22', '#5c8a37', '#4a7a2e'], len: 16, wid: 11, count: 1100 },
  neem: { colors: ['#4a7a2c', '#5a8c34', '#3c6826', '#6d9c3f'], len: 24, wid: 6, count: 1300 },
  maple: { colors: ['#4f7a2e', '#628c36', '#3f6827', '#c88a2c', '#7a9a3a'], len: 22, wid: 18, count: 800 },
  rose: { colors: ['#c8304a', '#e0546a', '#a82038', '#f08aa0', '#4a7a32', '#3a6a2a', '#5a8a3a'], len: 15, wid: 13, count: 1100 },
  lotus: { colors: ['#f2a6c0', '#f7c8d8', '#e488aa', '#4f8a3a', '#3f7a32'], len: 22, wid: 18, count: 500 },
};

export const leaves = (kind = 'broadleaf') => memo('leaves' + kind, () => {
  const set = LEAF_SETS[kind] || LEAF_SETS.broadleaf;
  const size = 512;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const r = rng(kind.length * 7 + 1);
  for (let i = 0; i < set.count; i++) {
    // Denser in the middle so each card reads as a clump with a soft edge.
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.7) * size * 0.47;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const len = set.len * (0.7 + r() * 0.6);
    const wid = set.wid * (0.7 + r() * 0.6);
    const base = rgb(set.colors[Math.floor(r() * set.colors.length)]);
    const depth = 0.75 + (1 - d / (size * 0.47)) * 0.1 + r() * 0.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    const g = ctx.createLinearGradient(-wid, 0, wid, 0);
    g.addColorStop(0, css(shade(base, depth * 0.8)));
    g.addColorStop(0.5, css(shade(base, depth * 1.12)));
    g.addColorStop(1, css(shade(base, depth * 0.75)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, wid / 2, len / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = css(shade(base, 0.6), 0.5);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.lineTo(0, len / 2);
    ctx.stroke();
    ctx.restore();
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

// One palm frond: a midrib with leaflets, drawn along the length of the texture.
export const frond = (tone = '#4f8a32') => memo('frond' + tone, () => {
  const w = 256;
  const h = 1024;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const base = rgb(tone);
  const r = rng(8);
  ctx.lineCap = 'round';
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    const y = 30 + t * (h - 60);
    const len = (w * 0.48) * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.95 + 0.15) * (0.85 + r() * 0.25);
    for (const side of [-1, 1]) {
      const col = mixc(shade(base, 0.75 + r() * 0.4), rgb('#c7b45a'), t * 0.25 + r() * 0.08);
      ctx.strokeStyle = css(col);
      ctx.lineWidth = 6 - t * 3;
      ctx.beginPath();
      ctx.moveTo(w / 2, y);
      ctx.quadraticCurveTo(w / 2 + side * len * 0.5, y + 10, w / 2 + side * len, y + 28 + t * 30);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = css(shade(base, 0.7));
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

export const bark = (base = '#6b5442') => memo('bark' + base, () => {
  const b = rgb(base);
  const c = pixels(256, (u, v) => {
    const n = fbm(u * 16, v * 2, 4, 12, 16);
    const s = noise2(u * 64, v * 8, 3, 64);
    return shade(b, 0.65 + n * 0.5 + s * 0.15);
  });
  return texture(c);
});

export const palmTrunk = () => memo('palmtrunk', () => {
  const b = rgb('#8b7660');
  const c = pixels(256, (u, v) => {
    const ring = Math.pow(Math.abs(Math.sin(v * Math.PI * 16)), 0.4);
    const n = fbm(u * 8, v * 32, 3, 1, 8);
    return shade(b, 0.55 + ring * 0.4 + n * 0.25);
  });
  return texture(c);
});

// ---------- sky, water and light ----------

export const cloud = () => memo('cloud', () => {
  const size = 256;
  const c = canvas(size, size / 2);
  const ctx = c.getContext('2d');
  const r = rng(12);
  for (let i = 0; i < 28; i++) {
    const x = size * (0.18 + r() * 0.64);
    const y = size * 0.25 + (r() - 0.6) * size * 0.16;
    const rad = size * (0.06 + r() * 0.1);
    const g = ctx.createRadialGradient(x, y - rad * 0.3, rad * 0.1, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(245,244,248,0.6)');
    g.addColorStop(1, 'rgba(230,232,240,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

export const waterNormal = () => memo('waternormal', () => {
  const size = 256;
  const hgt = (x, y) => fbm(x / size * 6, y / size * 6, 4, 40, 6);
  const c = pixels(size, (u, v, x, y) => {
    const dx = hgt(x + 1, y) - hgt(x - 1, y);
    const dy = hgt(x, y + 1) - hgt(x, y - 1);
    const nx = -dx * 6;
    const ny = -dy * 6;
    const l = Math.hypot(nx, ny, 1);
    return [(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
  return texture(c, false);
});

export const soft = (hex = '#ffffff') => memo('soft' + hex, () => {
  const size = 128;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const col = rgb(hex);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, css(col, 1));
  g.addColorStop(0.45, css(col, 0.45));
  g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

// A vertical fade for light shafts through windows.
export const beam = () => memo('beam', () => {
  const c = canvas(64, 256);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,240,210,0.9)');
  g.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  const h = ctx.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)');
  h.addColorStop(0.3, 'rgba(0,0,0,0)');
  h.addColorStop(0.7, 'rgba(0,0,0,0)');
  h.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, 64, 256);
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
});

// What you see through a window: a warm room with lamps, curtains and furniture.
export const interior = (tone = '#d9c6aa') => memo('interior' + tone, () => {
  const w = 512;
  const h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const b = rgb(tone);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(shade(b, 0.45)));
  g.addColorStop(0.18, css(shade(b, 0.8)));
  g.addColorStop(0.7, css(shade(b, 0.7)));
  g.addColorStop(0.72, css(shade(rgb('#6b4e36'), 0.8)));
  g.addColorStop(1, css(shade(rgb('#4a3526'), 0.7)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const r = rng(tone.length * 3);
  for (let i = 0; i < 3; i++) {
    const x = (i + 0.5) * (w / 3) + (r() - 0.5) * 60;
    const lg = ctx.createRadialGradient(x, h * 0.32, 4, x, h * 0.32, 90);
    lg.addColorStop(0, 'rgba(255,226,170,0.85)');
    lg.addColorStop(1, 'rgba(255,226,170,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x - 90, 0, 180, h);
  }
  for (let i = 0; i < 4; i++) {
    const x = r() * w;
    ctx.fillStyle = css(shade(rgb('#e9e0d0'), 0.85 + r() * 0.15), 0.85);
    ctx.fillRect(x, h * 0.05, 18 + r() * 26, h * 0.67);
  }
  ctx.fillStyle = css(rgb('#5a4a40'));
  ctx.beginPath();
  ctx.roundRect(w * 0.18, h * 0.55, w * 0.26, h * 0.17, 8);
  ctx.fill();
  ctx.fillStyle = css(rgb('#3f5a3a'));
  ctx.beginPath();
  ctx.ellipse(w * 0.72, h * 0.5, 22, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  const t = texture(c);
  return t;
});

// Office towers: rows of windows with floors and mullions.
export const towerWindows = (tone = '#5a7590') => memo('tower' + tone, () => {
  const size = 256;
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const b = rgb(tone);
  ctx.fillStyle = css(shade(b, 0.9));
  ctx.fillRect(0, 0, size, size);
  const r = rng(21);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      const lit = r();
      ctx.fillStyle = css(lit > 0.86 ? [235, 214, 170] : shade(b, 0.65 + lit * 0.5));
      ctx.fillRect(x * 32 + 3, y * 16 + 3, 26, 10);
    }
  }
  return texture(c);
});
