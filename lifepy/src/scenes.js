/*
 * Life.py scenes: Pip and the illustrated places where each level happens.
 * Everything is inline SVG so the game works offline and loads instantly.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SHIRTS = ['#ff6a55', '#2f5be0', '#1fa971', '#8a5cf5', '#ffb02e', '#ff7ab6', '#14b8c4', '#f2545b', '#5b7cfa'];
  const SWEETS = ['#ff6a55', '#ffc83d', '#2f5be0', '#1fa971', '#ff7ab6', '#8a5cf5'];

  // Small stable hash so each character keeps the same look.
  function hash(s) {
    let h = 0;
    for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return h;
  }

  function nameTag(x, y, name) {
    const w = Math.max(28, String(name).length * 6.4 + 12);
    return `<g class="tag"><rect x="${x - w / 2}" y="${y}" width="${w}" height="15" rx="7.5" fill="#ffffff" stroke="#1b2440" stroke-width="1.2"/>` +
      `<text x="${x}" y="${y + 11}" text-anchor="middle" font-size="9.5" font-family="Atkinson Hyperlegible, system-ui, sans-serif" font-weight="700" fill="#1b2440">${esc(name)}</text></g>`;
  }

  // A person standing with feet at (x, y).
  function person(x, y, o) {
    const s = o.scale || 1;
    const h = hash(o.id || o.name || 'x');
    const skin = o.skin || '#8d5524';
    const shirt = o.shirt || SHIRTS[h % SHIRTS.length];
    const hair = o.hair || '#2a1a12';
    const legs = '#2b2f45';
    let hairShape = `<path d="M-12.5 -51 a12.5 12.5 0 0 1 25 0 q-6 -6 -12.5 -5 q-6.5 -1 -12.5 5z" fill="${hair}"/>`;
    if (o.style === 'puffs') hairShape += `<circle cx="-12" cy="-58" r="5" fill="${hair}"/><circle cx="12" cy="-58" r="5" fill="${hair}"/>`;
    if (o.style === 'long') hairShape += `<rect x="-13" y="-56" width="5" height="18" rx="2.5" fill="${hair}"/><rect x="8" y="-56" width="5" height="18" rx="2.5" fill="${hair}"/>`;
    if (o.style === 'bun') hairShape += `<circle cx="0" cy="-64" r="5.5" fill="${hair}"/>`;
    if (o.style === 'cap') hairShape = `<path d="M-13 -52 a13 11 0 0 1 26 0z" fill="${shirt}"/><rect x="-2" y="-55" width="18" height="4" rx="2" fill="${shirt}"/>`;
    const glasses = o.glasses ? '<circle cx="-4.5" cy="-49" r="3.4" fill="none" stroke="#1b2440" stroke-width="1"/><circle cx="4.5" cy="-49" r="3.4" fill="none" stroke="#1b2440" stroke-width="1"/><path d="M-1.1 -49 h2.2" stroke="#1b2440" stroke-width="1"/>' : '';
    const arms = o.arms === 'up'
      ? `<rect x="-17" y="-52" width="6" height="20" rx="3" fill="${skin}"/><rect x="11" y="-52" width="6" height="20" rx="3" fill="${skin}"/>`
      : `<rect x="-16" y="-36" width="6" height="18" rx="3" fill="${skin}"/><rect x="10" y="-36" width="6" height="18" rx="3" fill="${skin}"/>`;
    const body = `<g transform="translate(${x} ${y}) scale(${s})">` +
      arms +
      `<rect x="-9" y="-11" width="7.5" height="11" rx="3" fill="${legs}"/><rect x="1.5" y="-11" width="7.5" height="11" rx="3" fill="${legs}"/>` +
      `<rect x="-11.5" y="-40" width="23" height="31" rx="9" fill="${shirt}"/>` +
      `<circle cx="0" cy="-50" r="12.5" fill="${skin}"/>` +
      hairShape +
      `<circle cx="-4.5" cy="-49" r="1.7" fill="#1b1b1b"/><circle cx="4.5" cy="-49" r="1.7" fill="#1b1b1b"/>` + glasses +
      `<path d="M-4 -43.5 q4 3.2 8 0" stroke="#1b1b1b" stroke-width="1.4" fill="none" stroke-linecap="round"/>` +
      '</g>';
    const tag = o.name && !o.noTag ? nameTag(x, y + 3 + (o.tagOffset || 0), o.name) : '';
    return body + tag;
  }

  // Only the head and hands, peeking out from behind something.
  function peeker(x, y, o) {
    return `<g transform="translate(${x} ${y}) scale(${o.scale || 0.8})">` +
      `<circle cx="0" cy="0" r="12" fill="${o.skin}"/>` +
      `<path d="M-12 -2 a12 12 0 0 1 24 0 q-6 -6 -12 -5 q-6 -1 -12 5z" fill="${o.hair || '#2a1a12'}"/>` +
      '<circle cx="-4" cy="1" r="1.7" fill="#1b1b1b"/><circle cx="4" cy="1" r="1.7" fill="#1b1b1b"/>' +
      `<circle cx="-13" cy="8" r="4" fill="${o.skin}"/><circle cx="13" cy="8" r="4" fill="${o.skin}"/></g>`;
  }

  function friendLook(x, i, name) {
    const skins = x.P.skins;
    const h = hash(name);
    return {
      id: name,
      name,
      skin: skins[(h + i) % skins.length],
      shirt: SHIRTS[(h + i * 3) % SHIRTS.length],
      hair: x.P.id === 'ukus' && h % 3 === 0 ? '#b07a3b' : '#2a1a12',
      style: ['puffs', 'long', 'cap', 'bun', null][h % 5],
    };
  }

  function grandmaLook(x) {
    return { id: 'grandma', name: x.P.grandma, skin: x.P.skins[2], shirt: '#8a5cf5', hair: '#d8d8de', style: 'bun', glasses: true };
  }

  function uncleLook(x) {
    return { id: 'uncle', name: x.P.uncle, skin: x.P.skins[3], shirt: '#1fa971', hair: '#2a1a12', style: 'cap' };
  }

  function mumLook(x) {
    return { id: 'mum', name: x.P.mum, skin: x.P.skins[0], shirt: '#ff6a55', hair: '#2a1a12', style: 'long' };
  }

  function lookFor(name, x, i) {
    if (name === x.P.grandma) return grandmaLook(x);
    if (name === x.P.uncle) return uncleLook(x);
    return friendLook(x, i, name);
  }

  function sky(top, bottom) {
    return `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
      '<rect width="400" height="240" fill="url(#sky)"/>';
  }

  function cloud(x, y, s) {
    return `<g transform="translate(${x} ${y}) scale(${s})" fill="#ffffff" opacity="0.9"><circle cx="0" cy="0" r="12"/><circle cx="14" cy="-5" r="15"/><circle cx="30" cy="0" r="11"/><rect x="-4" y="0" width="38" height="10" rx="5"/></g>`;
  }

  function grass() {
    return '<rect y="176" width="400" height="64" fill="#86cf73"/><path d="M0 176 q50 -8 100 0 t100 0 t100 0 t100 0 v8 h-400z" fill="#74c262"/>';
  }

  function bunting() {
    let s = '<path d="M0 10 Q100 26 200 12 T400 12" stroke="#1b2440" stroke-width="1.2" fill="none"/>';
    for (let i = 0; i < 15; i++) {
      const x = 6 + i * 28;
      const y = 12 + Math.sin((i / 14) * Math.PI * 2) * 3 + (i < 7 ? 6 * Math.sin((i / 7) * Math.PI) : 0);
      s += `<path d="M${x} ${y} l14 0 l-7 15z" fill="${SWEETS[i % SWEETS.length]}"/>`;
    }
    return s;
  }

  function sweetDot(cx, cy, i, r) {
    return `<circle cx="${cx}" cy="${cy}" r="${r || 5.5}" fill="${SWEETS[i % SWEETS.length]}" stroke="#ffffff" stroke-width="1.2"/>`;
  }

  // ---------- Pip ----------

  function pipSVG() {
    return '<svg class="pip-svg" viewBox="0 0 120 150" aria-hidden="true" focusable="false">' +
      '<g class="pip-all">' +
      '<g class="pip-antenna"><line x1="60" y1="22" x2="60" y2="9" stroke="#1d3fae" stroke-width="4" stroke-linecap="round"/><circle class="pip-bulb" cx="60" cy="8" r="6.5" fill="#ffc83d"/></g>' +
      '<g class="pip-arm pip-arm-l"><rect x="12" y="88" width="28" height="10" rx="5" fill="#2f5be0"/><circle cx="12" cy="93" r="7.5" fill="#ffc83d"/></g>' +
      '<g class="pip-arm pip-arm-r"><rect x="80" y="88" width="28" height="10" rx="5" fill="#2f5be0"/><circle cx="108" cy="93" r="7.5" fill="#ffc83d"/></g>' +
      '<rect x="40" y="122" width="14" height="14" rx="5" fill="#16307f"/><rect x="66" y="122" width="14" height="14" rx="5" fill="#16307f"/>' +
      '<rect x="33" y="80" width="54" height="46" rx="15" fill="#1d3fae"/>' +
      '<circle class="pip-heart" cx="60" cy="101" r="7" fill="#ffc83d"/>' +
      '<rect x="16" y="16" width="88" height="68" rx="24" fill="#2f5be0"/>' +
      '<rect x="26" y="26" width="68" height="48" rx="15" fill="#0f1a3d"/>' +
      '<g class="eyes eyes-open"><rect x="40" y="38" width="12" height="16" rx="6" fill="#ffd96a"/><rect x="68" y="38" width="12" height="16" rx="6" fill="#ffd96a"/></g>' +
      '<g class="eyes eyes-closed"><path d="M40 48 q6 5 12 0 M68 48 q6 5 12 0" stroke="#ffd96a" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>' +
      '<g class="eyes eyes-happy"><path d="M40 50 q6 -10 12 0 M68 50 q6 -10 12 0" stroke="#ffd96a" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>' +
      '<g class="eyes eyes-dizzy"><path d="M41 40 l10 12 M51 40 l-10 12 M69 40 l10 12 M79 40 l-10 12" stroke="#ffd96a" stroke-width="3.2" stroke-linecap="round"/></g>' +
      '<g class="mouth mouth-smile"><path d="M51 61 q9 7 18 0" stroke="#ffd96a" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>' +
      '<g class="mouth mouth-open"><ellipse cx="60" cy="63" rx="7" ry="7.5" fill="#ffd96a"/></g>' +
      '<g class="mouth mouth-talk"><rect class="talk-bar" x="52" y="59" width="16" height="7" rx="3.5" fill="#ffd96a"/></g>' +
      '<g class="mouth mouth-flat"><path d="M52 63 h16" stroke="#ffd96a" stroke-width="3.5" stroke-linecap="round"/></g>' +
      '<g class="pip-cover"><rect x="29" y="35" width="30" height="25" rx="11" fill="#ffc83d" stroke="#1d3fae" stroke-width="2.5"/><rect x="61" y="35" width="30" height="25" rx="11" fill="#ffc83d" stroke="#1d3fae" stroke-width="2.5"/>' +
      '<path d="M37 36 v9 M44 36 v9 M51 36 v9 M69 36 v9 M76 36 v9 M83 36 v9" stroke="#d99a1e" stroke-width="2" stroke-linecap="round"/></g>' +
      '<text class="pip-q" x="100" y="22" font-size="26" font-weight="800" fill="#ff6a55" font-family="Baloo 2, system-ui, sans-serif">?</text>' +
      '<text class="pip-z" x="96" y="20" font-size="18" font-weight="800" fill="#2f5be0" font-family="Baloo 2, system-ui, sans-serif">z</text>' +
      '</g></svg>';
  }

  // ---------- scenes ----------

  function birthday(state, x) {
    let s = '<rect width="400" height="240" fill="#a7dcd4"/>';
    s += '<rect y="182" width="400" height="58" fill="#e7a56c"/>';
    for (let i = 0; i < 6; i++) s += `<path d="M${i * 70 + 20} 182 v58" stroke="#d68f56" stroke-width="2"/>`;
    s += '<path d="M0 196 h400 M0 214 h400" stroke="#d68f56" stroke-width="1.5"/>';
    s += '<rect x="150" y="38" width="76" height="58" rx="6" fill="#e9f7ff" stroke="#ffffff" stroke-width="5"/><path d="M188 38 v58 M150 67 h76" stroke="#ffffff" stroke-width="4"/>';
    s += bunting();
    // table and cake with five candles
    s += '<rect x="16" y="148" width="104" height="9" rx="3" fill="#8b5a3c"/><rect x="24" y="156" width="7" height="27" fill="#7a4c31"/><rect x="105" y="156" width="7" height="27" fill="#7a4c31"/>';
    s += '<rect x="36" y="120" width="64" height="28" rx="6" fill="#ff9cc2"/><path d="M36 128 q8 8 16 0 t16 0 t16 0 t16 0 v-8 h-64z" fill="#fff4f8"/>';
    for (let i = 0; i < 5; i++) {
      const cx = 44 + i * 12;
      s += `<rect x="${cx - 2}" y="104" width="4" height="16" rx="1.5" fill="${SWEETS[i % SWEETS.length]}"/>`;
      s += `<path class="flame" d="M${cx} 94 q5 6 0 10 q-5 -4 0 -10z" fill="#ffb02e"/>`;
    }
    // door
    const waiting = (state.door || []).map(x.t);
    const doorOpen = waiting.length > 0;
    s += '<rect x="324" y="70" width="66" height="114" rx="4" fill="#6f4429"/>';
    s += doorOpen
      ? '<rect x="330" y="76" width="54" height="108" fill="#2c3a5c"/><rect x="330" y="76" width="16" height="108" fill="#8b5a3c" transform="skewY(-8)" transform-origin="330 76"/>'
      : '<rect x="330" y="76" width="54" height="108" fill="#8b5a3c"/><circle cx="374" cy="132" r="3.5" fill="#ffc83d"/>';
    waiting.slice(0, 3).forEach((name, i) => {
      s += person(342 + i * 16, 184, Object.assign(lookFor(name, x, i), { scale: name === x.P.grandma || name === x.P.uncle ? 0.95 : 0.78, tagOffset: i % 2 ? 16 : 0 }));
    });
    // mum by the table
    s += person(134, 186, Object.assign(mumLook(x), { scale: 1.12 }));
    // guests already inside
    const inside = (state.guests || []).map(x.t);
    inside.slice(0, 6).forEach((name, i) => {
      const adult = name === x.P.grandma || name === x.P.uncle;
      s += person(240 + i * 17, 188 + (i % 2) * 6, Object.assign(lookFor(name, x, i), { scale: adult ? 1 : 0.8, tagOffset: i % 2 ? 12 : 0, arms: state.cheer ? 'up' : undefined }));
    });
    // the present
    if (state.gift === 'closed') {
      s += '<g class="gift"><rect x="168" y="140" width="64" height="46" rx="4" fill="#ff6a55"/><rect x="164" y="132" width="72" height="12" rx="3" fill="#ff8a78"/>' +
        '<rect x="194" y="132" width="12" height="54" fill="#ffc83d"/><path d="M200 132 q-18 -16 -22 -4 q4 6 22 4 q18 2 22 -4 q-4 -12 -22 4z" fill="#ffc83d"/></g>';
    } else if (state.gift === 'open') {
      s += '<rect x="168" y="152" width="64" height="34" rx="4" fill="#ff6a55"/><rect x="194" y="152" width="12" height="34" fill="#ffc83d"/>';
    }
    return s;
  }

  function jars(state) {
    let s = '<rect width="400" height="240" fill="#ffd8a6"/>';
    for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) s += `<rect x="${c * 40 + (r % 2) * 20 - 10}" y="${96 + r * 20}" width="38" height="18" rx="2" fill="none" stroke="#f3c28a" stroke-width="1.5"/>`;
    s += '<rect x="290" y="22" width="90" height="56" rx="6" fill="#e9f7ff" stroke="#ffffff" stroke-width="5"/>';
    s += '<rect y="176" width="400" height="12" fill="#c98a5a"/><rect y="188" width="400" height="52" fill="#a8693d"/><path d="M100 188 v52 M200 188 v52 M300 188 v52" stroke="#93582f" stroke-width="2"/>';
    // the jar
    s += '<path d="M228 84 h84 q10 0 10 12 v68 q0 12 -12 12 h-80 q-12 0 -12 -12 v-68 q0 -12 10 -12z" fill="#e6f5ff" fill-opacity="0.75" stroke="#5b8db8" stroke-width="3"/>';
    s += '<rect x="236" y="66" width="68" height="18" rx="5" fill="#ff6a55"/>';
    const count = state.count;
    if (typeof count === 'number' && count > 0) {
      const shown = Math.min(Math.floor(count), 42);
      for (let i = 0; i < shown; i++) {
        const row = Math.floor(i / 6);
        const col = i % 6;
        s += sweetDot(238 + col * 13 + (row % 2) * 4, 166 - row * 12, i, 5.5);
      }
      if (count > 42) s += `<rect x="248" y="86" width="44" height="18" rx="9" fill="#1b2440"/><text x="270" y="99" text-anchor="middle" font-size="11" font-weight="700" fill="#ffffff" font-family="Atkinson Hyperlegible, system-ui, sans-serif">+${esc(Math.floor(count - 42))}</text>`;
    }
    // hanging label
    const shownValue = count === null || count === undefined ? '?' : typeof count === 'number' ? String(count) : String(count).slice(0, 8);
    s += '<path d="M304 74 q12 -4 22 6" stroke="#1b2440" stroke-width="1.5" fill="none"/>';
    s += '<g transform="rotate(8 340 100)"><rect x="318" y="78" width="66" height="50" rx="8" fill="#ffffff" stroke="#1b2440" stroke-width="2"/>' +
      '<text x="351" y="96" text-anchor="middle" font-size="12" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="600" fill="#1b2440">sweets</text>' +
      `<text x="351" y="120" text-anchor="middle" font-size="20" font-weight="800" font-family="Baloo 2, system-ui, sans-serif" fill="#2f5be0">${esc(shownValue)}</text></g>`;
    return s;
  }

  function share(state, x) {
    let s = sky('#bfe6ff', '#e6f6ff') + '<circle cx="356" cy="40" r="20" fill="#ffd34d"/>' + cloud(60, 40, 1) + cloud(220, 30, 0.8) + grass();
    const friends = typeof state.friends === 'number' ? Math.max(0, Math.floor(state.friends)) : 0;
    const shown = Math.min(friends, 10);
    const each = typeof state.each === 'number' ? state.each : null;
    const span = 238;
    const step = shown ? Math.min(46, span / shown) : 0;
    const startX = 156 + step / 2;
    for (let i = 0; i < shown; i++) {
      const name = x.P.friends[i % x.P.friends.length];
      const fx = startX + i * step;
      s += person(fx, 196, Object.assign(friendLook(x, i, name), { scale: shown > 6 ? 0.58 : 0.7, noTag: shown > 6, tagOffset: i % 2 ? 12 : 0, arms: each ? 'up' : undefined }));
      if (each !== null && each > 0) {
        const pile = Math.min(each, 4);
        for (let k = 0; k < pile; k++) s += sweetDot(fx - 6 + (k % 2) * 12, 214 - Math.floor(k / 2) * 9, i + k, 4);
        if (each > 4) s += `<text x="${fx}" y="236" text-anchor="middle" font-size="10" font-weight="700" fill="#1b2440" font-family="Atkinson Hyperlegible, system-ui, sans-serif">×${esc(each)}</text>`;
      }
    }
    if (friends > 10) s += `<text x="392" y="150" text-anchor="end" font-size="12" font-weight="700" fill="#1b2440" font-family="Atkinson Hyperlegible, system-ui, sans-serif">+${friends - 10} more</text>`;
    // the bowl near Pip: all the sweets before sharing, the leftovers after
    const inBowl = each !== null ? state.left : state.sweets;
    s += '<path d="M24 200 q36 34 72 0z" fill="#ffffff" stroke="#1b2440" stroke-width="2"/>';
    if (typeof inBowl === 'number' && inBowl > 0) {
      const n = Math.min(inBowl, 12);
      for (let k = 0; k < n; k++) s += sweetDot(36 + (k % 6) * 9, 198 - Math.floor(k / 6) * 8, k, 4.2);
    }
    const label = each !== null ? `left over: ${inBowl}` : `${state.sweets} sweets`;
    s += `<rect x="16" y="218" width="88" height="18" rx="9" fill="#1b2440"/><text x="60" y="231" text-anchor="middle" font-size="10.5" font-weight="700" fill="#ffffff" font-family="Atkinson Hyperlegible, system-ui, sans-serif">${esc(label)}</text>`;
    return s;
  }

  function hideseek(state, x) {
    let s = sky('#9fd6ff', '#e3f4ff') + cloud(150, 36, 0.9) + cloud(300, 24, 0.7) + grass();
    // slide
    s += '<path d="M118 178 l0 -62 h10 l0 62 M128 118 q34 10 50 58" stroke="#ff6a55" stroke-width="7" fill="none" stroke-linecap="round"/>';
    // tree
    s += '<rect x="318" y="110" width="22" height="72" rx="6" fill="#8b5a3c"/><circle cx="312" cy="96" r="30" fill="#3fae5a"/><circle cx="346" cy="88" r="32" fill="#4cbc66"/><circle cx="330" cy="62" r="26" fill="#3fae5a"/>';
    // bush
    const kids = [0, 1, 2].map((i) => friendLook(x, i, x.P.friends[(i + 1) % x.P.friends.length]));
    if (state.phase === 'ready') {
      kids.forEach((k, i) => { s += person(180 + i * 34, 194, Object.assign(k, { scale: 0.72, tagOffset: i % 2 ? 12 : 0 })); });
      s += '<ellipse cx="250" cy="192" rx="44" ry="22" fill="#3fae5a"/>';
    } else {
      s += peeker(312, 124, Object.assign({}, kids[0], { scale: 0.7 }));
      s += peeker(236, 172, Object.assign({}, kids[1], { scale: 0.7 }));
      s += '<ellipse cx="250" cy="192" rx="44" ry="22" fill="#3fae5a"/>';
      s += peeker(140, 160, Object.assign({}, kids[2], { scale: 0.6 }));
    }
    if (state.number !== null && state.number !== undefined) {
      s += `<g class="count-pop"><circle cx="150" cy="58" r="30" fill="#ffffff" stroke="#1b2440" stroke-width="2.5"/>` +
        `<text x="150" y="70" text-anchor="middle" font-size="32" font-weight="800" fill="#2f5be0" font-family="Baloo 2, system-ui, sans-serif">${esc(state.number)}</text></g>`;
    }
    return s;
  }

  function rope(state, x) {
    let s = sky('#ffe1b8', '#fff3e0') + cloud(70, 34, 0.8) + cloud(290, 44, 0.9) + grass();
    const a = friendLook(x, 0, x.P.friends[1]);
    const b = friendLook(x, 1, x.P.friends[2]);
    s += person(76, 200, Object.assign(a, { scale: 0.85 }));
    s += person(324, 200, Object.assign(b, { scale: 0.85 }));
    if (state.action === 'jump') {
      const flip = state.beat !== undefined && state.beat % 2 === 0;
      s += `<path class="rope" d="M88 172 Q200 ${flip ? 96 : 236} 312 172" stroke="#ff6a55" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    } else {
      s += '<path d="M88 172 Q200 236 312 172" stroke="#ff6a55" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.5"/>';
      if (state.beat !== undefined) {
        const side = state.beat % 2 ? 250 : 150;
        s += `<g class="clap-pop"><path d="M${side} 70 l8 -18 l6 16 l16 -10 l-6 18 l18 2 l-16 10 l12 14 l-18 -4 l-4 18 l-8 -16 l-12 12 l0 -18 l-18 -2 l14 -10 l-12 -14 l18 2z" fill="#ffc83d" stroke="#1b2440" stroke-width="1.5"/>` +
          `<text x="${side + 4}" y="84" text-anchor="middle" font-size="13" font-weight="800" fill="#1b2440" font-family="Baloo 2, system-ui, sans-serif">CLAP!</text></g>`;
      }
    }
    return s;
  }

  const SCENES = {
    birthday: { pip: { left: 50, bottom: 7, width: 20 }, render: birthday },
    jars: {
      pip: { left: 25, bottom: 9, width: 21 },
      render: jars,
      onRun: (state, r) => {
        if ('sweets' in r.vars) state.count = r.vars.sweets;
      },
    },
    share: {
      pip: { left: 15, bottom: 26, width: 17 },
      render: share,
      onRun: (state, r) => {
        const sw = r.vars.sweets;
        const fr = r.vars.friends;
        state.sweets = sw;
        state.friends = fr;
        if (typeof sw === 'number' && typeof fr === 'number' && fr > 0 && !r.error) {
          state.each = Math.floor(sw / fr);
          state.left = sw - state.each * fr;
        } else {
          state.each = null;
          state.left = null;
        }
      },
    },
    hideseek: {
      pip: { left: 16, bottom: 8, width: 19 },
      render: hideseek,
      onStart: (state) => {
        state.phase = 'counting';
        state.number = null;
      },
      onLine: (state, line) => {
        state.number = /^\d+$/.test(line) ? line : null;
      },
      onDone: (state) => {
        state.number = null;
      },
    },
    rope: {
      pip: { left: 50, bottom: 10, width: 18 },
      render: rope,
      onLine: (state, line, i) => {
        state.beat = i;
      },
    },
  };

  // Small faces for the story box.
  function avatar(who, x) {
    if (who === 'pip') {
      return '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="5" width="34" height="30" rx="11" fill="#2f5be0"/><rect x="8" y="10" width="24" height="19" rx="7" fill="#0f1a3d"/><rect x="13" y="14" width="4.5" height="7" rx="2.2" fill="#ffd96a"/><rect x="22.5" y="14" width="4.5" height="7" rx="2.2" fill="#ffd96a"/><path d="M16 24 q4 3 8 0" stroke="#ffd96a" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
    }
    if (who === 'narrator') {
      return '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 10 q7 -3 14 1 v22 q-7 -4 -14 -1z" fill="#ffc83d"/><path d="M34 10 q-7 -3 -14 1 v22 q7 -4 14 -1z" fill="#ffb02e"/><path d="M20 11 v22" stroke="#1b2440" stroke-width="1.5"/></svg>';
    }
    const look = who === 'mum' ? mumLook(x) : who === 'grandma' ? grandmaLook(x) : who === 'uncle' ? uncleLook(x) : friendLook(x, 0, who);
    return `<svg viewBox="-20 -72 40 40" aria-hidden="true">${person(0, 0, Object.assign({}, look, { noTag: true }))}</svg>`;
  }

  // Cover art for the story select screen.
  function storyArt(id) {
    switch (id) {
      case 'growingup':
        return '<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#a7dcd4"/><rect y="66" width="160" height="24" fill="#e7a56c"/>' +
          '<rect x="22" y="44" width="34" height="22" rx="4" fill="#ff9cc2"/><rect x="28" y="34" width="3" height="10" fill="#2f5be0"/><rect x="38" y="34" width="3" height="10" fill="#1fa971"/><rect x="48" y="34" width="3" height="10" fill="#ff6a55"/>' +
          '<g transform="translate(92 18) scale(0.36)"><rect x="16" y="16" width="88" height="68" rx="24" fill="#2f5be0"/><rect x="26" y="26" width="68" height="48" rx="15" fill="#0f1a3d"/><path d="M40 50 q6 -10 12 0 M68 50 q6 -10 12 0" stroke="#ffd96a" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="60" cy="63" rx="7" ry="7.5" fill="#ffd96a"/><rect x="33" y="80" width="54" height="46" rx="15" fill="#1d3fae"/><circle cx="60" cy="101" r="7" fill="#ffc83d"/></g>' +
          '<path d="M0 6 Q40 16 80 8 T160 8" stroke="#1b2440" stroke-width="1" fill="none"/><path d="M10 8 l8 0 l-4 9z M34 11 l8 0 l-4 9z M58 10 l8 0 l-4 9z M82 8 l8 0 l-4 9z M106 8 l8 0 l-4 9z M130 7 l8 0 l-4 9z" fill="#ffc83d"/></svg>';
      case 'bigcity':
        return '<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#ffb26b"/><circle cx="128" cy="26" r="13" fill="#ffe08a"/>' +
          '<rect x="8" y="30" width="22" height="60" fill="#5b3a6e"/><rect x="34" y="18" width="26" height="72" fill="#4a2f5c"/><rect x="64" y="38" width="20" height="52" fill="#5b3a6e"/><rect x="88" y="26" width="24" height="64" fill="#3b2549"/><rect x="116" y="44" width="36" height="46" fill="#4a2f5c"/>' +
          '<rect x="40" y="62" width="64" height="20" rx="5" fill="#ffd200"/><rect x="40" y="70" width="64" height="3" fill="#1b1b1b"/><rect x="46" y="64" width="12" height="6" rx="1" fill="#bfe6ff"/><rect x="62" y="64" width="12" height="6" rx="1" fill="#bfe6ff"/><rect x="78" y="64" width="12" height="6" rx="1" fill="#bfe6ff"/><circle cx="54" cy="84" r="5" fill="#1b1b1b"/><circle cx="92" cy="84" r="5" fill="#1b1b1b"/></svg>';
      case 'kitchen':
        return '<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#ffe3c8"/><rect y="62" width="160" height="28" fill="#c98a5a"/>' +
          '<rect x="26" y="40" width="44" height="24" rx="6" fill="#3b4a6b"/><rect x="22" y="38" width="52" height="6" rx="3" fill="#4d5f86"/><path d="M36 30 q4 -8 0 -14 M48 30 q4 -8 0 -14 M60 30 q4 -8 0 -14" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
          '<rect x="96" y="30" width="44" height="32" rx="3" fill="#ff6a55"/><rect x="100" y="34" width="36" height="24" fill="#fff4e6"/><path d="M104 40 h28 M104 46 h22 M104 52 h26" stroke="#c98a5a" stroke-width="2"/></svg>';
      default:
        return '<svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#2b3557"/><rect x="14" y="12" width="132" height="66" rx="4" fill="#b8865a"/>' +
          '<rect x="24" y="20" width="26" height="20" fill="#fff4e6"/><rect x="66" y="28" width="26" height="20" fill="#fff4e6"/><rect x="108" y="18" width="26" height="20" fill="#fff4e6"/><rect x="44" y="50" width="26" height="20" fill="#fff4e6"/><rect x="94" y="52" width="26" height="20" fill="#fff4e6"/>' +
          '<path d="M37 30 L79 38 L121 28 L107 62 L57 60 Z" stroke="#ff3b3b" stroke-width="2" fill="none"/><circle cx="37" cy="30" r="3" fill="#ff3b3b"/><circle cx="79" cy="38" r="3" fill="#ff3b3b"/><circle cx="121" cy="28" r="3" fill="#ff3b3b"/></svg>';
    }
  }

  root.LifePyScenes = { SCENES, pipSVG, avatar, storyArt, esc };
})(typeof window !== 'undefined' ? window : globalThis);
