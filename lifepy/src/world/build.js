// Building blocks for architecture: façade frames, windows, roofs and arches.
import * as THREE from 'three';
import { boxGeo, place, std } from './kit.js';
import * as T from './textures.js';

// A frame is a point and a rotation; parts are placed in its local space
// (x to the right, y up, z out of the façade).
export function frame(x, y, z, ry = 0) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return { x, y, z, ry, at: (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c] };
}

export function fbox(kit, mat, F, w, h, d, lx, ly, lz, scale = 1, opts) {
  const [x, y, z] = F.at(lx, ly, lz);
  return kit.box(mat, w, h, d, x, y, z, F.ry, scale, opts);
}

export function fgeo(kit, mat, F, geo, lx, ly, lz, rx = 0, ryExtra = 0, rz = 0) {
  const [x, y, z] = F.at(lx, ly, lz);
  kit.add(mat, place(geo, x, y, z, rx, F.ry + ryExtra, rz));
}

// A window set into a façade: glass, a frame, optional glazing bars, sill and lintel.
export function win(kit, M, F, lx, ly, w, h, o = {}) {
  const fr = o.frame || M.frame;
  const t = o.t || 0.07;
  const depth = o.depth || 0.12;
  fbox(kit, M.glass, F, w, h, 0.05, lx, ly + h / 2, 0.01);
  fbox(kit, fr, F, w + t * 2, t, depth, lx, ly + h + t / 2, 0.03);
  fbox(kit, fr, F, w + t * 2, t, depth, lx, ly - t / 2, 0.03);
  fbox(kit, fr, F, t, h, depth, lx - w / 2 - t / 2, ly + h / 2, 0.03);
  fbox(kit, fr, F, t, h, depth, lx + w / 2 + t / 2, ly + h / 2, 0.03);
  if (o.bars) {
    const [cols, rows] = o.bars;
    for (let i = 1; i < cols; i++) fbox(kit, fr, F, 0.035, h, 0.06, lx - w / 2 + (w * i) / cols, ly + h / 2, 0.04);
    for (let j = 1; j < rows; j++) fbox(kit, fr, F, w, 0.035, 0.06, lx, ly + (h * j) / rows, 0.04);
  }
  if (o.mullions) for (let i = 1; i < o.mullions; i++) fbox(kit, fr, F, t * 0.8, h, depth, lx - w / 2 + (w * i) / o.mullions, ly + h / 2, 0.03);
  if (o.sill) fbox(kit, o.sill, F, w + 0.3, 0.08, 0.22, lx, ly - t - 0.04, 0.09);
  if (o.lintel) fbox(kit, o.lintel, F, w + 0.36, 0.22, 0.08, lx, ly + h + t + 0.11, 0.04);
  if (o.shutters) {
    fbox(kit, o.shutters, F, w * 0.5, h + 0.05, 0.05, lx - w * 0.75 - t, ly + h / 2, 0.06);
    fbox(kit, o.shutters, F, w * 0.5, h + 0.05, 0.05, lx + w * 0.75 + t, ly + h / 2, 0.06);
  }
  if (o.grille) {
    for (let i = 1; i < 6; i++) fbox(kit, o.grille, F, 0.025, h, 0.025, lx - w / 2 + (w * i) / 6, ly + h / 2, 0.12);
    fbox(kit, o.grille, F, w, 0.025, 0.025, lx, ly + h * 0.33, 0.12);
    fbox(kit, o.grille, F, w, 0.025, 0.025, lx, ly + h * 0.66, 0.12);
  }
}

export function door(kit, M, F, lx, w, h, mat, o = {}) {
  const fr = o.frame || M.frame;
  fbox(kit, mat, F, w, h, 0.08, lx, h / 2, 0.02);
  if (o.double) fbox(kit, fr, F, 0.03, h, 0.1, lx, h / 2, 0.04);
  fbox(kit, fr, F, w + 0.16, 0.08, 0.14, lx, h + 0.04, 0.04);
  fbox(kit, fr, F, 0.08, h, 0.14, lx - w / 2 - 0.04, h / 2, 0.04);
  fbox(kit, fr, F, 0.08, h, 0.14, lx + w / 2 + 0.04, h / 2, 0.04);
  fbox(kit, M.chrome, F, 0.04, 0.5, 0.06, lx + (o.double ? 0.12 : w / 2 - 0.15), h * 0.48, 0.1);
  if (o.panels) {
    const pw = o.double ? w / 2 : w;
    for (const side of o.double ? [-1, 1] : [0]) {
      const cx = lx + side * pw / 2;
      fbox(kit, o.panels, F, pw * 0.6, h * 0.32, 0.02, cx, h * 0.27, 0.07);
      fbox(kit, o.panels, F, pw * 0.6, h * 0.32, 0.02, cx, h * 0.68, 0.07);
    }
  }
  if (o.fanlight) {
    const g = new THREE.CircleGeometry(w / 2 + 0.05, 24, 0, Math.PI);
    fgeo(kit, M.glass, F, g, lx, h + 0.1, 0.03);
    const ring = new THREE.TorusGeometry(w / 2 + 0.1, 0.06, 6, 24, Math.PI);
    fgeo(kit, fr, F, ring, lx, h + 0.1, 0.05);
  }
}

// Hip roof over a w x d rectangle, h high, with tiles running along the eaves.
export function hipRoof(w, d, h, oh = 0.5) {
  let W = w / 2 + oh;
  let D = d / 2 + oh;
  const swap = d > w;
  if (swap) [W, D] = [D, W];
  const inset = Math.min(D, W);
  const r0 = [-W + inset, h, 0];
  const r1 = [W - inset, h, 0];
  const c = [[-W, 0, -D], [W, 0, -D], [W, 0, D], [-W, 0, D]];
  const faces = [
    [c[3], c[2], r1, r0],
    [c[1], c[0], r0, r1],
    [c[2], c[1], r1],
    [c[0], c[3], r0],
  ];
  const g = facesGeo(faces);
  if (swap) g.rotateY(Math.PI / 2);
  return g;
}

export function gableRoof(w, d, h, oh = 0.5) {
  const W = w / 2 + oh;
  const D = d / 2 + oh;
  const faces = [
    [[-W, 0, D], [W, 0, D], [W, h, 0], [-W, h, 0]],
    [[W, 0, -D], [-W, 0, -D], [-W, h, 0], [W, h, 0]],
  ];
  return facesGeo(faces);
}

export function gableEnds(w, d, h) {
  const faces = [
    [[w / 2, 0, d / 2], [w / 2, 0, -d / 2], [w / 2, h, 0]],
    [[-w / 2, 0, -d / 2], [-w / 2, 0, d / 2], [-w / 2, h, 0]],
  ];
  return facesGeo(faces, true);
}

// Flat polygons with UVs measured in metres along the bottom edge and up the slope.
function facesGeo(faces, wallUV) {
  const pos = [];
  const uv = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (const f of faces) {
    const p = f.map((q) => new THREE.Vector3(...q));
    a.subVectors(p[1], p[0]).normalize();
    b.subVectors(p[p.length - 1], p[0]);
    n.crossVectors(a, b).normalize();
    up.crossVectors(n, a).normalize();
    const uvs = p.map((q) => {
      const d = q.clone().sub(p[0]);
      return wallUV ? [d.dot(a), q.y] : [d.dot(a), d.dot(up)];
    });
    const tri = p.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
    for (const t of tri) {
      for (const k of t) {
        pos.push(p[k].x, p[k].y, p[k].z);
        uv.push(uvs[k][0], uvs[k][1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// A wall with a row of round-topped arches cut through it.
export function archWall(width, height, depth, count, archW, archH, sill = 0) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, height);
  s.lineTo(-width / 2, height);
  s.lineTo(-width / 2, 0);
  const gap = width / count;
  for (let i = 0; i < count; i++) {
    const cx = -width / 2 + gap * (i + 0.5);
    const hole = new THREE.Path();
    const r = archW / 2;
    hole.moveTo(cx - r, sill);
    hole.lineTo(cx - r, archH - r);
    hole.absarc(cx, archH - r, r, Math.PI, 0, true);
    hole.lineTo(cx + r, sill);
    hole.lineTo(cx - r, sill);
    s.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

export function column(r, h, segs = 14) {
  const g = new THREE.CylinderGeometry(r * 0.9, r, h, segs);
  g.translate(0, h / 2, 0);
  return g;
}

export function glassMaterial(tint = '#22303b') {
  return new THREE.MeshPhysicalMaterial({ color: tint, metalness: 0.25, roughness: 0.03, envMapIntensity: 1.7, clearcoat: 1, clearcoatRoughness: 0.02 });
}

export function railGlass() {
  return new THREE.MeshPhysicalMaterial({ color: '#cfe6ee', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.22, envMapIntensity: 1.5, depthWrite: false });
}

export const mats = {
  plaster: (c, s = 3) => std({ map: T.tiled(T.plaster(c), 1 / s), roughness: 0.92 }),
  stone: (c, s = 4) => std({ map: T.tiled(T.stone(c), 1 / s), roughness: 0.9 }),
  brick: (c, s = 3) => std({ map: T.tiled(T.brick(c), 1 / s), roughness: 0.9 }),
  wood: (c, s = 2) => std({ map: T.tiled(T.wood(c), 1 / s), roughness: 0.7 }),
  clay: (c, s = 3) => std({ map: T.tiled(T.clayTiles(c), 1 / s), roughness: 0.75 }),
  slate: (c, s = 3) => std({ map: T.tiled(T.slate(c), 1 / s), roughness: 0.7 }),
  pavers: (c, s = 3) => std({ map: T.tiled(T.pavers(c), 1 / s), roughness: 0.9 }),
  tiles: (k, s = 1) => std({ map: T.tiled(T.tiles(k), 1 / s), roughness: 0.35 }),
  paint: (c, r = 0.55) => std({ color: c, roughness: r }),
  metal: (c, r = 0.4) => std({ color: c, roughness: r, metalness: 0.7 }),
};
