/* Live screens. Parts of a page marked data-live="topic ..." (with an id) refresh themselves after someone else's
   change is saved: the page asks /intake/live/ for the change counters every data-live-ms, and when a topic it shows
   moved, fetches itself again (same address, so the same filters, through the same permission checks) and swaps in
   the fresh copy of each region. A region with unsaved edits, the cursor in a field, or an open dialog is not
   swapped: it says it has changed and offers to refresh. */
(function () {
  "use strict";
  var body = document.body;
  var url = body.getAttribute("data-live-url");
  var every = Math.max(300, parseInt(body.getAttribute("data-live-ms") || "700", 10));
  var regions = function () { return Array.prototype.slice.call(document.querySelectorAll("[data-live][id]")); };
  if (!url || !regions().length) return;

  var topics = {};
  regions().forEach(function (r) { r.getAttribute("data-live").split(/\s+/).forEach(function (t) { if (t) topics[t] = 1; }); });
  var names = Object.keys(topics);
  var seq = null;
  try { seq = JSON.parse(body.getAttribute("data-live-seq") || "null"); } catch (e) { seq = null; }
  var held = {}, inflight = false, again = null, stopped = false, timer = null, failures = 0;
  window.__live = { updates: [], polls: 0 };  // read by the latency benchmark (tools/live_benchmark.py)

  function topicsOf(region) { return region.getAttribute("data-live").split(/\s+/); }
  function overlaps(region, changed) { return topicsOf(region).some(function (t) { return changed.indexOf(t) >= 0; }); }

  function dirty(region) {
    var active = document.activeElement;
    if (active && region.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return true;
    if (region.querySelector("dialog[open], .popover:not([hidden]), [data-live-hold]")) return true;
    var fields = region.querySelectorAll("input, textarea, select");
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.type === "hidden" || f.disabled) continue;
      if (f.type === "checkbox" || f.type === "radio") { if (f.checked !== f.defaultChecked) return true; }
      else if (f.tagName === "SELECT") {
        if (f.multiple) {
          for (var j = 0; j < f.options.length; j++) if (f.options[j].selected !== f.options[j].defaultSelected) return true;
        } else {
          // With no option marked selected in the page, the browser shows the first one: that is not an edit.
          var start = 0;
          for (var k = 0; k < f.options.length; k++) if (f.options[k].defaultSelected) { start = k; }
          if (f.options.length && f.selectedIndex !== start) return true;
        }
      } else if (f.type === "file") { if (f.files && f.files.length) return true; }
      else if (f.value !== f.defaultValue) return true;
    }
    return false;
  }

  function notice(region) {
    if (region.querySelector(":scope > .live-notice")) return;
    var bar = document.createElement("div");
    bar.className = "live-notice";
    bar.setAttribute("role", "status");
    bar.innerHTML = '<span>This has changed since you opened it. Your unsaved changes are kept.</span>' +
      '<button type="button" class="btn btn-ghost btn-sm">Show the latest</button>';
    bar.querySelector("button").addEventListener("click", function () {
      delete held[region.id];
      region.setAttribute("data-live-force", "1");
      refresh(topicsOf(region));
    });
    region.insertBefore(bar, region.firstChild);
  }

  function swap(doc, changed) {
    var swapped = 0;
    regions().forEach(function (region) {
      var force = region.getAttribute("data-live-force") === "1";
      if (!force && !overlaps(region, changed) && !held[region.id]) return;
      var fresh = doc.getElementById(region.id);
      if (!fresh) return;
      if (!force && dirty(region)) { held[region.id] = 1; notice(region); return; }
      region.removeAttribute("data-live-force");
      delete held[region.id];
      // Keep what the reader had open: the selected tabs and the expanded sections.
      var tabs = Array.prototype.slice.call(region.querySelectorAll('[role="tab"][aria-selected="true"]'))
        .map(function (t) { return t.getAttribute("aria-controls"); });
      var open = Array.prototype.slice.call(region.querySelectorAll("details"))
        .map(function (d) { return d.open; });
      region.innerHTML = fresh.innerHTML;
      if (window.DS && window.DS.initRegion) window.DS.initRegion(region);
      tabs.forEach(function (id) {
        var tab = id && region.querySelector('[role="tab"][aria-controls="' + id + '"]');
        if (tab && tab.getAttribute("aria-selected") !== "true") tab.click();
      });
      var details = region.querySelectorAll("details");
      if (details.length === open.length) for (var k = 0; k < details.length; k++) details[k].open = open[k];
      region.dispatchEvent(new CustomEvent("live:updated", { bubbles: true }));
      swapped++;
    });
    if (swapped) window.__live.updates.push({ at: Date.now(), regions: swapped });
  }

  function refresh(changed) {
    if (inflight) { again = (again || []).concat(changed); return; }
    inflight = true;
    fetch(location.href, { credentials: "same-origin", cache: "no-store", headers: { "X-Live": "1" } })
      .then(function (r) {
        if (!r.ok || r.redirected) throw new Error("page " + r.status);
        return r.text();
      })
      .then(function (html) { swap(new DOMParser().parseFromString(html, "text/html"), changed); })
      .catch(function () { /* try again with the next change */ })
      .then(function () {
        inflight = false;
        if (again) { var next = again; again = null; refresh(next); }
      });
  }

  function poll() {
    timer = null;
    if (stopped) return;
    window.__live.polls++;
    fetch(url + "?t=" + encodeURIComponent(names.join(",")), { credentials: "same-origin", cache: "no-store",
                                                                 headers: { "Accept": "application/json" } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403 || r.redirected) { stopped = true; throw new Error("signed out"); }
        return r.json();
      })
      .then(function (data) {
        failures = 0;
        var now = data.seq || {}, changed = [];
        if (seq) Object.keys(now).forEach(function (t) { if (now[t] !== seq[t]) changed.push(t); });
        seq = now;
        var pending = Object.keys(held).length;
        if (changed.length || pending) refresh(changed);
      })
      .catch(function () { failures++; })
      .then(schedule);
  }

  function schedule() {
    if (stopped || timer) return;
    var wait = document.hidden ? Math.max(every, 5000) : every * Math.min(8, Math.pow(2, failures));
    timer = setTimeout(poll, wait);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && timer) { clearTimeout(timer); timer = null; poll(); }
  });
  schedule();
})();
