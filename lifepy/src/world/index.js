// Life.py's 3D world: one WebGL renderer shared by every screen. A screen mounts the
// canvas into its own box and asks for a shot (a place and a camera angle).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GradeShader } from './grade.js';
import { skyDome } from './sky.js';
import { buildWorld } from './world.js';
import { buildKitchen } from './kitchen.js';
import { buildClassroom } from './classroom.js';

// Indoor places are separate small scenes; everything else is part of the neighbourhood.
const INTERIORS = { kitchen: buildKitchen, classroom: buildClassroom };
import { makePip } from './pip.js';
import { time } from './kit.js';
import { setAnisotropy } from './textures.js';

const worlds = {};
let renderer = null;
let composer = null;
let bloom = null;
let camera = null;
let pip = null;
let world = null;
let host = null;
let resizeObs = null;
let raf = 0;
let last = 0;
let quality = 2;
let slow = 0;
let still = false;
let firstFrame = true;
// Phones and small tablets get lighter worlds from the start.
const mobile = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4);
const detail = mobile ? 0.5 : 1;

const cam = {
  from: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
  to: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
  t: 1,
  dur: 1.6,
  shot: null,
};
const pipSpot = { show: false, x: 0, bottom: 0.03, size: 0.5, maxW: 0.34 };

// Pip floats in front of the lens. x is -1..1 across the view, bottom is 0..1 up from
// the bottom edge, size is Pip's height as a share of the view (capped by maxW of the width).
function placePip() {
  // Close to the lens, so nothing in the room can stand in front of Pip.
  const dist = 1.3;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  const halfW = halfH * camera.aspect;
  const eff = Math.min(pipSpot.size, (pipSpot.maxW || 1) * camera.aspect);
  const scale = (eff * halfH * 2) / 1.75;
  pip.group.scale.setScalar(scale);
  pip.group.position.set(pipSpot.x * halfW, (-1 + 2 * (pipSpot.bottom || 0)) * halfH + 0.45 * scale, -dist);
  pip.group.rotation.set(0, -pipSpot.x * 0.25, 0);
}

export function supported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch (e) {
    return false;
  }
}

function init() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
  renderer.domElement.className = 'world-canvas';
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 5000);
  pip = makePip();
  pip.group.visible = false;
  camera.add(pip.group);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(new THREE.Scene(), camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 3.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));
}

function getWorld(region, place) {
  const key = INTERIORS[place] ? `${region}:${place}` : region;
  if (!worlds[key]) {
    let w;
    if (INTERIORS[place]) {
      w = INTERIORS[place](region, renderer);
    } else {
      w = buildWorld(region, detail);
      // Reflections on glass, water and Pip come from the same sky.
      const pm = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const sky = skyDome(Object.assign({}, w.R.sky, { cover: 0.2 })).mesh;
      sky.scale.setScalar(0.25);
      envScene.add(sky);
      w.scene.environment = pm.fromScene(envScene, 0, 0.1, 2000).texture;
      pm.dispose();
    }
    worlds[key] = w;
  }
  const w = worlds[key];
  if (camera.parent !== w.scene) w.scene.add(camera);
  return w;
}

function resize() {
  if (!host) return;
  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

export function mount(el) {
  init();
  if (host === el && renderer.domElement.parentNode === el) return;
  host = el;
  // Hidden until it has drawn, so a painted placeholder shows while a place is built.
  renderer.domElement.style.visibility = 'hidden';
  firstFrame = true;
  el.prepend(renderer.domElement);
  if (resizeObs) resizeObs.disconnect();
  resizeObs = new ResizeObserver(resize);
  resizeObs.observe(el);
  resize();
  start();
}

export function unmount(el) {
  if (el && host !== el) return;
  host = null;
  if (resizeObs) resizeObs.disconnect();
  if (renderer && renderer.domElement.parentNode) renderer.domElement.remove();
  cancelAnimationFrame(raf);
  raf = 0;
}

function shotVectors(shot) {
  return { pos: new THREE.Vector3(...shot.pos), look: new THREE.Vector3(...shot.look) };
}

// Move to a place: a new region cuts straight there, the same region glides.
export function show(region, shotName, opts = {}) {
  init();
  const w = getWorld(region, shotName);
  const shot = w.shots[shotName] || w.shots.title;
  const target = shotVectors(shot);
  const cut = opts.instant || world !== w || !cam.shot || follow.on;
  follow.on = false;
  if (markers && world !== w) markers = null;
  if (world !== w) {
    world = w;
    composer.passes[0].scene = w.scene;
    renderer.toneMappingExposure = w.R.exposure || 0.7;
  }
  if (cut) {
    cam.from = target;
    cam.t = 1;
  } else {
    cam.from = { pos: camera.position.clone(), look: currentLook.clone() };
    cam.t = 0;
  }
  cam.to = target;
  cam.shot = shot;
  camera.fov = shot.fov || 42;
  camera.updateProjectionMatrix();
  if (shot.shadow) {
    const [sx, sy, sz, rad] = shot.shadow;
    const L = w.sunLight;
    L.target.position.set(sx, sy, sz);
    L.position.copy(w.sun).multiplyScalar(150).add(L.target.position);
    const sc = L.shadow.camera;
    sc.left = -rad; sc.right = rad; sc.top = rad; sc.bottom = -rad;
    sc.near = 1; sc.far = 400;
    sc.updateProjectionMatrix();
  }
  if (opts.render !== false) frame(performance.now());
}

// Pip floats in front of the camera: x and y are -1..1 across the view.
export function setPip(o) {
  init();
  Object.assign(pipSpot, o);
  pip.group.visible = !!pipSpot.show;
  if (o.state) pip.setState(o.state);
}

export function pipState(state) {
  if (pip) pip.setState(state);
}

export function setStill(v) {
  still = !!v;
}

const currentLook = new THREE.Vector3();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function placeCamera(t, dt) {
  if (follow.on && world && world.mapShot) {
    const s = world.mapShot(follow.x);
    const k = 1 - Math.exp(-dt * 5);
    follow.cur.pos.lerp(new THREE.Vector3(...s.pos), k);
    follow.cur.look.lerp(new THREE.Vector3(...s.look), k);
    camera.position.copy(follow.cur.pos);
    camera.lookAt(follow.cur.look);
    currentLook.copy(follow.cur.look);
    pip.group.visible = false;
    return;
  }
  const shot = cam.shot;
  if (cam.t < 1) cam.t = Math.min(1, cam.t + 1 / (60 * cam.dur));
  const k = ease(cam.t);
  const pos = cam.from.pos.clone().lerp(cam.to.pos, k);
  const look = cam.from.look.clone().lerp(cam.to.look, k);
  if (shot && !still) {
    const d = shot.drift || 0;
    pos.x += Math.sin(t * 0.11) * d;
    pos.y += Math.sin(t * 0.17) * d * 0.3;
    pos.z += Math.cos(t * 0.09) * d * 0.6;
    if (shot.orbit) {
      const ang = Math.sin(t * shot.orbit) * 0.5;
      const off = pos.clone().sub(look);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      pos.copy(look).add(off);
    }
  }
  camera.position.copy(pos);
  camera.lookAt(look);
  currentLook.copy(look);
  if (pip.group.visible) placePip();
}

function frame(now) {
  if (!world || !host) return;
  const t = now / 1000;
  const dt = Math.min(0.1, last ? t - last : 0.016);
  last = t;
  time.value = t;
  for (const u of world.updaters) u(dt, t);
  pip.update(dt, t, still);
  placeCamera(t, dt);
  if (quality >= 2) composer.render();
  else renderer.render(world.scene, camera);
  if (firstFrame) {
    firstFrame = false;
    renderer.domElement.style.visibility = '';
  }
  for (const fn of frameHooks) fn();
  // Phones that struggle step down: fewer pixels, then no glow, then no shadows.
  if (dt > 0.045) slow++;
  else slow = Math.max(0, slow - 1);
  if (slow > 90) {
    slow = 0;
    degrade();
  }
}

function degrade() {
  const pr = renderer.getPixelRatio();
  if (pr > 1) renderer.setPixelRatio(Math.max(1, pr - 0.5));
  else if (quality >= 2) quality = 1;
  else if (renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = false;
    Object.values(worlds).forEach((w) => w.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }));
  }
  resize();
}

let paused = false;
export function pause(v) {
  paused = !!v;
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (document.hidden || paused) return;
  frame(now);
}

function start() {
  if (!raf) raf = requestAnimationFrame(loop);
}

// For screenshots in tests: draw one frame now.
export function renderNow() {
  frame(performance.now());
}

export { THREE };

// For debugging in the browser console.
export function _internals() {
  return { renderer, camera, world, composer };
}

// ---------- helpers for the game's screens ----------

const projV = new THREE.Vector3();

// Where a point in the world appears inside the mounted box, in CSS pixels.
export function project(x, y, z) {
  if (!host || !camera) return null;
  projV.set(x, y, z).project(camera);
  const behind = projV.z > 1;
  return { x: (projV.x * 0.5 + 0.5) * host.clientWidth, y: (-projV.y * 0.5 + 0.5) * host.clientHeight, behind };
}

const frameHooks = new Set();
export function onFrame(fn) {
  frameHooks.add(fn);
  return () => frameHooks.delete(fn);
}

// The map camera follows a point along the road. Dragging moves it smoothly.
const follow = { on: false, x: 0, cur: null };
export function mapFocus(region, x, opts = {}) {
  init();
  const w = getWorld(region);
  if (world !== w) show(region, 'title', { instant: true, render: false });
  follow.on = true;
  follow.x = x;
  const s = w.mapShot(x);
  if (opts.instant || !follow.cur) follow.cur = { pos: new THREE.Vector3(...s.pos), look: new THREE.Vector3(...s.look) };
  cam.shot = s;
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
  const [sx, sy, sz, rad] = s.shadow;
  const L = w.sunLight;
  L.target.position.set(sx, sy, sz);
  L.position.copy(w.sun).multiplyScalar(150).add(L.target.position);
  Object.assign(L.shadow.camera, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: 400 });
  L.shadow.camera.updateProjectionMatrix();
}

export function mapInfo(region) {
  init();
  const w = getWorld(region);
  return { roadZ: w.roadZ, sites: w.sites, house: w.house, grandma: w.grandma.door, park: w.park.centre };
}

// Glowing discs on the road under each mission on the map.
let markers = null;
export function setMarkers(list) {
  if (!world) return;
  if (markers) {
    markers.parent && markers.parent.remove(markers);
    markers = null;
  }
  if (!list) return;
  markers = new THREE.Group();
  const colors = { done: '#ffd36a', current: '#7fa6ff', open: '#d6e2ff', locked: '#9a958a' };
  for (const m of list) {
    const mat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: colors[m.state], emissiveIntensity: m.state === 'locked' ? 0.4 : 2.4, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(m.x, 0.12, m.z);
    markers.add(ring);
  }
  world.scene.add(markers);
}

// Draws a still of a place, for photos in the album.
export function snapshot(region, shotName, w, h, pipOpts) {
  init();
  const keep = { world, host, shot: cam.shot, from: cam.from, to: cam.to, t: cam.t, pip: Object.assign({}, pipSpot), state: pip.state, follow: follow.on };
  const wld = getWorld(region, shotName);
  const shot = wld.shots[shotName];
  composer.passes[0].scene = wld.scene;
  renderer.toneMappingExposure = wld.R.exposure || 0.7;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = shot.fov || 42;
  camera.updateProjectionMatrix();
  camera.position.set(...shot.pos);
  camera.lookAt(...shot.look);
  if (shot.shadow) {
    const [sx, sy, sz, rad] = shot.shadow;
    const L = wld.sunLight;
    L.target.position.set(sx, sy, sz);
    L.position.copy(wld.sun).multiplyScalar(150).add(L.target.position);
    Object.assign(L.shadow.camera, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: 400 });
    L.shadow.camera.updateProjectionMatrix();
  }
  Object.assign(pipSpot, pipOpts || { show: false });
  pip.group.visible = !!pipSpot.show;
  if (pipOpts && pipOpts.state) pip.setState(pipOpts.state);
  pip.update(0, 0, true);
  placePip();
  if (quality >= 2) composer.render();
  else renderer.render(wld.scene, camera);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').drawImage(renderer.domElement, 0, 0, w, h);
  // Put everything back the way the screen had it.
  world = keep.world;
  if (world) {
    composer.passes[0].scene = world.scene;
    renderer.toneMappingExposure = world.R.exposure || 0.7;
    if (camera.parent !== world.scene) world.scene.add(camera);
  }
  Object.assign(cam, { shot: keep.shot, from: keep.from, to: keep.to, t: keep.t });
  Object.assign(pipSpot, keep.pip);
  pip.group.visible = !!pipSpot.show;
  pip.setState(keep.state);
  if (keep.shot && keep.shot.shadow && world && world.sunLight && !world.interior) {
    const [sx, sy, sz, rad] = keep.shot.shadow;
    const L = world.sunLight;
    L.target.position.set(sx, sy, sz);
    L.position.copy(world.sun).multiplyScalar(150).add(L.target.position);
    Object.assign(L.shadow.camera, { left: -rad, right: rad, top: rad, bottom: -rad, near: 1, far: 400 });
    L.shadow.camera.updateProjectionMatrix();
  }
  resize();
  return out;
}

// Build a place ahead of time so it is ready when the player gets there.
export function prepare(region, place) {
  init();
  getWorld(region, INTERIORS[place] ? place : undefined);
}
