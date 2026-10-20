/*
 * Life.py game: the title screen, the world map, missions on a stage with
 * characters and a dialogue box, Pip's console (the code editor), reactions,
 * hints, XP and stars, memories and the tester results page.
 */
(function () {
  'use strict';

  const C = window.LifePyContent;
  const Py = window.PyMini;
  const Art = window.LifePyArt;
  const esc = Art.esc;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  // Escapes text and shows anything between backticks in code font.
  const fmt = (s) => esc(s).replace(/`([^`]+)`/g, '<code class="inline">$1</code>');
  // Plain text for reading aloud and for the AI helper.
  const plain = (s) => String(s).replace(/`/g, '');

  // ---------- saved progress (stays in this browser) ----------

  const STORE_KEY = 'lifepy.v1';

  function blankState() {
    return {
      profile: null,
      done: {},
      points: 0,
      badges: [],
      rules: [],
      streak: { last: null, count: 0 },
      stats: {},
      stars: {},
      votes: {},
      notes: '',
      settings: { sound: true, voice: false, gfx: 'full', allOpen: false },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const s = Object.assign(blankState(), saved);
        s.settings = Object.assign(blankState().settings, saved.settings || {});
        return s;
      }
    } catch (e) { /* storage unavailable: play without saving */ }
    return blankState();
  }

  let S = loadState();

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  let X = null;
  function refreshContext() {
    X = S.profile ? C.makeContext(S.profile.name, S.profile.pack) : C.makeContext('friend', 'westafrica');
  }
  refreshContext();

  function stat(id) {
    if (!S.stats[id]) S.stats[id] = { runs: 0, errors: 0, hints: 0, asked: 0, ms: 0, done: false };
    return S.stats[id];
  }

  let L = null; // the lesson being played
  let runToken = 0;

  // ---------- sound and voice ----------

  const Sound = (() => {
    let ctx = null;
    function audio() {
      if (!ctx) {
        const A = window.AudioContext || window.webkitAudioContext;
        if (!A) return null;
        ctx = new A();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function tone(freq, start, dur, gain) {
      const a = audio();
      if (!a) return;
      const o = a.createOscillator();
      const g = a.createGain();
      const t0 = a.currentTime + start;
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain || 0.07, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    const SOUNDS = {
      tap: () => tone(660, 0, 0.05, 0.03),
      good: () => { tone(659, 0, 0.16); tone(880, 0.1, 0.24); },
      bad: () => { tone(294, 0, 0.18, 0.05); tone(262, 0.12, 0.24, 0.05); },
      done: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.28, 0.06)),
    };
    return {
      play(name) {
        if (!S.settings.sound) return;
        try { SOUNDS[name] && SOUNDS[name](); } catch (e) { /* ignore */ }
      },
    };
  })();

  const Voice = {
    say(text) {
      if (!('speechSynthesis' in window)) return;
      try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) { /* ignore */ }
    },
    stop() {
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
  };

  // ---------- optional AI helper (only inside claude.ai) ----------

  let sample = null;
  (async () => {
    try {
      if (window.claude && typeof window.claude.use === 'function') sample = await window.claude.use('sample');
    } catch (e) {
      sample = null;
    }
  })();

  // ---------- screens ----------

  const SCREENS = ['welcome', 'name', 'place', 'story', 'home', 'lesson', 'done', 'album', 'notebook', 'settings', 'results'];
  let currentScreen = null;

  function show(name) {
    Voice.stop();
    cancelRun();
    SCREENS.forEach((s) => { $('#screen-' + s).hidden = s !== name; });
    currentScreen = name;
    if (name !== 'home') stopMap3D();
    if (W3 && !SCREENS_3D.has(name)) { try { W3.unmount(); } catch (e) { /* ignore */ } }
    window.scrollTo(0, 0);
  }

  function go(name) {
    if (name === 'home') return openHome();
    if (name === 'welcome') { renderTitle(); return show('welcome'); }
    if (name === 'settings') { renderSettings(); return show('settings'); }
    if (name === 'album') { renderAlbum(); show('album'); fillSnaps($('#album-list')); return undefined; }
    if (name === 'name') {
      $('#player-name').value = draft.name;
      updateNameButton();
      show('name');
      const live = backdrop($('#screen-name .backdrop'), 'name', { show: true, x: 0, bottom: 0.5, size: 0.3, maxW: 0.42, state: 'happy' });
      $('#name-pip').hidden = live;
      if (!live) $('#name-pip').innerHTML = Art.pip('happy');
      return undefined;
    }
    if (name === 'place') {
      renderPlaces('#place-list', draft.pack, true);
      $('#place-next').disabled = !draft.pack;
      show('place');
      showPreview(draft.pack);
      return undefined;
    }
    return show(name);
  }

  function fillIcons(root) {
    $$('[data-icon]', root).forEach((el) => { el.outerHTML = Art.icon(el.dataset.icon); });
  }

  function fillScenes(root) {
    $$('[data-scene]', root).forEach((el) => { if (!el.firstChild) el.innerHTML = Art.scene(el.dataset.scene); });
  }

  // ---------- the 3D world (painted scenes when a device can't run it) ----------

  const W3 = window.LifePyWorld || null;
  const SCREENS_3D = new Set(['welcome', 'name', 'place', 'home', 'lesson', 'done']);
  const SHOT_FOR_SCENE = { home: 'home', kitchen: 'kitchen', park: 'park', classroom: 'classroom', schoolyard: 'schoolyard' };
  let w3ok = null;

  function use3D() {
    if (w3ok === null) w3ok = !!(W3 && W3.supported());
    return w3ok && S.settings.gfx !== 'simple';
  }

  // Any 3D failure switches to painted scenes for the rest of the visit.
  function w3(fn) {
    if (!use3D()) return false;
    try {
      fn();
      return true;
    } catch (e) {
      w3ok = false;
      try { W3.unmount(); } catch (e2) { /* ignore */ }
      return false;
    }
  }

  const regionNow = () => (S.profile && S.profile.pack) || draft.pack || 'westafrica';

  // A screen's backdrop: the live world, or a painting of the same place.
  function backdrop(el, shot, pip, region) {
    const painted = ['kitchen', 'park', 'classroom', 'schoolyard'].includes(shot) ? shot : 'home';
    const ok = w3(() => {
      // The painting stays underneath until the 3D view has drawn its first frame.
      if (!el.querySelector('svg.scene')) el.insertAdjacentHTML('beforeend', Art.scene(painted));
      W3.mount(el);
      W3.show(region || regionNow(), shot);
      W3.setPip(pip || { show: false });
    });
    if (!ok) el.innerHTML = Art.scene(painted);
    return ok;
  }

  // The place picker shows the home you'd grow up in, in 3D.
  function showPreview(pack) {
    const box = $('#place-preview');
    if (!use3D()) { box.hidden = true; return; }
    box.hidden = false;
    box.classList.add('loading');
    setTimeout(() => {
      if (currentScreen !== 'place') return;
      const ok = w3(() => {
        W3.mount(box);
        W3.show(pack || 'westafrica', 'hero');
        W3.setPip({ show: false });
      });
      box.classList.remove('loading');
      if (!ok) box.hidden = true;
    }, 60);
  }

  // Photos for memories, drawn from the 3D world one at a time.
  async function fillSnaps(root) {
    for (const c of $$('canvas.snap:not([data-done])', root)) {
      c.dataset.done = '1';
      const box = c.parentElement;
      const w = Math.max(120, box.clientWidth);
      const h = Math.max(90, box.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const lv = C.LEVELS[c.dataset.snap];
      const n = Math.min(2, (lv.cast || []).length);
      const ok = w3(() => {
        const img = W3.snapshot(regionNow(), SHOT_FOR_SCENE[lv.scene] || 'home', Math.round(w * dpr), Math.round(h * dpr),
          { show: true, x: n === 1 ? 0.48 : 0, bottom: 0.03, size: 0.5, maxW: 0.34, state: c.dataset.mood === 'happy' ? 'happy' : 'idle' });
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
      });
      if (!ok) {
        c.insertAdjacentHTML('afterend', Art.scene(lv.scene) + `<div class="pip-spot">${Art.pip(c.dataset.mood === 'happy' ? 'happy' : 'idle')}</div>`);
        c.remove();
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  // ---------- the map in 3D: your road through life ----------

  let mapHook = null;
  const mapState = { x: 0, nodes: [], max: 480 };

  // Each chapter's missions sit in a row on the road, outside the places they
  // happen: home, then Grandma's house and the park, then the school.
  const CHAPTER_ROAD = { c1: [-14, 5.6], c2: [36, 9.2], c3: [170, 7.4] };

  function missionSpots(info) {
    const spots = {};
    for (const ch of C.CHAPTERS) {
      if (!ch.levels) continue;
      const [x0, step] = CHAPTER_ROAD[ch.id] || [170 + (ch.n - 3) * 60, 7];
      ch.levels.forEach((id, i) => { spots[id] = { x: x0 + step * i, z: info.roadZ }; });
    }
    return spots;
  }

  const SIGN_X = { c1: [0, 11.5, 2], c2: [44, 8.5, 2], c3: [205, 13, 62], c4: [222, 13, 62], c5: [270, 18, 66], c6: [330, 40, -40], c7: [404, 10, 40], c8: [470, 26, 10] };

  function renderMap3D() {
    const region = regionNow();
    const ok = w3(() => W3.mount($('#map3d')));
    if (!ok) return false;
    $('#map3d').hidden = false;
    $('#map-wrap').hidden = true;
    let info;
    if (!w3(() => { info = W3.mapInfo(region); })) return false;
    const spots = missionSpots(info);
    const next = nextLessonId();
    const nodes = allLevels().map((id) => {
      const state = missionState(id, next);
      const stars = S.stars[id] || 1;
      const label = `Mission ${lessonNumber(id)}: ${C.LEVELS[id].title}${state === 'done' ? `, ${stars} of 3 stars` : state === 'locked' ? ', locked' : ''}`;
      const sp = spots[id];
      return `<button class="node ${state}" type="button" data-wx="${sp.x}" data-wy="1.3" data-wz="${sp.z}" data-mission="${id}" aria-label="${esc(label)}" ${state === 'locked' ? 'disabled' : ''}>
        <span class="node-disc">${state === 'done' ? Art.icon('check') : state === 'locked' ? Art.icon('lock') : lessonNumber(id)}</span>
        ${state === 'done' ? starsHTML(stars, 'mini') : ''}</button>`;
    }).join('');
    const signs = C.CHAPTERS.map((ch) => {
      const [x, y, z] = SIGN_X[ch.id] || [0, 10, 0];
      return `<div class="sign${ch.locked ? ' locked' : ''}" data-wx="${x}" data-wy="${y}" data-wz="${z}"><b>${ch.n}. ${esc(ch.title)}</b><span>${ch.locked ? 'Coming soon' : esc(ch.age)}</span></div>`;
    }).join('');
    $('#map-nodes').innerHTML = signs + nodes;
    mapState.nodes = $$('#map-nodes [data-wx]').map((el) => ({ el, x: +el.dataset.wx, y: +el.dataset.wy, z: +el.dataset.wz, sign: el.classList.contains('sign'), off: null }));
    const focus = next || allLevels().slice(-1)[0];
    mapState.x = spots[focus].x;
    mapState.max = SIGN_X.c8[0];
    w3(() => {
      W3.mapFocus(region, mapState.x, { instant: true });
      W3.setMarkers(allLevels().map((id) => ({ x: spots[id].x, z: spots[id].z, state: missionState(id, next) })));
    });
    stopMap3D();
    mapHook = W3.onFrame(placeMapNodes);
    placeMapNodes();
    return true;
  }

  function placeMapNodes() {
    const box = $('#map3d');
    const w = box.clientWidth;
    const h = box.clientHeight;
    for (const n of mapState.nodes) {
      const p = W3.project(n.x, n.y, n.z);
      const q = W3.project(n.x, n.y + 1, n.z);
      const off = !p || p.behind || p.x < -80 || p.x > w + 80 || p.y < 70 || p.y > h - 70;
      if (off !== n.off) { n.el.hidden = off; n.off = off; }
      if (off) continue;
      const sc = Math.max(0.42, Math.min(1.1, (p.y - q.y) / (n.sign ? 22 : 30)));
      n.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${sc.toFixed(3)})`;
      n.el.style.zIndex = String(Math.round(p.y));
    }
  }

  function stopMap3D() {
    if (mapHook) { mapHook(); mapHook = null; }
  }

  function panMap(dx) {
    mapState.x = Math.max(-24, Math.min(mapState.max, mapState.x + dx));
    w3(() => W3.mapFocus(regionNow(), mapState.x));
  }

  // ---------- characters ----------

  const PEOPLE = ['mum', 'grandma', 'uncle', 'cousin', 'f1', 'f2', 'f3', 'f4', 'teacher'];
  const SPEAKER_KIND = { pip: 'pip', mum: 'family', grandma: 'family', uncle: 'family', cousin: 'family', f1: 'friend', f2: 'friend', f3: 'friend', f4: 'friend', teacher: 'teacher' };

  function nameOf(who) {
    switch (who) {
      case 'pip': return 'Pip';
      case 'mum': return X.P.mum;
      case 'grandma': return X.P.grandma;
      case 'uncle': return X.P.uncle;
      case 'cousin': return X.P.cousin;
      case 'f1': return X.f(1);
      case 'f2': return X.f(2);
      case 'f3': return X.f(3);
      case 'f4': return X.f(4);
      case 'teacher': return X.P.teacher;
      default: return '';
    }
  }

  // One or two people share the stage with Pip: the first on the left, the second on the right.
  // Each looks towards the middle of the stage.
  const positions = (n) => (n === 1 ? ['left'] : ['left', 'right']);

  function actorHTML(who, pos, expr) {
    return `<div class="actor-wrap pos-${pos}" data-who="${who}">${Art.portrait(X.P.looks[who], { look: pos === 'right' ? -1 : 1, expr: expr || 'neutral' })}</div>`;
  }

  // A still picture of a mission's place and people, for the map and the album.
  function miniStage(id, mood) {
    const lv = C.LEVELS[id];
    const cast = (lv.cast || []).slice(0, 2);
    const pos = positions(cast.length);
    const people = cast.map((w, i) => actorHTML(w, pos[i], mood)).join('');
    if (use3D()) return `<div class="stagebox mini" data-cast="${cast.length}"><canvas class="snap" data-snap="${id}" data-mood="${mood}"></canvas>${people}</div>`;
    return `<div class="stagebox mini" data-cast="${cast.length}">${Art.scene(lv.scene)}${people}<div class="pip-spot">${Art.pip(mood === 'happy' ? 'happy' : 'idle')}</div></div>`;
  }

  function polaroid(id, tilt) {
    return `<figure class="polaroid" style="--tilt:${tilt == null ? -1.5 : tilt}deg">${miniStage(id, 'happy')}<figcaption>${esc(X.t(C.LEVELS[id].memory || ''))}</figcaption></figure>`;
  }

  // ---------- title screen and first visit ----------

  const draft = { name: '', pack: null };

  function renderTitle() {
    const live = backdrop($('#title-scene'), 'title');
    $('#screen-welcome').classList.toggle('live', live);
    $('#hero-pip').innerHTML = Art.pip('happy');
    const P = C.PACKS;
    $('#title-cast').innerHTML = `<div class="tc tc-left">${Art.portrait(P.westafrica.looks.mum, { expr: 'smile', look: 1 })}</div>` +
      `<div class="tc tc-right">${Art.portrait(P.ukus.looks.f2, { expr: 'smile', look: -1 })}</div>`;
  }

  function updateNameButton() {
    $('#name-next').disabled = !$('#player-name').value.trim();
  }

  function choiceButton(value, selected, inner, disabled) {
    return `<button class="choice" type="button" role="radio" aria-checked="${selected ? 'true' : 'false'}" data-value="${esc(value)}" ${disabled ? 'disabled' : ''}>${inner}</button>`;
  }

  // With faces, each hometown shows the player's mum from there.
  function renderPlaces(sel, selected, faces) {
    $(sel).innerHTML = Object.values(C.PACKS).map((p) => choiceButton(p.id, p.id === selected,
      `${faces ? `<span class="place-face" aria-hidden="true">${Art.portrait(p.looks.mum, { expr: 'smile' })}</span>` : ''}<span class="choice-text"><b>${esc(p.label)}</b><span>${esc(p.places)}</span></span>`)).join('');
    if (faces) $$('.choice', $(sel)).forEach((b) => b.classList.add('place'));
  }

  function renderStoryChoices() {
    $('#story-list').innerHTML = C.STORIES.map((s) => choiceButton(s.id, s.ready,
      `<span class="story-icon">${Art.icon(s.icon)}</span><span class="choice-text"><b>${esc(s.title)}</b><span>${esc(s.tagline)}</span></span>${s.ready ? '' : '<span class="tag">Coming soon</span>'}`,
      !s.ready)).join('');
  }

  function selectIn(container, btn) {
    $$('.choice', container).forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    Sound.play('tap');
  }

  function finishOnboarding() {
    S.profile = { name: draft.name, pack: draft.pack || 'westafrica' };
    persist();
    refreshContext();
    startLesson('c1l1');
  }

  // ---------- XP, levels and stars ----------

  const XP_PER_LEVEL = 100;

  function levelOf(xp) {
    const into = xp % XP_PER_LEVEL;
    return { level: 1 + Math.floor(xp / XP_PER_LEVEL), into, pct: Math.round((into / XP_PER_LEVEL) * 100) };
  }

  // Three stars for a clean run. Each hint (or shown answer) counts as two mistakes.
  function starsFor(mistakes, hints) {
    const cost = mistakes + hints * 2;
    return cost <= 1 ? 3 : cost <= 4 ? 2 : 1;
  }

  function starsHTML(n, cls) {
    return `<span class="stars${cls ? ' ' + cls : ''}" role="img" aria-label="${n} of 3 stars">${[1, 2, 3].map((i) => `<span class="star${i <= n ? ' on' : ''}" style="--i:${i}">${Art.icon('star')}</span>`).join('')}</span>`;
  }

  // ---------- the world map ----------

  function allLevels() {
    return C.CHAPTERS.filter((c) => !c.locked).flatMap((c) => c.levels);
  }

  function chapterOf(id) {
    return C.CHAPTERS.find((c) => c.levels && c.levels.includes(id));
  }

  function lessonNumber(id) {
    const ch = chapterOf(id);
    return ch.levels.indexOf(id) + 1;
  }

  // done, current (the next one to play), open (testers can play it early) or locked.
  function missionState(id, next) {
    if (S.done[id]) return 'done';
    if (id === next) return 'current';
    return S.settings.allOpen ? 'open' : 'locked';
  }

  // The first chapter that isn't built yet, for "coming soon" messages.
  function comingNext() {
    const ch = C.CHAPTERS.find((c) => c.locked);
    return ch ? `Chapter ${ch.n}, ${ch.title},` : 'More';
  }

  function nextLessonId() {
    return allLevels().find((id) => !S.done[id]) || null;
  }

  function openHome() {
    if (!S.profile) { renderTitle(); show('welcome'); return; }
    show('home');
    renderHome();
    if (!$('#map3d').hidden) return;
    const focus = $('.node.current') || $(`.node[data-mission="${allLevels().slice(-1)[0]}"]`);
    if (focus) focus.scrollIntoView({ block: 'center' });
  }

  function renderHome() {
    const lv = levelOf(S.points);
    const streak = S.streak.count || 0;
    $('#hud-level').textContent = String(lv.level);
    $('#hud-level').setAttribute('aria-label', `Level ${lv.level}`);
    $('#hud-name').textContent = S.profile.name;
    $('#hud-xp').style.width = lv.pct + '%';
    $('#hud-sub').textContent = `Level ${lv.level} · ${S.points} XP${streak ? ` · ${streak}-day streak` : ''}`;

    if (!renderMap3D()) renderMapSVG();
    renderMapBar();
  }

  function renderMapSVG() {
    $('#map3d').hidden = true;
    $('#map-wrap').hidden = false;
    const m = Art.worldMap(C.CHAPTERS.map((ch) => ({ id: ch.id, n: ch.n, locked: !!ch.locked, levels: ch.levels || [] })));
    const next = nextLessonId();
    const at = (x, y) => `left:${((x / 400) * 100).toFixed(2)}%;top:${((y / m.height) * 100).toFixed(2)}%`;
    const nodes = m.nodes.map((nd) => {
      const id = nd.id;
      const state = missionState(id, next);
      const stars = S.stars[id] || 1;
      const label = `Mission ${lessonNumber(id)}: ${C.LEVELS[id].title}${state === 'done' ? `, ${stars} of 3 stars` : state === 'locked' ? ', locked' : ''}`;
      return `<button class="node ${state}" type="button" style="${at(nd.x, nd.y)}" data-mission="${id}" aria-label="${esc(label)}" ${state === 'locked' ? 'disabled' : ''}>
        <span class="node-disc">${state === 'done' ? Art.icon('check') : state === 'locked' ? Art.icon('lock') : lessonNumber(id)}</span>
        ${state === 'done' ? starsHTML(stars, 'mini') : ''}${state === 'current' ? `<span class="node-pip" aria-hidden="true">${Art.pip('happy')}</span>` : ''}</button>`;
    }).join('');
    const signs = m.marks.map((mk) => {
      const ch = C.CHAPTERS.find((c) => c.id === mk.ch.id);
      return `<div class="sign${mk.locked ? ' locked' : ''}" style="${at(mk.x, mk.y + 22)}"><b>${ch.n}. ${esc(ch.title)}</b><span>${mk.locked ? 'Coming soon' : esc(ch.age)}</span></div>`;
    }).join('');
    const map = $('#map');
    map.style.aspectRatio = `400 / ${m.height}`;
    map.innerHTML = m.svg + signs + nodes;
  }

  function renderMapBar() {
    const next = nextLessonId();
    if (next) {
      const ch = chapterOf(next);
      $('#map-bar').innerHTML = `<div class="map-next">
        <div class="map-next-text"><span class="eyebrow">${S.done[allLevels()[0]] ? 'Next mission' : 'Your first mission'} · Chapter ${ch.n}</span><b>${esc(C.LEVELS[next].title)}</b></div>
        <button class="btn primary" type="button" data-start="${next}">${Art.icon('play')}Play</button></div>`;
    } else {
      $('#map-bar').innerHTML = `<div class="map-next">
        <div class="map-next-text"><span class="eyebrow">Every mission done</span><b>${esc(comingNext())} is coming soon</b></div>
        <button class="btn quiet" type="button" data-go="album">${Art.icon('album')}Memories</button></div>`;
    }
  }

  function openSheet(id) {
    const lv = C.LEVELS[id];
    const ch = chapterOf(id);
    const done = !!S.done[id];
    const sheet = $('#sheet');
    sheet.innerHTML = `<div class="sheet-inner">
      ${done ? polaroid(id, -1) : `<div class="sheet-scene">${miniStage(id, 'smile')}</div>`}
      <p class="eyebrow">Chapter ${ch.n} · ${esc(ch.title)} · Mission ${lessonNumber(id)}</p>
      <h2 id="sheet-title">${esc(lv.title)}</h2>
      ${done ? starsHTML(S.stars[id] || 1) : `<p class="muted">${esc(X.t(ch.blurb))}</p>`}
      <div class="bar-buttons"><button class="btn quiet" type="button" data-close-sheet>Close</button><button class="btn primary" type="button" data-start="${id}">${done ? 'Play again' : 'Play'}</button></div></div>`;
    sheet.hidden = false;
    $('#sheet-shade').hidden = false;
    $('[data-start]', sheet).focus();
    fillSnaps(sheet);
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    $('#sheet-shade').hidden = true;
  }

  // ---------- code highlighting ----------

  const KEYWORDS = new Set(['for', 'in', 'if', 'elif', 'else', 'while', 'and', 'or', 'not', 'is', 'True', 'False', 'None', 'break', 'continue', 'pass', 'def', 'return', 'import', 'from', 'class', 'lambda', 'try', 'except', 'with', 'as']);
  const FUNCS = new Set(['print', 'range', 'len', 'str', 'int', 'float', 'abs', 'round', 'max', 'min', 'sum', 'sorted', 'list', 'type', 'input', 'repr', 'bool']);

  function segments(code) {
    const out = [];
    const n = code.length;
    let i = 0;
    const push = (text, cls) => out.push({ text, cls });
    while (i < n) {
      const c = code[i];
      if (c === '#') {
        let j = code.indexOf('\n', i);
        if (j < 0) j = n;
        push(code.slice(i, j), 't-com');
        i = j;
        continue;
      }
      const prefix = /^[fFrRuU]{1,2}(?=["'])/.exec(code.slice(i, i + 3));
      if (c === '"' || c === "'" || (prefix && !/\w/.test(code[i - 1] || ''))) {
        let j = i + (prefix && c !== '"' && c !== "'" ? prefix[0].length : 0);
        const q = code[j];
        const triple = code.slice(j, j + 3) === q + q + q;
        j += triple ? 3 : 1;
        while (j < n) {
          if (code[j] === '\\') { j += 2; continue; }
          if (!triple && code[j] === '\n') break;
          if (triple ? code.slice(j, j + 3) === q + q + q : code[j] === q) { j += triple ? 3 : 1; break; }
          j++;
        }
        j = Math.min(j, n);
        push(code.slice(i, j), 't-str');
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i;
        while (j < n && /[0-9._a-zA-Z]/.test(code[j])) j++;
        push(code.slice(i, j), 't-num');
        i = j;
        continue;
      }
      if (/[\p{L}_]/u.test(c)) {
        let j = i;
        while (j < n && /[\p{L}\p{N}_]/u.test(code[j])) j++;
        const w = code.slice(i, j);
        push(w, KEYWORDS.has(w) ? 't-kw' : FUNCS.has(w) ? 't-fn' : 't-name');
        i = j;
        continue;
      }
      if ('()[]{}'.includes(c)) { push(c, 't-br'); i++; continue; }
      if (c === '\n') { push('\n', null); i++; continue; }
      if (c === ' ' || c === '\t') {
        let j = i;
        while (j < n && (code[j] === ' ' || code[j] === '\t')) j++;
        push(code.slice(i, j), null);
        i = j;
        continue;
      }
      push(c, 't-op');
      i++;
    }
    return out;
  }

  function toLines(segs) {
    const lines = [[]];
    for (const s of segs) {
      s.text.split('\n').forEach((part, k) => {
        if (k > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ text: part, cls: s.cls, ghost: s.ghost });
      });
    }
    return lines;
  }

  function lineHTML(line) {
    return line.map((sg) => {
      const cls = [sg.cls, sg.ghost ? 'ghost-text' : null].filter(Boolean).join(' ');
      return cls ? `<span class="${cls}">${esc(sg.text)}</span>` : esc(sg.text);
    }).join('');
  }

  function codeHTML(code, errLine) {
    return toLines(segments(code)).map((ln, i) => `<span class="ln${errLine === i + 1 ? ' is-error' : ''}">${lineHTML(ln)}</span>`).join('');
  }

  function tokenClass(tok) {
    if (tok === '"' || tok === "'") return 't-str';
    if ('()[]'.includes(tok)) return 't-br';
    if (FUNCS.has(tok)) return 't-fn';
    if (KEYWORDS.has(tok)) return 't-kw';
    if (/^\d+$/.test(tok)) return 't-num';
    if (/^[=+\-*/%<>:]+$/.test(tok)) return 't-op';
    return null;
  }

  // ---------- the editor ----------

  const SMART = /[“”„‟″‘’‚‛′ ]/g;
  const SMART_MAP = { '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"', '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", ' ': ' ' };

  // Phones swap " for curly quotes and add no-break spaces; Python can't read those.
  function straighten(el) {
    if (!SMART.test(el.value)) return;
    SMART.lastIndex = 0;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = el.value.replace(SMART, (c) => SMART_MAP[c]);
    try { el.setSelectionRange(start, end); } catch (e) { /* ignore */ }
  }

  class Editor {
    constructor(host, opts) {
      this.ghost = opts.ghost || null;
      this.onChange = opts.onChange || (() => {});
      this.errLine = null;
      host.innerHTML = `<div class="editor">
        <div class="gutter" aria-hidden="true"></div>
        <div class="code-scroll"><div class="code-layer">
          <pre class="hl" aria-hidden="true"></pre>
          <textarea id="code-input" class="code-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Your Python code"></textarea>
        </div></div>
      </div>
      <div class="guide" hidden>Pip's guide<pre></pre></div>`;
      this.ta = $('textarea', host);
      this.hl = $('pre.hl', host);
      this.gutter = $('.gutter', host);
      this.guide = $('.guide', host);
      this.ta.value = opts.value || '';
      this.ta.addEventListener('input', () => {
        straighten(this.ta);
        this.errLine = null;
        this.render();
        this.onChange();
      });
      this.ta.addEventListener('keydown', (e) => this.keydown(e));
      this.render();
    }

    get value() { return this.ta.value; }

    set value(v) {
      this.ta.value = v;
      this.errLine = null;
      this.render();
      this.onChange();
    }

    keydown(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        mainAction();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) this.dedent();
        else this.insert('    ');
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const v = this.ta.value;
        const pos = this.ta.selectionStart;
        const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
        const line = v.slice(lineStart, pos);
        let indent = (/^[ \t]*/.exec(line) || [''])[0];
        if (/:\s*$/.test(line)) indent += '    ';
        this.insert('\n' + indent);
      }
    }

    insert(text) {
      const ta = this.ta;
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }

    dedent() {
      const ta = this.ta;
      const v = ta.value;
      const pos = ta.selectionStart;
      const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
      const spaces = (/^ {1,4}/.exec(v.slice(lineStart)) || [''])[0].length;
      if (!spaces) return;
      ta.setRangeText('', lineStart, lineStart + spaces, 'preserve');
      ta.setSelectionRange(Math.max(lineStart, pos - spaces), Math.max(lineStart, pos - spaces));
      ta.dispatchEvent(new Event('input'));
    }

    // The next character the guide expects, if the player is following it.
    nextExpected() {
      if (!this.ghost) return null;
      const v = this.ta.value;
      if (!this.ghost.startsWith(v) || v.length >= this.ghost.length) return null;
      const ch = this.ghost[v.length];
      const lineStart = v.lastIndexOf('\n') + 1;
      if (ch === ' ' && /^ *$/.test(v.slice(lineStart))) return 'indent';
      return ch;
    }

    render() {
      const v = this.ta.value;
      let segs = segments(v);
      let following = false;
      if (this.ghost && this.ghost.startsWith(v)) {
        following = true;
        let pos = 0;
        const rest = [];
        for (const s of segments(this.ghost)) {
          const end = pos + s.text.length;
          if (end > v.length) rest.push({ text: s.text.slice(Math.max(0, v.length - pos)), cls: s.cls, ghost: true });
          pos = end;
        }
        segs = segs.concat(rest);
      }
      const lines = toLines(segs);
      this.hl.innerHTML = lines.map((ln, i) => `<span class="ln${this.errLine === i + 1 ? ' is-error' : ''}">${lineHTML(ln)}</span>`).join('');
      this.gutter.innerHTML = lines.map((_, i) => `<span class="${this.errLine === i + 1 ? 'is-error' : ''}">${i + 1}</span>`).join('');
      if (this.ghost) {
        this.guide.hidden = following;
        $('pre', this.guide).innerHTML = codeHTML(this.ghost);
      }
      const next = this.nextExpected();
      $$('#keys button').forEach((b) => b.classList.toggle('next', !!next && b.dataset.key === next));
    }

    setError(line) {
      this.errLine = line || null;
      this.render();
    }

    focus() {
      try { this.ta.focus({ preventScroll: true }); } catch (e) { this.ta.focus(); }
    }
  }

  // ---------- missions ----------

  // Every story line is its own step, so the story plays out one line per tap.
  function buildSteps(level) {
    const steps = [];
    level.rounds.forEach((r, i) => {
      (r.say || []).forEach((line, j) => steps.push({ kind: 'line', round: i, line: j }));
      steps.push({ kind: r.mode === 'explain' ? 'explain' : 'task', round: i });
    });
    return steps;
  }

  function startLesson(id) {
    const level = C.LEVELS[id];
    if (!level) return;
    closeSheet();
    const st = stat(id);
    L = {
      id,
      level,
      chapter: chapterOf(id),
      steps: buildSteps(level),
      step: 0,
      t0: Date.now(),
      points: 0,
      awarded: new Set(),
      e0: st.errors,
      h0: st.hints,
      actors: {},
      castKey: null,
    };
    show('lesson');
    $('#mission-name').textContent = `Mission ${lessonNumber(id)} · ${level.title}`;
    setXpChip();
    buildStage();
    renderStep();
  }

  // ---------- the stage: a painted place, the people in it, and Pip ----------

  function buildStage() {
    const live = use3D();
    $('#stage').innerHTML = `${Art.scene(L.level.scene || 'home')}<div class="cast" id="cast"></div>
      <div class="pip-spot" id="pip-spot"${live ? ' hidden' : ''}>${Art.pip('idle')}</div>
      <div class="bubble" id="bubble" hidden><pre class="screen-out" id="screen-out"></pre></div>
      <div class="mission-card" aria-hidden="true"><span>Chapter ${L.chapter.n} · ${esc(L.chapter.age)}</span><b>${esc(L.level.title)}</b></div>`;
    L.actors = {};
    L.castKey = null;
    L.live = live && w3(() => {
      W3.mount($('#stage'));
      W3.show(regionNow(), SHOT_FOR_SCENE[L.level.scene] || 'home', { instant: true });
    });
    if (live && !L.live) $('#pip-spot').hidden = false;
  }

  // Pip stands where the painted Pip would: centre stage, or right when one person is with it.
  function place3DPip() {
    if (!L || !L.live) return;
    const n = Number($('#stage').dataset.cast || 0);
    w3(() => W3.setPip({ show: true, x: n === 1 ? 0.48 : 0, bottom: 0.03, size: n === 0 ? 0.6 : 0.5, maxW: n === 0 ? 0.4 : 0.34 }));
  }

  function castFor(R, speaker) {
    let list = (R.cast || L.level.cast || []).slice();
    if (PEOPLE.includes(speaker) && !list.includes(speaker)) list = [speaker].concat(list);
    return list.slice(0, 2);
  }

  // People who stay on stage keep their place; newcomers walk in from the side.
  function setCast(list) {
    const key = list.join(',');
    if (L.castKey === key) return;
    L.castKey = key;
    const pos = positions(list.length);
    const next = {};
    list.forEach((who, i) => {
      const k = `${who}@${pos[i]}`;
      if (L.actors[k]) { next[k] = L.actors[k]; return; }
      const tmp = document.createElement('div');
      tmp.innerHTML = actorHTML(who, pos[i]);
      const el = tmp.firstElementChild;
      el.classList.add('entering');
      $('#cast').appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('entering')));
      next[k] = el;
    });
    Object.keys(L.actors).forEach((k) => {
      if (next[k]) return;
      const el = L.actors[k];
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 400);
    });
    L.actors = next;
    $('#stage').dataset.cast = String(list.length);
    place3DPip();
  }

  function express(expr, who) {
    Object.values(L.actors).forEach((el) => {
      if (who && el.dataset.who !== who) return;
      const svg = $('svg.actor', el);
      if (svg) svg.dataset.expr = expr;
    });
  }

  let calmTimer = null;

  // Everyone on stage reacts; after a moment a big reaction settles down.
  function react(expr, pipState, settle) {
    clearTimeout(calmTimer);
    express(expr);
    setPip(pipState);
    if (settle) calmTimer = setTimeout(() => { if (L) express(settle); }, 1800);
  }

  function setSpeaker(who) {
    Object.values(L.actors).forEach((el) => {
      const me = el.dataset.who === who;
      el.classList.toggle('speaking', me);
      el.classList.toggle('dim', PEOPLE.includes(who) && !me);
    });
    $('#pip-spot').classList.toggle('speaking', who === 'pip');
  }

  function setPip(state) {
    const svg = $('#pip-spot svg');
    if (svg) svg.dataset.state = state;
    if (L && L.live) w3(() => W3.pipState(state));
  }

  function sayLine(who, text) {
    const box = $('#dialogue');
    box.className = `dialogue ${who === 'task' ? 'is-task' : who === 'narrator' ? 'is-narrator' : 'is-' + (SPEAKER_KIND[who] || 'pip')}`;
    const tag = $('#speaker');
    tag.textContent = who === 'task' ? 'Your move' : nameOf(who);
    tag.hidden = who === 'narrator';
    const p = $('#dialogue-text');
    p.innerHTML = fmt(text);
    p.classList.remove('enter');
    void p.offsetWidth;
    p.classList.add('enter');
    L.spoken = plain(text);
  }

  // Pip's speech bubble shows what the code printed.
  function hideBubble() {
    const b = $('#bubble');
    if (!b) return;
    b.hidden = true;
    $('#screen-out').innerHTML = '';
  }

  function lookAtStage() {
    const top = $('#stage').getBoundingClientRect().top;
    const hud = $('.mission-hud').offsetHeight;
    if (top < hud || top > window.innerHeight * 0.45) {
      window.scrollTo({ top: Math.max(0, window.scrollY + top - hud - 8), behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  function setXpChip(gained) {
    $('#mission-xp b').textContent = String(L.points);
    if (gained) {
      $('#stage').insertAdjacentHTML('beforeend', `<span class="xp-pop">+${gained} XP</span>`);
      const pop = $('#stage .xp-pop:last-child');
      setTimeout(() => pop.remove(), 1500);
    }
  }

  function sparkle() {
    if (reducedMotion()) return;
    const bits = Array.from({ length: 9 }, (_, i) => `<i style="--a:${i * 40}deg;--d:${(i % 3) * 0.08}s"></i>`).join('');
    $('#pip-spot').insertAdjacentHTML('beforeend', `<span class="sparkles" aria-hidden="true">${bits}</span>`);
    const s = $('#pip-spot .sparkles:last-child');
    setTimeout(() => s.remove(), 1200);
  }

  // ---------- steps ----------

  function setProgress() {
    const pct = Math.round((L.step / L.steps.length) * 100);
    const bar = $('#lesson-progress');
    $('span', bar).style.width = pct + '%';
    bar.setAttribute('aria-valuenow', String(pct));
  }

  function setMain(label, action, disabled) {
    const b = $('#btn-main');
    b.textContent = label;
    b.disabled = !!disabled;
    L.main = action;
  }

  function mainAction() {
    if (!L || currentScreen !== 'lesson') return;
    const b = $('#btn-main');
    if (b.disabled || !L.main) return;
    L.main();
  }

  function setHintButton(visible) {
    $('#btn-hint').hidden = !visible;
  }

  function renderStep() {
    cancelRun();
    clearFeedback();
    clearTimeout(calmTimer);
    const st = L.steps[L.step];
    const R = L.level.rounds[st.round];
    Object.assign(L, { R, kind: st.kind, solved: false, hintIdx: 0, hintsThisStep: 0, editor: null, choice: null, tiles: null, placed: [], lastResult: null });
    setProgress();
    setHintButton(false);
    hideBubble();
    if (L.step > 0) $$('#stage .mission-card').forEach((el) => el.remove());
    const line = st.kind === 'line' ? R.say[st.line] : null;
    setCast(castFor(R, line && line.who));
    if (line) renderLine(R, line);
    else if (st.kind === 'explain') renderExplain(R);
    else renderTask(R);
    window.scrollTo(0, 0);
  }

  function nextStep() {
    if (L.step < L.steps.length - 1) {
      L.step++;
      renderStep();
    } else {
      completeLesson();
    }
  }

  // Story lines use the big stage; explanations and tasks make room for Pip's console.
  function setLayout(story) {
    $('#stage').dataset.size = story ? 'story' : 'task';
    $('.mission-main').classList.toggle('is-story', story);
  }

  function renderLine(R, line) {
    setLayout(true);
    $('#lesson-body').innerHTML = '';
    express('neutral');
    setPip(R.pip || 'idle');
    if (PEOPLE.includes(line.who)) express('smile', line.who);
    if (line.who === 'pip') {
      setPip('talk');
      const step = L.step;
      calmTimer = setTimeout(() => { if (L && L.step === step) setPip('idle'); }, 1600);
    }
    setSpeaker(line.who);
    sayLine(line.who, X.t(line.text));
    if (S.settings.voice) Voice.say(L.spoken);
    setMain('Continue', nextStep);
  }

  // Colour each piece the way the editor would colour that part of the code.
  function pieceClasses(code, pieces) {
    const chars = [];
    for (const s of segments(code)) for (const ch of s.text) if (!/\s/.test(ch)) chars.push(s.cls);
    let at = 0;
    return pieces.map((p) => {
      const cls = chars[at];
      at += p.replace(/\s/g, '').length;
      return cls || 't-name';
    });
  }

  function renderExplain(R) {
    setLayout(false);
    express('neutral');
    setPip('idle');
    setSpeaker('pip');
    sayLine('pip', X.t(R.title));
    const texts = R.pieces.map(([text]) => X.t(text));
    const classes = pieceClasses(X.t(R.code), texts);
    const pieces = R.pieces.map(([, meaning], i) => `<div class="piece"><code class="${classes[i]}">${esc(texts[i])}</code><span>${esc(meaning)}</span></div>`).join('');
    $('#lesson-body').innerHTML = `<div class="code-card"><div class="code-tab">${esc(L.chapter.file)}</div><div class="pieces">${pieces}</div></div>
      <p class="step-text">${fmt(X.t(R.text))}</p>`;
    setMain('Continue', nextStep);
  }

  function keysFor(R) {
    const target = X.t(R.answer || R.ghost || '');
    const keys = ['(', ')', '"', ':', '=', '+', '-'].filter((k) => target.includes(k));
    if (/\n {4}/.test(target)) keys.push('indent');
    return keys.length ? keys : ['(', ')', '"'];
  }

  function renderTask(R) {
    const mode = R.mode;
    const body = $('#lesson-body');
    setLayout(false);
    express('neutral');
    setPip(R.pip || 'idle');
    setSpeaker(null);
    const asks = mode === 'predict' || mode === 'choice';
    sayLine('task', `${X.t(R.task || '')}${asks ? ` ${X.t(R.question)}` : ''}`);
    const card = (inner) => `<div class="code-card"><div class="code-tab">${esc(L.chapter.file)}</div><div class="code-host" id="code-host">${inner}</div></div>`;
    const jars = L.level.showJars ? '<div class="jars" id="jars" hidden></div>' : '';

    if (mode === 'choice') {
      body.innerHTML = `${R.context ? card(`<pre class="code-view">${codeHTML(X.t(R.context))}</pre>`) : ''}
        <div class="options" role="radiogroup" aria-labelledby="dialogue-text">${R.options.map((o, i) => choiceButton(i, false,
          o.code ? `<code>${codeHTML(X.t(o.code))}</code><span class="mark"></span>` : `<span class="choice-text"><b>${esc(X.t(o.text))}</b></span><span class="mark"></span>`)).join('')}</div>`;
      $$('.options .choice', body).forEach((b) => b.classList.add('option'));
      setMain('Check', checkChoice, true);
      return;
    }

    if (mode === 'predict') {
      body.innerHTML = `${card(`<pre class="code-view">${codeHTML(X.t(R.code))}</pre>`)}
        <div class="options" role="radiogroup" aria-labelledby="dialogue-text">${R.options.map((o, i) => choiceButton(i, false,
          `<span class="screen-lines">${C.optionLines(o).map((l) => esc(X.t(l))).join('\n')}</span><span class="mark"></span>`)).join('')}</div>${jars}`;
      $$('.options .choice', body).forEach((b) => b.classList.add('option'));
      setMain('Check', checkPredict, true);
      return;
    }

    const typing = ['fix', 'guided', 'free'].includes(mode);
    body.innerHTML = `${card('')}
      ${mode === 'build' ? '<div class="tray" id="tray" aria-label="Pieces"></div>' : ''}
      ${typing ? `<div class="keys" id="keys">${keysFor(R).map((k) => (k === 'indent'
        ? '<button type="button" class="word" data-key="indent">push in ⇥</button>'
        : `<button type="button" data-key="${esc(k)}" aria-label="Type ${esc(k)}">${esc(k)}</button>`)).join('')}</div>` : ''}
      <div class="plain"><span class="plain-label">In plain words</span><ol id="plain-list"></ol></div>${jars}`;

    const host = $('#code-host');
    if (mode === 'watch') {
      host.innerHTML = `<pre class="code-view">${codeHTML(X.t(R.code))}</pre>`;
    } else if (mode === 'change') {
      renderChange(R, host);
    } else if (mode === 'build') {
      L.tiles = shuffledTiles(R);
      renderBuild();
    } else {
      L.editor = new Editor(host, {
        value: X.t(R.code || ''),
        ghost: mode === 'guided' ? X.t(R.ghost) : null,
        onChange: scheduleTranslation,
      });
      $$('#keys button').forEach((b) => {
        b.addEventListener('pointerdown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          L.editor.focus();
          L.editor.insert(b.dataset.key === 'indent' ? '    ' : b.dataset.key);
          Sound.play('tap');
        });
      });
      L.editor.render();
    }
    updateTranslation();
    setMain('Run', runCode);
    setHintButton(mode !== 'watch');
  }

  function fillTemplate(template, values) {
    let i = 0;
    return template.replace(/\[\[(.*?)\]\]/g, (m, def) => {
      const v = values && values[i] !== undefined ? values[i] : def;
      i++;
      return v;
    });
  }

  function renderChange(R, host) {
    const template = X.t(R.code);
    const defaults = [];
    template.replace(/\[\[(.*?)\]\]/g, (m, d) => { defaults.push(d); return m; });
    const full = fillTemplate(template, defaults);
    // Where each slot sits in the full code, so highlighting stays correct around it.
    const ranges = [];
    let offset = 0;
    let slot = 0;
    template.replace(/\[\[(.*?)\]\]/g, (m, d, idx) => {
      const start = idx - offset;
      ranges.push({ start, end: start + d.length, slot: slot++ });
      offset += m.length - d.length;
      return m;
    });
    const lines = [[]];
    let pos = 0;
    for (const s of segments(full)) {
      for (let k = 0; k < s.text.length; k++) {
        const ch = s.text[k];
        const at = pos + k;
        if (ch === '\n') { lines.push([]); continue; }
        const ln = lines[lines.length - 1];
        const r = ranges.find((rg) => at >= rg.start && at < rg.end);
        if (r) {
          if (at === r.start) ln.push({ input: r.slot });
          continue;
        }
        const last = ln[ln.length - 1];
        if (last && !('input' in last) && last.cls === s.cls) last.text += ch;
        else ln.push({ text: ch, cls: s.cls });
      }
      pos += s.text.length;
    }
    host.innerHTML = `<pre class="code-view">${lines.map((ln) => `<span class="ln">${ln.map((p) => {
      if ('input' in p) {
        const v = defaults[p.input];
        return `<input class="slot" id="slot-${p.input}" value="${esc(v)}" style="width:${Math.max(2, v.length + 1)}ch" aria-label="Change this part" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">`;
      }
      return p.cls ? `<span class="${p.cls}">${esc(p.text)}</span>` : esc(p.text);
    }).join('')}</span>`).join('')}</pre>`;
    $$('.slot', host).forEach((inp) => {
      inp.addEventListener('input', () => {
        straighten(inp);
        inp.style.width = Math.max(2, inp.value.length + 1) + 'ch';
        scheduleTranslation();
      });
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); mainAction(); }
      });
    });
  }

  // Seeded shuffle that never leaves the tiles already in the right order.
  function shuffledTiles(R) {
    const tiles = R.tiles.map((t, i) => {
      const [text, meaning] = Array.isArray(t) ? t : [t, null];
      return { i, text: X.t(text), meaning };
    });
    const solution = R.solution.map(X.t);
    let seed = 7;
    for (const ch of L.id + L.step) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const order = tiles.slice();
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    if (order.slice(0, solution.length).every((t, k) => t.text === solution[k])) order.push(order.shift());
    return order;
  }

  function tileMeaning(t) {
    if (t.meaning) return t.meaning;
    if (t.text === 'print') return 'show';
    if (t.text === '(') return 'start';
    if (t.text === ')') return 'finish';
    if (t.text === '"') return 'quote';
    if (/^\d+$/.test(t.text)) return 'number';
    return 'words';
  }

  function renderBuild() {
    const R = L.R;
    const parts = R.code ? X.t(R.code).split('{{BUILD}}') : ['', ''];
    const above = parts[0].replace(/\n$/, '');
    const below = (parts[1] || '').replace(/^\n/, '');
    const placed = L.placed.map((i) => L.tiles.find((t) => t.i === i));
    const tray = L.tiles.filter((t) => !L.placed.includes(t.i));
    const tile = (t, where) => `<button class="tile ${tokenClass(t.text) || 't-words'}" type="button" data-tile="${t.i}" data-where="${where}">
      <span class="tile-code">${esc(t.text)}</span><span class="tile-mean">${esc(tileMeaning(t))}</span></button>`;
    $('#code-host').innerHTML = `${above ? `<pre class="code-view context">${codeHTML(above)}</pre>` : ''}
      <div class="build-line" aria-label="Your line">${placed.length ? placed.map((t) => tile(t, 'line')).join('') : '<span class="build-hint">Tap the pieces below</span>'}</div>
      ${below ? `<pre class="code-view context">${codeHTML(below)}</pre>` : ''}`;
    $('#tray').innerHTML = tray.map((t) => tile(t, 'tray')).join('');
    $$('#code-host .tile, #tray .tile').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.tile);
      if (b.dataset.where === 'tray') L.placed.push(i);
      else L.placed = L.placed.filter((x) => x !== i);
      Sound.play('tap');
      clearFeedback();
      restoreRunButton();
      renderBuild();
      scheduleTranslation();
    }));
  }

  function currentCode() {
    const R = L.R;
    switch (R.mode) {
      case 'watch':
      case 'predict':
        return X.t(R.code);
      case 'change': return fillTemplate(X.t(R.code), $$('#code-host .slot').map((i) => i.value));
      case 'build': {
        const line = C.joinTiles(L.placed.map((i) => L.tiles.find((t) => t.i === i).text));
        return R.code ? X.t(R.code).replace('{{BUILD}}', line) : line;
      }
      default: return L.editor ? L.editor.value : '';
    }
  }

  // ---------- plain words, Pip's jars and Pip's speech bubble ----------

  let transTimer = null;
  function scheduleTranslation() {
    clearTimeout(transTimer);
    transTimer = setTimeout(updateTranslation, 120);
  }

  function updateTranslation() {
    const list = $('#plain-list');
    if (!L || !list) return;
    let code = currentCode();
    // While the player follows Pip's guide, explain the line they're heading for.
    if (L.R.mode === 'guided' && L.editor && L.editor.ghost && L.editor.ghost.startsWith(code)) code = L.editor.ghost;
    const items = Py.explain(code).map((row) => {
      if (!row) return '';
      return `<li style="--depth:${row.depth}">${row.text ? esc(row.text) : '<span class="cant">Pip can\'t read this line yet</span>'}</li>`;
    }).join('');
    list.innerHTML = items || `<li>${L.R.mode === 'build' ? 'Build the line to see what it means.' : 'Start typing to see what your code means.'}</li>`;
  }

  const jarValue = (v) => (Array.isArray(v) ? JSON.stringify(v) : String(v));

  function showJars(r) {
    const box = $('#jars');
    if (!box || !L.level.showJars) return;
    const names = Object.keys(r.vars);
    box.hidden = !names.length;
    box.innerHTML = names.length
      ? `<span class="jars-label">Pip's jars</span>${names.map((n) => `<div class="jar"><div class="jar-glass"><span>${esc(jarValue(r.vars[n]))}</span></div><b>${esc(n)}</b></div>`).join('')}`
      : '';
  }

  async function playOutput(r) {
    const bubble = $('#bubble');
    const out = $('#screen-out');
    bubble.hidden = false;
    bubble.classList.remove('is-error');
    out.innerHTML = '';
    lookAtStage();
    setPip('talk');
    const token = runToken;
    const per = reducedMotion() ? 30 : r.lines.length > 12 ? 120 : 320;
    for (let i = 0; i < r.lines.length && i < 400; i++) {
      if (token !== runToken) return false;
      out.insertAdjacentHTML('beforeend', `<span>${esc(r.lines[i]) || '&nbsp;'}</span>\n`);
      out.scrollTop = out.scrollHeight;
      await wait(per);
    }
    if (token !== runToken) return false;
    if (r.error) {
      bubble.classList.add('is-error');
      out.insertAdjacentHTML('beforeend', `<span class="err">Pip got stuck${r.error.line ? ` on line ${r.error.line}` : ''}.</span>`);
      out.scrollTop = out.scrollHeight;
    } else if (!r.lines.length) {
      out.innerHTML = '<span class="empty">Pip didn\'t show anything.</span>';
    }
    return true;
  }

  function cancelRun() {
    runToken++;
    if (L) L.running = false;
  }

  // ---------- running code and checking answers ----------

  async function runCode() {
    if (!L || L.running) return;
    const R = L.R;
    if (R.mode === 'build' && !L.placed.length) {
      feedback({ kind: 'hint', title: 'Nothing to run yet', text: 'Tap the pieces to build the line first.' });
      setMain('Got it', () => { clearFeedback(); restoreRunButton(); });
      return;
    }
    const code = currentCode();
    const r = Py.run(code);
    const st = stat(L.id);
    st.runs++;
    persist();
    L.running = true;
    runToken++;
    clearFeedback();
    $('#btn-main').disabled = true;
    if (L.editor) L.editor.setError(null);
    clearTimeout(calmTimer);
    express('neutral');
    const finished = await playOutput(r);
    if (!finished) return;
    L.running = false;
    showJars(r);
    L.lastResult = r;
    evaluate(r, code);
  }

  function evaluate(r, code) {
    const st = stat(L.id);
    if (r.error) {
      st.errors++;
      persist();
      const rx = reaction(r.error);
      react('worried', rx.pip);
      Sound.play('bad');
      if (L.editor) L.editor.setError(r.error.line);
      else $$('#code-host .ln').forEach((el, i) => el.classList.toggle('is-error', r.error.line === i + 1));
      feedback({ kind: 'bad', pip: rx.pip, title: rx.title, text: rx.text, err: r.error });
      setMain('Try again', retry);
      setHintButton(true);
      return;
    }
    const res = L.R.check ? L.R.check(r, Object.assign({}, X, { code })) : { ok: true };
    if (!res.ok) {
      st.errors++;
      persist();
      react('worried', 'confused');
      Sound.play('bad');
      feedback({ kind: 'bad', pip: 'confused', title: 'Not quite', text: X.t(res.msg || 'That isn\'t what Pip needed.') });
      setMain('Try again', retry);
      setHintButton(true);
      return;
    }
    succeed(res.win || L.R.win);
  }

  function retry() {
    clearFeedback();
    restoreRunButton();
    react('neutral', 'idle');
    if (L.editor) L.editor.focus();
    else {
      const slot = $('#slot-0');
      if (slot) slot.focus();
    }
  }

  function restoreRunButton() {
    if (!L || L.kind !== 'task') return;
    if (L.R.mode === 'choice') setMain('Check', checkChoice, L.choice === null);
    else if (L.R.mode === 'predict') setMain('Check', checkPredict, L.choice === null);
    else setMain('Run', runCode);
    setHintButton(!['watch', 'choice', 'predict'].includes(L.R.mode));
  }

  function award() {
    // XP only the first time a step is solved.
    if (L.awarded.has(L.step)) return 0;
    L.awarded.add(L.step);
    const pts = 10 + (L.hintsThisStep ? 0 : 5);
    S.points += pts;
    L.points += pts;
    setXpChip(pts);
    return pts;
  }

  function succeed(winText) {
    const R = L.R;
    L.solved = true;
    award();
    if (R.learn && R.learn.term === 'Rule') {
      const text = X.t(R.learn.text);
      if (!S.rules.includes(text)) S.rules.push(text);
    }
    persist();
    react('happy', 'happy', 'smile');
    sparkle();
    Sound.play('good');
    feedback({
      kind: 'good',
      pip: 'happy',
      title: X.t(winText || 'Well done!'),
      learn: R.learn ? { term: X.t(R.learn.term), text: X.t(R.learn.text) } : null,
    });
    setMain('Continue', nextStep);
    setHintButton(false);
  }

  function selectedOption() {
    const b = $('.options .choice[aria-checked="true"]');
    return b ? Number(b.dataset.value) : null;
  }

  function lockOptions(right, wrong) {
    $$('.options .choice').forEach((b) => {
      const i = Number(b.dataset.value);
      b.disabled = true;
      if (i === right) { b.classList.add('right'); $('.mark', b).innerHTML = Art.icon('check'); }
      if (i === wrong) b.classList.add('wrong');
    });
  }

  function unlockOptions() {
    $$('.options .choice').forEach((b) => {
      b.disabled = false;
      b.classList.remove('right', 'wrong');
      b.setAttribute('aria-checked', 'false');
      $('.mark', b).innerHTML = '';
    });
    L.choice = null;
  }

  function checkChoice() {
    const R = L.R;
    const pick = selectedOption();
    if (pick === null) return;
    stat(L.id).runs++;
    if (pick === R.answer) {
      lockOptions(R.answer, null);
      succeed(R.win);
      return;
    }
    stat(L.id).errors++;
    persist();
    lockOptions(null, pick);
    react('worried', 'confused');
    Sound.play('bad');
    feedback({ kind: 'bad', pip: 'confused', title: 'Not quite', text: X.t(R.why[pick]) });
    setMain('Try again', () => { clearFeedback(); unlockOptions(); restoreRunButton(); react('neutral', 'idle'); });
  }

  async function checkPredict() {
    const R = L.R;
    const pick = selectedOption();
    if (pick === null || L.running) return;
    const st = stat(L.id);
    st.runs++;
    L.running = true;
    runToken++;
    $('#btn-main').disabled = true;
    lockOptions(null, null);
    const r = Py.run(X.t(R.code));
    const finished = await playOutput(r);
    if (!finished) return;
    L.running = false;
    showJars(r);
    if (pick === R.answer) {
      lockOptions(R.answer, null);
      succeed(R.win);
      return;
    }
    st.errors++;
    persist();
    lockOptions(R.answer, pick);
    react('surprised', 'confused', 'neutral');
    Sound.play('bad');
    feedback({ kind: 'bad', pip: 'confused', title: 'Not quite, but now you know', text: X.t(R.why[pick]) });
    setMain('Continue', nextStep);
  }

  // Pip's reaction to an error: which face, what to say. Short and plain.
  function reaction(err) {
    const m = err.message || '';
    const t = err.type;
    const line = err.line;
    const onLine = line ? ` on line ${line}` : '';
    if (err.kind === 'unsupported') return { pip: 'confused', title: 'Pip hasn\'t learned that yet', text: `That's real Python, but this early version only knows the basics. Try it the way the lesson shows.` };
    if (err.kind === 'toolong') return { pip: 'oops', title: 'Pip got dizzy', text: 'Your code kept going and going, so Pip stopped it. Check how many times it repeats.' };
    if (err.kind === 'internal') return { pip: 'confused', title: 'Pip tripped', text: 'That\'s Pip\'s fault, not yours. Try again, or tap Hint.' };
    if (t === 'SyntaxError' && /^unterminated (triple-quoted )?(f-)?string literal/.test(m)) return { pip: 'oops', title: 'A quote mark is missing', text: `Words start with \`"\` and must end with \`"\`${onLine}. Add the missing \`"\` after the words.` };
    if (/was never closed/.test(m)) return { pip: 'oops', title: 'A bracket is missing', text: `Every \`(\` needs a \`)\` to close it. Add a \`)\`${onLine}.` };
    if (/^unmatched/.test(m)) return { pip: 'confused', title: 'There\'s an extra `)`', text: `Pip found a \`)\` with no \`(\` before it${onLine}. Remove the extra \`)\`.` };
    if (/does not match opening parenthesis/.test(m)) return { pip: 'confused', title: 'The brackets don\'t match', text: 'A `(` must be closed with a `)`, not a `]` or `}`.' };
    if (/Missing parentheses in call to 'print'/.test(m)) return { pip: 'confused', title: '`print` needs brackets', text: 'Put what Pip should show inside `( )`, like `print("Hello")`.' };
    if (/Perhaps you forgot a comma/.test(m)) return { pip: 'confused', title: 'Two things side by side', text: `Words should all be inside one pair of quote marks${onLine}.` };
    if (m === "expected ':'") return { pip: 'confused', title: 'A colon is missing', text: `Line ${line} needs a \`:\` at the very end.` };
    if (t === 'IndentationError' && /expected an indented block/.test(m)) return { pip: 'confused', title: 'Push the line in', text: 'The line under a loop must start with 4 spaces. Tap "push in".' };
    if (m === 'unexpected indent') return { pip: 'confused', title: 'Extra spaces at the start', text: `Line ${line} starts with spaces but doesn't belong to a loop. Remove them.` };
    if (/unindent does not match/.test(m)) return { pip: 'confused', title: 'The lines don\'t line up', text: `The spaces at the start of line ${line} don't match the lines above. Use 4 spaces.` };
    if (/^cannot assign to/.test(m)) return { pip: 'confused', title: 'The label goes first', text: 'Put the jar\'s label on the left of `=`, like `sweets = 5`.' };
    if (/Maybe you meant '==' or ':='/.test(m)) return { pip: 'confused', title: 'One = or two?', text: 'To compare things, use `==`. One `=` puts something into a jar.' };
    if (/invalid (non-printable )?character/.test(m)) return { pip: 'confused', title: 'A symbol Pip can\'t read', text: `Something${onLine} isn't part of Python. Delete it and type it again.` };
    if (/leading zeros/.test(m)) return { pip: 'confused', title: 'Numbers can\'t start with 0', text: 'Write `5`, not `05`.' };
    if (/invalid decimal literal/.test(m)) return { pip: 'confused', title: 'Numbers and letters stuck together', text: 'A jar label must start with a letter, and numbers can\'t contain letters.' };
    if (t === 'NameError') {
      const name = err.name || (/name '(.+?)'/.exec(m) || [])[1] || '';
      const sug = err.suggestion;
      if (sug && sug.toLowerCase() === name.toLowerCase()) return { pip: 'confused', title: 'Capital letters matter', text: `Python reads \`${name}\` and \`${sug}\` as different words. Use \`${sug}\`.` };
      if (sug) return { pip: 'confused', title: `Did you mean \`${sug}\`?`, text: `Pip doesn't know the word \`${name}\`. Check the spelling.` };
      return { pip: 'confused', title: `Pip doesn't know \`${name}\``, text: `If you meant those words, put quote marks around them: \`"${name}"\`. If it's a jar, check its label.` };
    }
    if (t === 'TypeError' && /can only concatenate str/.test(m)) return { pip: 'confused', title: 'Words and numbers don\'t mix', text: 'Use a comma instead of `+`, like `print("I am", 6)`.' };
    if (t === 'TypeError' && /unsupported operand/.test(m)) return { pip: 'confused', title: 'Those don\'t mix', text: 'Pip can\'t do maths with words. Numbers don\'t need quote marks.' };
    if (t === 'IndexError') return { pip: 'confused', title: 'Nobody at that position', text: 'The list isn\'t that long. Positions start at 0, so the last one is one less than the length.' };
    if (t === 'AttributeError') return { pip: 'confused', title: 'Pip doesn\'t know that word after the dot', text: 'Check the spelling after the `.`, like `.append`.' };
    if (t === 'ZeroDivisionError') return { pip: 'oops', title: 'Sharing with nobody?', text: 'You can\'t share between 0 friends. Use a number bigger than 0.' };
    if (t === 'SyntaxError') return { pip: 'confused', title: 'Pip can\'t read this line', text: `Something${onLine} is out of place. Check that every \`(\` has a \`)\` and every \`"\` has a partner.` };
    return { pip: 'confused', title: 'Something went wrong', text: 'Read Python\'s message below, or tap Hint.' };
  }

  // ---------- feedback in the bottom bar ----------

  function feedback(f) {
    const bar = $('#lesson-bar');
    bar.classList.remove('good', 'bad', 'hint');
    bar.classList.add(f.kind);
    const box = $('#feedback');
    box.innerHTML = `<div class="fb-row">${f.pip ? `<span class="fb-pip">${Art.pip(f.pip)}</span>` : ''}<div><h3>${fmt(f.title)}</h3>${f.text ? `<p>${fmt(f.text)}</p>` : ''}</div></div>
      ${f.err ? `<p class="py-msg"><span>What Python says</span><code>${esc(f.err.text)}</code></p>` : ''}
      ${f.learn ? `<div class="learn"><span class="learn-label">Remember</span><p>${fmt(f.learn.text)}</p></div>` : ''}
      ${f.html || ''}`;
    box.hidden = false;
    if (f.kind === 'good' || f.kind === 'bad') $('#btn-main').focus({ preventScroll: true });
  }

  function clearFeedback() {
    $('#lesson-bar').classList.remove('good', 'bad', 'hint');
    $('#feedback').hidden = true;
    $('#feedback').innerHTML = '';
  }

  // ---------- hints ----------

  function showHint() {
    if (!L || L.kind !== 'task') return;
    const hints = (L.R.hints || []).map(X.t);
    const st = stat(L.id);
    let title;
    let text;
    if (L.hintIdx < hints.length) {
      st.hints++;
      L.hintsThisStep++;
      persist();
      title = hints.length > 1 ? `Hint ${L.hintIdx + 1} of ${hints.length}` : 'Hint';
      text = hints[L.hintIdx];
      L.hintIdx++;
    } else {
      title = 'That\'s every hint';
      text = 'Want to see the answer?';
    }
    const more = L.hintIdx < hints.length;
    feedback({
      kind: 'hint',
      pip: 'idle',
      title,
      text,
      html: `<div class="fb-actions">
        ${more ? '<button class="link" type="button" id="fb-more">Another hint</button>' : '<button class="link" type="button" id="fb-answer">Show me the answer</button>'}
        ${sample ? '<button class="link" type="button" id="fb-ask">Ask Pip a question</button>' : ''}</div>`,
    });
    const moreBtn = $('#fb-more');
    if (moreBtn) moreBtn.addEventListener('click', showHint);
    const ans = $('#fb-answer');
    if (ans) ans.addEventListener('click', showAnswer);
    const ask = $('#fb-ask');
    if (ask) ask.addEventListener('click', openAsk);
    setMain('Got it', () => { clearFeedback(); restoreRunButton(); });
    setHintButton(false);
  }

  function showAnswer() {
    const R = L.R;
    stat(L.id).hints++;
    L.hintsThisStep++;
    persist();
    const done = (text, html) => {
      feedback({ kind: 'hint', pip: 'idle', title: 'Here\'s the answer', text, html });
      setMain('Got it', () => { clearFeedback(); restoreRunButton(); });
    };
    if (R.mode === 'build') {
      const used = [];
      L.placed = R.solution.map(X.t).map((text) => {
        const t = L.tiles.find((tile) => tile.text === text && !used.includes(tile.i));
        used.push(t.i);
        return t.i;
      });
      renderBuild();
      updateTranslation();
      done('Pip put the pieces in order. Read them, then tap Run.');
      return;
    }
    if (R.mode === 'change') {
      (R.fill || []).forEach((v, i) => {
        const inp = $('#slot-' + i);
        if (inp) {
          inp.value = X.t(v);
          inp.style.width = Math.max(2, inp.value.length + 1) + 'ch';
        }
      });
      updateTranslation();
      done('Pip filled it in. Tap Run.');
      return;
    }
    const answer = X.t(R.answer || R.ghost || '');
    done('Type it yourself, or let Pip put it in for you.', `<pre class="answer-code">${codeHTML(answer)}</pre>
      <div class="fb-actions"><button class="link" type="button" id="fb-use">Put it in for me</button></div>`);
    $('#fb-use').addEventListener('click', () => {
      L.editor.value = answer;
      clearFeedback();
      restoreRunButton();
      L.editor.focus();
    });
  }

  // ---------- Ask Pip (AI, only on claude.ai) ----------

  function openAsk() {
    feedback({
      kind: 'hint',
      pip: 'idle',
      title: 'Ask Pip',
      html: `<form class="ask" id="ask-form">
        <label for="ask-q">What are you stuck on? You can leave this empty.</label>
        <div class="ask-row"><input id="ask-q" type="text" maxlength="200" placeholder="I don't understand…" autocomplete="off"><button class="btn quiet" type="submit">Ask</button></div>
        <div class="ask-answer" id="ask-answer" hidden></div></form>`,
    });
    $('#ask-form').addEventListener('submit', (e) => {
      e.preventDefault();
      askPip($('#ask-q').value.trim());
    });
    $('#ask-q').focus();
  }

  async function askPip(question) {
    const out = $('#ask-answer');
    out.hidden = false;
    out.innerHTML = `${Art.pip('idle')}<p class="muted">Pip is thinking…</p>`;
    stat(L.id).asked++;
    persist();
    const code = currentCode();
    const r = Py.run(code);
    const happened = r.error ? `Python said: ${r.error.text}` : r.lines.length ? `Pip showed: ${r.lines.join(' / ')}` : 'Nothing was shown.';
    const prompt = [
      'You are Pip, a small friendly robot in "Life.py", a story game that teaches Python to people who have never written code. The player is stuck and asked you for help.',
      '',
      'Rules for your reply:',
      '- At most 2 short sentences in simple everyday words. Plain text, no markdown.',
      '- Give one hint that moves them a step forward. Never write out the full corrected code.',
      '- Avoid the words string, function, syntax, variable, argument and indentation. Say "words in quote marks", "the jar" and "pushed-in lines" instead.',
      '- Be warm and calm.',
      '',
      `Their goal: ${plain(X.t(L.R.task || ''))}`,
      'Their code right now:',
      code || '(empty)',
      `If they tap Run: ${happened}`,
      `They ask: ${question || 'I\'m stuck. Can you help?'}`,
    ].join('\n');
    try {
      const res = await sample(prompt, {
        modelTier: 'quick',
        cache: false,
        onText: ({ text }) => { out.innerHTML = `${Art.pip('happy')}<p>${esc(text)}</p>`; },
      });
      out.innerHTML = `${Art.pip('happy')}<p>${esc(res.text)}</p>`;
    } catch (e) {
      if (e && e.code === 'not_granted') {
        sample = null;
        out.innerHTML = '<p>Pip can\'t answer questions here. Try a hint instead.</p>';
      } else if (e && e.code === 'rate_limited') {
        out.innerHTML = '<p>Pip needs a little rest. Try a hint for now.</p>';
      } else {
        out.innerHTML = '<p>Pip couldn\'t answer just now. Try a hint instead.</p>';
      }
    }
  }

  // ---------- leaving and finishing lessons ----------

  function leaveLesson() {
    if (!L || L.step === 0) { openHome(); return; }
    feedback({
      kind: 'hint',
      pip: 'idle',
      title: 'Leave this lesson?',
      text: 'You\'ll start it from the beginning next time.',
      html: '<div class="fb-actions"><button class="link" type="button" id="fb-leave">Leave the lesson</button></div>',
    });
    $('#fb-leave').addEventListener('click', openHome);
    const keep = L.main;
    const label = $('#btn-main').textContent;
    setMain('Keep going', () => {
      clearFeedback();
      if (L.solved) setMain('Continue', nextStep);
      else if (L.kind !== 'task') setMain(label, keep);
      else restoreRunButton();
    });
  }

  function todayKey(d) {
    const x = d || new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }

  function bumpStreak() {
    const today = todayKey();
    if (S.streak.last === today) return;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    S.streak.count = S.streak.last === todayKey(y) ? (S.streak.count || 0) + 1 : 1;
    S.streak.last = today;
  }

  function nextLevelAfter(id) {
    const order = allLevels();
    return order[order.indexOf(id) + 1] || null;
  }

  function doneScreen(scene, body, buttons) {
    $('#done-body').innerHTML = body;
    $('#done-buttons').innerHTML = buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : 'quiet'}" type="button" data-done="${i}">${esc(b.label)}</button>`).join('');
    $$('[data-done]').forEach((el) => el.addEventListener('click', () => buttons[Number(el.dataset.done)].action()));
    show('done');
    backdrop($('#done-scene'), SHOT_FOR_SCENE[scene] || 'home');
    fillSnaps($('#done-body'));
    const first = $('#done-buttons .primary');
    if (first) first.focus({ preventScroll: true });
  }

  function completeLesson() {
    const id = L.id;
    const st = stat(id);
    st.ms += Date.now() - L.t0;
    st.done = true;
    S.done[id] = true;
    const stars = starsFor(st.errors - L.e0, st.hints - L.h0);
    S.stars[id] = Math.max(S.stars[id] || 0, stars);
    bumpStreak();
    persist();
    Sound.play('done');
    const ch = L.chapter;
    const next = nextLevelAfter(id);
    const before = levelOf(S.points - L.points);
    const after = levelOf(S.points);
    const up = after.level > before.level;
    const card = `<div class="done-card">
        <p class="eyebrow">Mission complete</p>
        <h1>${esc(L.level.title)}</h1>
        ${starsHTML(stars, 'big')}
        ${polaroid(id)}
        <div class="xp-line">
          <span class="lv-badge">${after.level}</span>
          <div class="xp-meta"><span>${up ? `Level up! You reached level ${after.level}` : `Level ${after.level}`}</span>
            <div class="xpbar"><span style="width:${after.pct}%;--from:${up ? 0 : before.pct}%"></span></div></div>
          <b class="xp-gain">+${L.points} XP</b>
        </div>
        ${S.streak.count > 1 ? `<p class="streak">${Art.icon('flame')}${S.streak.count}-day streak</p>` : ''}
      </div>`;
    if (ch.levels[ch.levels.length - 1] === id) {
      if (!S.badges.includes(ch.badge)) S.badges.push(ch.badge);
      persist();
      const words = C.NOTEBOOK.filter((w) => w.chapter === ch.id)
        .map((w) => `<li><code>${esc(w.word)}</code> · programmers call this <b>${esc(w.jargon)}</b></li>`).join('');
      doneScreen(L.level.scene, `${card}<div class="done-card chapter-card">
          <p class="eyebrow">Chapter ${ch.n} complete · Badge: ${esc(ch.badge)}</p>
          <h2>${esc(ch.reveal.title)}</h2>
          <p>${esc(ch.reveal.text)}</p>
          <p class="muted">The things you've been using have real names:</p>
          <ul class="words">${words}</ul></div>`,
      next
        ? [{ label: 'Map', action: openHome }, { label: `Start chapter ${ch.n + 1}`, primary: true, action: () => startLesson(next) }]
        : [{ label: 'Continue', primary: true, action: endOfPrototype }]);
      return;
    }
    doneScreen(L.level.scene, card, [{ label: 'Map', action: openHome }, { label: 'Next mission', primary: true, action: () => startLesson(next) }]);
  }

  function endOfPrototype() {
    const options = C.STORIES.filter((s) => !s.ready).map((s) => choiceButton(s.id, !!S.votes[s.id],
      `${Art.icon(s.icon)}<span class="choice-text"><b>${esc(s.title)}</b></span>`)).join('');
    doneScreen('park', `<div class="done-card">
        <div class="title-pip">${Art.pip('happy')}</div>
        <h1>You finished this early version</h1>
        <p class="lede">${esc(comingNext())} is next. Which story should we build after that?</p>
        <div class="vote-row" id="vote-row">${options}</div>
        <div class="end-notes"><label class="field-label" for="end-notes">What was the hardest part?</label>
        <textarea id="end-notes" class="text-input" rows="3" placeholder="Anything that confused you">${esc(S.notes || '')}</textarea></div></div>`,
    [{ label: 'Done', primary: true, action: () => { S.notes = $('#end-notes').value.slice(0, 1000); persist(); openHome(); } }]);
    $$('#vote-row .choice').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.value;
      S.votes[id] = !S.votes[id];
      if (!S.votes[id]) delete S.votes[id];
      b.setAttribute('aria-checked', String(!!S.votes[id]));
      persist();
      Sound.play('tap');
    }));
  }

  // ---------- memories ----------

  function renderAlbum() {
    $('#album-list').innerHTML = allLevels().map((id, i) => {
      const ch = chapterOf(id);
      if (S.done[id]) return `<div class="album-item">${polaroid(id, i % 2 ? 1.2 : -1.2)}<span class="album-meta">Chapter ${ch.n} · ${esc(ch.age)}</span></div>`;
      return `<div class="album-item"><div class="photo-blank">${Art.icon('lock')}<span>${esc(C.LEVELS[id].title)}</span></div><span class="album-meta">Chapter ${ch.n} · ${esc(ch.age)}</span></div>`;
    }).join('');
  }

  // ---------- notebook ----------

  function chapterDone(chId) {
    const ch = C.CHAPTERS.find((c) => c.id === chId);
    return ch && ch.levels && ch.levels.every((l) => S.done[l]);
  }

  function renderNotebook() {
    const words = C.NOTEBOOK.filter((w) => S.done[w.unlock]);
    $('#nb-words').innerHTML = words.length
      ? words.map((w) => `<li><code>${esc(w.word)}</code><span>${esc(w.plain)}</span>${chapterDone(w.chapter)
        ? `<span class="jargon">Programmers call this ${esc(w.jargon)}.</span>`
        : '<span class="jargon">Finish the chapter to learn its real name.</span>'}</li>`).join('')
      : '<li class="empty">Finish your first lesson to start the notebook.</li>';
    $('#nb-rules').innerHTML = S.rules.length ? S.rules.map((r) => `<li>${fmt(r)}</li>`).join('') : '<li class="empty">Fix Pip\'s bugs to collect rules here.</li>';
    $('#nb-badges').innerHTML = S.badges.length ? S.badges.map((b) => `<li class="badge">${esc(b)}</li>`).join('') : '<li class="empty">Finish a chapter to earn a badge.</li>';
  }

  // ---------- settings ----------

  function renderSettings() {
    $('#set-sound').checked = !!S.settings.sound;
    $('#set-voice').checked = !!S.settings.voice;
    $('#set-gfx').checked = S.settings.gfx !== 'simple';
    $('#set-open').checked = !!S.settings.allOpen;
    $('#gfx-row').hidden = !(W3 && W3.supported());
    renderPlaces('#set-place-list', S.profile ? S.profile.pack : null);
    $('#reset-confirm').hidden = true;
  }

  function resetAll() {
    const sound = S.settings.sound;
    S = blankState();
    S.settings.sound = sound;
    persist();
    refreshContext();
    L = null;
    draft.name = '';
    draft.pack = null;
    renderTitle();
    show('welcome');
  }

  // ---------- tester results ----------

  function fmtTime(ms) {
    const s = Math.round((ms || 0) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function resultsRows() {
    return allLevels().map((id) => {
      const st = S.stats[id] || {};
      const ch = chapterOf(id);
      return { n: `${ch.n}.${lessonNumber(id)}`, title: C.LEVELS[id].title, time: st.ms ? fmtTime(st.ms) : '–', runs: st.runs || 0, errors: st.errors || 0, hints: st.hints || 0, asked: st.asked || 0, done: !!S.done[id], stars: S.stars[id] || 0 };
    });
  }

  function renderResults() {
    const rows = resultsRows();
    $('#results-who').textContent = S.profile ? `${S.profile.name} · ${C.PACKS[S.profile.pack].label}` : 'No player yet';
    $('#results-body').innerHTML = rows.map((r) => `<tr class="${r.done ? '' : 'not-done'}"><th scope="row">${r.n} ${esc(r.title)}</th><td>${r.time}</td><td>${r.runs}</td><td>${r.errors}</td><td>${r.hints}</td><td>${r.done ? r.stars : '–'}</td></tr>`).join('');
    const stuck = rows.filter((r) => r.errors >= 3 || r.hints >= 2).map((r) => `${r.n} ${r.title}`);
    $('#results-stuck').textContent = stuck.length ? `Watch these missions: ${stuck.join(', ')}.` : 'No mission has caused much trouble so far.';
    $('#results-votes').textContent = C.STORIES.filter((s) => S.votes[s.id]).map((s) => s.title).join(', ') || 'None picked yet';
    $('#results-notes').value = S.notes || '';
    $('#copy-status').textContent = '';
    $('#results-text').hidden = true;
  }

  function resultsText() {
    const rows = resultsRows();
    return [
      'Life.py playtest results',
      `Player: ${S.profile ? S.profile.name : '-'} · Hometown: ${S.profile ? C.PACKS[S.profile.pack].label : '-'} · ${new Date().toLocaleDateString()}`,
      '',
      'Mission | Time | Tries | Mistakes | Hints | Asked Pip | Stars',
      ...rows.map((r) => `${r.n} ${r.title} | ${r.time} | ${r.runs} | ${r.errors} | ${r.hints} | ${r.asked} | ${r.done ? r.stars : 'not finished'}`),
      '',
      `Stories they want next: ${C.STORIES.filter((s) => S.votes[s.id]).map((s) => s.title).join(', ') || 'none'}`,
      `Hardest part, in their words: ${S.notes || '(not filled in)'}`,
    ].join('\n');
  }

  async function copyResults() {
    const text = resultsText();
    try {
      await navigator.clipboard.writeText(text);
      $('#copy-status').textContent = 'Copied. Paste it into a message to send it.';
    } catch (e) {
      const box = $('#results-text');
      box.hidden = false;
      box.value = text;
      box.focus();
      box.select();
      $('#copy-status').textContent = 'Select all of the text below and copy it.';
    }
  }

  // ---------- wiring ----------

  function wire() {
    fillIcons(document);

    document.addEventListener('click', (e) => {
      const goBtn = e.target.closest('[data-go]');
      if (goBtn) { go(goBtn.dataset.go); return; }
      const start = e.target.closest('[data-start]');
      if (start && !start.disabled) { startLesson(start.dataset.start); return; }
      const node = e.target.closest('[data-mission]');
      if (node && !node.disabled) { openSheet(node.dataset.mission); return; }
      if (e.target.closest('[data-close-sheet], #sheet-shade')) { closeSheet(); return; }
      const opt = e.target.closest('.options .choice');
      if (opt && !opt.disabled && L) {
        selectIn(opt.parentElement, opt);
        L.choice = Number(opt.dataset.value);
        clearFeedback();
        restoreRunButton();
        return;
      }
      // Tapping the stage or the dialogue moves the story on, like a visual novel.
      if (L && currentScreen === 'lesson' && L.kind === 'line' && e.target.closest('#stage, #dialogue') && !e.target.closest('button')) mainAction();
    });

    $('#welcome-start').addEventListener('click', () => go('name'));
    $('#player-name').addEventListener('input', updateNameButton);
    $('#player-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !$('#name-next').disabled) $('#name-next').click();
    });
    $('#name-next').addEventListener('click', () => {
      draft.name = $('#player-name').value.trim().replace(/\s+/g, ' ').slice(0, 20);
      go('place');
    });
    $('#place-list').addEventListener('click', (e) => {
      const b = e.target.closest('.choice');
      if (!b) return;
      selectIn($('#place-list'), b);
      draft.pack = b.dataset.value;
      $('#place-next').disabled = false;
      showPreview(draft.pack);
    });
    $('#place-next').addEventListener('click', () => { renderStoryChoices(); show('story'); });
    $('#story-next').addEventListener('click', finishOnboarding);

    $('#btn-settings').addEventListener('click', () => go('settings'));
    // Drag the map (or scroll) to travel along the road.
    let drag = null;
    const map3d = $('#map3d');
    map3d.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.node')) return;
      drag = { y: e.clientY, x: e.clientX, from: mapState.x };
      map3d.setPointerCapture(e.pointerId);
    });
    map3d.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const d = (e.clientY - drag.y) * 0.16 + (drag.x - e.clientX) * 0.08;
      mapState.x = drag.from;
      panMap(d);
    });
    const endDrag = () => { drag = null; };
    map3d.addEventListener('pointerup', endDrag);
    map3d.addEventListener('pointercancel', endDrag);
    map3d.addEventListener('wheel', (e) => { e.preventDefault(); panMap(e.deltaY * 0.05); }, { passive: false });
    $('#btn-album').addEventListener('click', () => go('album'));
    $('#btn-notebook').addEventListener('click', () => { renderNotebook(); show('notebook'); });

    $('#lesson-close').addEventListener('click', leaveLesson);
    $('#btn-main').addEventListener('click', mainAction);
    $('#btn-hint').addEventListener('click', showHint);
    $('#btn-listen').addEventListener('click', () => { Voice.stop(); if (L && L.spoken) Voice.say(L.spoken); });

    $('#set-sound').addEventListener('change', (e) => { S.settings.sound = e.target.checked; persist(); Sound.play('tap'); });
    $('#set-voice').addEventListener('change', (e) => { S.settings.voice = e.target.checked; if (!e.target.checked) Voice.stop(); persist(); });
    $('#set-gfx').addEventListener('change', (e) => { S.settings.gfx = e.target.checked ? 'full' : 'simple'; persist(); });
    $('#set-open').addEventListener('change', (e) => { S.settings.allOpen = e.target.checked; persist(); });
    $('#set-place-list').addEventListener('click', (e) => {
      const b = e.target.closest('.choice');
      if (!b || !S.profile) return;
      selectIn($('#set-place-list'), b);
      S.profile.pack = b.dataset.value;
      persist();
      refreshContext();
    });
    $('#btn-results').addEventListener('click', () => { renderResults(); show('results'); });
    $('#btn-copy').addEventListener('click', copyResults);
    $('#results-notes').addEventListener('input', (e) => { S.notes = e.target.value.slice(0, 1000); persist(); });
    $('#btn-reset-all').addEventListener('click', () => { $('#reset-confirm').hidden = false; $('#reset-no').focus(); });
    $('#reset-no').addEventListener('click', () => { $('#reset-confirm').hidden = true; });
    $('#reset-yes').addEventListener('click', resetAll);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#sheet').hidden) { closeSheet(); return; }
      // The editor handles its own Ctrl+Enter and marks the event as handled.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && currentScreen === 'lesson' && !e.defaultPrevented) {
        e.preventDefault();
        mainAction();
      }
    });
  }

  function boot() {
    // The map scrolls to your next mission; don't let a reload put the page back at the top.
    try { history.scrollRestoration = 'manual'; } catch (e) { /* ignore */ }
    wire();
    fillScenes(document);
    // With reduced motion the 3D camera holds still and Pip stops bobbing.
    w3(() => W3.setStill(reducedMotion()));
    openHome();
  }

  // Exposed for the automated playthrough test.
  window.LifePyGame = {
    get state() { return S; },
    get lesson() { return L; },
    get world3d() { return use3D(); },
    startLesson,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
