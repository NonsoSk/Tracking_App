/* Recruitment portal front-end helpers. No build step, no framework. */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getCookie(name) {
    const match = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[2]) : "";
  }
  function csrfToken() {
    const input = $("input[name=csrfmiddlewaretoken]");
    return (input && input.value) || getCookie("csrftoken");
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }
  const TERMS_URL = document.body.dataset.termsUrl || "/requisitions/api/terms/";

  /* ------------------------------------------------------------------
   * Tag inputs: <textarea data-tags="skill|tool|certification|course">
   * ------------------------------------------------------------------ */
  function initTagInput(textarea) {
    if (textarea._tagApi) return textarea._tagApi;
    const kind = textarea.dataset.tags || "";
    const wrapper = document.createElement("div");
    wrapper.className = "tag-input";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = textarea.getAttribute("placeholder") || "Type and press Enter";
    const listId = "dl-" + Math.random().toString(36).slice(2);
    input.setAttribute("list", listId);
    const datalist = document.createElement("datalist");
    datalist.id = listId;
    wrapper.appendChild(input);
    wrapper.appendChild(datalist);
    textarea.style.display = "none";
    textarea.parentNode.insertBefore(wrapper, textarea.nextSibling);

    let values = textarea.value.split(/\n|,/).map((v) => v.trim()).filter(Boolean);

    function sync() {
      textarea.value = values.join("\n");
      $$(".chip", wrapper).forEach((c) => c.remove());
      values.forEach((value, idx) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.innerHTML = escapeHtml(value) + ' <button type="button" aria-label="Remove">&times;</button>';
        chip.querySelector("button").addEventListener("click", () => {
          values.splice(idx, 1);
          sync();
          textarea.dispatchEvent(new Event("change"));
        });
        wrapper.insertBefore(chip, input);
      });
    }
    function has(value) {
      return values.some((v) => v.toLowerCase() === value.toLowerCase());
    }
    function add(value) {
      value = (value || "").trim().replace(/\s+/g, " ");
      if (!value || has(value)) return false;
      values.push(value);
      sync();
      textarea.dispatchEvent(new Event("change"));
      return true;
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        add(input.value);
        input.value = "";
      } else if (e.key === "Backspace" && !input.value && values.length) {
        values.pop();
        sync();
      }
    });
    input.addEventListener("change", () => {
      // Selecting from the datalist fires change; commit it.
      if (input.value && $$("option", datalist).some((o) => o.value === input.value)) {
        add(input.value);
        input.value = "";
      }
    });
    input.addEventListener("blur", () => {
      if (input.value.trim()) {
        add(input.value);
        input.value = "";
      }
    });
    let timer;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) return;
      timer = setTimeout(() => {
        fetch(`${TERMS_URL}?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`)
          .then((r) => r.json())
          .then((data) => {
            datalist.innerHTML = (data.results || []).map((t) => `<option value="${escapeHtml(t)}">`).join("");
          })
          .catch(() => {});
      }, 180);
    });
    wrapper.addEventListener("click", () => input.focus());
    sync();
    textarea._tagApi = { add, has, set: (list) => { values = [...list]; sync(); }, values: () => [...values] };
    return textarea._tagApi;
  }
  $$("textarea[data-tags]").forEach(initTagInput);
  window.portalTags = (name) => {
    const el = document.querySelector(`[name="${name}"]`);
    return el ? initTagInput(el) : null;
  };

  /* ------------------------------------------------------------------
   * Requisition form: role defaults + AI / knowledge-base suggestions
   * ------------------------------------------------------------------ */
  const reqForm = $("#requisition-form");
  if (reqForm) {
    const roleSelect = $("[data-role-select]", reqForm);
    const titleInput = $("[data-role-title]", reqForm);
    const fieldFor = { skills: "required_skills", tools: "tools", certifications: "certifications", courses: "courses" };

    if (roleSelect) {
      roleSelect.addEventListener("change", () => {
        if (!roleSelect.value) return;
        fetch(`/requisitions/api/role/${roleSelect.value}/`)
          .then((r) => r.json())
          .then((role) => {
            if (titleInput && !titleInput.value) titleInput.value = role.title;
            const grade = $("[name=grade]", reqForm);
            if (grade && !grade.value) grade.value = role.grade || "";
            const minExp = $("[name=min_experience_years]", reqForm);
            if (minExp && role.min_experience_years) minExp.value = role.min_experience_years;
            const edu = $("[name=education_level]", reqForm);
            if (edu && role.education_level) edu.value = role.education_level;
            const desc = $("[name=job_description]", reqForm);
            if (desc && !desc.value && role.description) desc.value = role.description;
            (role.skills || []).forEach((v) => window.portalTags("required_skills").add(v));
            (role.tools || []).forEach((v) => window.portalTags("tools").add(v));
            (role.certifications || []).forEach((v) => window.portalTags("certifications").add(v));
            (role.courses || []).forEach((v) => window.portalTags("courses").add(v));
          });
      });
    }

    const suggestBtn = $("#suggest-btn");
    const panel = $("#suggestions");
    if (suggestBtn && panel) {
      suggestBtn.addEventListener("click", () => {
        const title = titleInput ? titleInput.value.trim() : "";
        if (!title) {
          titleInput && titleInput.focus();
          panel.innerHTML = '<div class="alert alert-warning py-2 mb-0">Enter the position title first.</div>';
          return;
        }
        const params = new URLSearchParams({
          title,
          department: ($("[name=department]", reqForm) || {}).value || "",
          employment_type: ($("[name=employment_type]", reqForm) || {}).value || "",
          context: ($("[name=job_description]", reqForm) || {}).value || "",
        });
        suggestBtn.disabled = true;
        panel.innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Finding skills, tools and certifications for this role…</div>';
        fetch(`/requisitions/api/suggest/?${params}`)
          .then((r) => r.json())
          .then((data) => renderSuggestions(data))
          .catch(() => (panel.innerHTML = '<div class="alert alert-danger py-2 mb-0">Could not load suggestions.</div>'))
          .finally(() => (suggestBtn.disabled = false));
      });
    }

    function renderSuggestions(data) {
      const groups = [
        ["skills", "Skills", "bi-lightbulb"],
        ["tools", "Tools & software", "bi-tools"],
        ["certifications", "Certifications", "bi-patch-check"],
        ["courses", "Courses of study", "bi-mortarboard"],
      ];
      let html = `<div class="d-flex justify-content-between align-items-center mb-2"><div class="small text-muted">
        Click a suggestion to add it. Source: <strong>${escapeHtml(data.source)}</strong>${
          data.families && data.families.length ? " · " + escapeHtml(data.families.join(", ")) : ""
        }</div></div>`;
      let any = false;
      groups.forEach(([key, label, icon]) => {
        const items = data[key] || [];
        if (!items.length) return;
        any = true;
        const api = window.portalTags(fieldFor[key]);
        html += `<div class="mb-2"><div class="small-label mb-1"><i class="bi ${icon}"></i> ${label}
          <a href="#" class="ms-2 text-decoration-none" data-add-all="${key}">add all</a></div>`;
        html += items.map((t) => `<span class="chip suggest ${api && api.has(t) ? "added" : ""}" data-kind="${key}" data-value="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join("");
        html += "</div>";
      });
      const minExp = $("[name=min_experience_years]", reqForm);
      const edu = $("[name=education_level]", reqForm);
      const eduOption = edu && data.education_level ? edu.querySelector(`option[value="${data.education_level}"]`) : null;
      if (data.min_experience_years != null || eduOption) {
        html += `<div class="small text-muted mt-1">Typical for this role: ${data.min_experience_years != null ? data.min_experience_years + "+ years" : ""}${eduOption ? " · " + escapeHtml(eduOption.textContent) : ""}</div>`;
      }
      const trainee = ["trainee", "intern"].includes(($("[name=employment_type]", reqForm) || {}).value);
      if (minExp && !trainee && data.min_experience_years && (!minExp.value || minExp.value === "0")) {
        minExp.value = data.min_experience_years;
        minExp.classList.add("autofill-flash");
      }
      panel.innerHTML = any ? html : '<div class="text-muted small">No suggestions for this title yet — type the skills you need.</div>';
      $$(".chip.suggest", panel).forEach((chip) => {
        chip.addEventListener("click", () => {
          const api = window.portalTags(fieldFor[chip.dataset.kind]);
          if (api && api.add(chip.dataset.value)) chip.classList.add("added");
        });
      });
      $$("[data-add-all]", panel).forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          $$(`.chip.suggest[data-kind="${link.dataset.addAll}"]`, panel).forEach((chip) => chip.click());
        });
      });
    }

    // Show "employee being replaced" only for replacement reasons.
    const reason = $("[name=reason]", reqForm);
    const replacing = $("#field-replacing_employee");
    function toggleReplacing() {
      if (!reason || !replacing) return;
      replacing.style.display = ["new", "temporary"].includes(reason.value) ? "none" : "";
    }
    reason && reason.addEventListener("change", toggleReplacing);
    toggleReplacing();
  }

  /* ------------------------------------------------------------------
   * Interview form: meeting link only for video calls
   * ------------------------------------------------------------------ */
  const modeSelect = $("#id_mode");
  if (modeSelect) {
    const toggle = () => {
      const link = $("#field-meeting_link");
      const loc = $("#field-location");
      if (link) link.style.display = modeSelect.value === "video" ? "" : "none";
      if (loc) loc.style.display = modeSelect.value === "in_person" ? "" : "none";
    };
    modeSelect.addEventListener("change", toggle);
    toggle();
  }

  /* ------------------------------------------------------------------
   * Selection report: live ratings and total
   * ------------------------------------------------------------------ */
  const evalForm = $("#evaluation-form");
  if (evalForm) {
    const bands = [[30, "P", "Poor"], [50, "S", "Satisfactory"], [70, "G", "Good"], [90, "VG", "Very Good"], [101, "E", "Excellent"]];
    const rate = (marks, max) => {
      const pct = (marks / max) * 100;
      return bands.find((b) => pct <= b[0]) || bands[bands.length - 1];
    };
    const update = () => {
      let total = 0;
      let max = 0;
      $$(".marks-input", evalForm).forEach((input) => {
        const m = parseFloat(input.value);
        const mx = parseFloat(input.dataset.max);
        max += mx;
        const row = input.closest("tr");
        const badge = row && $(".rating-badge", row);
        $$(".rating-cell", row).forEach((c) => c.classList.remove("on"));
        if (!isNaN(m)) {
          total += m;
          const [, code, label] = rate(m, mx);
          if (badge) {
            badge.textContent = code;
            badge.className = `badge rating-badge rating-${code}`;
            badge.title = label;
          }
          const cell = $(`.rating-cell[data-code="${code}"]`, row);
          cell && cell.classList.add("on");
        } else if (badge) {
          badge.textContent = "–";
          badge.className = "badge rating-badge bg-light text-muted";
        }
      });
      const t = $("#eval-total");
      if (t) t.textContent = total.toFixed(1).replace(/\.0$/, "");
      const r = $("#eval-rating");
      if (r) {
        const [, code, label] = rate(total, max || 100);
        r.textContent = `${label} (${code})`;
        r.className = `badge rating-${code}`;
      }
    };
    $$(".marks-input", evalForm).forEach((i) => i.addEventListener("input", update));
    $$(".rating-cell", evalForm).forEach((cell) => {
      // Clicking a rating column fills the middle of that band.
      cell.addEventListener("click", () => {
        const row = cell.closest("tr");
        const input = $(".marks-input", row);
        const mx = parseFloat(input.dataset.max);
        const mid = { P: 0.2, S: 0.45, G: 0.6, VG: 0.8, E: 0.95 }[cell.dataset.code];
        input.value = (Math.round(mx * mid * 2) / 2).toString();
        update();
      });
    });
    update();
  }

  /* ------------------------------------------------------------------
   * Kanban board drag & drop
   * ------------------------------------------------------------------ */
  if (window.Sortable) {
    $$(".board-list[data-stage]").forEach((list) => {
      if (list.dataset.readonly === "1") return;
      new Sortable(list, {
        group: "pipeline",
        animation: 150,
        onAdd(evt) {
          const card = evt.item;
          const body = new URLSearchParams({ stage: list.dataset.stage });
          fetch(card.dataset.moveUrl, {
            method: "POST",
            headers: { "X-CSRFToken": csrfToken(), "X-Requested-With": "XMLHttpRequest" },
            body,
          })
            .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
            .then(({ ok, data }) => {
              if (!ok) throw new Error(data.error || "Move not allowed");
              $$(".board-col").forEach((col) => {
                const count = $(".count", col);
                if (count) count.textContent = $$(".board-card", col).length;
              });
            })
            .catch((err) => {
              evt.from.insertBefore(card, evt.from.children[evt.oldIndex] || null);
              alert(err.message);
            });
        },
      });
    });
  }

  /* ------------------------------------------------------------------
   * Bulk selection
   * ------------------------------------------------------------------ */
  $$("[data-select-all]").forEach((box) => {
    box.addEventListener("change", () => {
      $$(`input[name="${box.dataset.selectAll}"]`).forEach((c) => (c.checked = box.checked));
    });
  });

  /* Confirmation prompts */
  document.addEventListener("submit", (e) => {
    const msg = e.target.dataset.confirm || (e.submitter && e.submitter.dataset.confirm);
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  /* Mobile sidebar */
  const toggler = $("#sidebar-toggle");
  toggler && toggler.addEventListener("click", () => $(".app-sidebar").classList.toggle("show"));

  /* Remember active tab from ?tab= */
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab");
  if (tab) {
    const trigger = $(`[data-bs-target="#tab-${tab}"]`);
    if (trigger && window.bootstrap) bootstrap.Tab.getOrCreateInstance(trigger).show();
  }

  /* ------------------------------------------------------------------
   * Public application form: read the CV and fill the form
   * ------------------------------------------------------------------ */
  const applyForm = $("#apply-form");
  if (applyForm) {
    const cvInput = $("[name=cv]", applyForm);
    const status = $("#cv-status");
    cvInput &&
      cvInput.addEventListener("change", () => {
        if (!cvInput.files.length) return;
        const data = new FormData();
        data.append("cv", cvInput.files[0]);
        status.className = "alert alert-info py-2";
        status.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Reading your CV…';
        fetch(applyForm.dataset.parseUrl, { method: "POST", headers: { "X-CSRFToken": csrfToken() }, body: data })
          .then((r) => r.json())
          .then((res) => {
            if (res.error) throw new Error(res.error);
            let filled = 0;
            Object.entries(res.fields || {}).forEach(([name, value]) => {
              if (value === null || value === "" || (Array.isArray(value) && !value.length)) return;
              const el = applyForm.querySelector(`[name="${name}"]`);
              if (!el) return;
              if (el.dataset.tags !== undefined) {
                const api = window.portalTags(name);
                value.forEach((v) => api.add(v));
                filled++;
                return;
              }
              if (el.value && el.value !== "0") return; // never overwrite what the candidate typed
              el.value = value;
              el.classList.add("autofill-flash");
              filled++;
            });
            status.className = filled ? "alert alert-success py-2" : "alert alert-warning py-2";
            status.innerHTML = filled
              ? `<i class="bi bi-magic me-1"></i> We filled <strong>${filled}</strong> field(s) from your CV. Please check them before submitting.`
              : "We could not read details from this file. Please fill the form below.";
          })
          .catch((err) => {
            status.className = "alert alert-warning py-2";
            status.textContent = err.message || "Could not read the CV. Please fill the form manually.";
          });
      });
  }
})();
