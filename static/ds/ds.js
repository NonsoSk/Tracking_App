/* IEFCL Recruitment — design-system behaviour. No dependencies. */
(function () {
  "use strict";

  var root = document.documentElement;
  var THEME_KEY = "iefcl-theme";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ---------- Theme: Light / Dark / Auto, remembered (the head script applies it before paint) ---------- */
  function storedTheme() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; }
  }
  function applyTheme(choice) {
    var resolved = choice === "auto" ? (darkQuery.matches ? "dark" : "light") : choice;
    root.dataset.theme = resolved;
    root.dataset.themeChoice = choice;
    $$("[data-theme-set]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.themeSet === choice)); });
    $$("[data-theme-icon]").forEach(function (i) { i.hidden = i.dataset.themeIcon !== choice; });
  }
  function setTheme(choice) {
    try { localStorage.setItem(THEME_KEY, choice); } catch (e) { /* private mode */ }
    applyTheme(choice);
  }
  darkQuery.addEventListener("change", function () { if (storedTheme() === "auto") applyTheme("auto"); });

  /* ---------- Popovers: [data-popover="id"] toggles #id ---------- */
  function closePopovers(except) {
    $$(".popover:not([hidden])").forEach(function (p) {
      if (p === except) return;
      p.hidden = true;
      var t = $('[data-popover="' + p.id + '"]');
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }

  /* ---------- Tabs with sliding indicator and arrow-key support ---------- */
  function moveIndicator(list) {
    var ind = $(".indicator", list);
    var cur = $('[aria-selected="true"], [aria-current="page"]', list);
    if (!ind || !cur) return;
    ind.style.left = cur.offsetLeft + "px";
    ind.style.width = cur.offsetWidth + "px";
  }
  function initTabs(list) {
    if (!$(".indicator", list)) { var i = document.createElement("span"); i.className = "indicator"; i.setAttribute("aria-hidden", "true"); list.appendChild(i); }
    var tabs = $$('[role="tab"]', list);
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
      moveIndicator(list);
    }
    function panelFor(t) { return document.getElementById(t.getAttribute("aria-controls")); }
    tabs.forEach(function (t, idx) {
      t.addEventListener("click", function () {
        select(t);
        if (list.hasAttribute("data-hash") && history.replaceState) history.replaceState(null, "", "#" + t.getAttribute("aria-controls"));
      });
      t.addEventListener("keydown", function (e) {
        var n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (e.key === "Home") { e.preventDefault(); select(tabs[0], true); }
        if (e.key === "End") { e.preventDefault(); select(tabs[tabs.length - 1], true); }
        if (n) { e.preventDefault(); select(tabs[(idx + n + tabs.length) % tabs.length], true); }
      });
    });
    moveIndicator(list);
    /* Open the tab that holds #anchor (links, redirects after a form, or the tab's own id) */
    list._reveal = function (id) {
      var target = id && document.getElementById(id);
      if (!target) return false;
      var owner = tabs.filter(function (t) { var p = panelFor(t); return p && (p === target || p.contains(target)); })[0];
      if (!owner) return false;
      select(owner);
      if (target !== panelFor(owner)) setTimeout(function () { target.scrollIntoView({ block: "start", behavior: reduceMotion.matches ? "auto" : "smooth" }); }, 60);
      return true;
    };
    if (list.hasAttribute("data-hash")) list._reveal(decodeURIComponent(location.hash.slice(1)));
  }
  window.addEventListener("hashchange", function () {
    $$(".tabs[data-hash]").forEach(function (l) { if (l._reveal) l._reveal(decodeURIComponent(location.hash.slice(1))); });
  });

  /* ---------- Confirmations: a calm dialog instead of the browser's alert box ---------- */
  var confirmed = null;
  function askToConfirm(button, message) {
    var dlg = $("#ds-confirm");
    if (!dlg || !dlg.showModal) return window.confirm(message);
    $(".msg", dlg).textContent = message;
    var ok = $("[data-confirm-ok]", dlg);
    ok.textContent = button.dataset.confirmLabel || (button.textContent || "").trim() || "Continue";
    ok.className = "btn " + (button.dataset.confirmTone === "primary" ? "btn-primary" : "btn-danger");
    dlg.showModal();
    ok.focus();
    ok.onclick = function () {
      dlg.close();
      confirmed = button;
      var form = button.form || button.closest("form");
      if (form && form.requestSubmit) form.requestSubmit(button); else if (form) form.submit();
    };
    return false;
  }
  document.addEventListener("submit", function (e) {
    var button = e.submitter;
    var message = e.target.dataset.confirm || (button && button.dataset.confirm);
    if (!message) return;
    if (confirmed && confirmed === button) { confirmed = null; return; }
    e.preventDefault();
    askToConfirm(button || e.target, message);
  });

  /* ---------- Toasts: bottom-right, auto-dismiss, optional undo ---------- */
  var TONE_ICON = { success: "tile green", warning: "tile amber", danger: "tile red", info: "tile" };
  function dismiss(t) {
    if (!t || t.classList.contains("is-leaving")) return;
    t.classList.add("is-leaving");
    setTimeout(function () { t.remove(); }, reduceMotion.matches ? 0 : 180);
  }
  function arm(t) {
    var close = $("[data-toast-close]", t);
    if (close) close.addEventListener("click", function () { dismiss(t); });
    var undo = $("[data-toast-undo]", t);
    if (undo && t._onUndo) undo.addEventListener("click", function () { t._onUndo(); dismiss(t); });
    var ms = parseInt(t.dataset.timeout || "6000", 10);
    if (ms > 0) {
      var timer = setTimeout(function () { dismiss(t); }, ms);
      t.addEventListener("mouseenter", function () { clearTimeout(timer); });
      t.addEventListener("focusin", function () { clearTimeout(timer); });
    }
  }
  function toast(opts) {
    var box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    var tone = opts.tone || "info";
    var t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", tone === "danger" ? "alert" : "status");
    t.dataset.timeout = String(opts.timeout != null ? opts.timeout : 6000);
    var icon = $("#ds-toast-icon-" + tone);
    t.innerHTML = '<span class="' + TONE_ICON[tone] + '">' + (icon ? icon.innerHTML : "") + "</span>" +
      "<div><b></b><p></p></div>" +
      '<div class="actions">' + (opts.onUndo ? '<button class="btn btn-ghost btn-sm" type="button" data-toast-undo>Undo</button>' : "") +
      '<button class="icon-btn" type="button" data-toast-close aria-label="Dismiss">' + (($("#ds-icon-x") || {}).innerHTML || "×") + "</button></div>";
    $("b", t).textContent = opts.title || "";
    $("p", t).textContent = opts.body || "";
    if (!opts.body) $("p", t).remove();
    t._onUndo = opts.onUndo;
    box.appendChild(t);
    arm(t);
    return t;
  }

  /* ---------- Command palette (Ctrl/Cmd+K) ---------- */
  function initPalette(dlg) {
    var input = $("input", dlg);
    var results = $("#palette-results", dlg);
    var empty = $(".palette-empty", dlg);
    var items = function () { return $$(".menu-item", dlg).filter(function (i) { return !i.hidden; }); };
    var active = 0, timer = null, pending = null;
    function highlight(keep) {
      var list = items();
      if (keep) { var idx = list.indexOf(keep); active = idx >= 0 ? idx : 0; }
      active = Math.max(0, Math.min(active, list.length - 1));
      $$(".menu-item.is-active", dlg).forEach(function (i) { i.classList.remove("is-active"); i.removeAttribute("aria-selected"); });
      list.forEach(function (i, n) { i.classList.toggle("is-active", n === active); i.setAttribute("aria-selected", String(n === active)); });
      if (list[active]) list[active].scrollIntoView({ block: "nearest" });
    }
    function tidyGroups() {
      $$(".pr > .pg", dlg).forEach(function (g) {
        var next = g.nextElementSibling, any = false;
        while (next && !next.classList.contains("pg")) {
          if (next.classList.contains("menu-item") && !next.hidden) any = true;
          next = next.nextElementSibling;
        }
        g.hidden = !any;
      });
      var q = input.value.trim();
      $(".q", empty).textContent = q;
      empty.hidden = !q || items().length > 0;
    }
    function renderResults(data) {
      results.innerHTML = "";
      (data.groups || []).forEach(function (group) {
        var head = document.createElement("div");
        head.className = "pg";
        head.textContent = group.title;
        results.appendChild(head);
        var icon = ($("#ds-pi-" + group.kind, dlg) || {}).innerHTML || "";
        group.items.forEach(function (it) {
          var a = document.createElement("a");
          a.className = "menu-item";
          a.href = it.url;
          a.innerHTML = icon + '<span class="lbl"></span><span class="hint"></span>';
          $(".lbl", a).textContent = it.label;
          $(".hint", a).textContent = it.hint || "";
          results.appendChild(a);
        });
      });
    }
    function search(q) {
      if (pending) pending.abort();
      if (q.length < 2) { renderResults({}); tidyGroups(); highlight(); return; }
      pending = "AbortController" in window ? new AbortController() : null;
      fetch(results.dataset.url + "?q=" + encodeURIComponent(q), { headers: { "Accept": "application/json" }, signal: pending && pending.signal, credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : { groups: [] }; })
        .then(function (data) {
          if (data.query !== input.value.trim().slice(0, 80)) return;
          var keep = items()[active];
          renderResults(data);
          tidyGroups();
          highlight(keep && keep.dataset.search !== undefined ? keep : null);
        })
        .catch(function () { /* aborted or offline: the "Search everywhere" links still work */ });
    }
    function filter() {
      var raw = input.value.trim();
      var words = raw.toLowerCase().split(/\s+/).filter(Boolean);
      $$(".menu-item[data-search]", dlg).forEach(function (i) {
        var text = i.dataset.search.toLowerCase();
        i.hidden = words.length > 0 && !words.every(function (w) { return text.indexOf(w) !== -1; });
      });
      $$(".menu-item[data-query-url]", dlg).forEach(function (i) {
        i.hidden = !raw;
        $(".q", i).textContent = raw;
        i.href = i.dataset.queryUrl + encodeURIComponent(raw);
      });
      if (!raw) results.innerHTML = "";
      tidyGroups();
      active = 0;
      highlight();
      clearTimeout(timer);
      timer = setTimeout(function () { search(raw); }, 140);
    }
    input.addEventListener("input", filter);
    input.addEventListener("keydown", function (e) {
      var list = items();
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, list.length - 1); highlight(); }
      if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); highlight(); }
      if (e.key === "Enter" && list[active]) { e.preventDefault(); list[active].click(); }
    });
    dlg.addEventListener("close", function () { input.value = ""; filter(); });
    dlg._open = function () { dlg.showModal(); input.focus(); filter(); };
  }

  /* ---------- Score rings and count-up (on first view) ---------- */
  function animateRing(ring) {
    var arc = $(".arc", ring);
    if (!arc || reduceMotion.matches) return;
    var target = arc.getAttribute("stroke-dashoffset");
    arc.style.transition = "none";
    arc.setAttribute("stroke-dashoffset", arc.getAttribute("stroke-dasharray"));
    arc.getBoundingClientRect();
    arc.style.transition = "";
    requestAnimationFrame(function () { arc.setAttribute("stroke-dashoffset", target); });
  }
  function countUp(el) {
    var to = parseFloat(el.dataset.countTo);
    if (isNaN(to) || reduceMotion.matches) return;
    var decimals = (el.dataset.countTo.split(".")[1] || "").length;
    var start = performance.now(), dur = 900;
    var fmt = function (v) { return v.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); };
    (function tick(now) {
      var p = Math.min((now - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * eased);
      if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(to);
    })(start);
  }
  function onFirstView(els, fn) {
    if (!("IntersectionObserver" in window)) { els.forEach(fn); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); fn(en.target); } });
    }, { threshold: 0.3 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Gold confetti: only for "Offer accepted" and "Hired" (under 1.2s) ---------- */
  function confetti() {
    if (reduceMotion.matches) return;
    var c = document.createElement("canvas");
    c.className = "confetti";
    c.setAttribute("aria-hidden", "true");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    document.body.appendChild(c);
    var ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    var colours = ["#B0700E", "#E9B65C", "#F3E2BF", "#C98A2B"];
    var parts = [];
    for (var i = 0; i < 90; i++) {
      parts.push({ x: innerWidth / 2 + (Math.random() - 0.5) * 160, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 5, h: 3 + Math.random() * 3, c: colours[i % colours.length] });
    }
    var start = performance.now();
    (function frame(now) {
      var t = (now - start) / 1150;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      parts.forEach(function (p) {
        p.vy += 0.32; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (t < 1) requestAnimationFrame(frame); else c.remove();
    })(start);
  }

  /* ---------- Drop-zone: highlight, list chosen files with progress bars ---------- */
  function initDropzone(zone) {
    var input = $('input[type="file"]', zone);
    var list = zone.dataset.list ? document.getElementById(zone.dataset.list) : null;
    ["dragenter", "dragover"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add("is-over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { zone.addEventListener(ev, function () { zone.classList.remove("is-over"); }); });
    zone.addEventListener("drop", function (e) {
      e.preventDefault();
      if (input && e.dataTransfer && e.dataTransfer.files.length) { input.files = e.dataTransfer.files; input.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    zone.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && input) { e.preventDefault(); input.click(); } });
    if (input && list) input.addEventListener("change", function () {
      list.innerHTML = "";
      Array.prototype.forEach.call(input.files, function (f) {
        var row = document.createElement("div");
        row.className = "fileitem";
        row.innerHTML = '<span class="tile sm">' + (($("#ds-icon-file") || {}).innerHTML || "") + '</span><div><div class="name"></div><div class="progress"><i style="width:0%"></i></div></div><span class="caption muted"></span>';
        $(".name", row).textContent = f.name;
        $(".caption", row).textContent = (f.size / 1024 / 1024).toFixed(1) + " MB";
        list.appendChild(row);
        requestAnimationFrame(function () { $(".progress i", row).style.width = "100%"; });
      });
    });
  }

  /* ---------- Wiring ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-theme-set]");
    if (t) { setTheme(t.dataset.themeSet); return; }

    var pop = e.target.closest("[data-popover]");
    if (pop) {
      var p = document.getElementById(pop.dataset.popover);
      var open = p.hidden;
      closePopovers(p);
      p.hidden = !open;
      pop.setAttribute("aria-expanded", String(open));
      if (open) { var first = $("a, button, input", p); if (first) first.focus(); }
      return;
    }
    if (!e.target.closest(".popover")) closePopovers();

    var jump = e.target.closest('a[href^="#"]');
    if (jump && jump.getAttribute("href").length > 1) {
      var id = decodeURIComponent(jump.getAttribute("href").slice(1));
      var handled = $$(".tabs[data-hash]").some(function (l) { return l._reveal && l._reveal(id); });
      if (handled) { e.preventDefault(); if (history.replaceState) history.replaceState(null, "", "#" + id); return; }
    }

    var opener = e.target.closest("[data-open]");
    if (opener) {
      var d = document.getElementById(opener.dataset.open);
      if (d && d._open) d._open(); else if (d) d.showModal();
      return;
    }
    if (e.target.closest("[data-close]")) { var dlg = e.target.closest("dialog"); if (dlg) dlg.close(); return; }
    if (e.target.tagName === "DIALOG") { e.target.close(); return; } /* click on the backdrop */

    var pick = e.target.closest(".pick, .seg[data-seg] > button");
    if (pick) {
      if (pick.closest(".seg")) $$("button", pick.parentNode).forEach(function (b) { b.setAttribute("aria-pressed", String(b === pick)); });
      var filterOf = pick.parentNode.dataset && pick.parentNode.dataset.filter;
      if (filterOf) {
        var kind = pick.dataset.kind;
        $$("#" + filterOf + " > [data-kind]").forEach(function (el) { el.hidden = kind !== "all" && el.dataset.kind !== kind; });
      }
      else pick.setAttribute("aria-pressed", String(pick.getAttribute("aria-pressed") !== "true"));
    }

    var tg = e.target.closest("[data-toast]");
    if (tg) {
      var undo = tg.hasAttribute("data-toast-undoable");
      toast({ title: tg.dataset.toast, body: tg.dataset.toastBody, tone: tg.dataset.toastTone, onUndo: undo ? function () { toast({ title: "Undone", tone: "info", timeout: 2500 }); } : null });
    }
    if (e.target.closest("[data-confetti]")) confetti();

    var copy = e.target.closest("[data-copy]");
    if (copy) {
      var done = function () { toast({ title: "Link copied", tone: "success", timeout: 2500 }); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(copy.dataset.copy).then(done, function () {});
      else { var field = copy.parentNode.querySelector("input"); if (field) { field.select(); document.execCommand("copy"); done(); } }
    }

    var dens = e.target.closest("[data-set-density]");
    if (dens) { var w = document.getElementById(dens.dataset.target); if (w) w.dataset.density = dens.dataset.setDensity; }
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      var pal = $("#palette");
      if (pal) { e.preventDefault(); if (pal.open) pal.close(); else pal._open(); }
    }
    if (e.key === "Escape") closePopovers();
  });

  /* ---------- CV viewer: hovering an extracted field lights up where it came from ---------- */
  function initCvLinks() {
    $$(".xfield[data-k]").forEach(function (field) {
      var marks = $$('.cv-text mark[data-k="' + field.dataset.k + '"]');
      if (!marks.length) return;
      field.tabIndex = 0;
      field.title = "Shown in the CV";
      var on = function (state) {
        marks.forEach(function (m) { m.classList.toggle("is-on", state); });
        field.classList.toggle("is-linked", state);
        if (state) {
          var paper = marks[0].closest(".cv-text");
          paper.scrollTo({ top: Math.max(0, marks[0].offsetTop - paper.offsetTop - 48), behavior: reduceMotion.matches ? "auto" : "smooth" });
        }
      };
      field.addEventListener("mouseenter", function () { on(true); });
      field.addEventListener("mouseleave", function () { on(false); });
      field.addEventListener("focus", function () { on(true); });
      field.addEventListener("blur", function () { on(false); });
    });
  }

  function init() {
    initCvLinks();
    applyTheme(storedTheme());
    $$(".tabs[role='tablist']").forEach(initTabs);
    $$(".tabs:not([role='tablist'])").forEach(function (l) {
      if (!$(".indicator", l)) { var i = document.createElement("span"); i.className = "indicator"; i.setAttribute("aria-hidden", "true"); l.appendChild(i); }
      moveIndicator(l);
    });
    $$("#toasts .toast").forEach(arm);
    $$("dialog.palette").forEach(initPalette);
    $$(".dropzone").forEach(initDropzone);
    $$(".enter").forEach(function (box) {
      Array.prototype.slice.call(box.children, 0, 8).forEach(function (c, n) { c.style.setProperty("--i", n); });
    });
    onFirstView($$(".ring[data-animate]"), animateRing);
    onFirstView($$("[data-count-to]"), countUp);
    if (document.body.hasAttribute("data-celebrate")) setTimeout(confetti, 300);
    window.addEventListener("resize", function () { $$(".tabs").forEach(moveIndicator); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.DS = { toast: toast, confetti: confetti, setTheme: setTheme, animateRing: animateRing, countUp: countUp };
})();
