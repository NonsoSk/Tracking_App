// Geometry helpers: boxes textured at real-world scale, wind sway, and a Kit that
// merges many small parts into one mesh per material so phones can draw a house fast.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const time = { value: 0 };
const windStrength = { value: 1 };

// Leaves and grass sway in the wind. aSway (0 at the root, 1 at the tip) says how much.
export function windy(material, amount = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWind = windStrength;
    shader.vertexShader = `attribute float aSway;\nuniform float uTime;\nuniform float uWind;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec3 wpos = position;
      #ifdef USE_INSTANCING
        wpos = (instanceMatrix * vec4(position, 1.0)).xyz;
      #endif
      wpos = (modelMatrix * vec4(wpos, 1.0)).xyz;
      float ph = wpos.x * 0.21 + wpos.z * 0.17;
      float sw = aSway * uWind * ${amount.toFixed(3)};
      transformed.x += (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.7) * 0.22) * sw;
      transformed.z += cos(uTime * 1.1 + ph * 1.3) * 0.45 * sw;
      transformed.y += sin(uTime * 2.3 + ph) * 0.08 * sw;`,
    );
  };
  material.customProgramCacheKey = () => `windy${amount}`;
  material.userData.windy = amount;
  return material;
}

export function setSway(geo, fn) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) arr[i] = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
  geo.setAttribute('aSway', new THREE.BufferAttribute(arr, 1));
  return geo;
}

// A box whose texture is the same size on every face: `scale` metres per repeat.
export function boxGeo(w, h, d, scale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0] / scale, uv.getY(i) * dims[f][1] / scale);
    }
  }
  return g;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const s = new THREE.Vector3();

export function place(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  m4.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz));
  geo.applyMatrix4(m4);
  return geo;
}

export class Kit {
  constructor() {
    this.parts = new Map();
  }

  add(material, geo, opts) {
    if (!this.parts.has(material)) this.parts.set(material, { geos: [], cast: true, receive: true });
    const p = this.parts.get(material);
    p.geos.push(geo.index ? geo.toNonIndexed() : geo);
    if (opts && opts.cast === false) p.cast = false;
    if (opts && opts.receive === false) p.receive = false;
    return this;
  }

  box(material, w, h, d, x, y, z, ry = 0, scale = 1, opts) {
    return this.add(material, place(boxGeo(w, h, d, scale), x, y, z, 0, ry), opts);
  }

  // Merges and adds everything to `parent`, returning the meshes.
  build(parent) {
    const meshes = [];
    for (const [material, p] of this.parts) {
      const sway = p.geos.some((g) => g.attributes.aSway);
      const geos = p.geos.map((g) => {
        if (sway && !g.attributes.aSway) setSway(g, () => 0);
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aSway'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return g;
      });
      const merged = mergeGeometries(geos, false);
      grounded(material);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = p.cast;
      mesh.receiveShadow = p.receive;
      if (material.alphaTest && material.map) {
        mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: material.map, alphaTest: material.alphaTest });
        if (material.userData.windy) windy(mesh.customDepthMaterial, material.userData.windy);
      }
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }
}

// A flat shape (in x/z) lifted to height y, for lawns, paths and pools.
export function flatShape(points, y = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  return g;
}

// A strip that follows a curve on the ground: roads, paths, kerbs.
export function ribbon(curve, width, y = 0.02, segments = 200, uvScale = 4, offset = 0) {
  const pts = curve.getSpacedPoints(segments);
  const positions = [];
  const uvs = [];
  const normals = [];
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const t = curve.getTangentAt(i / segments);
    const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
    if (i > 0) dist += p.distanceTo(pts[i - 1]);
    const a = p.clone().addScaledVector(side, offset - width / 2);
    const b = p.clone().addScaledVector(side, offset + width / 2);
    positions.push(a.x, y, a.z, b.x, y, b.z);
    uvs.push(0, dist / uvScale, 1, dist / uvScale);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  const idx = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

export function std(opts) {
  return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0 }, opts));
}

// Corners where walls meet the ground catch less sky light. This darkens the
// ambient light close to the ground, which seats buildings in the world.
export function grounded(material) {
  if (material.userData.windy || material.userData.grounded || material.transparent) return material;
  material.userData.grounded = true;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying float vGroundY;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vGroundY = (modelMatrix * vec4(transformed, 1.0)).y;`,
    );
    shader.fragmentShader = `varying float vGroundY;\n${shader.fragmentShader}`.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      float gAO = mix(0.5, 1.0, smoothstep(0.0, 1.1, vGroundY));
      reflectedLight.indirectDiffuse *= gAO;
      reflectedLight.directDiffuse *= mix(0.82, 1.0, smoothstep(0.0, 0.35, vGroundY));`,
    );
  };
  material.customProgramCacheKey = () => 'grounded';
  return material;
}
