/*
 * Fintech ML Ledger: study tracker, roadmap, mentor CRM, studies planner and reminders.
 * Storage: the Claude artifact database (private per viewer) when available,
 * otherwise this browser's localStorage. Everything is also cached locally.
 */
(function () {
  "use strict";
  const C = window.CURRICULUM;
  const N = window.NETWORK;
  const PX = window.PRACTICE || [];
  const TOTAL_WEEKS = 52;
  const MENTOR_GOAL = 5;
  const PROJECT_GOAL = 2;
  const PROSPECT_GOAL = 60;
  const READY_DAYS = 30;
  const READY_COMMENTS = 4;

  // ---------- small helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const today = () => iso(new Date());
  const fmt = (s, o) => parse(s).toLocaleDateString(undefined, o || { month: "short", day: "numeric" });
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  // ---------- defaults ----------
  const DEFAULTS = {
    settings: {
      name: "", startDate: "2026-09-22",
      oneLiner: "a student learning Python and machine learning for fintech (credit risk and fraud)",
      project: "", projectLink: "", ask: "", win: "",
      linkedinTime: "08:30", linkedinMins: 15, weeklyGoalHours: 10,
      routine: [
        { day: 1, start: "19:00", mins: 60, label: "Learn this week's concepts" },
        { day: 2, start: "19:00", mins: 60, label: "Practice exercises" },
        { day: 3, start: "19:00", mins: 60, label: "Learn this week's concepts" },
        { day: 4, start: "19:00", mins: 60, label: "Practice exercises" },
        { day: 6, start: "10:00", mins: 180, label: "Fintech problem of the week" },
        { day: 0, start: "16:00", mins: 120, label: "Finish problem, push to GitHub, weekly review" },
      ],
    },
    progress: { checks: {}, hours: {}, notes: {}, activity: {}, exam: {}, projects: {} },
    studies: { semesterEnd: "", courses: [], classes: [], deadlines: [] },
    admissions: {
      profile: { fullName: "", email: "", phone: "", location: "", citizenship: "", linkedin: "", github: "", website: "", targetDegree: "PhD", intake: "January 2027 or September 2027", background: "", headline: "", interests: "",
        education: [], research: [], experience: [], publications: [], referees: [], skillsProg: "Python, SQL", skillsMl: "", skillsFin: "", skillsTools: "Git, Jupyter", languages: "English", tests: "", awards: "" },
      recs: {}, custom: [], sprint: {},
    },
    prospects: {},
  };

  // ---------- storage ----------
  const LS_KEY = "fintech-ml-ledger-v1";
  const Store = {
    data: null, db: null, base: null, status: "local", timers: {}, chains: {},
    hydrate(obj) {
      const d = clone(DEFAULTS);
      if (!obj) return d;
      for (const k of ["settings", "progress", "studies", "admissions"]) Object.assign(d[k], obj[k] || {});
      d.admissions.profile = Object.assign(clone(DEFAULTS.admissions.profile), (obj.admissions || {}).profile || {});
      d.prospects = obj.prospects || {};
      return d;
    },
    cacheLocal() { ls.set(LS_KEY, JSON.stringify(this.data)); },
    async init(render) {
      let cached = null;
      try { cached = JSON.parse(ls.get(LS_KEY) || "null"); } catch (e) { cached = null; }
      this.data = this.hydrate(cached);
      render();
      const c = window.claude;
      if (!c || typeof c.use !== "function") return;
      downloadsP = c.use("downloads").catch(() => null);
      try {
        const [db, user] = await Promise.all([c.use("db"), c.use("user")]);
        const id = user ? await user.id() : null;
        if (!db || !id) return;
        this.db = db;
        this.base = `data/users/${id}`;
        const docs = ["settings", "progress", "studies", "admissions"];
        const snaps = await Promise.all(docs.map((k) => db.doc(`${this.base}/${k}`).get()));
        const pros = await db.collection(`${this.base}/crm/prospects`).get();
        const remote = {};
        snaps.forEach((s, i) => { if (s.exists) remote[docs[i]] = s.data(); });
        const merged = this.hydrate(Object.assign({}, this.data, remote, { prospects: this.data.prospects }));
        if (!pros.empty) {
          merged.prospects = {};
          pros.docs.forEach((d) => { merged.prospects[d.id] = clone(d.data()); });
        }
        this.data = merged;
        this.status = "cloud";
        this.cacheLocal();
        // Push anything that only existed on this device.
        docs.forEach((k, i) => { if (!snaps[i].exists) this.save(k); });
        if (pros.empty) Object.keys(this.data.prospects).forEach((pid) => this.saveProspect(pid));
        render();
      } catch (e) {
        this.status = "local";
      }
    },
    queue(key, fn) {
      this.chains[key] = (this.chains[key] || Promise.resolve()).then(fn).catch(() => {
        this.status = "error";
        renderSyncBadge();
      });
    },
    debounce(key, fn) {
      clearTimeout(this.timers[key]);
      this.timers[key] = setTimeout(() => this.queue(key, fn), 700);
    },
    save(docName) {
      this.cacheLocal();
      if (!this.db) return;
      this.debounce(docName, () => this.db.doc(`${this.base}/${docName}`).set(clone(this.data[docName])));
    },
    saveProspect(pid) {
      this.cacheLocal();
      if (!this.db) return;
      const p = this.data.prospects[pid];
      if (!p) return;
      this.debounce("p:" + pid, () => this.db.doc(`${this.base}/crm/prospects/${pid}`).set(clone(this.data.prospects[pid] || p)));
    },
    deleteProspect(pid) {
      delete this.data.prospects[pid];
      this.cacheLocal();
      if (!this.db) return;
      clearTimeout(this.timers["p:" + pid]);
      this.queue("p:" + pid, () => this.db.doc(`${this.base}/crm/prospects/${pid}`).delete());
    },
    saveAll() {
      ["settings", "progress", "studies", "admissions"].forEach((k) => this.save(k));
      Object.keys(this.data.prospects).forEach((pid) => this.saveProspect(pid));
    },
  };
  let downloadsP = Promise.resolve(null);
  const S = () => Store.data.settings;
  const P = () => Store.data.progress;
  const ST = () => Store.data.studies;
  const PR = () => Store.data.prospects;

  // ---------- UI state (per-viewer conveniences) ----------
  const TABS = [
    ["today", "Today"], ["roadmap", "Roadmap"], ["mentors", "Mentors"], ["admissions", "Admissions"], ["finder", "Finder"],
    ["messages", "Messages"], ["studies", "Studies"], ["projects", "Projects"], ["progress", "Progress"], ["settings", "Settings"],
  ];
  const ui = {
    tab: "today", openWeeks: new Set(), edit: null, confirm: null, more: false, sub: {}, phase: null, msgTemplate: "", adSel: null, adTemplate: null, adOpen: null, adFilter: { prio: "all", country: "all", status: "all", q: "" },
    mentorFilter: "active", mentorSearch: "", msgProspect: "", toast: "",
    finder: { market: "dk", role: "ds", tier: "any" },
  };
  (function restoreUi() {
    const h = (location.hash || "").slice(1);
    const saved = ls.get("fml-ui-tab");
    if (TABS.some((t) => t[0] === h)) ui.tab = h;
    else if (saved && TABS.some((t) => t[0] === saved)) ui.tab = saved;
  })();

  // ---------- derived values ----------
  function weekNow() {
    const d = daysBetween(S().startDate, today());
    if (d < 0) return 0;
    return Math.min(TOTAL_WEEKS + 1, Math.floor(d / 7) + 1);
  }
  const weekStart = (n) => addDays(S().startDate, 7 * (n - 1));
  const weekEnd = (n) => addDays(weekStart(n), 6);
  const weekRange = (n) => `${fmt(weekStart(n))} – ${fmt(weekEnd(n))}`;
  const weekOf = (n) => C.weeks[n - 1];
  const practiceOf = (n) => PX.find((x) => x.n === n);
  const phaseOf = (n) => C.phases.find((p) => n >= p.from && n <= p.to);
  function weekKeys(n) {
    const w = weekOf(n);
    const keys = w.skills.map((_, i) => `w${n}s${i}`);
    w.problem.tasks.forEach((_, i) => keys.push(`w${n}t${i}`));
    keys.push(`w${n}p`, `w${n}g`, `w${n}m`);
    const px = practiceOf(n);
    if (px) {
      px.drills.forEach((_, i) => keys.push(`w${n}d${i}`));
      px.quiz.forEach((_, i) => keys.push(`w${n}q${i}`));
      px.carry.tasks.forEach((_, i) => keys.push(`w${n}c${i}`));
      keys.push(`w${n}a`);
    }
    return keys;
  }
  const isChecked = (k) => !!P().checks[k];
  function weekPct(n) {
    const keys = weekKeys(n);
    return keys.filter(isChecked).length / keys.length;
  }
  function overallPct() {
    let done = 0, total = 0;
    for (let n = 1; n <= TOTAL_WEEKS; n++) { const k = weekKeys(n); total += k.length; done += k.filter(isChecked).length; }
    return total ? done / total : 0;
  }
  function phasePct(ph) {
    let done = 0, total = 0;
    for (let n = ph.from; n <= ph.to; n++) { const k = weekKeys(n); total += k.length; done += k.filter(isChecked).length; }
    return total ? done / total : 0;
  }
  function streak() {
    const a = P().activity;
    let d = today();
    if (!a[d]) d = addDays(d, -1);
    let n = 0;
    while (a[d]) { n++; d = addDays(d, -1); }
    return n;
  }
  function markActivity() {
    const t = today();
    P().activity[t] = (P().activity[t] || 0) + 1;
  }
  const shippedCount = () => C.projects.filter((p) => isChecked(`${p.id}shipped`)).length;
  const prospects = () => Object.values(PR()).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const mentorCount = () => prospects().filter((p) => p.stage === "mentor").length;

  // ---------- prospects ----------
  const STAGES = [
    { id: "identified", t: "Identified", next: 0 },
    { id: "engaging", t: "Engaging", next: 0 },
    { id: "requested", t: "Connection sent", next: 7, act: "Check if they accepted. After 14 days with no answer, keep engaging and try again later." },
    { id: "connected", t: "Connected", next: 2, act: "Send the 'After they accept' message." },
    { id: "messaged", t: "Messaged", next: 7, act: "No reply? Send the 7-day follow-up (only once)." },
    { id: "replied", t: "Replied", next: 3, act: "Propose a 15-minute call with 2–3 time options in their time zone." },
    { id: "call", t: "Call held", next: 14, act: "Report back on their advice, then make the mentorship ask." },
    { id: "mentor", t: "Mentor", next: 30, act: "Send your monthly update." },
    { id: "parked", t: "Parked", next: 0 },
  ];
  const stageOf = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
  const marketOf = (id) => N.markets.find((m) => m.id === id) || N.markets[0];
  function readiness(p) {
    const known = daysBetween(p.identifiedOn || today(), today());
    const comments = (p.engagements || []).length;
    const readyOn = addDays(p.identifiedOn || today(), READY_DAYS);
    const early = p.stage === "identified" || p.stage === "engaging";
    const ready = early && known >= READY_DAYS && comments >= READY_COMMENTS;
    return { known, comments, readyOn, ready, early };
  }
  function nextAction(p) {
    const r = readiness(p);
    if (p.stage === "parked") return null;
    if (r.early) {
      if (r.ready) return { text: "Ready: send a connection request (Messages tab).", due: today(), ready: true };
      const need = Math.max(0, READY_COMMENTS - r.comments);
      const bits = [];
      if (need) bits.push(`${need} more comment${need > 1 ? "s" : ""}`);
      if (r.known < READY_DAYS) bits.push(`connect from ${fmt(r.readyOn)}`);
      return { text: `Keep engaging: ${bits.join(", ") || "almost ready"}.`, due: r.readyOn > today() ? r.readyOn : today() };
    }
    const st = stageOf(p.stage);
    return { text: st.act, due: p.followUp || today() };
  }
  function lastEngaged(p) {
    const e = p.engagements || [];
    return e.length ? e[e.length - 1].d : "";
  }
  function localTime(p) {
    const m = marketOf(p.market);
    try {
      const now = new Date();
      const label = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: m.tz }).format(now);
      const parts = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", hourCycle: "h23", timeZone: m.tz }).formatToParts(now);
      const hour = Number((parts.find((x) => x.type === "hour") || {}).value);
      const wd = (parts.find((x) => x.type === "weekday") || {}).value;
      const good = ["Tue", "Wed", "Thu"].includes(wd) && hour >= 8 && hour < 11;
      return { label, good };
    } catch (e) {
      return { label: "", good: false };
    }
  }
  const fitScore = (p) => N.fitCriteria.filter((f) => p.fit && p.fit[f.id]).length;

  // ---------- rendering primitives ----------
  const pct = (x) => `${Math.round(x * 100)}%`;
  function chk(key, text, extra) {
    return `<label class="chk${isChecked(key) ? " is-done" : ""}"><input type="checkbox" data-check="${key}"${isChecked(key) ? " checked" : ""}><span>${text}</span>${extra || ""}</label>`;
  }
  const bar = (x, cls) => `<span class="bar${cls ? " " + cls : ""}"><span style="width:${Math.round(Math.max(0, Math.min(1, x)) * 100)}%"></span></span>`;
  const link = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;
  function gcal({ title, date, start, mins, details, recur, allDay }) {
    const d = date.replace(/-/g, "");
    let dates;
    if (allDay) dates = `${d}/${addDays(date, 1).replace(/-/g, "")}`;
    else {
      const [h, m] = start.split(":").map(Number);
      const s = new Date(parse(date)); s.setHours(h, m, 0, 0);
      const e = new Date(s.getTime() + mins * 60000);
      const t = (x) => `${iso(x).replace(/-/g, "")}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
      dates = `${t(s)}/${t(e)}`;
    }
    const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates, details: details || "" });
    if (recur) q.set("recur", "RRULE:" + recur);
    return "https://calendar.google.com/calendar/render?" + q.toString();
  }

  function renderSyncBadge() {
    const el = $("#sync");
    if (!el) return;
    const map = {
      cloud: ["ok", "Saved to your Claude account"],
      local: ["warn", "Saved on this device only"],
      error: ["bad", "Sync problem: saved on this device. Export a backup in Settings."],
    };
    const [cls, text] = map[Store.status] || map.local;
    el.className = "sync " + cls;
    el.textContent = text;
  }

  const ICONS = {
    today: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    roadmap: '<path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
    mentors: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    finder: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
    messages: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
    studies: '<path d="M2 8.5 12 4l10 4.5-10 4.5z"/><path d="M6 10.5V16c3 2.5 9 2.5 12 0v-5.5"/>',
    projects: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
    progress: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    admissions: '<path d="M21.5 2.5 10 14"/><path d="M21.5 2.5 14.5 21.5l-4.5-7.5-7.5-4.5z"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    hours: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    add: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  };
  const icon = (id) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ""}</svg>`;
  function ring(p, size, stroke, cls) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(1, p));
    return `<svg class="ring ${cls || ""}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${(c * v).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }
  // ---------- theme ----------
  const THEME_KEY = "fml-theme";
  function effectiveTheme() {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "dark" || t === "light") return t;
    try { return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (e) { return "light"; }
  }
  function setTheme(mode) {
    if (mode === "light" || mode === "dark") { document.documentElement.setAttribute("data-theme", mode); ls.set(THEME_KEY, mode); }
    else { document.documentElement.removeAttribute("data-theme"); ls.set(THEME_KEY, "system"); }
  }
  (function restoreTheme() {
    const saved = ls.get(THEME_KEY);
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
  })();
  function themeToggle() {
    const dark = effectiveTheme() === "dark";
    return `<button type="button" class="theme-toggle${dark ? " is-dark" : ""}" data-act="theme" role="switch" aria-checked="${dark}" aria-label="Dark theme">
      <span class="tt-sun" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>
      <span class="tt-moon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></span>
      <span class="tt-knob" aria-hidden="true"></span>
    </button>`;
  }

  // ---------- 3D illustrations (pure SVG, lit with gradients) ----------
  let artSeq = 0;
  function art(kind) {
    const id = "g" + (++artSeq);
    const shadow = (cx, cy, rx, ry) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${id}sh)"/>`;
    const shDef = `<radialGradient id="${id}sh"><stop offset="0" stop-color="#001a55" stop-opacity=".32"/><stop offset="1" stop-color="#001a55" stop-opacity="0"/></radialGradient>`;
    const blueDefs = `<linearGradient id="${id}bf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d86ff"/><stop offset="1" stop-color="#1340c4"/></linearGradient>
      <linearGradient id="${id}bs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a45b8"/><stop offset="1" stop-color="#0a2677"/></linearGradient>
      <linearGradient id="${id}bt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe0ff"/><stop offset="1" stop-color="#86a9ff"/></linearGradient>
      <linearGradient id="${id}gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7cf6a"/><stop offset="1" stop-color="#c88b1c"/></linearGradient>
      <linearGradient id="${id}gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b57812"/><stop offset="1" stop-color="#7d4f08"/></linearGradient>
      <linearGradient id="${id}gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2c9"/><stop offset="1" stop-color="#f3cd6d"/></linearGradient>`;
    // isometric-ish block: front face, right side, top
    const block = (x, base, w, h, d, c) => `<path d="M${x} ${base - h}h${w}v${h}h-${w}z" fill="url(#${id}${c}f)"/>
      <path d="M${x + w} ${base - h}l${d} -${d * 0.6}v${h}l-${d} ${d * 0.6}z" fill="url(#${id}${c}s)"/>
      <path d="M${x} ${base - h}l${d} -${d * 0.6}h${w}l-${d} ${d * 0.6}z" fill="url(#${id}${c}t)"/>`;
    let body = "";
    let vb = "0 0 120 110";
    if (kind === "coins") {
      const coin = (y) => `<path d="M26 ${y}v10a34 12 0 0 0 68 0v-10a34 12 0 0 1 -68 0z" fill="url(#${id}cs)"/>
        <ellipse cx="60" cy="${y}" rx="34" ry="12" fill="url(#${id}ct)"/>
        <ellipse cx="60" cy="${y}" rx="23" ry="7.6" fill="none" stroke="#b9861f" stroke-opacity=".55" stroke-width="1.6"/>
        <ellipse cx="54" cy="${y - 3}" rx="12" ry="3" fill="#fff" opacity=".35"/>`;
      body = `<defs>${shDef}<linearGradient id="${id}cs" x1="0" x2="1"><stop offset="0" stop-color="#8a5a0b"/><stop offset=".38" stop-color="#e2ae4b"/><stop offset=".55" stop-color="#f8dc92"/><stop offset="1" stop-color="#9c650e"/></linearGradient>
        <radialGradient id="${id}ct" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff3c8"/><stop offset=".5" stop-color="#f1c75f"/><stop offset="1" stop-color="#c58f22"/></radialGradient></defs>
        ${shadow(60, 100, 46, 8)}${coin(80)}${coin(64)}${coin(48)}`;
    } else if (kind === "bars") {
      vb = "0 0 130 110";
      body = `<defs>${shDef}${blueDefs}</defs>${shadow(64, 98, 56, 7)}
        ${block(18, 94, 22, 30, 10, "b")}${block(48, 94, 22, 50, 10, "b")}${block(78, 94, 22, 72, 10, "g")}`;
    } else if (kind === "books") {
      vb = "0 0 130 110";
      body = `<defs>${shDef}${blueDefs}</defs>${shadow(62, 98, 54, 7)}
        ${block(22, 94, 70, 14, 16, "b")}${block(28, 80, 62, 13, 16, "g")}${block(20, 67, 70, 14, 16, "b")}`;
    } else if (kind === "cube") {
      body = `<defs>${shDef}${blueDefs}</defs>${shadow(58, 100, 46, 7)}
        ${block(24, 94, 52, 52, 24, "b")}
        <path d="M24 42l24 -14.4h52l-24 14.4z" fill="url(#${id}gt)" opacity=".95"/>
        <path d="M46 42v52" stroke="#f3cd6d" stroke-width="7"/><path d="M46 42l24 -14.4" stroke="#fff2c9" stroke-width="7"/>`;
    } else if (kind === "chat") {
      body = `<defs>${shDef}<linearGradient id="${id}ch" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5c93ff"/><stop offset="1" stop-color="#0f3bb5"/></linearGradient>
        <linearGradient id="${id}ch2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9e4fb"/></linearGradient></defs>
        ${shadow(60, 100, 44, 7)}
        <path d="M30 30h52a14 14 0 0 1 14 14v22a14 14 0 0 1 -14 14h-30l-16 12v-12h-6a14 14 0 0 1 -14 -14v-22a14 14 0 0 1 14 -14z" fill="url(#${id}ch)"/>
        <path d="M32 33h46a12 12 0 0 1 12 12v3h-70v-3a12 12 0 0 1 12 -12z" fill="#fff" opacity=".18"/>
        <circle cx="42" cy="56" r="5" fill="url(#${id}ch2)"/><circle cx="58" cy="56" r="5" fill="url(#${id}ch2)"/><circle cx="74" cy="56" r="5" fill="url(#${id}ch2)"/>`;
    } else {
      // orbs
      const orb = (cx, cy, r, a, b, c) => `<radialGradient id="${id}o${cx}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></radialGradient>`;
      body = `<defs>${shDef}${orb(48, 0, 0, "#b9d1ff", "#3570ff", "#0a2a8a")}${orb(86, 0, 0, "#fff3cf", "#efc158", "#9c650e")}${orb(80, 0, 0, "#d5e3ff", "#6a97ff", "#1b3fae")}</defs>
        ${shadow(60, 100, 46, 7)}
        <circle cx="48" cy="58" r="32" fill="url(#${id}o48)"/><ellipse cx="38" cy="42" rx="11" ry="7" fill="#fff" opacity=".45"/>
        <circle cx="86" cy="78" r="16" fill="url(#${id}o86)"/><ellipse cx="81" cy="71" rx="5" ry="3.2" fill="#fff" opacity=".5"/>
        <circle cx="80" cy="30" r="10" fill="url(#${id}o80)"/><ellipse cx="77" cy="26" rx="3.4" ry="2" fill="#fff" opacity=".55"/>`;
    }
    return `<svg class="art art-${kind}" viewBox="${vb}" aria-hidden="true">${body}</svg>`;
  }

  function renderTabs() {
    $("#tabs").innerHTML = TABS.map(([id, t]) => `<button type="button" role="tab" class="tab${ui.tab === id ? " on" : ""}" data-tab="${id}" aria-selected="${ui.tab === id}">${icon(id)}<span>${t}</span></button>`).join("");
    const n = weekNow();
    const wk = Math.min(Math.max(n, 0), TOTAL_WEEKS);
    const BOTTOM = ["today", "roadmap", "mentors", "admissions"];
    const inMore = !BOTTOM.includes(ui.tab);
    const bn = $("#bottomnav");
    if (bn) bn.innerHTML = BOTTOM.map((id) => `<button type="button" class="bn${ui.tab === id && !ui.more ? " on" : ""}" data-tab="${id}">${icon(id)}<span>${TABS.find((t) => t[0] === id)[1]}</span></button>`).join("")
      + `<button type="button" class="bn${inMore || ui.more ? " on" : ""}" data-act="toggle-more" aria-expanded="${ui.more}">${icon("more")}<span>More</span></button>`;
    const sheet = $("#moresheet");
    if (sheet) {
      sheet.hidden = !ui.more;
      sheet.innerHTML = `<div class="sheet-scrim" data-act="toggle-more"></div><div class="sheet" role="dialog" aria-label="More sections"><span class="grab"></span><div class="sheet-grid">${TABS.filter(([id]) => !BOTTOM.includes(id)).map(([id, t]) => `<button type="button" class="qa${ui.tab === id ? " on" : ""}" data-tab="${id}"><span class="qa-ico">${icon(id)}</span><span>${t}</span></button>`).join("")}</div></div>`;
    }
    const th = $("#themeslot");
    if (th) th.innerHTML = themeToggle();
    const tt = $("#toptitle");
    if (tt) tt.textContent = (TABS.find((t) => t[0] === ui.tab) || [0, ""])[1];
    const foot = $("#sidefoot");
    if (foot) foot.innerHTML = `<div class="sf-ring">${ring(wk / TOTAL_WEEKS, 52, 5)}<span class="mono">${wk}</span></div>
      <div><p class="sf-k">Week ${wk || "—"} of 52</p><p class="sf-v">${pct(overallPct())} of the curriculum done</p></div>`;
  }

  function render() {
    renderTabs();
    const views = { today: vToday, roadmap: vRoadmap, mentors: vMentors, admissions: vAdmissions, finder: vFinder, messages: vMessages, studies: vStudies, projects: vProjects, progress: vProgress, settings: vSettings };
    $("#view").innerHTML = `<div class="view-in">${views[ui.tab]()}</div>`;
    renderOverlay();
    renderSyncBadge();
    if (ui.toast) { showToast(ui.toast); ui.toast = ""; }
  }
  let overlayKey = null;
  function renderOverlay() {
    const o = $("#overlay");
    if (!o) return;
    const key = ui.edit !== null ? "p:" + ui.edit : ui.adOpen ? "s:" + ui.adOpen : null;
    if (key === overlayKey) return;
    overlayKey = key;
    if (key === null) { o.innerHTML = ""; o.hidden = true; document.body.classList.remove("locked"); return; }
    o.hidden = false;
    document.body.classList.add("locked");
    o.innerHTML = `<div class="drawer-scrim" data-act="cancel-edit"></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="Prospect details">
        <button type="button" class="x drawer-x" data-act="cancel-edit" aria-label="Close">×</button>
        ${ui.edit !== null ? prospectForm(ui.edit === "new" ? {} : PR()[ui.edit] || {}) : ui.adOpen === "__new" ? customForm() : supOf(ui.adOpen) ? supDrawer(supOf(ui.adOpen)) : ""}
      </aside>`;
    const first = ui.edit !== null ? $("#pf-name") : $(".drawer .x");
    if (first) first.focus();
  }
  let toastTimer;
  function showToast(text) {
    const el = $("#toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------- layout helpers ----------
  const sub = (scope, def) => ui.sub[scope] || def;
  function segtabs(scope, options, current, cls) {
    return `<div class="segtabs${cls ? " " + cls : ""}" role="tablist">${options.map(([k, t, badge]) => `<button type="button" role="tab" class="st${current === k ? " on" : ""}" data-sub="${scope}:${k}" aria-selected="${current === k}"><span>${t}</span>${badge != null && badge !== "" ? `<span class="st-b">${badge}</span>` : ""}</button>`).join("")}</div>`;
  }
  const PAGE_ART = { roadmap: "bars", mentors: "orbs", admissions: "cube", finder: "orbs", messages: "chat", studies: "books", projects: "coins", progress: "bars", settings: "orbs" };
  function pageHead(eyebrow, title, lede, right) {
    const a = PAGE_ART[ui.tab];
    return `<header class="phead">${a ? `<div class="ph-art">${art(a)}</div>` : ""}<div class="ph-text"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}</div>${right ? `<div class="ph-right">${right}</div>` : ""}</header>`;
  }
  const countKeys = (keys) => `${keys.filter(isChecked).length}/${keys.length}`;

  // ---------- views ----------
  function kpis() {
    const n = weekNow();
    const wk = Math.min(Math.max(n, 0), TOTAL_WEEKS);
    const hrs = n >= 1 && n <= TOTAL_WEEKS ? Number(P().hours[n] || 0) : 0;
    const items = [
      ["Week", n === 0 ? "—" : n > TOTAL_WEEKS ? "Done" : `${wk}<small>/52</small>`, bar(wk / TOTAL_WEEKS)],
      ["Curriculum", pct(overallPct()), bar(overallPct())],
      ["Streak", `${streak()}<small> days</small>`, `<span class="kpi-note">active days in a row</span>`],
      ["Mentors", `${mentorCount()}<small>/${MENTOR_GOAL}+</small>`, bar(mentorCount() / MENTOR_GOAL, "gold")],
      ["Projects shipped", `${shippedCount()}<small>/${PROJECT_GOAL}+</small>`, bar(shippedCount() / PROJECT_GOAL, "gold")],
      ["Hours this week", `${hrs}<small>/${S().weeklyGoalHours}</small>`, bar(hrs / (S().weeklyGoalHours || 10))],
      ["Supervisors contacted", `${supList().filter((x) => AD_CONTACTED.includes(peekRec(x.id).status)).length}<small>/${supList().length}</small>`, bar(supList().filter((x) => AD_CONTACTED.includes(peekRec(x.id).status)).length / Math.max(1, supList().length))],
    ];
    return `<div class="kpis">${items.map(([k, v, extra]) => `<div class="kpi"><span class="kpi-k">${k}</span><span class="kpi-v">${v}</span>${extra}</div>`).join("")}</div>`;
  }

  // A bank-card styled summary of the learner's year.
  function learningCard(n) {
    const wk = Math.min(Math.max(n, 0), TOTAL_WEEKS);
    const wp = n >= 1 && n <= TOTAL_WEEKS ? weekPct(n) : 0;
    const ph = n >= 1 && n <= TOTAL_WEEKS ? phaseOf(n) : null;
    const end = parse(weekEnd(TOTAL_WEEKS));
    return `<div class="lcard" aria-label="Learning card">
      <div class="lc-top"><span class="lc-brand"><span class="mark sm">52</span>Learning card</span>
        <svg class="lc-wave" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7c2.5 2.8 2.5 7.2 0 10M12 5c3.6 3.9 3.6 10.1 0 14M16 3c4.7 5 4.7 13 0 18"/></svg></div>
      <div class="lc-mid"><span class="lc-chip" aria-hidden="true"></span><span class="lc-phase">${ph ? `Phase ${ph.id} · ${esc(ph.name)}` : n > TOTAL_WEEKS ? "Year complete" : "Starts " + fmt(S().startDate)}</span></div>
      <p class="lc-num"><span>W${pad(wk)}</span><span>/52</span><span>${pad(Math.round(overallPct() * 100))}%</span><span>${pad(streak())}D</span></p>
      <div class="lc-bottom">
        <div><small>Learner</small><b>${esc((S().name || "Your name").toUpperCase())}</b></div>
        <div><small>Valid thru</small><b>${pad(end.getMonth() + 1)}/${String(end.getFullYear()).slice(2)}</b></div>
        <div class="lc-ring">${ring(wp, 46, 5, "on-dark")}<span>${Math.round(wp * 100)}</span></div>
      </div>
    </div>`;
  }

  function vToday() {
    const n = weekNow();
    const t = today();
    const dow = new Date().getDay();
    const wn = Math.min(Math.max(n, 1), TOTAL_WEEKS);
    const active = n >= 1 && n <= TOTAL_WEEKS;
    const greet = (() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; })();
    const who = S().name ? `, ${esc(S().name.split(" ")[0])}` : "";
    const reviewItems = active ? spacedReview(wn) : [];
    const tab = sub("today", "overview");
    const tabs = [["overview", "Overview"], ["week", "This week", active ? pct(weekPct(wn)) : null], ["review", "Spaced review", reviewItems.length || null]];
    const head = pageHead(new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }), `${greet}${who}`, "", segtabs("today", tabs, tab));

    if (tab === "week") return head + (active ? weekBody(wn, true) : `<section class="panel"><p class="muted">Week 1 starts ${fmt(S().startDate, { weekday: "long", month: "long", day: "numeric" })}. Its checklist will appear here.</p></section>`);
    if (tab === "review") return head + (reviewItems.length ? reviewHtml(wn) : `<section class="panel empty-state"><h3>Nothing to review yet</h3><p class="muted">From Week 2, this shows questions from 1, 2, 4 and 8 weeks back, new ones every day.</p></section>`);

    let focus;
    if (n === 0) focus = `<p class="eyebrow">Coming up</p><h2>Your year starts ${fmt(S().startDate, { weekday: "long", month: "long", day: "numeric" })}</h2><p class="muted">Week 1: ${esc(weekOf(1).title)}</p>`;
    else if (n > TOTAL_WEEKS) focus = `<p class="eyebrow">52 weeks complete</p><h2>You finished the year</h2><p class="muted">Time for the year-2 plan.</p>`;
    else focus = `<p class="eyebrow">Week ${n} of 52 · ${weekRange(n)}</p><h2>${esc(weekOf(n).title)}</h2>
      <p class="muted">Problem: <b class="ink">${esc(weekOf(n).problem.title)}</b></p>
      ${P().exam[n] ? `<span class="pill warn">Exam week: lighter load, the problem is optional</span>` : ""}
      <div class="focus-bar">${bar(weekPct(n))}<span class="mono small">${pct(weekPct(n))}</span></div>
      <div class="actions"><button type="button" class="btn primary" data-sub="today:week">Open this week</button><button type="button" class="btn" data-act="log-hours">Log hours</button></div>`;

    const plan = [
      { start: S().linkedinTime, html: `<span>LinkedIn: ${S().linkedinMins} min of thoughtful comments on your prospects' posts</span>` },
      ...S().routine.filter((r) => Number(r.day) === dow).map((r) => ({ start: r.start, html: `<span>${esc(r.label)} <em>(${r.mins} min)</em></span>` })),
      ...todaysClasses().map((c) => ({ start: c.start, cls: "school", html: `<span>Class: ${esc(courseName(c.course))}${c.place ? " · " + esc(c.place) : ""}</span>` })),
    ].sort((a, b) => a.start.localeCompare(b.start));
    const planHtml = `<ul class="plan">${plan.map((x) => `<li${x.cls ? ` class="${x.cls}"` : ""}><span class="mono">${esc(x.start)}</span>${x.html}</li>`).join("")}</ul>`;

    // mentor actions (3 per list; the rest live in the Mentors tab)
    const ps = prospects().filter((p) => p.stage !== "parked");
    const ready = ps.filter((p) => readiness(p).ready);
    const due = ps.filter((p) => !readiness(p).early && p.followUp && p.followUp <= t);
    const engage = ps.filter((p) => readiness(p).early).sort((a, b) => (lastEngaged(a) || "").localeCompare(lastEngaged(b) || "")).slice(0, 3);
    const more = (list) => list.length > 3 ? `<li class="more-row"><button type="button" class="linkish" data-tab="mentors">+${list.length - 3} more in Mentors</button></li>` : "";
    const pLine = (p, note) => `<li><span class="pl-who"><span class="avatar xs">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b> <span class="muted">· ${esc(p.company || "")}</span>${note ? `<span class="muted small pl-note">${note}</span>` : ""}</span></span>
      <span class="row-actions">${p.linkedin ? link(p.linkedin, "Profile") : ""}<button type="button" class="btn sm" data-act="msg-for" data-id="${p.id}">Messages</button></span></li>`;
    const mentorHtml = !ps.length
      ? `<p class="muted">No prospects yet. ${n < 3 ? "You start adding them in Week 3; " : ""}use the <button type="button" class="linkish" data-tab="finder">Finder</button> to find your first five.</p>`
      : `${ready.length ? `<h4 class="lh accent">Ready to connect</h4><ul class="plist">${ready.slice(0, 3).map((p) => pLine(p, `${readiness(p).comments} comments over ${readiness(p).known} days`)).join("")}${more(ready)}</ul>` : ""}
         ${due.length ? `<h4 class="lh warn">Follow-ups due</h4><ul class="plist">${due.slice(0, 3).map((p) => pLine(p, esc(nextAction(p).text))).join("")}${more(due)}</ul>` : ""}
         ${engage.length ? `<h4 class="lh">Engage today</h4><ul class="plist">${engage.map((p) => `<li><span class="pl-who"><span class="avatar xs">${esc(initials(p.name))}</span><span><b>${esc(p.name)}</b> <span class="muted">· ${esc(p.company || "")}</span><span class="muted small pl-note">Last comment ${lastEngaged(p) ? fmt(lastEngaged(p)) : "never"}</span></span></span>
              <span class="row-actions">${p.linkedin ? link(p.linkedin.replace(/\/$/, "") + "/recent-activity/all/", "Their posts") : ""}<button type="button" class="btn sm" data-act="log-comment" data-id="${p.id}">Log comment</button></span></li>`).join("")}</ul>` : ""}
         ${!ready.length && !due.length && !engage.length ? `<p class="muted">Nothing due today. Nice.</p>` : ""}`;

    const soon = ST().deadlines.filter((d) => !d.done && d.due && daysBetween(t, d.due) <= 14).sort((a, b) => a.due.localeCompare(b.due));
    const studyHtml = soon.length
      ? `<ul class="plist">${soon.map((d) => { const k = daysBetween(t, d.due); return `<li><span><b>${esc(d.title)}</b> <span class="muted">· ${esc(courseName(d.course))}</span> <span class="pill ${k < 0 ? "bad" : k <= 3 ? "warn" : ""}">${k < 0 ? `${-k}d overdue` : k === 0 ? "today" : `in ${k}d`}</span></span><span class="row-actions"><label class="chk inline"><input type="checkbox" data-dl-done="${d.id}"><span>Done</span></label></span></li>`; }).join("")}</ul>`
      : `<p class="muted">Nothing due in the next 14 days. Add courses and deadlines in <button type="button" class="linkish" data-tab="studies">Studies</button>.</p>`;

    const quick = [
      ["roadmap", "This week", 'data-sub="today:week"'],
      ["add", "Add prospect", 'data-act="new-prospect"'],
      ["finder", "Find mentors", 'data-tab="finder"'],
      ["messages", "Messages", 'data-tab="messages"'],
      ["admissions", "Supervisors", 'data-tab="admissions"'],
    ];
    return `${head}
      <div class="today-top">${learningCard(n)}<section class="panel focus"><div class="focus-art">${art("coins")}</div>${focus}</section></div>
      <nav class="quick" aria-label="Quick actions">${quick.map(([ic, tt, attr]) => `<button type="button" class="qa" ${attr}><span class="qa-ico">${icon(ic)}</span><span>${tt}</span></button>`).join("")}</nav>
      ${kpis()}
      <div class="tri">
        <section class="panel"><h3>${icon("hours")} Today · ${DAY_NAMES[dow]}</h3>${planHtml}
          <p class="muted small">Change these times in Settings. <button type="button" class="linkish" data-sub-go="settings:reminders">Add them to your phone calendar</button> so you get reminders.</p></section>
        <section class="panel"><h3>${icon("mentors")} Mentor actions</h3>${mentorHtml}</section>
        ${todayAdmissionsPanel()}
        <section class="panel"><h3>${icon("studies")} School deadlines</h3>${studyHtml}</section>
      </div>
      <div class="swipe-hint" aria-hidden="true"><i></i><i></i><i></i></div>`;
  }
  const initials = (name) => (name || "?").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

  function problemHtml(n) {
    const w = weekOf(n);
    const pr = w.problem;
    const builds = pr.builds.length
      ? `<p class="builds">Uses skills from ${pr.builds.map((b) => `<button type="button" class="chip" data-goto-week="${b}">W${b} ${esc(weekOf(b).title)}</button>`).join(" ")} + this week</p>`
      : `<p class="builds">Uses this week's skills only</p>`;
    return `<div class="problem">
      <p class="eyebrow">Fintech problem${P().exam[n] ? " · optional this week" : ""}</p>
      <h4>${esc(pr.title)}</h4>
      <p>${esc(pr.context)}</p>
      <p class="small"><b>Data:</b> ${esc(pr.data)}</p>
      ${builds}
      <div class="checks">${pr.tasks.map((t, i) => chk(`w${n}t${i}`, esc(t))).join("")}</div>
      <div class="checks tight">${chk(`w${n}p`, "<b>Problem solved</b> and written up in the notebook")}${chk(`w${n}g`, n >= 7 ? "<b>Pushed to GitHub</b> with a short README" : "<b>Saved</b> in your projects folder (GitHub starts in Week 7)")}</div>
    </div>`;
  }

  function quizItem(key, q, a, label) {
    return `<div class="quiz-item">
      ${chk(key, `${label ? `<span class="muted small">${esc(label)}</span> ` : ""}${esc(q)}`)}
      <details class="answer"><summary>Show answer</summary><p>${esc(a)}</p></details>
    </div>`;
  }
  function drillsHtml(n) {
    const px = practiceOf(n);
    if (!px) return `<p class="muted">No drills for this week.</p>`;
    return `<div class="drills">
      <p class="pane-note">${icon("hours")} Do these in your weekday sessions, before the Saturday problem.</p>
      <div class="checks cols">${px.drills.map((d, i) => chk(`w${n}d${i}`, `<span class="dn">${i + 1}</span> ${esc(d)}`)).join("")}</div>
    </div>`;
  }
  function assessHtml(n) {
    const px = practiceOf(n);
    if (!px) return `<p class="muted">No assessment for this week.</p>`;
    const carryLabel = n === 1 ? "Carry-over challenge · both halves of this week" : `Carry-over challenge · Week ${n - 1} + Week ${n}`;
    return `<div class="grid2 assess-grid">
      <div class="assess">
        <p class="pane-note">Sunday, no notes. Answer each question out loud or on paper, then check. Tick only the ones you got right.</p>
        <div class="quiz">${px.quiz.map((x, i) => quizItem(`w${n}q${i}`, x.q, x.a)).join("")}</div>
      </div>
      <div class="assess">
        <div class="carry">
          <p class="eyebrow">${esc(carryLabel)}</p>
          <h4>${esc(px.carry.title)}</h4>
          <p class="small">${esc(px.carry.scenario)}</p>
          <div class="checks">${px.carry.tasks.map((t, i) => chk(`w${n}c${i}`, esc(t))).join("")}</div>
        </div>
        <div class="checks tight">${chk(`w${n}a`, "<b>Assessment passed</b>: 3 of 4 quiz answers right and the carry-over challenge done without notes. If not, redo drills 1–3 and try again next day.")}</div>
      </div>
    </div>`;
  }

  // Spaced review: questions from 1, 2, 4 and 8 weeks ago, rotating daily.
  function spacedReview(n) {
    const dayIdx = daysBetween(S().startDate, today());
    const items = [];
    [1, 2, 4, 8].forEach((back) => {
      const w = n - back;
      const px = practiceOf(w);
      if (!px || w < 1) return;
      const i = ((dayIdx % px.quiz.length) + px.quiz.length) % px.quiz.length;
      items.push({ w, q: px.quiz[i].q, a: px.quiz[i].a });
    });
    return items;
  }
  function reviewHtml(n) {
    const items = spacedReview(n);
    if (!items.length) return "";
    return `<section class="panel"><h3>Spaced review <span class="muted small">5 minutes · questions from 1, 2, 4 and 8 weeks ago, new ones each day</span></h3>
      <div class="quiz review-grid">${items.map((x) => `<div class="quiz-item"><p><button type="button" class="chip" data-goto-week="${x.w}">W${x.w}</button> ${esc(x.q)}</p><details class="answer"><summary>Show answer</summary><p>${esc(x.a)}</p></details></div>`).join("")}</div>
      <p class="muted small">Got one wrong? Open that week and redo its first two drills.</p></section>`;
  }

  // One week, split into five tabs so it never becomes a long scroll.
  function weekBody(n, compact) {
    const w = weekOf(n);
    const px = practiceOf(n);
    const groups = {
      learn: [...w.skills.map((_, i) => `w${n}s${i}`), `w${n}m`],
      practice: px ? px.drills.map((_, i) => `w${n}d${i}`) : [],
      problem: [...w.problem.tasks.map((_, i) => `w${n}t${i}`), `w${n}p`, `w${n}g`],
      assess: px ? [...px.quiz.map((_, i) => `w${n}q${i}`), ...px.carry.tasks.map((_, i) => `w${n}c${i}`), `w${n}a`] : [],
    };
    const scope = "week-" + n;
    const tab = sub(scope, "learn");
    const tabs = [
      ["learn", "Learn", countKeys(groups.learn)],
      ["practice", "Practice", countKeys(groups.practice)],
      ["problem", "Problem", countKeys(groups.problem)],
      ["assess", "Assess", countKeys(groups.assess)],
      ["log", "Log", P().hours[n] ? `${P().hours[n]}h` : null],
    ];
    let pane;
    if (tab === "practice") pane = drillsHtml(n);
    else if (tab === "problem") pane = problemHtml(n);
    else if (tab === "assess") pane = assessHtml(n);
    else if (tab === "log") pane = `<div class="week-foot">
        <label class="field sm"><span>Hours studied</span><input id="hours-${n}" type="number" min="0" max="80" step="0.5" inputmode="decimal" data-hours="${n}" value="${esc(P().hours[n] || "")}" placeholder="0"></label>
        <label class="chk inline"><input type="checkbox" data-exam="${n}"${P().exam[n] ? " checked" : ""}><span>Exam week (lighter load)</span></label>
        <label class="field grow"><span>Notes / what I learned</span><textarea id="note-${n}" rows="4" data-note="${n}" placeholder="What clicked, what didn't, questions for mentors">${esc(P().notes[n] || "")}</textarea></label>
      </div>`;
    else pane = `<div class="grid2">
        <div class="stack"><p class="eyebrow">Skills</p><div class="checks">${w.skills.map((s, i) => chk(`w${n}s${i}`, esc(s))).join("")}</div></div>
        <div class="stack">
          <p class="eyebrow">Resources</p><ul class="res">${w.resources.map((r) => `<li>${link(r.u, r.t)}</li>`).join("")}</ul>
          <div class="mtask"><p class="eyebrow">Mentor-network task</p><div class="checks">${chk(`w${n}m`, esc(w.mentor))}</div></div>
        </div>
      </div>`;
    return `<section class="panel week-body">
      <div class="wb-head">${compact ? `<div><p class="eyebrow">Week ${n} · ${weekRange(n)}</p><h3>${esc(w.title)} <span class="muted small">${pct(weekPct(n))} done</span></h3></div>` : ""}${segtabs(scope, tabs, tab, "wb-tabs")}</div>
      <div class="wb-pane">${pane}</div>
    </section>`;
  }

  function vRoadmap() {
    const now = weekNow();
    const curPhase = now >= 1 && now <= TOTAL_WEEKS ? phaseOf(now).id : 1;
    if (ui.phase == null) ui.phase = curPhase;
    if (!ui.openWeeks.size && now >= 1 && now <= TOTAL_WEEKS) ui.openWeeks.add(now);
    const ph = C.phases.find((x) => x.id === ui.phase) || C.phases[0];
    const picker = `<div class="phase-picker" role="tablist">${C.phases.map((x) => `<button type="button" role="tab" class="pp${x.id === ph.id ? " on" : ""}${x.id === curPhase ? " cur" : ""}" data-phase="${x.id}" aria-selected="${x.id === ph.id}">
        <span class="pp-ring">${ring(phasePct(x), 38, 4)}<span>${x.id}</span></span>
        <span class="pp-text"><b>${esc(x.name)}</b><small>Weeks ${x.from}–${x.to}</small></span></button>`).join("")}</div>`;
    return `${pageHead("12 months · 6 phases · 52 weeks", "Roadmap", "Each week: learn the skills, then solve a real fintech problem that reuses earlier weeks. Tick anything off, and untick it if you ticked it by mistake.")}
      ${picker}
      <section class="phase">
        <div class="phase-head"><div><p class="eyebrow">Phase ${ph.id} · Weeks ${ph.from}–${ph.to} · ${fmt(weekStart(ph.from), { month: "short" })}–${fmt(weekEnd(ph.to), { month: "short", year: "numeric" })}</p><h2>${esc(ph.name)}</h2><p class="muted">${esc(ph.summary)}</p></div>
        <div class="phase-pct"><span class="mono">${pct(phasePct(ph))}</span>${bar(phasePct(ph))}</div></div>
        ${Array.from({ length: ph.to - ph.from + 1 }, (_, i) => ph.from + i).map((n) => {
          const p = weekPct(n);
          const state = n === now ? "current" : p === 1 ? "done" : n < now ? "behind" : "";
          return `<details class="week ${state}" data-week="${n}" id="week-${n}"${ui.openWeeks.has(n) ? " open" : ""}>
            <summary><span class="wn mono">W${n}</span><span class="wt">${esc(weekOf(n).title)}${n === now ? ' <span class="pill accent">this week</span>' : ""}${P().exam[n] ? ' <span class="pill warn">exam</span>' : ""}</span><span class="wd muted">${weekRange(n)}</span><span class="wp">${bar(p)}<span class="mono small">${pct(p)}</span></span></summary>
            ${ui.openWeeks.has(n) ? weekBody(n, false) : ""}
          </details>`;
        }).join("")}
      </section>`;
  }

  function prospectForm(p) {
    const isNew = !p.id;
    const v = (k) => esc(p[k] || "");
    return `<form class="panel form" id="prospect-form" data-id="${esc(p.id || "")}">
      <h3>${isNew ? "Add a prospect" : "Edit " + esc(p.name)}</h3>
      <div class="fields">
        <label class="field"><span>Full name *</span><input id="pf-name" name="name" required value="${v("name")}" placeholder="e.g. Maria Jensen"></label>
        <label class="field"><span>Role</span><input id="pf-role" name="role" value="${v("role")}" placeholder="Data Scientist, Credit Risk"></label>
        <label class="field"><span>Company</span><input id="pf-company" name="company" value="${v("company")}" placeholder="Lunar"></label>
        <label class="field"><span>Company website domain</span><input id="pf-domain" name="domain" value="${v("domain")}" placeholder="lunar.app"></label>
        <label class="field"><span>Market</span><select id="pf-market" name="market">${N.markets.map((m) => `<option value="${m.id}"${(p.market || ui.finder.market) === m.id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Company size</span><select id="pf-tier" name="tier">${[["startup", "Startup"], ["mid", "Mid-size / scale-up"], ["large", "Large / bank"]].map(([k, t]) => `<option value="${k}"${p.tier === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field wide"><span>LinkedIn profile URL</span><input id="pf-linkedin" name="linkedin" type="url" value="${v("linkedin")}" placeholder="https://www.linkedin.com/in/…"></label>
        <label class="field"><span>Work email (optional)</span><input id="pf-email" name="email" type="email" value="${v("email")}" placeholder="first.last@company.com"></label>
        <label class="field"><span>Date identified</span><input id="pf-identified" name="identifiedOn" type="date" value="${esc(p.identifiedOn || today())}"></label>
        <label class="field wide"><span>What they post about / a post you admired</span><input id="pf-topic" name="postTopic" value="${v("postTopic")}" placeholder="monitoring credit models for drift"></label>
        ${!isNew && !readiness(p).early ? `<label class="field"><span>Next follow-up</span><input id="pf-follow" name="followUp" type="date" value="${esc(p.followUp || "")}"></label>` : ""}
        <label class="field wide"><span>Notes</span><textarea id="pf-notes" name="notes" rows="2">${v("notes")}</textarea></label>
      </div>
      <div class="checks cols">
        <label class="chk"><input type="checkbox" name="bell" id="pf-bell"${p.bell ? " checked" : ""}><span><b>Bell turned on</b> (on their profile, so LinkedIn notifies you when they post)</span></label>
        <label class="chk"><input type="checkbox" name="emailVerified" id="pf-verified"${p.emailVerified ? " checked" : ""}><span>Email verified</span></label>
      </div>
      <p class="eyebrow">Mentor fit (the more, the better)</p>
      <div class="checks cols">${N.fitCriteria.map((f) => `<label class="chk"><input type="checkbox" name="fit-${f.id}" id="pf-fit-${f.id}"${p.fit && p.fit[f.id] ? " checked" : ""}><span>${esc(f.t)}</span></label>`).join("")}</div>
      <div class="email-helper" id="email-helper">${emailHelper(p)}</div>
      <div class="actions"><button type="submit" class="btn primary">${isNew ? "Add prospect" : "Save changes"}</button><button type="button" class="btn" data-act="cancel-edit">Cancel</button></div>
    </form>`;
  }

  function emailPatterns(name, domain) {
    const parts = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s-]/g, "").trim().split(/\s+/).filter(Boolean);
    const d = String(domain || "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (parts.length < 2 || !d.includes(".")) return [];
    const f = parts[0], l = parts[parts.length - 1];
    return [`${f}.${l}`, `${f}`, `${f[0]}${l}`, `${f}${l}`, `${f}${l[0]}`, `${f}_${l}`, `${f[0]}.${l}`].map((x) => `${x}@${d}`);
  }
  function emailHelper(p) {
    const d = String(p.domain || "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const pats = emailPatterns(p.name, p.domain);
    return `<p class="eyebrow">Find their work email</p>
      <p class="small muted">Use email only as a backup to LinkedIn. Look the company up on a finder to learn its email pattern, then verify before sending.${d ? "" : " Add the company's website domain above to see likely addresses."}</p>
      <div class="linkrow">${link(d ? `https://hunter.io/search/${encodeURIComponent(d)}` : "https://hunter.io/", "Hunter: company email pattern")}${link("https://hunter.io/email-verifier", "Hunter: verify an address")}${link("https://www.apollo.io/", "Apollo")}${link("https://rocketreach.co/", "RocketReach")}</div>
      ${pats.length ? `<p class="small">Most common patterns (unverified):</p><div class="patterns">${pats.map((e) => `<button type="button" class="chip mono" data-copy="${esc(e)}">${esc(e)}</button>`).join("")}</div>` : ""}`;
  }

  function prospectCard(p) {
    const r = readiness(p);
    const st = stageOf(p.stage);
    const na = nextAction(p);
    const lt = localTime(p);
    const m = marketOf(p.market);
    const dueCls = na && na.due <= today() ? (na.ready ? "accent" : "warn") : "";
    const confirming = ui.confirm === "del:" + p.id;
    return `<article class="pcard stage-${p.stage}">
      <header>
        <span class="avatar${p.stage === "mentor" ? " gold" : ""}" aria-hidden="true">${esc(initials(p.name))}</span>
        <div class="pc-id"><h4>${p.linkedin ? link(p.linkedin, p.name) : esc(p.name)}</h4>
          <p class="muted small">${esc(p.role || "Data scientist")}${p.company ? " · " + esc(p.company) : ""} · ${esc(m.name)}${lt.label ? ` · <span class="${lt.good ? "good-time" : ""}">${esc(lt.label)} there${lt.good ? " (good time to message)" : ""}</span>` : ""}</p></div>
        <select class="stage-select" id="stage-${p.id}" data-stage="${p.id}" aria-label="Stage">${STAGES.map((s) => `<option value="${s.id}"${s.id === p.stage ? " selected" : ""}>${s.t}</option>`).join("")}</select>
      </header>
      <div class="pmeta">
        <span class="pill ${r.ready ? "accent" : ""}">${r.early ? (r.ready ? "Ready to connect" : `Day ${r.known} of ${READY_DAYS}`) : esc(st.t)}</span>
        <span class="pill">Comments: ${r.comments}${lastEngaged(p) ? ` · last ${fmt(lastEngaged(p))}` : ""}</span>
        <span class="pill">Fit ${fitScore(p)}/${N.fitCriteria.length}</span>
        ${p.email ? `<span class="pill">${p.emailVerified ? "Email verified" : "Email unverified"}</span>` : ""}
        <label class="chk inline"><input type="checkbox" data-bell="${p.id}"${p.bell ? " checked" : ""}><span>Bell on</span></label>
      </div>
      ${na ? `<p class="next ${dueCls}"><b>${na.due <= today() ? "Now" : fmt(na.due)}:</b> ${esc(na.text)}</p>` : ""}
      <div class="actions pc-actions">
        ${r.early || p.stage === "mentor" || p.stage === "call" ? `<button type="button" class="btn sm primary" data-act="log-comment" data-id="${p.id}">Log comment</button>` : ""}
        ${!r.early && p.stage !== "parked" ? `<button type="button" class="btn sm primary" data-act="done-followup" data-id="${p.id}">Done → next reminder</button>` : ""}
        <button type="button" class="btn sm" data-act="msg-for" data-id="${p.id}">Messages</button>
        <details class="kebab"${confirming ? " open" : ""}><summary class="btn sm ghost" aria-label="More actions">More</summary>
          <div class="menu">
            ${na ? `<a class="mi" target="_blank" rel="noopener" href="${esc(gcal({ title: `Mentor: ${p.name} (${p.company || ""})`, date: na.due, allDay: true, details: na.text + (p.linkedin ? "\n" + p.linkedin : "") }))}">Add reminder to calendar</a>` : ""}
            ${(p.engagements || []).length ? `<button type="button" class="mi" data-act="undo-comment" data-id="${p.id}">Undo last comment</button>` : ""}
            <button type="button" class="mi" data-act="edit" data-id="${p.id}">Edit details</button>
            ${confirming
              ? `<div class="mi confirm">Delete ${esc(p.name)}? <button type="button" class="btn sm danger" data-act="delete" data-id="${p.id}">Delete</button><button type="button" class="btn sm ghost" data-act="cancel-confirm">Keep</button></div>`
              : `<button type="button" class="mi danger-text" data-act="ask-delete" data-id="${p.id}">Delete</button>`}
          </div>
        </details>
      </div>
    </article>`;
  }

  function vMentors() {
    const all = prospects();
    const counts = Object.fromEntries(STAGES.map((s) => [s.id, 0]));
    all.forEach((p) => { counts[p.stage] = (counts[p.stage] || 0) + 1; });
    const q = ui.mentorSearch.trim().toLowerCase();
    let list = all.filter((p) => {
      if (ui.mentorFilter === "active" && (p.stage === "parked" || p.stage === "mentor")) return false;
      if (ui.mentorFilter === "mentor" && p.stage !== "mentor") return false;
      if (ui.mentorFilter === "parked" && p.stage !== "parked") return false;
      if (STAGES.some((s) => s.id === ui.mentorFilter) && p.stage !== ui.mentorFilter) return false;
      return !q || [p.name, p.company, p.role, marketOf(p.market).name].join(" ").toLowerCase().includes(q);
    });
    list = list.sort((a, b) => ((nextAction(a) || {}).due || "9").localeCompare((nextAction(b) || {}).due || "9"));
    return `${pageHead(`Goal: ${MENTOR_GOAL}+ mentors from about ${PROSPECT_GOAL} prospects`, "Mentors", `Identify people first, engage on their posts for ${READY_DAYS}+ days (${READY_COMMENTS}+ real comments), then connect. The app tells you who is ready and what to send.`, `<button type="button" class="btn primary" data-act="new-prospect">${icon("add")} Add prospect</button>`)}
      <div class="funnel" role="tablist">${STAGES.map((s, i) => `<button type="button" class="fstage${ui.mentorFilter === s.id ? " on" : ""}" data-filter="${s.id}"><span class="mono">${counts[s.id] || 0}</span><span>${s.t}</span>${i < STAGES.length - 2 ? '<i class="fs-arrow" aria-hidden="true"></i>' : ""}</button>`).join("")}</div>
      <div class="toolbar">
        <div class="seg">${[["active", "In progress"], ["mentor", "Mentors"], ["parked", "Parked"], ["all", "All"]].map(([k, t]) => `<button type="button" class="${ui.mentorFilter === k ? "on" : ""}" data-filter="${k}">${t}</button>`).join("")}</div>
        <label class="search-wrap">${icon("finder")}<input id="mentor-search" class="search" type="search" placeholder="Search name, company, country" value="${esc(ui.mentorSearch)}" data-search="1"></label>
        <span class="muted small pipeline-count">${all.length}/${PROSPECT_GOAL} prospects in your pipeline</span>
      </div>
      <div class="pgrid">${list.length ? list.map(prospectCard).join("") : `<div class="panel empty-state"><h3>${all.length ? "No prospects match this filter" : "No prospects yet"}</h3><p class="muted">${all.length ? "Try another filter or clear the search." : "Use the Finder tab to search LinkedIn, then add people here."}</p>${all.length ? "" : `<div class="actions"><button type="button" class="btn primary" data-tab="finder">Open Finder</button></div>`}</div>`}</div>`;
  }

  function vFinder() {
    const f = ui.finder;
    const m = marketOf(f.market);
    const roles = {
      ds: '"data scientist"', mle: '"machine learning engineer"', risk: '"credit risk" ("data scientist" OR modeller OR modeler)', fraud: 'fraud ("data scientist" OR "machine learning")', analytics: '"analytics engineer" OR "senior data analyst"',
    };
    const tiers = { any: "(fintech OR payments OR lending OR bank OR neobank)", startup: '(fintech OR payments) (startup OR "Series A" OR "Series B")', mid: "(fintech OR payments OR neobank OR scale-up)", large: '(bank OR "financial services" OR payments)' };
    const notSenior = "NOT (director OR head OR VP OR chief OR principal OR founder)";
    const kw = `${roles[f.role]} ${tiers[f.tier]} ${notSenior}`;
    const place = { "us-e": '("New York" OR Boston OR Washington OR Charlotte)', "us-c": "(Chicago OR Austin OR Dallas OR Minneapolis)", "us-w": '("San Francisco" OR "Bay Area" OR Seattle OR "Los Angeles")' }[m.id] || `"${m.name}"`;
    const xray = `site:linkedin.com/in ${roles[f.role]} ${tiers[f.tier]} ${place} -director -head -vp -chief -principal`;
    const liPeople = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`;
    const liPosts = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(`${roles[f.role].split(" OR ")[0].replace(/[()]/g, "")} fintech`)}&sortBy=%22date_posted%22`;
    const google = `https://www.google.com/search?q=${encodeURIComponent(xray)}`;
    const sel = (id, key, opts) => `<select id="${id}" data-finder="${key}">${opts.map(([k, t]) => `<option value="${k}"${f[key] === k ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
    const tab = sub("finder", "search");
    const tabs = [["search", "Search"], ["companies", "Companies", m.companies.length], ["howto", "How to pick"], ["places", "Communities", N.places.length]];
    const filters = `<div class="fields filters">
          <label class="field"><span>Market</span>${sel("finder-market", "market", N.markets.map((x) => [x.id, x.name + (x.primary ? " ★" : "")]))}</label>
          <label class="field"><span>Role focus</span>${sel("finder-role", "role", [["ds", "Data scientist"], ["risk", "Credit risk modelling"], ["fraud", "Fraud / financial crime"], ["mle", "ML engineer"], ["analytics", "Analytics"]])}</label>
          <label class="field"><span>Company type</span>${sel("finder-tier", "tier", [["any", "Any fintech / bank"], ["startup", "Startups"], ["mid", "Mid-size / scale-ups"], ["large", "Large firms / banks"]])}</label>
        </div>`;
    let pane;
    if (tab === "companies") pane = `<section class="panel"><h3>Fintech companies in ${esc(m.name)}</h3><p class="muted small">Each opens a LinkedIn search for data scientists at that company. Change the market under Search.</p>
        <div class="company-grid">${m.companies.map((c) => `<a class="company" target="_blank" rel="noopener" href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`"data scientist" "${c.replace(/ \(.*\)/, "")}"`)}"><span class="avatar sq">${esc(initials(c))}</span><span>${esc(c)}</span></a>`).join("")}</div></section>`;
    else if (tab === "howto") pane = `<section class="panel"><h3>How to pick the right people</h3>
          <ol class="steps big">
            <li>Open 10–15 profiles from the searches in the Search tab.</li>
            <li>Keep people who <b>post or comment at least monthly</b>. Check <i>Activity</i> on their profile.</li>
            <li>Check the <b>fit criteria</b> (2–8 years, fintech, replies to comments, mentions mentoring).</li>
            <li>Click <b>Follow</b>, then the <b>bell icon</b> on their profile, so LinkedIn notifies you of every post.</li>
            <li>Press <button type="button" class="linkish" data-act="new-prospect">Add prospect</button>. The ${READY_DAYS}-day clock starts today.</li>
            <li>Add 3–5 people a week until you have about ${PROSPECT_GOAL}. Only about 1 in 10 becomes a mentor, and that's normal.</li>
          </ol>
          <p class="note"><b>Why the app doesn't scan LinkedIn for you:</b> LinkedIn has no public API for this and bans accounts that use scraping tools. The bell notification does the watching safely, and this app does the tracking and timing.</p>
        </section>`;
    else if (tab === "places") pane = `<section class="panel"><h3>Where mentors already gather</h3>
          <ul class="places grid">${N.places.map((p) => `<li>${link(p.u, p.t)}<span class="muted small">${esc(p.why)}</span></li>`).join("")}</ul>
        </section>`;
    else pane = `<section class="panel">${filters}
        <div class="search-cards">
          <div class="scard"><span class="sc-n">1</span><h4>LinkedIn people search</h4><p class="small">Opens LinkedIn with a ready-made search. Then click <b>Locations</b> and choose <b>${esc(m.name.replace(/ \(.*\)/, ""))}</b>.</p><code class="q">${esc(kw)}</code><div class="actions">${link(liPeople, "Open LinkedIn search")}<button type="button" class="btn sm ghost" data-copy="${esc(kw)}">Copy search</button></div></div>
          <div class="scard"><span class="sc-n">2</span><h4>People who post</h4><p class="small">Searches recent <b>posts</b>. Active posters are the ones you can engage with, so start here.</p><div class="actions">${link(liPosts, "Open recent posts")}</div></div>
          <div class="scard"><span class="sc-n">3</span><h4>Google X-ray</h4><p class="small">Finds public LinkedIn profiles through Google, useful when LinkedIn limits your searches.</p><code class="q">${esc(xray)}</code><div class="actions">${link(google, "Search Google")}<button type="button" class="btn sm ghost" data-copy="${esc(xray)}">Copy</button></div></div>
        </div>
      </section>`;
    return `${pageHead("Find mid-career fintech data scientists", "Finder", "Aim for people 2–8 years in: senior enough to guide you, not so senior they have no time. Pick a market, open the searches, then add the best people to Mentors.", segtabs("finder", tabs, tab))}${pane}`;
  }

  function fillTemplate(body, p) {
    const s = S();
    const n = weekNow();
    const map = {
      first: p && p.name ? p.name.trim().split(/\s+/)[0] : "[first name]",
      company: p && p.company ? p.company : "[company]",
      postTopic: p && p.postTopic ? p.postTopic : "[topic of their post]",
      myName: s.name || "[your name]",
      oneLiner: s.oneLiner || "[who you are in one line]",
      week: String(Math.min(Math.max(n, 1), TOTAL_WEEKS)),
      project: s.project || "[your latest project]",
      projectLink: s.projectLink || "[link]",
      ask: s.ask || "[one specific question]",
      win: s.win || "[something new you shipped]",
    };
    return body.replace(/\{(\w+)\}/g, (_, k) => (k in map ? map[k] : `{${k}}`));
  }

  function vMessages() {
    const p = PR()[ui.msgProspect] || null;
    const tab = sub("messages", "templates");
    const tabs = [["templates", "Templates", N.templates.length], ["comments", "Comment formula"], ["calls", "Call questions"]];
    const head = pageHead("Admire, add value, ask small", "Messages", `Never open with "will you mentor me?". Show you've followed their work, show what you've built, and make a small, specific ask. Mentorship grows from 2–3 good exchanges.`, segtabs("messages", tabs, tab));
    if (tab === "comments") return head + `<div class="grid2">
        <section class="panel"><h3>Comment formula (for the ${READY_DAYS}-day warm-up)</h3>
          <dl class="formula">${N.commentFormula.map((c) => `<dt>${esc(c.k)}</dt><dd>${esc(c.v)}</dd>`).join("")}</dl>
          <p class="muted small">Avoid "Great post!" and emoji-only comments: they build no familiarity.</p>
        </section>
        <section class="panel"><h3>Examples using your weekly problems</h3>
          <ul class="quotes">${N.commentExamples.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
        </section></div>`;
    if (tab === "calls") return head + `<section class="panel"><h3>Questions for a 15-minute call</h3>
          <ul class="steps big">${N.callQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
          <p class="note">Before the call, send your agenda in one line. Stop at 15 minutes, even if it's going well. Send the thank-you within 24 hours.</p>
        </section>`;
    const tid = N.templates.some((t) => t.id === ui.msgTemplate) ? ui.msgTemplate : N.templates[0].id;
    const t = N.templates.find((x) => x.id === tid);
    const text = fillTemplate(t.body, p);
    const over = t.limit && text.length > t.limit;
    return head + `<div class="md">
      <aside class="md-list panel">
        <label class="field"><span>Write to</span><select id="msg-prospect" data-msg-prospect="1"><option value="">(no one: show placeholders)</option>${prospects().map((x) => `<option value="${x.id}"${x.id === ui.msgProspect ? " selected" : ""}>${esc(x.name)}${x.company ? " · " + esc(x.company) : ""}</option>`).join("")}</select></label>
        ${p ? `<p class="small">${readiness(p).early && !readiness(p).ready ? `<span class="pill warn">Not ready yet</span> ${esc(nextAction(p).text)}` : `<span class="pill accent">Next step</span> ${esc((nextAction(p) || { text: "Parked." }).text)}`} ${localTime(p).label ? `· Their time: ${esc(localTime(p).label)}${localTime(p).good ? " (good time)" : " (best: Tue–Thu, 8–10am their time)"}` : ""}</p>` : ""}
        <nav class="tlist" aria-label="Templates">${N.templates.map((x, i) => `<button type="button" class="tl${x.id === tid ? " on" : ""}" data-template="${x.id}"><span class="tl-n">${i + 1}</span><span>${esc(x.stage)}</span></button>`).join("")}</nav>
      </aside>
      <article class="panel tmpl">
        <header><div><p class="eyebrow">Step ${N.templates.indexOf(t) + 1} of ${N.templates.length}</p><h3>${esc(t.stage)}</h3></div>${t.limit ? `<span class="pill ${over ? "bad" : "accent"}">${text.length}/${t.limit}</span>` : ""}</header>
        <p class="when">${icon("hours")}<span>${esc(fillTemplate(t.when, p))}</span></p>
        <pre class="msg" id="tmpl-${t.id}">${esc(text)}</pre>
        <div class="actions"><button type="button" class="btn primary" data-copy-el="tmpl-${t.id}">Copy message</button>${over ? `<span class="small bad-text">Over LinkedIn's free-account note limit. Shorten it.</span>` : ""}</div>
        <p class="muted small">Your details (name, one-liner, latest project, question) come from <button type="button" class="linkish" data-sub-go="settings:profile">Settings</button>. Anything in [brackets] needs your own words, which is what makes a message land.</p>
      </article>
    </div>`;
  }

  // ---------- studies ----------
  const courseName = (id) => (ST().courses.find((c) => c.id === id) || {}).name || "General";
  function todaysClasses() {
    const dow = new Date().getDay();
    const end = ST().semesterEnd;
    if (end && today() > end) return [];
    return ST().classes.filter((c) => Number(c.day) === dow).sort((a, b) => a.start.localeCompare(b.start));
  }
  function vStudies() {
    const st = ST();
    const t = today();
    const courseOpts = st.courses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    const byDay = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ d, items: st.classes.filter((c) => Number(c.day) === d).sort((a, b) => a.start.localeCompare(b.start)) }));
    const dls = [...st.deadlines].sort((a, b) => (a.done - b.done) || (a.due || "").localeCompare(b.due || ""));
    const open = st.deadlines.filter((d) => !d.done).length;
    const tab = sub("studies", "timetable");
    const tabs = [["timetable", "Timetable", st.classes.length || null], ["deadlines", "Deadlines", open || null], ["courses", "Courses", st.courses.length || null]];
    const head = pageHead("Your degree comes first", "Studies", `Put your classes and deadlines here so they show up on Today next to your ML plan. In exam weeks, tick "Exam week" in the Roadmap to lighten the load.`, segtabs("studies", tabs, tab));
    if (tab === "courses") return head + `<section class="panel narrow"><h3>Courses</h3>
          <form class="inline-form" id="course-form"><input id="course-name" name="name" required placeholder="e.g. Financial Accounting II"><button class="btn primary" type="submit">Add course</button></form>
          <ul class="plist">${st.courses.map((c) => `<li><span>${esc(c.name)}</span><span class="row-actions">${ui.confirm === "course:" + c.id ? `<button type="button" class="btn sm danger" data-act="del-course" data-id="${c.id}">Remove</button><button type="button" class="btn sm ghost" data-act="cancel-confirm">Keep</button>` : `<button type="button" class="btn sm ghost" data-act="ask-del-course" data-id="${c.id}">Remove</button>`}</span></li>`).join("") || `<li class="muted">No courses yet.</li>`}</ul>
          <label class="field"><span>Semester ends (classes stop showing after this)</span><input id="semester-end" type="date" data-semester="1" value="${esc(st.semesterEnd || "")}"></label>
        </section>`;
    if (tab === "deadlines") return head + `<section class="panel"><h3>Assignments, tests & exams</h3>
        <form class="fields" id="deadline-form">
          <label class="field wide"><span>What</span><input id="dl-title" name="title" required placeholder="Econometrics problem set 3"></label>
          <label class="field"><span>Course</span><select id="dl-course" name="course"><option value="">General</option>${courseOpts}</select></label>
          <label class="field"><span>Type</span><select id="dl-type" name="type">${["Assignment", "Test", "Exam", "Project", "Reading"].map((x) => `<option>${x}</option>`).join("")}</select></label>
          <label class="field"><span>Due</span><input id="dl-due" name="due" type="date" required value="${addDays(t, 7)}"></label>
          <div class="actions"><button class="btn primary" type="submit">Add</button></div>
        </form>
        <ul class="plist">${dls.map((d) => { const k = daysBetween(t, d.due); return `<li class="${d.done ? "is-done" : ""}"><label class="chk inline"><input type="checkbox" data-dl-done="${d.id}"${d.done ? " checked" : ""}><span><b>${esc(d.title)}</b> · ${esc(d.type)} · ${esc(courseName(d.course))} · ${fmt(d.due, { weekday: "short", month: "short", day: "numeric" })}</span></label>
          <span class="row-actions">${!d.done ? `<span class="pill ${k < 0 ? "bad" : k <= 3 ? "warn" : ""}">${k < 0 ? `${-k}d overdue` : k === 0 ? "today" : `in ${k}d`}</span>${link(gcal({ title: `${d.type}: ${d.title}`, date: d.due, allDay: true, details: courseName(d.course) }), "Remind me")}` : ""}<button type="button" class="x" aria-label="Remove" data-act="del-deadline" data-id="${d.id}">×</button></span></li>`; }).join("") || `<li class="muted">No deadlines yet.</li>`}</ul>
      </section>`;
    return head + `<section class="panel"><h3>Weekly timetable</h3>
        <div class="timetable">${byDay.map(({ d, items }) => `<div class="tday${Number(d) === new Date().getDay() ? " today" : ""}"><p class="eyebrow">${DAY_NAMES[d].slice(0, 3)}</p>${items.map((c) => `<div class="tclass"><span class="small">${esc(c.start)}–${esc(c.end)}</span><b>${esc(courseName(c.course))}</b>${c.place ? `<span class="muted small">${esc(c.place)}</span>` : ""}<button type="button" class="x" aria-label="Remove class" data-act="del-class" data-id="${c.id}">×</button></div>`).join("") || `<span class="muted small">—</span>`}</div>`).join("")}</div>
        ${st.classes.length ? `<p class="small muted">Add your timetable to Google Calendar: ${st.classes.map((c) => link(gcal({ title: courseName(c.course), date: nextDow(Number(c.day)), start: c.start, mins: Math.max(15, minutesBetween(c.start, c.end)), recur: `FREQ=WEEKLY${st.semesterEnd ? ";UNTIL=" + st.semesterEnd.replace(/-/g, "") : ""}`, details: c.place || "" }), `${DAY_NAMES[c.day].slice(0, 3)} ${courseName(c.course)}`)).join(" · ")}</p>` : ""}
        <details class="adder"${st.classes.length ? "" : " open"}><summary class="btn sm">${icon("add")} Add a class</summary>
          <form class="fields" id="class-form">
            <label class="field"><span>Course</span><select id="class-course" name="course" required>${courseOpts || `<option value="">Add a course first</option>`}</select></label>
            <label class="field"><span>Day</span><select id="class-day" name="day">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}">${DAY_NAMES[d]}</option>`).join("")}</select></label>
            <label class="field"><span>Start</span><input id="class-start" name="start" type="time" value="09:00" required></label>
            <label class="field"><span>End</span><input id="class-end" name="end" type="time" value="11:00" required></label>
            <label class="field"><span>Room (optional)</span><input id="class-place" name="place" placeholder="Room B204"></label>
            <div class="actions"><button class="btn primary" type="submit"${st.courses.length ? "" : " disabled"}>Add class</button>${st.courses.length ? "" : `<button type="button" class="linkish" data-sub="studies:courses">Add a course first</button>`}</div>
          </form>
        </details>
      </section>`;
  }
  function nextDow(dow) {
    const t = today();
    const cur = parse(t).getDay();
    return addDays(t, (dow - cur + 7) % 7);
  }
  function minutesBetween(a, b) {
    const [h1, m1] = a.split(":").map(Number); const [h2, m2] = b.split(":").map(Number);
    return (h2 * 60 + m2) - (h1 * 60 + m1);
  }

  function vProjects() {
    const tab = sub("projects", C.projects[0].id);
    const tabs = C.projects.map((pj) => [pj.id, pj.name.replace(/ \(bonus\)/, ""), isChecked(pj.id + "shipped") ? "Shipped" : countKeys(pj.milestones.map((_, i) => `${pj.id}m${i}`))]);
    const pj = C.projects.find((x) => x.id === tab) || C.projects[0];
    const ms = pj.milestones.map((_, i) => `${pj.id}m${i}`);
    const done = ms.filter(isChecked).length;
    const meta = P().projects[pj.id] || {};
    return `${pageHead(`Goal: ${PROJECT_GOAL}+ real-world projects`, "Projects", `Portfolio projects are your proof of value when you reach out to mentors and employers. Tick "Shipped" only when it's public: code, README and demo.`, segtabs("projects", tabs, pj.id))}
      <article class="panel project${isChecked(pj.id + "shipped") ? " shipped" : ""}">
        <div class="proj-head">
          <div class="pp-ring big">${ring(done / ms.length, 76, 7)}<span>${done}/${ms.length}</span></div>
          <div><p class="eyebrow">${esc(pj.weeks)}</p><h2>${esc(pj.name)}</h2><p class="muted">${esc(pj.summary)}</p></div>
        </div>
        <div class="grid2">
          <div class="stack"><p class="eyebrow">Milestones</p><div class="checks">${pj.milestones.map((m, i) => chk(`${pj.id}m${i}`, esc(m))).join("")}</div></div>
          <div class="stack">
            <p class="eyebrow">Links</p>
            <label class="field"><span>GitHub repo</span><input id="${pj.id}-repo" type="url" data-project="${pj.id}" data-field="repo" value="${esc(meta.repo || "")}" placeholder="https://github.com/…"></label>
            <label class="field"><span>Live demo</span><input id="${pj.id}-demo" type="url" data-project="${pj.id}" data-field="demo" value="${esc(meta.demo || "")}" placeholder="https://…streamlit.app"></label>
            <div class="checks ship">${chk(pj.id + "shipped", "<b>Shipped</b>: public repo, README, demo and launch post")}</div>
          </div>
        </div>
      </article>`;
  }

  function vProgress() {
    const now = weekNow();
    const goal = Number(S().weeklyGoalHours) || 10;
    const hours = Array.from({ length: TOTAL_WEEKS }, (_, i) => Number(P().hours[i + 1] || 0));
    const totalH = hours.reduce((a, b) => a + b, 0);
    const maxH = Math.max(goal * 1.5, ...hours, 1);
    const W = 780, H = 190, L = 34, B = 24, T = 10, bw = (W - L - 8) / TOTAL_WEEKS;
    const y = (v) => T + (H - T - B) * (1 - v / maxH);
    const ticks = [0, Math.round(maxH / 2), Math.round(maxH)];
    const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Hours studied per week">
      ${ticks.map((v) => `<line x1="${L}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`).join("")}
      <line x1="${L}" x2="${W - 4}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${W - 6}" y="${y(goal) - 5}" class="tick" text-anchor="end">goal ${goal}h</text>
      ${hours.map((h, i) => h > 0 ? `<rect x="${L + i * bw + 1.5}" y="${y(h)}" width="${Math.max(1, bw - 3)}" height="${y(0) - y(h)}" rx="1.5" class="${i + 1 === now ? "cur" : "hb"}"><title>Week ${i + 1}: ${h}h</title></rect>` : "").join("")}
      ${[1, 9, 17, 21, 33, 41, 52].map((w) => `<text x="${L + (w - 0.5) * bw}" y="${H - 6}" class="tick" text-anchor="middle">W${w}</text>`).join("")}
    </svg>`;
    const funnel = STAGES.filter((s) => s.id !== "parked").map((s) => {
      const idx = STAGES.findIndex((x) => x.id === s.id);
      const reached = prospects().filter((p) => STAGES.findIndex((x) => x.id === p.stage) >= idx && p.stage !== "parked").length;
      return { t: s.t, n: reached };
    });
    const fmax = Math.max(1, ...funnel.map((f) => f.n));
    const tab = sub("progress", "overview");
    const tabs = [["overview", "Overview"], ["breakdown", "Phases & mentors"], ["hours", "Hours", `${totalH}h`]];
    const head = pageHead("How far you've come", "Progress", "", segtabs("progress", tabs, tab));
    if (tab === "breakdown") return head + `<div class="grid2">
        <section class="panel"><h3>Phases</h3>${C.phases.map((ph) => `<div class="prow"><span class="plabel">${ph.id}. ${esc(ph.name)}</span>${bar(phasePct(ph))}<span class="mono small">${pct(phasePct(ph))}</span></div>`).join("")}</section>
        <section class="panel"><h3>Mentor funnel</h3><p class="muted small">People who reached each stage or beyond.</p>${funnel.map((f) => `<div class="prow"><span class="plabel">${esc(f.t)}</span>${bar(f.n / fmax, "gold")}<span class="mono small">${f.n}</span></div>`).join("")}</section>
      </div>`;
    if (tab === "hours") return head + `<section class="panel"><h3>Hours per week <span class="muted">${totalH} hours total</span></h3><div class="chart-wrap">${svg}</div></section>`;
    return head + `${kpis()}
      <section class="panel"><h3>52 weeks at a glance</h3><p class="muted small">Each square is a week; darker means more of it is checked off. Click one to open it.</p>
        <div class="weekgrid">${Array.from({ length: TOTAL_WEEKS }, (_, i) => { const n = i + 1; const p = weekPct(n); return `<button type="button" class="wcell${n === now ? " now" : ""}" style="--p:${p.toFixed(2)}" data-goto-week="${n}" title="Week ${n}: ${esc(weekOf(n).title)} (${pct(p)})"><span>${n}</span></button>`; }).join("")}</div>
      </section>`;
  }

  function vSettings() {
    const s = S();
    const field = (k, label, ph, type) => `<label class="field${type === "wide" ? " wide" : ""}"><span>${label}</span><input id="set-${k}" data-setting="${k}" value="${esc(s[k] || "")}" placeholder="${esc(ph || "")}"></label>`;
    const end = weekEnd(TOTAL_WEEKS).replace(/-/g, "");
    const byday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const gl = s.routine.map((r) => link(gcal({ title: `Study: ${r.label}`, date: nextOnOrAfter(s.startDate, Number(r.day)), start: r.start, mins: Number(r.mins) || 60, recur: `FREQ=WEEKLY;BYDAY=${byday[r.day]};UNTIL=${end}`, details: "Fintech ML Ledger: open the Today tab for this week's checklist." }), `${DAY_NAMES[r.day].slice(0, 3)} ${r.start} ${r.label}`));
    gl.unshift(link(gcal({ title: "LinkedIn: comment on prospects' posts", date: s.startDate, start: s.linkedinTime, mins: Number(s.linkedinMins) || 15, recur: `FREQ=DAILY;UNTIL=${end}`, details: "Open the Today tab > Engage today. One thoughtful comment each (anchor, add, ask), then press Log comment." }), `Daily ${s.linkedinTime} LinkedIn engagement`));
    gl.push(link(gcal({ title: "Mentors: monthly update + pipeline review", date: s.startDate, allDay: true, recur: `FREQ=WEEKLY;INTERVAL=4;UNTIL=${end}`, details: "Send monthly updates to mentors, add new prospects, review your funnel." }), "Every 4 weeks: mentor updates"));
    const tab = sub("settings", "profile");
    const tabs = [["profile", "About you"], ["schedule", "Plan & routine"], ["reminders", "Reminders"], ["data", "Your data"]];
    const head = pageHead("Your details, schedule and reminders", "Settings", "", segtabs("settings", tabs, tab));
    if (tab === "schedule") return head + `<section class="panel"><h3>Plan</h3>
        <div class="fields">
          <label class="field"><span>Start date (Week 1)</span><input id="set-start" type="date" data-setting="startDate" value="${esc(s.startDate)}"></label>
          <label class="field"><span>Weekly hours goal</span><input id="set-goal" type="number" min="1" max="60" data-setting="weeklyGoalHours" value="${esc(s.weeklyGoalHours)}"></label>
          <label class="field"><span>Daily LinkedIn time</span><input id="set-li" type="time" data-setting="linkedinTime" value="${esc(s.linkedinTime)}"></label>
          <label class="field"><span>LinkedIn minutes</span><input id="set-li-mins" type="number" min="5" max="60" data-setting="linkedinMins" value="${esc(s.linkedinMins)}"></label>
        </div>
        <p class="eyebrow">Weekly study routine</p>
        <div class="routine">${s.routine.map((r, i) => `<div class="rrow">
          <select id="r-day-${i}" data-routine="${i}" data-field="day" aria-label="Day">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}"${Number(r.day) === d ? " selected" : ""}>${DAY_NAMES[d]}</option>`).join("")}</select>
          <input id="r-start-${i}" type="time" data-routine="${i}" data-field="start" value="${esc(r.start)}" aria-label="Start">
          <input id="r-mins-${i}" type="number" min="15" step="15" data-routine="${i}" data-field="mins" value="${esc(r.mins)}" aria-label="Minutes">
          <input id="r-label-${i}" data-routine="${i}" data-field="label" value="${esc(r.label)}" aria-label="What">
          <button type="button" class="x" aria-label="Remove" data-act="del-routine" data-i="${i}">×</button></div>`).join("")}</div>
        <div class="actions"><button type="button" class="btn sm" data-act="add-routine">${icon("add")} Add session</button></div>
        <p class="muted small">Default: about ${Math.round(s.routine.reduce((a, r) => a + Number(r.mins || 0), 0) / 60)} hours a week plus ${s.linkedinMins} minutes of LinkedIn a day, which is manageable alongside a full course load.</p>
      </section>`;
    if (tab === "reminders") return head + `<section class="panel" id="reminders"><h3>Reminders on your phone</h3>
        <p>Tap each link once to add a repeating event to Google Calendar (it syncs to your phone's calendar and notifications). Prospect follow-ups and deadlines have their own <b>Add reminder</b> links.</p>
        <div class="linkcol">${gl.join("")}</div>
        <p class="muted small">Use Apple Calendar or Outlook? Download an .ics file with all reminders, including each week's topic and your prospect follow-ups. This works when the app is opened as a file on your computer; inside Claude, use the links above.</p>
        <div class="actions"><button type="button" class="btn" data-act="ics">Download calendar file (.ics)</button></div>
      </section>`;
    if (tab === "data") return head + `<section class="panel narrow"><h3>Your data</h3>
        <p><span id="sync" class="sync"></span></p>
        <div class="actions">
          <button type="button" class="btn" data-act="export">Export backup (.json)</button>
          <label class="btn file-btn">Import backup<input id="import-file" type="file" accept="application/json,.json" data-import="1"></label>
          ${ui.confirm === "reset" ? `<span class="confirm">Erase everything? <button type="button" class="btn danger" data-act="reset">Erase</button><button type="button" class="btn ghost" data-act="cancel-confirm">Cancel</button></span>` : `<button type="button" class="btn ghost" data-act="ask-reset">Reset all data</button>`}
        </div>
      </section>`;
    const mode = ls.get(THEME_KEY) || "system";
    return head + `<section class="panel"><h3>Appearance</h3>
        <div class="seg">${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([k, t]) => `<button type="button" class="${mode === k ? "on" : ""}" data-act="theme-mode" data-mode="${k}">${t}</button>`).join("")}</div>
        <p class="muted small">Also switch any time with the sun/moon toggle at the top. Saved on this device.</p></section>
      <section class="panel"><h3>About you (used in your messages)</h3>
        <div class="fields">
          ${field("name", "Your name", "Ada Okafor")}
          ${field("oneLiner", "Who you are in one line", "a finance student building ML for credit risk", "wide")}
          ${field("project", "Latest project", "a credit-risk EDA of 150k borrowers")}
          ${field("projectLink", "Project link", "https://github.com/…")}
          ${field("win", "Latest win (for follow-ups)", "deployed my first model API")}
          ${field("ask", "Your one specific question", "how do you choose thresholds for fraud alerts?", "wide")}
        </div></section>`;
  }
  function nextOnOrAfter(date, dow) {
    const cur = parse(date).getDay();
    return addDays(date, (dow - cur + 7) % 7);
  }

  // ---------- admissions: supervisors, resume builder, emails ----------
  const AD = window.ADMISSIONS || { supervisors: [], keyDates: [], tips: [], verifiedOn: "" };
  const AD_STATUSES = [
    ["new", "Not contacted"], ["research", "Reading their work"], ["ready", "Draft ready"], ["emailed", "Emailed"],
    ["followed", "Followed up"], ["replied", "Replied"], ["meeting", "Meeting / interview"], ["applied", "Applied"],
    ["offer", "Offer"], ["closed", "Closed / not a fit"],
  ];
  const AD_CONTACTED = ["emailed", "followed", "replied", "meeting", "applied", "offer"];
  const AD_CHECKS = [
    ["papers", "Read 2–3 of their recent papers"], ["idea", "Wrote a research idea that fits their work"], ["cv", "Tailored CV ready"],
    ["proposal", "2-page research proposal"], ["transcripts", "Transcripts ready (certified if required)"], ["english", "English test booked / waiver confirmed"],
    ["refs", "Referees asked (2–3)"], ["emailSent", "First email sent"], ["portal", "Formal application submitted on the portal"],
    ["funding", "Scholarship / funding applied for"], ["decision", "Decision received"],
  ];
  const A = () => Store.data.admissions;
  const supList = () => [...AD.supervisors, ...(A().custom || [])];
  const supOf = (id) => supList().find((s) => s.id === id);
  function recOf(id) {
    const r = A().recs;
    if (!r[id]) r[id] = { status: "new", papers: [], checks: {}, history: [], drafts: {} };
    const x = r[id];
    x.papers = x.papers || []; x.checks = x.checks || {}; x.history = x.history || []; x.drafts = x.drafts || {};
    return x;
  }
  const peekRec = (id) => A().recs[id] || { status: "new", papers: [], checks: {}, history: [], drafts: {} };
  const statusName = (k) => (AD_STATUSES.find((x) => x[0] === k) || AD_STATUSES[0])[1];
  const saveAd = () => Store.save("admissions");

  function salutation(s) {
    const parts = String(s.name || "").replace(/\([^)]*\)/g, "").split("&").map((x) => x.trim()).filter(Boolean);
    const one = (p) => {
      const t = /^(prof|assoc\.? ?prof|asst\.? ?prof|a\/prof)/i.test(p) ? "Professor" : /^dr/i.test(p) ? "Dr" : "";
      const words = p.replace(/^(assoc\.?\s*prof\.?|asst\.?\s*prof\.?|a\/prof\.?|prof\.?|dr\.?)\s*/i, "").trim().split(/\s+/);
      return (t ? t + " " : "") + words[words.length - 1];
    };
    const names = parts.map(one);
    return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0] || "Professor";
  }
  const interestShort = (s) => String(s.interests || "").split(/[,;]/).slice(0, 2).map((x) => x.trim()).filter(Boolean).join(" and ");
  function daysLeft(date) { return date ? daysBetween(today(), date) : null; }
  function countdown(date) {
    const d = daysLeft(date);
    if (d === null) return "";
    return d < 0 ? `<span class="pill">passed</span>` : `<span class="pill ${d <= 7 ? "bad" : d <= 30 ? "warn" : "accent"}">${d === 0 ? "today" : d === 1 ? "tomorrow" : d + " days left"}</span>`;
  }

  // ----- topic matching (drives resume tailoring and fit analysis) -----
  const TOPICS = [
    { k: "Blockchain & DLT", syn: ["blockchain", "dlt", "distributed ledger", "ethereum", "bitcoin", "consensus", "rollup", "layer-2", "layer 2", "smart contract", "smart-contract", "interoperab", "cross-chain"],
      tip: "Build a small on-chain analysis (e.g. Etherscan or Dune data) and write up 3 findings." },
    { k: "DeFi & crypto markets", syn: ["defi", "decentrali", "automated market maker", "amm", "dex", "lending protocol", "mev", "front-running", "flash-loan", "order book", "intents", "oracle"],
      tip: "Replicate a simple DeFi analysis (e.g. AMM price impact or lending liquidations) from public data." },
    { k: "Crypto assets & tokenisation", syn: ["crypto", "token", "nft", "ico", "stablecoin", "digital asset", "real-world-asset", "rwa"],
      tip: "Write a short data study on stablecoins or tokenised assets using public market data." },
    { k: "Payments, CBDC & digital money", syn: ["payment", "mobile money", "wallet", "cbdc", "digital euro", "digital money", "central bank digital", "stablecoin"],
      tip: "Your mobile-money fraud work (Roadmap Weeks 13–14, 29, 39) fits here; add a short note on CBDC design." },
    { k: "AI & machine learning", syn: ["machine learning", " ml", "ml ", "ai", "artificial intelligence", "deep learning", "neural", "federated", "agentic", "generative", "interpretable"],
      tip: "Roadmap Weeks 21–29 and 35–38 build this; ship the credit or fraud project and link it." },
    { k: "Security, privacy & cryptography", syn: ["security", "privacy", "zero-knowledge", "zk", "cryptograph", "vulnerab", "trusted hardware", "tee", "attack", "forensic", "anonymity", "identity"],
      tip: "Read 2 of the professor's papers and reproduce one small experiment or smart-contract vulnerability check." },
    { k: "Credit, lending & risk", syn: ["credit", "lending", "loan", "default", "risk"],
      tip: "Roadmap Weeks 22–27 and Project 1 (Credit Risk Scoring System) cover this directly." },
    { k: "Markets, trading & asset pricing", syn: ["asset pricing", "microstructure", "trading", "option pricing", "stock", "bond", "equity", "market structure", "exchange", "momentum", "pricing"],
      tip: "Roadmap Weeks 15 and 19 (portfolio analytics, PCA); add a trading or pricing mini-study." },
    { k: "Regulation, law & governance", syn: ["regulation", "law", "legal", "governance", "compliance", "policy", "techno-legal"],
      tip: "Write a 2-page policy brief (e.g. on stablecoin or crypto regulation) and add it to your CV." },
    { k: "Economics & mechanism design", syn: ["economic", "mechanism design", "incentive", "game theory", "auction", "cryptoeconomic", "tokenomics", "monetary", "inflation"],
      tip: "Summarise one mechanism-design paper in the professor's area and propose an extension." },
    { k: "Inclusive & sustainable finance", syn: ["inclusive", "inclusion", "sustainable", "esg", "green finance", "literacy", "africa", "islamic", "entrepreneur"],
      tip: "Analyse World Bank Global Findex data for your country and write up the findings." },
    { k: "Quantitative & computational methods", syn: ["stochastic", "numerical", "computational", "statistic", "econometric", "optimization", "operations research", "mixed-methods", "calculus", "linear algebra"],
      tip: "Roadmap Weeks 17–20 and 33–34 (probability, inference, optimisation, forecasting)." },
    { k: "Banking & financial services", syn: ["bank", "financial services", "venture capital", "capital markets", "digital financial"],
      tip: "Connect one of your projects to a real bank or fintech use case in its write-up." },
    { k: "Software & systems engineering", syn: ["software", "testing", "formal methods", "program analysis", "reliability", "scalab", "big data", "systems"],
      tip: "Roadmap Weeks 41–43 (packaging, tests, APIs, Docker); show a tested, deployed project." },
  ];
  const lc = (x) => " " + String(x || "").toLowerCase() + " ";
  const topicsIn = (text) => { const t = lc(text); return TOPICS.filter((tp) => tp.syn.some((w) => t.includes(w))).map((tp) => tp.k); };
  const supTopics = (s) => topicsIn([s.interests, s.programs, s.titleDept].join(" "));
  const itemText = (it) => [it.title, it.org, it.role, it.bullets, it.tags, it.cite, it.thesis, it.courses, it.degree].join(" ");
  function scoreItem(it, want) {
    const got = topicsIn(itemText(it));
    const tagHits = topicsIn(it.tags || "").filter((k) => want.includes(k)).length;
    return got.filter((k) => want.includes(k)).length * 2 + tagHits;
  }
  function fit(s) {
    const pf = A().profile;
    const want = supTopics(s);
    const mine = topicsIn([pf.interests, pf.headline, pf.skillsProg, pf.skillsMl, pf.skillsFin, pf.skillsTools, ...(pf.research || []).map(itemText), ...(pf.experience || []).map(itemText), ...(pf.education || []).map(itemText), ...(pf.publications || []).map(itemText)].join(" "));
    const covered = want.filter((k) => mine.includes(k));
    const gaps = want.filter((k) => !mine.includes(k));
    return { want, covered, gaps, score: want.length ? covered.length / want.length : 0 };
  }

  // ----- resume -----
  const pfLines = (x) => String(x || "").split(/\n+/).map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  function defaultStatement(s) {
    const pf = A().profile;
    const f = fit(s);
    const focus = (f.covered.length ? f.covered : f.want).slice(0, 3).join(", ");
    return `Prospective ${pf.targetDegree || "PhD"} researcher (${pf.intake || "2027 intake"}) interested in ${focus || "fintech"}. ${pf.interests ? pf.interests.trim().replace(/\.?$/, ".") : ""} I am particularly drawn to ${salutation(s).replace(/ and .*/, "")}'s work on ${interestShort(s).toLowerCase() || "fintech"}${pf.background ? `, and bring a background in ${pf.background.toLowerCase()}` : ""}.`.replace(/\s+/g, " ").trim();
  }
  function cvModel(s) {
    const pf = A().profile;
    const want = s ? supTopics(s) : [];
    const rank = (arr) => [...(arr || [])].map((it, i) => ({ it, i, sc: s ? scoreItem(it, want) : 0 })).sort((a, b) => b.sc - a.sc || a.i - b.i);
    const skills = [["Programming", pf.skillsProg], ["Machine learning & data", pf.skillsMl], ["Finance & domain", pf.skillsFin], ["Tools", pf.skillsTools], ["Languages", pf.languages]]
      .filter(([, v]) => v && v.trim())
      .map(([k, v]) => {
        const items = v.split(",").map((x) => x.trim()).filter(Boolean);
        const hit = (x) => s && topicsIn(x).some((t) => want.includes(t));
        return [k, [...items.filter(hit), ...items.filter((x) => !hit(x))], items.filter(hit)];
      });
    const rec = s ? peekRec(s.id) : {};
    return {
      pf, s, want,
      statement: s ? (rec.cvStatement || defaultStatement(s)) : (pf.interests || ""),
      research: rank(pf.research), experience: rank(pf.experience), education: pf.education || [], publications: pf.publications || [],
      skills, referees: pf.referees || [],
    };
  }
  function cvHtml(m, forFile) {
    const pf = m.pf;
    const contact = [pf.email, pf.phone, pf.location, pf.linkedin, pf.github, pf.website].filter(Boolean).map(esc).join(" · ");
    const sec = (t, inner) => inner ? `<section><h2>${t}</h2>${inner}</section>` : "";
    const item = (head, sub, dates, bullets, extra) => `<div class="cv-item"><div class="cv-row"><b>${head}</b><span>${dates || ""}</span></div>${sub ? `<div class="cv-sub">${sub}</div>` : ""}${bullets.length ? `<ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}${extra || ""}</div>`;
    const rel = (x) => (m.s && x.sc > 0 && !forFile ? ` <span class="cv-rel">relevant</span>` : "");
    const body = `
      <header><h1>${esc(pf.fullName || S().name || "Your Name")}</h1>${pf.headline ? `<p class="cv-head">${esc(pf.headline)}</p>` : ""}<p class="cv-contact">${contact || "email · phone · city, country · LinkedIn · GitHub"}</p></header>
      ${sec("Research interests", m.statement ? `<p>${esc(m.statement)}</p>` : "")}
      ${sec("Education", m.education.map((e) => item(esc(e.degree || ""), esc([e.school, e.location].filter(Boolean).join(", ")), esc([e.start, e.end].filter(Boolean).join(" – ")), [e.grade ? "Grade: " + e.grade : "", e.thesis ? "Thesis / final project: " + e.thesis : "", e.courses ? "Relevant courses: " + e.courses : ""].filter(Boolean))).join(""))}
      ${sec("Research & projects", m.research.map((x) => item(esc(x.it.title || "") + rel(x), esc(x.it.org || ""), esc(x.it.dates || ""), pfLines(x.it.bullets), x.it.link ? `<div class="cv-link">${esc(x.it.link)}</div>` : "")).join(""))}
      ${sec("Publications & writing", m.publications.map((p) => `<p class="cv-pub">${esc(p.cite || "")}${p.link ? ` <span class="cv-link">${esc(p.link)}</span>` : ""}</p>`).join(""))}
      ${sec("Experience", m.experience.map((x) => item(esc(x.it.role || "") + rel(x), esc(x.it.org || ""), esc(x.it.dates || ""), pfLines(x.it.bullets))).join(""))}
      ${sec("Skills", m.skills.map(([k, items, hits]) => `<p><b>${esc(k)}:</b> ${items.map((x) => hits.includes(x) && !forFile ? `<mark>${esc(x)}</mark>` : esc(x)).join(", ")}</p>`).join(""))}
      ${sec("Test scores", pf.tests ? `<p>${esc(pf.tests)}</p>` : "")}
      ${sec("Awards & activities", pfLines(pf.awards).length ? `<ul>${pfLines(pf.awards).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : "")}
      ${sec("Referees", m.referees.length ? m.referees.map((r) => `<p>${esc([r.name, r.title, r.org].filter(Boolean).join(", "))}${r.email ? " · " + esc(r.email) : ""}</p>`).join("") : "")}`;
    return body;
  }
  const CV_CSS = `body{margin:0;background:#eef1f7;font:10.5pt/1.45 "Nunito Sans","Segoe UI",Arial,sans-serif;color:#1a1f36}
    .cv{max-width:800px;margin:24px auto;background:#fff;padding:44px 52px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    header{border-bottom:3px solid #0033a1;padding-bottom:10px;margin-bottom:6px}h1{margin:0;font-size:22pt;color:#0033a1;letter-spacing:-.01em}
    .cv-head{margin:2px 0 4px;font-weight:700}.cv-contact{margin:0;color:#555;font-size:9.5pt}
    h2{font-size:10pt;text-transform:uppercase;letter-spacing:.08em;color:#0033a1;border-bottom:1px solid #d9dfeb;padding-bottom:3px;margin:16px 0 8px}
    p{margin:0 0 4px}.cv-item{margin-bottom:9px}.cv-row{display:flex;justify-content:space-between;gap:12px}.cv-row span{color:#555;white-space:nowrap}
    .cv-sub{font-style:italic;color:#444}ul{margin:3px 0 0 18px;padding:0}li{margin:1px 0}.cv-link{color:#0033a1;font-size:9pt}.cv-pub{margin-bottom:6px}
    @media print{body{background:#fff}.cv{box-shadow:none;margin:0;padding:0}}`;
  function cvDocument(s) {
    const m = cvModel(s);
    return `<!doctype html><html><head><meta charset="utf-8"><title>CV - ${esc(m.pf.fullName || S().name || "")}${s ? " - " + esc(s.university) : ""}</title><style>${CV_CSS}</style></head><body><div class="cv">${cvHtml(m, true)}</div></body></html>`;
  }
  function cvText(s) {
    const tmp = document.createElement("div");
    tmp.innerHTML = cvHtml(cvModel(s), true).replace(/<\/(h1|h2|p|li|div|section)>/g, "</$1>\n").replace(/<li>/g, "<li>• ");
    return tmp.textContent.replace(/\n{3,}/g, "\n\n").trim();
  }

  // ----- emails -----
  const AD_TEMPLATES = [
    { id: "inquiry", t: "First email (supervision inquiry)", when: "Your first contact. Under 200 words. Mention one specific paper in the first two lines.",
      subject: "Prospective {degree} student for {intake}: {topic}",
      body: "Dear {salutation},\n\nI recently read {paperRef} and was struck by {takeaway}.\n\nI am {oneLiner}{bgClause}. {bestProject}\n\nI would like to pursue a {degree} under your supervision, starting {intake}, on {idea}. This builds directly on your work on {interestShort}.\n\nWould you be open to supervising a new student for {intake}? I have attached my CV and transcripts, and I would be glad to send a 2-page research proposal.\n\nThank you for your time.\n\nKind regards,\n{name}\n{signature}" },
    { id: "posting", t: "Application for an open position", when: "For advertised posts (uni.lu, Waterloo, Macquarie/DFCRC, Monash, Calgary). Follow the posting's instructions exactly.",
      subject: "Application: {program}, {intake} start",
      body: "Dear {salutation},\n\nI am writing to apply for the {program} opportunity advertised on your page, starting {intake}.\n\nI am {oneLiner}{bgClause}. My most relevant work is {project}.\n\nYour research on {interestShort} matches what I want to work on: {idea}.\n\nAs requested, I have attached my CV{extraDocs}. I am happy to provide transcripts, references or a research proposal at any time.\n\nThank you for considering my application.\n\nKind regards,\n{name}\n{signature}" },
    { id: "follow1", t: "Follow-up (after 10 days)", when: "Only if there is no reply after about 10 days, and never where they ask for one email only.",
      subject: "Re: Prospective {degree} student for {intake}",
      body: "Dear {salutation},\n\nI hope you are well. I am following up on my email of {sentDate} about {degree} supervision for {intake}.\n\nSince then I have {win}. I remain very interested in your work on {interestShort}.\n\nIf you are not taking students this year, I would be grateful for a quick note, or a suggestion of a colleague I could contact.\n\nKind regards,\n{name}" },
    { id: "follow2", t: "Final follow-up (after 3 weeks)", when: "One last short note. After this, mark it closed and move on.",
      subject: "Re: {degree} supervision, {intake}",
      body: "Dear {salutation},\n\nA final short note on my supervision inquiry for {intake}. I understand you receive many emails, so I will not write again unless I hear from you.\n\nThank you, and I will keep following your work on {interestShort}.\n\nKind regards,\n{name}" },
    { id: "reply", t: "Reply after a positive response", when: "When they reply with interest. Answer every question they ask and propose times in their time zone.",
      subject: "Re: {degree} supervision, {intake}",
      body: "Dear {salutation},\n\nThank you very much for your reply. I am delighted that you are open to discussing supervision.\n\n[Answer each of their questions here.]\n\nI would welcome a short call. I am available [2–3 time slots in their time zone]. I will send my 2-page research proposal on {idea} before then.\n\nKind regards,\n{name}" },
    { id: "meeting", t: "Thank-you after a meeting", when: "Within 24 hours of the call or interview.",
      subject: "Thank you: {degree} supervision discussion",
      body: "Dear {salutation},\n\nThank you for taking the time to speak with me today. Your suggestion to [their advice] was very helpful, and I will [the next step you agreed].\n\nAs discussed, I will submit my application for {program} by [date] and let you know once it is in.\n\nKind regards,\n{name}" },
    { id: "statement", t: "Request a supervisor support statement", when: "For programmes that require a signed supervisor statement (e.g. RMIT's In-Principle Supervisor Supporting Statement). Only after they have agreed to supervise.",
      subject: "Supervisor supporting statement for my {degree} application",
      body: "Dear {salutation},\n\nThank you again for agreeing in principle to supervise my {degree}. The application requires a signed supervisor supporting statement, and the deadline is [deadline].\n\nI have attached the form with my details completed, along with my research proposal and CV. Please let me know if you would like me to change anything in the proposal.\n\nKind regards,\n{name}" },
    { id: "applied", t: "Tell them you have applied", when: "Right after you submit the formal application.",
      subject: "Application submitted: {program} ({intake})",
      body: "Dear {salutation},\n\nI wanted to let you know that I have submitted my application for {program} for {intake}. My application ID is {appId}. I named you as my prospective supervisor.\n\nThank you again for your support. I look forward to hearing from you.\n\nKind regards,\n{name}" },
    { id: "funding", t: "Ask whether a funded call will repeat", when: "For past calls (Concordia finance PhD, RMIT African fintech scholarship).",
      subject: "Question about funded {degree} positions for 2027",
      body: "Dear {salutation},\n\nI saw that you previously advertised a funded {degree} position on {interestShort}. I am {oneLiner}{bgClause}, and I am very interested in this area.\n\nWill a similar position be offered for {intake}? If so, I would be glad to send my CV and a short research proposal on {idea}.\n\nThank you for your time.\n\nKind regards,\n{name}" },
  ];
  function recommendedTemplate(s) {
    const r = peekRec(s.id);
    if (r.status === "replied") return "reply";
    if (r.status === "meeting") return "meeting";
    if (r.status === "applied") return "applied";
    if (r.status === "emailed") return s.oneEmailOnly ? "inquiry" : "follow1";
    if (r.status === "followed") return "follow2";
    if (s.pastCall) return "funding";
    if (s.portal || s.n === 11) return "posting";
    return "inquiry";
  }
  function emailFill(str, s) {
    const pf = A().profile;
    const r = peekRec(s.id);
    const p0 = (r.papers || []).find((p) => p && p.t);
    const top = cvModel(s).research[0];
    const map = {
      salutation: salutation(s),
      degree: pf.targetDegree || "PhD",
      intake: pf.intake || String(s.session || "").split(/[;(]/)[0].trim() || "2027",
      topic: interestShort(s) || "fintech research",
      paperRef: p0 ? `your paper "${p0.t}"` : "[your recent paper: title]",
      takeaway: p0 && p0.n ? p0.n : "[one specific idea from it]",
      oneLiner: S().oneLiner || "[who you are in one line]",
      bgClause: pf.background ? `, with a background in ${pf.background.toLowerCase()}` : "",
      bestProject: top && top.it.title ? `Most relevant to your work, I ${top.it.org ? "worked on" : "built"} ${top.it.title}${pfLines(top.it.bullets)[0] ? ": " + pfLines(top.it.bullets)[0].replace(/\.$/, "") : ""}.` : "[your most relevant project, in one sentence].",
      project: top && top.it.title ? `${top.it.title}${pfLines(top.it.bullets)[0] ? " (" + pfLines(top.it.bullets)[0].replace(/\.$/, "") + ")" : ""}` : "[your most relevant project]",
      idea: r.idea ? r.idea.trim().replace(/\.$/, "") : "[your research idea in one line]",
      interestShort: (interestShort(s) || "fintech").toLowerCase(),
      program: String(s.programs || "the programme").split(/[;(]/)[0].trim(),
      extraDocs: /transcript|certificate/i.test(s.contact) ? ", transcripts and certificates" : "",
      name: pf.fullName || S().name || "[your name]",
      signature: [pf.email, pf.linkedin].filter(Boolean).join(" | ") || "[email] | [LinkedIn]",
      sentDate: r.contacted ? fmt(r.contacted, { day: "numeric", month: "long" }) : "[date]",
      win: S().win || "[something new you have done since]",
      appId: r.appId || "[application ID]",
    };
    return str.replace(/\{(\w+)\}/g, (_, k) => (k in map ? map[k] : `{${k}}`));
  }
  function draftFor(s, tid) {
    const r = peekRec(s.id);
    const t = AD_TEMPLATES.find((x) => x.id === tid) || AD_TEMPLATES[0];
    const d = r.drafts && r.drafts[tid];
    return { subject: d && d.subject != null ? d.subject : emailFill(t.subject, s), body: d && d.body != null ? d.body : emailFill(t.body, s), edited: !!d };
  }
  const wordCount = (x) => (String(x).trim().match(/\S+/g) || []).length;

  // ----- Claude polishing (only inside the Claude viewer, with the viewer's consent) -----
  let samplerP = null;
  function getSampler() {
    if (!window.claude || typeof window.claude.use !== "function") return Promise.resolve(null);
    if (!samplerP) samplerP = window.claude.use("sample").catch(() => null);
    return samplerP;
  }
  function supBrief(s) {
    return `Name: ${s.name}\nRole: ${s.titleDept}\nUniversity: ${s.university} (${s.country})\nProgramme(s): ${s.programs}\nResearch interests: ${s.interests}\nRecruiting status: ${s.accepting}\nIntake: ${s.session}\nHow to contact: ${s.contact}`;
  }
  function profileBrief(s) {
    const pf = A().profile;
    const r = peekRec(s.id);
    return `Name: ${pf.fullName || S().name}\nTarget: ${pf.targetDegree} starting ${pf.intake}\nBackground: ${pf.background}\nHeadline: ${pf.headline}\nOne-liner: ${S().oneLiner}\nResearch interests: ${pf.interests}\n` +
      `Education: ${(pf.education || []).map((e) => [e.degree, e.school, e.grade, e.thesis].filter(Boolean).join(", ")).join(" | ")}\n` +
      `Projects/research: ${(pf.research || []).map((x) => `${x.title} (${x.tags || ""}): ${pfLines(x.bullets).join("; ")}`).join(" | ")}\n` +
      `Experience: ${(pf.experience || []).map((x) => `${x.role} at ${x.org}: ${pfLines(x.bullets).join("; ")}`).join(" | ")}\n` +
      `Skills: ${[pf.skillsProg, pf.skillsMl, pf.skillsFin, pf.skillsTools].filter(Boolean).join(", ")}\n` +
      `Papers of theirs the student read: ${(r.papers || []).filter((p) => p && p.t).map((p) => `"${p.t}": ${p.n || ""}`).join(" | ") || "none logged"}\nStudent's research idea: ${r.idea || "not written yet"}`;
  }
  let polishCtl = null;
  async function polish(kind, sid, tid) {
    const s = supOf(sid);
    if (!s) return;
    const sample = await getSampler();
    if (!sample) { showToast("Polishing with Claude works inside the Claude app"); return; }
    const out = $(kind === "email" ? "#ad-body" : "#ad-statement");
    const status = $("#ad-polish-status");
    if (polishCtl) polishCtl.abort();
    polishCtl = new AbortController();
    if (status) status.textContent = "Claude is thinking…";
    const rules = "Rules: be specific, warm and professional; never invent facts, grades, publications, experience or papers that are not given below; where information is missing, keep a short placeholder in [square brackets]; plain text only.";
    const prompt = kind === "email"
      ? `Improve this email from a prospective research student to a potential supervisor. Keep it under 200 words, mention the professor's specific research, state the target intake and end with one clear, small request. Follow any contact instructions exactly. ${rules}\nReturn only the email: the first line "Subject: ...", a blank line, then the body.\n\nPROFESSOR\n${supBrief(s)}\n\nSTUDENT\n${profileBrief(s)}\n\nCURRENT DRAFT\nSubject: ${$("#ad-subject") ? $("#ad-subject").value : ""}\n\n${out ? out.value : ""}`
      : `Write a tailored "Research interests" paragraph (70–100 words, first person omitted, CV style) for this student's CV, aimed at this specific professor. Connect the student's real projects and skills to the professor's research themes. ${rules}\nReturn only the paragraph.\n\nPROFESSOR\n${supBrief(s)}\n\nSTUDENT\n${profileBrief(s)}`;
    try {
      const { text } = await sample(prompt, { signal: polishCtl.signal, modelTier: "default", onText: ({ text: t }) => { if (out) out.value = t; } });
      const rec = recOf(sid);
      if (kind === "email") {
        const m = text.match(/^\s*Subject:\s*(.+)\n+([\s\S]*)$/i);
        const subject = m ? m[1].trim() : ($("#ad-subject") ? $("#ad-subject").value : "");
        const body = m ? m[2].trim() : text.trim();
        rec.drafts[tid] = { subject, body };
        if ($("#ad-subject")) $("#ad-subject").value = subject;
        if (out) out.value = body;
      } else {
        rec.cvStatement = text.trim();
      }
      saveAd();
      if (status) status.textContent = "Polished by Claude. Check every sentence is true before sending.";
      if (kind !== "email") rerender();
    } catch (e) {
      if (status) status.textContent = e && e.code === "cancelled" ? "Stopped." : e && e.code === "not_granted" ? "Claude access was declined for this page." : "Couldn't polish right now. Your draft is unchanged.";
    }
  }

  // ----- profile sprint (strong profile before December) -----
  const SPRINT = [
    { by: "2026-10-05", items: [
      ["s-profile", "Fill in My profile completely (education, projects, skills)"],
      ["s-transcripts", "Request official transcripts for every degree (these can take weeks)"],
      ["s-refs", "Ask 3 referees (at least 2 academics) and send them your CV and target list"],
      ["s-english", "Book IELTS Academic or TOEFL, or confirm a waiver (e.g. Calgary accepts English-medium degrees)"],
      ["s-calgary", "Email Dr Sara Rouhani (Calgary, Winter 2027). One email only"],
      ["s-waterloo", "Submit the Waterloo expression-of-interest form (Prof. Justin Wan)"],
      ["s-aw3", "Submit the aw3.ca form (reaches 20+ Canadian blockchain researchers)"],
    ] },
    { by: "2026-10-15", items: [
      ["s-proposal", "Write a 2-page research proposal you can adapt per professor"],
      ["s-papers", "Read 2–3 papers for each Priority A supervisor and log them in the app"],
      ["s-orcid", "Create an ORCID iD and update your LinkedIn headline and About"],
      ["s-unilu", "Apply to the uni.lu FINATRAX posting and the Department of Finance (MQEF + job portal)"],
      ["s-aus", "Contact Macquarie / Digital Finance CRC (Prof. Jian Yang) and the Monash FinTech Lab"],
    ] },
    { by: "2026-10-31", items: [
      ["s-project", "Publish one research-style fintech project on GitHub with a clear write-up"],
      ["s-note", "Turn a project into a short research note or blog post and link it in your CV"],
      ["s-prioB", "Send all Priority B emails"],
    ] },
    { by: "2026-11-06", items: [
      ["s-wpi", "Submit the WPI FinTech PhD application for Spring (January) 2027"],
    ] },
    { by: "2026-12-15", items: [
      ["s-prioC", "Send all Priority C emails"],
      ["s-gre", "Check which US programmes need the GRE and book it if needed"],
      ["s-sop", "Write a statement of purpose for each programme you apply to"],
      ["s-apply", "Submit Fall/September 2027 applications (most deadlines Dec–Jan)"],
      ["s-pitch", "Practise a 5-minute pitch of your research idea for interviews"],
      ["s-visa", "List visa steps and costs for each country so you can move fast after an offer"],
    ] },
  ];
  const sprintKeys = () => SPRINT.flatMap((g) => g.items.map((x) => x[0]));

  // ----- profile editor -----
  const PSECTIONS = {
    education: { t: "Education", add: "Add degree", fields: [["degree", "Degree (e.g. BSc Accounting)"], ["school", "Institution"], ["location", "City, country"], ["start", "Start (e.g. 2019)"], ["end", "End (e.g. 2023)"], ["grade", "Grade / GPA / class"], ["thesis", "Thesis or final project", "wide"], ["courses", "Relevant courses (comma separated)", "wide"]] },
    research: { t: "Research & projects", add: "Add project", fields: [["title", "Title"], ["org", "Where / with whom"], ["dates", "Dates"], ["link", "Link (GitHub, paper, demo)"], ["bullets", "What you did and found (one per line, with numbers)", "area"], ["tags", "Keywords (e.g. blockchain, credit risk, machine learning)", "wide"]] },
    experience: { t: "Work experience", add: "Add role", fields: [["role", "Role"], ["org", "Organisation"], ["dates", "Dates"], ["bullets", "Achievements (one per line)", "area"]] },
    publications: { t: "Publications & writing", add: "Add item", fields: [["cite", "Citation or title (reports, posts and preprints count)", "wide"], ["link", "Link"]] },
    referees: { t: "Referees", add: "Add referee", fields: [["name", "Name"], ["title", "Title"], ["org", "Institution"], ["email", "Email"]] },
  };
  function profileCompleteness() {
    const pf = A().profile;
    const checks = [pf.fullName || S().name, pf.email, pf.background, pf.interests, (pf.education || []).length, (pf.research || []).length >= 2, pf.skillsProg, (pf.referees || []).length >= 2, pf.tests];
    return checks.filter(Boolean).length / checks.length;
  }
  function importTrackerProjects() {
    const pf = A().profile;
    pf.research = pf.research || [];
    let added = 0;
    C.projects.forEach((pj) => {
      const done = pj.milestones.filter((_, i) => isChecked(`${pj.id}m${i}`)).length;
      if (!done || pf.research.some((x) => x.title === pj.name)) return;
      const meta = P().projects[pj.id] || {};
      pf.research.push({ title: pj.name, org: "Independent project", dates: pj.weeks.replace("Weeks", "2027, weeks"), link: meta.repo || meta.demo || "", bullets: pj.summary + (isChecked(pj.id + "shipped") ? "\nShipped publicly with code, README and live demo." : `\nIn progress: ${done}/${pj.milestones.length} milestones.`), tags: pj.id === "p1" ? "credit risk, machine learning, explainability, fairness" : pj.id === "p2" ? "fraud, payments, machine learning, graph, API" : "churn, machine learning, banking" });
      added++;
    });
    const doneWeeks = C.weeks.filter((w) => weekPct(w.n) >= 0.6);
    if (doneWeeks.length >= 4 && !pf.research.some((x) => x.title === "Fintech data science programme (self-directed)")) {
      pf.research.push({ title: "Fintech data science programme (self-directed)", org: "52-week structured curriculum", dates: `${fmt(S().startDate, { month: "short", year: "numeric" })} – present`, link: "", bullets: `Completed ${doneWeeks.length} of 52 weeks of weekly real-world fintech problems (credit, fraud, payments, markets).\nSkills covered so far: ${[...new Set(doneWeeks.map((w) => phaseOf(w.n).name))].join(", ")}.`, tags: "machine learning, credit, fraud, payments, python, sql" });
      added++;
    }
    saveAd();
    return added;
  }

  // ----- views -----
  function supCard(s) {
    const r = peekRec(s.id);
    const dl = s.deadline ? countdown(s.deadline) : "";
    const due = r.followUp && r.followUp <= today() && !["replied", "meeting", "applied", "offer", "closed"].includes(r.status);
    return `<article class="scard2 pr-${s.priority}${r.status === "offer" ? " won" : ""}">
      <header><span class="prio" title="Priority ${s.priority}">${s.priority}</span>
        <div class="pc-id"><h4><button type="button" class="linkish strong" data-ad-open="${s.id}">${esc(s.name)}</button></h4><p class="muted small">${esc(s.university)} · ${esc(s.country)}</p></div>
        <select class="stage-select" data-ad-status="${s.id}" aria-label="Status">${AD_STATUSES.map(([k, t]) => `<option value="${k}"${k === r.status ? " selected" : ""}>${t}</option>`).join("")}</select></header>
      <p class="small clamp2"><b>Interests:</b> ${esc(s.interests)}</p>
      <div class="pmeta"><span class="pill ${/^YES|OPEN|PROGRAM ADMITTING|INVITES|DEPARTMENT RECRUITING/i.test(s.accepting) ? "accent" : ""}">${esc(String(s.accepting).split(/ - |\. /)[0].slice(0, 42))}</span><span class="pill">${esc(String(s.session).split(/[;(]/)[0].slice(0, 40))}</span>${dl}${s.urgent && !s.deadline ? `<span class="pill bad">urgent</span>` : ""}${s.oneEmailOnly ? `<span class="pill warn">one email only</span>` : ""}${s.warning ? `<span class="pill warn">check eligibility</span>` : ""}${due ? `<span class="pill bad">follow-up due</span>` : ""}</div>
      <div class="actions"><button type="button" class="btn sm primary" data-ad-go="emails" data-sid="${s.id}">Draft email</button><button type="button" class="btn sm" data-ad-go="resume" data-sid="${s.id}">Tailor CV</button><button type="button" class="btn sm ghost" data-ad-open="${s.id}">Details</button></div>
    </article>`;
  }

  function supDrawer(s) {
    const r = recOf(s.id);
    const info = [["Programme(s)", s.programs], ["Research interests", s.interests], ["Accepting students? (verified)", s.accepting], ["Session / intake", s.session], ["Funding", s.funding], ["How to contact / apply", s.contact], ["Key date / deadline", s.keyDate]];
    return `<div class="panel form ad-drawer">
      <div class="proj-head"><span class="prio big">${s.priority}</span><div><p class="eyebrow">${esc(s.country)} · Priority ${s.priority}</p><h3>${esc(s.name)}</h3><p class="muted small">${esc(s.titleDept)}<br>${esc(s.university)}</p></div></div>
      ${s.warning ? `<p class="note warn-note">${esc(s.warning)}</p>` : ""}${s.oneEmailOnly ? `<p class="note warn-note">They ask for one email only: no follow-ups.</p>` : ""}
      <dl class="info">${info.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v || "Not stated")}</dd>`).join("")}</dl>
      ${s.source ? `<p class="small">${link(s.source, "Official page")} <span class="muted">· checked ${fmt(AD.verifiedOn || today(), { day: "numeric", month: "short", year: "numeric" })}. Re-check before applying.</span></p>` : ""}
      <p class="eyebrow">Your tracking</p>
      <div class="fields">
        <label class="field"><span>Status</span><select id="ad-st-${s.id}" data-ad-status="${s.id}">${AD_STATUSES.map(([k, t]) => `<option value="${k}"${k === r.status ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field"><span>Date contacted</span><input type="date" id="ad-c-${s.id}" data-adr="${s.id}:contacted" value="${esc(r.contacted || "")}"></label>
        <label class="field"><span>Next follow-up</span><input type="date" id="ad-f-${s.id}" data-adr="${s.id}:followUp" value="${esc(r.followUp || "")}"></label>
        <label class="field"><span>Email to use</span><input type="email" id="ad-e-${s.id}" data-adr="${s.id}:email" value="${esc(r.email || (s.emails || [])[0] || "")}" placeholder="from their university page"></label>
        <label class="field"><span>Application ID</span><input id="ad-a-${s.id}" data-adr="${s.id}:appId" value="${esc(r.appId || "")}"></label>
        <label class="field wide"><span>Reply / next step</span><textarea id="ad-n-${s.id}" rows="2" data-adr="${s.id}:notes">${esc(r.notes || "")}</textarea></label>
      </div>
      <p class="eyebrow">Papers of theirs you read (used in your email)</p>
      ${[0, 1, 2].map((i) => { const p = r.papers[i] || {}; return `<div class="fields paper"><label class="field"><span>Title ${i + 1}</span><input id="ad-p${i}t-${s.id}" data-adp="${s.id}:${i}:t" value="${esc(p.t || "")}"></label><label class="field"><span>Link</span><input id="ad-p${i}u-${s.id}" data-adp="${s.id}:${i}:u" value="${esc(p.u || "")}"></label><label class="field wide"><span>What struck you (one sentence)</span><input id="ad-p${i}n-${s.id}" data-adp="${s.id}:${i}:n" value="${esc(p.n || "")}"></label></div>`; }).join("")}
      <label class="field wide"><span>Your research idea for them (one line)</span><textarea id="ad-i-${s.id}" rows="2" data-adr="${s.id}:idea" placeholder="e.g. detecting mule accounts in mobile-money networks with graph ML">${esc(r.idea || "")}</textarea></label>
      <p class="eyebrow">Application checklist</p>
      <div class="checks cols">${AD_CHECKS.map(([k, t]) => `<label class="chk${r.checks[k] ? " is-done" : ""}"><input type="checkbox" data-adc="${s.id}:${k}"${r.checks[k] ? " checked" : ""}><span>${t}</span></label>`).join("")}</div>
      ${r.history.length ? `<p class="eyebrow">History</p><ul class="plist">${r.history.map((h) => `<li><span>${fmt(h.d, { day: "numeric", month: "short" })} · ${esc(h.what)}</span></li>`).join("")}</ul>` : ""}
      <div class="actions"><button type="button" class="btn primary" data-ad-go="emails" data-sid="${s.id}">Draft email</button><button type="button" class="btn" data-ad-go="resume" data-sid="${s.id}">Tailor CV</button>${s.custom ? `<button type="button" class="btn ghost danger-text" data-act="ad-del-custom" data-id="${s.id}">Remove</button>` : ""}</div>
    </div>`;
  }

  function customForm() {
    return `<form class="panel form" id="ad-custom-form"><h3>Add a supervisor</h3>
      <div class="fields">
        <label class="field"><span>Name *</span><input name="name" id="adc-name" required placeholder="Prof. Jane Doe"></label>
        <label class="field"><span>University *</span><input name="university" id="adc-uni" required></label>
        <label class="field"><span>Country</span><input name="country" id="adc-country" placeholder="Canada"></label>
        <label class="field"><span>Priority</span><select name="priority" id="adc-prio"><option>A</option><option selected>B</option><option>C</option></select></label>
        <label class="field wide"><span>Title & department</span><input name="titleDept" id="adc-dept"></label>
        <label class="field wide"><span>Programme(s)</span><input name="programs" id="adc-prog"></label>
        <label class="field wide"><span>Research interests</span><textarea name="interests" id="adc-int" rows="2"></textarea></label>
        <label class="field wide"><span>Accepting students? (what their page says)</span><input name="accepting" id="adc-acc"></label>
        <label class="field"><span>Session / intake</span><input name="session" id="adc-ses" placeholder="Sept 2027"></label>
        <label class="field"><span>Deadline</span><input name="deadline" id="adc-dl" type="date"></label>
        <label class="field"><span>Email</span><input name="email" id="adc-em" type="email"></label>
        <label class="field wide"><span>Official page</span><input name="source" id="adc-src" type="url"></label>
      </div>
      <div class="actions"><button type="submit" class="btn primary">Add supervisor</button><button type="button" class="btn" data-act="cancel-edit">Cancel</button></div></form>`;
  }

  function supPicker(sid) {
    return `<label class="field"><span>Supervisor</span><select id="ad-sel" data-ad-sel="1">${["A", "B", "C"].map((pr) => `<optgroup label="Priority ${pr}">${supList().filter((s) => s.priority === pr).map((s) => `<option value="${s.id}"${s.id === sid ? " selected" : ""}>${esc(s.name)} · ${esc(s.university)}</option>`).join("")}</optgroup>`).join("")}</select></label>`;
  }
  const currentSup = () => supOf(ui.adSel) || supList()[0];

  function vAdmissions() {
    const tab = sub("admissions", "pipeline");
    const all = supList();
    const contacted = all.filter((s) => AD_CONTACTED.includes(peekRec(s.id).status)).length;
    const replies = all.filter((s) => ["replied", "meeting", "applied", "offer"].includes(peekRec(s.id).status)).length;
    const dueN = all.filter((s) => { const r = peekRec(s.id); return r.followUp && r.followUp <= today() && !["replied", "meeting", "applied", "offer", "closed"].includes(r.status); }).length;
    const sprintDone = sprintKeys().filter((k) => A().sprint[k]).length;
    const tabs = [["pipeline", "Supervisors", all.length], ["deadlines", "Deadlines", dueN || null], ["emails", "Emails"], ["resume", "Resume builder"], ["profile", "My profile", pct(profileCompleteness())], ["sprint", "Profile sprint", `${sprintDone}/${sprintKeys().length}`]];
    const head = pageHead(`Target intake: January or September 2027 · data checked ${fmt(AD.verifiedOn || today(), { day: "numeric", month: "short" })}`, "Admissions", "Find a supervisor, tailor your CV to them, email, follow up and apply, all tracked in one place.", segtabs("admissions", tabs, tab));
    const strip = `<div class="kpis ad-kpis">
      <div class="kpi"><span class="kpi-k">Contacted</span><span class="kpi-v">${contacted}<small>/${all.length}</small></span>${bar(contacted / Math.max(1, all.length))}</div>
      <div class="kpi"><span class="kpi-k">Replies</span><span class="kpi-v">${replies}</span><span class="kpi-note">replied, meeting or applied</span></div>
      <div class="kpi"><span class="kpi-k">Follow-ups due</span><span class="kpi-v">${dueN}</span><span class="kpi-note">${dueN ? "see Deadlines" : "all clear"}</span></div>
      <div class="kpi"><span class="kpi-k">Profile</span><span class="kpi-v">${pct(profileCompleteness())}</span>${bar(profileCompleteness(), "gold")}</div>
    </div>`;

    if (tab === "deadlines") {
      const kd = AD.keyDates.map((k) => ({ ...k, days: daysLeft(k.date) }));
      const fus = all.map((s) => ({ s, r: peekRec(s.id) })).filter(({ r }) => r.followUp && !["replied", "meeting", "applied", "offer", "closed"].includes(r.status)).sort((a, b) => a.r.followUp.localeCompare(b.r.followUp));
      const sd = all.filter((s) => s.deadline || s.urgent).sort((a, b) => (a.deadline || "0").localeCompare(b.deadline || "0"));
      return `${head}
        <div class="grid2">
          <section class="panel"><h3>${icon("hours")} Key dates</h3>
            <ul class="timeline">${kd.map((k) => `<li class="${k.days !== null && k.days < 0 ? "past" : ""}"><span class="tl-date">${esc(k.when)}</span><span>${esc(k.what)}</span><span class="row-actions">${k.date ? countdown(k.date) : ""}${k.date && k.days >= 0 ? link(gcal({ title: "Admissions: " + k.what.slice(0, 60), date: k.date, allDay: true, details: k.what }), "Remind me") : ""}</span></li>`).join("")}</ul>
            ${daysLeft("2026-09-30") !== null && daysLeft("2026-09-30") >= 0 ? `<p class="note warn-note"><b>RMIT closes ${daysLeft("2026-09-30") === 0 ? "today" : "tomorrow"}</b> and needs a signed supervisor statement. It is only realistic if an RMIT supervisor has already agreed; otherwise ask Prof. Berg or Prof. Rennie about RMIT's next round or monthly intakes.</p>` : ""}
          </section>
          <section class="panel"><h3>${icon("mentors")} Supervisor deadlines</h3>
            <ul class="plist">${sd.map((s) => `<li><span><b>${esc(s.name)}</b> <span class="muted">· ${esc(s.university)}</span><span class="muted small pl-note">${esc(s.deadlineNote || s.keyDate)}</span></span><span class="row-actions">${s.deadline ? countdown(s.deadline) : `<span class="pill bad">now</span>`}<button type="button" class="btn sm" data-ad-go="emails" data-sid="${s.id}">Email</button></span></li>`).join("")}</ul>
            <h4 class="lh">Follow-ups</h4>
            ${fus.length ? `<ul class="plist">${fus.map(({ s, r }) => `<li><span><b>${esc(s.name)}</b> <span class="muted">· ${statusName(r.status)}</span></span><span class="row-actions"><span class="pill ${r.followUp <= today() ? "bad" : ""}">${r.followUp <= today() ? "due" : fmt(r.followUp)}</span><button type="button" class="btn sm" data-ad-go="emails" data-sid="${s.id}">Follow up</button></span></li>`).join("")}</ul>` : `<p class="muted">No follow-ups scheduled. When you mark an email as sent, the app schedules one 10 days later (never for people who ask for one email only).</p>`}
          </section>
        </div>`;
    }

    if (tab === "profile") {
      const pf = A().profile;
      const f = (k, label, ph, wide) => `<label class="field${wide ? " wide" : ""}"><span>${label}</span><input id="pf-${k}" data-pfv="${k}" value="${esc(pf[k] || "")}" placeholder="${esc(ph || "")}"></label>`;
      const ta = (k, label, ph) => `<label class="field wide"><span>${label}</span><textarea id="pf-${k}" rows="3" data-pfv="${k}" placeholder="${esc(ph || "")}">${esc(pf[k] || "")}</textarea></label>`;
      const listEd = (sec) => {
        const spec = PSECTIONS[sec];
        const arr = pf[sec] || [];
        return `<section class="panel"><h3>${spec.t} <span class="muted small">${arr.length}</span></h3>
          ${arr.map((it, i) => `<div class="pf-item"><div class="fields">${spec.fields.map(([k, label, kind]) => kind === "area" ? `<label class="field wide"><span>${label}</span><textarea id="pf-${sec}-${i}-${k}" rows="3" data-pfl="${sec}:${i}:${k}">${esc(it[k] || "")}</textarea></label>` : `<label class="field${kind === "wide" ? " wide" : ""}"><span>${label}</span><input id="pf-${sec}-${i}-${k}" data-pfl="${sec}:${i}:${k}" value="${esc(it[k] || "")}"></label>`).join("")}</div><button type="button" class="x pf-x" aria-label="Remove" data-act="pf-del" data-sec="${sec}" data-i="${i}">×</button></div>`).join("")}
          <div class="actions"><button type="button" class="btn sm" data-act="pf-add" data-sec="${sec}">${icon("add")} ${spec.add}</button>${sec === "research" ? `<button type="button" class="btn sm ghost" data-act="pf-import">Import projects from this tracker</button>` : ""}</div></section>`;
      };
      return `${head}
        <p class="note">This is your master profile. The Resume builder reorders and highlights it for each professor; it never invents anything, so the stronger and more specific this is, the better every CV and email gets. Use numbers ("AUC 0.78 on 150k borrowers").</p>
        <section class="panel"><h3>About you</h3><div class="fields">
          ${f("fullName", "Full name", S().name || "Ada Okafor")}${f("email", "Email", "you@example.com")}${f("phone", "Phone", "+234 …")}${f("location", "City, country")}
          ${f("citizenship", "Citizenship (for scholarship eligibility)")}${f("linkedin", "LinkedIn URL")}${f("github", "GitHub URL")}${f("website", "Portfolio / website")}
          ${f("targetDegree", "Target degree", "PhD / MSc / Master by Research")}${f("intake", "Target intake", "January 2027 or September 2027")}${f("background", "Background", "Accounting / Finance / Computer Science …")}${f("headline", "Headline", "Finance graduate building ML for credit risk and fraud", true)}
          ${ta("interests", "Research interests (2–3 sentences)", "e.g. I study how machine learning can detect fraud in mobile-money networks …")}
        </div></section>
        ${listEd("education")}${listEd("research")}${listEd("experience")}${listEd("publications")}
        <section class="panel"><h3>Skills, tests & awards</h3><div class="fields">
          ${f("skillsProg", "Programming (comma separated)", "Python, SQL", true)}${f("skillsMl", "Machine learning & data", "pandas, scikit-learn, LightGBM, SHAP", true)}
          ${f("skillsFin", "Finance & domain", "credit risk, IFRS 9, payments", true)}${f("skillsTools", "Tools", "Git, Docker, Streamlit", true)}${f("languages", "Languages", "English (fluent)", true)}
          ${f("tests", "Test scores", "IELTS 7.5 (Oct 2026); GRE booked for Nov 2026", true)}${ta("awards", "Awards, scholarships & activities (one per line)", "")}
        </div></section>
        ${listEd("referees")}`;
    }

    if (tab === "resume" || tab === "emails") {
      const s = currentSup();
      if (!s) return head + `<section class="panel empty-state"><h3>No supervisors</h3></section>`;
      ui.adSel = s.id;
      if (tab === "resume") {
        const m = cvModel(s);
        const f = fit(s);
        const pfEmpty = profileCompleteness() < 0.3;
        return `${head}
          <div class="md cvmd">
            <aside class="md-list panel">
              ${supPicker(s.id)}
              <div class="fitbox"><div class="pp-ring big">${ring(f.score, 76, 7)}<span>${Math.round(f.score * 100)}%</span></div><div><b>Topic fit</b><p class="muted small">How many of this professor's research themes your profile shows evidence for.</p></div></div>
              ${f.covered.length ? `<p class="eyebrow">You show</p><div class="patterns">${f.covered.map((k) => `<span class="chip on">${esc(k)}</span>`).join("")}</div>` : ""}
              ${f.gaps.length ? `<p class="eyebrow">Gaps to close</p><ul class="gaps">${f.gaps.map((k) => `<li><b>${esc(k)}</b><span class="small muted">${esc((TOPICS.find((t) => t.k === k) || {}).tip || "")}</span></li>`).join("")}</ul>` : ""}
              <label class="field"><span>Research-interests paragraph for this professor</span><textarea id="ad-statement" rows="6" data-ad-statement="${s.id}">${esc(m.statement)}</textarea></label>
              <div class="actions"><button type="button" class="btn sm" data-act="ad-polish-cv" data-sid="${s.id}">Polish with Claude</button><button type="button" class="btn sm ghost" data-act="ad-reset-statement" data-sid="${s.id}">Reset</button></div>
              <p class="small muted" id="ad-polish-status"></p>
            </aside>
            <div class="stack">
              ${pfEmpty ? `<p class="note warn-note">Your profile is mostly empty, so this CV is too. <button type="button" class="linkish" data-sub="admissions:profile">Fill in My profile</button> first.</p>` : ""}
              <div class="actions"><button type="button" class="btn primary" data-act="ad-cv-html" data-sid="${s.id}">Download CV (.html)</button><button type="button" class="btn" data-act="ad-cv-md" data-sid="${s.id}">Download (.md)</button><button type="button" class="btn ghost" data-act="ad-cv-copy" data-sid="${s.id}">Copy as text</button></div>
              <p class="small muted">Open the .html file in any browser and choose Print → Save as PDF for a clean one-page PDF, or open it in Word. Projects matching this professor move to the top, and matching skills are highlighted.</p>
              <div class="cv-paper"><div class="cv">${cvHtml(m, false)}</div></div>
            </div>
          </div>`;
      }
      // emails
      const r = peekRec(s.id);
      const tid = AD_TEMPLATES.some((t) => t.id === ui.adTemplate) ? ui.adTemplate : recommendedTemplate(s);
      ui.adTemplate = tid;
      const t = AD_TEMPLATES.find((x) => x.id === tid);
      const d = draftFor(s, tid);
      const to = r.email || (s.emails || [])[0] || "";
      const wc = wordCount(d.body);
      const rec = recommendedTemplate(s);
      const blocked = s.oneEmailOnly && tid.startsWith("follow");
      const gmail = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
      const outlook = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
      return `${head}
        <div class="md">
          <aside class="md-list panel">
            ${supPicker(s.id)}
            <p class="small"><span class="pill">${statusName(r.status)}</span> ${r.contacted ? `· emailed ${fmt(r.contacted)}` : ""}</p>
            <nav class="tlist" aria-label="Email templates">${AD_TEMPLATES.map((x, i) => `<button type="button" class="tl${x.id === tid ? " on" : ""}" data-ad-template="${x.id}"><span class="tl-n">${i + 1}</span><span>${esc(x.t)}${x.id === rec ? ' <span class="pill accent">next</span>' : ""}</span></button>`).join("")}</nav>
          </aside>
          <article class="panel tmpl">
            <header><div><p class="eyebrow">${esc(s.university)}</p><h3>${esc(t.t)}</h3></div><span class="pill ${wc > 200 && (tid === "inquiry" || tid === "posting") ? "bad" : "accent"}">${wc} words</span></header>
            <p class="when">${icon("hours")}<span>${esc(t.when)}</span></p>
            <p class="note"><b>How they want to be contacted:</b> ${esc(s.contact)}</p>
            ${blocked ? `<p class="note warn-note">${esc(s.name)} asks for one email only. Don't send a follow-up.</p>` : ""}
            <label class="field"><span>To</span><input id="ad-to" data-adr="${s.id}:email" value="${esc(to)}" placeholder="Find their email on the official page"></label>
            <label class="field"><span>Subject</span><input id="ad-subject" data-ad-draft="${s.id}:${tid}:subject" value="${esc(d.subject)}"></label>
            <label class="field"><span>Message${d.edited ? " (edited)" : ""}</span><textarea id="ad-body" class="msg-edit" rows="14" data-ad-draft="${s.id}:${tid}:body">${esc(d.body)}</textarea></label>
            <p class="small muted">Anything in [brackets] still needs your words. Fill in the papers you read and your research idea under <button type="button" class="linkish" data-ad-open="${s.id}">Details</button> and they appear here automatically.</p>
            <div class="actions">
              <button type="button" class="btn primary" data-act="ad-copy-email">Copy email</button>
              <a class="btn" target="_blank" rel="noopener" href="${esc(gmail)}">Open in Gmail</a>
              <a class="btn" target="_blank" rel="noopener" href="${esc(outlook)}">Open in Outlook</a>
              <button type="button" class="btn" data-act="ad-polish-email" data-sid="${s.id}" data-tid="${tid}">Polish with Claude</button>
              ${d.edited ? `<button type="button" class="btn ghost" data-act="ad-reset-draft" data-sid="${s.id}" data-tid="${tid}">Reset to template</button>` : ""}
            </div>
            <p class="small muted" id="ad-polish-status"></p>
            <div class="sent-bar"><span class="small">Sent it? Log it so the app can schedule the follow-up.</span><button type="button" class="btn primary" data-act="ad-mark-sent" data-sid="${s.id}" data-tid="${tid}"${blocked ? " disabled" : ""}>Mark as sent</button></div>
            <p class="small muted">Attach your tailored CV (Resume builder) and transcripts. The app can't send email for you; it opens a ready-to-send draft in Gmail or Outlook.</p>
          </article>
        </div>`;
    }

    if (tab === "sprint") {
      return `${head}
        <p class="note">Everything needed for a strong application before December. Tick items off as you go; each group has a target date.</p>
        <div class="sprint">${SPRINT.map((g) => { const done = g.items.filter(([k]) => A().sprint[k]).length; return `<section class="panel"><h3>By ${fmt(g.by, { day: "numeric", month: "long" })} ${countdown(g.by)} <span class="muted small">${done}/${g.items.length}</span></h3>
          <div class="checks">${g.items.map(([k, tx]) => `<label class="chk${A().sprint[k] ? " is-done" : ""}"><input type="checkbox" data-ads="${k}"${A().sprint[k] ? " checked" : ""}><span>${esc(tx)}</span></label>`).join("")}</div>
          ${link(gcal({ title: "Admissions sprint deadline", date: g.by, allDay: true, details: g.items.map((x) => "• " + x[1]).join("\n") }), "Add to calendar")}</section>`; }).join("")}</div>
        <section class="panel"><h3>Outreach tips from your research</h3><ol class="steps">${AD.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>`;
    }

    // pipeline
    const f = ui.adFilter;
    const q = (f.q || "").toLowerCase();
    const countries = [...new Set(all.map((s) => s.country))];
    const list = all.filter((s) => (f.prio === "all" || s.priority === f.prio) && (f.country === "all" || s.country === f.country) && (f.status === "all" || peekRec(s.id).status === f.status) &&
      (!q || [s.name, s.university, s.interests, s.programs].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => {
        const soon = (x) => x.urgent ? "0" : x.deadline && daysLeft(x.deadline) >= 0 && daysLeft(x.deadline) <= 90 ? x.deadline : "9";
        return a.priority.localeCompare(b.priority) || soon(a).localeCompare(soon(b)) || a.n - b.n;
      });
    return `${head}${strip}
      <div class="toolbar">
        <div class="seg">${[["all", "All"], ["A", "Priority A"], ["B", "B"], ["C", "C"]].map(([k, t]) => `<button type="button" class="${f.prio === k ? "on" : ""}" data-ad-f="prio:${k}">${t}</button>`).join("")}</div>
        <select id="ad-country" data-ad-fs="country" aria-label="Country"><option value="all">All countries</option>${countries.map((c) => `<option${f.country === c ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select id="ad-status" data-ad-fs="status" aria-label="Status"><option value="all">Any status</option>${AD_STATUSES.map(([k, t]) => `<option value="${k}"${f.status === k ? " selected" : ""}>${t}</option>`).join("")}</select>
        <label class="search-wrap">${icon("finder")}<input id="ad-search" class="search" type="search" placeholder="Search name, university, topic" value="${esc(f.q || "")}" data-ad-search="1"></label>
        <button type="button" class="btn sm" data-act="ad-add-custom">${icon("add")} Add supervisor</button>
      </div>
      <div class="pgrid">${list.map(supCard).join("") || `<div class="panel empty-state"><h3>No matches</h3><p class="muted">Try another filter.</p></div>`}</div>
      <p class="small muted">Priority A: current open invitation. B: generally looking for students. C: strong fit, no public recruiting statement (cold email). Source pages were checked on ${fmt(AD.verifiedOn || today(), { day: "numeric", month: "long", year: "numeric" })}; recheck each before applying.</p>`;
  }

  function markSent(sid, tid) {
    const s = supOf(sid);
    const r = recOf(sid);
    const t = AD_TEMPLATES.find((x) => x.id === tid);
    r.history.push({ d: today(), what: `Sent: ${t ? t.t : "email"}` });
    if (tid === "inquiry" || tid === "posting" || tid === "funding") { r.status = "emailed"; r.contacted = r.contacted || today(); r.checks.emailSent = true; }
    else if (tid === "follow1" || tid === "follow2") r.status = "followed";
    else if (tid === "applied") r.status = "applied";
    const next = (s && s.oneEmailOnly) || tid === "follow2" || tid === "applied" ? "" : addDays(today(), tid === "follow1" ? 14 : 10);
    r.followUp = ["replied", "meeting", "offer"].includes(r.status) ? r.followUp : next;
    markActivity(); saveAd(); saveProgress();
    ui.toast = next ? `Logged. Follow-up reminder set for ${fmt(next)}.` : "Logged.";
  }

  function todayAdmissionsPanel() {
    const all = supList();
    const t = today();
    const soon = [
      ...AD.keyDates.filter((k) => k.date && daysLeft(k.date) >= 0).map((k) => ({ label: k.what.split(" - ")[0].split(":")[0], date: k.date })),
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2);
    const urgent = all.filter((s) => s.urgent && peekRec(s.id).status === "new");
    const due = all.filter((s) => { const r = peekRec(s.id); return r.followUp && r.followUp <= t && !["replied", "meeting", "applied", "offer", "closed"].includes(r.status); });
    const contacted = all.filter((s) => AD_CONTACTED.includes(peekRec(s.id).status)).length;
    return `<section class="panel"><h3>${icon("admissions")} Admissions</h3>
      <div class="focus-bar">${bar(contacted / Math.max(1, all.length))}<span class="small">${contacted}/${all.length} contacted</span></div>
      <ul class="plist">
        ${urgent.map((s) => `<li><span><b>${esc(s.name)}</b> <span class="muted">· ${esc(s.university)}</span><span class="small pl-note bad-text">${esc(s.deadlineNote || "Act now")}</span></span><span class="row-actions"><button type="button" class="btn sm primary" data-ad-go="emails" data-sid="${s.id}">Email</button></span></li>`).join("")}
        ${due.map((s) => `<li><span><b>${esc(s.name)}</b><span class="small pl-note muted">Follow-up due</span></span><span class="row-actions"><button type="button" class="btn sm" data-ad-go="emails" data-sid="${s.id}">Follow up</button></span></li>`).join("")}
        ${soon.map((k) => `<li><span>${esc(k.label)}</span><span class="row-actions">${countdown(k.date)}</span></li>`).join("")}
      </ul>
      <div class="actions"><button type="button" class="btn sm" data-tab="admissions">Open Admissions</button></div></section>`;
  }


  // ---------- calendar (.ics) ----------
  function buildIcs() {
    const s = S();
    const esc2 = (x) => String(x).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
    const d8 = (x) => x.replace(/-/g, "");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const end = d8(weekEnd(TOTAL_WEEKS)) + "T235959";
    const byday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fintech ML Ledger//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Fintech ML Year"];
    const ev = (uid, lines, alarm) => {
      out.push("BEGIN:VEVENT", `UID:${uid}@fintech-ml-ledger`, `DTSTAMP:${stamp}`, ...lines);
      if (alarm) out.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", `TRIGGER:${alarm}`, "END:VALARM");
      out.push("END:VEVENT");
    };
    const timed = (date, hm, mins) => {
      const [h, m] = hm.split(":").map(Number);
      const st = new Date(parse(date)); st.setHours(h, m, 0, 0);
      const en = new Date(st.getTime() + mins * 60000);
      const f = (x) => `${d8(iso(x))}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
      return [`DTSTART:${f(st)}`, `DTEND:${f(en)}`];
    };
    const allDay = (date) => [`DTSTART;VALUE=DATE:${d8(date)}`, `DTEND;VALUE=DATE:${d8(addDays(date, 1))}`];
    ev("linkedin-daily", [...timed(s.startDate, s.linkedinTime, Number(s.linkedinMins) || 15), `RRULE:FREQ=DAILY;UNTIL=${end}`, `SUMMARY:${esc2("LinkedIn: comment on prospects' posts")}`, `DESCRIPTION:${esc2("Today tab > Engage today. Anchor, add, ask. Then press Log comment.")}`], "-PT5M");
    s.routine.forEach((r, i) => ev(`routine-${i}`, [...timed(nextOnOrAfter(s.startDate, Number(r.day)), r.start, Number(r.mins) || 60), `RRULE:FREQ=WEEKLY;BYDAY=${byday[r.day]};UNTIL=${end}`, `SUMMARY:${esc2("Study: " + r.label)}`], "-PT10M"));
    for (let n = 1; n <= TOTAL_WEEKS; n++) {
      const w = weekOf(n);
      ev(`week-${n}`, [...allDay(weekStart(n)), `SUMMARY:${esc2(`Week ${n}: ${w.title}`)}`, `DESCRIPTION:${esc2(`Skills: ${w.skills.join("; ")}\n\nFintech problem: ${w.problem.title}${practiceOf(n) ? `\n\nCarry-over challenge: ${practiceOf(n).carry.title}` : ""}\n\nMentor task: ${w.mentor}`)}`], "PT8H");
    }
    prospects().forEach((p) => {
      const na = nextAction(p);
      if (!na) return;
      ev(`p-${p.id}-${na.due}`, [...allDay(na.due), `SUMMARY:${esc2(`Mentor: ${p.name} (${p.company || ""})`)}`, `DESCRIPTION:${esc2(na.text + (p.linkedin ? "\n" + p.linkedin : ""))}`], "PT9H");
    });
    AD.keyDates.filter((k) => k.date && k.date >= today()).forEach((k, i) => ev(`adk-${i}`, [...allDay(k.date), `SUMMARY:${esc2("Admissions: " + k.when)}`, `DESCRIPTION:${esc2(k.what)}`], "-PT15H"));
    supList().forEach((sp) => { const r = peekRec(sp.id); if (r.followUp && !["replied", "meeting", "applied", "offer", "closed"].includes(r.status)) ev(`adf-${sp.id}-${r.followUp}`, [...allDay(r.followUp), `SUMMARY:${esc2("Follow up: " + sp.name)}`, `DESCRIPTION:${esc2(sp.university)}`], "PT9H"); });
    ST().deadlines.filter((d) => !d.done && d.due).forEach((d) => ev(`dl-${d.id}`, [...allDay(d.due), `SUMMARY:${esc2(`${d.type}: ${d.title}`)}`, `DESCRIPTION:${esc2(courseName(d.course))}`], "-PT15H"));
    ST().classes.forEach((c) => ev(`class-${c.id}`, [...timed(nextDow(Number(c.day)), c.start, Math.max(15, minutesBetween(c.start, c.end))), `RRULE:FREQ=WEEKLY;BYDAY=${byday[c.day]}${ST().semesterEnd ? `;UNTIL=${d8(ST().semesterEnd)}T235959` : ";COUNT=16"}`, `SUMMARY:${esc2(courseName(c.course))}`, ...(c.place ? [`LOCATION:${esc2(c.place)}`] : [])], "-PT15M"));
    out.push("END:VCALENDAR");
    const folded = [];
    out.forEach((line) => { let l = line; while (l.length > 74) { folded.push(l.slice(0, 74)); l = " " + l.slice(74); } folded.push(l); });
    return folded.join("\r\n") + "\r\n";
  }

  async function offerFile(filename, text, mime) {
    const dl = await downloadsP;
    if (dl) {
      try { await dl.save({ filename, data: text }); return true; } catch (e) {
        return !!(e && e.code === "declined");
      }
    }
    // Inside the Claude viewer, plain download links are blocked.
    if (window.claude) return false;
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) { return false; }
  }

  // ---------- events ----------
  function saveProgress() { Store.save("progress"); }
  function rerender() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }
  function setTab(id) {
    ui.tab = id; ui.confirm = null; ui.more = false;
    ls.set("fml-ui-tab", id);
    try { history.replaceState(null, "", "#" + id); } catch (e) { /* sandboxed */ }
    render();
    window.scrollTo(0, 0);
  }
  async function copyText(text, fallbackEl) {
    try { await navigator.clipboard.writeText(text); showToast("Copied"); } catch (e) {
      if (fallbackEl) { const r = document.createRange(); r.selectNodeContents(fallbackEl); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      showToast("Select the text and copy it manually");
    }
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-act],[data-goto-week],[data-filter],[data-copy],[data-copy-el],[data-sub],[data-sub-go],[data-phase],[data-template],[data-ad-open],[data-ad-go],[data-ad-template],[data-ad-f]");
    if (!t) return;
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.dataset.sub) { const [scope, val] = t.dataset.sub.split(":"); ui.sub[scope] = val; ui.confirm = null; rerender(); return; }
    if (t.dataset.subGo) { const [tab, val] = t.dataset.subGo.split(":"); ui.sub[tab] = val; setTab(tab); return; }
    if (t.dataset.phase) { ui.phase = Number(t.dataset.phase); rerender(); return; }
    if (t.dataset.template) { ui.msgTemplate = t.dataset.template; rerender(); return; }
    if (t.dataset.adOpen) { ui.adOpen = t.dataset.adOpen; renderOverlay(); return; }
    if (t.dataset.adGo) { ui.adSel = t.dataset.sid || ui.adSel; ui.adTemplate = null; ui.sub.admissions = t.dataset.adGo; ui.adOpen = null; setTab("admissions"); return; }
    if (t.dataset.adTemplate) { ui.adTemplate = t.dataset.adTemplate; rerender(); return; }
    if (t.dataset.adF) { const [k, v] = t.dataset.adF.split(":"); ui.adFilter[k] = v; rerender(); return; }
    if (t.dataset.gotoWeek) {
      const n = Number(t.dataset.gotoWeek);
      ui.openWeeks = new Set([n]);
      ui.phase = phaseOf(n).id;
      if (ui.tab !== "roadmap") { ui.tab = "roadmap"; ls.set("fml-ui-tab", "roadmap"); }
      render();
      const el = document.getElementById("week-" + n);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (t.dataset.filter) { ui.mentorFilter = ui.mentorFilter === t.dataset.filter && STAGES.some((s) => s.id === t.dataset.filter) ? "active" : t.dataset.filter; rerender(); return; }
    if (t.dataset.copy) { copyText(t.dataset.copy); return; }
    if (t.dataset.copyEl) { const el = document.getElementById(t.dataset.copyEl); copyText(el.textContent, el); return; }
    const id = t.dataset.id;
    const p = id ? PR()[id] : null;
    switch (t.dataset.act) {
      case "theme": setTheme(effectiveTheme() === "dark" ? "light" : "dark"); renderTabs(); if (ui.tab === "settings") rerender(); break;
      case "theme-mode": setTheme(t.dataset.mode); renderTabs(); rerender(); break;
      case "toggle-more": ui.more = !ui.more; renderTabs(); break;
      case "new-prospect": ui.more = false; ui.edit = "new"; renderTabs(); renderOverlay(); break;
      case "edit": ui.edit = id; renderOverlay(); break;
      case "cancel-edit": { const wasAd = !!ui.adOpen; ui.edit = null; ui.adOpen = null; if (wasAd) rerender(); else renderOverlay(); break; }
      case "ad-add-custom": ui.adOpen = "__new"; renderOverlay(); break;
      case "ad-del-custom": A().custom = (A().custom || []).filter((x) => x.id !== id); delete A().recs[id]; ui.adOpen = null; saveAd(); ui.toast = "Supervisor removed"; rerender(); break;
      case "pf-add": { const sec = t.dataset.sec; const pf = A().profile; pf[sec] = pf[sec] || []; pf[sec].push({}); saveAd(); rerender(); break; }
      case "pf-del": { const pf = A().profile; (pf[t.dataset.sec] || []).splice(Number(t.dataset.i), 1); saveAd(); rerender(); break; }
      case "pf-import": { const n = importTrackerProjects(); ui.toast = n ? `Added ${n} item${n > 1 ? "s" : ""} from your tracker` : "Nothing new to import yet: tick off project milestones or more weeks first"; rerender(); break; }
      case "ad-polish-cv": polish("cv", t.dataset.sid); break;
      case "ad-polish-email": polish("email", t.dataset.sid, t.dataset.tid); break;
      case "ad-reset-statement": { const r = recOf(t.dataset.sid); delete r.cvStatement; saveAd(); rerender(); break; }
      case "ad-reset-draft": { const r = recOf(t.dataset.sid); delete r.drafts[t.dataset.tid]; saveAd(); rerender(); break; }
      case "ad-cv-html": { const sp = supOf(t.dataset.sid); offerFile(`CV - ${(A().profile.fullName || S().name || "me").replace(/[^\w .-]/g, "")} - ${sp.university.replace(/[^\w .-]/g, "").slice(0, 40)}.html`, cvDocument(sp), "text/html").then((ok) => { if (!ok) showToast("Downloads aren't available here. Use Copy as text."); }); break; }
      case "ad-cv-md": { const sp = supOf(t.dataset.sid); offerFile(`CV - ${(A().profile.fullName || S().name || "me").replace(/[^\w .-]/g, "")}.md`, cvText(sp), "text/markdown").then((ok) => { if (!ok) showToast("Downloads aren't available here. Use Copy as text."); }); break; }
      case "ad-cv-copy": copyText(cvText(supOf(t.dataset.sid))); break;
      case "ad-copy-email": { const sj = $("#ad-subject"), bd = $("#ad-body"); copyText(`Subject: ${sj ? sj.value : ""}\n\n${bd ? bd.value : ""}`, bd); break; }
      case "ad-mark-sent": markSent(t.dataset.sid, t.dataset.tid); rerender(); break;
      case "log-hours": { const n = Math.min(Math.max(weekNow(), 1), TOTAL_WEEKS); ui.sub.today = "week"; ui.sub["week-" + n] = "log"; rerender(); const h = $("#hours-" + n); if (h) h.focus(); break; }
      case "ask-delete": ui.confirm = "del:" + id; rerender(); break;
      case "cancel-confirm": ui.confirm = null; rerender(); break;
      case "delete": Store.deleteProspect(id); ui.confirm = null; ui.toast = "Prospect deleted"; rerender(); break;
      case "log-comment":
        if (!p) break;
        p.engagements = p.engagements || [];
        p.engagements.push({ d: today() });
        if (p.stage === "identified") p.stage = "engaging";
        markActivity(); saveProgress(); Store.saveProspect(id);
        ui.toast = `Comment logged for ${p.name} (${p.engagements.length} total)`; rerender(); break;
      case "undo-comment":
        if (!p || !(p.engagements || []).length) break;
        p.engagements.pop(); Store.saveProspect(id); ui.toast = "Last comment removed"; rerender(); break;
      case "done-followup":
        if (!p) break;
        p.followUp = addDays(today(), stageOf(p.stage).next || 7);
        markActivity(); saveProgress(); Store.saveProspect(id);
        ui.toast = `Next reminder for ${p.name}: ${fmt(p.followUp)}`; rerender(); break;
      case "msg-for": ui.msgProspect = id; setTab("messages"); break;
      case "ask-del-course": ui.confirm = "course:" + id; rerender(); break;
      case "del-course": ST().courses = ST().courses.filter((c) => c.id !== id); ST().classes = ST().classes.filter((c) => c.course !== id); ui.confirm = null; Store.save("studies"); rerender(); break;
      case "del-class": ST().classes = ST().classes.filter((c) => c.id !== id); Store.save("studies"); rerender(); break;
      case "del-deadline": ST().deadlines = ST().deadlines.filter((d) => d.id !== id); Store.save("studies"); rerender(); break;
      case "add-routine": S().routine.push({ day: 6, start: "10:00", mins: 60, label: "Study" }); Store.save("settings"); rerender(); break;
      case "del-routine": S().routine.splice(Number(t.dataset.i), 1); Store.save("settings"); rerender(); break;
      case "ics": offerFile("fintech-ml-year.ics", buildIcs(), "text/calendar").then((ok) => showToast(ok ? "Calendar file ready: open it to import" : "Downloads are blocked here. Use the Google Calendar links.")); break;
      case "export": offerFile(`fintech-ml-ledger-backup-${today()}.json`, JSON.stringify(Store.data, null, 2), "application/json").then((ok) => { if (!ok) showToast("Downloads aren't available here"); }); break;
      case "ask-reset": ui.confirm = "reset"; rerender(); break;
      case "reset": {
        const old = Object.keys(PR());
        Store.data = clone(DEFAULTS); old.forEach((pid) => Store.deleteProspect(pid));
        Store.saveAll(); ui.confirm = null; ui.toast = "All data erased"; rerender(); break;
      }
    }
  });

  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.week) return;
    const n = Number(d.dataset.week);
    if (d.open && !ui.openWeeks.has(n)) {
      ui.openWeeks = new Set([n]);
      rerender();
      const el = document.getElementById("week-" + n);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    else if (!d.open) { ui.openWeeks.delete(n); const b = d.querySelector(".week-body"); if (b) b.remove(); }
  }, true);

  document.addEventListener("change", (e) => {
    const t = e.target;
    const ds = t.dataset;
    if (ds.adStatus) {
      const r = recOf(ds.adStatus);
      r.status = t.value;
      if (AD_CONTACTED.includes(t.value) && !r.contacted) r.contacted = today();
      if (["replied", "meeting", "offer", "closed"].includes(t.value)) r.followUp = "";
      r.history.push({ d: today(), what: "Status: " + statusName(t.value) });
      markActivity(); saveAd(); saveProgress(); rerender(); return;
    }
    if (ds.adc) { const [sid, k] = ds.adc.split(":"); const r = recOf(sid); if (t.checked) r.checks[k] = today(); else delete r.checks[k]; t.closest(".chk").classList.toggle("is-done", t.checked); if (t.checked) markActivity(); saveAd(); return; }
    if (ds.ads) { if (t.checked) { A().sprint[ds.ads] = today(); markActivity(); } else delete A().sprint[ds.ads]; saveAd(); saveProgress(); rerender(); return; }
    if (ds.adSel) { ui.adSel = t.value; ui.adTemplate = null; rerender(); return; }
    if (ds.adFs) { ui.adFilter[ds.adFs] = t.value; rerender(); return; }
    if (ds.check) {
      if (t.checked) { P().checks[ds.check] = today(); markActivity(); } else delete P().checks[ds.check];
      saveProgress(); rerender(); return;
    }
    if (ds.exam) { if (t.checked) P().exam[ds.exam] = true; else delete P().exam[ds.exam]; saveProgress(); rerender(); return; }
    if (ds.hours) { const v = parseFloat(t.value); if (v > 0) P().hours[ds.hours] = v; else delete P().hours[ds.hours]; saveProgress(); return; }
    if (ds.bell) { const p = PR()[ds.bell]; if (p) { p.bell = t.checked; Store.saveProspect(p.id); } return; }
    if (ds.stage) {
      const p = PR()[ds.stage]; if (!p) return;
      p.stage = t.value;
      p.history = (p.history || []).concat({ stage: t.value, d: today() });
      const nx = stageOf(t.value).next;
      p.followUp = nx ? addDays(today(), nx) : "";
      markActivity(); saveProgress(); Store.saveProspect(p.id);
      ui.toast = t.value === "mentor" ? `${p.name} is now a mentor. Monthly update reminder set.` : `${p.name}: ${stageOf(t.value).t}`;
      rerender(); return;
    }
    if (ds.dlDone) { const d = ST().deadlines.find((x) => x.id === ds.dlDone); if (d) { d.done = t.checked; if (t.checked) markActivity(); Store.save("studies"); saveProgress(); rerender(); } return; }
    if (ds.finder) { ui.finder[ds.finder] = t.value; rerender(); return; }
    if (ds.msgProspect) { ui.msgProspect = t.value; rerender(); return; }
    if (ds.semester) { ST().semesterEnd = t.value; Store.save("studies"); return; }
    if (ds.setting) {
      const k = ds.setting;
      if (k === "startDate" && !t.value) return;
      S()[k] = t.type === "number" ? Number(t.value) || DEFAULTS.settings[k] : t.value;
      Store.save("settings"); if (k === "startDate" || k === "weeklyGoalHours") rerender(); return;
    }
    if (ds.routine) {
      const r = S().routine[Number(ds.routine)]; if (!r) return;
      r[ds.field] = ds.field === "day" || ds.field === "mins" ? Number(t.value) : t.value;
      Store.save("settings"); return;
    }
    if (ds.project) { const m = P().projects[ds.project] = P().projects[ds.project] || {}; m[ds.field] = t.value; saveProgress(); return; }
    if (ds.import && t.files && t.files[0]) {
      const r = new FileReader();
      r.onload = () => {
        try {
          const obj = JSON.parse(r.result);
          if (!obj || !obj.progress || !obj.settings) throw new Error("not a backup");
          Object.keys(PR()).forEach((pid) => { if (!(obj.prospects || {})[pid]) Store.deleteProspect(pid); });
          Store.data = Store.hydrate(obj); Store.saveAll(); ui.toast = "Backup imported"; rerender();
        } catch (err) { showToast("That file isn't a Fintech ML Ledger backup"); }
      };
      r.readAsText(t.files[0]);
    }
  });

  // Gentle 3D tilt on the learning card (pointer devices only).
  document.addEventListener("pointermove", (e) => {
    const c = e.target.closest && e.target.closest(".lcard");
    if (!c || e.pointerType !== "mouse") return;
    const r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    c.style.setProperty("--ry", (x * 10).toFixed(2) + "deg");
    c.style.setProperty("--rx", (-y * 8).toFixed(2) + "deg");
    c.style.setProperty("--gx", ((x + 0.5) * 100).toFixed(0) + "%");
  });
  document.addEventListener("pointerout", (e) => {
    const c = e.target.closest && e.target.closest(".lcard");
    if (c && !c.contains(e.relatedTarget)) { c.style.removeProperty("--rx"); c.style.removeProperty("--ry"); c.style.removeProperty("--gx"); }
  });

  let noteTimer, adTimer;
  const adSaveSoon = () => { clearTimeout(adTimer); adTimer = setTimeout(saveAd, 600); };
  document.addEventListener("input", (e) => {
    const t = e.target;
    const ds = t.dataset;
    if (ds.adr) { const [sid, k] = ds.adr.split(":"); recOf(sid)[k] = t.value; adSaveSoon(); return; }
    if (ds.adp) { const [sid, i, k] = ds.adp.split(":"); const r = recOf(sid); r.papers[i] = r.papers[i] || {}; r.papers[i][k] = t.value; if (k === "t" && t.value.trim()) r.checks.papers = r.checks.papers || today(); adSaveSoon(); return; }
    if (ds.pfv) { A().profile[ds.pfv] = t.value; adSaveSoon(); return; }
    if (ds.pfl) { const [sec, i, k] = ds.pfl.split(":"); const arr = A().profile[sec]; if (arr && arr[i]) { arr[i][k] = t.value; adSaveSoon(); } return; }
    if (ds.adStatement) { recOf(ds.adStatement).cvStatement = t.value; adSaveSoon(); return; }
    if (ds.adDraft) {
      const [sid, tid, field] = ds.adDraft.split(":");
      const sp = supOf(sid); const r = recOf(sid);
      const cur = draftFor(sp, tid);
      r.drafts[tid] = { subject: cur.subject, body: cur.body, [field]: t.value };
      adSaveSoon(); return;
    }
    if (ds.adSearch) {
      ui.adFilter.q = t.value;
      const pos = t.selectionStart;
      rerender();
      const el = $("#ad-search"); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
      return;
    }
    if (t.dataset.note) {
      const n = t.dataset.note;
      if (t.value.trim()) P().notes[n] = t.value; else delete P().notes[n];
      clearTimeout(noteTimer); noteTimer = setTimeout(saveProgress, 600);
    } else if (t.dataset.search) {
      ui.mentorSearch = t.value;
      const pos = t.selectionStart;
      rerender();
      const s = $("#mentor-search"); if (s) { s.focus(); s.setSelectionRange(pos, pos); }
    } else if (t.closest("#prospect-form") && (t.name === "name" || t.name === "domain")) {
      const f = t.closest("#prospect-form");
      $("#email-helper").innerHTML = emailHelper({ name: f.elements.name.value, domain: f.elements.domain.value });
    }
  });

  document.addEventListener("submit", (e) => {
    const f = e.target;
    e.preventDefault();
    const val = (k) => (f.elements[k] ? String(f.elements[k].value || "").trim() : "");
    if (f.id === "prospect-form") {
      const existing = f.dataset.id ? PR()[f.dataset.id] : null;
      const p = existing || { id: newId(), stage: "identified", engagements: [], history: [{ stage: "identified", d: today() }] };
      ["name", "role", "company", "domain", "market", "tier", "linkedin", "email", "postTopic", "notes"].forEach((k) => { p[k] = val(k); });
      p.identifiedOn = val("identifiedOn") || today();
      if (f.elements.followUp) p.followUp = val("followUp");
      p.bell = f.elements.bell.checked;
      p.emailVerified = f.elements.emailVerified.checked;
      p.fit = {};
      N.fitCriteria.forEach((c) => { if (f.elements["fit-" + c.id].checked) p.fit[c.id] = true; });
      PR()[p.id] = p;
      if (!existing) markActivity();
      saveProgress(); Store.saveProspect(p.id);
      ui.edit = null; ui.toast = existing ? "Saved" : `${p.name} added. Engage for ${READY_DAYS} days before connecting.`;
      rerender(); return;
    }
    if (f.id === "ad-custom-form") {
      const all = supList();
      const sup = { id: "c" + newId(), custom: true, n: 100 + all.length, country: val("country") || "Other", university: val("university"), name: val("name"), titleDept: val("titleDept"), programs: val("programs"), interests: val("interests"), accepting: val("accepting") || "Not stated", session: val("session") || "Not stated", funding: "Not stated", contact: val("email") || "See official page", keyDate: val("deadline") || "-", source: val("source"), priority: val("priority") || "B", emails: val("email") ? [val("email")] : [], deadline: val("deadline") || undefined };
      A().custom = [...(A().custom || []), sup];
      saveAd(); ui.adOpen = null; ui.toast = `${sup.name} added`; rerender(); return;
    }
    if (f.id === "course-form") { ST().courses.push({ id: newId(), name: val("name") }); Store.save("studies"); rerender(); return; }
    if (f.id === "class-form") {
      if (!val("course")) return;
      if (minutesBetween(val("start"), val("end")) <= 0) { showToast("The class must end after it starts"); return; }
      ST().classes.push({ id: newId(), course: val("course"), day: Number(val("day")), start: val("start"), end: val("end"), place: val("place") });
      Store.save("studies"); ui.toast = "Class added"; rerender(); return;
    }
    if (f.id === "deadline-form") {
      ST().deadlines.push({ id: newId(), title: val("title"), course: val("course"), type: val("type"), due: val("due"), done: false });
      Store.save("studies"); ui.toast = "Deadline added"; rerender(); return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (ui.edit !== null || ui.adOpen) { const wasAd = !!ui.adOpen; ui.edit = null; ui.adOpen = null; if (wasAd) rerender(); else renderOverlay(); }
    else if (ui.more) { ui.more = false; renderTabs(); }
  });

  // Refresh "today" if the page stays open past midnight.
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); if (!document.activeElement || !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) rerender(); } }, 60000);

  Store.init(render);
})();
