// The full searchable, filterable list (feed / board / release timeline).
// Mounted at the bottom of the homepage and of every topic page.

import {
  $, $$, DATA, MONTHS, PRODUCT_COLOR, STATUS, card, daysAgo, esc, fmtDate, hashParams, highlight,
  monthKey, needsAction, nowMonthKey, observeReveals, productName, reduceMotion, statusKey, today,
  updateHash, weekStart,
} from "./core.js";

const PAGE = 48;
const IMPACT = { high: 0, medium: 1, low: 2 };
const DEFAULTS = { q: "", product: "", status: "", app: "", audience: "", range: "", sort: "activity", action: false, view: "feed" };
const HASH_KEYS = { q: "q", product: "p", status: "s", app: "app", audience: "aud", range: "r", sort: "sort", view: "view" };

export function mountBrowser(root, { product: fixedProduct = "" } = {}) {
  const state = { ...DEFAULTS, product: fixedProduct };
  const pool = DATA.items.filter((i) => !fixedProduct || i.p === fixedProduct);
  let filtered = [];
  let shown = 0;
  const boardLimits = { dev: 30, roll: 30, live: 30 };

  root.innerHTML = `
    <div class="controls" id="controls">
      <div class="controls-row">
        <label class="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"/></svg>
          <input id="search" type="search" placeholder="Search${fixedProduct ? ` ${esc(productName(fixedProduct))}` : ""} updates, e.g. Teams, agents, Purview…" autocomplete="off" aria-label="Search updates">
          <kbd>/</kbd>
        </label>
        <div class="views" role="tablist" aria-label="View">
          <button role="tab" data-view="feed" aria-selected="true">Feed</button>
          <button role="tab" data-view="board" aria-selected="false">Board</button>
          <button role="tab" data-view="timeline" aria-selected="false">Release timeline</button>
        </div>
      </div>
      <div class="controls-row filters">
        <div class="chips" data-role="status" role="group" aria-label="Status">
          ${[["", "All"], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])].map(([k, label]) => `<button class="chip" type="button" data-status="${k}" aria-pressed="false">${label} <span class="n"></span></button>`).join("")}
        </div>
        <div class="selects">
          ${fixedProduct ? "" : `<select data-f="product" aria-label="Product"><option value="">All products</option>${DATA.products.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>`}
          <select data-f="app" aria-label="App"><option value="">All apps</option>${options(pool.flatMap((i) => i.ap))}</select>
          <select data-f="audience" aria-label="Audience"><option value="">Everyone</option>${options(pool.flatMap((i) => i.ai?.audience || []), false)}</select>
          <select data-f="range" aria-label="Time range">
            <option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
          </select>
          <select data-f="sort" aria-label="Sort"><option value="activity">Latest activity</option><option value="impact">Highest impact</option><option value="ga">Release date</option></select>
          <label class="toggle"><input type="checkbox" data-f="action"><span></span>Needs action</label>
        </div>
      </div>
      <div class="result-line"><span data-role="count" aria-live="polite"></span><button data-role="clear" type="button" hidden>Clear filters</button></div>
    </div>
    <div class="view" data-role="view"></div>
    <div data-role="sentinel" aria-hidden="true"></div>`;

  const view = $('[data-role="view"]', root);

  // ---------------------------------------------------------------- state <-> hash
  function readHash() {
    const params = hashParams();
    for (const [k, short] of Object.entries(HASH_KEYS)) {
      if (k === "product" && fixedProduct) continue;
      if (params.has(short)) state[k] = params.get(short);
    }
    state.action = params.get("act") === "1";
  }
  function writeHash() {
    updateHash((params) => {
      for (const [k, short] of Object.entries(HASH_KEYS)) {
        const v = state[k];
        const isDefault = !v || v === DEFAULTS[k] || (k === "product" && fixedProduct);
        isDefault ? params.delete(short) : params.set(short, v);
      }
      state.action ? params.set("act", "1") : params.delete("act");
    });
  }

  // ---------------------------------------------------------------- filtering
  function matches(it, { ignore = "" } = {}) {
    if (state.product && ignore !== "product" && it.p !== state.product) return false;
    if (state.status && ignore !== "status" && statusKey(it) !== state.status) return false;
    if (!state.status && it.x && ignore !== "status") return false;
    if (state.app && !it.ap.includes(state.app)) return false;
    if (state.audience && !(it.ai?.audience || []).includes(state.audience)) return false;
    if (state.range && daysAgo(it.la) > Number(state.range)) return false;
    if (state.action && !needsAction(it)) return false;
    if (state.q) {
      const hay = it._hay || (it._hay = [it.t, it.ai?.summary, it.d, it.ap.join(" "), it.rid, productName(it.p), it.src].join(" ").toLowerCase());
      if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
    }
    return true;
  }
  function sortItems(list) {
    const byActivity = (a, b) => (b.la || "").localeCompare(a.la || "") || a.t.localeCompare(b.t);
    if (state.sort === "impact") return list.sort((a, b) => (IMPACT[a.ai?.impact] ?? 1) - (IMPACT[b.ai?.impact] ?? 1) || byActivity(a, b));
    if (state.sort === "ga") return list.sort((a, b) => (monthKey(a.ga) ?? 1e9) - (monthKey(b.ga) ?? 1e9) || byActivity(a, b));
    return list.sort(byActivity);
  }

  function apply({ scroll = false } = {}) {
    filtered = sortItems(pool.filter((it) => matches(it)));
    writeHash();
    syncControls();
    const active = state.q || (!fixedProduct && state.product) || state.status || state.app || state.audience || state.range || state.action;
    $('[data-role="clear"]', root).hidden = !active;
    $('[data-role="count"]', root).textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "update" : "updates"}${active ? " match" : ""}`;
    const run = () => render();
    if (document.startViewTransition && !reduceMotion) document.startViewTransition(run);
    else run();
    if (scroll) root.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  function syncControls() {
    const base = pool.filter((it) => matches(it, { ignore: "status" }));
    $$(".chip[data-status]", root).forEach((c) => {
      const k = c.dataset.status;
      c.setAttribute("aria-pressed", String(state.status === k));
      $(".n", c).textContent = (k ? base.filter((i) => statusKey(i) === k) : base.filter((i) => !i.x)).length;
    });
    const search = $("#search", root);
    if (search.value !== state.q) search.value = state.q;
    $$("select[data-f]", root).forEach((s) => (s.value = state[s.dataset.f]));
    $('input[data-f="action"]', root).checked = state.action;
    $$(".views button", root).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
  }

  // ---------------------------------------------------------------- views
  const q = () => state.q;
  const showProduct = !fixedProduct;

  function render() {
    if (!filtered.length) {
      view.innerHTML = `<div class="empty"><div class="big">🛰️</div><p>Nothing on the radar for these filters.</p><button class="btn" type="button" data-role="clear">Clear filters</button></div>`;
      return;
    }
    if (state.view === "board") renderBoard();
    else if (state.view === "timeline") renderTimeline();
    else { shown = 0; view.innerHTML = ""; renderFeedPage(); }
    observeReveals();
  }

  function renderFeedPage() {
    const slice = filtered.slice(shown, shown + PAGE);
    if (!slice.length) return;
    const opts = { q: q(), product: showProduct };
    if (state.sort !== "activity") {
      let grid = $(".grid.flat", view);
      if (!grid) { view.insertAdjacentHTML("beforeend", `<div class="grid flat"></div>`); grid = $(".grid.flat", view); }
      grid.insertAdjacentHTML("beforeend", slice.map((it, i) => card(it, i, opts)).join(""));
    } else {
      const thisWeek = weekStart(today.toISOString().slice(0, 10));
      const groups = new Map();
      for (const it of slice) {
        const wk = it.la ? weekStart(it.la) : "unknown";
        if (!groups.has(wk)) groups.set(wk, []);
        groups.get(wk).push(it);
      }
      for (const [wk, items] of groups) {
        let sec = view.querySelector(`.week[data-week="${wk}"]`);
        if (!sec) {
          const label = wk === thisWeek ? "This week" : wk === "unknown" ? "Undated" : `Week of ${fmtDate(wk)}`;
          const total = filtered.filter((i) => (i.la ? weekStart(i.la) : "unknown") === wk).length;
          view.insertAdjacentHTML("beforeend", `<section class="week" data-week="${wk}"><div class="week-head"><h3>${label}</h3><span class="line"></span><span class="n">${total} ${total === 1 ? "update" : "updates"}</span></div><div class="grid"></div></section>`);
          sec = view.lastElementChild;
        }
        $(".grid", sec).insertAdjacentHTML("beforeend", items.map((it, i) => card(it, i, opts)).join(""));
      }
    }
    shown += slice.length;
    observeReveals();
  }

  function renderBoard() {
    const cols = [["dev", "In development"], ["roll", "Rolling out"], ["live", "Launched"]];
    const features = filtered.filter((i) => i.k === "feature" && !i.x);
    view.innerHTML = `<div class="board">${cols.map(([key, label]) => {
      const list = features.filter((i) => statusKey(i) === key);
      const lim = boardLimits[key];
      return `<section class="col" aria-label="${label}">
        <div class="col-head"><span>${label}</span><span class="count pill ${STATUS[key].cls}">${list.length}</span></div>
        <div class="stack">${list.slice(0, lim).map((it, i) => card(it, i, { q: q(), product: showProduct })).join("") || `<p class="empty" style="padding:24px 8px">None</p>`}</div>
        ${list.length > lim ? `<button class="col-more" data-more="${key}" type="button">Show ${Math.min(30, list.length - lim)} more</button>` : ""}
      </section>`;
    }).join("")}</div>`;
  }

  function renderTimeline() {
    const nowKey = nowMonthKey();
    const groups = new Map();
    for (const it of filtered) {
      if (it.k !== "feature" || it.x) continue;
      const key = monthKey(it.ga) ?? Infinity;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => a - b);
    const visible = keys.filter((k) => k === Infinity || k >= nowKey - 3);
    const older = keys.filter((k) => k !== Infinity && k < nowKey - 3).reduce((n, k) => n + groups.get(k).length, 0);
    view.innerHTML = `<div class="tl">
      ${older ? `<p class="empty" style="padding:0 0 18px;text-align:left">${older} earlier releases hidden. Switch to Feed or sort by release date to see them.</p>` : ""}
      ${visible.map((k) => {
        const list = groups.get(k).sort((a, b) => statusKey(a).localeCompare(statusKey(b)) || a.t.localeCompare(b.t));
        const label = k === Infinity ? "No target date" : `${MONTHS[k % 12]} ${Math.floor(k / 12)}`;
        const cls = k === Infinity ? "" : k < nowKey ? "past" : k === nowKey ? "now" : "";
        const mix = DATA.products.map((p) => [p.id, list.filter((i) => i.p === p.id).length]).filter(([, n]) => n);
        return `<section class="tl-month ${cls} reveal">
          <h3>${label}${k === nowKey ? " <small>this month</small>" : ""} <small>${list.length} features</small></h3>
          <div class="tl-mix" aria-hidden="true">${mix.map(([p, n]) => `<span style="--c:${PRODUCT_COLOR[p]};flex-grow:${n}"></span>`).join("")}</div>
          <div class="tl-items">${list.map((it) => `<button class="tl-chip" type="button" data-id="${esc(it.id)}" style="--c:${PRODUCT_COLOR[it.p]}" title="${esc(productName(it.p))} · ${esc(it.s)}"><span class="dot"></span><span class="ttl">${highlight(it.t, q())}</span><span class="st pill ${STATUS[statusKey(it)].cls}">${esc(it.s)}</span></button>`).join("")}</div>
        </section>`;
      }).join("")}
    </div>`;
  }

  // ---------------------------------------------------------------- events
  let typing;
  $("#search", root).addEventListener("input", (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => { state.q = e.target.value.trim(); apply(); }, 160);
  });
  $$("select[data-f]", root).forEach((s) => s.addEventListener("change", () => { state[s.dataset.f] = s.value; apply(); }));
  $('input[data-f="action"]', root).addEventListener("change", (e) => { state.action = e.target.checked; apply(); });
  root.addEventListener("click", (e) => {
    const t = e.target;
    const chip = t.closest("[data-status]");
    if (chip) { state.status = chip.dataset.status; apply(); return; }
    const tab = t.closest("[data-view]");
    if (tab) { state.view = tab.dataset.view; apply(); return; }
    const more = t.closest("[data-more]");
    if (more) { boardLimits[more.dataset.more] += 30; render(); return; }
    if (t.closest('[data-role="clear"]')) {
      Object.assign(state, { q: "", status: "", app: "", audience: "", range: "", action: false, product: fixedProduct });
      apply();
    }
  });

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.view === "feed" && shown < filtered.length) renderFeedPage();
  }, { rootMargin: "600px" }).observe($('[data-role="sentinel"]', root));
  new IntersectionObserver(([e]) => $("#controls", root).classList.toggle("stuck", e.intersectionRatio < 1), { threshold: [1] }).observe($("#controls", root));

  readHash();
  apply();

  return {
    /** Reset filters, apply the given ones and scroll the list into view. */
    show(changes = {}) {
      Object.assign(state, { ...DEFAULTS, product: fixedProduct }, changes);
      apply({ scroll: true });
    },
  };
}

function options(values, withCounts = true) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  const entries = [...counts].sort((a, b) => (withCounts ? b[1] - a[1] : a[0].localeCompare(b[0])));
  return entries.map(([v, n]) => `<option value="${esc(v)}">${esc(v)}${withCounts ? ` (${n})` : ""}</option>`).join("");
}
