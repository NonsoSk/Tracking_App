// Sky, land, water, trees, grass, clouds and birds.
import * as THREE from 'three';
import { Kit, windy, setSway, place, std } from './kit.js';
import * as T from './textures.js';
import { rng, fbm, smooth, clamp } from './noise.js';

// ---------- materials shared by the plants ----------

export function plantMaterials() {
  const leaf = (kind, amount = 1) => windy(std({ map: T.leaves(kind), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.75 }), amount);
  return {
    bark: std({ map: T.tiled(T.bark(), 1, 2), roughness: 0.95 }),
    barkPale: std({ map: T.tiled(T.bark('#8d8072'), 1, 2), roughness: 0.95 }),
    palmTrunk: std({ map: T.palmTrunk(), roughness: 0.95 }),
    frond: windy(std({ map: T.frond(), alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.7 }), 1.4),
    leaves: {
      broadleaf: leaf('broadleaf'),
      mango: leaf('mango'),
      oak: leaf('oak'),
      hedge: leaf('hedge', 0.3),
      bougainvillea: leaf('bougainvillea', 0.5),
      jacaranda: leaf('jacaranda'),
      flamboyant: leaf('flamboyant'),
      neem: leaf('neem'),
      maple: leaf('maple'),
      rose: leaf('rose', 0.3),
      lotus: leaf('lotus', 0.1),
    },
    hedgeCore: std({ color: '#2e4f22', roughness: 1 }),
    agave: std({ color: '#7d9a86', roughness: 0.6 }),
    coconut: std({ color: '#5a4a2a', roughness: 0.8 }),
  };
}

// Leaf cards around a point. Their normals point away from the centre, so the
// clump is lit like a round, leafy mass instead of a pile of flat cards.
function leafCards(kit, mat, cx, cy, cz, rx, ry, rz, count, size, r, swayBase, swayTop, y0, h) {
  const n = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const u = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const rad = Math.pow(r(), 0.35);
    const sq = Math.sqrt(1 - u * u);
    const px = cx + Math.cos(a) * sq * rx * rad;
    const py = cy + u * ry * rad;
    const pz = cz + Math.sin(a) * sq * rz * rad;
    const sz = size * (0.75 + r() * 0.5);
    const g = new THREE.PlaneGeometry(sz, sz);
    place(g, px, py, pz, r() * Math.PI, r() * Math.PI * 2, r() * Math.PI);
    n.set(px - cx, (py - cy) * 1.2 + ry * 0.35, pz - cz).normalize();
    const nor = g.attributes.normal;
    for (let k = 0; k < nor.count; k++) nor.setXYZ(k, n.x, n.y, n.z);
    setSway(g, (x, y) => swayBase + (swayTop - swayBase) * clamp((y - y0) / h, 0, 1));
    kit.add(mat, g);
  }
}

function limb(kit, mat, x0, y0, z0, x1, y1, z1, r0, r1) {
  const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 7, 1, true);
  g.translate(0, len / 2, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(quat);
  g.translate(x0, y0, z0);
  setSway(g, () => 0);
  kit.add(mat, g);
}

export function tree(kit, M, x, z, h, kind, seed, detail = 1) {
  const r = rng(seed);
  const leaves = M.leaves[kind] || M.leaves.broadleaf;
  const spread = kind === 'jacaranda' || kind === 'flamboyant' ? 0.55 : kind === 'oak' || kind === 'mango' ? 0.48 : 0.4;
  const trunkH = h * (kind === 'flamboyant' ? 0.45 : 0.55);
  const cr = h * spread;
  const lean = (r() - 0.5) * 0.6;
  const tx = x + lean;
  const tz = z + (r() - 0.5) * 0.6;
  const bark = kind === 'jacaranda' || kind === 'neem' ? M.barkPale : M.bark;
  limb(kit, bark, x, 0, z, tx, trunkH, tz, h * 0.035 + 0.12, h * 0.025 + 0.06);
  const clumps = Math.round((kind === 'flamboyant' ? 7 : 5) + r() * 3);
  const top = trunkH + cr * (kind === 'flamboyant' ? 0.35 : 0.6);
  for (let i = 0; i < clumps; i++) {
    const a = (i / clumps) * Math.PI * 2 + r();
    const d = cr * (0.45 + r() * 0.35);
    const cx = tx + Math.cos(a) * d;
    const cz = tz + Math.sin(a) * d;
    const cy = top + (r() - 0.4) * cr * 0.5;
    limb(kit, bark, tx, trunkH * 0.85, tz, cx * 0.7 + tx * 0.3, cy - cr * 0.15, cz * 0.7 + tz * 0.3, h * 0.02 + 0.05, 0.03);
    const cs = cr * (0.5 + r() * 0.25);
    leafCards(kit, leaves, cx, cy, cz, cs, cs * (kind === 'flamboyant' ? 0.45 : 0.7), cs, Math.round(28 * detail), cs * 0.9, r, 0.08, 0.22, trunkH, h - trunkH);
  }
  leafCards(kit, leaves, tx, top + cr * 0.15, tz, cr * 0.55, cr * 0.5, cr * 0.55, Math.round(30 * detail), cr * 0.7, r, 0.1, 0.25, trunkH, h - trunkH);
}

export function palm(kit, M, x, z, h, seed) {
  const r = rng(seed);
  const leanA = r() * Math.PI * 2;
  const lean = 0.8 + r() * 1.6;
  const rings = 12;
  const seg = 8;
  const pos = [];
  const uv = [];
  const idx = [];
  const center = (t) => new THREE.Vector3(x + Math.cos(leanA) * lean * t * t, h * t, z + Math.sin(leanA) * lean * t * t);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = center(t);
    const rad = 0.2 * (1 - 0.3 * t) + (t < 0.08 ? (0.08 - t) * 1.6 : 0);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(c.x + Math.cos(a) * rad, c.y, c.z + Math.sin(a) * rad);
      uv.push(j / seg, t * h / 1.2);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();
  setSway(trunk, (px, py) => (py / h) * (py / h) * 0.12);
  kit.add(M.palmTrunk, trunk);

  const top = center(1);
  const fronds = 13;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + r() * 0.3;
    const L = 3.6 + r() * 1.2;
    const W = 1.15;
    const lift = 0.55 + r() * 0.35;
    const steps = 12;
    const fp = [];
    const fu = [];
    const fi = [];
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const c = top.clone().addScaledVector(dir, L * s * 0.95);
      c.y += L * (lift * s - (0.55 + lift * 0.4) * s * s);
      const w = W * Math.sin(Math.min(1, s * 1.15) * Math.PI * 0.92 + 0.12) * 0.5;
      const droop = w * 0.35;
      const l = c.clone().addScaledVector(side, -w);
      l.y -= droop;
      const rr = c.clone().addScaledVector(side, w);
      rr.y -= droop;
      fp.push(l.x, l.y, l.z, c.x, c.y, c.z, rr.x, rr.y, rr.z);
      fu.push(0, 1 - s, 0.5, 1 - s, 1, 1 - s);
    }
    for (let i = 0; i < steps; i++) {
      const a0 = i * 3;
      const b0 = a0 + 3;
      fi.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1, a0 + 1, b0 + 1, a0 + 2, a0 + 2, b0 + 1, b0 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    g.setIndex(fi);
    g.computeVertexNormals();
    const tip = top.clone();
    setSway(g, (px, py, pz) => 0.1 + Math.min(1, Math.hypot(px - tip.x, pz - tip.z) / L) * 0.35);
    kit.add(M.frond, g);
  }
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2;
    const g = new THREE.SphereGeometry(0.13, 8, 6);
    g.translate(top.x + Math.cos(a) * 0.22, top.y - 0.25 - r() * 0.1, top.z + Math.sin(a) * 0.22);
    setSway(g, () => 0.1);
    kit.add(M.coconut, g);
  }
}

export function bush(kit, M, x, z, rad, kind = 'hedge', seed = 1, hgt) {
  const r = rng(seed);
  const h = hgt || rad * 1.1;
  const core = new THREE.SphereGeometry(rad * 0.75, 10, 8);
  core.scale(1, h / rad * 0.8, 1);
  core.translate(x, h * 0.5, z);
  kit.add(M.hedgeCore, core);
  leafCards(kit, M.leaves[kind], x, h * 0.55, z, rad, h * 0.55, rad, Math.round(18 + rad * 14), rad * 0.85, r, 0.02, 0.1, 0, h);
}

export function hedge(kit, M, x0, z0, x1, z1, h = 1.2, d = 0.9, kind = 'hedge', seed = 2) {
  const r = rng(seed);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ang = Math.atan2(z1 - z0, x1 - x0);
  kit.box(M.hedgeCore, len, h * 0.9, d * 0.8, (x0 + x1) / 2, h * 0.45, (z0 + z1) / 2, -ang);
  const n = Math.round(len * 5);
  for (let i = 0; i < n; i++) {
    const t = (i + r()) / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    leafCards(kit, M.leaves[kind], x, h * 0.55, z, d * 0.55, h * 0.55, d * 0.55, 3, 0.75, r, 0.02, 0.06, 0, h);
  }
}

// ---------- grass ----------

// Thousands of instanced tufts in the lawns near the camera, bending in the wind.
export function grassField(areas, count, tone, seed = 3) {
  const blade = [];
  const r = rng(seed);
  const tuft = [];
  for (let b = 0; b < 7; b++) {
    const a = r() * Math.PI * 2;
    const ox = Math.cos(a) * 0.07 * r();
    const oz = Math.sin(a) * 0.07 * r();
    const h = 0.07 + r() * 0.1;
    const w = 0.009;
    const bend = (r() - 0.5) * 0.08;
    const dx = Math.cos(a + 1.57) * w;
    const dz = Math.sin(a + 1.57) * w;
    tuft.push(
      ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + bend * 0.5 + dx * 0.6, h * 0.55, oz + dz * 0.6,
      ox - dx, 0, oz - dz, ox + bend * 0.5 + dx * 0.6, h * 0.55, oz + dz * 0.6, ox + bend * 0.5 - dx * 0.6, h * 0.55, oz - dz * 0.6,
      ox + bend * 0.5 - dx * 0.6, h * 0.55, oz - dz * 0.6, ox + bend * 0.5 + dx * 0.6, h * 0.55, oz + dz * 0.6, ox + bend, h, oz,
    );
  }
  blade.push(...tuft);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(blade, 3));
  const norms = new Float32Array(blade.length);
  for (let i = 0; i < norms.length; i += 3) { norms[i] = 0; norms[i + 1] = 1; norms[i + 2] = 0; }
  g.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
  setSway(g, (x, y) => (y / 0.17) * (y / 0.17) * 0.06);
  const mat = windy(std({ color: '#ffffff', roughness: 0.9, side: THREE.DoubleSide }), 1);
  const mesh = new THREE.InstancedMesh(g, mat, count);
  const m = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const col = new THREE.Color();
  const base = new THREE.Color(tone);
  const total = areas.reduce((acc, a) => acc + (a[2] - a[0]) * (a[3] - a[1]), 0);
  let k = 0;
  for (const [x0, z0, x1, z1] of areas) {
    const n = Math.round(count * ((x1 - x0) * (z1 - z0)) / total);
    for (let i = 0; i < n && k < count; i++, k++) {
      const x = x0 + r() * (x1 - x0);
      const z = z0 + r() * (z1 - z0);
      const sc = 0.7 + r() * 0.7;
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
      m.compose(new THREE.Vector3(x, 0, z), qq, new THREE.Vector3(sc, sc * (0.8 + r() * 0.5), sc));
      mesh.setMatrixAt(k, m);
      col.copy(base).offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.1, (r() - 0.5) * 0.12);
      mesh.setColorAt(k, col);
    }
  }
  mesh.count = k;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

// ---------- land and water ----------

export function terrain(region, heightAt) {
  const size = 900;
  const segs = 150;
  const g = new THREE.PlaneGeometry(size, size, segs, segs);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const tints = region.landTints.map((h) => new THREE.Color(h));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    uv.setXY(i, x / 5, z / 5);
    const n = fbm(x / 60, z / 60, 3, 77);
    const patch = region.fields ? Math.floor(fbm(x / 90, z / 90, 1, 5) * 7) % tints.length : Math.floor(n * tints.length * 1.6) % tints.length;
    c.copy(tints[clamp(patch, 0, tints.length - 1)]).lerp(tints[0], 0.4 + n * 0.3);
    const dryness = smooth(10, 60, y);
    c.lerp(new THREE.Color(region.highTint || '#9c9b70'), dryness * 0.5);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mat = std({ map: T.grass(region.grass), vertexColors: true, roughness: 1 });
  // Mixing the texture with a much larger copy of itself hides the repeating pattern.
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `vec4 tA = texture2D(map, vMapUv);
      vec4 tB = texture2D(map, vMapUv * 0.137 + vec2(0.31, 0.77));
      vec4 tC = texture2D(map, vMapUv * 0.031 + vec2(0.13, 0.41));
      diffuseColor *= vec4(tA.rgb * (0.7 + tB.rgb * 0.75) * (0.85 + tC.g * 0.5), 1.0);`,
    );
  };
  mat.customProgramCacheKey = () => 'terrain';
  mat.userData.grounded = true;
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function waterMaterial(color = '#2a7f98', opacity = 0.9) {
  const nm = T.tiled(T.waterNormal(), 3, 3);
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.04,
    metalness: 0,
    normalMap: nm,
    normalScale: new THREE.Vector2(0.35, 0.35),
    transparent: true,
    opacity,
    envMapIntensity: 1.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
  });
  mat.userData.flow = nm;
  return mat;
}

// ---------- sky life ----------

export function clouds(count, tint, seed = 4) {
  const r = rng(seed);
  const group = new THREE.Group();
  const tex = T.cloud();
  for (let i = 0; i < count; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: tint, transparent: true, depthWrite: false, fog: false, opacity: 0.75 + r() * 0.2 });
    const s = new THREE.Sprite(m);
    const a = r() * Math.PI * 2;
    const d = 450 + r() * 450;
    s.position.set(Math.cos(a) * d, 90 + r() * 140, Math.sin(a) * d);
    const w = 160 + r() * 220;
    s.scale.set(w, w * 0.45, 1);
    s.userData.speed = 0.6 + r() * 1.2;
    group.add(s);
  }
  group.userData.update = (dt) => {
    for (const s of group.children) {
      s.position.x += s.userData.speed * dt;
      if (s.position.x > 950) s.position.x = -950;
    }
  };
  return group;
}

export function birds(count, center, seed = 6) {
  const r = rng(seed);
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: '#2b2a2e', side: THREE.DoubleSide, fog: true });
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.18, 0, 0, 0.18, 0.75, 0, 0.05], 3));
  for (let i = 0; i < count; i++) {
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4).scale(1, 0.7, 2.2), mat);
    const l = new THREE.Mesh(wing, mat);
    const rr = new THREE.Mesh(wing, mat);
    rr.scale.x = -1;
    b.add(body, l, rr);
    b.userData = { l, r: rr, phase: r() * 6, radius: 30 + r() * 25, h: 26 + r() * 14, speed: 0.12 + r() * 0.05, off: r() * 6 };
    b.scale.setScalar(1.6);
    group.add(b);
  }
  group.userData.update = (dt, t) => {
    for (const b of group.children) {
      const u = b.userData;
      const a = t * u.speed + u.off;
      b.position.set(center.x + Math.cos(a) * u.radius, u.h + Math.sin(t * 0.7 + u.phase) * 2, center.z + Math.sin(a) * u.radius);
      b.rotation.y = -a;
      const flap = Math.sin(t * 9 + u.phase) * 0.7;
      u.l.rotation.z = flap;
      u.r.rotation.z = -flap;
    }
  };
  return group;
}

// Far-away trees on the hills: one instanced tree shape, many copies.
export function forest(M, kind, spots, seed = 9) {
  const kit = new Kit();
  const group = new THREE.Group();
  if (kind === 'palm') palm(kit, M, 0, 0, 9, seed);
  else tree(kit, M, 0, 0, 9, kind, seed, 0.45);
  const tmp = new THREE.Group();
  const meshes = kit.build(tmp);
  const m = new THREE.Matrix4();
  const r = rng(seed);
  for (const mesh of meshes) {
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, spots.length);
    spots.forEach(([x, y, z], i) => {
      const sc = 0.7 + r() * 0.6;
      m.compose(new THREE.Vector3(x, y - 0.2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(sc, sc, sc));
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = false;
    inst.receiveShadow = false;
    group.add(inst);
  }
  return group;
}


// Agave and other spiky rosettes for dry gardens.
export function agave(kit, mat, x, z, size = 1, seed = 1) {
  const r = rng(seed);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + r() * 0.3;
    const tilt = 0.35 + r() * 0.7;
    const len = size * (0.6 + r() * 0.5);
    const g = new THREE.ConeGeometry(0.07 * size, len, 4);
    g.translate(0, len / 2, 0);
    g.rotateZ(tilt);
    g.rotateY(a);
    g.translate(x, 0.05, z);
    setSway(g, () => 0);
    kit.add(mat, g);
  }
}
