/* IEFCL Recruitment — page behaviours: tag inputs, requirement suggestions, scorecards, CV autofill.
   Loaded after ds.js on every page. No dependencies. */
(function () {
  "use strict";

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function csrfToken() {
    var input = $("input[name=csrfmiddlewaretoken]");
    if (input && input.value) return input.value;
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }
  function icon(name) {
    var t = document.getElementById("ds-icon-" + name);
    return t ? t.innerHTML : "";
  }
  function toast(opts) { if (window.DS && window.DS.toast) window.DS.toast(opts); }
  function flash(el) {
    el.classList.remove("autofill-flash");
    void el.offsetWidth;
    el.classList.add("autofill-flash");
  }
  var TERMS_URL = document.body.dataset.termsUrl || "/requisitions/api/terms/";

  /* ------------------------------------------------------------------
   * Tag inputs: <textarea data-tags="skill|tool|certification|course"> becomes chips + a typing field.
   * The textarea stays in the form (hidden) and always holds one value per line.
   * ------------------------------------------------------------------ */
  function initTagInput(textarea) {
    if (textarea._tagApi) return textarea._tagApi;
    var kind = textarea.dataset.tags || "";
    var wrapper = document.createElement("div");
    wrapper.className = "tag-input";
    var input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = textarea.getAttribute("placeholder") || "Type and press Enter";
    input.id = (textarea.id || "tags-" + Math.random().toString(36).slice(2)) + "-entry";
    var label = textarea.id ? $('label[for="' + textarea.id + '"]') : null;
    if (label) label.htmlFor = input.id;
    var listId = input.id + "-list";
    input.setAttribute("list", listId);
    var datalist = document.createElement("datalist");
    datalist.id = listId;
    wrapper.appendChild(input);
    wrapper.appendChild(datalist);
    textarea.hidden = true;
    textarea.parentNode.insertBefore(wrapper, textarea.nextSibling);

    var values = textarea.value.split(/\n|,/).map(function (v) { return v.trim(); }).filter(Boolean);
    var listeners = [];

    function changed() {
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      listeners.forEach(function (fn) { fn(); });
    }
    function sync() {
      textarea.value = values.join("\n");
      $$(".tag", wrapper).forEach(function (c) { c.remove(); });
      values.forEach(function (value, idx) {
        var chip = document.createElement("span");
        chip.className = "tag on";
        chip.innerHTML = '<span></span><button type="button">' + (icon("x") || "×") + "</button>";
        chip.firstChild.textContent = value;
        var btn = chip.querySelector("button");
        btn.setAttribute("aria-label", "Remove " + value);
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          values.splice(idx, 1);
          sync();
          changed();
          input.focus();
        });
        wrapper.insertBefore(chip, input);
      });
    }
    function find(value) {
      var low = value.toLowerCase();
      for (var i = 0; i < values.length; i++) if (values[i].toLowerCase() === low) return i;
      return -1;
    }
    function add(value) {
      value = (value || "").trim().replace(/\s+/g, " ");
      if (!value || find(value) !== -1) return false;
      values.push(value);
      sync();
      changed();
      return true;
    }
    function remove(value) {
      var i = find(value || "");
      if (i === -1) return false;
      values.splice(i, 1);
      sync();
      changed();
      return true;
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        add(input.value);
        input.value = "";
      } else if (e.key === "Backspace" && !input.value && values.length) {
        values.pop();
        sync();
        changed();
      }
    });
    input.addEventListener("change", function () {
      /* Choosing from the suggestion list fires change: commit it */
      var picked = $$("option", datalist).some(function (o) { return o.value === input.value; });
      if (input.value && picked) { add(input.value); input.value = ""; }
    });
    input.addEventListener("blur", function () {
      if (input.value.trim()) { add(input.value); input.value = ""; }
    });
    var timer;
    input.addEventListener("input", function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) return;
      timer = setTimeout(function () {
        fetch(TERMS_URL + "?kind=" + encodeURIComponent(kind) + "&q=" + encodeURIComponent(q), { credentials: "same-origin" })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            datalist.innerHTML = (data.results || []).map(function (t) { return '<option value="' + escapeHtml(t) + '">'; }).join("");
          })
          .catch(function () {});
      }, 180);
    });
    wrapper.addEventListener("click", function (e) { if (e.target === wrapper) input.focus(); });
    sync();
    textarea._tagApi = {
      add: add, remove: remove,
      has: function (v) { return find(v) !== -1; },
      set: function (list) { values = list.slice(); sync(); changed(); },
      values: function () { return values.slice(); },
      onChange: function (fn) { listeners.push(fn); }
    };
    return textarea._tagApi;
  }
  $$("textarea[data-tags]").forEach(initTagInput);
  window.portalTags = function (name) {
    var el = $('textarea[name="' + name + '"]');
    return el ? initTagInput(el) : null;
  };

  /* ------------------------------------------------------------------
   * Requisition form: role defaults, suggested skills/tools as chips, replacement toggle
   * ------------------------------------------------------------------ */
  var reqForm = $("#requisition-form");
  if (reqForm) {
    var field = function (name) { return $('[name="' + name + '"]', reqForm); };
    var roleSelect = $("[data-role-select]", reqForm);
    var titleInput = $("[data-role-title]", reqForm);
    var fieldFor = { skills: "required_skills", tools: "tools", certifications: "certifications", courses: "courses" };

    if (roleSelect) {
      roleSelect.addEventListener("change", function () {
        if (!roleSelect.value) return;
        var url = (reqForm.dataset.roleUrl || "/requisitions/api/role/0/").replace(/\/0\/$/, "/" + roleSelect.value + "/");
        fetch(url, { credentials: "same-origin" })
          .then(function (r) { return r.json(); })
          .then(function (role) {
            var set = function (el, value, onlyEmpty) {
              if (!el || value == null || value === "") return;
              if (onlyEmpty && el.value) return;
              el.value = value;
              flash(el);
            };
            set(titleInput, role.title, true);
            set(field("grade"), role.grade, true);
            set(field("min_experience_years"), role.min_experience_years || null, false);
            set(field("education_level"), role.education_level, false);
            set(field("job_description"), role.description, true);
            var added = 0;
            ["skills", "tools", "certifications", "courses"].forEach(function (key) {
              var api = window.portalTags(fieldFor[key]);
              (role[key] || []).forEach(function (v) { if (api && api.add(v)) added++; });
            });
            toast({ title: "Filled from the standard role", body: added ? added + " requirement" + (added === 1 ? "" : "s") + " added. Adjust anything you like." : "Check the details below.", tone: "success", timeout: 3500 });
          })
          .catch(function () {});
      });
    }

    var suggestBtn = $("#suggest-btn");
    var panel = $("#suggestions");
    var GROUPS = [["skills", "Skills", "lightbulb"], ["tools", "Tools & software", "wrench"], ["certifications", "Certifications", "badge-check"], ["courses", "Courses of study", "graduation-cap"]];

    function setPanel(html, tone) {
      panel.className = "ai-box" + (tone ? " is-" + tone : "");
      panel.innerHTML = html;
    }
    function refreshPicks() {
      $$(".pick[data-tag-pick]", panel).forEach(function (chip) {
        var api = window.portalTags(fieldFor[chip.dataset.kind]);
        chip.setAttribute("aria-pressed", String(!!(api && api.has(chip.dataset.value))));
      });
    }
    function renderSuggestions(data) {
      var html = '<div class="ai-head"><span class="eyebrow">' + icon("sparkles") + " Suggested for this role</span>" +
        '<span class="small muted">Tap to add or remove. Source: <b>' + escapeHtml(data.source) + "</b>" +
        (data.families && data.families.length ? " · " + escapeHtml(data.families.join(", ")) : "") + "</span></div>";
      var n = 0;
      GROUPS.forEach(function (g) {
        var items = data[g[0]] || [];
        if (!items.length) return;
        html += '<div class="ai-group"><div class="ai-group-h">' + icon(g[2]) + "<span>" + g[1] + '</span><button type="button" class="btn btn-ghost btn-sm" data-add-all="' + g[0] + '">' + icon("plus") + " Add all</button></div><div class=\"tags\">";
        items.forEach(function (t) {
          html += '<button type="button" class="pick pick-in" data-tag-pick data-kind="' + g[0] + '" data-value="' + escapeHtml(t) + '" style="--i:' + (n++) + '" aria-pressed="false">' +
            '<span class="pick-plus">' + icon("plus") + '</span><span class="pick-ok">' + icon("check") + "</span>" + escapeHtml(t) + "</button>";
        });
        html += "</div></div>";
      });
      var edu = field("education_level");
      var eduOption = edu && data.education_level ? edu.querySelector('option[value="' + data.education_level + '"]') : null;
      if (data.min_experience_years != null || eduOption) {
        html += '<p class="small muted ai-typical">' + icon("info") + " Typical for this role: " +
          (data.min_experience_years != null ? data.min_experience_years + "+ years" : "") +
          (eduOption ? (data.min_experience_years != null ? " · " : "") + escapeHtml(eduOption.textContent) : "") + "</p>";
      }
      var minExp = field("min_experience_years");
      var trainee = ["trainee", "intern"].indexOf((field("employment_type") || {}).value) !== -1;
      if (minExp && !trainee && data.min_experience_years && (!minExp.value || minExp.value === "0")) {
        minExp.value = data.min_experience_years;
        flash(minExp);
      }
      if (n) setPanel(html); else setPanel('<p class="small muted">' + icon("info") + " No suggestions for this title yet. Type the skills you need in the boxes below.</p>");
      refreshPicks();
    }

    if (suggestBtn && panel) {
      suggestBtn.addEventListener("click", function () {
        var title = titleInput ? titleInput.value.trim() : "";
        if (!title) {
          if (titleInput) { titleInput.focus(); flash(titleInput); }
          setPanel('<p class="small">' + icon("triangle-alert") + " Enter the position title first, then ask for suggestions.</p>", "warning");
          return;
        }
        var params = new URLSearchParams({
          title: title,
          department: (field("department") || {}).value || "",
          employment_type: (field("employment_type") || {}).value || "",
          context: (field("job_description") || {}).value || ""
        });
        suggestBtn.classList.add("is-loading");
        suggestBtn.disabled = true;
        setPanel('<div class="ai-loading"><span class="skeleton line" style="width:40%"></span><div class="tags"><span class="skeleton pill"></span><span class="skeleton pill"></span><span class="skeleton pill"></span><span class="skeleton pill"></span><span class="skeleton pill"></span></div><span class="small muted">Finding skills, tools and certifications for “' + escapeHtml(title) + "”…</span></div>");
        fetch((reqForm.dataset.suggestUrl || "/requisitions/api/suggest/") + "?" + params, { credentials: "same-origin" })
          .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
          .then(renderSuggestions)
          .catch(function () { setPanel('<p class="small">' + icon("circle-alert") + " Could not load suggestions just now. Type the requirements below, or try again.</p>", "danger"); })
          .then(function () { suggestBtn.classList.remove("is-loading"); suggestBtn.disabled = false; });
      });
      panel.addEventListener("click", function (e) {
        var chip = e.target.closest(".pick[data-tag-pick]");
        if (chip) {
          var api = window.portalTags(fieldFor[chip.dataset.kind]);
          if (api) { if (api.has(chip.dataset.value)) api.remove(chip.dataset.value); else api.add(chip.dataset.value); }
          refreshPicks();
          return;
        }
        var all = e.target.closest("[data-add-all]");
        if (all) {
          var api2 = window.portalTags(fieldFor[all.dataset.addAll]);
          $$('.pick[data-kind="' + all.dataset.addAll + '"]', panel).forEach(function (c) { if (api2) api2.add(c.dataset.value); });
          refreshPicks();
        }
      });
      Object.keys(fieldFor).forEach(function (k) { var api = window.portalTags(fieldFor[k]); if (api) api.onChange(refreshPicks); });
    }

    /* "Employee being replaced" only matters for replacement reasons */
    var reason = field("reason");
    var replacing = $("#field-replacing_employee");
    var toggleReplacing = function () {
      if (!reason || !replacing) return;
      replacing.hidden = ["new", "temporary"].indexOf(reason.value) !== -1;
    };
    if (reason) reason.addEventListener("change", toggleReplacing);
    toggleReplacing();
  }

  /* ------------------------------------------------------------------
   * Form stepper: highlights the section in view; links scroll to it
   * ------------------------------------------------------------------ */
  $$("[data-steps]").forEach(function (nav) {
    var links = $$("a[href^='#']", nav);
    var sections = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); }).filter(Boolean);
    if (!sections.length || !("IntersectionObserver" in window)) return;
    var mark = function (id) {
      var reached = true;
      links.forEach(function (a) {
        var step = a.closest(".step") || a;
        var here = a.getAttribute("href") === "#" + id;
        step.classList.toggle("current", here);
        step.classList.toggle("done", reached && !here);
        if (here) { reached = false; a.setAttribute("aria-current", "step"); } else a.removeAttribute("aria-current");
      });
    };
    var io = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (en) { return en.isIntersecting; }).sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
      if (visible.length) mark(visible[0].target.id);
    }, { rootMargin: "-20% 0px -55% 0px" });
    sections.forEach(function (s) { io.observe(s); });
    mark(sections[0].id);
  });

  /* ------------------------------------------------------------------
   * Interview form: meeting link only for video calls, location only in person
   * ------------------------------------------------------------------ */
  var modeSelect = $("#id_mode");
  if (modeSelect) {
    var toggleMode = function () {
      var link = $("#field-meeting_link"), loc = $("#field-location");
      if (link) link.hidden = modeSelect.value !== "video";
      if (loc) loc.hidden = modeSelect.value !== "in_person";
    };
    modeSelect.addEventListener("change", toggleMode);
    toggleMode();
  }

  /* ------------------------------------------------------------------
   * Selection report: live band per criterion, total and overall rating
   * ------------------------------------------------------------------ */
  var evalForm = $("#evaluation-form");
  if (evalForm) {
    var BANDS = [[30, "P", "Poor", "danger"], [50, "S", "Satisfactory", "warning"], [70, "G", "Good", ""], [90, "VG", "Very good", "brand"], [101, "E", "Excellent", "success"]];
    var rate = function (marks, max) {
      var pct = max ? (marks / max) * 100 : 0;
      for (var i = 0; i < BANDS.length; i++) if (pct <= BANDS[i][0]) return BANDS[i];
      return BANDS[BANDS.length - 1];
    };
    var MID = { P: 0.2, S: 0.45, G: 0.6, VG: 0.8, E: 0.95 };
    var setChip = function (chip, band, quiet) {
      if (!chip) return;
      chip.hidden = !band && !!quiet;
      if (!band) { chip.className = (quiet ? "sc-chip " : "") + "chip neutral"; chip.textContent = "Not scored"; return; }
      chip.className = (quiet ? "sc-chip " : "") + "chip " + (band[3] || "");
      chip.textContent = band[2] + " (" + band[1] + ")";
    };
    var updateEval = function () {
      var total = 0, max = 0, scored = 0;
      $$(".marks-input", evalForm).forEach(function (input) {
        var m = parseFloat(input.value);
        var mx = parseFloat(input.dataset.max);
        max += mx;
        var row = input.closest("[data-criterion]");
        if (!row) return;
        var band = isNaN(m) ? null : rate(Math.min(m, mx), mx);
        $$(".band", row).forEach(function (b) {
          var on = !!band && b.dataset.code === band[1];
          b.classList.toggle("is-on", on);
          b.setAttribute("aria-pressed", String(on));
        });
        setChip($(".sc-chip", row), band, true);
        if (!isNaN(m)) { total += Math.min(m, mx); scored++; }
      });
      var t = $("#eval-total");
      if (t) t.textContent = total.toFixed(1).replace(/\.0$/, "");
      var bar = $("#eval-bar");
      if (bar) bar.style.width = (max ? Math.min(100, (total / max) * 100) : 0) + "%";
      var progress = $("#eval-progress");
      if (progress) progress.textContent = scored + " of " + $$(".marks-input", evalForm).length + " scored";
      var all = $$(".marks-input", evalForm).length;
      var overall = $("#eval-rating");
      if (scored === all && all) setChip(overall, rate(total, max || 100));
      else { setChip(overall, null); if (overall && scored) overall.textContent = "In progress"; }
    };
    $$(".marks-input", evalForm).forEach(function (i) { i.addEventListener("input", updateEval); });
    evalForm.addEventListener("click", function (e) {
      var b = e.target.closest(".band[data-code]");
      if (!b) return;
      var row = b.closest("[data-criterion]");
      var input = $(".marks-input", row);
      var mx = parseFloat(input.dataset.max);
      input.value = String(Math.round(mx * MID[b.dataset.code] * 2) / 2);
      flash(input);
      updateEval();
    });
    updateEval();
  }

  /* ------------------------------------------------------------------
   * Bulk selection: select-all box, live count, Apply enabled only with a selection
   * ------------------------------------------------------------------ */
  $$("[data-select-all]").forEach(function (box) {
    var name = box.dataset.selectAll;
    var form = box.form || document;
    var boxes = function () { return $$('input[name="' + name + '"]', form); };
    var count = $("[data-selected-count]", form);
    var apply = $("[data-needs-selection]", form);
    var bar = $("[data-bulk-bar]", form);
    var refresh = function () {
      var n = boxes().filter(function (c) { return c.checked; }).length;
      box.checked = n > 0 && n === boxes().length;
      box.indeterminate = n > 0 && n < boxes().length;
      if (count) count.textContent = n ? n + " selected" : "None selected";
      if (apply) apply.disabled = !n;
      if (bar) bar.classList.toggle("is-active", n > 0);
      boxes().forEach(function (c) { var tr = c.closest("tr"); if (tr) tr.classList.toggle("is-selected", c.checked); });
    };
    box.addEventListener("change", function () { boxes().forEach(function (c) { c.checked = box.checked; }); refresh(); });
    boxes().forEach(function (c) { c.addEventListener("change", refresh); });
    refresh();
  });

  /* Slow forms (reading CVs, imports) show a spinner on the button that was pressed */
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.hasAttribute("data-loading") || e.defaultPrevented) return;
    var btn = e.submitter || $('button[type="submit"]', form);
    if (btn) setTimeout(function () { btn.classList.add("is-loading"); btn.setAttribute("aria-busy", "true"); }, 0);
  });

  /* Type-to-filter for long pick lists (interview panel) */
  $$("[data-filter-list]").forEach(function (input) {
    var list = document.getElementById(input.dataset.filterList);
    if (!list) return;
    input.addEventListener("input", function () {
      var words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      $$("[data-text]", list).forEach(function (item) {
        var text = item.dataset.text.toLowerCase();
        var checked = $("input:checked", item);
        item.hidden = !checked && words.length > 0 && !words.every(function (w) { return text.indexOf(w) !== -1; });
      });
    });
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") e.preventDefault(); });
  });

  /* Show / hide password */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-pw-toggle]");
    if (!t) return;
    var field = document.getElementById(t.dataset.pwToggle);
    if (!field) return;
    var show = field.type === "password";
    field.type = show ? "text" : "password";
    t.setAttribute("aria-pressed", String(show));
    t.setAttribute("aria-label", show ? "Hide password" : "Show password");
    field.focus();
  });

  /* Print buttons */
  document.addEventListener("click", function (e) { if (e.target.closest("[data-print]")) window.print(); });

  /* Filters that apply as soon as they change */
  document.addEventListener("change", function (e) {
    var el = e.target.closest("[data-autosubmit]");
    if (el && el.form) el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
  });

  /* Live preview for long text (job advert) */
  $$("[data-preview]").forEach(function (area) {
    var out = document.getElementById(area.dataset.preview);
    if (!out) return;
    var empty = out.dataset.empty || "";
    var draw = function () { out.textContent = area.value.trim() || empty; out.classList.toggle("is-empty", !area.value.trim()); };
    area.addEventListener("input", draw);
    draw();
  });

  /* ?tab=messages opens that tab (older links and redirects) */
  var tab = new URLSearchParams(location.search).get("tab");
  if (tab && !location.hash) {
    var reveal = function () { $$(".tabs[data-hash]").forEach(function (l) { if (l._reveal) l._reveal(tab); }); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reveal); else setTimeout(reveal, 0);
  }

  /* ------------------------------------------------------------------
   * Careers application: read the CV and fill the form (never overwrites what was typed)
   * ------------------------------------------------------------------ */
  var applyForm = $("#apply-form");
  if (applyForm) {
    var cvInput = $('[name="cv"]', applyForm);
    var status = $("#cv-status");
    var show = function (tone, ico, title, body) {
      if (!status) return;
      status.className = "banner " + tone;
      status.innerHTML = '<span class="tile">' + icon(ico) + "</span><div><b></b><span class=\"small\"></span></div>";
      $("b", status).textContent = title;
      $(".small", status).textContent = body || "";
    };
    if (cvInput) cvInput.addEventListener("change", function () {
      if (!cvInput.files.length) return;
      var data = new FormData();
      data.append("cv", cvInput.files[0]);
      show("", "loader-circle", "Reading your CV…", "This takes a few seconds.");
      var spin = status && $(".tile svg", status);
      if (spin) spin.classList.add("spin");
      fetch(applyForm.dataset.parseUrl, { method: "POST", headers: { "X-CSRFToken": csrfToken() }, body: data, credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res.error) throw new Error(res.error);
          var filled = 0;
          Object.keys(res.fields || {}).forEach(function (name) {
            var value = res.fields[name];
            if (value === null || value === "" || (Array.isArray(value) && !value.length)) return;
            var el = applyForm.querySelector('[name="' + name + '"]');
            if (!el) return;
            if (el.dataset.tags !== undefined) {
              var api = window.portalTags(name);
              (Array.isArray(value) ? value : [value]).forEach(function (v) { api.add(v); });
              filled++;
              return;
            }
            if (el.value && el.value !== "0") return;
            el.value = value;
            flash(el);
            filled++;
          });
          if (filled) show("success", "circle-check", "We filled " + filled + " field" + (filled === 1 ? "" : "s") + " from your CV", "Please check them before you submit.");
          else show("warning", "triangle-alert", "We could not read details from this file", "Please fill the form below. Your CV is still attached.");
        })
        .catch(function (err) {
          show("warning", "triangle-alert", "We could not read your CV", (err && err.message) || "Please fill the form below. Your CV is still attached.");
        });
    });
  }
})();
