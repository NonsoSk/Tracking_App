// An art-directed sky dome: a deep blue zenith, a soft hazy horizon, a glowing sun
// and slow-moving cumulus clouds, all drawn in one shader.
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */ `
uniform vec3 zenith;
uniform vec3 mid;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float time;
uniform float cover;
uniform float gain;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, h));
  col = mix(col, zenith, smoothstep(0.18, 0.85, h));
  if (h < 0.0) col = mix(horizon, ground, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.45);
  col = mix(col, sunColor * 0.9, smoothstep(0.0, 0.35, 1.0 - h) * pow(sd, 3.0) * 0.25);
  float disc = smoothstep(0.99955, 0.9998, sd);
  if (h > 0.02) {
    vec2 uv = d.xz / (h + 0.09) * 0.75 + vec2(time * 0.006, time * 0.0025);
    float c = fbm(uv);
    float m = smoothstep(0.62 - cover * 0.28, 0.9, c);
    float lit = fbm(uv + sunDir.xz * 0.12);
    vec3 bright = vec3(1.0, 0.985, 0.96) * 1.25 + sunColor * pow(sd, 5.0) * 0.35;
    vec3 shadow = mix(horizon, vec3(0.58, 0.63, 0.72), 0.6);
    vec3 cloud = mix(bright, shadow, clamp((lit - c) * 2.6 + 0.35, 0.0, 1.0));
    float fade = smoothstep(0.02, 0.22, h);
    col = mix(col, cloud, m * fade * 0.96);
    disc *= 1.0 - m;
  }
  col += sunColor * disc * 14.0;
  gl_FragColor = vec4(col * gain, 1.0);
}`;

export function skyDome(o) {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - o.elevation), THREE.MathUtils.degToRad(o.azimuth));
  const uniforms = {
    zenith: { value: new THREE.Color(o.zenith) },
    mid: { value: new THREE.Color(o.mid) },
    horizon: { value: new THREE.Color(o.horizon) },
    ground: { value: new THREE.Color(o.ground || o.horizon) },
    sunColor: { value: new THREE.Color(o.sunColor || '#fff1d6') },
    sunDir: { value: sunDir },
    time: { value: 0 },
    cover: { value: o.cover == null ? 0.5 : o.cover },
    gain: { value: o.gain || 1.6 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return { mesh, sunDir, uniforms };
}
