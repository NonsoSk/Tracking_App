// Grandma's kitchen: warm afternoon light through the window, shelves of glass
// jars full of sweets, a wooden table in the middle.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Kit, std, place } from './kit.js';
import { mats } from './build.js';
import * as T from './textures.js';
import { rng } from './noise.js';

const STYLE = {
  westafrica: { tiles: 'green', cabinet: '#2f5d55', floor: 'terracotta', wall: '#efe4cf' },
  southasia: { tiles: 'white', cabinet: '#3d6f8a', floor: 'terracotta', wall: '#f2e2c4' },
  latam: { tiles: 'talavera', cabinet: '#c96a3a', floor: 'terracotta', wall: '#f3e6cf' },
  ukus: { tiles: 'white', cabinet: '#55705e', floor: 'wood', wall: '#efe8da' },
};

const CANDY = ['#e8475e', '#f4a93b', '#57b36b', '#4b8de0', '#b067d6', '#f06aa8', '#f2d44b'];

// What you see through the window: sky, a garden, sunlight.
function gardenView() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#9cc4ea');
  g.addColorStop(0.6, '#e8eedf');
  g.addColorStop(1, '#cfe0b8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#9cb878';
  ctx.fillRect(0, 196, 512, 60);
  // Trees made from the same leaf clusters as the 3D trees outside.
  const leaf = T.leaves('broadleaf').image;
  const r = rng(4);
  for (let i = 0; i < 26; i++) {
    const x = r() * 560 - 40;
    const s = 70 + r() * 110;
    const y = 200 - s * (0.55 + r() * 0.3);
    ctx.fillStyle = 'rgba(90,70,50,0.8)';
    ctx.fillRect(x + s / 2 - 3, y + s * 0.5, 6, 200 - y - s * 0.5);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(leaf, x, y, s, s);
    ctx.globalAlpha = 1;
  }
  const flowers = T.leaves('bougainvillea').image;
  for (let i = 0; i < 5; i++) ctx.drawImage(flowers, r() * 480, 170 + r() * 40, 70, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildKitchen(regionId, renderer) {
  const S = STYLE[regionId] || STYLE.westafrica;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d9cdb8');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  scene.environmentIntensity = 0.45;

  const kit = new Kit();
  const wall = mats.plaster(S.wall, 2);
  const floor = S.floor === 'wood' ? mats.wood('#8a5f3e', 1.2) : std({ map: T.tiled(T.tiles('terracotta'), 1 / 0.9), roughness: 0.6 });
  const cab = mats.paint(S.cabinet, 0.45);
  const top = mats.stone('#e7e0d2', 1.2);
  const wood = mats.wood('#9a6a44', 1);
  const tiles = std({ map: T.tiled(T.tiles(S.tiles), 1 / 0.6), roughness: 0.25 });
  const brass = std({ color: '#c9a35a', metalness: 0.85, roughness: 0.3 });
  const white = mats.paint('#f3f1ec', 0.35);
  const steel = std({ color: '#c8cbd0', metalness: 0.9, roughness: 0.25 });
  const W = 7;
  const H = 3;
  const back = -3;
  // Room shell with a window opening in the back wall.
  kit.box(floor, W, 0.1, 6, 0, -0.05, -0.2, 0, 1);
  kit.box(wall, W, 0.1, 6, 0, H + 0.05, -0.2, 0, 1);
  kit.box(wall, 0.1, H, 6, -W / 2, H / 2, -0.2);
  kit.box(wall, 0.1, H, 6, W / 2, H / 2, -0.2);
  kit.box(wall, (W - 2.6) / 2, H, 0.2, -(W + 2.6) / 4, H / 2, back);
  kit.box(wall, (W - 2.6) / 2, H, 0.2, (W + 2.6) / 4, H / 2, back);
  kit.box(wall, 2.6, 1.05, 0.2, 0, 0.525, back);
  kit.box(wall, 2.6, 0.6, 0.2, 0, H - 0.3, back);
  for (let i = 0; i < 3; i++) kit.box(white, 0.06, 1.35, 0.08, -1.3 + i * 1.3, 1.725, back + 0.08);
  kit.box(white, 2.66, 0.08, 0.1, 0, 1.06, back + 0.08);
  kit.box(white, 2.66, 0.08, 0.1, 0, 2.4, back + 0.08);
  kit.box(white, 2.7, 0.05, 0.3, 0, 1.08, back + 0.2);
  // Counter along the back, a sink under the window, a stove to the right.
  kit.box(cab, W - 0.2, 0.86, 0.62, 0, 0.43, back + 0.41);
  for (let i = 0; i < 8; i++) kit.box(cab, 0.8, 0.7, 0.03, -2.8 + i * 0.8, 0.45, back + 0.73);
  for (let i = 0; i < 8; i++) kit.box(brass, 0.18, 0.025, 0.03, -2.8 + i * 0.8, 0.72, back + 0.76);
  kit.box(top, W - 0.1, 0.05, 0.68, 0, 0.885, back + 0.42);
  kit.box(tiles, 2.2, 1.1, 0.03, -2.3, 1.45, back + 0.12);
  kit.box(tiles, 2.2, 1.1, 0.03, 2.3, 1.45, back + 0.12);
  kit.box(steel, 0.9, 0.02, 0.5, 0, 0.9, back + 0.4);
  kit.add(steel, place(new THREE.TorusGeometry(0.18, 0.02, 6, 16, Math.PI), 0, 1.15, back + 0.18));
  kit.box(std({ color: '#2b2b2b', roughness: 0.5 }), 0.8, 0.03, 0.55, 2.2, 0.92, back + 0.4);
  const pot = new THREE.CylinderGeometry(0.2, 0.18, 0.24, 24);
  kit.add(std({ color: '#b5462f', roughness: 0.35 }), place(pot, 2.05, 1.06, back + 0.4));
  // Open shelves of jars on the side walls, and on the back wall.
  const jarGlass = new THREE.MeshPhysicalMaterial({ color: '#eef6f4', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.32, envMapIntensity: 1.6, clearcoat: 1, depthWrite: false });
  const lid = std({ color: '#a8643c', roughness: 0.5 });
  const r = rng(12);
  const jars = [];
  const candyMats = {};
  const candy = (c) => (candyMats[c] = candyMats[c] || std({ color: c, roughness: 0.25 }));
  const shelf = (x, y, z, len, ry) => {
    kit.box(wood, len, 0.05, 0.32, x, y, z, ry);
    const n = Math.floor(len / 0.34);
    for (let i = 0; i < n; i++) {
      const off = -len / 2 + 0.2 + i * 0.34;
      const jx = x + Math.cos(-ry) * off;
      const jz = z + Math.sin(-ry) * off;
      const h = 0.2 + r() * 0.12;
      jars.push({ x: jx, y: y + 0.025, z: jz, h, rad: 0.11, color: CANDY[Math.floor(r() * CANDY.length)], fill: 0.4 + r() * 0.5 });
    }
  };
  shelf(-2.3, 2.15, back + 0.22, 2.0, 0);
  shelf(2.3, 2.15, back + 0.22, 2.0, 0);
  shelf(-W / 2 + 0.2, 1.6, -1.2, 2.2, Math.PI / 2);
  shelf(-W / 2 + 0.2, 2.15, -1.2, 2.2, Math.PI / 2);
  // The sweet jar on the table, the star of the lesson.
  jars.push({ x: -0.15, y: 0.78, z: 0.25, h: 0.42, rad: 0.2, color: '#e8475e', fill: 0.6, hero: true });
  for (const j of jars) {
    kit.add(jarGlass, place(new THREE.CylinderGeometry(j.rad, j.rad, j.h, 24, 1, true), j.x, j.y + j.h / 2, j.z), { cast: false });
    kit.add(lid, place(new THREE.CylinderGeometry(j.rad * 0.85, j.rad * 0.85, 0.05, 20), j.x, j.y + j.h + 0.025, j.z));
    // Sweets: little coloured balls inside.
    const count = j.hero ? 46 : 14;
    for (let k = 0; k < count; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * (j.rad - 0.035);
      const y = j.y + 0.03 + r() * (j.h * j.fill);
      const col = j.hero ? CANDY[Math.floor(r() * CANDY.length)] : j.color;
      kit.add(candy(col), place(new THREE.SphereGeometry(j.hero ? 0.03 : 0.028, 8, 6), j.x + Math.cos(a) * d, y, j.z + Math.sin(a) * d), { cast: false });
    }
  }
  // Table and chairs.
  kit.box(wood, 1.9, 0.06, 1.0, 0, 0.75, 0.3);
  for (const [dx, dz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]]) kit.box(wood, 0.07, 0.75, 0.07, dx, 0.375, 0.3 + dz);
  for (const dx of [-0.55, 0.55]) {
    kit.box(wood, 0.44, 0.05, 0.44, dx, 0.46, -0.45);
    kit.box(wood, 0.44, 0.5, 0.05, dx, 0.72, -0.68);
    for (const [ex, ez] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) kit.box(wood, 0.04, 0.46, 0.04, dx + ex, 0.23, -0.45 + ez);
  }
  const bowl = new THREE.SphereGeometry(0.2, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.scale(1, 0.55, 1);
  kit.add(white, place(bowl, 0.55, 0.89, 0.35));
  for (let i = 0; i < 6; i++) kit.add(candy(['#e0a032', '#d9462f', '#8bb34a'][i % 3]), place(new THREE.SphereGeometry(0.06, 12, 8), 0.55 + (r() - 0.5) * 0.18, 0.88 + (i > 3 ? 0.06 : 0), 0.35 + (r() - 0.5) * 0.18));
  // A fridge, plants on the windowsill, pictures on the wall.
  kit.box(white, 0.8, 1.9, 0.7, W / 2 - 0.5, 0.95, -0.9);
  kit.box(steel, 0.03, 0.5, 0.04, W / 2 - 0.88, 1.3, -0.52);
  for (const x of [-0.9, 0.9]) {
    kit.add(std({ color: '#b8613a', roughness: 0.8 }), place(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 12), x, 1.17, back + 0.2));
    kit.add(std({ color: '#3f7a35', roughness: 0.8 }), place(new THREE.SphereGeometry(0.13, 10, 8), x, 1.33, back + 0.2));
  }
  const frameMat = wood;
  for (const [z, y, w, h] of [[0.6, 1.7, 0.5, 0.4], [1.3, 1.5, 0.35, 0.45]]) {
    kit.box(frameMat, 0.04, h + 0.06, w + 0.06, -W / 2 + 0.06, y, z);
    kit.box(std({ color: '#c9a77a', roughness: 0.6 }), 0.02, h, w, -W / 2 + 0.09, y, z);
  }
  kit.build(scene);

  // The view outside, bright like real daylight.
  const view = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ map: gardenView(), color: new THREE.Color(1.9, 1.9, 1.9), fog: false }));
  view.position.set(0, 1.6, back - 3);
  scene.add(view);

  // A pendant lamp over the table.
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.24, 24, 1, true), std({ color: '#2f3b36', roughness: 0.5, side: THREE.DoubleSide }));
  shade.position.set(0, 2.35, 0.3);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: '#ffd79a', emissiveIntensity: 5 }));
  bulb.position.set(0, 2.25, 0.3);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 4), std({ color: '#222' }));
  cord.position.set(0, 2.72, 0.3);
  scene.add(shade, bulb, cord);
  const lampLight = new THREE.PointLight('#ffd7a0', 3.5, 6, 1.6);
  lampLight.position.set(0, 2.15, 0.3);
  scene.add(lampLight);

  // Sunlight through the window, and soft light filling the room.
  const sun = new THREE.DirectionalLight('#ffe2b5', 4.2);
  sun.position.set(-2.5, 5.5, back - 5);
  sun.target.position.set(0.3, 0, 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#fff3e0', '#7a5a40', 0.55));
  const fill = new THREE.PointLight('#ffe8c8', 1.2, 9, 1.5);
  fill.position.set(0.5, 2.2, 2.2);
  scene.add(fill);

  // Light shafts and floating dust in the sunbeam.
  const beamMat = new THREE.MeshBasicMaterial({ map: T.beam(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 3.4), beamMat);
    b.position.set(-0.8 + i * 0.8, 1.2, back + 1.3);
    b.rotation.set(-0.75, 0.25, 0.12);
    scene.add(b);
  }
  const dustGeo = new THREE.BufferGeometry();
  const dust = [];
  for (let i = 0; i < 160; i++) dust.push(-1.3 + r() * 2.6, 0.6 + r() * 1.8, back + 0.4 + r() * 2.4);
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
  const motes = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#fff2d0', size: 0.012, transparent: true, opacity: 0.7, depthWrite: false }));
  scene.add(motes);

  const updaters = [(dt, t) => { motes.rotation.y = Math.sin(t * 0.05) * 0.05; motes.position.y = Math.sin(t * 0.2) * 0.04; }];
  const shots = {
    kitchen: { pos: [0.9, 1.55, 2.6], look: [-0.25, 1.2, -2.4], drift: 0.08, fov: 50, shadow: null },
  };
  return { region: regionId, R: { exposure: 0.85 }, scene, shots, updaters, sunLight: sun, interior: true };
}
