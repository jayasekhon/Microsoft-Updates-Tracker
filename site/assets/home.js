// Homepage: radar hero, the 3D product carousel, and the full list at the bottom.

import { ART } from "./art.js";
import { mountBrowser } from "./browser.js";
import { $, $$, DATA, PRODUCT_HEX, daysAgo, esc, initPage, live, loadData, openItemFromHash, reduceMotion, stats, updatedText } from "./core.js";

// The sweep's bright leading edge points at -45° (SVG angles: 0° = east, clockwise) when its
// CSS rotation is 0, and turns once every SWEEP_SECONDS (keep in sync with .radar .sweep).
const SWEEP_SECONDS = 5;
const LEAD_OFFSET = -45;
// Seconds after the leading edge passes: pop in, hold, then fade out.
const POP = 0.18, HOLD = 1.6, FADE = 1.6;

function renderRadar() {
  // The 16 most recent changes. Angle = product quadrant, distance from centre = age.
  const recent = [...live()].sort((a, b) => (b.la || "").localeCompare(a.la || "")).slice(0, 16);
  const quad = Object.fromEntries(DATA.products.map((p, i) => [p.id, i]));
  $("#blips").innerHTML = recent.map((it, i) => {
    const deg = (quad[it.p] ?? 0) * 90 + 15 + ((i * 37) % 60) - 90;
    const r = 40 + Math.min(140, daysAgo(it.la) * 9) + ((i * 13) % 20);
    const x = (200 + r * Math.cos((deg * Math.PI) / 180)).toFixed(1);
    const y = (200 + r * Math.sin((deg * Math.PI) / 180)).toFixed(1);
    return `<g class="blip" data-id="${esc(it.id)}" data-deg="${deg}" style="transform-origin:${x}px ${y}px"><title>${esc(it.t)}</title><circle cx="${x}" cy="${y}" r="9" fill="${PRODUCT_HEX[it.p]}" opacity=".25"/><circle cx="${x}" cy="${y}" r="4.5" fill="${PRODUCT_HEX[it.p]}"/></g>`;
  }).join("");
  if (reduceMotion) return;  // CSS shows the blips statically

  const sweep = $(".radar .sweep").getAnimations()[0];
  const blips = $$("#blips .blip").map((el) => ({ el, deg: Number(el.dataset.deg) }));
  const frame = () => {
    const turn = ((sweep?.currentTime ?? performance.now()) / 1000 / SWEEP_SECONDS) % 1;
    const lead = LEAD_OFFSET + turn * 360;
    for (const b of blips) {
      // Seconds since the leading edge last crossed this blip.
      const since = ((((lead - b.deg) % 360) + 360) % 360) / 360 * SWEEP_SECONDS;
      let opacity = 0, scale = 1;
      if (since < POP) { opacity = since / POP; scale = 1.6 - 0.6 * (since / POP); }
      else if (since < POP + HOLD) opacity = 1;
      else if (since < POP + HOLD + FADE) opacity = 1 - (since - POP - HOLD) / FADE;
      b.el.style.opacity = opacity.toFixed(3);
      b.el.style.transform = scale === 1 ? "" : `scale(${scale.toFixed(3)})`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function renderSummary(browser) {
  const s = stats();
  const el = $("#weekLine");
  el.innerHTML = `<button type="button" data-quick="week"><b>${s.week}</b> changes this week</button>
    <span aria-hidden="true">·</span>
    <button type="button" data-quick="action"><b>${s.action}</b> need action</button>
    <span aria-hidden="true">·</span>
    <button type="button" data-quick="rolling"><b>${s.rolling}</b> rolling out now</button>`;
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-quick]");
    if (!b) return;
    const q = b.dataset.quick;
    browser.show(q === "week" ? { range: "7" } : q === "action" ? { action: true, range: "30" } : { status: "roll" });
  });
}

// ------------------------------------------------------------------ 3D carousel
function mountCarousel() {
  const products = DATA.products;
  const n = products.length;
  const stage = $("#carousel");
  stage.innerHTML = `
    <div class="ring" data-role="ring">
      ${products.map((p, i) => {
        const s = stats(p.id);
        return `<a class="world" href="topic.html?p=${p.id}" data-i="${i}" style="--c:${PRODUCT_HEX[p.id]}" aria-label="${esc(p.name)}: ${s.week} changes this week, ${s.rolling} rolling out, ${s.action} need action">
          <div class="world-art">${ART[p.id] || ""}</div>
          <div class="world-body">
            <h3>${esc(p.name)}</h3>
            <p>${esc(p.tagline || "")}</p>
            <dl class="world-stats">
              <div><dt>This week</dt><dd>${s.week}</dd></div>
              <div><dt>Rolling out</dt><dd>${s.rolling}</dd></div>
              <div class="${s.action ? "is-alert" : ""}"><dt>Need action</dt><dd>${s.action}</dd></div>
            </dl>
            <span class="world-go">Explore ${esc(p.name)} <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span>
          </div>
        </a>`;
      }).join("")}
    </div>
    <button class="car-btn prev" type="button" aria-label="Previous product"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
    <button class="car-btn next" type="button" aria-label="Next product"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>`;
  $("#carouselTabs").innerHTML = products.map((p, i) =>
    `<button type="button" role="tab" data-go="${i}" style="--c:${PRODUCT_HEX[p.id]}" aria-selected="false"><span class="dot"></span>${esc(p.name)}</button>`).join("");

  const worlds = $$(".world", stage);
  let active = 0;
  let timer = null;

  function layout() {
    worlds.forEach((w, i) => {
      // Signed distance from the active card, wrapped so the ring is circular: -1, 0, 1, 2…
      let off = (i - active + n) % n;
      if (off > n / 2) off -= n;
      w.dataset.off = String(off);
      w.tabIndex = off === 0 ? 0 : -1;
      w.setAttribute("aria-hidden", String(off !== 0));
    });
    $$("#carouselTabs button").forEach((b, i) => b.setAttribute("aria-selected", String(i === active)));
  }
  const go = (i) => { active = (i + n) % n; layout(); };
  const next = () => go(active + 1);
  const prev = () => go(active - 1);

  function autoplay(on) {
    clearInterval(timer);
    if (on && !reduceMotion) timer = setInterval(next, 5200);
  }

  // A click on a side card brings it to the front instead of navigating.
  stage.addEventListener("click", (e) => {
    if (e.target.closest(".next")) { next(); autoplay(false); return; }
    if (e.target.closest(".prev")) { prev(); autoplay(false); return; }
    const w = e.target.closest(".world");
    if (w && w.dataset.off !== "0") { e.preventDefault(); go(Number(w.dataset.i)); autoplay(false); }
  });
  $("#carouselTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) { go(Number(b.dataset.go)); autoplay(false); }
  });
  stage.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { next(); autoplay(false); $$(".world")[active].focus(); }
    if (e.key === "ArrowLeft") { prev(); autoplay(false); $$(".world")[active].focus(); }
  });

  // Swipe on touch screens.
  let startX = null;
  let swiped = false;
  stage.addEventListener("pointerdown", (e) => { startX = e.clientX; });
  stage.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) { swiped = true; dx < 0 ? next() : prev(); autoplay(false); }
  });
  // Stop a swipe from also counting as a click on the card under the finger.
  stage.addEventListener("click", (e) => {
    if (!swiped) return;
    swiped = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  const wrap = $(".carousel-wrap");
  wrap.addEventListener("pointerenter", () => autoplay(false));
  wrap.addEventListener("pointerleave", () => autoplay(true));
  wrap.addEventListener("focusin", () => autoplay(false));

  layout();
  autoplay(true);
}

async function boot() {
  initPage();
  try {
    await loadData();
  } catch (err) {
    $("#browse").innerHTML = `<div class="empty"><div class="big">⚠️</div><p>Couldn't load the update data. Try refreshing.</p></div>`;
    return;
  }
  $("#updatedAt").textContent = updatedText();
  const warn = (DATA.warnings || []).filter((w) => w.startsWith("error") || w.startsWith("warning"));
  $("#warnings").textContent = warn.length ? `Source status: ${warn.join(" · ")}` : "";
  renderRadar();
  mountCarousel();
  const browser = mountBrowser($("#browse"));
  renderSummary(browser);
  // Arriving with filters in the link (e.g. "Search all Copilot Studio updates" on a topic page): go straight to the list.
  const params = new URLSearchParams(location.hash.slice(1));
  if ([...params.keys()].some((k) => k !== "item")) $("#browse").scrollIntoView();
  openItemFromHash();
}

boot();
