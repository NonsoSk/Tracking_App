// Small deterministic random and noise helpers, so every world looks the same on every device.

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Value noise. With a period it tiles, which canvas textures need.
export function noise2(x, y, s = 0, period = 0) {
  let xi = Math.floor(x);
  let yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  let xj = xi + 1;
  let yj = yi + 1;
  if (period) {
    xi = ((xi % period) + period) % period;
    yi = ((yi % period) + period) % period;
    xj = ((xj % period) + period) % period;
    yj = ((yj % period) + period) % period;
  }
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s);
  const b = hash(xj, yi, s);
  const c = hash(xi, yj, s);
  const d = hash(xj, yj, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, octaves = 4, s = 0, period = 0) {
  let f = 0;
  let amp = 0.5;
  let fr = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    f += amp * noise2(x * fr, y * fr, s + i * 17, period ? period * fr : 0);
    norm += amp;
    fr *= 2;
    amp *= 0.5;
  }
  return f / norm;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
