/*
 * Life.py game: screens, the code editor, tiles, running code, Pip's reactions,
 * hints, progress and the tester results page.
 */
(function () {
  'use strict';

  const C = window.LifePyContent;
  const Py = window.PyMini;
  const Art = window.LifePyScenes;
  const esc = Art.esc;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

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
      votes: {},
      notes: '',
      settings: { sound: true, voice: false },
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
    function tone(freq, start, dur, type, gain) {
      const a = audio();
      if (!a) return;
      const o = a.createOscillator();
      const g = a.createGain();
      const t0 = a.currentTime + start;
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain || 0.1, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }
    const SOUNDS = {
      tap: () => tone(620, 0, 0.06, 'triangle', 0.05),
      blip: () => tone(880, 0, 0.07, 'sine', 0.05),
      success: () => { tone(523, 0, 0.14, 'triangle'); tone(659, 0.09, 0.14, 'triangle'); tone(784, 0.18, 0.24, 'triangle'); },
      oops: () => { tone(330, 0, 0.15, 'sawtooth', 0.04); tone(247, 0.12, 0.22, 'sawtooth', 0.04); },
      ding: () => { tone(988, 0, 0.3, 'sine', 0.09); tone(784, 0.18, 0.42, 'sine', 0.09); },
      fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.09)),
    };
    return {
      play(name) {
        if (!S.settings.sound) return;
        try { SOUNDS[name] && SOUNDS[name](); } catch (e) { /* ignore */ }
      },
    };
  })();

  const Voice = {
    say(text, opts) {
      if (!S.settings.voice || !('speechSynthesis' in window)) return;
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.rate = (opts && opts.rate) || 1;
        u.pitch = (opts && opts.pitch) || 1;
        window.speechSynthesis.speak(u);
      } catch (e) { /* ignore */ }
    },
    stop() {
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    },
  };

  let L = null; // the level being played
  let runToken = 0;

  // ---------- optional AI helper (only inside claude.ai) ----------

  let sample = null;
  (async () => {
    try {
      if (window.claude && typeof window.claude.use === 'function') sample = await window.claude.use('sample');
    } catch (e) {
      sample = null;
    }
    updateAskButton();
  })();

  function updateAskButton() {
    const b = $('#btn-ask');
    if (b) b.hidden = !sample || !L || L.R.mode === 'watch';
  }

  // ---------- screens ----------

  const SCREENS = ['title', 'stories', 'setup', 'map', 'level', 'notebook', 'results'];
  let currentScreen = 'title';
  let notebookFrom = 'map';

  function show(name) {
    Voice.stop();
    cancelRun();
    closeOverlay();
    SCREENS.forEach((s) => { $('#screen-' + s).hidden = s !== name; });
    $('#topbar').hidden = name === 'title';
    currentScreen = name;
    updateTopbar();
    window.scrollTo(0, 0);
  }

  function updateTopbar() {
    $('#stat-points').textContent = S.points;
    $('#stat-streak').textContent = S.streak.count || 0;
    $('#btn-sound').setAttribute('aria-pressed', String(!!S.settings.sound));
    $('#btn-voice').setAttribute('aria-pressed', String(!!S.settings.voice));
  }

  // ---------- title ----------

  function renderTitle() {
    $('#title-pip').innerHTML = `<div class="pip" data-state="idle">${Art.pipSVG()}</div>`;
    const cont = $('#btn-continue');
    const play = $('#btn-play');
    if (S.profile) {
      cont.hidden = false;
      cont.textContent = `Continue as ${S.profile.name}`;
      play.textContent = 'Choose a story';
      play.classList.remove('primary');
    } else {
      cont.hidden = true;
      play.textContent = 'Play';
      play.classList.add('primary');
    }
  }

  // ---------- stories ----------

  function renderStories() {
    $('#story-list').innerHTML = C.STORIES.map((st) => {
      const voted = !!S.votes[st.id];
      return `<article class="story-card ${st.ready ? 'ready' : 'soon'}">
        <div class="story-art">${Art.storyArt(st.art)}</div>
        <div class="story-body">
          <h3>${esc(st.title)}</h3>
          <p class="story-tag">${esc(st.tagline)}</p>
          <p class="story-blurb">${esc(st.blurb)}</p>
          ${st.ready
            ? `<button class="btn primary" type="button" data-story="${st.id}">Play this life</button>`
            : `<p class="soon-label">Coming soon</p><button class="btn vote" type="button" data-vote="${st.id}" aria-pressed="${voted}">${voted ? 'You want this next' : 'I\'d play this next'}</button>`}
        </div>
      </article>`;
    }).join('');
  }

  // ---------- setup ----------

  function renderSetup() {
    const name = $('#player-name');
    name.value = S.profile ? S.profile.name : '';
    const pack = S.profile ? S.profile.pack : 'westafrica';
    $('#pack-list').innerHTML = Object.values(C.PACKS).map((p) => `
      <label class="pack-option">
        <input type="radio" name="pack" value="${p.id}" ${p.id === pack ? 'checked' : ''}>
        <span class="pack-card"><b>${esc(p.label)}</b><span>${esc(p.places)}</span></span>
      </label>`).join('');
    $('#setup-voice').checked = !!S.settings.voice;
    $('#setup-error').hidden = true;
  }

  function submitSetup(ev) {
    ev.preventDefault();
    const name = $('#player-name').value.trim().replace(/\s+/g, ' ').slice(0, 20);
    if (!name) {
      $('#setup-error').hidden = false;
      $('#player-name').focus();
      return;
    }
    const pack = ($('input[name="pack"]:checked') || {}).value || 'westafrica';
    const firstTime = !S.profile;
    S.profile = { name, pack };
    S.settings.voice = $('#setup-voice').checked;
    persist();
    refreshContext();
    if (firstTime) startLevel('c1l1');
    else openMap();
  }

  // ---------- map ----------

  function allLevels() {
    return C.CHAPTERS.filter((c) => !c.locked).flatMap((c) => c.levels);
  }

  function levelStatus(id) {
    if (S.done[id]) return 'done';
    const order = allLevels();
    const firstOpen = order.find((l) => !S.done[l]);
    return id === firstOpen ? 'current' : 'locked';
  }

  function chapterOf(id) {
    return C.CHAPTERS.find((c) => c.levels && c.levels.includes(id));
  }

  function levelNumber(id) {
    const ch = chapterOf(id);
    return `${ch.n}.${ch.levels.indexOf(id) + 1}`;
  }

  const CHECK_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10.5 l3.2 3.2 L15 7" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const LOCK_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="9" width="10" height="8" rx="2" fill="currentColor"/><path d="M7 9 V7 a3 3 0 0 1 6 0 V9" stroke="currentColor" stroke-width="2" fill="none"/></svg>';

  function openMap() {
    if (!S.profile) { renderSetup(); show('setup'); return; }
    renderMap();
    show('map');
  }

  function renderMap() {
    $('#map-name').textContent = S.profile.name;
    $('#map-pack').textContent = C.PACKS[S.profile.pack].label;
    $('#map-list').innerHTML = C.CHAPTERS.map((ch) => {
      const head = `<div class="ch-head"><span class="ch-num">${ch.n}</span><div><p class="eyebrow">${esc(ch.age)}</p><h3>${esc(ch.title)}</h3></div></div>`;
      if (ch.locked) {
        return `<li class="chapter locked">${head}<p class="ch-blurb">${esc(ch.blurb)}</p><p class="soon-label">${LOCK_SVG} Coming soon</p></li>`;
      }
      const done = ch.levels.filter((l) => S.done[l]).length;
      const nodes = ch.levels.map((id, i) => {
        const st = levelStatus(id);
        const icon = st === 'done' ? CHECK_SVG : st === 'locked' ? LOCK_SVG : String(i + 1);
        return `<li><button class="node ${st}" type="button" data-level="${id}" ${st === 'locked' ? 'disabled' : ''}>
          <span class="node-dot">${icon}</span><span class="node-title">${esc(C.LEVELS[id].title)}</span>${st === 'current' ? '<span class="node-go">Play</span>' : ''}</button></li>`;
      }).join('');
      return `<li class="chapter${done === ch.levels.length ? ' complete' : ''}">${head}<p class="ch-blurb">${esc(X.t(ch.blurb))}</p>
        <p class="ch-progress">${done} of ${ch.levels.length} levels${done === ch.levels.length ? ` · Badge: ${esc(ch.badge)}` : ''}</p><ol class="nodes">${nodes}</ol></li>`;
    }).join('');
  }

  // ---------- notebook ----------

  function chapterDone(chId) {
    const ch = C.CHAPTERS.find((c) => c.id === chId);
    return ch && ch.levels && ch.levels.every((l) => S.done[l]);
  }

  function renderNotebook() {
    const words = C.NOTEBOOK.filter((w) => S.done[w.unlock] || (L && L.id === w.unlock && L.round > 0));
    $('#nb-words').innerHTML = words.length
      ? words.map((w) => `<li><code>${esc(w.word)}</code><p>${esc(w.plain)}</p>${chapterDone(w.chapter)
        ? `<p class="jargon">Programmers call this <b>${esc(w.jargon)}</b>.</p>`
        : '<p class="jargon muted">Finish the chapter to learn what programmers call this.</p>'}</li>`).join('')
      : '<li class="empty">Pip\'s notebook is empty. Play the first level to fill it.</li>';
    $('#nb-rules').innerHTML = S.rules.length
      ? S.rules.map((r) => `<li>${esc(r)}</li>`).join('')
      : '<li class="empty">Fix Pip\'s bugs to collect rules here.</li>';
    $('#nb-badges').innerHTML = S.badges.length
      ? S.badges.map((b) => `<li class="badge">${esc(b)}</li>`).join('')
      : '<li class="empty">Finish a chapter to earn a badge.</li>';
  }

  // ---------- tester results ----------

  function fmtTime(ms) {
    const s = Math.round((ms || 0) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function resultsRows() {
    return allLevels().map((id) => {
      const st = S.stats[id] || {};
      return { id, n: levelNumber(id), title: C.LEVELS[id].title, time: st.ms ? fmtTime(st.ms) : '–', runs: st.runs || 0, errors: st.errors || 0, hints: st.hints || 0, asked: st.asked || 0, done: !!S.done[id] };
    });
  }

  function renderResults() {
    const rows = resultsRows();
    $('#results-who').textContent = S.profile ? `${S.profile.name} · ${C.PACKS[S.profile.pack].label}` : 'No player yet';
    $('#results-body').innerHTML = rows.map((r) => `<tr class="${r.done ? '' : 'not-done'}"><th scope="row">${r.n} ${esc(r.title)}</th><td>${r.time}</td><td>${r.runs}</td><td>${r.errors}</td><td>${r.hints}</td><td>${r.done ? 'Yes' : 'No'}</td></tr>`).join('');
    const stuck = rows.filter((r) => r.errors >= 3 || r.hints >= 2).map((r) => `${r.n} ${r.title}`);
    $('#results-stuck').textContent = stuck.length ? `Watch these levels: ${stuck.join(', ')}.` : 'No level has caused much trouble so far.';
    $('#results-votes').textContent = Object.keys(S.votes).length
      ? C.STORIES.filter((s) => S.votes[s.id]).map((s) => s.title).join(', ')
      : 'None picked yet';
    $('#results-notes').value = S.notes || '';
    $('#reset-confirm').hidden = true;
    $('#copy-status').textContent = '';
  }

  function resultsText() {
    const rows = resultsRows();
    const lines = [
      'Life.py playtest results',
      `Player: ${S.profile ? S.profile.name : '-'} · Hometown: ${S.profile ? C.PACKS[S.profile.pack].label : '-'} · ${new Date().toLocaleDateString()}`,
      '',
      'Level | Time | Runs | Mistakes | Hints | Asked Pip | Finished',
      ...rows.map((r) => `${r.n} ${r.title} | ${r.time} | ${r.runs} | ${r.errors} | ${r.hints} | ${r.asked} | ${r.done ? 'yes' : 'no'}`),
      '',
      `Stories they'd play next: ${C.STORIES.filter((s) => S.votes[s.id]).map((s) => s.title).join(', ') || 'none'}`,
      `Hardest part, in their words: ${S.notes || '(not filled in)'}`,
    ];
    return lines.join('\n');
  }

  async function copyResults() {
    const text = resultsText();
    const status = $('#copy-status');
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied. Paste it into a message to send it.';
    } catch (e) {
      const box = $('#results-text');
      box.hidden = false;
      box.value = text;
      box.focus();
      box.select();
      status.textContent = 'Select all of the text below and copy it.';
    }
  }

  function resetAll() {
    const keep = { sound: S.settings.sound };
    S = blankState();
    S.settings.sound = keep.sound;
    persist();
    refreshContext();
    L = null;
    renderTitle();
    show('title');
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

  // Splits segments into lines; each segment can be tagged ghost.
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
      <div class="guide" hidden><span>Pip's guide</span><pre></pre></div>`;
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
        run();
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
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.setRangeText(text, start, end, 'end');
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
      if (ch === '\n') return 'enter';
      return ch;
    }

    render() {
      const v = this.ta.value;
      let segs = segments(v);
      let following = false;
      if (this.ghost && this.ghost.startsWith(v)) {
        following = true;
        const rest = segments(this.ghost);
        // Mark the part of the guide that hasn't been typed yet as ghost text.
        let pos = 0;
        const ghostSegs = [];
        for (const s of rest) {
          const end = pos + s.text.length;
          if (end > v.length) {
            const cut = Math.max(0, v.length - pos);
            ghostSegs.push({ text: s.text.slice(cut), cls: s.cls, ghost: true });
          }
          pos = end;
        }
        segs = segs.concat(ghostSegs);
      }
      const lines = toLines(segs);
      this.hl.innerHTML = lines.map((ln, i) => `<span class="ln${this.errLine === i + 1 ? ' is-error' : ''}">${lineHTML(ln)}</span>`).join('');
      this.gutter.innerHTML = lines.map((_, i) => `<span class="${this.errLine === i + 1 ? 'is-error' : ''}">${i + 1}</span>`).join('');
      if (this.ghost) {
        this.guide.hidden = following;
        $('pre', this.guide).innerHTML = codeHTML(this.ghost);
      }
      updateSymbolGlow(this.nextExpected());
    }

    setError(line) {
      this.errLine = line || null;
      this.render();
    }

    focus() {
      try { this.ta.focus({ preventScroll: true }); } catch (e) { this.ta.focus(); }
    }
  }

  function updateSymbolGlow(next) {
    $$('#symbolbar button').forEach((b) => {
      const key = b.dataset.key;
      b.classList.toggle('glow', !!next && (key === next || (next === 'indent' && key === 'indent')));
    });
  }

  // ---------- Pip and the scene ----------

  function sceneDef() {
    return Art.SCENES[L.level.scene];
  }

  function renderScene() {
    const def = sceneDef();
    $('#scene-art').innerHTML = `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(L.level.title)}">${def.render(L.scene, X)}</svg>`;
    const wrap = $('#pip-wrap');
    wrap.style.setProperty('--pip-left', def.pip.left + '%');
    wrap.style.setProperty('--pip-bottom', def.pip.bottom + '%');
    wrap.style.setProperty('--pip-width', def.pip.width + '%');
    wrap.dataset.side = def.pip.left < 35 ? 'left' : def.pip.left > 65 ? 'right' : 'center';
    wrap.hidden = L.scene.pip === 'hidden';
  }

  function setPip(state) {
    L.scene.pip = state;
    $('#pip').dataset.state = state;
    $('#pip-wrap').hidden = state === 'hidden';
  }

  function pulsePip(cls) {
    const pip = $('#pip');
    pip.classList.remove(cls);
    void pip.offsetWidth;
    pip.classList.add(cls);
  }

  function bubble(lines) {
    const b = $('#bubble');
    if (!lines || !lines.length) {
      b.hidden = true;
      return;
    }
    const shown = lines.slice(-3);
    b.innerHTML = (lines.length > 3 ? '<span class="more">…</span>' : '') + shown.map((l) => `<span>${esc(l) || '&nbsp;'}</span>`).join('');
    b.hidden = false;
  }

  // ---------- story box ----------

  function speakerName(line) {
    switch (line.who) {
      case 'pip': return 'Pip';
      case 'mum': return X.P.mum;
      case 'grandma': return X.P.grandma;
      case 'uncle': return X.P.uncle;
      case 'friend': return X.t(line.name || 'Friend');
      default: return '';
    }
  }

  function storyLineHTML(line) {
    const name = speakerName(line);
    const who = line.who === 'friend' ? X.t(line.name || 'friend') : line.who;
    return `<div class="say say-${line.who}"><span class="av">${Art.avatar(who, X)}</span><p>${name ? `<b>${esc(name)}</b>` : ''}${esc(X.t(line.text))}</p></div>`;
  }

  function renderStory(lines, pre) {
    const box = $('#story');
    box.innerHTML = (lines || []).map(storyLineHTML).join('') +
      (pre ? `<button class="btn primary pre" id="btn-pre" type="button">${esc(pre.label)}</button>` : '');
    if (pre) $('#btn-pre').addEventListener('click', doPre);
    (lines || []).forEach((l) => Voice.say(X.t(l.text)));
  }

  function doPre() {
    const pre = L.R.pre;
    L.preDone = true;
    Object.assign(L.scene, pre.scene || {});
    renderScene();
    setPip(L.scene.pip);
    Sound.play('ding');
    $('#btn-pre').remove();
    $('#story').insertAdjacentHTML('beforeend', (pre.say || []).map(storyLineHTML).join(''));
    (pre.say || []).forEach((l) => Voice.say(X.t(l.text)));
    $('#workbench').classList.remove('waiting');
    $('#btn-run').disabled = false;
  }

  // ---------- levels and rounds ----------

  function startLevel(id) {
    const level = C.LEVELS[id];
    if (!level) return;
    L = {
      id,
      level,
      chapter: chapterOf(id),
      round: 0,
      scene: JSON.parse(JSON.stringify(level.sceneStart || {})),
      t0: Date.now(),
      awarded: new Set(),
    };
    $('#level-chapter').textContent = `Chapter ${L.chapter.n} · ${L.chapter.title}`;
    $('#file-tab').textContent = L.chapter.file || 'main.py';
    $('#level-title').textContent = `${levelNumber(id)} ${level.title}`;
    show('level');
    startRound(0);
    const ch = L.chapter;
    if (ch.intro && ch.levels[0] === id && !S.done[id]) {
      openOverlay(`<p class="eyebrow">Chapter ${ch.n} · ${esc(ch.age)}</p><h2 id="ov-title">${esc(ch.title)}</h2><p class="ov-text">${esc(X.t(ch.intro))}</p>`,
        [{ label: 'Continue', primary: true, action: () => {} }]);
    }
  }

  function startRound(i) {
    cancelRun();
    const R = L.level.rounds[i];
    L.round = i;
    L.R = R;
    L.hintIdx = 0;
    L.hintsThisRound = 0;
    L.solved = false;
    L.preDone = !R.pre;
    L.editor = null;
    if (R.scene) Object.assign(L.scene, R.scene);
    L.scene.cheer = false;
    if (!L.scene.pip) L.scene.pip = 'idle';
    if (L.scene.pip !== 'hidden' && L.scene.pip !== 'sleep') L.scene.pip = 'idle';
    renderScene();
    setPip(L.scene.pip);
    bubble(null);
    renderStory(R.say, R.pre);
    $('#task').textContent = X.t(R.task || '');
    buildWorkbench(R);
    $('#workbench').classList.toggle('waiting', !L.preDone);
    $('#btn-run').disabled = !L.preDone;
    $('#btn-hint').hidden = R.mode === 'watch';
    $('#btn-reset').hidden = R.mode === 'watch';
    updateAskButton();
    clearFeedback();
    clearConsole();
    renderDots();
    updateTranslation();
  }

  function renderDots() {
    const rounds = L.level.rounds;
    $('#round-dots').innerHTML = rounds.length > 1
      ? rounds.map((_, i) => `<li class="${i < L.round ? 'done' : i === L.round ? 'now' : ''}"><span class="visually-hidden">Step ${i + 1} of ${rounds.length}</span></li>`).join('')
      : '';
  }

  function fillTemplate(template, values) {
    let i = 0;
    return template.replace(/\[\[(.*?)\]\]/g, (m, def) => {
      const v = values && values[i] !== undefined ? values[i] : def;
      i++;
      return v;
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
    for (const ch of L.id + L.round) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
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
    if (t.text === '(') return 'hands open';
    if (t.text === ')') return 'hands close';
    if (t.text === '"') return 'exact words';
    if (t.text === '=') return 'put in';
    if (/^\d+$/.test(t.text)) return 'number';
    return 'the words';
  }

  function buildWorkbench(R) {
    const host = $('#code-host');
    host.className = 'code-host mode-' + R.mode;
    $('#symbolbar').hidden = !['fix', 'guided', 'free'].includes(R.mode);
    $('#keytip').hidden = !['guided', 'free'].includes(R.mode);
    $('#helpbox').hidden = true;
    $('#helpbox').innerHTML = '';
    if (R.mode === 'watch') {
      host.innerHTML = `<pre class="code-view">${codeHTML(X.t(R.code))}</pre>`;
    } else if (R.mode === 'change') {
      renderChange(R, host);
    } else if (R.mode === 'build') {
      L.tiles = shuffledTiles(R);
      L.placed = [];
      renderBuild();
    } else {
      const start = R.mode === 'free' ? (R.code ? X.t(R.code) : '') : X.t(R.code || '');
      L.editor = new Editor(host, {
        value: start,
        ghost: R.mode === 'guided' ? X.t(R.ghost) : null,
        onChange: scheduleTranslation,
      });
    }
  }

  function renderChange(R, host) {
    const template = X.t(R.code);
    const defaults = [];
    template.replace(/\[\[(.*?)\]\]/g, (m, d) => { defaults.push(d); return m; });
    const full = fillTemplate(template, defaults);
    // Find where each slot sits in the full code so highlighting stays correct.
    const ranges = [];
    let offset = 0;
    let slot = 0;
    template.replace(/\[\[(.*?)\]\]/g, (m, d, idx) => {
      const start = idx - offset;
      ranges.push({ start, end: start + d.length, slot: slot++ });
      offset += m.length - d.length;
      return m;
    });
    const segs = segments(full);
    const lines = [[]];
    let pos = 0;
    for (const s of segs) {
      for (let k = 0; k < s.text.length; k++) {
        const ch = s.text[k];
        const at = pos + k;
        const r = ranges.find((rg) => at >= rg.start && at < rg.end);
        if (ch === '\n') { lines.push([]); continue; }
        const ln = lines[lines.length - 1];
        if (r) {
          if (at === r.start) ln.push({ input: r.slot, cls: s.cls });
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
        return `<input class="slot ${p.cls || ''}" id="slot-${p.input}" data-slot="${p.input}" value="${esc(v)}" style="width:${Math.max(2, v.length + 1)}ch" aria-label="Change this part" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">`;
      }
      return p.cls ? `<span class="${p.cls}">${esc(p.text)}</span>` : esc(p.text);
    }).join('')}</span>`).join('')}</pre><p class="slot-tip">Tap the glowing part to change it.</p>`;
    $$('.slot', host).forEach((inp) => {
      inp.addEventListener('input', () => {
        straighten(inp);
        inp.style.width = Math.max(2, inp.value.length + 1) + 'ch';
        scheduleTranslation();
      });
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); run(); }
      });
    });
  }

  function renderBuild() {
    const R = L.R;
    const host = $('#code-host');
    const parts = R.code ? X.t(R.code).split('{{BUILD}}') : ['', ''];
    const above = parts[0].replace(/\n$/, '');
    const below = (parts[1] || '').replace(/^\n/, '');
    const placed = L.placed.map((t) => L.tiles.find((x) => x.i === t));
    const tray = L.tiles.filter((t) => !L.placed.includes(t.i));
    const tileBtn = (t, where) => `<button class="tile ${tokenClass(t.text) || 't-words'}" type="button" data-tile="${t.i}" data-where="${where}">
      <span class="tile-code">${esc(t.text)}</span><span class="tile-mean">${esc(tileMeaning(t))}</span></button>`;
    host.innerHTML = `<div class="build">
      ${above ? `<pre class="code-view context">${codeHTML(above)}</pre>` : ''}
      <div class="build-line${placed.length ? '' : ' empty'}" aria-label="Your line">${placed.length ? placed.map((t) => tileBtn(t, 'line')).join('') : '<span class="build-hint">Tap the pieces below to build the line here</span>'}</div>
      ${below ? `<pre class="code-view context">${codeHTML(below)}</pre>` : ''}
      <div class="tray" aria-label="Pieces">${tray.map((t) => tileBtn(t, 'tray')).join('') || '<span class="build-hint">All pieces used. Press Run!</span>'}</div>
    </div>`;
    $$('.tile', host).forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.tile);
      if (b.dataset.where === 'tray') L.placed.push(i);
      else L.placed = L.placed.filter((x) => x !== i);
      Sound.play('tap');
      renderBuild();
      scheduleTranslation();
      const again = $(`.tile[data-tile="${i}"]`, host);
      if (again) again.focus();
    }));
  }

  function builtLine() {
    return C.joinTiles(L.placed.map((i) => L.tiles.find((t) => t.i === i).text));
  }

  function currentCode() {
    const R = L.R;
    switch (R.mode) {
      case 'watch': return X.t(R.code);
      case 'change': return fillTemplate(X.t(R.code), $$('#code-host .slot').map((i) => i.value));
      case 'build': {
        const line = builtLine();
        return R.code ? X.t(R.code).replace('{{BUILD}}', line) : line;
      }
      default: return L.editor ? L.editor.value : '';
    }
  }

  // ---------- translation and output ----------

  let transTimer = null;
  function scheduleTranslation() {
    clearTimeout(transTimer);
    transTimer = setTimeout(updateTranslation, 120);
  }

  function updateTranslation() {
    if (!L) return;
    let code = currentCode();
    // While the player follows Pip's guide, translate the line they're heading for.
    if (L.R.mode === 'guided' && L.editor && L.editor.ghost && L.editor.ghost.startsWith(code)) code = L.editor.ghost;
    const rows = Py.explain(code);
    const items = rows.map((row, i) => {
      if (!row) return '';
      const text = row.text
        ? esc(row.text)
        : '<span class="cant">Pip can\'t read this line yet</span>';
      return `<li style="--depth:${row.depth}"><span class="tl-n">${i + 1}</span><span class="tl-t">${text}</span></li>`;
    }).join('');
    const empty = L.R.mode === 'build' ? 'Build the line and Pip will translate it into plain words.' : 'Start typing and Pip will translate each line into plain words.';
    $('#trans-list').innerHTML = items || `<li class="empty">${empty}</li>`;
  }

  function clearConsole() {
    $('#console-out').innerHTML = '<span class="muted">Press Run to see what Pip shows.</span>';
    L.consoleEmpty = true;
  }

  function consoleLine(text, cls) {
    const out = $('#console-out');
    if (L.consoleEmpty) {
      out.innerHTML = '';
      L.consoleEmpty = false;
    }
    out.insertAdjacentHTML('beforeend', `<span class="${cls || ''}">${esc(text) || '&nbsp;'}</span>\n`);
  }

  // ---------- running code ----------

  function cancelRun() {
    runToken++;
    if (L) L.running = false;
    const b = $('#btn-run');
    if (b && L) b.disabled = !L.preDone;
  }

  async function run() {
    if (!L || currentScreen !== 'level' || L.running || !L.preDone) return;
    const replay = L.solved;
    const code = currentCode();
    if (L.R.mode === 'build' && !L.placed.length) {
      feedback('info', 'Nothing to run yet', 'Tap the pieces to build the line first.');
      return;
    }
    const r = Py.run(code);
    const st = stat(L.id);
    st.runs++;
    persist();
    const token = ++runToken;
    L.running = true;
    $('#btn-run').disabled = true;
    if (!replay) clearFeedback();
    $('#console-out').innerHTML = '';
    L.consoleEmpty = false;
    if (L.editor) L.editor.setError(null);

    const def = sceneDef();
    if (L.scene.pip === 'sleep') {
      setPip('happy');
      Sound.play('ding');
      await wait(500);
      if (token !== runToken) return;
    }
    if (def.onStart && r.lines.length) {
      def.onStart(L.scene);
      renderScene();
    }
    const many = r.lines.length > 12;
    const per = reducedMotion() ? 60 : many ? 170 : L.level.scene === 'hideseek' ? 380 : 520;
    for (let i = 0; i < r.lines.length; i++) {
      if (token !== runToken) return;
      const line = r.lines[i];
      consoleLine(line);
      if (def.onLine) {
        def.onLine(L.scene, line, i);
        renderScene();
      }
      if (L.level.scene === 'hideseek') setPip(/^\d+$/.test(line) ? 'cover' : 'happy');
      else if (L.level.scene === 'rope') {
        setPip('idle');
        pulsePip(L.scene.action === 'clap' ? 'clap' : 'jump');
      } else setPip('talk');
      bubble(r.lines.slice(0, i + 1));
      Sound.play('blip');
      if (i < 200) await wait(per);
    }
    if (token !== runToken) return;
    if (r.lines.length && r.lines.length <= 3) Voice.say(r.lines.join('. '), { pitch: 1.5 });
    if (def.onDone) def.onDone(L.scene, r);
    if (def.onRun) def.onRun(L.scene, r);
    if (L.R.onRun) Object.assign(L.scene, L.R.onRun(r, Object.assign({}, X, { code })));
    if (!r.lines.length) bubble(null);
    renderScene();
    L.running = false;
    $('#btn-run').disabled = false;
    if (replay) {
      setPip(r.error ? 'confused' : 'happy');
      return;
    }
    evaluate(r, code);
  }

  // Pip's reaction to an error: which face, what to say.
  function reaction(err, code) {
    const m = err.message || '';
    const t = err.type;
    const line = err.line;
    const onLine = line ? ` on line ${line}` : '';
    if (err.kind === 'unsupported') return { pip: 'confused', title: 'Pip hasn\'t learned that yet', text: `That's real Python, but this early version of the game only knows the basics (it doesn't know ${err.what} yet). Try it the way the level shows.` };
    if (err.kind === 'toolong') return { pip: 'dizzy', title: 'Pip got dizzy!', text: 'Your program kept going and going, so Pip stopped it. Check how many times your loop repeats.' };
    if (err.kind === 'internal') return { pip: 'dizzy', title: 'Pip tripped over something', text: 'That\'s Pip\'s fault, not yours. Try the line again, or use a hint.' };
    if (t === 'SyntaxError' && /^unterminated (triple-quoted )?(f-)?string literal/.test(m)) {
      return { pip: 'mouth', title: 'Pip\'s mouth is stuck open…', text: `Pip started reading words at a " but never found the " that ends them${onLine}. Quotes come in pairs: one before the words and one after.` };
    }
    if (/was never closed/.test(m)) {
      return { pip: 'hands', title: 'Pip\'s hands are stuck open', text: `Every ( opens Pip's hands and needs a ) to close them. Add the missing )${onLine}.` };
    }
    if (/^unmatched/.test(m)) return { pip: 'confused', title: 'One ) too many', text: `Pip found a ) closing hands that were never opened${onLine}. Remove the extra ).` };
    if (/does not match opening parenthesis/.test(m)) return { pip: 'confused', title: 'The brackets don\'t match', text: 'Brackets come in matching pairs: ( goes with ), and [ goes with ].' };
    if (/Missing parentheses in call to 'print'/.test(m)) return { pip: 'hands', title: 'print needs hands', text: 'Put what you want to show inside ( ), like this: print("Hello")' };
    if (/Perhaps you forgot a comma/.test(m)) return { pip: 'confused', title: 'Two things side by side', text: `Pip found two things next to each other with nothing between them${onLine}. If they're words, keep them inside one pair of quotes. If they're separate things, put a comma between them.` };
    if (m === "expected ':'") return { pip: 'confused', title: 'Pip is waiting for a colon', text: `Line ${line} needs a : at the very end. The colon means "here's what to do".` };
    if (t === 'IndentationError' && /expected an indented block/.test(m)) return { pip: 'confused', title: 'Which lines belong?', text: 'Push the lines that belong to the loop in with 4 spaces (tap ⇥). That\'s how Pip knows what to repeat.' };
    if (m === 'unexpected indent') return { pip: 'confused', title: 'A line is pushed in for no reason', text: `Line ${line} starts with spaces, but it doesn't belong to anything. Remove the spaces at the start of that line.` };
    if (/unindent does not match/.test(m)) return { pip: 'confused', title: 'The lines don\'t line up', text: `The spaces at the start of line ${line} don't line up with the lines above. Use 4 spaces for each step in.` };
    if (/^cannot assign to/.test(m)) return { pip: 'confused', title: 'The jar name goes first', text: 'Write the jar\'s name on the left of =, and what goes into it on the right. Like this: sweets = 5' };
    if (/Maybe you meant '==' or ':='/.test(m)) return { pip: 'confused', title: 'One = or two?', text: 'To compare things, use two equals signs ==. One = puts something into a jar.' };
    if (/invalid (non-printable )?character/.test(m)) return { pip: 'confused', title: 'A symbol Pip can\'t read', text: `There's a character${onLine} that isn't part of Python. Delete it and type it again with your keyboard.` };
    if (/leading zeros/.test(m)) return { pip: 'confused', title: 'Numbers can\'t start with 0', text: 'Write 5, not 05.' };
    if (/invalid decimal literal/.test(m)) return { pip: 'confused', title: 'Numbers and letters stuck together', text: 'A jar name can\'t start with a number, and a number can\'t have letters in it. Put a space between them, or start the name with a letter.' };
    if (t === 'NameError') {
      const name = err.name || (/name '(.+?)'/.exec(m) || [])[1] || '';
      const sug = err.suggestion;
      if (sug && sug.toLowerCase() === name.toLowerCase()) return { pip: 'confused', title: 'Capital letters matter', text: `Pip knows ${sug}, but not ${name}. In Python, small letters and capital letters are different. Try ${sug}.` };
      if (sug) return { pip: 'confused', title: `"${name}"? Did you mean ${sug}?`, text: `Pip doesn't know the word ${name}. Spelling matters in Python. Did you mean ${sug}?` };
      return { pip: 'confused', title: `Who is ${name}?`, text: `Pip doesn't know anyone (or any jar) called ${name}. If you meant those exact words, put them in quotes: "${name}".` };
    }
    if (t === 'TypeError' && /can only concatenate str/.test(m)) return { pip: 'confused', title: 'Words and numbers don\'t glue', text: 'Pip can\'t join words and numbers with +. Use a comma instead, like print("I am", 6).' };
    if (t === 'TypeError' && /unsupported operand/.test(m)) return { pip: 'confused', title: 'Those don\'t mix', text: 'Pip can\'t do maths with words. Check that numbers are numbers (no quotes around them).' };
    if (t === 'ZeroDivisionError') return { pip: 'dizzy', title: 'Sharing with nobody?', text: 'You can\'t share things between 0 friends. Use a number bigger than 0.' };
    if (t === 'SyntaxError') return { pip: 'confused', title: 'Pip can\'t read this line', text: `Something${onLine} is out of place. Check that every ( has a ) and every " has a partner.` };
    return { pip: 'confused', title: 'Something went wrong', text: 'Read the message from Python below. Pip is still learning to explain this one.' };
  }

  function evaluate(r, code) {
    const st = stat(L.id);
    if (r.error) {
      st.errors++;
      persist();
      const rx = reaction(r.error, code);
      setPip(rx.pip);
      Sound.play('oops');
      feedback('oops', rx.title, rx.text, r.error);
      consoleLine('Python says: ' + r.error.text, 'c-err');
      if (L.editor) L.editor.setError(r.error.line);
      else markLine(r.error.line);
      return;
    }
    const x = Object.assign({}, X, { code });
    const res = L.R.check ? L.R.check(r, x) : { ok: true };
    if (!res.ok) {
      setPip('confused');
      Sound.play('oops');
      feedback('info', 'Not quite yet', X.t(res.msg || 'That isn\'t what Pip needed.'));
      return;
    }
    succeed(res);
  }

  function markLine(line) {
    $$('#code-host .ln').forEach((el, i) => el.classList.toggle('is-error', line === i + 1));
  }

  function succeed(res) {
    const R = L.R;
    L.solved = true;
    // Points only the first time a round is solved, even after "Start again".
    const pts = L.awarded.has(L.round) ? 0 : 10 + (L.hintsThisRound ? 0 : 5);
    L.awarded.add(L.round);
    S.points += pts;
    if (R.onWin) {
      for (const [k, v] of Object.entries(R.onWin)) {
        if (k === 'guests') L.scene.guests = Array.from(new Set((L.scene.guests || []).map(X.t).concat(v.map(X.t))));
        else L.scene[k] = Array.isArray(v) ? v.map(X.t) : v;
      }
      L.scene.cheer = true;
      renderScene();
    }
    if (R.learn && R.learn.term === 'Rule') {
      const text = X.t(R.learn.text);
      if (!S.rules.includes(text)) S.rules.push(text);
    }
    persist();
    updateTopbar();
    setPip('happy');
    Sound.play('success');
    if (pts) pointsPop(pts);
    const last = L.round === L.level.rounds.length - 1;
    const win = X.t(res.win || R.win || 'Pip did it!');
    const learn = R.learn ? `<div class="learn"><b>${esc(X.t(R.learn.term))}</b><p>${esc(X.t(R.learn.text))}</p></div>` : '';
    const box = $('#feedback');
    box.innerHTML = `<div class="fb fb-win" role="status">
      <h3>${esc(win)}</h3>${learn}
      <button class="btn primary" id="btn-next" type="button">${last ? 'Finish level' : 'Next'}</button></div>`;
    $('#btn-next').addEventListener('click', () => (last ? completeLevel() : startRound(L.round + 1)));
    $('#btn-next').focus({ preventScroll: true });
    box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }

  function pointsPop(pts) {
    const b = $('#btn-run');
    const pop = document.createElement('span');
    pop.className = 'points-pop';
    pop.textContent = `+${pts}`;
    b.appendChild(pop);
    setTimeout(() => pop.remove(), 1200);
  }

  function feedback(kind, title, text, err) {
    const box = $('#feedback');
    const py = err ? `<p class="py-says"><span>Python says</span><code>${esc(err.text)}</code></p>` : '';
    box.innerHTML = `<div class="fb fb-${kind}" role="status"><h3>${esc(title)}</h3><p>${esc(text)}</p>${py}</div>`;
    box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }

  function clearFeedback() {
    $('#feedback').innerHTML = '';
  }

  // ---------- hints ----------

  function showHint() {
    if (!L || L.solved) return;
    const R = L.R;
    const hints = (R.hints || []).map(X.t);
    const box = $('#helpbox');
    box.hidden = false;
    const st = stat(L.id);
    if (L.hintIdx < hints.length) {
      st.hints++;
      L.hintsThisRound++;
      persist();
      L.hintIdx++;
      const shown = hints.slice(0, L.hintIdx).map((h, i) => `<li><b>Hint ${i + 1}</b> ${esc(h)}</li>`).join('');
      box.innerHTML = `<ol class="hints">${shown}</ol>${L.hintIdx >= hints.length ? showMeButton() : ''}`;
    } else {
      box.innerHTML = `<p class="hints-done">That's every hint. Want to see the answer?</p>${showMeButton()}`;
    }
    const sm = $('#btn-showme');
    if (sm) sm.addEventListener('click', showAnswer);
  }

  function showMeButton() {
    return '<button class="btn ghost" id="btn-showme" type="button">Show me the answer</button>';
  }

  function showAnswer() {
    const R = L.R;
    stat(L.id).hints++;
    L.hintsThisRound++;
    persist();
    const box = $('#helpbox');
    if (R.mode === 'build') {
      const solution = R.solution.map(X.t);
      const used = [];
      L.placed = solution.map((text) => {
        const t = L.tiles.find((tile) => tile.text === text && !used.includes(tile.i));
        used.push(t.i);
        return t.i;
      });
      renderBuild();
      updateTranslation();
      box.innerHTML = '<p class="hints-done">Pip put the pieces in order. Read them, then press Run.</p>';
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
      box.innerHTML = '<p class="hints-done">Pip filled it in for you. Press Run.</p>';
      return;
    }
    const answer = X.t(R.answer || R.ghost || '');
    box.innerHTML = `<p class="hints-done">Here's one way to write it. Type it yourself, or let Pip put it in the editor.</p>
      <pre class="code-view">${codeHTML(answer)}</pre><button class="btn ghost" id="btn-use" type="button">Put it in the editor</button>`;
    $('#btn-use').addEventListener('click', () => {
      L.editor.value = answer;
      L.editor.focus();
    });
  }

  function resetRound() {
    if (!L || L.running) return;
    const keepHints = { idx: L.hintIdx, used: L.hintsThisRound };
    startRound(L.round);
    L.hintIdx = keepHints.idx;
    L.hintsThisRound = keepHints.used;
  }

  // ---------- Ask Pip (AI) ----------

  function openAsk() {
    if (!sample || !L) return;
    const box = $('#helpbox');
    box.hidden = false;
    box.innerHTML = `<form class="ask" id="ask-form">
      <label for="ask-q">What are you stuck on? You can leave this empty.</label>
      <div class="ask-row"><input id="ask-q" type="text" maxlength="200" placeholder="I don't understand…" autocomplete="off"><button class="btn primary" type="submit">Ask Pip</button></div>
      <div class="ask-answer" id="ask-answer" hidden></div></form>`;
    $('#ask-form').addEventListener('submit', (e) => {
      e.preventDefault();
      askPip($('#ask-q').value.trim());
    });
    $('#ask-q').focus();
  }

  async function askPip(question) {
    const out = $('#ask-answer');
    out.hidden = false;
    out.innerHTML = `<span class="av">${Art.avatar('pip', X)}</span><p class="thinking">Pip is thinking…</p>`;
    const st = stat(L.id);
    st.asked++;
    persist();
    const code = currentCode();
    const r = Py.run(code);
    const happened = r.error
      ? `Python said: ${r.error.text}`
      : r.lines.length ? `Pip showed: ${r.lines.join(' / ')}` : 'Nothing was shown.';
    const prompt = [
      'You are Pip, a small friendly robot in "Life.py", a story game that teaches Python to people who have never written code. The player is stuck and asked you for help.',
      '',
      'Rules for your reply:',
      '- At most 2 short sentences in simple everyday words. Plain text, no markdown.',
      '- Give one hint that moves them a step forward. Never write out the full corrected code.',
      '- Avoid the words string, function, syntax, variable, argument and indentation. Say "words in quotes", "the jar" and "pushed-in lines" instead.',
      '- Be warm and a little playful.',
      '',
      `Their goal: ${X.t(L.R.task || '')}`,
      `The story: ${(L.R.say || []).map((l) => X.t(l.text)).join(' ')}`,
      'Their code right now:',
      code || '(empty)',
      `If they press Run: ${happened}`,
      `They ask: ${question || 'I\'m stuck. Can you help?'}`,
    ].join('\n');
    try {
      const res = await sample(prompt, {
        modelTier: 'quick',
        cache: false,
        onText: ({ text }) => {
          out.innerHTML = `<span class="av">${Art.avatar('pip', X)}</span><p>${esc(text)}</p>`;
        },
      });
      out.innerHTML = `<span class="av">${Art.avatar('pip', X)}</span><p>${esc(res.text)}</p>`;
    } catch (e) {
      const code = e && e.code;
      if (code === 'not_granted') {
        sample = null;
        updateAskButton();
        out.innerHTML = '<p>Pip can\'t think out loud here. Try a hint instead.</p>';
      } else if (code === 'rate_limited') {
        out.innerHTML = '<p>Pip needs a little rest. Try a hint for now.</p>';
      } else {
        out.innerHTML = '<p>Pip couldn\'t come up with an answer just now. Try a hint instead.</p>';
      }
    }
  }

  // ---------- finishing levels and chapters ----------

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

  function nextLevelId(id) {
    const order = allLevels();
    return order[order.indexOf(id) + 1] || null;
  }

  function completeLevel() {
    const id = L.id;
    const st = stat(id);
    st.ms += Date.now() - L.t0;
    st.done = true;
    S.done[id] = true;
    bumpStreak();
    persist();
    updateTopbar();
    const ch = L.chapter;
    const next = nextLevelId(id);
    if (ch.levels[ch.levels.length - 1] === id) {
      if (!S.badges.includes(ch.badge)) S.badges.push(ch.badge);
      persist();
      chapterReveal(ch, next);
      return;
    }
    Sound.play('success');
    openOverlay(`<p class="eyebrow">Level ${levelNumber(id)} complete</p><h2 id="ov-title">${esc(L.level.title)}</h2>
      <p class="ov-text">You have ${S.points} points. Pip is ready for the next one.</p>`,
    [
      { label: 'Next level', primary: true, action: () => startLevel(next) },
      { label: 'Life map', action: openMap },
    ]);
  }

  function chapterReveal(ch, next) {
    Sound.play('fanfare');
    confetti();
    const words = C.NOTEBOOK.filter((w) => w.chapter === ch.id)
      .map((w) => `<li><code>${esc(w.word)}</code><span>Programmers call this <b>${esc(w.jargon)}</b>.</span></li>`).join('');
    const buttons = next
      ? [{ label: `Start chapter ${ch.n + 1}`, primary: true, action: () => startLevel(next) }, { label: 'Life map', action: openMap }]
      : [{ label: 'What\'s next?', primary: true, action: endOfPrototype }];
    openOverlay(`<div class="medal" aria-hidden="true">${ch.n}</div><p class="eyebrow">Badge earned: ${esc(ch.badge)}</p>
      <h2 id="ov-title">${esc(ch.reveal.title)}</h2><p class="ov-text">${esc(ch.reveal.text)}</p>
      <p class="ov-sub">The words you've been using have real names:</p><ul class="reveal-words">${words}</ul>`, buttons);
  }

  function endOfPrototype() {
    const options = C.STORIES.filter((s) => !s.ready).map((s) => `<button class="btn vote" type="button" data-vote="${s.id}" aria-pressed="${!!S.votes[s.id]}">${esc(s.title)}</button>`).join('');
    openOverlay(`<p class="eyebrow">That's this early version</p><h2 id="ov-title">Thank you for playing!</h2>
      <p class="ov-text">Next in Growing Up: Chapter 3, Primary School. Which other life should we build next?</p>
      <div class="vote-row">${options}</div>
      <label class="ov-label" for="ov-notes">What was the hardest part?</label>
      <textarea id="ov-notes" rows="3" placeholder="Anything that confused you">${esc(S.notes || '')}</textarea>`,
    [
      { label: 'See my results', primary: true, action: () => { saveNotes($('#ov-notes').value); renderResults(); show('results'); } },
      { label: 'Life map', action: () => { saveNotes($('#ov-notes').value); openMap(); } },
    ]);
  }

  function saveNotes(text) {
    S.notes = String(text || '').slice(0, 1000);
    persist();
  }

  function toggleVote(id, btn) {
    S.votes[id] = !S.votes[id];
    if (!S.votes[id]) delete S.votes[id];
    persist();
    const on = !!S.votes[id];
    btn.setAttribute('aria-pressed', String(on));
    if (btn.closest('.story-card')) btn.textContent = on ? 'You want this next' : 'I\'d play this next';
    Sound.play('tap');
  }

  // ---------- overlay and confetti ----------

  let overlayKeyHandler = null;

  function openOverlay(html, buttons) {
    const ov = $('#overlay');
    const card = $('#ov-card');
    card.innerHTML = html + `<div class="ov-actions">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : 'ghost'}" type="button" data-ov="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    $$('[data-ov]', card).forEach((el) => el.addEventListener('click', () => {
      const b = buttons[Number(el.dataset.ov)];
      closeOverlay();
      b.action();
    }));
    ov.hidden = false;
    const first = $('[data-ov]', card);
    if (first) first.focus();
  }

  function closeOverlay() {
    const ov = $('#overlay');
    if (ov) ov.hidden = true;
    if (overlayKeyHandler) document.removeEventListener('keydown', overlayKeyHandler);
  }

  function confetti() {
    if (reducedMotion()) return;
    const box = $('#confetti');
    const colors = ['#ff6a55', '#ffc83d', '#2f5be0', '#1fa971', '#8a5cf5', '#ff7ab6'];
    box.innerHTML = Array.from({ length: 90 }, (_, i) => {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.8;
      const dur = 2.2 + Math.random() * 1.6;
      const rot = Math.floor(Math.random() * 360);
      return `<i style="left:${left}%;background:${colors[i % colors.length]};animation-delay:${delay}s;animation-duration:${dur}s;transform:rotate(${rot}deg)"></i>`;
    }).join('');
    setTimeout(() => { box.innerHTML = ''; }, 4500);
  }

  // ---------- wiring ----------

  function wire() {
    document.addEventListener('click', (e) => {
      const story = e.target.closest('[data-story]');
      if (story) {
        if (S.profile) openMap();
        else { renderSetup(); show('setup'); }
        return;
      }
      const vote = e.target.closest('[data-vote]');
      if (vote) { toggleVote(vote.dataset.vote, vote); return; }
      const node = e.target.closest('[data-level]');
      if (node && !node.disabled) startLevel(node.dataset.level);
    });

    $('#btn-play').addEventListener('click', () => { renderStories(); show('stories'); });
    $('#btn-continue').addEventListener('click', openMap);
    $('#link-results').addEventListener('click', () => { renderResults(); show('results'); });
    $('#btn-brand').addEventListener('click', () => (S.profile ? openMap() : (renderTitle(), show('title'))));
    $('#btn-notebook').addEventListener('click', () => {
      notebookFrom = currentScreen === 'notebook' ? notebookFrom : currentScreen;
      renderNotebook();
      show('notebook');
    });
    $('#btn-sound').addEventListener('click', () => { S.settings.sound = !S.settings.sound; persist(); updateTopbar(); Sound.play('tap'); });
    $('#btn-voice').addEventListener('click', () => {
      S.settings.voice = !S.settings.voice;
      if (!S.settings.voice) Voice.stop();
      persist();
      updateTopbar();
    });
    $('#setup-form').addEventListener('submit', submitSetup);
    $('#setup-back').addEventListener('click', () => { renderStories(); show('stories'); });
    $('#btn-back-map').addEventListener('click', openMap);
    $('#nb-back').addEventListener('click', () => (L && notebookFrom === 'level' ? show('level') : openMap()));
    $('#results-back').addEventListener('click', () => (S.profile ? openMap() : (renderTitle(), show('title'))));
    $('#btn-run').addEventListener('click', run);
    $('#btn-hint').addEventListener('click', showHint);
    $('#btn-ask').addEventListener('click', openAsk);
    $('#btn-reset').addEventListener('click', resetRound);
    $('#btn-copy').addEventListener('click', copyResults);
    $('#results-notes').addEventListener('input', (e) => saveNotes(e.target.value));
    $('#btn-reset-all').addEventListener('click', () => { $('#reset-confirm').hidden = false; $('#reset-yes').focus(); });
    $('#reset-no').addEventListener('click', () => { $('#reset-confirm').hidden = true; });
    $('#reset-yes').addEventListener('click', resetAll);

    $$('#symbolbar button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (!L || !L.editor) return;
        const key = b.dataset.key;
        L.editor.focus();
        L.editor.insert(key === 'indent' ? '    ' : key === 'enter' ? '\n' : key);
        Sound.play('tap');
      });
    });

    // Keep the scene small on phones while typing, so the keyboard has room.
    const grid = $('#level-grid');
    grid.addEventListener('focusin', (e) => {
      if (e.target.matches('textarea, input')) grid.classList.add('typing');
    });
    grid.addEventListener('focusout', () => grid.classList.remove('typing'));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#overlay').hidden && $('#ov-card [data-ov]')) {
        // Overlays always offer a way forward, so Escape picks the last (non-primary) choice.
        const btns = $$('#ov-card [data-ov]');
        btns[btns.length - 1].click();
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && currentScreen === 'level') run();
    });
  }

  function boot() {
    $('#brand-pip').innerHTML = Art.avatar('pip', X);
    $('#pip').innerHTML = Art.pipSVG();
    wire();
    renderTitle();
    show('title');
  }

  // Exposed for the automated playthrough test.
  window.LifePyGame = {
    get state() { return S; },
    get level() { return L; },
    currentCode: () => (L ? currentCode() : ''),
    startLevel,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
