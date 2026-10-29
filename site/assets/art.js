// Animated illustrations, one per product. Pure SVG + CSS (see .art rules in styles.css),
// drawn for dark backgrounds. All motion is disabled under prefers-reduced-motion.

const sparkle = (x, y, s, cls = "") =>
  `<path class="${cls}" transform="translate(${x} ${y}) scale(${s})" d="M0-10C1.2-3.5 3.5-1.2 10 0 3.5 1.2 1.2 3.5 0 10-1.2 3.5-3.5 1.2-10 0-3.5-1.2-1.2-3.5 0-10Z"/>`;

const tile = (letter, color, cls) => `
  <g class="${cls}">
    <rect x="-15" y="-15" width="30" height="30" rx="8" fill="${color}"/>
    <text x="0" y="5.5" text-anchor="middle" font-size="16" font-weight="800" fill="#fff" font-family="Inter, system-ui, sans-serif">${letter}</text>
  </g>`;

export const ART = {
  // Copilot at the centre with Word, Excel, PowerPoint and Outlook in orbit.
  m365: `
  <svg class="art art-m365" viewBox="0 0 240 180" aria-hidden="true">
    <defs>
      <radialGradient id="a-m-glow"><stop offset="0" stop-color="#9d84ff" stop-opacity=".75"/><stop offset="1" stop-color="#9d84ff" stop-opacity="0"/></radialGradient>
      <linearGradient id="a-m-core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6a4ff"/><stop offset=".55" stop-color="#6d4aff"/><stop offset="1" stop-color="#19c3a6"/></linearGradient>
    </defs>
    <circle cx="120" cy="90" r="70" fill="url(#a-m-glow)" class="pulse-soft"/>
    <circle cx="120" cy="90" r="56" fill="none" stroke="#b6a4ff" stroke-opacity=".35" stroke-dasharray="3 6"/>
    <g transform="translate(120 90)">
      <g class="core-spin" fill="url(#a-m-core)">${sparkle(0, 0, 3.1)}</g>
    </g>
    <g class="orbit"><g transform="translate(176 90)">${tile("W", "#2b7cd3", "counter")}</g></g>
    <g class="orbit o2"><g transform="translate(176 90)">${tile("X", "#1f9d55", "counter")}</g></g>
    <g class="orbit o3"><g transform="translate(176 90)">${tile("P", "#d2572c", "counter")}</g></g>
    <g class="orbit o4"><g transform="translate(176 90)">${tile("O", "#1b6ac9", "counter")}</g></g>
    <g fill="#fff">${sparkle(46, 34, .5, "twinkle")}${sparkle(196, 150, .6, "twinkle t2")}${sparkle(204, 30, .4, "twinkle t3")}</g>
  </svg>`,

  // A conversation: a question, a typing indicator, then an answer with a source chip.
  chat: `
  <svg class="art art-chat" viewBox="0 0 240 180" aria-hidden="true">
    <defs><linearGradient id="a-c-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2dc2b1"/><stop offset="1" stop-color="#0f8a7e"/></linearGradient></defs>
    <g class="bubble b1">
      <rect x="104" y="18" width="116" height="38" rx="14" fill="#ffffff" fill-opacity=".14" stroke="#ffffff" stroke-opacity=".25"/>
      <rect x="118" y="31" width="70" height="5" rx="2.5" fill="#fff" fill-opacity=".8"/>
      <rect x="118" y="41" width="44" height="5" rx="2.5" fill="#fff" fill-opacity=".5"/>
    </g>
    <g class="bubble b2">
      <rect x="20" y="68" width="62" height="30" rx="14" fill="url(#a-c-b)"/>
      <circle class="dot d1" cx="38" cy="83" r="4" fill="#fff"/><circle class="dot d2" cx="51" cy="83" r="4" fill="#fff"/><circle class="dot d3" cx="64" cy="83" r="4" fill="#fff"/>
    </g>
    <g class="bubble b3">
      <rect x="20" y="108" width="150" height="56" rx="14" fill="url(#a-c-b)"/>
      <rect x="34" y="121" width="108" height="5" rx="2.5" fill="#fff" fill-opacity=".95"/>
      <rect x="34" y="131" width="92" height="5" rx="2.5" fill="#fff" fill-opacity=".75"/>
      <rect x="34" y="144" width="42" height="11" rx="5.5" fill="#fff" fill-opacity=".25"/>
      <rect x="80" y="144" width="34" height="11" rx="5.5" fill="#fff" fill-opacity=".25"/>
    </g>
    <g fill="#9ff5e7">${sparkle(196, 112, .9, "twinkle")}${sparkle(214, 140, .5, "twinkle t2")}</g>
  </svg>`,

  // An agent flow: trigger → knowledge → action, with data travelling along the wires.
  studio: `
  <svg class="art art-studio" viewBox="0 0 240 180" aria-hidden="true">
    <defs><linearGradient id="a-s-n" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffb07a"/><stop offset="1" stop-color="#e0560f"/></linearGradient></defs>
    <g fill="none" stroke="#ffb07a" stroke-width="2.5" stroke-linecap="round">
      <path class="wire" d="M62 58 C100 58 96 90 120 90"/>
      <path class="wire w2" d="M120 90 C146 90 140 122 178 122"/>
      <path class="wire w3" d="M120 90 C146 90 140 58 178 58"/>
    </g>
    <g class="node n1"><rect x="18" y="38" width="44" height="40" rx="12" fill="url(#a-s-n)"/><path d="M33 58h14M40 51v14" stroke="#fff" stroke-width="3" stroke-linecap="round"/></g>
    <g class="node n2"><circle cx="120" cy="90" r="26" fill="#ffffff" fill-opacity=".12" stroke="#ffb07a" stroke-width="2"/>
      <g transform="translate(120 90)"><g class="gear"><path fill="#ffd2b3" d="M-3-14h6l1 4 4 2 4-2 4 4-2 4 2 4 4 1v6l-4 1-2 4 2 4-4 4-4-2-4 2-1 4h-6l-1-4-4-2-4 2-4-4 2-4-2-4-4-1v-6l4-1 2-4-2-4 4-4 4 2 4-2z"/><circle r="5" fill="#2a1450"/></g></g></g>
    <g class="node n3"><rect x="178" y="38" width="44" height="40" rx="12" fill="#ffffff" fill-opacity=".14" stroke="#ffb07a" stroke-opacity=".6"/><path d="M190 52h20M190 59h14M190 66h18" stroke="#ffd2b3" stroke-width="3" stroke-linecap="round"/></g>
    <g class="node n4"><rect x="178" y="102" width="44" height="40" rx="12" fill="url(#a-s-n)"/><path d="M189 122l7 7 14-14" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g fill="#fff">${sparkle(120, 34, .55, "twinkle")}${sparkle(40, 140, .7, "twinkle t2")}</g>
  </svg>`,

  // SharePoint pages being read by AI: a scanning beam and sparkles over stacked pages.
  sharepoint: `
  <svg class="art art-sharepoint" viewBox="0 0 240 180" aria-hidden="true">
    <defs>
      <linearGradient id="a-p-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc4ff" stop-opacity="0"/><stop offset=".5" stop-color="#7cc4ff" stop-opacity=".7"/><stop offset="1" stop-color="#7cc4ff" stop-opacity="0"/></linearGradient>
      <clipPath id="a-p-clip"><rect x="70" y="22" width="112" height="140" rx="12"/></clipPath>
    </defs>
    <rect class="page p3" x="94" y="12" width="112" height="140" rx="12" fill="#ffffff" fill-opacity=".06" stroke="#7cc4ff" stroke-opacity=".25"/>
    <rect class="page p2" x="82" y="17" width="112" height="140" rx="12" fill="#ffffff" fill-opacity=".09" stroke="#7cc4ff" stroke-opacity=".35"/>
    <g class="page p1">
      <rect x="70" y="22" width="112" height="140" rx="12" fill="#0f2c4d" stroke="#7cc4ff" stroke-opacity=".7"/>
      <rect x="84" y="36" width="84" height="30" rx="6" fill="#3aa0f0" fill-opacity=".55"/>
      <rect x="84" y="76" width="60" height="6" rx="3" fill="#cfe8ff" fill-opacity=".8"/>
      <rect x="84" y="88" width="80" height="6" rx="3" fill="#cfe8ff" fill-opacity=".55"/>
      <rect x="84" y="100" width="70" height="6" rx="3" fill="#cfe8ff" fill-opacity=".55"/>
      <rect x="84" y="116" width="38" height="30" rx="6" fill="#cfe8ff" fill-opacity=".2"/>
      <rect x="128" y="116" width="40" height="30" rx="6" fill="#cfe8ff" fill-opacity=".2"/>
      <g clip-path="url(#a-p-clip)"><rect class="beam" x="70" y="10" width="112" height="34" fill="url(#a-p-beam)"/></g>
    </g>
    <g fill="#bfe2ff">${sparkle(52, 52, .9, "twinkle")}${sparkle(196, 150, .7, "twinkle t2")}${sparkle(40, 128, .5, "twinkle t3")}</g>
    <circle cx="186" cy="42" r="15" fill="#3aa0f0"/><g transform="translate(186 42)"><g class="core-spin" fill="#fff">${sparkle(0, 0, .8)}</g></g>
  </svg>`,
};
