// A primary school classroom: a chalkboard, rows of desks, sunlight through tall
// windows, posters, a globe and shelves of books.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Kit, std, place } from './kit.js';
import { mats } from './build.js';
import * as T from './textures.js';
import { rng } from './noise.js';

const STYLE = {
  westafrica: { wall: '#f1e7d2', dado: '#3f7a5f', floor: 'terracotta' },
  southasia: { wall: '#e6eef2', dado: '#3d6f8a', floor: 'terracotta' },
  latam: { wall: '#f5e3bd', dado: '#b8613a', floor: 'terracotta' },
  ukus: { wall: '#e9ece4', dado: '#55705e', floor: 'wood' },
};

const BRIGHT = ['#e8475e', '#f4a93b', '#57b36b', '#4b8de0', '#b067d6', '#f06aa8', '#2fb3b3'];

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Chalk writing: a welcome, a list and a times table, the way a teacher leaves it.
function chalkboard() {
  return canvasTexture(1024, 340, (ctx, w, h) => {
    ctx.fillStyle = '#25443a';
    ctx.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.04})`;
      ctx.fillRect(r() * w, r() * h, 40 + r() * 120, 2 + r() * 6);
    }
    ctx.fillStyle = 'rgba(245,245,235,0.92)';
    ctx.font = 'bold 44px "Comic Sans MS", "Segoe Print", cursive';
    ctx.fillText('Welcome to Class 3!', 40, 70);
    ctx.font = '30px "Courier New", monospace';
    ctx.fillStyle = 'rgba(240,240,230,0.85)';
    ctx.fillText('classmates = ["Ada", "Pip"]', 40, 150);
    ctx.fillText('for n in range(1, 6):', 40, 200);
    ctx.fillText('    print(2, "x", n)', 40, 245);
    ctx.font = 'bold 38px "Comic Sans MS", cursive';
    ctx.fillStyle = 'rgba(255,224,140,0.9)';
    ctx.fillText('2 x 3 = 6', 640, 160);
    ctx.fillStyle = 'rgba(160,220,255,0.9)';
    ctx.fillText('5 x 5 = 25', 640, 220);
    ctx.strokeStyle = 'rgba(255,220,120,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(900, 80, 34, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(900 + Math.cos(a) * 44, 80 + Math.sin(a) * 44);
      ctx.lineTo(900 + Math.cos(a) * 60, 80 + Math.sin(a) * 60);
      ctx.stroke();
    }
  });
}

function poster(kind) {
  return canvasTexture(256, 340, (ctx, w, h) => {
    ctx.fillStyle = '#fbf6ea';
    ctx.fillRect(0, 0, w, h);
    const r = rng(kind.length * 9);
    if (kind === 'abc') {
      const letters = 'ABCDEFGHIJKL';
      ctx.font = 'bold 48px Arial';
      for (let i = 0; i < letters.length; i++) {
        ctx.fillStyle = BRIGHT[i % BRIGHT.length];
        ctx.fillText(letters[i], 22 + (i % 3) * 78, 70 + Math.floor(i / 3) * 78);
      }
    } else if (kind === 'world') {
      ctx.fillStyle = '#9fd0ea';
      ctx.fillRect(16, 16, w - 32, h - 32);
      ctx.fillStyle = '#6fae5a';
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.ellipse(40 + r() * 170, 50 + r() * 240, 18 + r() * 34, 14 + r() * 40, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.font = 'bold 54px Arial';
      for (let i = 1; i <= 9; i++) {
        ctx.fillStyle = BRIGHT[i % BRIGHT.length];
        ctx.fillText(String(i), 34 + ((i - 1) % 3) * 72, 90 + Math.floor((i - 1) / 3) * 96);
      }
    }
  });
}

function outside() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#97c3ea');
    g.addColorStop(0.65, '#e3ecdc');
    g.addColorStop(1, '#a9c47e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const leaf = T.leaves('broadleaf').image;
    const r = rng(8);
    for (let i = 0; i < 16; i++) {
      const s = 90 + r() * 120;
      const x = r() * (w + 60) - 60;
      const y = 190 - s * 0.85;
      ctx.fillStyle = 'rgba(90,70,50,0.8)';
      ctx.fillRect(x + s / 2 - 3, y + s * 0.6, 6, h - y);
      ctx.drawImage(leaf, x, y, s, s);
    }
  });
}

export function buildClassroom(regionId, renderer) {
  const S = STYLE[regionId] || STYLE.westafrica;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d8d4c8');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  scene.environmentIntensity = 0.45;
  const kit = new Kit();
  const r = rng(3);
  const W = 9;
  const H = 3.3;
  const D = 8;
  const front = -4;
  const right = W / 2;
  const wall = mats.plaster(S.wall, 2);
  const dado = mats.paint(S.dado, 0.6);
  const floor = S.floor === 'wood' ? mats.wood('#9a6c46', 1.2) : std({ map: T.tiled(T.tiles('terracotta'), 1 / 0.8), roughness: 0.6 });
  const wood = mats.wood('#b07a4c', 1);
  const darkWood = mats.wood('#6b4428', 1);
  const metal = std({ color: '#5a6068', metalness: 0.7, roughness: 0.4 });
  const white = mats.paint('#f3f1ec', 0.45);
  // Room shell; the right wall has three tall windows.
  kit.box(floor, W, 0.1, D, 0, -0.05, 0, 0, 1);
  kit.box(white, W, 0.1, D, 0, H + 0.05, 0, 0, 1);
  kit.box(wall, W, H, 0.2, 0, H / 2, front);
  kit.box(wall, W, H, 0.2, 0, H / 2, D / 2);
  kit.box(wall, 0.2, H, D, -W / 2, H / 2, 0);
  const winZ = [-2.4, 0, 2.4];
  kit.box(wall, 0.2, 0.9, D, right, 0.45, 0);
  kit.box(wall, 0.2, 0.5, D, right, H - 0.25, 0);
  for (const z of [-3.6, -1.2, 1.2, 3.6]) kit.box(wall, 0.2, H, 0.8, right, H / 2, z);
  for (const z of winZ) {
    kit.box(white, 0.12, 0.08, 1.6, right - 0.05, 0.92, z);
    kit.box(white, 0.12, 0.08, 1.6, right - 0.05, H - 0.52, z);
    kit.box(white, 0.12, 1.9, 0.06, right - 0.05, 1.85, z);
    kit.box(white, 0.12, 0.05, 1.6, right - 0.05, 1.85, z);
  }
  // A painted band along the bottom of the walls.
  kit.box(dado, W - 0.1, 0.9, 0.04, 0, 0.45, front + 0.12);
  kit.box(dado, 0.04, 0.9, D - 0.1, -W / 2 + 0.12, 0.45, 0);
  kit.box(dado, W - 0.1, 0.9, 0.04, 0, 0.45, D / 2 - 0.12);
  // The chalkboard with its frame and tray.
  const board = std({ map: chalkboard(), roughness: 0.9 });
  kit.box(darkWood, 4.6, 1.7, 0.08, -0.4, 1.75, front + 0.12);
  kit.add(board, place(new THREE.PlaneGeometry(4.4, 1.5), -0.4, 1.75, front + 0.17), { cast: false });
  kit.box(darkWood, 4.6, 0.06, 0.14, -0.4, 0.92, front + 0.2);
  // Teacher's desk with books, an apple and a globe.
  kit.box(darkWood, 1.8, 0.06, 0.8, -2.6, 0.78, front + 1.4);
  kit.box(darkWood, 1.7, 0.72, 0.05, -2.6, 0.4, front + 1.78);
  for (const dx of [-0.85, 0.85]) kit.box(darkWood, 0.06, 0.75, 0.75, -2.6 + dx, 0.38, front + 1.4);
  for (let i = 0; i < 4; i++) kit.box(std({ color: BRIGHT[i], roughness: 0.6 }), 0.32, 0.05, 0.24, -3.1, 0.835 + i * 0.05, front + 1.3, r() * 0.3);
  kit.add(std({ color: '#c8352e', roughness: 0.35 }), place(new THREE.SphereGeometry(0.06, 14, 10), -2.3, 0.87, front + 1.25));
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), std({ map: poster('world'), roughness: 0.4 }));
  globe.position.set(-2.0, 1.1, front + 1.5);
  globe.castShadow = true;
  scene.add(globe);
  kit.add(metal, place(new THREE.CylinderGeometry(0.015, 0.05, 0.26, 8), -2.0, 0.93, front + 1.5));
  // Rows of pupils' desks with chairs, books and pencil cases.
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = -2.6 + col * 2.2;
      const z = front + 3.1 + row * 1.7;
      kit.box(wood, 1.3, 0.05, 0.6, x, 0.72, z);
      for (const [dx, dz] of [[-0.6, -0.25], [0.6, -0.25], [-0.6, 0.25], [0.6, 0.25]]) kit.box(metal, 0.04, 0.7, 0.04, x + dx, 0.35, z + dz);
      for (const dx of [-0.32, 0.32]) {
        const cz = z + 0.55;
        kit.box(std({ color: BRIGHT[(row * 3 + col + (dx > 0 ? 2 : 0)) % BRIGHT.length], roughness: 0.5 }), 0.4, 0.04, 0.38, x + dx, 0.44, cz);
        kit.box(std({ color: BRIGHT[(row * 3 + col + (dx > 0 ? 2 : 0)) % BRIGHT.length], roughness: 0.5 }), 0.4, 0.36, 0.04, x + dx, 0.66, cz + 0.18);
        for (const [ex, ez] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) kit.box(metal, 0.03, 0.43, 0.03, x + dx + ex, 0.21, cz + ez);
        if (r() > 0.3) kit.box(std({ color: BRIGHT[Math.floor(r() * 7)], roughness: 0.6 }), 0.24, 0.03, 0.32, x + dx, 0.76, z, r() * 0.5);
        if (r() > 0.5) kit.box(std({ color: BRIGHT[Math.floor(r() * 7)], roughness: 0.6 }), 0.18, 0.05, 0.06, x + dx + 0.05, 0.775, z - 0.15, r());
      }
    }
  }
  // Posters, coat hooks with school bags, a bookshelf.
  const posters = ['abc', 'numbers', 'world'];
  posters.forEach((k, i) => {
    kit.add(std({ map: poster(k), roughness: 0.8 }), place(new THREE.PlaneGeometry(0.8, 1.05), -W / 2 + 0.13, 1.9, -2.4 + i * 1.3, 0, Math.PI / 2), { cast: false });
  });
  for (let i = 0; i < 6; i++) {
    kit.box(metal, 0.08, 0.04, 0.04, -1.8 + i * 0.6, 1.55, D / 2 - 0.15);
    kit.add(std({ color: BRIGHT[i], roughness: 0.7 }), place(new RoundedBag(), -1.8 + i * 0.6, 1.25, D / 2 - 0.25));
  }
  kit.box(darkWood, 0.45, 1.8, 2.2, -W / 2 + 0.35, 0.9, 2.6);
  for (let s = 0; s < 4; s++) {
    kit.box(darkWood, 0.45, 0.04, 2.2, -W / 2 + 0.35, 0.2 + s * 0.45, 2.6);
    let z = 1.6;
    while (z < 3.6) {
      const t = 0.05 + r() * 0.06;
      const h = 0.26 + r() * 0.12;
      kit.box(std({ color: BRIGHT[Math.floor(r() * 7)], roughness: 0.7 }), 0.3, h, t, -W / 2 + 0.38, 0.22 + s * 0.45 + h / 2, z);
      z += t + 0.01;
    }
  }
  // Plants on the window sills.
  for (const z of winZ) {
    kit.add(std({ color: '#b8613a', roughness: 0.8 }), place(new THREE.CylinderGeometry(0.11, 0.08, 0.16, 12), right - 0.25, 0.99, z + 0.4));
    kit.add(std({ color: '#3f7a35', roughness: 0.8 }), place(new THREE.SphereGeometry(0.16, 10, 8), right - 0.25, 1.18, z + 0.4));
  }
  kit.build(scene);

  // Daylight outside the windows.
  const view = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshBasicMaterial({ map: outside(), color: new THREE.Color(1.8, 1.8, 1.8), fog: false }));
  view.position.set(right + 3, 1.8, 0);
  view.rotation.y = -Math.PI / 2;
  scene.add(view);
  // Ceiling lights.
  const panel = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e6', emissiveIntensity: 2.2 });
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.8], [1.5, 1.8]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.3), panel);
    m.position.set(x, H - 0.03, z);
    scene.add(m);
  }
  // Sunlight through the windows, and soft light filling the room.
  const sun = new THREE.DirectionalLight('#ffe2b5', 4.0);
  sun.position.set(right + 6, 6.5, -2.5);
  sun.target.position.set(-0.5, 0, 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 24 });
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#fff6e8', '#7a6a50', 0.7));
  const fill = new THREE.PointLight('#fff1dc', 1.6, 12, 1.4);
  fill.position.set(0, 2.8, 1);
  scene.add(fill);
  // Dust drifting in the sunbeams.
  const dust = [];
  for (let i = 0; i < 200; i++) dust.push(-1 + r() * 5.4, 0.5 + r() * 2.5, -3 + r() * 6);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dust, 3));
  const motes = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: '#fff2d0', size: 0.012, transparent: true, opacity: 0.7, depthWrite: false }));
  scene.add(motes);
  const updaters = [(dt, t) => { motes.position.y = Math.sin(t * 0.2) * 0.05; globe.rotation.y = t * 0.15; }];
  const shots = {
    classroom: { pos: [2.6, 1.5, 3.6], look: [-0.9, 1.35, -4], drift: 0.08, fov: 52, shadow: null },
  };
  return { region: regionId, R: { exposure: 0.82 }, scene, shots, updaters, sunLight: sun, interior: true };
}

// A school bag hanging from a hook.
class RoundedBag extends THREE.BoxGeometry {
  constructor() {
    super(0.32, 0.4, 0.14, 2, 2, 2);
    const p = this.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - Math.max(0, y) * 0.5));
    }
    this.computeVertexNormals();
  }
}
