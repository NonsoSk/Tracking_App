// One living neighbourhood per hometown: the family home, Grandma's house, the
// street, the park, and the places later chapters will open up.
import * as THREE from 'three';
import { skyDome } from './sky.js';
import { plantMaterials, terrain, waterMaterial, birds, grassField, forest, palm, tree } from './nature.js';
import { Kit, ribbon, std } from './kit.js';
import { HOUSES } from './houses.js';
import { party, bunting, fairyLights, car } from './props.js';
import { townMaterials, neighbour, bungalow, park, landmarks } from './town.js';
import * as T from './textures.js';
import { fbm, smooth, rng } from './noise.js';

export const REGIONS = {
  westafrica: {
    sky: { zenith: '#2b63b8', mid: '#7cabdc', horizon: '#ecdcc6', ground: '#b9ab9c', sunColor: '#ffd8a8', elevation: 24, azimuth: 108, cover: 0.42, gain: 1.7 },
    sun: '#ffdcae', sunI: 4.0, hemiSky: '#b9cfee', hemiGround: '#7d7250', hemi: 0.45, env: 0.5,
    fogNear: 140, fogFar: 1500, exposure: 0.68,
    grass: '#7a9f4c', landTints: ['#ffffff', '#eef5dc', '#dfe9c4', '#f6f2d6'], highTint: '#a6a066',
    hills: 7, sea: 'behind', skyline: '#5a7590', distant: 'palm', street: 'palm', car: '#20262e',
    style: { roof: 'flat', compound: true, schoolAccent: '#2f8a5a', flag: '#2f8a5a', walls: ['#e6dfd2', '#d8c9b2', '#ece6dc', '#c7b296'], trim: '#efeae2', roofColor: '#ece6dc', tree: 'palm', flower: 'bougainvillea', parkTree: 'broadleaf', flowerTree: 'flamboyant', grandmaTree: 'mango', grandmaRoofColor: '#8f4a34', shutter: '#3f6b5a' },
  },
  southasia: {
    sky: { zenith: '#3667b0', mid: '#86acd4', horizon: '#efdcc0', ground: '#bcab95', sunColor: '#ffd29a', elevation: 22, azimuth: 108, cover: 0.32, gain: 1.7 },
    sun: '#ffd6a2', sunI: 4.0, hemiSky: '#bccde6', hemiGround: '#7f7050', hemi: 0.45, env: 0.5,
    fogNear: 120, fogFar: 1300, exposure: 0.68,
    grass: '#80a04a', landTints: ['#ffffff', '#f2f0d4', '#e3e8c0', '#f4ead0'], highTint: '#a9a06a',
    hills: 9, sea: 'behind', skyline: '#6b7f8f', distant: 'palm', street: 'palm', car: '#e9e7e2',
    style: { roof: 'flat', compound: true, schoolAccent: '#c0562f', flag: '#e08a2a', walls: ['#efe6d6', '#e6d3b8', '#f3ede4', '#d8c2a0'], trim: '#f3ede4', roofColor: '#f3ede4', tree: 'palm', flower: 'bougainvillea', parkTree: 'neem', flowerTree: 'flamboyant', grandmaTree: 'mango', grandmaRoofColor: '#a4553a', shutter: '#2f6f6a' },
  },
  latam: {
    sky: { zenith: '#2457ae', mid: '#6c9fd8', horizon: '#dfe4e2', ground: '#a9b0a8', sunColor: '#ffe0b4', elevation: 28, azimuth: 112, cover: 0.5, gain: 1.75 },
    sun: '#ffe2b6', sunI: 3.9, hemiSky: '#b6cdee', hemiGround: '#6f6a4a', hemi: 0.45, env: 0.5,
    fogNear: 160, fogFar: 1700, exposure: 0.68,
    grass: '#76994a', landTints: ['#ffffff', '#eef0d0', '#e2e2b8', '#f2ead0'], highTint: '#8f9a6a',
    hills: 12, mountains: 170, distant: 'broadleaf', street: 'jacaranda', car: '#7a1f24',
    style: { roof: 'clay', compound: true, schoolAccent: '#2c6ea3', flag: '#2c6ea3', schoolName: 'ESCUELA PRIMARIA', walls: ['#f0e3c8', '#e8c6a6', '#d6e3d8', '#f2d4c4', '#f4ecd8', '#c9dbe8'], trim: '#f6efe2', roofColor: '#b4532d', tree: 'jacaranda', flower: 'bougainvillea', parkTree: 'broadleaf', flowerTree: 'jacaranda', grandmaTree: 'broadleaf', grandmaRoofColor: '#a6492a', shutter: '#2c6ea3' },
  },
  ukus: {
    sky: { zenith: '#3a6db8', mid: '#8bb3dc', horizon: '#e4e7e6', ground: '#a3ad9f', sunColor: '#fff0d4', elevation: 30, azimuth: 110, cover: 0.62, gain: 1.75 },
    sun: '#fff0d8', sunI: 3.5, hemiSky: '#c2d4ee', hemiGround: '#5f6a44', hemi: 0.5, env: 0.55,
    fogNear: 140, fogFar: 1400, exposure: 0.7,
    grass: '#6f9a46', landTints: ['#ffffff', '#e9f0d0', '#f3ecc4', '#dfe8c8', '#cfe0b0'], highTint: '#7f9a5a', fields: true,
    hills: 16, distant: 'oak', street: 'maple', car: '#22382c',
    style: { roof: 'slate', brickWalls: true, schoolAccent: '#8a2b3a', flag: '#1f4e8c', walls: ['#a2563c', '#b8664a', '#8f4a36', '#e9e2d4'], brick: '#9c4a33', trim: '#f4f2ec', roofColor: '#59606a', tree: 'oak', flower: 'rose', parkTree: 'oak', flowerTree: 'maple', grandmaTree: 'oak', grandmaRoof: 'slate', grandmaRoofColor: '#59606a', shutter: '#2f4a3a' },
  },
};

const ROAD_Z = 27;

// Flat where people live, rolling hills beyond; coastal cities have water behind.
function heightFn(R) {
  return (x, z) => {
    const edge = Math.max(Math.abs(x - 140) - 330, z > ROAD_Z ? z - 110 : -45 - z, 0);
    const k = smooth(0, 140, edge);
    let h = k * (fbm(x / 160, z / 160, 4, 21) * R.hills * 2.4 + edge * 0.035 * R.hills / 8);
    if (R.sea === 'behind' && z < -40) h = Math.min(h, 0) - smooth(-40, -110, z) * 6;
    if (R.mountains) {
      const d = Math.hypot(x - 120, z + 60);
      h += smooth(380, 640, d) * (0.45 + fbm(x / 120, z / 120, 4, 9) * 0.9) * R.mountains;
    }
    // A low hill for the wedding venue at the end of the road.
    h += 14 * Math.exp(-((x - 470) ** 2 + (z - 10) ** 2) / 2200);
    return h;
  };
}

export function buildWorld(regionId, detail = 1) {
  const R = REGIONS[regionId] || REGIONS.westafrica;
  const scene = new THREE.Scene();
  const dome = skyDome(R.sky);
  const sky = dome.mesh;
  const sun = dome.sunDir;
  scene.add(sky);
  scene.fog = new THREE.Fog(new THREE.Color(R.sky.horizon).multiplyScalar(R.sky.gain * 0.62), R.fogNear, R.fogFar);
  scene.environmentIntensity = R.env;

  const sunLight = new THREE.DirectionalLight(R.sun, R.sunI);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(detail < 1 ? 1024 : 2048, detail < 1 ? 1024 : 2048);
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.HemisphereLight(R.hemiSky, R.hemiGround, R.hemi));

  const updaters = [];
  const waters = [];
  const plants = plantMaterials();
  const P = { plants, water: (c, o) => { const m = waterMaterial(c, o); waters.push(m); return m; } };
  const M = townMaterials(R.style);

  const heightAt = heightFn(R);
  const land = terrain(R, heightAt);
  land.position.set(0, 0, 0);
  scene.add(land);
  if (R.sea) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1400), P.water('#2c6f86', 0.95));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(150, -1.0, -760);
    scene.add(sea);
  }

  // The street: the road of life the map follows.
  const roadPts = [[-220, ROAD_Z], [-60, ROAD_Z], [60, ROAD_Z], [200, ROAD_Z + 2], [330, ROAD_Z - 2], [420, ROAD_Z], [455, 18]];
  const road = new THREE.CatmullRomCurve3(roadPts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const asphalt = std({ map: T.asphalt(), roughness: 0.92 });
  const roadMesh = new THREE.Mesh(ribbon(road, 7, 0.03, 400, 6), asphalt);
  roadMesh.receiveShadow = true;
  scene.add(roadMesh);
  const lineMat = std({ map: dashTexture(), roughness: 0.7 });
  scene.add(new THREE.Mesh(ribbon(road, 0.14, 0.04, 400, 6), lineMat));
  const walk = std({ map: T.tiled(T.pavers('#b8b0a4'), 1, 1), roughness: 0.9 });
  for (const off of [-4.4, 4.4]) {
    const m = new THREE.Mesh(ribbon(road, 1.8, 0.09, 400, 2.2, off), walk);
    m.receiveShadow = true;
    scene.add(m);
  }
  const kerb = std({ color: '#cfcac0', roughness: 0.8 });
  for (const off of [-3.55, 3.55]) scene.add(new THREE.Mesh(ribbon(road, 0.18, 0.12, 400, 2, off), kerb));

  // The family home.
  const homeGroup = new THREE.Group();
  scene.add(homeGroup);
  const house = (HOUSES[regionId] || HOUSES.westafrica)(homeGroup, P, 0, 0);
  updaters.push(party(homeGroup, P, house.party.x, house.party.z, regionId).userData.update);
  const pX = house.party.x;
  const pZ = house.party.z;
  bunting(homeGroup, new THREE.Vector3(pX - 4.5, 2.7, pZ - 1.6), new THREE.Vector3(pX + 3.5, 2.9, pZ - 1.2), 0.5);
  fairyLights(homeGroup, new THREE.Vector3(pX - 4.4, 2.9, pZ + 1.8), new THREE.Vector3(pX + 3.6, 3.0, pZ + 2.2), 0.55);
  const poles = new Kit();
  const poleMat = std({ color: '#efe9de', roughness: 0.6 });
  for (const [px, pz] of [[-4.5, -1.6], [3.5, -1.2], [-4.4, 1.8], [3.6, 2.2]]) poles.box(poleMat, 0.08, 3, 0.08, pX + px, 1.5, pZ + pz);
  poles.build(homeGroup);
  car(homeGroup, house.gate.x, house.gate.z - 8, -Math.PI / 2, R.car);

  // Next door: Grandma. Then the neighbours, the park across the road, and the road ahead.
  const grandma = bungalow(scene, M, P, R.style, 44, 2);
  [-46, -92, -138, -184, 92, 138].forEach((x, i) => neighbour(scene, M, P, R.style, x, 2, 0, 11 + i));
  [-30, -76, -122, -168].forEach((x, i) => neighbour(scene, M, P, R.style, x, 52, Math.PI, 31 + i));
  const pk = park(scene, M, P, 62, 33, 150, 92, R.style);
  updaters.push(pk.swings.userData.update);
  const sites = { school: { x: 205, z: 62, ry: Math.PI }, uni: { x: 270, z: 66 }, city: { x: 330, z: -40 }, venue: { x: 470, y: 14, z: 10 } };
  const school = landmarks(scene, M, P, R.style, sites);
  if (R.skyline) skyline(scene, R.skyline, heightAt);

  const street = new Kit();
  for (let x = -200; x < 430; x += 15) {
    if (Math.abs(x + 7.4) < 6 || (x > 60 && x < 152)) continue;
    const z = ROAD_Z + 5.4;
    if (R.street === 'palm') palm(street, plants, x + 3, z, 8 + ((x / 15) % 3), 200 + x);
    else tree(street, plants, x + 3, z, 7.5, R.street, 200 + x, 0.7);
  }
  street.build(scene);

  // Far trees in groves on the hills.
  const spots = [];
  const rr = rng(99);
  for (let i = 0; i < 4000 && spots.length < 340; i++) {
    const x = -420 + rr() * 1100;
    const z = -260 + rr() * 560;
    if (x > -230 && x < 480 && z > -30 && z < 100) continue;
    if (fbm(x / 90, z / 90, 2, 3) < 0.48) continue;
    const y = heightAt(x, z);
    if (y < 0.2) continue;
    spots.push([x, y, z]);
  }
  scene.add(forest(plants, R.distant === 'palm' ? 'palm' : R.distant, spots.filter((_, i) => i % 2 === 0), 7));
  scene.add(forest(plants, R.style.parkTree || 'broadleaf', spots.filter((_, i) => i % 2 === 1), 8));

  // Lawns close to the camera get real grass.
  const pg = pk.playground;
  const nearPlay = [[pg.x - 28, pg.z - 6, pg.x - 9, pg.z + 16], [pg.x + 9, pg.z - 6, pg.x + 20, pg.z + 16]];
  scene.add(grassField(house.lawn.concat(grandma.lawn, nearPlay), Math.round(26000 * detail), R.grass, 4));

  updaters.push((dt, t) => { dome.uniforms.time.value = t; });
  const b = birds(7, new THREE.Vector3(20, 0, 10));
  scene.add(b);
  updaters.push(b.userData.update);
  updaters.push((dt, t) => { for (const w of waters) w.userData.flow.offset.set(t * 0.012, t * 0.008); });

  // Camera shots: where the camera stands and looks, and how far shadows reach.
  const shots = {
    title: { pos: [34, 20, 66], look: [2, 4, 4], drift: 1.4, orbit: 0.05, shadow: [0, 0, 6, 40], fov: 40 },
    hero: { pos: [4, 8, 47], look: [-1, 4.2, 4], drift: 0.5, shadow: [0, 0, 6, 34], fov: 40 },
    home: { pos: [pX + 1.4, 1.6, pZ + 6.1], look: [pX - 1.0, 2.1, pZ - 6], drift: 0.22, shadow: [pX, 0, pZ - 3, 22], fov: 46 },
    name: { pos: [pX - 2.6, 1.7, pZ + 6.0], look: [pX - 5, 2.8, pZ - 6], drift: 0.22, shadow: [pX, 0, pZ - 3, 22], fov: 46 },
    grandma: { pos: [44, 2.0, 24], look: [44, 2.6, 6], drift: 0.25, shadow: [44, 0, 10, 24], fov: 46 },
    schoolyard: { pos: school.shot.pos, look: school.shot.look, drift: 0.25, shadow: [sites.school.x, 0, sites.school.z - 14, 28], fov: 48 },
    park: { pos: [pk.playground.x - 6, 1.7, pk.playground.z + 13], look: [pk.playground.x + 1, 1.6, pk.playground.z - 2], drift: 0.25, shadow: [pk.playground.x, 0, pk.playground.z, 24], fov: 48 },
  };
  // The map camera rides along the road; nodes sit on it.
  const mapShot = (x) => ({ pos: [x - 38, 30, ROAD_Z + 6], look: [x + 18, 0, ROAD_Z - 2], drift: 0, shadow: [x + 10, 0, ROAD_Z, 70], fov: 50 });

  return { region: regionId, R, scene, sky, dome, sun, sunLight, shots, mapShot, road, roadZ: ROAD_Z, updaters, heightAt, sites, grandma, park: pk, house };
}

// Glass towers across the water, the way the Lagos skyline sits across the lagoon.
function skyline(scene, tone, heightAt) {
  const kit = new Kit();
  const glass = new THREE.MeshPhysicalMaterial({ map: T.tiled(T.towerWindows(tone), 1 / 12, 1 / 8), metalness: 0.4, roughness: 0.2, envMapIntensity: 1.1 });
  const r = rng(17);
  for (let i = 0; i < 26; i++) {
    const w = 18 + r() * 22;
    const h = 50 + Math.pow(r(), 1.6) * 170;
    const x = -320 + i * 34 + r() * 14;
    const z = -720 - r() * 140;
    const y = Math.max(0, heightAt(x, z));
    kit.box(glass, w, h, w * (0.7 + r() * 0.6), x, y + h / 2 - 1, z, r() * 0.4);
  }
  for (const m of kit.build(scene)) { m.castShadow = false; m.receiveShadow = false; }
}

function dashTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(0, 0, 8, 36);
  ctx.fillStyle = '#3c3e41';
  ctx.fillRect(0, 36, 8, 28);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

