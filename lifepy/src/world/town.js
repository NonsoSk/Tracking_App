// The rest of the neighbourhood: neighbours, Grandma's bungalow, the park, and the
// places later chapters lead to (school, university, the city, the wedding venue).
import * as THREE from 'three';
import { Kit, std, place, windy, setSway } from './kit.js';
import { frame, fbox, fgeo, win, door, hipRoof, gableRoof, column, mats } from './build.js';
import { palm, tree, bush, hedge } from './nature.js';
import { rng } from './noise.js';
import * as T from './textures.js';

export function townMaterials(style) {
  const S = style;
  return {
    walls: S.walls.map((c, i) => (S.brickWalls && i < 3 ? mats.brick(c, 2.4) : mats.plaster(c, 3))),
    trim: mats.plaster(S.trim, 3),
    dark: mats.plaster('#4b4e53', 3),
    frame: mats.metal('#2a2c30', 0.5),
    roof: S.roof === 'clay' ? mats.clay(S.roofColor, 2.2) : S.roof === 'slate' ? mats.slate(S.roofColor, 2.2) : mats.plaster(S.roofColor, 3),
    wood: mats.wood('#8a5a3a', 1.6),
    grandmaRoof: S.grandmaRoof === 'slate' ? mats.slate(S.grandmaRoofColor || '#59606a', 2.2) : mats.clay(S.grandmaRoofColor || '#9a4a32', 2.2),
    shutter: mats.paint(S.shutter || '#3f6b5a', 0.6),
    brick: mats.brick(S.brick || '#9c4a33', 2.4),
    stone: mats.stone('#cbbfae', 3),
    pave: mats.pavers('#a9a196', 2.2),
    glass: new THREE.MeshPhysicalMaterial({ color: '#28343e', metalness: 0.3, roughness: 0.04, envMapIntensity: 1.5, clearcoat: 1 }),
    chrome: std({ color: '#c9ccd1', metalness: 0.9, roughness: 0.2 }),
    interior: std({ map: T.tiled(T.interior(), 1 / 4, 1 / 3), emissive: '#ffffff', emissiveMap: T.tiled(T.interior(), 1 / 4, 1 / 3), emissiveIntensity: 0.15, roughness: 1 }),
    gravel: std({ map: T.tiled(T.gravel(), 1 / 3), roughness: 1 }),
    play: ['#d9493a', '#2f7fd0', '#f2b33d', '#3fa06a'].map((c) => std({ color: c, roughness: 0.45 })),
    steel: std({ color: '#b8bcc2', metalness: 0.85, roughness: 0.3 }),
    rubber: std({ color: '#b5583f', roughness: 1 }),
    bench: mats.wood('#7a5236', 1),
    towerGlass: new THREE.MeshPhysicalMaterial({ color: '#53708a', metalness: 0.6, roughness: 0.12, envMapIntensity: 1.2 }),
    towerFrame: std({ color: '#d5d8dc', roughness: 0.6 }),
  };
}

function glazedSmall(kit, M, F, lx, ly, w, h) {
  fbox(kit, M.interior, F, w, h, 0.02, lx, ly + h / 2, 0.014, 1, { cast: false });
  fbox(kit, M.glass, F, w, h, 0.03, lx, ly + h / 2, 0.045, 1, { cast: false });
  fbox(kit, M.frame, F, w + 0.12, 0.06, 0.1, lx, ly + h + 0.03, 0.04);
  fbox(kit, M.frame, F, w + 0.12, 0.06, 0.1, lx, ly - 0.03, 0.04);
  fbox(kit, M.frame, F, 0.06, h, 0.1, lx - w / 2 - 0.03, ly + h / 2, 0.04);
  fbox(kit, M.frame, F, 0.06, h, 0.1, lx + w / 2 + 0.03, ly + h / 2, 0.04);
}

// A walled plot with a gate, as many homes have in hot cities; or a low wall and hedge.
function plotWall(kit, M, F, w, d, gateX, wallH, mat) {
  const half = w / 2;
  const seg = (x0, x1) => {
    fbox(kit, mat, F, x1 - x0, wallH, 0.28, (x0 + x1) / 2, wallH / 2, d);
    fbox(kit, M.dark, F, x1 - x0 + 0.06, 0.1, 0.36, (x0 + x1) / 2, wallH + 0.05, d);
  };
  seg(-half, gateX - 2.6);
  seg(gateX + 2.6, half);
  for (const sx of [-half, half]) {
    fbox(kit, mat, F, 0.28, wallH, d * 2, sx, wallH / 2, 0);
  }
  fbox(kit, M.frame, F, 5.2, wallH * 0.85, 0.08, gateX, wallH * 0.43, d);
}

// A neighbour's home: varied modern volumes with flat or pitched roofs.
export function neighbour(group, M, P, style, cx, cz, ry, seed) {
  const r = rng(seed);
  const kit = new Kit();
  const F = frame(cx, 0, cz, ry);
  const wall = M.walls[Math.floor(r() * M.walls.length)];
  const w = 11 + r() * 5;
  const d = 9 + r() * 3;
  const h1 = 3.3;
  fbox(kit, M.stone, F, w + 0.4, 0.3, d + 0.4, 0, 0.15, 0);
  fbox(kit, wall, F, w, h1, d, 0, h1 / 2 + 0.3, 0);
  const two = r() > 0.25;
  const w2 = w * (0.55 + r() * 0.25);
  const off = (r() - 0.5) * (w - w2);
  if (two) fbox(kit, r() > 0.5 ? wall : M.trim, F, w2, h1, d - 1.2, off, h1 * 1.5 + 0.3, -0.4);
  const topY = two ? h1 * 2 + 0.3 : h1 + 0.3;
  if (style.roof === 'flat') {
    fbox(kit, M.trim, F, w + 0.8, 0.3, d + 0.8, 0, h1 + 0.45, 0);
    if (two) fbox(kit, M.trim, F, w2 + 1, 0.3, d - 0.2, off, topY + 0.15, -0.4);
  } else {
    const rw = two ? w2 : w;
    const roof = style.roof === 'clay' || r() > 0.5 ? hipRoof(rw, two ? d - 1.2 : d, 2.6, 0.6) : gableRoof(rw, two ? d - 1.2 : d, 2.8, 0.6);
    fgeo(kit, M.roof, F, roof, two ? off : 0, topY, two ? -0.4 : 0);
    if (two) fgeo(kit, M.roof, F, hipRoof(w, d, 1.6, 0.5), 0, h1 + 0.3, 0);
  }
  const front = frame(...F.at(0, 0.3, d / 2), ry);
  const n = Math.max(2, Math.floor(w / 3.4));
  for (let i = 0; i < n; i++) {
    const lx = -w / 2 + (w / n) * (i + 0.5);
    if (i === 1) door(kit, M, front, lx, 1.4, 2.4, M.wood);
    else glazedSmall(kit, M, front, lx, 0.7, 1.8, 1.8);
  }
  if (two) {
    const f2 = frame(...F.at(0, h1 + 0.3, d / 2 - 1.2), ry);
    const m = Math.max(1, Math.floor(w2 / 3));
    for (let i = 0; i < m; i++) glazedSmall(kit, M, f2, off - w2 / 2 + (w2 / m) * (i + 0.5), 0.6, 1.9, 1.7);
  }
  const plotW = w + 10;
  const plotD = 14;
  if (style.walls === 'high' || style.compound) plotWall(kit, M, F, plotW, plotD, -plotW / 2 + 5, 2.3, wall);
  else {
    hedge(kit, P.plants, ...F.at(-plotW / 2, 0, plotD).filter((_, i) => i !== 1), ...F.at(-3, 0, plotD).filter((_, i) => i !== 1), 0.9, 0.6);
    hedge(kit, P.plants, ...F.at(3, 0, plotD).filter((_, i) => i !== 1), ...F.at(plotW / 2, 0, plotD).filter((_, i) => i !== 1), 0.9, 0.6);
  }
  fbox(kit, M.pave, F, 3.4, 0.05, plotD - d / 2, two ? -w / 2 + 2 : 0, 0.03, d / 2 + (plotD - d / 2) / 2, 1, { cast: false });
  const plants = new Kit();
  for (let i = 0; i < 3; i++) {
    const [x, , z] = F.at(-plotW / 2 + 2 + r() * (plotW - 4), 0, d / 2 + 2 + r() * (plotD - d / 2 - 3));
    if (style.tree === 'palm') palm(plants, P.plants, x, z, 6 + r() * 3, seed * 7 + i);
    else tree(plants, P.plants, x, z, 5 + r() * 3, style.tree, seed * 7 + i, 0.6);
  }
  const [bx, , bz] = F.at(-plotW / 2 + 2, 0, plotD - 1.5);
  bush(plants, P.plants, bx, bz, 1, style.flower || 'bougainvillea', seed + 3, 2);
  kit.build(group);
  plants.build(group);
}

// Grandma's house: a classic single-storey bungalow with a deep veranda.
export function bungalow(group, M, P, style, cx, cz, seed = 5) {
  const kit = new Kit();
  const F = frame(cx, 0, cz, 0);
  const w = 15;
  const d = 10;
  const wall = M.walls[0];
  fbox(kit, M.stone, F, w + 4.4, 0.5, d + 4.4, 0, 0.25, 0.6);
  fbox(kit, wall, F, w, 3.2, d, 0, 2.1, 0);
  fgeo(kit, M.grandmaRoof, F, hipRoof(w + 3.6, d + 3.6, 2.6, 0.4), 0, 3.7, 0.6);
  fbox(kit, M.trim, F, w + 4.4, 0.25, d + 4.4, 0, 3.6, 0.6);
  for (let i = 0; i < 7; i++) {
    const g = column(0.14, 3.1, 12);
    fgeo(kit, M.trim, F, g, -w / 2 - 1.5 + i * ((w + 3) / 6), 0.5, d / 2 + 2.4);
  }
  for (let i = 0; i < 8; i++) fbox(kit, M.trim, F, 0.06, 0.6, 0.06, -w / 2 - 1.5 + i * ((w + 3) / 7), 0.8, d / 2 + 2.45);
  fbox(kit, M.trim, F, w + 3, 0.06, 0.06, 0, 1.1, d / 2 + 2.45);
  const front = frame(cx, 0.5, cz + d / 2, 0);
  door(kit, M, front, 0, 1.8, 2.5, M.wood, { double: true, panels: M.trim });
  for (const lx of [-5, -2.8, 2.8, 5]) win(kit, M, front, lx, 0.8, 1.2, 1.6, { bars: [2, 3], frame: M.trim, shutters: M.shutter || M.wood, sill: M.trim });
  fbox(kit, M.pave, F, 3, 0.06, 9, 0, 0.03, d / 2 + 7.5, 1, { cast: false });
  kit.build(group);
  const plants = new Kit();
  tree(plants, P.plants, cx - 9, cz + 10, 9, style.grandmaTree || 'mango', seed + 1);
  tree(plants, P.plants, cx + 10, cz - 4, 8, style.tree === 'palm' ? 'flamboyant' : style.tree, seed + 2);
  bush(plants, P.plants, cx - 4, cz + 9.6, 1.1, style.flower || 'bougainvillea', seed + 3, 1.6);
  bush(plants, P.plants, cx + 4, cz + 9.6, 1.1, style.flower || 'bougainvillea', seed + 4, 1.6);
  hedge(plants, P.plants, cx - 11, cz + 14, cx - 2.5, cz + 14, 1.1, 0.7);
  hedge(plants, P.plants, cx + 2.5, cz + 14, cx + 11, cz + 14, 1.1, 0.7);
  plants.build(group);
  return { door: { x: cx, z: cz + d / 2 + 2 }, lawn: [[cx - 11, cz + 8, cx - 2, cz + 13.5], [cx + 2, cz + 8, cx + 11, cz + 13.5]] };
}

// The park: lawns, gravel paths, a playground with swings and a slide, a pond.
export function park(group, M, P, x0, z0, x1, z1, style) {
  const kit = new Kit();
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const path = (ax, az, bx, bz, w = 2.4) => {
    const len = Math.hypot(bx - ax, bz - az);
    kit.box(M.gravel, len, 0.04, w, (ax + bx) / 2, 0.025, (az + bz) / 2, -Math.atan2(bz - az, bx - ax), 1, { cast: false });
  };
  path(x0, z0 + 6, x1, z1 - 8);
  path(cx, z0, cx - 6, z1);
  // Playground on soft rubber.
  const px = cx + 8;
  const pz = cz - 4;
  kit.box(M.rubber, 16, 0.05, 12, px, 0.03, pz, 0, 1, { cast: false });
  // Swing frame.
  const sx = px - 3;
  const sz = pz - 2;
  for (const dz of [-2.4, 2.4]) {
    kit.add(M.steel, place(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), sx - 0.9, 1.5, sz + dz, 0, 0, 0.3));
    kit.add(M.steel, place(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), sx + 0.9, 1.5, sz + dz, 0, 0, -0.3));
  }
  kit.add(M.steel, place(new THREE.CylinderGeometry(0.08, 0.08, 5.2, 8), sx, 3.0, sz, Math.PI / 2, 0, 0));
  // Slide with a ladder tower.
  const tx = px + 4;
  const tz = pz + 1;
  for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) kit.add(M.steel, place(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 8), tx + dx, 1.7, tz + dz));
  kit.box(M.play[2], 1.9, 0.12, 1.9, tx, 1.8, tz);
  kit.add(M.play[0], place(new THREE.ConeGeometry(1.4, 1.2, 4), tx, 3.9, tz, 0, Math.PI / 4));
  const slide = new THREE.BoxGeometry(3.8, 0.08, 0.9);
  slide.rotateZ(-0.5);
  slide.translate(tx + 2.5, 0.95, tz);
  kit.add(M.play[1], slide);
  kit.box(M.play[1], 0.06, 0.25, 0.06, tx + 0.9, 1.95, tz - 0.45);
  for (let i = 0; i < 6; i++) kit.box(M.steel, 0.9, 0.05, 0.05, tx - 1.1, 0.3 + i * 0.3, tz, Math.PI / 2);
  // Climbing dome.
  const dome = new THREE.SphereGeometry(1.6, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  kit.add(M.play[3], place(dome, px - 3, 0, pz + 3.4));
  // Benches and a pond.
  for (const [bx, bz] of [[cx - 12, cz + 6], [cx + 18, cz + 8], [cx - 2, z0 + 4]]) {
    kit.box(M.bench, 1.8, 0.08, 0.45, bx, 0.48, bz);
    kit.box(M.bench, 1.8, 0.4, 0.06, bx, 0.75, bz - 0.22);
    kit.box(M.steel, 0.06, 0.48, 0.45, bx - 0.8, 0.24, bz);
    kit.box(M.steel, 0.06, 0.48, 0.45, bx + 0.8, 0.24, bz);
  }
  const pond = new THREE.Mesh(new THREE.CircleGeometry(7, 40), P.water('#3d7f86', 0.88));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(cx - 14, 0.06, cz - 6);
  group.add(pond);
  kit.add(M.stone, place(new THREE.TorusGeometry(7.1, 0.35, 6, 40), cx - 14, 0.05, cz - 6, Math.PI / 2));
  kit.build(group);

  // Swings that move by themselves in the breeze.
  const swings = new THREE.Group();
  for (const dz of [-1.1, 1.1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, 3.0, sz + dz);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.32), M.play[2]);
    seat.position.y = -2.4;
    const chainG = new THREE.CylinderGeometry(0.012, 0.012, 2.4, 4);
    const c1 = new THREE.Mesh(chainG, M.steel);
    c1.position.set(-0.3, -1.2, 0);
    const c2 = c1.clone();
    c2.position.x = 0.3;
    pivot.add(seat, c1, c2);
    pivot.rotation.order = 'ZXY';
    pivot.userData.phase = dz;
    swings.add(pivot);
  }
  swings.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  swings.userData.update = (dt, t) => swings.children.forEach((s) => { s.rotation.z = Math.sin(t * 1.6 + s.userData.phase) * 0.25; });
  group.add(swings);

  const trees = new Kit();
  const r = rng(31);
  for (let i = 0; i < 16; i++) {
    const x = x0 + 3 + r() * (x1 - x0 - 6);
    const z = z0 + 3 + r() * (z1 - z0 - 6);
    if (Math.abs(x - px) < 10 && Math.abs(z - pz) < 8) continue;
    if (Math.hypot(x - (cx - 14), z - (cz - 6)) < 9) continue;
    if (style.tree === 'palm' && i % 3 === 0) palm(trees, P.plants, x, z, 7 + r() * 3, 400 + i);
    else tree(trees, P.plants, x, z, 7 + r() * 4, i % 4 === 0 ? (style.flowerTree || 'flamboyant') : style.parkTree || 'broadleaf', 400 + i, 0.8);
  }
  for (let i = 0; i < 8; i++) bush(trees, P.plants, x0 + 2 + r() * (x1 - x0 - 4), z0 + 1.5, 0.8, 'hedge', 500 + i, 1);
  trees.build(group);
  return {
    swings,
    lawn: [[x0 + 1, z0 + 1, px - 9, z1 - 1], [px + 9, z0 + 1, x1 - 1, z1 - 1]],
    playground: { x: px, z: pz },
    centre: { x: cx, z: cz },
  };
}

// Later chapters: seen from the map, softened by distance until they open.
export function landmarks(group, M, P, style, sites) {
  const kit = new Kit();
  const { school, uni, city, venue } = sites;
  // University: a columned hall with a dome.
  kit.box(M.trim, 40, 1.2, 22, uni.x, 0.6, uni.z);
  kit.box(M.walls[0], 36, 10, 18, uni.x, 6, uni.z);
  for (let i = 0; i < 10; i++) kit.add(M.trim, place(column(0.55, 10), uni.x - 16 + i * 3.55, 1.2, uni.z + 10));
  kit.add(M.trim, place(new THREE.BoxGeometry(38, 1.6, 4), uni.x, 12, uni.z + 9.5));
  kit.add(M.roof, place(new THREE.SphereGeometry(7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), uni.x, 11, uni.z - 2));
  // The city: glass towers.
  const r = rng(8);
  for (let i = 0; i < 9; i++) {
    const w = 14 + r() * 10;
    const h = 40 + r() * 90;
    const x = city.x + (i % 3) * 30 + r() * 8;
    const z = city.z + Math.floor(i / 3) * 30 + r() * 8;
    kit.box(M.towerGlass, w, h, w, x, h / 2, z);
    for (let k = 1; k < h / 4; k++) kit.box(M.towerFrame, w + 0.3, 0.35, w + 0.3, x, k * 4, z);
  }
  // The wedding venue: a white pavilion on a lawn, with an arch of flowers.
  kit.box(M.trim, 20, 0.6, 14, venue.x, venue.y + 0.3, venue.z);
  for (let i = 0; i < 6; i++) for (const dz of [-6, 6]) kit.add(M.trim, place(column(0.3, 5), venue.x - 8 + i * 3.2, venue.y + 0.6, venue.z + dz));
  kit.add(M.trim, place(hipRoof(20, 14, 3, 0.6), venue.x, venue.y + 5.6, venue.z));
  kit.build(group);
  const t = new Kit();
  palm(t, P.plants, venue.x - 13, venue.z + 9, 9, 801);
  tree(t, P.plants, venue.x + 14, venue.z - 6, 10, 'jacaranda', 802, 0.7);
  t.build(group);
  return schoolGrounds(group, M, P, style, school);
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1f4e8c';
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = '#f2c14e';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 84);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 46px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The primary school: a two-storey block, a canopy over the door, a playground
// with a court and hopscotch, a flag in the wind. `s.ry` turns it to face the road.
function schoolGrounds(group, M, P, style, s) {
  const kit = new Kit();
  const F = frame(s.x, 0, s.z, s.ry || 0);
  const at = (lx, lz) => F.at(lx, 0, lz);
  const walls = style.brickWalls ? M.brick : M.walls[1] || M.walls[0];
  const trim = M.trim;
  const yard = std({ map: T.tiled(T.plaster('#d9d4c9'), 1 / 4), roughness: 0.95 });
  const paint = std({ color: '#ffffff', roughness: 0.6 });
  const accent = std({ color: style.schoolAccent || '#2f7fd0', roughness: 0.5 });
  // Playground in front of the school.
  fbox(kit, yard, F, 46, 0.05, 20, 0, 0.03, 15.5, 1, { cast: false });
  for (const [w, d, ox, oz] of [[16, 0.08, 9, 11], [16, 0.08, 9, 20], [0.08, 9, 1, 15.5], [0.08, 9, 17, 15.5], [0.08, 9, 9, 15.5]]) fbox(kit, paint, F, w, 0.012, d, ox, 0.06, oz, 1, { cast: false });
  fgeo(kit, paint, F, new THREE.TorusGeometry(1.6, 0.04, 4, 40), 9, 0.06, 15.5, Math.PI / 2);
  const hop = ['#e8475e', '#f4a93b', '#57b36b', '#4b8de0', '#b067d6', '#f06aa8'];
  // Hopscotch: single, single, double, single, double, single.
  const squares = [[0, 0], [0, 1], [-0.5, 2], [0.5, 2], [0, 3], [-0.5, 4], [0.5, 4], [0, 5]];
  squares.forEach(([sx, sz], i) => fbox(kit, std({ color: hop[i % hop.length], roughness: 0.7 }), F, 0.68, 0.012, 0.68, -12 + sx * 1.4, 0.06, 9 + sz * 0.75, 1, { cast: false }));
  // The building.
  fbox(kit, M.stone, F, 35, 0.4, 11, 0, 0.2, 0);
  fbox(kit, walls, F, 34, 7, 10, 0, 3.9, 0);
  fbox(kit, trim, F, 34.4, 0.3, 10.4, 0, 3.9, 0);
  if (style.roof === 'flat') {
    fbox(kit, trim, F, 34.8, 0.5, 10.8, 0, 7.65, 0);
    fbox(kit, accent, F, 34.9, 0.25, 10.9, 0, 7.35, 0);
  } else {
    fgeo(kit, M.roof, F, hipRoof(34, 10, 3.4, 0.7), 0, 7.4, 0);
  }
  const front = frame(...F.at(0, 0.4, 5), F.ry);
  for (let i = 0; i < 9; i++) {
    const lx = -14.5 + i * 3.6;
    if (i !== 4) glazedSmall(kit, M, front, lx, 0.9, 2.2, 1.8);
    glazedSmall(kit, M, front, lx, 4.3, 2.2, 1.8);
  }
  door(kit, M, front, 0, 2.4, 2.6, accent, { double: true, frame: M.frame });
  fbox(kit, trim, front, 5.6, 0.25, 2.8, 0, 3.05, 1.4);
  for (const lx of [-2.6, 2.6]) fbox(kit, M.frame, front, 0.14, 2.9, 0.14, lx, 1.45, 2.6);
  fgeo(kit, std({ map: signTexture(style.schoolName || 'PRIMARY SCHOOL'), roughness: 0.6 }), front, new THREE.PlaneGeometry(5.2, 0.98), 0, 3.75, 0.08);
  // A low wall along the street, benches, a flagpole.
  for (const sx of [-1, 1]) fbox(kit, walls, F, 18, 0.9, 0.3, sx * 13.5, 0.45, 25.4);
  for (const [bx, bz] of [[-17, 12], [-17, 18], [19, 10]]) {
    fbox(kit, M.bench, F, 0.45, 0.08, 1.8, bx, 0.48, bz);
    fbox(kit, M.steel, F, 0.45, 0.48, 0.06, bx, 0.24, bz - 0.8);
    fbox(kit, M.steel, F, 0.45, 0.48, 0.06, bx, 0.24, bz + 0.8);
  }
  fgeo(kit, M.steel, F, new THREE.CylinderGeometry(0.06, 0.09, 9, 10), -20, 4.5, 7);
  kit.build(group);
  // The flag ripples in the wind.
  const flagGeo = new THREE.PlaneGeometry(1.8, 1.1, 12, 4);
  flagGeo.translate(0.9, 0, 0);
  setSway(flagGeo, (fx) => (fx / 1.8) * 0.5);
  const flag = new THREE.Mesh(flagGeo, windy(std({ color: style.flag || '#2f6fd0', roughness: 0.7, side: THREE.DoubleSide }), 1.6));
  const [fx, , fz] = F.at(-19.94, 0, 7);
  flag.position.set(fx, 8.3, fz);
  flag.rotation.y = F.ry;
  group.add(flag);
  const plants = new Kit();
  [[-21, 18], [22, 18], [-21, 2], [22, 2]].forEach(([tx, tz], k) => {
    const [px, , pz] = F.at(tx, 0, tz);
    if (style.tree === 'palm' && k % 2) palm(plants, P.plants, px, pz, 8, 820 + k);
    else tree(plants, P.plants, px, pz, 8 + k, k === 1 ? style.flowerTree || 'flamboyant' : style.parkTree || 'broadleaf', 820 + k, 0.8);
  });
  plants.build(group);
  return { shot: { pos: F.at(6, 1.65, 26), look: F.at(-3, 3.2, 3) } };
}
