// Things that make a place feel lived in: a birthday party, a car, lamps.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Kit, std, place } from './kit.js';
import * as T from './textures.js';
import { rng } from './noise.js';

const BALLOONS = ['#e85d75', '#f2b33d', '#4d8fe0', '#59b88a', '#b07ad9', '#f07f4f', '#ffffff'];

// The party dish changes with the hometown: jollof, biryani, tamales or pizza.
const DISH = {
  westafrica: { color: '#d4541f', top: '#e8743a' },
  southasia: { color: '#e0a53a', top: '#f1c45a' },
  latam: { color: '#d8c27a', top: '#c9a85a' },
  ukus: { color: '#e9b04a', top: '#c8462c' },
};

export function party(group, P, x, z, region, seed = 1) {
  const r = rng(seed);
  const kit = new Kit();
  const cloth = std({ map: T.tiled(T.fabric('#fbf7f0'), 2), roughness: 0.95 });
  const white = std({ color: '#f4f1ea', roughness: 0.5 });
  const wood = std({ map: T.tiled(T.wood('#a0704a'), 1), roughness: 0.6 });
  const icing = std({ color: '#fbf3ec', roughness: 0.6 });
  const pink = std({ color: '#f2a7b6', roughness: 0.55 });
  const flame = new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb340', emissiveIntensity: 4 });
  const dish = DISH[region] || DISH.westafrica;
  const food = std({ color: dish.color, roughness: 0.8 });
  const foodTop = std({ color: dish.top, roughness: 0.8 });
  const ceramic = std({ color: '#f7f4ef', roughness: 0.25 });

  // A long table with a cloth that hangs over the edges.
  kit.box(cloth, 3.4, 0.05, 1.1, x, 0.78, z);
  kit.box(cloth, 3.4, 0.32, 0.02, x, 0.62, z + 0.55);
  kit.box(cloth, 3.4, 0.32, 0.02, x, 0.62, z - 0.55);
  kit.box(cloth, 0.02, 0.32, 1.1, x - 1.7, 0.62, z);
  kit.box(cloth, 0.02, 0.32, 1.1, x + 1.7, 0.62, z);
  for (const [dx, dz] of [[-1.55, -0.45], [1.55, -0.45], [-1.55, 0.45], [1.55, 0.45]]) kit.box(wood, 0.07, 0.75, 0.07, x + dx, 0.375, z + dz);

  // The cake.
  const tier = (rad, h, y, mat) => kit.add(mat, place(new THREE.CylinderGeometry(rad, rad, h, 28), x - 0.2, y + h / 2, z));
  tier(0.24, 0.16, 0.805, icing);
  tier(0.17, 0.14, 0.965, pink);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    kit.add(white, place(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), x - 0.2 + Math.cos(a) * 0.1, 1.145, z + Math.sin(a) * 0.1));
    kit.add(flame, place(new THREE.SphereGeometry(0.014, 8, 6), x - 0.2 + Math.cos(a) * 0.1, 1.2, z + Math.sin(a) * 0.1, 0, 0, 0, 1, 1.6, 1), { cast: false });
  }
  // The dish from home, in a big bowl.
  kit.add(ceramic, place(new THREE.SphereGeometry(0.26, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), x + 0.9, 1.06, z, Math.PI));
  kit.add(food, place(new THREE.SphereGeometry(0.24, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), x + 0.9, 1.0, z, 0, 0, 0, 1, 0.45, 1));
  kit.add(foodTop, place(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), x + 0.95, 1.08, z + 0.03, 0, 0, 0, 1, 0.4, 1));
  // Plates and cups.
  const cupCols = ['#e85d75', '#4d8fe0', '#f2b33d', '#59b88a'];
  for (let i = 0; i < 6; i++) {
    const px = x - 1.35 + i * 0.54;
    const pz = z + (i % 2 ? 0.34 : -0.34);
    kit.add(ceramic, place(new THREE.CylinderGeometry(0.11, 0.09, 0.015, 20), px, 0.81, pz));
    kit.add(std({ color: cupCols[i % 4], roughness: 0.4 }), place(new THREE.CylinderGeometry(0.04, 0.032, 0.11, 12), px + 0.16, 0.86, pz));
  }
  // Chairs.
  for (let i = 0; i < 6; i++) {
    const cx = x - 1.1 + (i % 3) * 1.1;
    const side = i < 3 ? -1 : 1;
    const cz = z + side * 0.95;
    kit.box(white, 0.46, 0.05, 0.46, cx, 0.46, cz);
    kit.box(white, 0.46, 0.5, 0.05, cx, 0.72, cz + side * 0.22);
    for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) kit.box(white, 0.04, 0.46, 0.04, cx + dx, 0.23, cz + dz);
  }
  // Presents.
  for (let i = 0; i < 4; i++) {
    const s = 0.25 + r() * 0.2;
    const col = BALLOONS[i % 5];
    const bx = x + 2.3 + (i % 2) * 0.45;
    const bz = z - 0.3 + Math.floor(i / 2) * 0.5;
    kit.box(std({ color: col, roughness: 0.5 }), s, s, s, bx, s / 2, bz, r());
    kit.box(std({ color: '#fff4d6', roughness: 0.4 }), s + 0.01, s + 0.01, 0.05, bx, s / 2, bz, r());
  }
  kit.build(group);

  // Balloons bob on their strings.
  const balloons = new THREE.Group();
  const stringMat = new THREE.LineBasicMaterial({ color: '#d8d2c8', transparent: true, opacity: 0.8 });
  const spots = [[x - 1.75, z - 0.6], [x + 1.75, z + 0.6], [x - 1.75, z + 0.6], [x + 1.75, z - 0.6]];
  spots.forEach(([bx, bz], si) => {
    for (let i = 0; i < 3; i++) {
      const col = BALLOONS[(si * 3 + i) % BALLOONS.length];
      const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, sheen: 0.4 });
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), mat);
      b.scale.set(1, 1.18, 1);
      const top = new THREE.Vector3(bx + (i - 1) * 0.22, 1.75 + i * 0.16 + r() * 0.1, bz + (r() - 0.5) * 0.2);
      b.position.copy(top);
      b.castShadow = true;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(bx, 0.8, bz), top.clone().add(new THREE.Vector3(0, -0.24, 0))]), stringMat);
      b.userData = { base: top.clone(), phase: r() * 6, line };
      balloons.add(b, line);
    }
  });
  balloons.userData.update = (dt, t) => {
    for (const b of balloons.children) {
      if (!b.isMesh) continue;
      const u = b.userData;
      b.position.set(u.base.x + Math.sin(t * 0.9 + u.phase) * 0.05, u.base.y + Math.sin(t * 1.4 + u.phase) * 0.04, u.base.z + Math.cos(t * 0.8 + u.phase) * 0.05);
      b.rotation.z = Math.sin(t * 0.9 + u.phase) * 0.08;
      const p = u.line.geometry.attributes.position;
      p.setXYZ(1, b.position.x, b.position.y - 0.24, b.position.z);
      p.needsUpdate = true;
    }
  };
  group.add(balloons);
  return balloons;
}

// Triangle flags hanging on a string between two points.
export function bunting(group, a, b, sag = 0.6, seed = 2) {
  const r = rng(seed);
  const pts = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#efe6d8' })));
  const kit = new Kit();
  for (let i = 1; i < n; i += 1) {
    const p = pts[i];
    const q = pts[i + 1];
    const dir = q.clone().sub(p);
    const ang = Math.atan2(dir.z, dir.x);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.13, 0, 0, 0.13, 0, 0, 0, -0.3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    g.computeVertexNormals();
    place(g, p.x, p.y - 0.02, p.z, 0, -ang, 0);
    kit.add(std({ color: BALLOONS[Math.floor(r() * 6)], roughness: 0.8, side: THREE.DoubleSide }), g);
  }
  kit.build(group);
}

// Fairy lights: small glowing bulbs along a sagging wire.
export function fairyLights(group, a, b, sag = 0.5) {
  const pts = [];
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(t * Math.PI) * sag;
    pts.push(p);
  }
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#4a4440' })));
  const bulb = new THREE.MeshStandardMaterial({ color: '#fff1c8', emissive: '#ffcf70', emissiveIntensity: 3.2 });
  const g = new THREE.SphereGeometry(0.035, 8, 6);
  const mesh = new THREE.InstancedMesh(g, bulb, pts.length);
  const m = new THREE.Matrix4();
  pts.forEach((p, i) => { m.makeTranslation(p.x, p.y - 0.04, p.z); mesh.setMatrixAt(i, m); });
  group.add(mesh);
}

export function car(group, x, z, ry, color = '#1d2733') {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0e1419', metalness: 0.3, roughness: 0.05, clearcoat: 1 });
  const tyre = std({ color: '#161616', roughness: 0.9 });
  const rim = std({ color: '#b9bec4', metalness: 0.9, roughness: 0.25 });
  const light = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4e0', emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(4.8, 1.0, 1.98, 4, 0.22), paint);
  body.position.y = 0.85;
  const cabin = new THREE.Mesh(new RoundedBoxGeometry(2.9, 0.78, 1.84, 4, 0.2), glass);
  cabin.position.set(-0.25, 1.6, 0);
  const roof = new THREE.Mesh(new RoundedBoxGeometry(2.7, 0.12, 1.78, 3, 0.05), paint);
  roof.position.set(-0.3, 2.0, 0);
  g.add(body, cabin, roof);
  for (const [wx, wz] of [[1.55, 0.92], [1.55, -0.92], [-1.5, 0.92], [-1.5, -0.92]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 24), tyre);
    w.rotation.x = Math.PI / 2;
    w.position.set(wx, 0.42, wz);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.31, 16), rim);
    h.rotation.x = Math.PI / 2;
    h.position.copy(w.position);
    g.add(w, h);
  }
  for (const s of [-0.68, 0.68]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.42), light);
    hl.position.set(2.4, 0.98, s);
    g.add(hl);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  group.add(g);
  return g;
}

export function lamp(kit, mats, x, z, h = 3.4) {
  kit.add(mats.post, place(new THREE.CylinderGeometry(0.06, 0.08, h, 10), x, h / 2, z));
  kit.add(mats.bulb, place(new THREE.SphereGeometry(0.16, 14, 10), x, h + 0.1, z), { cast: false });
}
