// The family home in each region, designed after the finest homes there, plus
// smaller houses for Grandma and the neighbours.
import * as THREE from 'three';
import { Kit, std } from './kit.js';
import { frame, fbox, fgeo, win, door, hipRoof, gableRoof, archWall, column, glassMaterial, railGlass, mats } from './build.js';
import { palm, tree, bush, hedge, agave } from './nature.js';
import * as T from './textures.js';

function common() {
  return {
    glass: glassMaterial(),
    rail: railGlass(),
    chrome: std({ color: '#c9ccd1', metalness: 0.9, roughness: 0.2 }),
    interior: std({ map: T.tiled(T.interior(), 1 / 4, 1 / 3), emissive: '#ffffff', emissiveMap: T.tiled(T.interior(), 1 / 4, 1 / 3), emissiveIntensity: 0.18, roughness: 1 }),
    soffit: mats.paint('#efe9df', 0.9),
  };
}

// What you see through big glass: a lit room just behind it.
function glazed(kit, M, F, lx, ly, w, h, o = {}) {
  fbox(kit, M.interior, F, w, h, 0.02, lx, ly + h / 2, 0.014, 1, { cast: false });
  const glass = M.glass;
  fbox(kit, glass, F, w, h, 0.03, lx, ly + h / 2, 0.045, 1, { cast: false });
  const t = o.t || 0.06;
  const fr = o.frame || M.frame;
  fbox(kit, fr, F, w + t * 2, t, 0.1, lx, ly + h + t / 2, 0.04);
  fbox(kit, fr, F, w + t * 2, t, 0.1, lx, ly - t / 2, 0.04);
  fbox(kit, fr, F, t, h, 0.1, lx - w / 2 - t / 2, ly + h / 2, 0.04);
  fbox(kit, fr, F, t, h, 0.1, lx + w / 2 + t / 2, ly + h / 2, 0.04);
  const n = o.mullions || Math.max(1, Math.round(w / 1.4));
  for (let i = 1; i < n; i++) fbox(kit, fr, F, t * 0.7, h, 0.09, lx - w / 2 + (w * i) / n, ly + h / 2, 0.04);
  if (o.transom) fbox(kit, fr, F, w, t * 0.7, 0.09, lx, ly + o.transom, 0.04);
}

// ---------- West Africa: a modern villa like the best of Banana Island, Lagos ----------

export function villaWestAfrica(group, P, cx, cz) {
  const kit = new Kit();
  const M = Object.assign(common(), {
    white: mats.plaster('#e9e3d8', 3),
    dark: mats.plaster('#4b4e53', 3),
    stone: mats.stone('#cbbfae', 3),
    slab: mats.plaster('#efebe4', 3),
    wood: mats.wood('#9a6440', 1.6),
    frame: mats.metal('#2a2c30', 0.45),
    gate: mats.metal('#2d2f33', 0.5),
    deck: mats.pavers('#cfc6b8', 2),
    drive: mats.pavers('#a39788', 2.2),
    poolTile: std({ map: T.tiled(T.poolTiles(), 1 / 1.5), roughness: 0.3 }),
    lounger: mats.paint('#f3efe7', 0.6),
    umbrella: std({ color: '#f1ebe0', roughness: 0.8, side: THREE.DoubleSide }),
  });
  const F = frame(cx, 0, cz, 0);

  // Ground floor, upper floor cantilevered over the terrace, a dark stair tower.
  fbox(kit, M.stone, F, 17.6, 0.35, 12.6, -0.5, 0.17, 0);
  fbox(kit, M.white, F, 17, 3.6, 12, -0.5, 1.8, 0);
  fbox(kit, M.white, F, 12.4, 3.3, 10, 5.2, 3.95 + 1.65, -0.6);
  fbox(kit, M.slab, F, 13.6, 0.38, 11.2, 5.2, 7.45, -0.4);
  fbox(kit, M.slab, F, 8, 0.32, 12.8, -5.5, 3.76, 0.1);
  fbox(kit, M.slab, F, 3.6, 0.32, 13, 9.6, 3.76, 0.2);
  fbox(kit, M.dark, F, 3.2, 8.6, 4.4, -9.4, 4.3, -2.6);
  fbox(kit, M.slab, F, 3.8, 0.3, 5, -9.4, 8.7, -2.6);

  // Front of the ground floor: a wall of glass, the entrance under a slim canopy.
  const front = frame(cx, 0.35, cz + 6, 0);
  glazed(kit, M, front, 1.6, 0.05, 11.6, 3.0, { mullions: 7, transom: 2.5 });
  door(kit, M, front, -6.6, 2.2, 2.9, M.wood, { double: true });
  fbox(kit, M.slab, front, 4.6, 0.18, 2.6, -6.6, 3.15, 1.3);
  fbox(kit, M.frame, front, 0.1, 3.1, 0.1, -8.6, 1.55, 2.5);
  fbox(kit, M.frame, front, 0.1, 3.1, 0.1, -4.6, 1.55, 2.5);
  // Wood-slat cladding beside the entrance.
  for (let i = 0; i < 14; i++) fbox(kit, M.wood, front, 0.08, 3.2, 0.1, -9.1 + i * 0.13, 1.6, 0.06);

  // Upper floor: glazing behind a terrace with a glass railing, wood screen at the corner.
  const up = frame(cx, 3.95, cz + 4.4, 0);
  glazed(kit, M, up, 4.2, 0.2, 7.6, 2.75, { mullions: 5 });
  for (let i = 0; i < 22; i++) fbox(kit, M.wood, up, 0.09, 3.1, 0.1, 8.6 + i * 0.12, 1.6, 0.06);
  fbox(kit, M.rail, F, 9.6, 1.05, 0.04, 3.4, 4.45, 6.3, 1, { cast: false });
  fbox(kit, M.chrome, F, 9.6, 0.05, 0.06, 3.4, 4.98, 6.3);
  fbox(kit, M.frame, F, 0.12, 3.6, 0.12, 10.9, 1.8, 3.9);
  // Side windows.
  const east = frame(cx + 8, 0.35, cz, Math.PI / 2);
  glazed(kit, M, east, 0, 0.6, 5, 2.2);
  const east2 = frame(cx + 11.4, 3.95, cz - 0.6, Math.PI / 2);
  glazed(kit, M, east2, -1, 0.5, 6, 2.3);
  const tower = frame(cx - 7.8, 0.35, cz - 0.4, 0);
  glazed(kit, M, tower, -1.6, 1.2, 0.9, 6.4, { mullions: 1 });

  // Garage on the left.
  fbox(kit, M.white, F, 6, 3.2, 7.5, -13.6, 1.6, 1.6);
  fbox(kit, M.slab, F, 6.6, 0.3, 8.1, -13.6, 3.3, 1.6);
  fbox(kit, M.dark, F, 4.8, 2.5, 0.08, -13.6, 1.25, 5.38);
  for (let i = 0; i < 8; i++) fbox(kit, M.frame, F, 4.8, 0.03, 0.1, -13.6, 0.3 * i + 0.15, 5.42);

  // Pool with a stone deck, loungers and a parasol.
  const px = 8.2;
  const pz = 12.8;
  const pw = 8;
  const pd = 4;
  fbox(kit, M.deck, F, pw + 3, 0.3, 1.5, px, 0.15, pz - pd / 2 - 0.75);
  fbox(kit, M.deck, F, pw + 3, 0.3, 1.5, px, 0.15, pz + pd / 2 + 0.75);
  fbox(kit, M.deck, F, 1.5, 0.3, pd, px - pw / 2 - 0.75, 0.15, pz);
  fbox(kit, M.deck, F, 1.5, 0.3, pd, px + pw / 2 + 0.75, 0.15, pz);
  fbox(kit, M.poolTile, F, pw, 0.04, pd, px, 0.02, pz, 1, { cast: false });
  fbox(kit, M.poolTile, F, pw, 0.28, 0.04, px, 0.15, pz - pd / 2 + 0.02, 1, { cast: false });
  fbox(kit, M.poolTile, F, 0.04, 0.28, pd, px - pw / 2 + 0.02, 0.15, pz, 1, { cast: false });
  fbox(kit, M.deck, F, 8, 0.3, 3.2, px, 0.15, pz - pd / 2 - 3, 1);
  for (const lx of [5.5, 8, 10.5]) {
    fbox(kit, M.lounger, F, 0.75, 0.3, 1.9, lx, 0.48, pz - pd / 2 - 3.2);
    fbox(kit, M.lounger, F, 0.75, 0.5, 0.12, lx, 0.72, pz - pd / 2 - 4.05, 1);
  }
  const shade = new THREE.ConeGeometry(1.7, 0.6, 12, 1, true);
  fgeo(kit, M.umbrella, F, shade, 13.2, 2.6, pz - pd / 2 - 3);
  fbox(kit, M.chrome, F, 0.05, 2.5, 0.05, 13.2, 1.25, pz - pd / 2 - 3);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), P.water('#3ab3c9', 0.78));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx + px, 0.24, cz + pz);
  group.add(water);

  // Driveway from the gate to the door.
  fbox(kit, M.drive, F, 5.4, 0.06, 16.4, -7.4, 0.03, 14.3, 1, { cast: false });
  fbox(kit, M.drive, F, 7, 0.06, 3, -12.6, 0.03, 6.9, 1, { cast: false });
  fbox(kit, M.deck, F, 1.4, 0.06, 12, -3, 0.03, 12.5, 1, { cast: false });

  // Boundary wall with a sliding gate.
  const wallH = 2.5;
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    fbox(kit, M.white, F, len, wallH, 0.3, (x0 + x1) / 2, wallH / 2, (z0 + z1) / 2, 1);
    fbox(kit, M.dark, F, len + 0.1, 0.12, 0.42, (x0 + x1) / 2, wallH + 0.06, (z0 + z1) / 2, 1);
  };
  wall(-17, 22.5, -10.4, 22.5);
  wall(-4.4, 22.5, 17, 22.5);
  const side = (x, z0, z1) => {
    fbox(kit, M.white, F, 0.3, wallH, z1 - z0, x, wallH / 2, (z0 + z1) / 2);
    fbox(kit, M.dark, F, 0.42, 0.12, z1 - z0, x, wallH + 0.06, (z0 + z1) / 2);
  };
  side(-17, -14, 22.5);
  side(17, -14, 22.5);
  fbox(kit, M.white, F, 34, wallH, 0.3, 0, wallH / 2, -14);
  for (let i = 0; i < 30; i++) fbox(kit, M.gate, F, 0.12, 2.2, 0.08, -10.2 + i * 0.2, 1.15, 22.5);
  fbox(kit, M.gate, F, 6, 0.12, 0.12, -7.4, 2.25, 22.5);
  fbox(kit, M.dark, F, 0.6, 2.9, 0.6, -10.6, 1.45, 22.5);
  fbox(kit, M.dark, F, 0.6, 2.9, 0.6, -4.2, 1.45, 22.5);

  kit.build(group);

  // Gardens: palms along the wall, frangipani-like trees, bougainvillea on the corners.
  const g = new Kit();
  const PM = P.plants;
  [[-1.5, 20.8], [4.5, 21], [15.2, 20.6], [15.2, 9], [-15.2, 19.8], [15, -6], [-15, -8], [2, -12], [-14.8, 11]].forEach(([x, z], i) => palm(g, PM, cx + x, cz + z, 7 + (i % 3) * 1.4, 30 + i));
  tree(g, PM, cx - 3, cz - 11.5, 8, 'mango', 51);
  tree(g, PM, cx + 9, cz - 11.8, 7, 'flamboyant', 52);
  bush(g, PM, cx + 16, cz + 21.6, 1.4, 'bougainvillea', 61, 2.8);
  bush(g, PM, cx - 16.2, cz + 21.4, 1.3, 'bougainvillea', 62, 2.6);
  bush(g, PM, cx - 3.8, cz + 21.4, 1.1, 'bougainvillea', 63, 2.4);
  hedge(g, PM, cx + 3.2, cz + 7.4, cx + 13.4, cz + 7.4, 0.9, 0.7);
  hedge(g, PM, cx - 16.6, cz + 22, cx - 10.9, cz + 22, 1.1, 0.7);
  for (const [x, z] of [[-9.8, 6.8], [-5.2, 7], [11.6, 5.8], [12.4, 4]]) bush(g, PM, cx + x, cz + z, 0.7, 'hedge', x * 7);
  g.build(group);

  return {
    lawn: [[cx - 16.5, cz + 7.5, cx - 10.5, cz + 22], [cx - 4.5, cz + 6.5, cx + 3, cz + 22], [cx + 3, cz + 18.5, cx + 16.5, cz + 22]],
    party: { x: cx - 0.6, z: cz + 15.2 },
    door: { x: cx - 6.6, z: cz + 6.5 },
    gate: { x: cx - 7.4, z: cz + 22.5 },
  };
}


// A boundary wall with a gate, shared by the houses below.
function boundary(kit, F, wallMat, capMat, o) {
  const H = o.h;
  const front = 22.5;
  const seg = (x0, x1) => {
    fbox(kit, wallMat, F, x1 - x0, H, 0.32, (x0 + x1) / 2, H / 2, front);
    if (capMat) fbox(kit, capMat, F, x1 - x0 + 0.06, 0.1, 0.42, (x0 + x1) / 2, H + 0.05, front);
  };
  seg(-17, o.gate - 3);
  seg(o.gate + 3, 17);
  for (const sx of [-17, 17]) {
    fbox(kit, wallMat, F, 0.32, H, 36.5, sx, H / 2, 4.25);
    if (capMat) fbox(kit, capMat, F, 0.42, 0.1, 36.5, sx, H + 0.05, 4.25);
  }
  fbox(kit, wallMat, F, 34, H, 0.32, 0, H / 2, -14);
  for (const gx of [o.gate - 3, o.gate + 3]) {
    fbox(kit, o.pier || wallMat, F, 0.7, H + 0.7, 0.7, gx, (H + 0.7) / 2, front);
    if (o.lamp) fbox(kit, o.lamp, F, 0.3, 0.38, 0.3, gx, H + 0.9, front);
    if (o.finial) fgeo(kit, o.finial, F, new THREE.SphereGeometry(0.28, 16, 12), gx, H + 0.98, front);
  }
}

// ---------- South Asia: a contemporary villa with sandstone, a jaali screen and a chhatri ----------

export function villaSouthAsia(group, P, cx, cz) {
  const kit = new Kit();
  const M = Object.assign(common(), {
    white: mats.plaster('#ebe3d4', 3),
    sand: mats.stone('#d6b588', 3),
    red: mats.stone('#b0603e', 3),
    slab: mats.plaster('#efe9df', 3),
    wood: mats.wood('#7a4b2c', 1.6),
    frame: mats.metal('#3a2f28', 0.5),
    jaali: std({ map: T.tiled(T.jaali(), 1 / 1.2), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }),
    deck: mats.pavers('#cdbb9c', 2),
    drive: mats.pavers('#a8977f', 2.2),
    rail: mats.metal('#2d2a28', 0.5),
    pond: std({ color: '#2e4f46', roughness: 0.4 }),
  });
  const F = frame(cx, 0, cz, 0);
  fbox(kit, M.sand, F, 18.6, 0.45, 12.6, 0, 0.22, 0);
  fbox(kit, M.white, F, 18, 3.6, 12, 0, 2.25, 0);
  fbox(kit, M.sand, F, 6, 3.6, 12.1, -6, 2.25, 0);
  fbox(kit, M.white, F, 12.6, 3.3, 10, -2.7, 4.05 + 1.65, -0.8);
  fbox(kit, M.slab, F, 13.6, 0.36, 11, -2.7, 7.55, -0.8);
  fbox(kit, M.slab, F, 19, 0.32, 13, 0, 4.2, 0);
  // Parapet around the open terrace on the right, with a timber pergola.
  fbox(kit, M.white, F, 6, 1.0, 0.24, 6.5, 4.85, 6.3);
  fbox(kit, M.white, F, 0.24, 1.0, 12.6, 9.4, 4.85, 0);
  for (let i = 0; i < 9; i++) fbox(kit, M.wood, F, 0.14, 0.24, 9.4, 4.3 + i * 0.6, 7.3, 0.6);
  for (const [px, pz] of [[4.2, 5.2], [9.1, 5.2], [9.1, -4]]) fbox(kit, M.wood, F, 0.24, 3.1, 0.24, px, 5.75, pz);
  fbox(kit, M.wood, F, 5.4, 0.3, 0.3, 6.65, 7.1, 5.2);
  // Ground floor: tall glass behind a red sandstone portico.
  const front = frame(cx, 0.45, cz + 6, 0);
  glazed(kit, M, front, 3.8, 0.1, 9.6, 3.0, { mullions: 6, transom: 2.5 });
  door(kit, M, front, -6, 2.2, 2.9, M.wood, { double: true, panels: M.frame });
  fbox(kit, M.red, F, 4.8, 0.45, 2.8, -6, 4.0, 7.4);
  for (const px of [-7.9, -4.1]) fgeo(kit, M.red, F, column(0.22, 3.4, 16), px, 0.45, 8.5);
  // Upper floor glazing, a full-height jaali screen beside the stairs.
  const up = frame(cx, 4.36, cz + 4.2, 0);
  glazed(kit, M, up, -0.4, 0.2, 6.6, 2.7, { mullions: 4 });
  const jaaliGeo = new THREE.PlaneGeometry(2.6, 6.2);
  const uv = jaaliGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.6, uv.getY(i) * 6.2);
  fgeo(kit, M.jaali, front, jaaliGeo, -9.6 + 1.3 + 0.9, 3.4, 0.35);
  fbox(kit, M.interior, front, 2.4, 6, 0.02, -7.4, 3.4, 0.02, 1, { cast: false });
  // A chhatri on the roof: four slim columns and a dome.
  const ch = [-7.2, 8.0, -2.4];
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) fgeo(kit, M.sand, F, column(0.12, 2.2, 10), ch[0] + dx, ch[1], ch[2] + dz);
  fbox(kit, M.sand, F, 2.8, 0.3, 2.8, ch[0], ch[1] + 2.35, ch[2]);
  fgeo(kit, M.white, F, new THREE.SphereGeometry(1.15, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), ch[0], ch[1] + 2.5, ch[2]);
  fgeo(kit, M.sand, F, new THREE.ConeGeometry(0.12, 0.7, 8), ch[0], ch[1] + 3.95, ch[2]);
  fbox(kit, M.slab, F, 3.2, 0.25, 3.2, ch[0], ch[1] - 0.1, ch[2]);

  // A lotus reflecting pool and a terrace of sandstone.
  fbox(kit, M.deck, F, 12, 0.18, 7, 7.6, 0.09, 12.6, 1, { cast: false });
  fbox(kit, M.pond, F, 8, 0.06, 3.4, 7.6, 0.16, 12.6, 1, { cast: false });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.4), P.water('#3d7d77', 0.82));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx + 7.6, 0.21, cz + 12.6);
  group.add(water);
  fbox(kit, M.drive, F, 5.4, 0.06, 15, -11.2, 0.03, 14.5, 1, { cast: false });
  fbox(kit, M.deck, F, 1.4, 0.06, 12, -3, 0.03, 13, 1, { cast: false });
  boundary(kit, F, M.sand, M.white, { h: 1.6, gate: -11.2, pier: M.red, lamp: std({ color: '#fff1cf', emissive: '#ffd890', emissiveIntensity: 2 }) });
  for (let i = 0; i < 30; i++) fbox(kit, M.rail, F, 0.05, 0.8, 0.05, -16.5 + i * 0.55 + (i > 10 ? 6.2 : 0), 2.0, 22.5);
  kit.build(group);

  const g = new Kit();
  const PM = P.plants;
  [[-14.8, 20.5], [14.6, 20.8], [15.2, 6], [-15, -9], [14.8, -9]].forEach(([x, z], i) => palm(g, PM, cx + x, cz + z, 8 + (i % 2) * 1.5, 70 + i));
  tree(g, PM, cx + 4, cz - 11.5, 9, 'neem', 71);
  tree(g, PM, cx - 6, cz - 11, 8.5, 'mango', 72);
  bush(g, PM, cx + 9.4, cz + 6.4, 1.1, 'bougainvillea', 73, 4.6);
  bush(g, PM, cx + 9.4, cz + 3, 1.0, 'bougainvillea', 74, 4.4);
  bush(g, PM, cx - 15.8, cz + 21.6, 1.2, 'bougainvillea', 75, 2.4);
  for (const [x, z] of [[4.2, 12.2], [5.6, 13.2], [9.2, 12.4], [10.4, 13]]) bush(g, PM, cx + x, cz + z, 0.35, 'lotus', x * 9, 0.22);
  for (const [x, z] of [[3, 7], [-1, 7], [12.8, 9.4], [12.8, 15.8]]) bush(g, PM, cx + x, cz + z, 0.55, 'hedge', x * 5 + z, 0.9);
  g.build(group);

  return {
    lawn: [[cx - 8.5, cz + 7.5, cx + 1.6, cz + 22], [cx + 1.6, cz + 16.2, cx + 16.5, cz + 22]],
    party: { x: cx - 0.6, z: cz + 15.2 },
    door: { x: cx - 6, z: cz + 6.5 },
    gate: { x: cx - 11.2, z: cz + 22.5 },
  };
}

// ---------- Latin America: a Spanish colonial hacienda ----------

export function haciendaLatAm(group, P, cx, cz) {
  const kit = new Kit();
  const M = Object.assign(common(), {
    stucco: mats.plaster('#f0e6d6', 3),
    ochre: mats.plaster('#e2b77c', 3),
    clay: mats.clay('#b4532d', 2.2),
    beam: mats.wood('#5a3a22', 1),
    wood: mats.wood('#6b4428', 1.2),
    blue: mats.paint('#2c6ea3', 0.5),
    frame: mats.wood('#4e3220', 1),
    iron: mats.metal('#2a2826', 0.6),
    floor: std({ map: T.tiled(T.tiles('terracotta'), 1 / 1.6), roughness: 0.7 }),
    talavera: std({ map: T.tiled(T.tiles('talavera'), 1 / 0.8), roughness: 0.35 }),
    stone: mats.stone('#c9b69a', 2),
    pot: std({ color: '#b8613a', roughness: 0.8 }),
  });
  const F = frame(cx, 0, cz, 0);
  // Two-storey main house with a wide tiled roof.
  fbox(kit, M.stone, F, 17, 0.4, 11, -1, 0.2, -0.5);
  fbox(kit, M.stucco, F, 16, 6.6, 10, -1, 3.5, -0.5);
  fgeo(kit, M.clay, F, hipRoof(16, 10, 2.9, 0.9), -1, 6.8, -0.5);
  fbox(kit, M.stucco, F, 17.6, 0.25, 11.6, -1, 6.78, -0.5);
  // Ground-floor arcade: five arches, a tiled veranda and roof over it.
  const arch = archWall(16, 3.4, 0.5, 5, 2.2, 2.95, 0);
  fgeo(kit, M.stucco, F, arch, -1, 0.4, 7.2);
  fbox(kit, M.floor, F, 16, 0.08, 2.7, -1, 0.44, 5.8, 1, { cast: false });
  const slope = new THREE.PlaneGeometry(16.8, 3.4);
  const suv = slope.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) * 16.8, suv.getY(i) * 3.4);
  slope.rotateX(-Math.PI / 2 + 0.32);
  fgeo(kit, M.clay, F, slope, -1, 4.35, 6.0);
  for (let i = 0; i < 12; i++) fbox(kit, M.beam, F, 0.18, 0.2, 3.2, -8.6 + i * 1.38, 3.75, 5.9);
  // Upper floor: tall windows with shutters and a carved wooden balcony.
  const up = frame(cx, 3.95, cz + 4.5, 0);
  for (const lx of [-7, -3.6, 1.6, 5]) win(kit, M, up, lx, 0.5, 1.2, 2.1, { frame: M.frame, bars: [2, 3], shutters: M.blue, sill: M.stone });
  fbox(kit, M.wood, F, 3.6, 0.18, 1.2, -1, 4.45, 5.1);
  for (let i = 0; i < 14; i++) fbox(kit, M.wood, F, 0.08, 0.9, 0.08, -2.65 + i * 0.25, 4.95, 5.65);
  fbox(kit, M.wood, F, 3.6, 0.1, 0.12, -1, 5.42, 5.65);
  win(kit, M, up, -1, 0.5, 1.6, 2.4, { frame: M.frame, bars: [2, 4] });
  // Doors and windows behind the arcade.
  const back = frame(cx, 0.4, cz + 4.5, 0);
  door(kit, M, back, -1, 2.0, 2.6, M.blue, { double: true, frame: M.frame, panels: M.frame });
  for (const lx of [-7.3, -4.2, 2.2, 5.3]) win(kit, M, back, lx, 0.8, 1.1, 1.7, { frame: M.frame, grille: M.iron, bars: [2, 3] });
  // A single-storey wing in warm ochre.
  fbox(kit, M.ochre, F, 8, 3.6, 9, 11, 1.8, 1);
  fgeo(kit, M.clay, F, hipRoof(8, 9, 2.0, 0.7), 11, 3.6, 1);
  const wing = frame(cx + 11, 0, cz + 5.5, 0);
  door(kit, M, wing, -1.8, 1.4, 2.5, M.blue, { frame: M.frame });
  win(kit, M, wing, 1.6, 0.9, 1.3, 1.6, { frame: M.frame, grille: M.iron, bars: [2, 3] });
  fbox(kit, M.talavera, wing, 2.4, 0.5, 0.04, -1.8, 2.9, 0.03, 1, { cast: false });
  // A stone fountain in the courtyard, terracotta paths, pots of flowers.
  const fx = 8.6;
  const fz = 14;
  fgeo(kit, M.stone, F, new THREE.CylinderGeometry(2.0, 2.15, 0.6, 32), fx, 0.3, fz);
  fgeo(kit, M.stone, F, new THREE.CylinderGeometry(0.28, 0.4, 1.2, 16), fx, 0.6, fz);
  fgeo(kit, M.stone, F, new THREE.CylinderGeometry(0.9, 0.5, 0.25, 24), fx, 1.85, fz);
  fgeo(kit, M.stone, F, new THREE.CylinderGeometry(0.12, 0.18, 0.6, 12), fx, 2.1, fz);
  const water = new THREE.Mesh(new THREE.CircleGeometry(1.85, 32), P.water('#4a93a3', 0.85));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx + fx, 0.55, cz + fz);
  group.add(water);
  fbox(kit, M.floor, F, 3, 0.06, 15, -1, 0.03, 14.5, 1, { cast: false });
  fbox(kit, M.floor, F, 9, 0.06, 3, 4.5, 0.03, fz, 1, { cast: false });
  fbox(kit, M.floor, F, 5, 0.06, 13, -12.5, 0.03, 15.5, 1, { cast: false });
  for (const [x, z, sz] of [[-3.2, 7.8, 0.4], [1.2, 7.8, 0.4], [6, 7.6, 0.5], [-8.5, 7.8, 0.45]]) {
    fgeo(kit, M.pot, F, new THREE.CylinderGeometry(sz, sz * 0.7, sz * 1.4, 14), x, sz * 0.7, z);
  }
  boundary(kit, F, M.stucco, M.clay, { h: 1.9, gate: -12.5, pier: M.stucco, finial: M.stone });
  for (let i = 0; i < 7; i++) fbox(kit, M.wood, F, 0.7, 1.7, 0.1, -15.1 + i * 0.75, 0.95, 22.5);
  kit.build(group);

  const g = new Kit();
  const PM = P.plants;
  tree(g, PM, cx + 14, cz + 19, 9.5, 'jacaranda', 81);
  tree(g, PM, cx - 15, cz + 6, 9, 'jacaranda', 82);
  tree(g, PM, cx + 3, cz - 11, 9, 'broadleaf', 83);
  palm(g, PM, cx - 15, cz - 9, 9, 84);
  for (const [x, z] of [[-6.5, 7.6], [4.6, 7.6], [-9.4, 7.4]]) bush(g, PM, cx + x, cz + z, 0.9, 'bougainvillea', x * 11, 3.6);
  bush(g, PM, cx + 16, cz + 21.6, 1.2, 'bougainvillea', 85, 2.4);
  for (const [x, z, sz] of [[5.2, 17.4, 0.9], [12, 11, 0.8], [11.6, 17.6, 1], [-6, 20.5, 0.9], [14.5, 14, 0.8]]) agave(g, PM.agave, cx + x, cz + z, sz, x * 3 + z);
  for (const [x, z] of [[-3.2, 7.8], [1.2, 7.8], [6, 7.6], [-8.5, 7.8]]) bush(g, PM, cx + x, cz + z, 0.42, 'bougainvillea', x * 13 + 7, 1.4);
  g.build(group);
  return {
    lawn: [[cx - 9.8, cz + 8, cx - 2.6, cz + 22], [cx + 0.6, cz + 16.2, cx + 16.5, cz + 22]],
    party: { x: cx - 0.6, z: cz + 15.2 },
    door: { x: cx - 1, z: cz + 6.5 },
    gate: { x: cx - 12.5, z: cz + 22.5 },
  };
}

// ---------- UK & US: a Georgian brick house ----------

export function georgianUK(group, P, cx, cz) {
  const kit = new Kit();
  const M = Object.assign(common(), {
    brick: mats.brick('#9a4a33', 2.6),
    slate: mats.slate('#566069', 2.2),
    white: mats.paint('#f4f2ec', 0.6),
    stone: mats.stone('#e2dccf', 2.5),
    black: mats.paint('#16181b', 0.35),
    frame: mats.paint('#f4f2ec', 0.5),
    iron: mats.metal('#1d1f22', 0.5),
    gravel: std({ map: T.tiled(T.gravel('#cdbfa2'), 1 / 3), roughness: 1 }),
    pot: mats.paint('#3f4a3a', 0.6),
  });
  const F = frame(cx, 0, cz, 0);
  const W = 15;
  const D = 10;
  fbox(kit, M.stone, F, W + 0.6, 0.6, D + 0.6, 0, 0.3, 0);
  fbox(kit, M.brick, F, W, 7.2, D, 0, 4.2, 0);
  fbox(kit, M.white, F, W + 0.6, 0.35, D + 0.6, 0, 7.9, 0);
  fbox(kit, M.stone, F, W + 0.1, 0.25, D + 0.1, 0, 4.05, 0);
  fgeo(kit, M.slate, F, hipRoof(W, D, 3.6, 0.45), 0, 8.05, 0);
  for (const sx of [-5, 5]) {
    fbox(kit, M.brick, F, 1.3, 3.6, 0.9, sx, 10.7, -1);
    fbox(kit, M.stone, F, 1.45, 0.2, 1.05, sx, 12.55, -1);
    for (const dx of [-0.3, 0.3]) fgeo(kit, M.pot, F, new THREE.CylinderGeometry(0.12, 0.14, 0.45, 10), sx + dx, 12.65, -1);
  }
  // Quoins at the corners.
  for (let i = 0; i < 12; i++) for (const sx of [-W / 2, W / 2]) fbox(kit, M.stone, F, 0.36, 0.28, 0.36, sx, 0.9 + i * 0.6 + (i % 2 ? 0.05 : 0), D / 2);
  // Sash windows: five above, four below, a door with a portico and a fanlight.
  const front = frame(cx, 0.6, cz + D / 2, 0);
  for (const lx of [-6, -3, 0, 3, 6]) win(kit, M, front, lx, 4.2, 1.25, 2.1, { frame: M.frame, bars: [2, 3], sill: M.stone, lintel: M.stone });
  for (const lx of [-6, -3, 3, 6]) win(kit, M, front, lx, 0.8, 1.35, 2.4, { frame: M.frame, bars: [2, 4], sill: M.stone, lintel: M.stone });
  door(kit, M, front, 0, 1.3, 2.4, M.black, { frame: M.frame, panels: M.black, fanlight: true });
  for (const lx of [-1.3, 1.3]) fgeo(kit, M.white, front, column(0.17, 3.0, 16), lx, 0, 1.3);
  fbox(kit, M.white, front, 3.4, 0.3, 1.8, 0, 3.15, 0.85);
  fgeo(kit, M.white, front, gableRoof(3.4, 1.8, 0.7, 0.1), 0, 3.3, 0.85, 0, Math.PI / 2);
  fbox(kit, M.stone, front, 3.6, 0.3, 2.4, 0, -0.45, 1.2);
  fbox(kit, M.stone, front, 3.0, 0.15, 0.4, 0, -0.52, 2.6);
  // A lower wing to the side.
  fbox(kit, M.brick, F, 7, 3.6, 8, 11, 2.1, -1);
  fgeo(kit, M.slate, F, hipRoof(7, 8, 2.2, 0.4), 11, 3.9, -1);
  const wing = frame(cx + 11, 0.6, cz + 3, 0);
  win(kit, M, wing, -1.5, 0.7, 1.3, 2.0, { frame: M.frame, bars: [2, 3], sill: M.stone });
  win(kit, M, wing, 1.6, 0.7, 1.3, 2.0, { frame: M.frame, bars: [2, 3], sill: M.stone });
  // Gravel drive, a stone path, a low brick wall with iron railings.
  fbox(kit, M.gravel, F, 5.6, 0.05, 14.5, -10.5, 0.03, 15, 1, { cast: false });
  fbox(kit, M.gravel, F, 12, 0.05, 4, -6, 0.03, 9.5, 1, { cast: false });
  fbox(kit, M.stone, F, 2.4, 0.06, 13, 0, 0.03, 15.5, 1, { cast: false });
  boundary(kit, F, M.brick, M.stone, { h: 0.9, gate: -10.5, pier: M.brick, finial: M.stone });
  for (let i = 0; i < 52; i++) {
    const x = -16.6 + i * 0.64;
    if (Math.abs(x + 10.5) < 3.1) continue;
    fbox(kit, M.iron, F, 0.04, 0.9, 0.04, x, 1.4, 22.5);
  }
  fbox(kit, M.iron, F, 34, 0.05, 0.05, 0, 1.82, 22.55);
  for (const lx of [-1.6, 1.6]) {
    fbox(kit, M.iron, F, 0.1, 2.8, 0.1, lx, 1.4, 19.5);
    fbox(kit, std({ color: '#fff3d4', emissive: '#ffd38a', emissiveIntensity: 2.5 }), F, 0.3, 0.42, 0.3, lx, 3.0, 19.5);
  }
  kit.build(group);

  const g = new Kit();
  const PM = P.plants;
  tree(g, PM, cx + 13, cz + 15, 12, 'oak', 91);
  tree(g, PM, cx - 15, cz - 6, 11, 'oak', 92);
  tree(g, PM, cx + 5, cz - 12, 10, 'maple', 93);
  hedge(g, PM, cx - 1.6, cz + 9, cx - 1.6, cz + 21.5, 0.8, 0.6);
  hedge(g, PM, cx + 1.6, cz + 9, cx + 1.6, cz + 21.5, 0.8, 0.6);
  hedge(g, PM, cx - 16.6, cz + 21.8, cx - 13.6, cz + 21.8, 1.4, 0.8);
  for (const [x, z] of [[-4, 5.8], [4, 5.8], [-7.4, 5.8], [7.4, 5.8]]) bush(g, PM, cx + x, cz + z, 0.7, 'rose', x * 7, 1.2);
  bush(g, PM, cx + 6.8, cz + 5.6, 0.9, 'hedge', 94, 1.6);
  g.build(group);
  return {
    lawn: [[cx - 7.6, cz + 11.6, cx - 1.9, cz + 22], [cx + 1.9, cz + 8, cx + 16.5, cz + 22]],
    party: { x: cx + 6.8, z: cz + 14.6 },
    door: { x: cx, z: cz + 7 },
    gate: { x: cx - 10.5, z: cz + 22.5 },
  };
}

export const HOUSES = { westafrica: villaWestAfrica, southasia: villaSouthAsia, latam: haciendaLatAm, ukus: georgianUK };
