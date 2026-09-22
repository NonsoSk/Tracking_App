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
    prospects: {},
  };

  // ---------- storage ----------
  const LS_KEY = "fintech-ml-ledger-v1";
  const Store = {
    data: null, db: null, base: null, status: "local", timers: {}, chains: {},
    hydrate(obj) {
      const d = clone(DEFAULTS);
      if (!obj) return d;
      for (const k of ["settings", "progress", "studies"]) Object.assign(d[k], obj[k] || {});
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
        const docs = ["settings", "progress", "studies"];
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
      ["settings", "progress", "studies"].forEach((k) => this.save(k));
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
    ["today", "Today"], ["roadmap", "Roadmap"], ["mentors", "Mentors"], ["finder", "Finder"],
    ["messages", "Messages"], ["studies", "Studies"], ["projects", "Projects"], ["progress", "Progress"], ["settings", "Settings"],
  ];
  const ui = {
    tab: "today", openWeeks: new Set(), edit: null, confirm: null,
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
  function renderTabs() {
    $("#tabs").innerHTML = TABS.map(([id, t]) => `<button type="button" role="tab" class="tab${ui.tab === id ? " on" : ""}" data-tab="${id}" aria-selected="${ui.tab === id}">${icon(id)}<span>${t}</span></button>`).join("");
    const n = weekNow();
    const wk = Math.min(Math.max(n, 0), TOTAL_WEEKS);
    const foot = $("#sidefoot");
    if (foot) foot.innerHTML = `<div class="sf-ring">${ring(wk / TOTAL_WEEKS, 52, 5)}<span class="mono">${wk}</span></div>
      <div><p class="sf-k">Week ${wk || "—"} of 52</p><p class="sf-v">${pct(overallPct())} of the curriculum done</p></div>`;
  }

  function render() {
    renderTabs();
    renderSyncBadge();
    const views = { today: vToday, roadmap: vRoadmap, mentors: vMentors, finder: vFinder, messages: vMessages, studies: vStudies, projects: vProjects, progress: vProgress, settings: vSettings };
    $("#view").innerHTML = views[ui.tab]();
    if (ui.toast) { showToast(ui.toast); ui.toast = ""; }
  }
  let toastTimer;
  function showToast(text) {
    const el = $("#toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

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
    ];
    return `<div class="kpis">${items.map(([k, v, extra]) => `<div class="kpi"><span class="kpi-k">${k}</span><span class="kpi-v">${v}</span>${extra}</div>`).join("")}</div>`;
  }

  function vToday() {
    const n = weekNow();
    const t = today();
    const dow = new Date().getDay();
    const wn = Math.min(Math.max(n, 1), TOTAL_WEEKS);
    const greet = (() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; })();
    const who = S().name ? `, ${esc(S().name.split(" ")[0])}` : "";
    let bannerText;
    if (n === 0) bannerText = `<p class="b-eyebrow">${greet}${who} · starts ${fmt(S().startDate, { weekday: "long", month: "long", day: "numeric" })}</p><h1>Your year starts soon</h1><p class="b-meta">Week 1: ${esc(weekOf(1).title)}</p>`;
    else if (n > TOTAL_WEEKS) bannerText = `<p class="b-eyebrow">${greet}${who}</p><h1>You finished the year</h1><p class="b-meta">52 weeks complete. Time for the year-2 plan.</p>`;
    else bannerText = `<p class="b-eyebrow">${greet}${who} · Week ${n} of 52 · ${esc(phaseOf(n).name)}</p><h1>${esc(weekOf(n).title)}</h1>
      <p class="b-meta">${weekRange(n)} · This week's problem: <b>${esc(weekOf(n).problem.title)}</b></p>
      ${P().exam[n] ? `<p class="b-pill">Exam week: lighter load, the problem is optional</p>` : ""}`;
    const wp = n >= 1 && n <= TOTAL_WEEKS ? weekPct(n) : 0;
    const head = `<div class="b-text">${bannerText}</div>
      <div class="b-ring">${ring(wp, 112, 10, "on-dark")}<div class="b-ring-label"><span class="mono">${pct(wp)}</span><span>this week</span></div></div>`;

    const plan = [
      { start: S().linkedinTime, html: `<span>LinkedIn: ${S().linkedinMins} min of thoughtful comments on your prospects' posts</span>` },
      ...S().routine.filter((r) => Number(r.day) === dow).map((r) => ({ start: r.start, html: `<span>${esc(r.label)} <em>(${r.mins} min)</em></span>` })),
      ...todaysClasses().map((c) => ({ start: c.start, cls: "school", html: `<span>Class: ${esc(courseName(c.course))}${c.place ? " · " + esc(c.place) : ""}</span>` })),
    ].sort((a, b) => a.start.localeCompare(b.start));
    const planHtml = `<ul class="plan">${plan.map((x) => `<li${x.cls ? ` class="${x.cls}"` : ""}><span class="mono">${esc(x.start)}</span>${x.html}</li>`).join("")}</ul>`;

    // mentor actions
    const ps = prospects().filter((p) => p.stage !== "parked");
    const ready = ps.filter((p) => readiness(p).ready);
    const due = ps.filter((p) => !readiness(p).early && p.followUp && p.followUp <= t);
    const engage = ps.filter((p) => readiness(p).early).sort((a, b) => (lastEngaged(a) || "").localeCompare(lastEngaged(b) || "")).slice(0, 3);
    const pLine = (p, note) => `<li><span><b>${esc(p.name)}</b> · ${esc(p.company || "")}${note ? ` <span class="muted">— ${note}</span>` : ""}</span>
      <span class="row-actions">${p.linkedin ? link(p.linkedin, "Profile") : ""}<button type="button" class="btn sm" data-act="msg-for" data-id="${p.id}">Messages</button></span></li>`;
    const mentorHtml = !ps.length
      ? `<p class="muted">No prospects yet. ${n < 3 ? "You start adding them in Week 3; " : ""}use the <button type="button" class="linkish" data-tab="finder">Finder</button> to find your first five.</p>`
      : `${ready.length ? `<h4>Ready to connect</h4><ul class="plist">${ready.map((p) => pLine(p, `${readiness(p).comments} comments over ${readiness(p).known} days`)).join("")}</ul>` : ""}
         ${due.length ? `<h4>Follow-ups due</h4><ul class="plist">${due.map((p) => pLine(p, esc(nextAction(p).text))).join("")}</ul>` : ""}
         ${engage.length ? `<h4>Engage today</h4><ul class="plist">${engage.map((p) => `<li><span><b>${esc(p.name)}</b> · ${esc(p.company || "")} <span class="muted">— last comment ${lastEngaged(p) ? fmt(lastEngaged(p)) : "never"}</span></span>
              <span class="row-actions">${p.linkedin ? link(p.linkedin.replace(/\/$/, "") + "/recent-activity/all/", "Their posts") : ""}<button type="button" class="btn sm" data-act="log-comment" data-id="${p.id}">Log comment</button></span></li>`).join("")}</ul>` : ""}`;

    const soon = ST().deadlines.filter((d) => !d.done && d.due && daysBetween(t, d.due) <= 14).sort((a, b) => a.due.localeCompare(b.due));
    const studyHtml = soon.length
      ? `<ul class="plist">${soon.map((d) => { const k = daysBetween(t, d.due); return `<li><span><b>${esc(d.title)}</b> · ${esc(courseName(d.course))} <span class="pill ${k < 0 ? "bad" : k <= 3 ? "warn" : ""}">${k < 0 ? `${-k}d overdue` : k === 0 ? "today" : `in ${k}d`}</span></span><span class="row-actions"><label class="chk inline"><input type="checkbox" data-dl-done="${d.id}"><span>Done</span></label></span></li>`; }).join("")}</ul>`
      : `<p class="muted">Nothing due in the next 14 days. Add courses and deadlines in <button type="button" class="linkish" data-tab="studies">Studies</button>.</p>`;

    return `<section class="banner">${head}</section>
      ${kpis()}
      <div class="grid2">
        <section class="panel"><h3>Today · ${DAY_NAMES[dow]}</h3>${planHtml}
          <p class="muted small">Change these times in Settings. <button type="button" class="linkish" data-tab="settings">Add them to your phone calendar</button> so you get reminders.</p></section>
        <section class="panel"><h3>Mentor actions</h3>${mentorHtml}</section>
      </div>
      ${n >= 1 && n <= TOTAL_WEEKS ? reviewHtml(wn) + weekBody(wn, true) : ""}
      <section class="panel"><h3>School deadlines</h3>${studyHtml}</section>`;
  }

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
  function practiceHtml(n) {
    const px = practiceOf(n);
    if (!px) return "";
    const carryLabel = n === 1 ? "Carry-over challenge · both halves of this week" : `Carry-over challenge · Week ${n - 1} + Week ${n}`;
    return `<div class="grid2 practice">
      <div class="drills">
        <p class="eyebrow">Practice drills · do these before the problem</p>
        <div class="checks">${px.drills.map((d, i) => chk(`w${n}d${i}`, `<span class="mono small dn">${i + 1}</span> ${esc(d)}`)).join("")}</div>
      </div>
      <div class="assess">
        <p class="eyebrow">Weekly assessment · Sunday, no notes</p>
        <p class="small muted">Answer each question out loud or on paper, then check. Tick only the ones you got right.</p>
        <div class="quiz">${px.quiz.map((x, i) => quizItem(`w${n}q${i}`, x.q, x.a)).join("")}</div>
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
      <div class="quiz">${items.map((x) => `<div class="quiz-item"><p><button type="button" class="chip mono" data-goto-week="${x.w}">W${x.w}</button> ${esc(x.q)}</p><details class="answer"><summary>Show answer</summary><p>${esc(x.a)}</p></details></div>`).join("")}</div>
      <p class="muted small">Got one wrong? Open that week and redo its first two drills.</p></section>`;
  }

  function weekBody(n, compact) {
    const w = weekOf(n);
    return `<section class="panel week-body">
      ${compact ? `<h3>This week's checklist <span class="muted">${pct(weekPct(n))} done</span></h3>` : ""}
      <div class="grid2">
        <div>
          <p class="eyebrow">Skills</p>
          <div class="checks">${w.skills.map((s, i) => chk(`w${n}s${i}`, esc(s))).join("")}</div>
          <p class="eyebrow">Resources</p>
          <ul class="res">${w.resources.map((r) => `<li>${link(r.u, r.t)}</li>`).join("")}</ul>
          <p class="eyebrow">Mentor-network task</p>
          <div class="checks">${chk(`w${n}m`, esc(w.mentor))}</div>
        </div>
        <div>${problemHtml(n)}</div>
      </div>
      ${practiceHtml(n)}
      <div class="week-foot">
        <label class="field sm"><span>Hours studied</span><input id="hours-${n}" type="number" min="0" max="80" step="0.5" inputmode="decimal" data-hours="${n}" value="${esc(P().hours[n] || "")}" placeholder="0"></label>
        <label class="chk inline"><input type="checkbox" data-exam="${n}"${P().exam[n] ? " checked" : ""}><span>Exam week (lighter load)</span></label>
        <label class="field grow"><span>Notes / what I learned</span><textarea id="note-${n}" rows="2" data-note="${n}" placeholder="What clicked, what didn't, questions for mentors">${esc(P().notes[n] || "")}</textarea></label>
      </div>
    </section>`;
  }

  function vRoadmap() {
    const now = weekNow();
    if (!ui.openWeeks.size && now >= 1 && now <= TOTAL_WEEKS) ui.openWeeks.add(now);
    return `<section class="hero"><p class="eyebrow">12 months · 6 phases · 52 weeks</p><h1>Roadmap</h1>
      <p class="lede">Each week: learn the skills, then solve a real fintech problem that reuses earlier weeks. Tick anything off, and untick it if you ticked it by mistake.</p></section>
      ${C.phases.map((ph) => `<section class="phase">
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
      </section>`).join("")}`;
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
        <span class="avatar${p.stage === "mentor" ? " gold" : ""}" aria-hidden="true">${esc((p.name || "?").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase())}</span>
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
      <div class="actions">
        ${r.early || p.stage === "mentor" || p.stage === "call" ? `<button type="button" class="btn sm" data-act="log-comment" data-id="${p.id}">Log comment</button>` : ""}
        ${(p.engagements || []).length ? `<button type="button" class="btn sm ghost" data-act="undo-comment" data-id="${p.id}">Undo last comment</button>` : ""}
        ${!r.early && p.stage !== "parked" ? `<button type="button" class="btn sm" data-act="done-followup" data-id="${p.id}">Done → next reminder</button>` : ""}
        <button type="button" class="btn sm" data-act="msg-for" data-id="${p.id}">Messages</button>
        ${na ? link(gcal({ title: `Mentor: ${p.name} (${p.company || ""})`, date: na.due, allDay: true, details: na.text + (p.linkedin ? "\n" + p.linkedin : "") }), "Add reminder") : ""}
        <button type="button" class="btn sm ghost" data-act="edit" data-id="${p.id}">Edit</button>
        ${confirming
          ? `<span class="confirm">Delete ${esc(p.name)}? <button type="button" class="btn sm danger" data-act="delete" data-id="${p.id}">Delete</button><button type="button" class="btn sm ghost" data-act="cancel-confirm">Keep</button></span>`
          : `<button type="button" class="btn sm ghost" data-act="ask-delete" data-id="${p.id}">Delete</button>`}
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
    const editing = ui.edit !== null ? prospectForm(ui.edit === "new" ? {} : PR()[ui.edit] || {}) : "";
    return `<section class="hero"><p class="eyebrow">Goal: ${MENTOR_GOAL}+ mentors from about ${PROSPECT_GOAL} prospects</p><h1>Mentors</h1>
      <p class="lede">Identify people first, engage on their posts for ${READY_DAYS}+ days (${READY_COMMENTS}+ real comments), then connect. The app tells you who is ready and what to send.</p></section>
      <div class="funnel">${STAGES.map((s) => `<button type="button" class="fstage${ui.mentorFilter === s.id ? " on" : ""}" data-filter="${s.id}"><span class="mono">${counts[s.id] || 0}</span><span>${s.t}</span></button>`).join("")}</div>
      <div class="toolbar">
        <button type="button" class="btn primary" data-act="new-prospect">Add prospect</button>
        <div class="seg">${[["active", "In progress"], ["mentor", "Mentors"], ["parked", "Parked"], ["all", "All"]].map(([k, t]) => `<button type="button" class="${ui.mentorFilter === k ? "on" : ""}" data-filter="${k}">${t}</button>`).join("")}</div>
        <input id="mentor-search" class="search" type="search" placeholder="Search name, company, country" value="${esc(ui.mentorSearch)}" data-search="1">
        <span class="muted small">${all.length}/${PROSPECT_GOAL} prospects in your pipeline</span>
      </div>
      ${editing}
      <div class="pgrid">${list.length ? list.map(prospectCard).join("") : `<p class="muted empty">${all.length ? "No prospects match this filter." : "No prospects yet. Use the Finder tab to search LinkedIn, then add people here."}</p>`}</div>`;
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
    return `<section class="hero"><p class="eyebrow">Find mid-career fintech data scientists</p><h1>Finder</h1>
      <p class="lede">Aim for people 2–8 years in: senior enough to guide you, not so senior they have no time. Pick a market, open the searches, then add the best people to Mentors.</p></section>
      <section class="panel">
        <div class="fields">
          <label class="field"><span>Market</span>${sel("finder-market", "market", N.markets.map((x) => [x.id, x.name + (x.primary ? " ★" : "")]))}</label>
          <label class="field"><span>Role focus</span>${sel("finder-role", "role", [["ds", "Data scientist"], ["risk", "Credit risk modelling"], ["fraud", "Fraud / financial crime"], ["mle", "ML engineer"], ["analytics", "Analytics"]])}</label>
          <label class="field"><span>Company type</span>${sel("finder-tier", "tier", [["any", "Any fintech / bank"], ["startup", "Startups"], ["mid", "Mid-size / scale-ups"], ["large", "Large firms / banks"]])}</label>
        </div>
        <div class="search-cards">
          <div class="scard"><h4>1 · LinkedIn people search</h4><p class="small">Opens LinkedIn with a ready-made search. Then click <b>Locations</b> and choose <b>${esc(m.name.replace(/ \(.*\)/, ""))}</b>.</p><code class="q">${esc(kw)}</code><div class="actions">${link(liPeople, "Open LinkedIn search")}<button type="button" class="btn sm ghost" data-copy="${esc(kw)}">Copy search</button></div></div>
          <div class="scard"><h4>2 · People who post</h4><p class="small">Searches recent <b>posts</b>. Active posters are the ones you can engage with, so start here.</p><div class="actions">${link(liPosts, "Open recent posts")}</div></div>
          <div class="scard"><h4>3 · Google X-ray</h4><p class="small">Finds public LinkedIn profiles through Google, useful when LinkedIn limits your searches.</p><code class="q">${esc(xray)}</code><div class="actions">${link(google, "Search Google")}<button type="button" class="btn sm ghost" data-copy="${esc(xray)}">Copy</button></div></div>
        </div>
      </section>
      <section class="panel"><h3>Fintech companies in ${esc(m.name)}</h3><p class="muted small">Each opens a LinkedIn search for data scientists at that company.</p>
        <div class="patterns">${m.companies.map((c) => `<a class="chip" target="_blank" rel="noopener" href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`"data scientist" "${c.replace(/ \(.*\)/, "")}"`)}">${esc(c)}</a>`).join("")}</div></section>
      <div class="grid2">
        <section class="panel"><h3>How to pick the right people</h3>
          <ol class="steps">
            <li>Open 10–15 profiles from the searches above.</li>
            <li>Keep people who <b>post or comment at least monthly</b>. Check <i>Activity</i> on their profile.</li>
            <li>Check the <b>fit criteria</b> (2–8 years, fintech, replies to comments, mentions mentoring).</li>
            <li>Click <b>Follow</b>, then the <b>bell icon</b> on their profile, so LinkedIn notifies you of every post.</li>
            <li>Press <button type="button" class="linkish" data-act="new-prospect">Add prospect</button>. The ${READY_DAYS}-day clock starts today.</li>
            <li>Add 3–5 people a week until you have about ${PROSPECT_GOAL}. Only about 1 in 10 becomes a mentor, and that's normal.</li>
          </ol>
          <p class="note"><b>Why the app doesn't scan LinkedIn for you:</b> LinkedIn has no public API for this and bans accounts that use scraping tools. The bell notification does the watching safely, and this app does the tracking and timing.</p>
        </section>
        <section class="panel"><h3>Where mentors already gather</h3>
          <ul class="places">${N.places.map((p) => `<li>${link(p.u, p.t)}<span class="muted small">${esc(p.why)}</span></li>`).join("")}</ul>
        </section>
      </div>`;
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
    return `<section class="hero"><p class="eyebrow">Admire, add value, ask small</p><h1>Messages</h1>
      <p class="lede">Never open with "will you mentor me?". Show you've followed their work, show what you've built, and make a small, specific ask. Mentorship grows from 2–3 good exchanges.</p></section>
      <section class="panel">
        <div class="fields">
          <label class="field"><span>Write to</span><select id="msg-prospect" data-msg-prospect="1"><option value="">(no one: show placeholders)</option>${prospects().map((x) => `<option value="${x.id}"${x.id === ui.msgProspect ? " selected" : ""}>${esc(x.name)}${x.company ? " · " + esc(x.company) : ""}</option>`).join("")}</select></label>
        </div>
        ${p ? `<p class="small">${readiness(p).early && !readiness(p).ready ? `<span class="pill warn">Not ready yet</span> ${esc(nextAction(p).text)}` : `<span class="pill accent">Next step</span> ${esc((nextAction(p) || { text: "Parked." }).text)}`} ${localTime(p).label ? `· Their time: ${esc(localTime(p).label)}${localTime(p).good ? " (good time)" : " (best: Tue–Thu, 8–10am their time)"}` : ""}</p>` : ""}
        <p class="muted small">Your details (name, one-liner, latest project, question) come from <button type="button" class="linkish" data-tab="settings">Settings</button>. Anything in [brackets] needs your own words, which is what makes a message land.</p>
      </section>
      <div class="tgrid">${N.templates.map((t) => {
        const text = fillTemplate(t.body, p);
        const over = t.limit && text.length > t.limit;
        return `<article class="panel tmpl"><header><h4>${esc(t.stage)}</h4>${t.limit ? `<span class="pill ${over ? "bad" : ""}">${text.length}/${t.limit}</span>` : ""}</header>
          <p class="muted small">${esc(fillTemplate(t.when, p))}</p>
          <pre class="msg" id="tmpl-${t.id}">${esc(text)}</pre>
          <div class="actions"><button type="button" class="btn sm primary" data-copy-el="tmpl-${t.id}">Copy</button>${over ? `<span class="small bad-text">Over LinkedIn's free-account note limit. Shorten it.</span>` : ""}</div></article>`;
      }).join("")}</div>
      <div class="grid2">
        <section class="panel"><h3>Comment formula (for the ${READY_DAYS}-day warm-up)</h3>
          <dl class="formula">${N.commentFormula.map((c) => `<dt>${esc(c.k)}</dt><dd>${esc(c.v)}</dd>`).join("")}</dl>
          <p class="eyebrow">Examples using your weekly problems</p>
          <ul class="quotes">${N.commentExamples.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
          <p class="muted small">Avoid "Great post!" and emoji-only comments: they build no familiarity.</p>
        </section>
        <section class="panel"><h3>Questions for a 15-minute call</h3>
          <ul class="steps">${N.callQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>
          <p class="note">Before the call, send your agenda in one line. Stop at 15 minutes, even if it's going well. Send the thank-you within 24 hours.</p>
        </section>
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
    return `<section class="hero"><p class="eyebrow">Your degree comes first</p><h1>Studies</h1>
      <p class="lede">Put your classes and deadlines here so they show up on Today next to your ML plan. In exam weeks, tick "Exam week" in the Roadmap to lighten the load.</p></section>
      <div class="grid2">
        <section class="panel"><h3>Courses</h3>
          <form class="inline-form" id="course-form"><input id="course-name" name="name" required placeholder="e.g. Financial Accounting II"><button class="btn primary" type="submit">Add course</button></form>
          <ul class="plist">${st.courses.map((c) => `<li><span>${esc(c.name)}</span><span class="row-actions">${ui.confirm === "course:" + c.id ? `<button type="button" class="btn sm danger" data-act="del-course" data-id="${c.id}">Remove</button><button type="button" class="btn sm ghost" data-act="cancel-confirm">Keep</button>` : `<button type="button" class="btn sm ghost" data-act="ask-del-course" data-id="${c.id}">Remove</button>`}</span></li>`).join("") || `<li class="muted">No courses yet.</li>`}</ul>
          <label class="field"><span>Semester ends (classes stop showing after this)</span><input id="semester-end" type="date" data-semester="1" value="${esc(st.semesterEnd || "")}"></label>
        </section>
        <section class="panel"><h3>Add a class to your timetable</h3>
          <form class="fields" id="class-form">
            <label class="field"><span>Course</span><select id="class-course" name="course" required>${courseOpts || `<option value="">Add a course first</option>`}</select></label>
            <label class="field"><span>Day</span><select id="class-day" name="day">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}">${DAY_NAMES[d]}</option>`).join("")}</select></label>
            <label class="field"><span>Start</span><input id="class-start" name="start" type="time" value="09:00" required></label>
            <label class="field"><span>End</span><input id="class-end" name="end" type="time" value="11:00" required></label>
            <label class="field"><span>Room (optional)</span><input id="class-place" name="place" placeholder="Room B204"></label>
            <div class="actions"><button class="btn primary" type="submit"${st.courses.length ? "" : " disabled"}>Add class</button></div>
          </form>
        </section>
      </div>
      <section class="panel"><h3>Weekly timetable</h3>
        <div class="timetable">${byDay.map(({ d, items }) => `<div class="tday"><p class="eyebrow">${DAY_NAMES[d].slice(0, 3)}</p>${items.map((c) => `<div class="tclass"><span class="mono small">${esc(c.start)}–${esc(c.end)}</span><b>${esc(courseName(c.course))}</b>${c.place ? `<span class="muted small">${esc(c.place)}</span>` : ""}<button type="button" class="x" aria-label="Remove class" data-act="del-class" data-id="${c.id}">×</button></div>`).join("") || `<span class="muted small">—</span>`}</div>`).join("")}</div>
        ${st.classes.length ? `<p class="small muted">Add your timetable to Google Calendar: ${st.classes.map((c) => link(gcal({ title: courseName(c.course), date: nextDow(Number(c.day)), start: c.start, mins: Math.max(15, minutesBetween(c.start, c.end)), recur: `FREQ=WEEKLY${st.semesterEnd ? ";UNTIL=" + st.semesterEnd.replace(/-/g, "") : ""}`, details: c.place || "" }), `${DAY_NAMES[c.day].slice(0, 3)} ${courseName(c.course)}`)).join(" · ")}</p>` : ""}
      </section>
      <section class="panel"><h3>Assignments, tests & exams</h3>
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
    return `<section class="hero"><p class="eyebrow">Goal: ${PROJECT_GOAL}+ real-world projects</p><h1>Projects</h1>
      <p class="lede">Portfolio projects are your proof of value when you reach out to mentors and employers. Tick "Shipped" only when it's public: code, README and demo.</p></section>
      <div class="pgrid wide">${C.projects.map((pj) => {
        const ms = pj.milestones.map((_, i) => `${pj.id}m${i}`);
        const done = ms.filter(isChecked).length;
        const meta = P().projects[pj.id] || {};
        return `<article class="panel project${isChecked(pj.id + "shipped") ? " shipped" : ""}">
          <p class="eyebrow">${esc(pj.weeks)}</p><h3>${esc(pj.name)}</h3><p class="muted">${esc(pj.summary)}</p>
          <div class="prow">${bar(done / ms.length)}<span class="mono small">${done}/${ms.length}</span></div>
          <div class="checks">${pj.milestones.map((m, i) => chk(`${pj.id}m${i}`, esc(m))).join("")}</div>
          <div class="fields">
            <label class="field"><span>GitHub repo</span><input id="${pj.id}-repo" type="url" data-project="${pj.id}" data-field="repo" value="${esc(meta.repo || "")}" placeholder="https://github.com/…"></label>
            <label class="field"><span>Live demo</span><input id="${pj.id}-demo" type="url" data-project="${pj.id}" data-field="demo" value="${esc(meta.demo || "")}" placeholder="https://…streamlit.app"></label>
          </div>
          <div class="checks">${chk(pj.id + "shipped", "<b>Shipped</b>: public repo, README, demo and launch post")}</div>
        </article>`;
      }).join("")}</div>`;
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
    return `<section class="hero"><p class="eyebrow">How far you've come</p><h1>Progress</h1></section>
      ${kpis()}
      <section class="panel"><h3>52 weeks at a glance</h3><p class="muted small">Each square is a week; darker means more of it is checked off. Click one to open it.</p>
        <div class="weekgrid">${Array.from({ length: TOTAL_WEEKS }, (_, i) => { const n = i + 1; const p = weekPct(n); return `<button type="button" class="wcell${n === now ? " now" : ""}" style="--p:${p.toFixed(2)}" data-goto-week="${n}" title="Week ${n}: ${esc(weekOf(n).title)} (${pct(p)})"><span>${n}</span></button>`; }).join("")}</div>
      </section>
      <div class="grid2">
        <section class="panel"><h3>Phases</h3>${C.phases.map((ph) => `<div class="prow"><span class="plabel">${ph.id}. ${esc(ph.name)}</span>${bar(phasePct(ph))}<span class="mono small">${pct(phasePct(ph))}</span></div>`).join("")}</section>
        <section class="panel"><h3>Mentor funnel</h3><p class="muted small">People who reached each stage or beyond.</p>${funnel.map((f) => `<div class="prow"><span class="plabel">${esc(f.t)}</span>${bar(f.n / fmax, "gold")}<span class="mono small">${f.n}</span></div>`).join("")}</section>
      </div>
      <section class="panel"><h3>Hours per week <span class="muted">${totalH} hours total</span></h3><div class="chart-wrap">${svg}</div></section>`;
  }

  function vSettings() {
    const s = S();
    const field = (k, label, ph, type) => `<label class="field${type === "wide" ? " wide" : ""}"><span>${label}</span><input id="set-${k}" data-setting="${k}" value="${esc(s[k] || "")}" placeholder="${esc(ph || "")}"></label>`;
    const end = weekEnd(TOTAL_WEEKS).replace(/-/g, "");
    const byday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    const gl = s.routine.map((r) => link(gcal({ title: `Study: ${r.label}`, date: nextOnOrAfter(s.startDate, Number(r.day)), start: r.start, mins: Number(r.mins) || 60, recur: `FREQ=WEEKLY;BYDAY=${byday[r.day]};UNTIL=${end}`, details: "Fintech ML Ledger: open the Today tab for this week's checklist." }), `${DAY_NAMES[r.day].slice(0, 3)} ${r.start} ${r.label}`));
    gl.unshift(link(gcal({ title: "LinkedIn: comment on prospects' posts", date: s.startDate, start: s.linkedinTime, mins: Number(s.linkedinMins) || 15, recur: `FREQ=DAILY;UNTIL=${end}`, details: "Open the Today tab > Engage today. One thoughtful comment each (anchor, add, ask), then press Log comment." }), `Daily ${s.linkedinTime} LinkedIn engagement`));
    gl.push(link(gcal({ title: "Mentors: monthly update + pipeline review", date: s.startDate, allDay: true, recur: `FREQ=WEEKLY;INTERVAL=4;UNTIL=${end}`, details: "Send monthly updates to mentors, add new prospects, review your funnel." }), "Every 4 weeks: mentor updates"));
    return `<section class="hero"><p class="eyebrow">Your details, schedule and reminders</p><h1>Settings</h1></section>
      <section class="panel"><h3>About you (used in your messages)</h3>
        <div class="fields">
          ${field("name", "Your name", "Ada Okafor")}
          ${field("oneLiner", "Who you are in one line", "a finance student building ML for credit risk", "wide")}
          ${field("project", "Latest project", "a credit-risk EDA of 150k borrowers")}
          ${field("projectLink", "Project link", "https://github.com/…")}
          ${field("win", "Latest win (for follow-ups)", "deployed my first model API")}
          ${field("ask", "Your one specific question", "how do you choose thresholds for fraud alerts?", "wide")}
        </div></section>
      <section class="panel"><h3>Plan</h3>
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
        <button type="button" class="btn sm" data-act="add-routine">Add session</button>
        <p class="muted small">Default: about ${Math.round(s.routine.reduce((a, r) => a + Number(r.mins || 0), 0) / 60)} hours a week plus ${s.linkedinMins} minutes of LinkedIn a day, which is manageable alongside a full course load.</p>
      </section>
      <section class="panel" id="reminders"><h3>Reminders on your phone</h3>
        <p>Tap each link once to add a repeating event to Google Calendar (it syncs to your phone's calendar and notifications). Prospect follow-ups and deadlines have their own <b>Add reminder</b> links.</p>
        <div class="linkcol">${gl.join("")}</div>
        <p class="muted small">Use Apple Calendar or Outlook? Download an .ics file with all reminders, including each week's topic and your prospect follow-ups. This works when the app is opened as a file on your computer; inside Claude, use the links above.</p>
        <button type="button" class="btn" data-act="ics">Download calendar file (.ics)</button>
      </section>
      <section class="panel"><h3>Your data</h3>
        <p><span id="sync" class="sync"></span></p>
        <div class="actions">
          <button type="button" class="btn" data-act="export">Export backup (.json)</button>
          <label class="btn file-btn">Import backup<input id="import-file" type="file" accept="application/json,.json" data-import="1"></label>
          ${ui.confirm === "reset" ? `<span class="confirm">Erase everything? <button type="button" class="btn danger" data-act="reset">Erase</button><button type="button" class="btn ghost" data-act="cancel-confirm">Cancel</button></span>` : `<button type="button" class="btn ghost" data-act="ask-reset">Reset all data</button>`}
        </div>
      </section>`;
  }
  function nextOnOrAfter(date, dow) {
    const cur = parse(date).getDay();
    return addDays(date, (dow - cur + 7) % 7);
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
    ui.tab = id; ui.confirm = null;
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
    const t = e.target.closest("[data-tab],[data-act],[data-goto-week],[data-filter],[data-copy],[data-copy-el]");
    if (!t) return;
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    if (t.dataset.gotoWeek) {
      const n = Number(t.dataset.gotoWeek);
      ui.openWeeks.add(n);
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
      case "new-prospect": ui.edit = "new"; if (ui.tab !== "mentors") { ui.tab = "mentors"; } render(); $("#pf-name") && $("#pf-name").focus(); break;
      case "edit": ui.edit = id; render(); $("#prospect-form") && $("#prospect-form").scrollIntoView({ behavior: "smooth" }); break;
      case "cancel-edit": ui.edit = null; rerender(); break;
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
    if (d.open && !ui.openWeeks.has(n)) { ui.openWeeks.add(n); d.insertAdjacentHTML("beforeend", weekBody(n, false)); }
    else if (!d.open) { ui.openWeeks.delete(n); const b = d.querySelector(".week-body"); if (b) b.remove(); }
  }, true);

  document.addEventListener("change", (e) => {
    const t = e.target;
    const ds = t.dataset;
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

  let noteTimer;
  document.addEventListener("input", (e) => {
    const t = e.target;
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

  // Refresh "today" if the page stays open past midnight.
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); if (!document.activeElement || !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) rerender(); } }, 60000);

  Store.init(render);
})();
