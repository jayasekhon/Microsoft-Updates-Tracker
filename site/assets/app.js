// Copilot Radar — client app. Loads data/site.json (built by `python -m tracker update`).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const PRODUCT_COLOR = { m365: "var(--p-m365)", chat: "var(--p-chat)", studio: "var(--p-studio)", sharepoint: "var(--p-sharepoint)" };
const PRODUCT_HEX = { m365: "#8b6cff", chat: "#2dc2b1", studio: "#ff8a4c", sharepoint: "#3aa0f0" };
const STATUS = {
  dev: { label: "In development", cls: "s-dev" },
  roll: { label: "Rolling out", cls: "s-roll" },
  live: { label: "Launched", cls: "s-live" },
  post: { label: "Blog posts", cls: "s-post" },
  can: { label: "Cancelled / removed", cls: "s-can" },
};
const STATUS_KEY = { "In development": "dev", "Rolling out": "roll", "Launched": "live", "Cancelled": "can" };
const ACTION_LABEL = { admin: "Admin action", prepare: "Prepare users" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PAGE = 48;
const DAY = 86400000;

const state = { q: "", product: "", status: "", app: "", audience: "", range: "", sort: "activity", action: false, view: "feed" };
let DATA = { items: [], products: [] };
let filtered = [];
let shown = 0;
let today = new Date();

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseDay = (iso) => (iso ? new Date(iso + "T00:00:00Z") : null);
const fmtDate = (iso, opts = { month: "short", day: "numeric", year: "numeric" }) => (iso ? parseDay(iso).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" }) : "");
const daysAgo = (iso) => (iso ? Math.floor((today - parseDay(iso)) / DAY) : Infinity);
function relDate(iso) {
  const d = daysAgo(iso);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return fmtDate(iso, d > 300 ? undefined : { month: "short", day: "numeric" });
}
const cleanMonth = (s) => (s || "").replace(" CY", " ");
function monthKey(label) {
  const m = /^(\w+)\s+CY(\d{4})$/.exec(label || "");
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1]);
  return idx < 0 ? null : Number(m[2]) * 12 + idx;
}
function weekStart(iso) {
  const d = parseDay(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d - dow * DAY).toISOString().slice(0, 10);
}
const productName = (id) => DATA.products.find((p) => p.id === id)?.name ?? id;
const statusKey = (it) => (it.x ? "can" : it.k === "post" ? "post" : STATUS_KEY[it.s] || "dev");
function lastEvent(it) {
  const evs = it.ev.filter((e) => e.type !== "details");
  return evs[evs.length - 1] || it.ev[it.ev.length - 1];
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
function withTransition(fn) {
  if (document.startViewTransition && !reduceMotion) document.startViewTransition(fn);
  else fn();
}
function highlight(text, q) {
  const safe = esc(text);
  const terms = q.split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return terms.length ? safe.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>") : safe;
}

// ------------------------------------------------------------------ pills / cards
function pills(it, { product = true } = {}) {
  const out = [];
  if (product) out.push(`<span class="pill prod" style="--c:${PRODUCT_COLOR[it.p]}">${esc(productName(it.p))}</span>`);
  const sk = statusKey(it);
  if (it.x) out.push(`<span class="pill s-gone">Removed</span>`);
  else if (it.k === "post") out.push(`<span class="pill s-post">Blog post</span>`);
  else out.push(`<span class="pill ${STATUS[sk].cls}">${sk === "roll" ? '<span class="pulse"></span>' : ""}${esc(it.s)}</span>`);
  if (daysAgo(it.fs) <= 7 && daysAgo(it.c) <= 10) out.push(`<span class="pill new">New</span>`);
  if (it.ai && ACTION_LABEL[it.ai.action]) out.push(`<span class="pill act">${ACTION_LABEL[it.ai.action]}</span>`);
  if (it.ai?.impact === "high") out.push(`<span class="pill imp">High impact</span>`);
  return out.join("");
}

function moveText(it) {
  const e = lastEvent(it);
  if (!e) return "";
  if (e.type === "status") return `${esc(e.from || "—")} → ${esc(e.to)}`;
  if (e.type === "ga_date") return `GA moved ${esc(cleanMonth(e.from) || "—")} → ${esc(cleanMonth(e.to))}`;
  if (e.type === "preview") return `Preview moved ${esc(cleanMonth(e.from) || "—")} → ${esc(cleanMonth(e.to))}`;
  if (e.type === "removed") return "Removed from the Roadmap";
  if (e.type === "returned") return "Back on the Roadmap";
  return "";
}

const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

function card(it, i = 0) {
  const move = moveText(it);
  const summary = it.ai?.summary || it.d;
  const when = it.k === "feature" && it.ga ? `GA ${cleanMonth(it.ga)}` : it.k === "post" ? it.src : "";
  return `<article class="card reveal${it.x ? " is-removed" : ""}" style="--c:${PRODUCT_COLOR[it.p]};--d:${Math.min(i, 8) * 45}ms" data-id="${esc(it.id)}" role="button" tabindex="0" aria-label="${esc(it.t)}">
    <div class="card-top">${pills(it)}</div>
    <h4>${highlight(it.t, state.q)}</h4>
    ${move ? `<div class="move">${ARROW}${move}</div>` : ""}
    <p class="sum">${esc(summary)}</p>
    <div class="card-foot">
      <span>${esc(relDate(it.la))}</span>
      ${when ? `<span>${esc(when)}</span>` : ""}
      ${it.ap.length ? `<span class="apps">${it.ap.slice(0, 3).map((a) => `<span class="tag">${esc(a)}</span>`).join("")}</span>` : ""}
    </div>
  </article>`;
}

// ------------------------------------------------------------------ filtering
function matches(it, { ignore = "" } = {}) {
  if (state.product && ignore !== "product" && it.p !== state.product) return false;
  if (state.status && ignore !== "status" && statusKey(it) !== state.status) return false;
  if (!state.status && it.x && ignore !== "status") return false; // hide removed unless asked
  if (state.app && !it.ap.includes(state.app)) return false;
  if (state.audience && !(it.ai?.audience || []).includes(state.audience)) return false;
  if (state.range && daysAgo(it.la) > Number(state.range)) return false;
  if (state.action && !ACTION_LABEL[it.ai?.action]) return false;
  if (state.q) {
    const hay = it._hay || (it._hay = [it.t, it.ai?.summary, it.d, it.ap.join(" "), it.rid, productName(it.p), it.src].join(" ").toLowerCase());
    if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
  }
  return true;
}

const IMPACT = { high: 0, medium: 1, low: 2 };
function sortItems(list) {
  const byActivity = (a, b) => (b.la || "").localeCompare(a.la || "") || a.t.localeCompare(b.t);
  if (state.sort === "impact") return list.sort((a, b) => (IMPACT[a.ai?.impact] ?? 1) - (IMPACT[b.ai?.impact] ?? 1) || byActivity(a, b));
  if (state.sort === "ga") return list.sort((a, b) => (monthKey(a.ga) ?? 1e9) - (monthKey(b.ga) ?? 1e9) || byActivity(a, b));
  return list.sort(byActivity);
}

function apply({ keepScroll = false } = {}) {
  filtered = sortItems(DATA.items.filter((it) => matches(it)));
  writeHash();
  updateChips();
  const active = state.q || state.product || state.status || state.app || state.audience || state.range || state.action;
  $("#clearFilters").hidden = !active;
  $("#resultCount").textContent = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "update" : "updates"}${active ? " match" : ""}`;
  withTransition(() => render());
  if (!keepScroll && window.scrollY > $("#results").offsetTop) $("#results").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
}

// ------------------------------------------------------------------ views
function render() {
  const view = $("#view");
  $$(".views button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
  if (!filtered.length) {
    view.innerHTML = `<div class="empty"><div class="big">🛰️</div><p>Nothing on the radar for these filters.</p><button class="btn" type="button" data-clear>Clear filters</button></div>`;
    return;
  }
  if (state.view === "board") renderBoard(view);
  else if (state.view === "timeline") renderTimeline(view);
  else { shown = 0; view.innerHTML = ""; renderFeedPage(); }
  observeReveals();
}

function renderFeedPage() {
  const view = $("#view");
  const slice = filtered.slice(shown, shown + PAGE);
  if (!slice.length) return;
  if (state.sort !== "activity") {
    let grid = $(".grid.flat", view);
    if (!grid) { view.insertAdjacentHTML("beforeend", `<div class="grid flat"></div>`); grid = $(".grid.flat", view); }
    grid.insertAdjacentHTML("beforeend", slice.map(card).join(""));
  } else {
    const groups = new Map();
    for (const it of slice) {
      const wk = it.la ? weekStart(it.la) : "unknown";
      if (!groups.has(wk)) groups.set(wk, []);
      groups.get(wk).push(it);
    }
    for (const [wk, items] of groups) {
      let sec = view.querySelector(`.week[data-week="${wk}"]`);
      if (!sec) {
        const thisWeek = weekStart(today.toISOString().slice(0, 10));
        const label = wk === thisWeek ? "This week" : wk === "unknown" ? "Undated" : `Week of ${fmtDate(wk)}`;
        const total = filtered.filter((i) => (i.la ? weekStart(i.la) : "unknown") === wk).length;
        view.insertAdjacentHTML("beforeend", `<section class="week" data-week="${wk}"><div class="week-head"><h3>${label}</h3><span class="line"></span><span class="n">${total} ${total === 1 ? "update" : "updates"}</span></div><div class="grid"></div></section>`);
        sec = view.lastElementChild;
      }
      $(".grid", sec).insertAdjacentHTML("beforeend", items.map(card).join(""));
    }
  }
  shown += slice.length;
  observeReveals();
}

const boardLimits = { dev: 30, roll: 30, live: 30 };
function renderBoard(view) {
  const cols = [["dev", "In development"], ["roll", "Rolling out"], ["live", "Launched"]];
  const features = filtered.filter((i) => i.k === "feature" && !i.x);
  view.innerHTML = `<div class="board">${cols.map(([key, label]) => {
    const list = features.filter((i) => statusKey(i) === key);
    const lim = boardLimits[key];
    return `<section class="col" aria-label="${label}">
      <div class="col-head"><span>${label}</span><span class="count pill ${STATUS[key].cls}">${list.length}</span></div>
      <div class="stack">${list.slice(0, lim).map(card).join("") || `<p class="empty" style="padding:24px 8px">None</p>`}</div>
      ${list.length > lim ? `<button class="col-more" data-more="${key}" type="button">Show ${Math.min(30, list.length - lim)} more</button>` : ""}
    </section>`;
  }).join("")}</div>`;
}

function renderTimeline(view) {
  const nowKey = today.getUTCFullYear() * 12 + today.getUTCMonth();
  const groups = new Map();
  for (const it of filtered) {
    if (it.k !== "feature" || it.x) continue;
    const key = monthKey(it.ga) ?? Infinity;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  // Start a few months back so the view focuses on what's current and upcoming.
  const visible = keys.filter((k) => k === Infinity || k >= nowKey - 3);
  const older = keys.filter((k) => k !== Infinity && k < nowKey - 3).reduce((n, k) => n + groups.get(k).length, 0);
  view.innerHTML = `<div class="tl">
    ${older ? `<p class="empty" style="padding:0 0 18px;text-align:left">${older} earlier releases hidden — switch to Feed or sort by release date to see them.</p>` : ""}
    ${visible.map((k) => {
      const list = groups.get(k).sort((a, b) => statusKey(a).localeCompare(statusKey(b)) || a.t.localeCompare(b.t));
      const label = k === Infinity ? "No target date" : `${MONTHS[k % 12]} ${Math.floor(k / 12)}`;
      const cls = k === Infinity ? "" : k < nowKey ? "past" : k === nowKey ? "now" : "";
      const mix = DATA.products.map((p) => [p.id, list.filter((i) => i.p === p.id).length]).filter(([, n]) => n);
      return `<section class="tl-month ${cls} reveal">
        <h3>${label}${k === nowKey ? ' <small>this month</small>' : ""} <small>${list.length} features</small></h3>
        <div class="tl-mix" aria-hidden="true">${mix.map(([p, n]) => `<span style="--c:${PRODUCT_COLOR[p]};flex-grow:${n}"></span>`).join("")}</div>
        <div class="tl-items">${list.map((it) => `<button class="tl-chip" type="button" data-id="${esc(it.id)}" style="--c:${PRODUCT_COLOR[it.p]}" title="${esc(productName(it.p))} · ${esc(it.s)}"><span class="dot"></span><span class="ttl">${highlight(it.t, state.q)}</span><span class="st pill ${STATUS[statusKey(it)].cls}">${esc(it.s)}</span></button>`).join("")}</div>
      </section>`;
    }).join("")}
  </div>`;
}

// ------------------------------------------------------------------ reveal animation
let revealObserver;
function observeReveals() {
  if (reduceMotion || !("IntersectionObserver" in window)) { $$(".reveal").forEach((el) => el.classList.add("in")); return; }
  revealObserver ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); }
  }, { rootMargin: "0px 0px -40px 0px" });
  $$(".reveal:not(.in)").forEach((el) => revealObserver.observe(el));
}

// ------------------------------------------------------------------ hero
function animateCount(el, to) {
  if (reduceMotion) { el.textContent = to.toLocaleString(); return; }
  const start = performance.now(), dur = 1200;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderHero() {
  const live = DATA.items.filter((i) => !i.x);
  const counts = [
    live.filter((i) => daysAgo(i.la) <= 7).length,
    live.filter((i) => i.s === "Rolling out").length,
    live.filter((i) => daysAgo(i.la) <= 30 && ACTION_LABEL[i.ai?.action]).length,
    live.length,
  ];
  $$("#stats .stat-num").forEach((el, i) => animateCount(el, counts[i]));

  const max = Math.max(...DATA.products.map((p) => live.filter((i) => i.p === p.id).length));
  $("#productBars").innerHTML = DATA.products.map((p) => {
    const list = live.filter((i) => i.p === p.id);
    const recent = list.filter((i) => daysAgo(i.la) <= 30).length;
    return `<button class="pbar" type="button" data-product="${p.id}" aria-pressed="false" style="--c:${PRODUCT_HEX[p.id]}">
      <div class="pbar-top"><span>${esc(p.name)}</span><b>${list.length}</b></div>
      <div class="pbar-meta">${recent} changed in 30 days · ${list.filter((i) => i.s === "Rolling out").length} rolling out</div>
      <div class="pbar-track"><div class="pbar-fill" data-w="${(list.length / max) * 100}"></div></div>
    </button>`;
  }).join("");
  requestAnimationFrame(() => setTimeout(() => $$(".pbar-fill").forEach((el) => (el.style.width = el.dataset.w + "%")), 150));

  // Radar blips: the 16 most recent changes. Angle = product quadrant, distance = age.
  const recent = [...live].sort((a, b) => (b.la || "").localeCompare(a.la || "")).slice(0, 16);
  const quad = Object.fromEntries(DATA.products.map((p, i) => [p.id, i]));
  $("#blips").innerHTML = recent.map((it, i) => {
    const q = quad[it.p] ?? 0;
    const angle = ((q * 90 + 15 + ((i * 37) % 60)) - 90) * Math.PI / 180;
    const r = 40 + Math.min(140, daysAgo(it.la) * 9) + ((i * 13) % 20);
    const x = 200 + r * Math.cos(angle), y = 200 + r * Math.sin(angle);
    return `<g class="blip" data-id="${esc(it.id)}" style="animation-delay:${(((angle * 180 / Math.PI) + 90 + 360) % 360) / 360 * 5}s"><title>${esc(it.t)}</title><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="${PRODUCT_HEX[it.p]}" opacity=".25"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${PRODUCT_HEX[it.p]}"/></g>`;
  }).join("");

  // Spotlight: latest status moves and arrivals in the past fortnight.
  const spots = live
    .map((it) => ({ it, e: lastEvent(it) }))
    .filter(({ it, e }) => e && daysAgo(e.date) <= 14 && (e.type === "status" || e.type === "new"))
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || (a.e.type === "status" ? -1 : 1))
    .slice(0, 14);
  if (spots.length) {
    $("#spotlightSection").hidden = false;
    $("#spotlight").innerHTML = spots.map(({ it, e }) => {
      const label = e.type === "status" ? `→ Now ${esc(e.to)}` : it.k === "post" ? "📰 New post" : "✦ Newly announced";
      return `<article class="spot reveal" role="button" tabindex="0" data-id="${esc(it.id)}" style="--c:${PRODUCT_COLOR[it.p]}" aria-label="${esc(it.t)}">
        <div class="spot-move">${label}</div><h3>${esc(it.t)}</h3><p>${esc(productName(it.p))} · ${relDate(e.date)}</p></article>`;
    }).join("");
  }
}

function renderMeta() {
  const at = DATA.updated_at ? new Date(DATA.updated_at) : null;
  $("#updatedAt").textContent = at ? `Updated ${at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Live tracker";
  const warn = (DATA.warnings || []).filter((w) => w.startsWith("error") || w.startsWith("warning"));
  $("#warnings").textContent = warn.length ? `Source status: ${warn.join(" · ")}` : "";
}

// ------------------------------------------------------------------ filters UI
function buildFilters() {
  $("#statusChips").innerHTML = [["", "All"], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])]
    .map(([k, label]) => `<button class="chip" type="button" data-status="${k}" aria-pressed="false">${label} <span class="n"></span></button>`).join("");
  const apps = new Map();
  DATA.items.forEach((i) => i.ap.forEach((a) => apps.set(a, (apps.get(a) || 0) + 1)));
  $("#appFilter").insertAdjacentHTML("beforeend", [...apps].sort((a, b) => b[1] - a[1]).map(([a, n]) => `<option value="${esc(a)}">${esc(a)} (${n})</option>`).join(""));
  const auds = new Set();
  DATA.items.forEach((i) => (i.ai?.audience || []).forEach((a) => auds.add(a)));
  $("#audienceFilter").insertAdjacentHTML("beforeend", [...auds].sort().map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join(""));
}

function updateChips() {
  const base = DATA.items.filter((it) => matches(it, { ignore: "status" }));
  $$("#statusChips .chip").forEach((c) => {
    const k = c.dataset.status;
    c.setAttribute("aria-pressed", String(state.status === k));
    $(".n", c).textContent = (k ? base.filter((i) => statusKey(i) === k) : base.filter((i) => !i.x)).length;
  });
  $$(".pbar").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.product === state.product)));
  $("#search").value !== state.q && ($("#search").value = state.q);
  $("#appFilter").value = state.app;
  $("#audienceFilter").value = state.audience;
  $("#rangeFilter").value = state.range;
  $("#sortBy").value = state.sort;
  $("#actionOnly").checked = state.action;
}

// ------------------------------------------------------------------ URL state
const HASH_KEYS = { q: "q", product: "p", status: "s", app: "app", audience: "aud", range: "r", sort: "sort", view: "view" };
function writeHash() {
  const params = new URLSearchParams();
  for (const [k, short] of Object.entries(HASH_KEYS)) {
    const v = state[k];
    if (v && !(k === "sort" && v === "activity") && !(k === "view" && v === "feed")) params.set(short, v);
  }
  if (state.action) params.set("act", "1");
  const openId = $("#drawer").classList.contains("open") ? $("#drawer").dataset.id : "";
  if (openId) params.set("item", openId);
  const hash = params.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
}
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  for (const [k, short] of Object.entries(HASH_KEYS)) if (params.has(short)) state[k] = params.get(short);
  state.action = params.get("act") === "1";
  return params.get("item");
}

// ------------------------------------------------------------------ drawer
const EVENT_TEXT = {
  new: (e, it) => (it.k === "post" ? "Published" : "Added to the Microsoft 365 Roadmap"),
  status: (e) => `Status changed: <b>${esc(e.from || "—")}</b> → <b>${esc(e.to)}</b>`,
  ga_date: (e) => `GA target moved: ${esc(cleanMonth(e.from) || "unset")} → <b>${esc(cleanMonth(e.to))}</b>`,
  preview: (e) => `Preview target moved: ${esc(cleanMonth(e.from) || "unset")} → <b>${esc(cleanMonth(e.to))}</b>`,
  details: () => "Microsoft updated the description",
  removed: () => "Removed from the Roadmap",
  returned: () => "Returned to the Roadmap",
};
let lastFocus = null;

function openDrawer(id) {
  const it = DATA.items.find((i) => i.id === id);
  if (!it) return;
  lastFocus = document.activeElement;
  const ai = it.ai || {};
  const details = [
    it.rid && ["Roadmap ID", it.rid],
    it.k === "feature" && ["Status", it.s],
    it.pv && ["Preview", cleanMonth(it.pv)],
    it.ga && ["General availability", cleanMonth(it.ga)],
    it.ap.length && ["Apps", it.ap.join(", ")],
    ai.audience?.length && ["Who's affected", ai.audience.join(", ")],
    it.ph.length && ["Release phase", it.ph.join(", ")],
    it.pf.length && ["Platforms", it.pf.join(", ")],
    it.cl.length && ["Clouds", it.cl.join(", ")],
    ["Source", it.src],
  ].filter(Boolean);
  $("#drawerBody").innerHTML = `
    <div class="d-hero" style="--c:${PRODUCT_COLOR[it.p]}">
      <div class="card-top">${pills(it)}</div>
      <h2 id="drawerTitle">${esc(it.t)}</h2>
    </div>
    ${ai.summary && ai.model !== "rules" ? `<p class="d-sum">${esc(ai.summary)}</p>` : ""}
    ${ai.action_note ? `<div class="d-action"><span aria-hidden="true">⚠️</span><div><b>${ACTION_LABEL[ai.action] || "Action"}</b>${esc(ai.action_note)}</div></div>` : ""}
    <div class="d-buttons">
      <a class="btn primary" href="${esc(it.u)}" target="_blank" rel="noopener">Read on Microsoft <svg viewBox="0 0 24 24"><path d="M7 17 17 7M8 7h9v9"/></svg></a>
      ${it.mu && it.mu !== it.u ? `<a class="btn" href="${esc(it.mu)}" target="_blank" rel="noopener">More info</a>` : ""}
      <button class="btn" type="button" data-copy="${esc(it.id)}"><svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 7a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>Copy link</button>
    </div>
    <div class="d-section"><h3>From Microsoft</h3><div class="d-desc">${esc(it.d || "No description provided.")}</div></div>
    <div class="d-section"><h3>Details</h3><dl class="d-grid">${details.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>
    <div class="d-section"><h3>History</h3><ol class="hist">${[...it.ev].reverse().map((e) => `<li><time>${fmtDate(e.date)}</time>${(EVENT_TEXT[e.type] || (() => esc(e.type)))(e, it)}</li>`).join("")}</ol></div>
    ${ai.model && ai.model !== "rules" ? `<p style="font-size:12px;color:var(--ink-3)">Summary generated with AI from Microsoft's text. Check the source before acting.</p>` : ""}`;
  const drawer = $("#drawer");
  drawer.dataset.id = id;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  $(".drawer-panel").scrollTop = 0;
  setTimeout(() => $(".drawer-panel").focus(), 50);
  writeHash();
}
function closeDrawer() {
  const drawer = $("#drawer");
  if (!drawer.classList.contains("open")) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  delete drawer.dataset.id;
  document.body.style.overflow = "";
  writeHash();
  lastFocus?.focus?.();
}

// ------------------------------------------------------------------ events
function bind() {
  let t;
  $("#search").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); apply({ keepScroll: true }); }, 160); });
  $("#appFilter").addEventListener("change", (e) => { state.app = e.target.value; apply(); });
  $("#audienceFilter").addEventListener("change", (e) => { state.audience = e.target.value; apply(); });
  $("#rangeFilter").addEventListener("change", (e) => { state.range = e.target.value; apply(); });
  $("#sortBy").addEventListener("change", (e) => { state.sort = e.target.value; apply(); });
  $("#actionOnly").addEventListener("change", (e) => { state.action = e.target.checked; apply(); });

  document.addEventListener("click", (e) => {
    const t = e.target;
    const idEl = t.closest("[data-id]");
    if (idEl && !t.closest(".drawer")) { openDrawer(idEl.dataset.id); return; }
    if (t.closest("[data-close]")) { closeDrawer(); return; }
    const copy = t.closest("[data-copy]");
    if (copy) {
      const url = `${location.origin}${location.pathname}#item=${copy.dataset.copy}`;
      navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast(url));
      return;
    }
    const chip = t.closest("[data-status]");
    if (chip) { state.status = chip.dataset.status; apply({ keepScroll: true }); return; }
    const pbar = t.closest("[data-product]");
    if (pbar) { state.product = state.product === pbar.dataset.product ? "" : pbar.dataset.product; apply(); return; }
    const tab = t.closest("[data-view]");
    if (tab) { state.view = tab.dataset.view; apply({ keepScroll: true }); return; }
    const more = t.closest("[data-more]");
    if (more) { boardLimits[more.dataset.more] += 30; render(); return; }
    const quick = t.closest("[data-quick]");
    if (quick) {
      Object.assign(state, { q: "", product: "", status: "", app: "", audience: "", range: "", action: false, sort: "activity", view: "feed" });
      if (quick.dataset.quick === "week") state.range = "7";
      if (quick.dataset.quick === "rolling") state.status = "roll";
      if (quick.dataset.quick === "action") { state.action = true; state.range = "30"; }
      apply();
      return;
    }
    if (t.closest("#clearFilters, [data-clear]")) {
      Object.assign(state, { q: "", product: "", status: "", app: "", audience: "", range: "", action: false });
      apply({ keepScroll: true });
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[role="button"][data-id]')) { e.preventDefault(); openDrawer(e.target.dataset.id); return; }
    if (e.key === "/" && !/input|select|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); $("#search").focus(); }
    if (e.key === "Tab" && $("#drawer").classList.contains("open")) {
      const f = $$("#drawer a, #drawer button").filter((x) => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // Cursor spotlight on cards.
  document.addEventListener("pointermove", (e) => {
    const c = e.target.closest?.(".card");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", `${e.clientX - r.left}px`);
    c.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });

  // Infinite scroll for the feed.
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && state.view === "feed" && shown < filtered.length) renderFeedPage();
  }, { rootMargin: "600px" }).observe($("#sentinel"));

  // Sticky controls shadow.
  new IntersectionObserver(([e]) => $("#controls").classList.toggle("stuck", e.intersectionRatio < 1), { threshold: [1] }).observe($("#controls"));

  $("#themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("radar-theme", root.dataset.theme); } catch (err) { /* private mode */ }
  });

  window.addEventListener("hashchange", () => {
    const id = new URLSearchParams(location.hash.slice(1)).get("item");
    if (id && id !== $("#drawer").dataset.id) openDrawer(id);
  });
}

// ------------------------------------------------------------------ boot
async function boot() {
  $("#view").innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(6)}</div>`;
  try {
    const res = await fetch("data/site.json", { cache: "no-cache" });
    DATA = await res.json();
  } catch (err) {
    $("#view").innerHTML = `<div class="empty"><div class="big">⚠️</div><p>Couldn't load the update data. Try refreshing.</p></div>`;
    return;
  }
  const openId = readHash();
  renderMeta();
  buildFilters();
  renderHero();
  bind();
  apply({ keepScroll: true });
  if (openId) openDrawer(openId);
}

boot();
