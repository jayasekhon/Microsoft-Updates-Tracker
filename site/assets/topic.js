// Topic page (topic.html?p=<product>): one product's updates, most important first.

import { ART } from "./art.js";
import {
  $, DATA, MONTHS, PRODUCT_HEX, daysAgo, esc, initPage, live, loadData, monthKey, needsAction,
  nowMonthKey, observeReveals, openItemFromHash, row, stats, updatedText,
} from "./core.js";

const byActivity = (a, b) => (b.la || "").localeCompare(a.la || "") || a.t.localeCompare(b.t);
const LIMIT = 6;

/** Each section answers one question about this product. */
function sections(items) {
  const nowKey = nowMonthKey();
  const features = items.filter((i) => i.k === "feature");
  const soon = features.filter((i) => i.s === "In development" && (monthKey(i.ga) ?? -1) >= nowKey && monthKey(i.ga) <= nowKey + 2);
  return [
    {
      id: "action", icon: "⚠️", title: "Needs action",
      blurb: "Changes in the last 30 days that need an admin or a heads-up for users.",
      items: items.filter((i) => daysAgo(i.la) <= 30 && needsAction(i)).sort(byActivity),
      mode: "action", tone: "alert",
    },
    {
      id: "week", icon: "✦", title: "This week",
      blurb: "Everything that changed in the last 7 days.",
      items: items.filter((i) => daysAgo(i.la) <= 7).sort(byActivity),
      mode: "change", empty: "Nothing changed in the last 7 days.",
    },
    {
      id: "rolling", icon: "🚀", title: "Rolling out now",
      blurb: "Arriving in tenants over the coming weeks.",
      items: features.filter((i) => i.s === "Rolling out").sort(byActivity),
    },
    {
      id: "soon", icon: "🗓️", title: "Coming soon",
      blurb: "Still in development, with general availability due in the next three months.",
      items: soon.sort((a, b) => monthKey(a.ga) - monthKey(b.ga) || a.t.localeCompare(b.t)),
      groupByMonth: true,
    },
    {
      id: "launched", icon: "✅", title: "Recently launched",
      blurb: "Generally available, with activity in the last 45 days.",
      items: features.filter((i) => i.s === "Launched" && daysAgo(i.la) <= 45).sort(byActivity),
    },
    {
      id: "posts", icon: "📰", title: "From Microsoft's blogs",
      blurb: "Announcements and deep dives from the last 60 days.",
      items: items.filter((i) => i.k === "post" && daysAgo(i.c) <= 60).sort(byActivity),
    },
  ];
}

function renderSection(sec, expanded) {
  if (!sec.items.length && !sec.empty) return "";
  const list = expanded ? sec.items : sec.items.slice(0, sec.groupByMonth ? LIMIT * 2 : LIMIT);
  let body;
  if (!sec.items.length) {
    body = `<p class="sec-empty">${esc(sec.empty)}</p>`;
  } else if (sec.groupByMonth) {
    const groups = new Map();
    list.forEach((it) => {
      const k = monthKey(it.ga);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    });
    body = [...groups].map(([k, its]) => `<div class="month-label">${MONTHS[k % 12]} ${Math.floor(k / 12)}</div>
      <div class="rows">${its.map((it, i) => row(it, { i })).join("")}</div>`).join("");
  } else {
    body = `<div class="rows">${list.map((it, i) => row(it, { mode: sec.mode, i })).join("")}</div>`;
  }
  const limit = sec.groupByMonth ? LIMIT * 2 : LIMIT;
  const more = sec.items.length <= limit ? ""
    : expanded ? `<button class="sec-more" type="button" data-collapse="${sec.id}">Show fewer</button>`
    : `<button class="sec-more" type="button" data-expand="${sec.id}">Show all ${sec.items.length}</button>`;
  return `<section class="sec ${sec.tone ? `is-${sec.tone}` : ""}" id="sec-${sec.id}" aria-labelledby="h-${sec.id}">
    <header class="sec-head">
      <span class="sec-icon" aria-hidden="true">${sec.icon}</span>
      <div><h2 id="h-${sec.id}">${esc(sec.title)} <span class="sec-n">${sec.items.length}</span></h2><p>${esc(sec.blurb)}</p></div>
    </header>
    ${body}
    ${more}
  </section>`;
}

async function boot() {
  initPage();
  const id = new URLSearchParams(location.search).get("p");
  try {
    await loadData();
  } catch (err) {
    $("#sections").innerHTML = `<div class="empty"><div class="big">⚠️</div><p>Couldn't load the update data. Try refreshing.</p></div>`;
    return;
  }
  const p = DATA.products.find((x) => x.id === id);
  if (!p) { location.replace("./"); return; }

  document.title = `${p.name} updates · Copilot Radar`;
  document.documentElement.style.setProperty("--topic", PRODUCT_HEX[p.id]);
  const s = stats(p.id);
  $("#topicHero").innerHTML = `
    <div class="topic-copy">
      <nav class="topic-switch" aria-label="Products">
        <a href="./" class="back">← All products</a>
        ${DATA.products.map((x) => `<a href="topic.html?p=${x.id}" style="--c:${PRODUCT_HEX[x.id]}" ${x.id === p.id ? 'aria-current="page"' : ""}><span class="dot"></span>${esc(x.name)}</a>`).join("")}
      </nav>
      <h1>${esc(p.name)}</h1>
      <p class="lede">${esc(p.tagline || "")}</p>
      <div class="topic-stats">
        <a href="#sec-week"><b>${s.week}</b><span>changes this week</span></a>
        <a href="#sec-rolling"><b>${s.rolling}</b><span>rolling out now</span></a>
        <a href="#sec-action" class="${s.action ? "is-alert" : ""}"><b>${s.action}</b><span>need action</span></a>
      </div>
      <p class="topic-updated">${esc(updatedText())} · ${s.total} updates tracked</p>
    </div>
    <div class="topic-art">${ART[p.id] || ""}</div>`;

  const items = live().filter((i) => i.p === p.id);
  const secs = sections(items);
  const expanded = new Set();
  const draw = () => {
    $("#sections").innerHTML = secs.map((sec) => renderSection(sec, expanded.has(sec.id))).join("");
    observeReveals();
  };
  draw();
  $("#searchLink").href = `./#p=${p.id}`;
  $("#searchLink").textContent = `Search all ${p.name} updates →`;

  $("#sections").addEventListener("click", (e) => {
    const exp = e.target.closest("[data-expand]");
    if (exp) { expanded.add(exp.dataset.expand); draw(); return; }
    const col = e.target.closest("[data-collapse]");
    if (col) {
      expanded.delete(col.dataset.collapse);
      draw();
      $(`#sec-${col.dataset.collapse}`).scrollIntoView({ block: "nearest" });
    }
  });
  openItemFromHash();
}

boot();
