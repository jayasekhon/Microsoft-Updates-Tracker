// Shared helpers, data loading, item rendering and the details drawer.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export const PRODUCT_COLOR = { m365: "var(--p-m365)", chat: "var(--p-chat)", studio: "var(--p-studio)", sharepoint: "var(--p-sharepoint)" };
export const PRODUCT_HEX = { m365: "#8b6cff", chat: "#2dc2b1", studio: "#ff8a4c", sharepoint: "#3aa0f0" };
export const STATUS = {
  dev: { label: "In development", cls: "s-dev" },
  roll: { label: "Rolling out", cls: "s-roll" },
  live: { label: "Launched", cls: "s-live" },
  post: { label: "Blog posts", cls: "s-post" },
  can: { label: "Cancelled / removed", cls: "s-can" },
};
const STATUS_KEY = { "In development": "dev", "Rolling out": "roll", "Launched": "live", "Cancelled": "can" };
export const ACTION_LABEL = { admin: "Admin action", prepare: "Prepare users" };
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86400000;
export const today = new Date();

export let DATA = { items: [], products: [] };

export async function loadData(prefix = "") {
  const res = await fetch(`${prefix}data/site.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  DATA = await res.json();
  // config/sources.json lists products in classification-priority order; show them in reading order.
  const order = ["m365", "chat", "studio", "sharepoint"];
  DATA.products.sort((a, b) => (order.indexOf(a.id) + 99) % 99 - (order.indexOf(b.id) + 99) % 99);
  return DATA;
}

// ------------------------------------------------------------------ formatting
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const parseDay = (iso) => (iso ? new Date(iso + "T00:00:00Z") : null);
export const fmtDate = (iso, opts = { month: "short", day: "numeric", year: "numeric" }) => (iso ? parseDay(iso).toLocaleDateString(undefined, { ...opts, timeZone: "UTC" }) : "");
export const daysAgo = (iso) => (iso ? Math.floor((today - parseDay(iso)) / DAY) : Infinity);
export function relDate(iso) {
  const d = daysAgo(iso);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return fmtDate(iso, d > 300 ? undefined : { month: "short", day: "numeric" });
}
export const cleanMonth = (s) => (s || "").replace(" CY", " ");
export function monthKey(label) {
  const m = /^(\w+)\s+CY(\d{4})$/.exec(label || "");
  if (!m) return null;
  const idx = MONTHS.indexOf(m[1]);
  return idx < 0 ? null : Number(m[2]) * 12 + idx;
}
export const nowMonthKey = () => today.getUTCFullYear() * 12 + today.getUTCMonth();
export function weekStart(iso) {
  const d = parseDay(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d - dow * DAY).toISOString().slice(0, 10);
}
export function highlight(text, q) {
  const safe = esc(text);
  const terms = (q || "").split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return terms.length ? safe.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>") : safe;
}

// ------------------------------------------------------------------ item facts
export const product = (id) => DATA.products.find((p) => p.id === id) || { id, name: id, tagline: "" };
export const productName = (id) => product(id).name;
export const statusKey = (it) => (it.x ? "can" : it.k === "post" ? "post" : STATUS_KEY[it.s] || "dev");
export const needsAction = (it) => Boolean(ACTION_LABEL[it.ai?.action]);
export const live = () => DATA.items.filter((i) => !i.x);
export function lastEvent(it) {
  const evs = it.ev.filter((e) => e.type !== "details");
  return evs[evs.length - 1] || it.ev[it.ev.length - 1];
}

/** Headline numbers for a product (or everything when id is empty). */
export function stats(id = "") {
  const items = live().filter((i) => !id || i.p === id);
  return {
    total: items.length,
    week: items.filter((i) => daysAgo(i.la) <= 7).length,
    rolling: items.filter((i) => i.s === "Rolling out").length,
    action: items.filter((i) => daysAgo(i.la) <= 30 && needsAction(i)).length,
  };
}

/** Short label for what most recently happened to an item. */
export function changeLabel(it) {
  const e = lastEvent(it);
  if (!e) return "";
  if (e.type === "status") return `Now ${e.to.toLowerCase()}`;
  if (e.type === "ga_date") return "Date changed";
  if (e.type === "preview") return "Preview date changed";
  if (e.type === "removed") return "Removed";
  if (e.type === "returned") return "Back on roadmap";
  if (e.type === "new") return it.k === "post" ? "Blog post" : "New";
  return "Updated";
}

export function moveText(it) {
  const e = lastEvent(it);
  if (!e) return "";
  if (e.type === "status") return `${esc(e.from || "—")} → ${esc(e.to)}`;
  if (e.type === "ga_date") return `GA moved ${esc(cleanMonth(e.from) || "—")} → ${esc(cleanMonth(e.to))}`;
  if (e.type === "preview") return `Preview moved ${esc(cleanMonth(e.from) || "—")} → ${esc(cleanMonth(e.to))}`;
  if (e.type === "removed") return "Removed from the Roadmap";
  if (e.type === "returned") return "Back on the Roadmap";
  return "";
}

// ------------------------------------------------------------------ rendering
export function statusPill(it) {
  const sk = statusKey(it);
  if (it.x) return `<span class="pill s-gone">Removed</span>`;
  if (it.k === "post") return `<span class="pill s-post">Blog post</span>`;
  return `<span class="pill ${STATUS[sk].cls}">${sk === "roll" ? '<span class="pulse"></span>' : ""}${esc(it.s)}</span>`;
}

export function pills(it, { product: withProduct = true } = {}) {
  const out = [];
  if (withProduct) out.push(`<span class="pill prod" style="--c:${PRODUCT_COLOR[it.p]}">${esc(productName(it.p))}</span>`);
  out.push(statusPill(it));
  if (daysAgo(it.fs) <= 7 && daysAgo(it.c) <= 10) out.push(`<span class="pill new">New</span>`);
  if (needsAction(it)) out.push(`<span class="pill act">${ACTION_LABEL[it.ai.action]}</span>`);
  if (it.ai?.impact === "high") out.push(`<span class="pill imp">High impact</span>`);
  return out.join("");
}

const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';

export function card(it, i = 0, { q = "", product: withProduct = true } = {}) {
  const move = moveText(it);
  const summary = it.ai?.summary || it.d;
  const when = it.k === "feature" && it.ga ? `GA ${cleanMonth(it.ga)}` : it.k === "post" ? it.src : "";
  return `<article class="card reveal${it.x ? " is-removed" : ""}" style="--c:${PRODUCT_COLOR[it.p]};--d:${Math.min(i, 8) * 45}ms" data-id="${esc(it.id)}" role="button" tabindex="0" aria-label="${esc(it.t)}">
    <div class="card-top">${pills(it, { product: withProduct })}</div>
    <h4>${highlight(it.t, q)}</h4>
    ${move ? `<div class="move">${ARROW}${move}</div>` : ""}
    <p class="sum">${esc(summary)}</p>
    <div class="card-foot">
      <span>${esc(relDate(it.la))}</span>
      ${when ? `<span>${esc(when)}</span>` : ""}
      ${it.ap.length ? `<span class="apps">${it.ap.slice(0, 3).map((a) => `<span class="tag">${esc(a)}</span>`).join("")}</span>` : ""}
    </div>
  </article>`;
}

/**
 * A compact one-line item for the topic pages.
 * mode: "action" shows what to do, "change" leads with what changed, otherwise the summary.
 */
export function row(it, { mode = "", i = 0 } = {}) {
  const sk = statusKey(it);
  const summary = mode === "action" && it.ai?.action_note ? it.ai.action_note : it.ai?.summary || it.d;
  const lead = mode === "change" ? `<span class="row-change ${sk === "roll" ? "is-roll" : sk === "live" ? "is-live" : ""}">${esc(changeLabel(it))}</span>` : "";
  const date = it.k === "post" ? relDate(it.c) : mode === "change" || mode === "action" ? relDate(it.la) : it.ga ? `GA ${cleanMonth(it.ga)}` : relDate(it.la);
  return `<article class="row reveal" role="button" tabindex="0" data-id="${esc(it.id)}" style="--d:${Math.min(i, 10) * 35}ms" aria-label="${esc(it.t)}">
    <span class="row-dot ${STATUS[sk].cls}" aria-hidden="true"></span>
    <div class="row-main">
      <div class="row-title">${lead}${esc(it.t)}</div>
      <div class="row-sum${mode === "action" ? " is-action" : ""}">${esc(summary)}</div>
    </div>
    <div class="row-meta">${statusPill(it)}<span class="row-date">${esc(date)}</span></div>
  </article>`;
}

// ------------------------------------------------------------------ hash params
export function hashParams() {
  return new URLSearchParams(location.hash.slice(1));
}
export function updateHash(mutate) {
  const params = hashParams();
  mutate(params);
  const hash = params.toString();
  history.replaceState(null, "", hash ? `#${hash}` : location.pathname + location.search);
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
const DRAWER_HTML = `
  <aside class="drawer" id="drawer" aria-hidden="true" aria-labelledby="drawerTitle" role="dialog" aria-modal="true">
    <div class="drawer-scrim" data-close></div>
    <div class="drawer-panel" tabindex="-1">
      <button class="icon-btn drawer-close" type="button" data-close aria-label="Close details">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <div id="drawerBody"></div>
    </div>
  </aside>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
let lastFocus = null;

export function openDrawer(id) {
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
  updateHash((p) => p.set("item", id));
}

export function closeDrawer() {
  const drawer = $("#drawer");
  if (!drawer?.classList.contains("open")) return;
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  delete drawer.dataset.id;
  document.body.style.overflow = "";
  updateHash((p) => p.delete("item"));
  lastFocus?.focus?.();
}

export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ------------------------------------------------------------------ reveal animation
let revealObserver;
export function observeReveals() {
  if (reduceMotion || !("IntersectionObserver" in window)) { $$(".reveal").forEach((el) => el.classList.add("in")); return; }
  revealObserver ??= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealObserver.unobserve(e.target); }
  }, { rootMargin: "0px 0px -30px 0px" });
  $$(".reveal:not(.in)").forEach((el) => revealObserver.observe(el));
}

// ------------------------------------------------------------------ page chrome
/** Wire up everything both pages share: drawer, item clicks, keyboard, theme, card glow. */
export function initPage() {
  document.body.insertAdjacentHTML("beforeend", DRAWER_HTML);

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-close]")) { closeDrawer(); return; }
    const copy = t.closest("[data-copy]");
    if (copy) {
      const url = `${location.origin}${location.pathname}${location.search}#item=${copy.dataset.copy}`;
      navigator.clipboard?.writeText(url).then(() => toast("Link copied"), () => toast(url));
      return;
    }
    const idEl = t.closest("[data-id]");
    if (idEl && !t.closest(".drawer")) openDrawer(idEl.dataset.id);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.('[role="button"][data-id]')) { e.preventDefault(); openDrawer(e.target.dataset.id); return; }
    if (e.key === "/" && !/input|select|textarea/i.test(document.activeElement.tagName)) {
      const search = $("#search");
      if (search) { e.preventDefault(); search.focus(); }
    }
    if (e.key === "Tab" && $("#drawer").classList.contains("open")) {
      const f = $$("#drawer a, #drawer button").filter((x) => x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  document.addEventListener("pointermove", (e) => {
    const c = e.target.closest?.(".card");
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.style.setProperty("--mx", `${e.clientX - r.left}px`);
    c.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, { passive: true });

  $("#themeToggle")?.addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("radar-theme", root.dataset.theme); } catch (err) { /* private mode */ }
  });

  window.addEventListener("hashchange", () => {
    const id = hashParams().get("item");
    if (id && id !== $("#drawer").dataset.id) openDrawer(id);
  });
}

export function updatedText() {
  const at = DATA.updated_at ? new Date(DATA.updated_at) : null;
  return at ? `Updated ${at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : "Live tracker";
}

export function openItemFromHash() {
  const id = hashParams().get("item");
  if (id) openDrawer(id);
}
