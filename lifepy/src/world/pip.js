// Pip in 3D: a glossy blue robot with a glowing face screen. The face is drawn on a
// small canvas and used as the screen's light, so it glows like a real display.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';

const FACE = '#ffd76a';

function drawFace(ctx, state, blink, talk) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.fillStyle = FACE;
  ctx.strokeStyle = FACE;
  ctx.shadowColor = FACE;
  ctx.shadowBlur = 14;
  ctx.lineCap = 'round';
  ctx.lineWidth = 14;
  const ex = [w * 0.33, w * 0.67];
  const ey = h * 0.42;
  const eye = (x, sx = 1, sy = 1) => {
    ctx.beginPath();
    ctx.roundRect(x - 15 * sx, ey - 30 * sy, 30 * sx, 60 * sy, 15 * Math.min(sx, sy));
    ctx.fill();
  };
  const closed = (x, up) => {
    ctx.beginPath();
    if (up) ctx.arc(x, ey + 12, 22, Math.PI * 1.15, Math.PI * 1.85);
    else ctx.arc(x, ey - 18, 22, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  };
  const my = h * 0.76;
  if (state === 'sleep') {
    ex.forEach((x) => closed(x, false));
    ctx.beginPath();
    ctx.moveTo(w * 0.44, my);
    ctx.lineTo(w * 0.56, my);
    ctx.stroke();
  } else if (state === 'happy') {
    ex.forEach((x) => closed(x, true));
    ctx.beginPath();
    ctx.moveTo(w * 0.38, my - 14);
    ctx.quadraticCurveTo(w * 0.5, my + 34, w * 0.62, my - 14);
    ctx.closePath();
    ctx.fill();
  } else {
    if (blink) ex.forEach((x) => { ctx.beginPath(); ctx.moveTo(x - 16, ey); ctx.lineTo(x + 16, ey); ctx.stroke(); });
    else if (state === 'confused') { eye(ex[0], 1, 0.75); eye(ex[1], 1, 1); }
    else if (state === 'oops') { eye(ex[0], 1.05, 1.05); eye(ex[1], 1.05, 1.05); }
    else ex.forEach((x) => eye(x));
    ctx.beginPath();
    if (state === 'talk') {
      ctx.roundRect(w * 0.42, my - 10 - talk * 14, w * 0.16, 20 + talk * 28, 12);
      ctx.fill();
    } else if (state === 'oops') {
      ctx.arc(w * 0.5, my, 13, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'confused') {
      ctx.moveTo(w * 0.42, my + 4);
      ctx.lineTo(w * 0.58, my - 4);
      ctx.stroke();
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(ex[1] - 22, ey - 50);
      ctx.lineTo(ex[1] + 20, ey - 60);
      ctx.stroke();
    } else {
      ctx.arc(w * 0.5, my - 22, 28, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function makePip() {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const shell = new THREE.MeshPhysicalMaterial({ color: '#2f5fe6', roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3, sheenColor: new THREE.Color('#9fb6ff') });
  const trim = new THREE.MeshPhysicalMaterial({ color: '#dfe6f5', roughness: 0.35, metalness: 0.6, clearcoat: 0.6 });

  const head = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.8, 0.72, 6, 0.26), shell);
  head.position.y = 0.55;
  rig.add(head);

  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 176;
  const ctx = c.getContext('2d');
  const faceTex = new THREE.CanvasTexture(c);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  const shape = new THREE.Shape();
  const fw = 0.78;
  const fh = 0.54;
  const rr = 0.17;
  shape.moveTo(-fw / 2 + rr, -fh / 2);
  shape.lineTo(fw / 2 - rr, -fh / 2);
  shape.quadraticCurveTo(fw / 2, -fh / 2, fw / 2, -fh / 2 + rr);
  shape.lineTo(fw / 2, fh / 2 - rr);
  shape.quadraticCurveTo(fw / 2, fh / 2, fw / 2 - rr, fh / 2);
  shape.lineTo(-fw / 2 + rr, fh / 2);
  shape.quadraticCurveTo(-fw / 2, fh / 2, -fw / 2, fh / 2 - rr);
  shape.lineTo(-fw / 2, -fh / 2 + rr);
  shape.quadraticCurveTo(-fw / 2, -fh / 2, -fw / 2 + rr, -fh / 2);
  const faceGeo = new THREE.ShapeGeometry(shape, 8);
  const uv = faceGeo.attributes.uv;
  const p = faceGeo.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / fw + 0.5, p.getY(i) / fh + 0.5);
  const screen = new THREE.Mesh(faceGeo, new THREE.MeshPhysicalMaterial({ color: '#070b1c', roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#ffffff', emissiveMap: faceTex, emissiveIntensity: 2.4 }));
  screen.position.set(0, 0.55, 0.362);
  rig.add(screen);

  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.28, 8), trim);
  ant.position.set(0, 1.08, 0);
  rig.add(ant);
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#ffcf4a', emissiveIntensity: 3 });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), bulbMat);
  bulb.position.set(0, 1.25, 0);
  rig.add(bulb);

  const body = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.42, 0.42, 4, 0.16), shell);
  body.position.y = -0.03;
  rig.add(body);
  const chest = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: '#ffcf4a', emissiveIntensity: 2.2 }));
  chest.position.set(0, -0.01, 0.212);
  rig.add(chest);
  const arms = [-1, 1].map((sd) => {
    const pivot = new THREE.Group();
    pivot.position.set(sd * 0.3, 0.06, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 6, 10), shell);
    arm.position.set(sd * 0.06, -0.14, 0);
    arm.rotation.z = sd * 0.25;
    pivot.add(arm);
    rig.add(pivot);
    return pivot;
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: T.soft('#9fd4ff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.42;
  group.add(glow);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  glow.castShadow = false;

  const st = { state: 'idle', since: 0, blinkAt: 2, blink: false, talk: 0, drawn: '' };

  function redraw() {
    const key = `${st.state}|${st.blink}|${st.state === 'talk' ? Math.round(st.talk * 4) : 0}`;
    if (key === st.drawn) return;
    st.drawn = key;
    drawFace(ctx, st.state, st.blink, st.talk);
    faceTex.needsUpdate = true;
  }
  redraw();

  return {
    group,
    setState(state) {
      if (state === st.state) return;
      st.state = state;
      st.since = -1;
      screen.material.emissiveIntensity = state === 'sleep' ? 0.9 : 2.4;
      bulbMat.emissiveIntensity = state === 'sleep' ? 0.6 : 3;
    },
    get state() { return st.state; },
    update(dt, t, still) {
      if (st.since < 0) st.since = t;
      const age = t - st.since;
      if (t > st.blinkAt) { st.blink = true; if (t > st.blinkAt + 0.12) { st.blink = false; st.blinkAt = t + 2.5 + Math.random() * 3; } }
      st.talk = st.state === 'talk' ? 0.5 + Math.sin(t * 22) * 0.35 + Math.sin(t * 13) * 0.15 : 0;
      redraw();
      const sleepy = st.state === 'sleep';
      let y = still ? 0 : Math.sin(t * (sleepy ? 1.1 : 2)) * (sleepy ? 0.03 : 0.06);
      let spin = 0;
      let tilt = still ? 0 : Math.sin(t * 0.9) * 0.04;
      if (st.state === 'happy' && age < 1.1 && !still) {
        y += Math.abs(Math.sin(age * Math.PI * 2.2)) * 0.28 * (1 - age / 1.1);
        spin = Math.min(1, age / 0.9) * Math.PI * 2;
      }
      if ((st.state === 'oops' || st.state === 'confused') && age < 0.8 && !still) tilt += Math.sin(age * 18) * 0.18 * (1 - age / 0.8);
      if (st.state === 'confused') tilt += 0.12;
      rig.position.y = y;
      rig.rotation.y = spin;
      rig.rotation.z = tilt;
      glow.material.opacity = 0.45 - y * 0.8;
      const wave = st.state === 'happy' && age < 1.4 ? Math.sin(age * 14) * 0.6 : Math.sin(t * 1.6) * 0.06;
      arms[0].rotation.z = -0.15 - (st.state === 'happy' ? 1.6 + wave * 0.3 : 0);
      arms[1].rotation.z = 0.15 + (st.state === 'happy' ? 1.6 - wave * 0.3 : wave);
    },
  };
}
