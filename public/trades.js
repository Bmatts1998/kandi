/* Digital kandi trades — loaded before app.js, attached from inside the app IIFE. */
(function () {
  const STYLES = [
    { id: "classic", label: "Classic", beads: ["#ff5c00", "#ff8a1a", "#ffc14d", "#fff7f0", "#ff5c00", "#1a120c", "#ff8a1a"] },
    { id: "glow", label: "Glow", beads: ["#ff5c00", "#ff8a3d", "#ffe14d", "#ff5c00", "#ff3d9a", "#ff8a1a", "#fff3c4"] },
    { id: "neon", label: "Neon", beads: ["#ff0080", "#ff6a00", "#fff200", "#39ff14", "#00f0ff", "#1f51ff", "#bc13fe"] },
    { id: "rainbow", label: "Rainbow", beads: ["#ff3b3b", "#ff8a1a", "#ffe14d", "#6dff6a", "#2ef0ff", "#4d7cff", "#b44aff"] },
    { id: "pastel", label: "Pastel", beads: ["#ffb3c7", "#ffd1a8", "#fff1a8", "#c8f7c5", "#b5f0ea", "#b9d6ff", "#d9c2ff"] },
    { id: "glitter", label: "Glitter", beads: ["#ff7ad9", "#b44aff", "#2ef0ff", "#ffe14d", "#ff5c00", "#6dff6a"] },
    { id: "jelly", label: "Jelly", beads: ["#ff3d9a", "#ff8a1a", "#6dff6a", "#2ef0ff", "#b44aff", "#ffe14d"] },
    { id: "uv", label: "Blacklight", beads: ["#111111", "#7a5cff", "#d0b0ff", "#2ef0ff", "#ff5cff", "#111111", "#b44aff"] },
    { id: "sunset", label: "Sunset", beads: ["#ff3d9a", "#ff5c00", "#ff8a1a", "#ffc14d", "#ff7ad9", "#ff3b3b"] },
    { id: "forest", label: "Forest", beads: ["#0c3b28", "#1a6b3c", "#d4ff3f", "#6dff6a", "#0c3b28", "#fff7f0"] },
    { id: "ice", label: "Ice", beads: ["#e8f6ff", "#2ef0ff", "#7ad0ff", "#4d7cff", "#f5f5f7", "#2ef0ff"] },
    { id: "candy", label: "Candy", beads: ["#ff7ad9", "#ff8aa8", "#fff7f0", "#ff5c00", "#ffc14d", "#ff7ad9"] },
    { id: "midnight", label: "Midnight", beads: ["#140816", "#3b0a5c", "#b44aff", "#ff3d9a", "#111111", "#7a5cff"] },
    { id: "pearl", label: "Pearl", beads: ["#fff7f0", "#f0d4b8", "#e8c4a0", "#fff7f0", "#d4b08a", "#fff3e0"] },
    { id: "metallic", label: "Metallic", beads: ["#d4af37", "#c0c0c0", "#ffd56a", "#8a8a8a", "#d4af37", "#fff7f0"] },
  ];
  const PALETTES = [
    { id: "classic", label: "Classic", colors: ["#ff5c00", "#ff8a1a", "#ffc14d", "#ffe14d", "#fff7f0", "#ff3d9a", "#ff7ad9", "#ff3b3b", "#6dff6a", "#d4ff3f", "#2ef0ff", "#7ad0ff", "#4d7cff", "#b44aff", "#7a5cff", "#111111", "#3b0a5c", "#d4af37", "#c0c0c0"] },
    { id: "neon", label: "Neon", colors: ["#ff0080", "#ff2e63", "#ff6a00", "#fff200", "#ccff00", "#39ff14", "#00ff9f", "#00f0ff", "#1f51ff", "#7a00ff", "#bc13fe", "#ff00e5"] },
    { id: "pastel", label: "Pastel", colors: ["#ffb3c7", "#ffd1a8", "#fff1a8", "#c8f7c5", "#b5f0ea", "#b9d6ff", "#d9c2ff", "#ffc9f0", "#f7e1d7", "#e6e6fa"] },
    { id: "glow", label: "Glow", colors: ["#d6ff5c", "#9dffd9", "#b8f4ff", "#fffbb0", "#ffd9f2", "#e4ffd0", "#c7b8ff", "#ffe0b0"] },
    { id: "metal", label: "Metal", colors: ["#d4af37", "#ffd56a", "#c0c0c0", "#8a8a8a", "#b76e79", "#cd7f32", "#e8e8f0", "#4a4a55"] },
  ];
  const SHAPES = [
    { id: "round", label: "Round" },
    { id: "star", label: "Star" },
    { id: "heart", label: "Heart" },
    { id: "pony", label: "Pony" },
    { id: "cube", label: "Cube" },
    { id: "flower", label: "Flower" },
  ];
  const WRAPPED_SHAPES = new Set(["star", "heart", "flower"]);
  const PATTERNS = [
    { id: "solid", label: "Solid" },
    { id: "alternating", label: "Alternating" },
    { id: "rainbow", label: "Rainbow" },
    { id: "custom", label: "Custom" },
  ];
  const CHARMS = [
    { id: "none", label: "None", e: "" },
    { id: "star", label: "Star", e: "⭐" },
    { id: "heart", label: "Heart", e: "💖" },
    { id: "bolt", label: "Bolt", e: "⚡" },
    { id: "moon", label: "Moon", e: "🌙" },
    { id: "smiley", label: "Smiley", e: "😊" },
    { id: "peace", label: "Peace", e: "☮️" },
    { id: "butterfly", label: "Butterfly", e: "🦋" },
    { id: "flower", label: "Flower", e: "🌸" },
    { id: "crown", label: "Crown", e: "👑" },
    { id: "rainbow", label: "Rainbow", e: "🌈" },
    { id: "gem", label: "Gem", e: "💎" },
    { id: "alien", label: "Alien", e: "👽" },
  ];
  const RAINBOW = ["#ff3b3b", "#ff8a1a", "#ffe14d", "#6dff6a", "#2ef0ff", "#4d7cff", "#b44aff"];
  const LEN_MIN = 5;
  const LEN_MAX = 24;
  const LEN_PRESETS = [{ n: 8, label: "Small" }, { n: 12, label: "Medium" }, { n: 16, label: "Large" }, { n: 24, label: "Cuff" }];
  const DEFAULT_LEN = 12;
  const MAX_DESIGNS = 20;
  const INSTANT = new Set([
    "trade-open", "trade-open-host", "trade-open-join", "trade-pick-event", "trade-open-item", "trade-goto-you", "trade-copy-code", "trade-clear-event",
    "kd-open", "kd-new", "kd-edit", "kd-back", "kd-style", "kd-pattern", "kd-slot", "kd-color", "kd-palette", "kd-shape", "kd-bead", "kd-len",
    "kd-fill", "kd-charm", "kd-pick", "kd-save-toggle", "kd-del-ask",
  ]);

  let api, esc, toast, render, personAvatar, personName, timeAgo, getState;
  let scanTimer = null;
  let scanStream = null;
  let pollTimer = null;
  let lastQr = "";
  let lastOfferId = "";
  let attached = false;

  function state() { return getState(); }

  function styleById(id) {
    return STYLES.find((s) => s.id === id) || STYLES[0];
  }

  function drafts() {
    const s = state();
    s.drafts = s.drafts || {};
    return s.drafts;
  }

  /* ---------- design model (shared by trades and My designs) ---------- */

  function cycle(list, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(list[i % list.length]);
    return out;
  }

  function defaultDesign(word) {
    return {
      style: "classic",
      pattern: "custom",
      beads: cycle(styleById("classic").beads, DEFAULT_LEN),
      shapes: cycle(["round"], DEFAULT_LEN),
      charm: "none",
      word: word != null ? word : "PLUR",
      message: "",
    };
  }

  function normalizeDesign(d) {
    d = d || {};
    const style = STYLES.some((x) => x.id === d.style) || ["neon", "pastel", "glitter", "jelly"].includes(d.style) ? d.style : "classic";
    let beads = Array.isArray(d.beads) && d.beads.length ? d.beads.slice(0, LEN_MAX) : cycle(styleById(style).beads, DEFAULT_LEN);
    const shapes = beads.map((_, i) => (d.shapes && SHAPES.some((x) => x.id === d.shapes[i])) ? d.shapes[i] : "round");
    return {
      style,
      pattern: PATTERNS.some((x) => x.id === d.pattern) ? d.pattern : "custom",
      beads,
      shapes,
      charm: CHARMS.some((x) => x.id === d.charm) ? d.charm : "none",
      word: String(d.word || "").toUpperCase().slice(0, 8),
      message: String(d.message || ""),
    };
  }

  function designJson(d) {
    return JSON.stringify({ s: d.style, p: d.pattern, b: d.beads, h: d.shapes, c: d.charm, w: d.word, m: d.message });
  }

  function newKd(design, extra) {
    const d = normalizeDesign(design || defaultDesign());
    return Object.assign({
      design: d,
      brushA: "#ff5c00",
      brushB: "#2ef0ff",
      slot: "A",
      shape: d.shapes[0] || "round",
      group: "classic",
      selectedId: "",
      baseline: designJson(d),
      name: "",
      editingId: "",
      saveOn: false,
    }, extra || {});
  }

  function kd() {
    const s = state();
    if (!s.kd) s.kd = newKd();
    return s.kd;
  }

  function designFromDraft() {
    const k = kd();
    return JSON.parse(JSON.stringify(k.design));
  }

  function patternBeads(k, n) {
    const d = k.design;
    if (d.pattern === "solid") return cycle([k.brushA], n);
    if (d.pattern === "alternating") return cycle([k.brushA, k.brushB], n);
    if (d.pattern === "rainbow") return cycle(RAINBOW, n);
    return null;
  }

  function regenerate(k) {
    const d = k.design;
    const gen = patternBeads(k, d.beads.length);
    if (!gen) return;
    d.beads = gen;
    d.shapes = cycle([k.shape], d.beads.length);
  }

  function setLength(k, n) {
    const d = k.design;
    n = Math.max(LEN_MIN, Math.min(LEN_MAX, n));
    if (n === d.beads.length) return;
    if (d.pattern === "custom") {
      while (d.beads.length > n) { d.beads.pop(); d.shapes.pop(); }
      while (d.beads.length < n) { d.beads.push(k.slot === "B" ? k.brushB : k.brushA); d.shapes.push(k.shape); }
    } else {
      d.beads = new Array(n).fill("#000000");
      d.shapes = new Array(n).fill(k.shape);
      regenerate(k);
    }
  }

  function charmEmoji(id) {
    const c = CHARMS.find((x) => x.id === id);
    return c ? c.e : "";
  }

  function braceletHtml(design, opts) {
    opts = opts || {};
    const d = design || { beads: styleById("classic").beads, word: "", style: "classic" };
    const beads = (d.beads && d.beads.length ? d.beads : styleById(d.style).beads).slice();
    const shapes = Array.isArray(d.shapes) ? d.shapes : [];
    const word = String(d.word || "").toUpperCase();
    const letters = word.split("").filter(Boolean);
    const cls = "kandi-bracelet" + (d.style ? " style-" + esc(d.style) : "") + (opts.size ? " " + opts.size : "") + (opts.animate ? " assemble" : "");
    const mid = Math.max(0, Math.floor((beads.length - letters.length) / 2));
    const items = [];
    const inter = (i) => (opts.interactive ? ` data-act="kd-bead" data-id="${i}" aria-label="Paint bead ${i + 1}"` : "");
    const tag = opts.interactive ? "button" : "span";
    const typeAttr = opts.interactive ? ' type="button"' : "";
    let li = 0;
    for (let i = 0; i < beads.length; i++) {
      if (i >= mid && li < letters.length) {
        items.push(`<${tag}${typeAttr} class="kandi-bead letter" style="--bead:${esc(beads[i])};--i:${i}"${inter(i)}><i>${esc(letters[li])}</i></${tag}>`);
        li++;
        continue;
      }
      const shape = SHAPES.some((x) => x.id === shapes[i]) ? shapes[i] : "round";
      const sc = shape === "round" ? "" : " shape-" + shape;
      if (WRAPPED_SHAPES.has(shape)) {
        items.push(`<${tag}${typeAttr} class="kb-s" style="--bead:${esc(beads[i])};--i:${i}"${inter(i)}><span class="kandi-bead${sc}"></span></${tag}>`);
      } else {
        items.push(`<${tag}${typeAttr} class="kandi-bead${sc}" style="--bead:${esc(beads[i])};--i:${i}"${inter(i)}></${tag}>`);
      }
    }
    while (li < letters.length) {
      items.push(`<span class="kandi-bead letter" style="--bead:#fff7f0;--i:${beads.length + li}"><i>${esc(letters[li])}</i></span>`);
      li++;
    }
    const em = charmEmoji(d.charm);
    if (em) items.push(`<span class="kandi-charm" style="--i:${beads.length + letters.length}" aria-hidden="true">${em}</span>`);
    const label = opts.caption ? `<span class="kandi-br-cap">${opts.caption}</span>` : "";
    return `<div class="${cls}" role="img" aria-label="${esc((word ? word + " kandi" : "Kandi bracelet") + (opts.caption ? " · " + String(opts.caption).replace(/<[^>]+>/g, "") : ""))}">${items.join("")}</div>${label}`;
  }

  /* ---------- designer UI (used during a trade and in My designs) ---------- */

  function swatch(c, act, id, on, extraCls) {
    return `<button type="button" class="kandi-bead sm kd-sw${on ? " on" : ""}${extraCls ? " " + extraCls : ""}" style="--bead:${esc(c)}" data-act="${act}" data-id="${esc(id)}" aria-label="Color ${esc(c)}"></button>`;
  }

  function shapeChipHtml(sh, on) {
    return `<button type="button" class="chip kd-shape${on ? " on" : ""}" data-act="kd-shape" data-id="${sh.id}"><span class="kd-sh-ico"><span class="kandi-bead sm${sh.id === "round" ? "" : " shape-" + sh.id}" style="--bead:var(--orange2)"></span></span>${esc(sh.label)}</button>`;
  }

  function controlsOneHtml(k) {
    const d = k.design;
    const pal = PALETTES.find((p) => p.id === k.group) || PALETTES[0];
    const custom = d.pattern === "custom";
    const hint = d.pattern === "custom"
      ? "Tap any bead above to paint it with the selected color and shape."
      : d.pattern === "rainbow"
        ? "Rainbow uses its own colors. Pick a color to switch to Solid."
        : "Pick colors and a shape. Choose Custom to paint bead by bead.";
    return `
      <div class="label" style="margin-top:14px">Quick start</div>
      <div class="kd-scroll">${STYLES.map((st) => `<button type="button" class="chip${d.style === st.id ? " on" : ""}" data-act="kd-style" data-id="${st.id}">${esc(st.label)}</button>`).join("")}</div>
      <div class="label" style="margin-top:14px">Pattern</div>
      <div class="chips">${PATTERNS.map((pt) => `<button type="button" class="chip${d.pattern === pt.id ? " on" : ""}" data-act="kd-pattern" data-id="${pt.id}">${esc(pt.label)}</button>`).join("")}</div>
      <div class="label" style="margin-top:14px">Colors</div>
      <div class="kd-brush">
        <button type="button" class="kd-slot${k.slot === "A" ? " on" : ""}" data-act="kd-slot" data-id="A" aria-label="Color A"><span class="kandi-bead sm" style="--bead:${esc(k.brushA)}"></span><b>A</b></button>
        <button type="button" class="kd-slot${k.slot === "B" ? " on" : ""}${(d.pattern === "alternating" || custom) ? "" : " dim"}" data-act="kd-slot" data-id="B" aria-label="Color B"><span class="kandi-bead sm" style="--bead:${esc(k.brushB)}"></span><b>B</b></button>
        ${custom ? `<button type="button" class="chip kd-fill" data-act="kd-fill">Fill all</button>` : ""}
      </div>
      <div class="kd-scroll kd-tabs">${PALETTES.map((p) => `<button type="button" class="chip${k.group === p.id ? " on" : ""}" data-act="kd-palette" data-id="${p.id}">${esc(p.label)}</button>`).join("")}</div>
      <div class="kandi-palette kd-pal">${pal.colors.map((c) => swatch(c, "kd-color", c, c === (k.slot === "A" ? k.brushA : k.brushB))).join("")}</div>
      <p class="tiny kd-hint">${esc(hint)}</p>
      <div class="label" style="margin-top:10px">Bead shape${(custom && (k.painted || d.shapes.some((x) => x !== d.shapes[0]))) ? ` <span class="tiny">· tap beads to apply</span>` : ""}</div>
      <div class="kd-scroll">${SHAPES.map((sh) => shapeChipHtml(sh, k.shape === sh.id)).join("")}</div>
      <div class="label" style="margin-top:14px">Length <span class="tiny">· ${d.beads.length} beads</span></div>
      <div class="kd-len">
        <button type="button" class="btn sm ghost kd-step" data-act="kd-len" data-id="-1" aria-label="Fewer beads">−</button>
        <div class="kd-scroll kd-len-presets">${LEN_PRESETS.map((lp) => `<button type="button" class="chip${d.beads.length === lp.n ? " on" : ""}" data-act="kd-len" data-id="=${lp.n}">${esc(lp.label)}</button>`).join("")}</div>
        <button type="button" class="btn sm ghost kd-step" data-act="kd-len" data-id="1" aria-label="More beads">+</button>
      </div>`;
  }

  function controlsTwoHtml(k) {
    const d = k.design;
    return `<div class="label" style="margin-top:14px">Charm <span class="tiny">(optional)</span></div>
      <div class="kd-scroll">${CHARMS.map((c) => `<button type="button" class="chip kd-charm${d.charm === c.id ? " on" : ""}" data-act="kd-charm" data-id="${c.id}">${c.e ? `<span class="kd-ch-e">${c.e}</span>` : ""}${esc(c.label)}</button>`).join("")}</div>`;
  }

  function designerHtml() {
    const k = kd();
    const d = k.design;
    return `<div class="kd">
      <div id="kd-live" class="kandi-live">${braceletHtml(d, { size: "lg", interactive: true })}</div>
      <div id="kd-ctl1">${controlsOneHtml(k)}</div>
      <label class="label" for="kd-word" style="margin-top:14px">Word <span class="tiny">(up to 8 letters)</span></label>
      <input id="kd-word" maxlength="8" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="PLUR" value="${esc(d.word || "")}" aria-label="Word on your kandi" />
      <div id="kd-ctl2">${controlsTwoHtml(k)}</div>
      <label class="label" for="kd-msg" style="margin-top:14px">Note <span class="tiny">(optional)</span></label>
      <textarea id="kd-msg" maxlength="140" placeholder="A note for whoever gets it…" aria-label="Optional note">${esc(d.message || "")}</textarea>
    </div>`;
  }

  function refreshDesigner() {
    const k = kd();
    const live = document.getElementById("kd-live");
    if (live) live.innerHTML = braceletHtml(k.design, { size: "lg", interactive: true });
    const c1 = document.getElementById("kd-ctl1");
    if (c1) c1.innerHTML = controlsOneHtml(k);
    const c2 = document.getElementById("kd-ctl2");
    if (c2) c2.innerHTML = controlsTwoHtml(k);
    const sv = document.getElementById("kd-savebox");
    if (sv) sv.innerHTML = saveBoxInner(k);
  }

  function bindDesignerInputs() {
    const k = kd();
    const live = () => {
      const el = document.getElementById("kd-live");
      if (el) el.innerHTML = braceletHtml(k.design, { size: "lg", interactive: true });
      const sv = document.getElementById("kd-savebox");
      if (sv && !sv.contains(document.activeElement)) sv.innerHTML = saveBoxInner(k);
    };
    const word = document.getElementById("kd-word");
    if (word && !word._kandiBound) {
      word._kandiBound = true;
      word.addEventListener("input", () => {
        const v = word.value.toUpperCase().replace(/[^A-Z0-9&!?+]/g, "").slice(0, 8);
        if (v !== word.value) word.value = v;
        kd().design.word = v;
        live();
      });
    }
    const msg = document.getElementById("kd-msg");
    if (msg && !msg._kandiBound) {
      msg._kandiBound = true;
      msg.addEventListener("input", () => { kd().design.message = msg.value; });
    }
    const nm = document.getElementById("kd-name");
    if (nm && !nm._kandiBound) {
      nm._kandiBound = true;
      nm.addEventListener("input", () => { kd().name = nm.value; });
    }
  }

  function applyDesignerAct(act, id) {
    const k = kd();
    const d = k.design;
    if (act === "kd-style") {
      const st = styleById(id);
      d.style = st.id;
      d.pattern = "custom";
      k.painted = false;
      d.beads = cycle(st.beads, d.beads.length);
      d.shapes = d.shapes.slice(0, d.beads.length);
      while (d.shapes.length < d.beads.length) d.shapes.push(k.shape);
    } else if (act === "kd-pattern") {
      d.pattern = id;
      if (id === "solid" || id === "alternating") k.slot = "A";
      regenerate(k);
    } else if (act === "kd-slot") {
      k.slot = id === "B" ? "B" : "A";
    } else if (act === "kd-palette") {
      k.group = id;
    } else if (act === "kd-color") {
      if (k.slot === "B") k.brushB = id; else k.brushA = id;
      if (d.pattern === "rainbow") d.pattern = "solid";
      if (d.pattern === "solid" || d.pattern === "alternating") regenerate(k);
      else if (d.pattern === "custom" && k.slot === "B") { /* B only matters for alternating */ }
    } else if (act === "kd-shape") {
      k.shape = id;
      if (d.pattern !== "custom") regenerate(k);
      else if (!k.painted && d.shapes.every((x) => x === d.shapes[0])) d.shapes = d.shapes.map(() => id); // not hand-painted yet: reshape everything
    } else if (act === "kd-bead") {
      const i = Number(id);
      if (!(i >= 0 && i < d.beads.length)) return;
      if (d.pattern !== "custom") d.pattern = "custom";
      k.painted = true;
      d.beads[i] = k.slot === "B" ? k.brushB : k.brushA;
      d.shapes[i] = k.shape;
    } else if (act === "kd-fill") {
      d.beads = d.beads.map(() => (k.slot === "B" ? k.brushB : k.brushA));
      d.shapes = d.shapes.map(() => k.shape);
    } else if (act === "kd-len") {
      const raw = String(id);
      const n = raw.charAt(0) === "=" ? Number(raw.slice(1)) : d.beads.length + Number(raw);
      if (raw.charAt(0) !== "=" && ((Number(raw) < 0 && d.beads.length <= LEN_MIN) || (Number(raw) > 0 && d.beads.length >= LEN_MAX))) {
        toast(Number(raw) < 0 ? "Leave at least " + LEN_MIN + " beads." : "That's a full cuff.");
        return;
      }
      setLength(k, n);
    } else if (act === "kd-charm") {
      d.charm = id;
    }
    refreshDesigner();
  }

  /* ---------- saved designs (My designs) ---------- */

  async function loadDesigns() {
    const s = state();
    try {
      const data = await api("/api/kandi-designs");
      s.kdList = (data && data.designs) || [];
      s.kdLastUsed = (data && data.lastUsedId) || "";
    } catch (_) {
      s.kdList = s.kdList || [];
    }
    return s.kdList;
  }

  function applyListData(data) {
    const s = state();
    if (data && data.designs) { s.kdList = data.designs; s.kdLastUsed = data.lastUsedId || ""; }
  }

  function savedById(id) {
    return (state().kdList || []).find((x) => x.id === id);
  }

  function designsListHtml(s, o) {
    const list = s.kdList;
    const full = list && list.length >= MAX_DESIGNS;
    let html = `<div class="kd-list">
      <p class="sub">Build your bracelets ahead of time. When you trade, just pick one.</p>
      <button type="button" class="btn primary" style="width:100%;margin-top:6px" data-act="kd-new"${full ? " disabled" : ""}>New design</button>
      <p class="tiny" style="text-align:center;margin:8px 0 14px">${list ? list.length : 0} of ${MAX_DESIGNS} saved${full ? " · delete one to make room" : ""}</p>`;
    if (!list) {
      html += `<p class="muted" style="text-align:center"><span class="spin"></span></p>`;
    } else if (!list.length) {
      html += `<div class="kd-empty"><div>${braceletHtml({ beads: styleById("neon").beads, shapes: ["star", "heart", "round", "pony", "round", "star", "heart"], word: "PLUR", style: "neon", charm: "star" }, { size: "md" })}</div>
        <p class="muted" style="text-align:center;margin:8px 0 0">No designs yet. Make your first kandi and it'll be ready for your next trade.</p></div>`;
    } else {
      html += `<div class="kd-cards">`;
      list.forEach((it) => {
        const asking = s.kdDelAsk === it.id;
        html += `<div class="kd-card">
          <button type="button" class="kd-card-main" data-act="kd-edit" data-id="${esc(it.id)}" aria-label="Edit ${esc(it.name)}">
            ${braceletHtml(it.design, { size: "sm" })}
            <div class="kd-card-name">${esc(it.name)}${s.kdLastUsed === it.id ? ` <span class="tiny">· last traded</span>` : ""}</div>
          </button>
          <div class="kd-card-actions">
            <button type="button" class="btn sm ghost" data-act="kd-edit" data-id="${esc(it.id)}">Edit</button>
            <button type="button" class="btn sm ghost" data-act="kd-dup" data-id="${esc(it.id)}"${full ? " disabled" : ""}>Duplicate</button>
            ${asking
              ? `<button type="button" class="btn sm danger" data-act="kd-delete" data-id="${esc(it.id)}">Tap to delete</button>`
              : `<button type="button" class="btn sm ghost" data-act="kd-del-ask" data-id="${esc(it.id)}">Delete</button>`}
          </div>
        </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  }

  function editorHtml(s, o) {
    const k = kd();
    return `<div class="kd-editor">
      <label class="label" for="kd-name">Name</label>
      <input id="kd-name" maxlength="30" autocomplete="off" placeholder="Festival kandi" value="${esc(k.name || "")}" aria-label="Design name" />
      ${designerHtml()}
      <button type="button" class="btn primary" style="margin-top:18px;width:100%" data-act="kd-save">Save design</button>
      <button type="button" class="btn ghost" style="margin-top:8px;width:100%" data-act="kd-back">Cancel</button>
    </div>`;
  }

  function isModified(k) {
    return designJson(k.design) !== k.baseline;
  }

  function stripHtml(s) {
    const list = s.kdList || [];
    const k = kd();
    if (!list.length) return "";
    return `<div class="label" style="margin-top:12px">Your designs</div>
      <div class="kd-strip">
        <button type="button" class="kd-pick new${!k.selectedId ? " on" : ""}" data-act="kd-pick" data-id=""><span class="kd-plus">+</span><span class="tiny">New</span></button>
        ${list.map((it) => `<button type="button" class="kd-pick${k.selectedId === it.id ? " on" : ""}" data-act="kd-pick" data-id="${esc(it.id)}" aria-label="Use ${esc(it.name)}">
          ${braceletHtml(it.design, { size: "xs" })}<span class="tiny kd-pick-n">${esc(it.name)}${s.kdLastUsed === it.id ? " ★" : ""}</span></button>`).join("")}
      </div>`;
  }

  function saveBoxInner(k) {
    const list = state().kdList || [];
    const hasSaved = k.selectedId && !isModified(k);
    if (hasSaved) return `<p class="tiny" style="margin:0">Using your saved design “${esc((savedById(k.selectedId) || {}).name || "")}”. Trading sends a copy, so your design stays as it is.</p>`;
    if (list.length >= MAX_DESIGNS) return `<p class="tiny" style="margin:0">Your library is full (${MAX_DESIGNS}). Delete a design in My designs to save this one.</p>`;
    return `<button type="button" class="chip${k.saveOn ? " on" : ""}" data-act="kd-save-toggle">${k.saveOn ? "✓ " : ""}${k.selectedId ? "Save as a new design" : "Save to My designs"}</button>
      ${k.saveOn ? `<input id="kd-name" maxlength="30" autocomplete="off" placeholder="Name this design" value="${esc(k.name || "")}" aria-label="Design name" style="margin-top:8px" />` : ""}`;
  }

  async function openDesigns(from) {
    const s = state();
    s.kdDelAsk = "";
    setOverlay("designs", { from: from || "profile" });
    await loadDesigns();
    const o = s.overlay;
    if (o && o.type === "trade" && o.step === "designs") render();
  }

  function openEditor(item) {
    const s = state();
    s.kd = item
      ? newKd(item.design, { editingId: item.id, name: item.name, selectedId: item.id })
      : newKd(defaultDesign(""), { name: "My kandi " + (((s.kdList || []).length) + 1), editingId: "" });
    setOverlay("editor", {});
  }

  async function saveEditor() {
    const s = state();
    const k = kd();
    const name = String(k.name || "").trim() || "My kandi";
    const design = designFromDraft();
    try {
      let data;
      if (k.editingId) data = await api("/api/kandi-designs/" + encodeURIComponent(k.editingId), { method: "PUT", body: { name, design } });
      else data = await api("/api/kandi-designs", { method: "POST", body: { name, design } });
      applyListData(data);
      toast("Saved to My designs.");
      s.kd = null;
      setOverlay("designs", {});
    } catch (err) {
      toast((err && err.message) || "Couldn't save that design.", "err");
    }
  }

  async function duplicateDesign(id) {
    try {
      const data = await api("/api/kandi-designs/" + encodeURIComponent(id) + "/duplicate", { method: "POST", body: {} });
      applyListData(data);
      toast("Duplicated.");
      render();
    } catch (err) {
      toast((err && err.message) || "Couldn't duplicate that design.", "err");
    }
  }

  async function deleteDesign(id) {
    const s = state();
    try {
      const data = await api("/api/kandi-designs/" + encodeURIComponent(id), { method: "DELETE" });
      applyListData(data);
      s.kdDelAsk = "";
      toast("Deleted.");
      render();
    } catch (err) {
      toast((err && err.message) || "Couldn't delete that design.", "err");
    }
  }

  // Start a trade design: default to the design they traded with last, else a fresh one.
  async function initTradeKd() {
    const s = state();
    await loadDesigns();
    const last = s.kdLastUsed && savedById(s.kdLastUsed);
    s.kd = last ? newKd(last.design, { selectedId: last.id, name: last.name }) : newKd(defaultDesign());
  }

  function formatTradeDate(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
    } catch (_) {
      return timeAgo ? timeAgo(iso) : "";
    }
  }

  function eventLine(ev) {
    if (!ev || !ev.name) return "";
    const when = ev.dateLabel || ev.date || "";
    return esc(ev.name) + (when ? " · " + esc(when) : "");
  }

  function collectionFor(userId) {
    const s = state();
    const me = s.me && Number(s.me.id);
    if (userId == null || Number(userId) === me) return s.myKandi || [];
    if (s.profileKandi && Number(s.profileKandiUserId) === Number(userId)) return s.profileKandi;
    return [];
  }

  function collectionHtml(p, isMe, opts) {
    if (!p) return "";
    opts = opts || {};
    const items = collectionFor(p.id);
    const visible = isMe ? items : items.filter((i) => !i.hidden);
    const hiddenCount = isMe ? items.filter((i) => i.hidden).length : 0;
    const shownAll = visible.filter((i) => isMe || !i.hidden);
    const publicCount = items.filter((i) => !i.hidden).length;
    const limit = opts.limit || 0;
    const expanded = Boolean(opts.expanded);
    const shown = (limit && !expanded && shownAll.length > limit) ? shownAll.slice(0, limit) : shownAll;
    const beadIco = `<svg class="kic pf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="12" r="3"/><circle cx="12" cy="12" r="3"/><circle cx="17" cy="12" r="3"/></svg>`;
    let html = `<section class="kandi-collection" id="kandi-collection">
      <div class="kandi-col-head">
        <div>
          <div class="label">${beadIco}Kandi collection</div>
          <div class="tiny">${publicCount ? publicCount + (publicCount === 1 ? " trade" : " trades") : (isMe ? "Trade kandi when you meet someone" : "No kandi yet")}</div>
        </div>
        ${isMe ? `<div class="kandi-col-btns"><button type="button" class="btn sm ghost" data-act="kd-open">My designs</button><button type="button" class="btn sm primary" data-act="trade-open">Trade kandi</button></div>` : ""}
      </div>`;
    if (!shownAll.length) {
      html += isMe
        ? `<div class="pf-empty kandi-empty"><p class="tiny">When you meet someone at a show, trade a digital kandi. It stays on both of your profiles as a stamp of the night.</p></div>`
        : `<div class="pf-empty kandi-empty"><p class="tiny">No kandi in this collection yet.</p></div>`;
      html += `</section>`;
      return html;
    }
    html += `<div class="kandi-col-list">`;
    shown.forEach((item) => {
      const who = item.from && item.from.name ? esc(item.from.name) : "Someone";
      const evName = item.event && item.event.name ? esc(item.event.name) : "";
      const when = formatTradeDate(item.tradedAt);
      const cap = (evName ? evName : "Traded with " + who) + (when ? " · " + when : "");
      html += `<button type="button" class="kandi-col-item${item.hidden ? " is-hidden" : ""}" data-act="trade-open-item" data-id="${esc(item.id)}" aria-label="${esc(item.word || "Kandi")} from ${who}">
        ${braceletHtml(item, { size: "sm", caption: `<span>${cap}</span>${item.hidden ? `<span class="tiny">Hidden</span>` : ""}` })}
      </button>`;
    });
    html += `</div>`;
    if (limit && shownAll.length > limit) {
      html += expanded
        ? `<button type="button" class="btn sm ghost pf-more" data-act="pf-expand" data-id="kandi">Show less</button>`
        : `<button type="button" class="btn sm ghost pf-more" data-act="pf-expand" data-id="kandi">See all ${shownAll.length}</button>`;
    }
    if (hiddenCount && isMe) html += `<p class="tiny kandi-hidden-note">${hiddenCount} hidden from others.</p>`;
    html += `</section>`;
    return html;
  }

  function overlayHtml(s) {
    const o = s.overlay;
    if (!o || (o.type !== "trade" && o.type !== "tradeItem")) return "";
    if (o.type === "tradeItem") return itemSheet(s, o);
    return tradeOverlay(s, o);
  }

  function itemSheet(s, o) {
    const item = o.item || (collectionFor(s.me && s.me.id).concat(s.profileKandi || [])).find((i) => i.id === o.id);
    if (!item) {
      return `<div class="sheet-bg" data-act="close"><div class="sheet kandi-sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2">Kandi</h2><p class="muted">This kandi isn't available.</p></div></div>`;
    }
    const who = item.from || {};
    const isOwner = s.me && item && (o.isOwner || (s.myKandi || []).some((i) => i.id === item.id));
    const when = formatTradeDate(item.tradedAt);
    return `<div class="sheet-bg" data-act="close"><div class="sheet kandi-sheet" data-stop="1"><div class="grab"></div>
      <h2 class="h2">${item.word ? esc(item.word) : "Kandi"}</h2>
      <div class="kandi-sheet-br">${braceletHtml(item, { size: "lg", animate: true })}</div>
      <p class="sub" style="margin-top:14px">From ${who.id ? `<button type="button" class="name-btn" data-act="open-profile" data-id="${who.id}">${esc(who.name || "Someone")}</button>` : esc(who.name || "Someone")}
        ${when ? " · " + esc(when) : ""}</p>
      ${item.event && item.event.name ? `<p class="tiny">${eventLine(item.event)}</p>` : ""}
      ${item.message ? `<p class="kandi-msg">“${esc(item.message)}”</p>` : ""}
      <div class="row" style="margin-top:18px;gap:8px;flex-wrap:wrap">
        ${isOwner ? `<button type="button" class="btn ghost" data-act="trade-hide" data-id="${esc(item.id)}">${item.hidden ? "Show on my profile" : "Hide this kandi"}</button>` : ""}
        ${who.id && s.me && Number(who.id) !== Number(s.me.id) ? `<button type="button" class="btn ghost" data-act="report" data-id="${who.id}">Report</button>` : ""}
      </div>
    </div></div>`;
  }

  function countdown(expiresAt) {
    const t = Date.parse(expiresAt || "");
    if (!Number.isFinite(t)) return "";
    const sec = Math.max(0, Math.floor((t - Date.now()) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + String(s).padStart(2, "0") + " left";
  }

  function tradeOverlay(s, o) {
    const step = o.step || "start";
    const offer = o.offer || s.tradeOffer;
    const title = step === "done" ? "It's a trade!" : (step === "designs" ? "My designs" : (step === "editor" ? (kd().editingId ? "Edit design" : "New design") : "Trade kandi"));
    return `<div class="overlay top-pad trade-overlay"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="trade-close" aria-label="Close">✕</button><span style="font-weight:600">${esc(title)}</span></div></div>
      <div class="scroll pad">${stepHtml(s, o, offer, step)}</div></div>`;
  }

  function stepHtml(s, o, offer, step) {
    if (step === "start") {
      return `<div class="trade-hero">${braceletHtml({ beads: styleById("neon").beads, shapes: ["round", "star", "round", "heart", "round", "star", "round"], word: "PLUR", style: "neon", charm: "star" }, { size: "lg" })}
        <h2 class="h2" style="margin-top:18px">Trade digital kandi</h2>
        <p class="sub">When you meet someone, one of you shows a code and the other scans it. You each design a bracelet, then swap.</p>
        <button type="button" class="btn primary" style="margin-top:20px;width:100%" data-act="trade-open-host">Show my code</button>
        <button type="button" class="btn ghost" style="margin-top:8px;width:100%" data-act="trade-open-join">Scan or enter a code</button>
        <button type="button" class="btn ghost" style="margin-top:8px;width:100%" data-act="kd-open">My designs <span class="tiny">· design yours ahead of time</span></button>
      </div>`;
    }
    if (step === "host") {
      const code = (offer && offer.code) || "••••••";
      const exp = offer ? countdown(offer.expiresAt) : "";
      const guest = offer && offer.guest;
      return `<div class="trade-host">
        <p class="sub">${guest ? "Trading with <strong>" + esc(guest.name) + "</strong>. Design your kandi next." : "Have them scan this, or type the code below."}</p>
        <div class="trade-qr-wrap"><canvas id="trade-qr" width="240" height="240" aria-label="Trade QR code"></canvas></div>
        <div class="trade-code" data-act="trade-copy-code" title="Copy code">${esc(code)}</div>
        <p class="tiny" style="text-align:center">${exp ? esc(exp) + " · " : ""}Tap the code to copy</p>
        ${eventPicker(offer, s)}
        ${guest
          ? `<button type="button" class="btn primary" style="margin-top:16px;width:100%" data-act="trade-goto-design">Design my kandi</button>`
          : `<p class="muted" style="text-align:center;margin-top:16px"><span class="spin"></span> Waiting for them to join…</p>`}
        <button type="button" class="btn ghost" style="margin-top:8px;width:100%" data-act="trade-cancel">Cancel this trade</button>
      </div>`;
    }
    if (step === "join") {
      const err = o.scanError || "";
      return `<div class="trade-join">
        <p class="sub">Point your camera at their code, or type it.</p>
        <div class="trade-scan">
          <video id="trade-scan-video" playsinline muted autoplay></video>
          <canvas id="trade-scan-canvas" hidden></canvas>
          <div class="trade-scan-frame" aria-hidden="true"></div>
        </div>
        <p class="tiny" id="trade-scan-status">${err ? esc(err) : "Camera is only used to read the code."}</p>
        <label class="label" for="trade-code-in">Or type the code</label>
        <div class="row" style="gap:8px;margin-top:8px">
          <input id="trade-code-in" data-field="tradeCode" maxlength="8" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="AB12CD" value="${esc(drafts().tradeCode || "")}" aria-label="Trade code" />
          <button type="button" class="btn primary" data-act="trade-submit-code">Join</button>
        </div>
      </div>`;
    }
    if (step === "design") {
      return designHtml(s, offer);
    }
    if (step === "designs") return designsListHtml(s, o);
    if (step === "editor") return editorHtml(s, o);
    if (step === "waiting") {
      const other = otherName(offer, s);
      return `<div class="trade-wait">
        ${braceletHtml(designFromDraft(), { size: "lg", animate: true })}
        <h2 class="h2" style="margin-top:18px">You're ready</h2>
        <p class="sub">Waiting for ${esc(other)} to finish their kandi…</p>
        <span class="spin" style="margin:18px auto;display:block"></span>
        <button type="button" class="btn ghost" style="margin-top:8px;width:100%" data-act="trade-goto-design">Edit my kandi</button>
        <button type="button" class="btn ghost" style="margin-top:8px;width:100%" data-act="trade-cancel">Cancel</button>
      </div>`;
    }
    if (step === "done") {
      const other = otherName(offer, s);
      const mine = (offer && offer.mine) || designFromDraft();
      const theirs = offer && offer.theirs;
      return `<div class="trade-done">
        <div class="trade-celebrate" aria-hidden="true">${confettiBeads()}</div>
        <h2 class="h2 grad" style="text-align:center">It's a trade!</h2>
        <p class="sub" style="text-align:center">You and ${esc(other)} swapped kandi${offer && offer.event && offer.event.name ? " at " + esc(offer.event.name) : ""}.</p>
        <div class="trade-swap">
          <div><div class="tiny">You gave</div>${braceletHtml(mine, { size: "md", animate: true })}</div>
          <div><div class="tiny">You got</div>${braceletHtml(theirs || mine, { size: "md", animate: true })}</div>
        </div>
        <button type="button" class="btn primary" style="margin-top:20px;width:100%" data-act="trade-goto-you">See your collection</button>
      </div>`;
    }
    return "";
  }

  function confettiBeads() {
    const colors = ["#ff5c00", "#ff8a1a", "#ffc14d", "#b44aff", "#2ef0ff", "#ff3d9a", "#6dff6a"];
    let html = "";
    for (let i = 0; i < 14; i++) {
      html += `<span class="kandi-confetti" style="--bead:${colors[i % colors.length]};--i:${i}"></span>`;
    }
    return html;
  }

  function otherName(offer, s) {
    const me = s.me && Number(s.me.id);
    if (!offer) return "them";
    if (offer.role === "host") return (offer.guest && offer.guest.name) || "them";
    if (offer.role === "guest") return (offer.host && offer.host.name) || "them";
    if (offer.host && Number(offer.host.id) !== me) return offer.host.name;
    if (offer.guest && Number(offer.guest.id) !== me) return offer.guest.name;
    return "them";
  }

  function eventPicker(offer, s) {
    const shows = (offer && offer.todayShows) || s.tradeShows || [];
    const current = offer && offer.event;
    if (!shows.length && !current) {
      return `<p class="tiny" style="margin-top:14px;text-align:center">No show tagged. If you're both going tonight, we'll add it automatically when they join.</p>`;
    }
    let html = `<div class="kandi-event-pick"><div class="label">Show</div>`;
    if (current && current.name && !shows.some((e) => String(e.id) === String(current.id))) {
      html += `<button type="button" class="chip on" data-act="trade-pick-event" data-id="${esc(current.id)}">${esc(current.name)}</button>`;
    }
    shows.forEach((ev) => {
      const on = current && String(current.id) === String(ev.id);
      html += `<button type="button" class="chip${on ? " on" : ""}" data-act="trade-pick-event" data-id="${esc(ev.id)}">${esc(ev.name)}</button>`;
    });
    if (current && current.name) html += `<button type="button" class="chip" data-act="trade-clear-event">No show</button>`;
    html += `</div>`;
    return html;
  }

  function designHtml(s, offer) {
    const other = otherName(offer, s);
    const k = kd();
    return `<div class="trade-design">
      <p class="sub">Pick one of your saved kandi to give ${esc(other)}, or design a new one right now.</p>
      ${stripHtml(s)}
      ${designerHtml()}
      <div id="kd-savebox" class="kd-savebox">${saveBoxInner(k)}</div>
      ${eventPicker(offer, s)}
      <button type="button" class="btn primary" style="margin-top:18px;width:100%" data-act="trade-ready">Ready to trade</button>
    </div>`;
  }

  function setOverlay(step, extra) {
    const s = state();
    const prev = (s.overlay && s.overlay.type === "trade") ? s.overlay : {};
    s.overlay = Object.assign({ type: "trade", step: step || "start" }, prev, extra || {}, { type: "trade", step: step || "start" });
    if (extra && extra.offer) s.tradeOffer = extra.offer;
    render();
  }

  async function loadForProfile(userId) {
    const s = state();
    try {
      const data = await api("/api/trades/collection?userId=" + encodeURIComponent(userId));
      const items = (data && data.items) || [];
      if (s.me && Number(userId) === Number(s.me.id)) s.myKandi = items;
      s.profileKandi = items;
      s.profileKandiUserId = Number(userId);
    } catch (_) {
      if (s.me && Number(userId) === Number(s.me.id)) s.myKandi = s.myKandi || [];
    }
  }

  async function refreshMine() {
    const s = state();
    if (s.me) await loadForProfile(s.me.id);
  }

  function extractCode(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    let m = raw.match(/KANDI-TRADE[:/]?([A-Z0-9]{4,8})/i);
    if (m) return m[1].toUpperCase();
    m = raw.match(/[?&]trade=([A-Z0-9]{4,8})/i);
    if (m) return m[1].toUpperCase();
    m = raw.match(/\/t\/([A-Z0-9]{4,8})/i);
    if (m) return m[1].toUpperCase();
    if (/^[A-Z0-9]{6,8}$/i.test(raw)) return raw.toUpperCase();
    return "";
  }

  async function startHost() {
    const data = await api("/api/trades/offers", { method: "POST", body: {} });
    const s = state();
    s.tradeOffer = data.offer;
    s.tradeShows = (data.offer && data.offer.todayShows) || [];
    await initTradeKd();
    setOverlay("host", { offer: data.offer });
    startPoll();
  }

  function openJoin() {
    drafts().tradeCode = drafts().tradeCode || "";
    setOverlay("join", {});
  }

  async function joinWithCode(code) {
    const c = extractCode(code) || String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) { toast("Enter the 6-character code.", "err"); return; }
    const data = await api("/api/trades/offers/" + encodeURIComponent(c) + "/join", { method: "POST", body: {} });
    const s = state();
    s.tradeOffer = data.offer;
    s.tradeShows = (data.offer && data.offer.todayShows) || [];
    await initTradeKd();
    setOverlay("design", { offer: data.offer });
    startPoll();
  }

  async function submitReady() {
    const s = state();
    const offer = s.tradeOffer;
    if (!offer) return;
    const design = designFromDraft();
    const k = kd();
    const body = { design };
    const modified = isModified(k);
    if (k.selectedId && !modified) body.designId = k.selectedId;
    else if (k.saveOn) body.saveAs = String(k.name || "").trim() || "My kandi";
    const data = await api("/api/trades/offers/" + encodeURIComponent(offer.id) + "/ready", { method: "POST", body });
    s.tradeOffer = data.offer;
    if (data.saved) {
      if (data.saved.error) toast(data.saved.error, "err");
      else if (data.saved.name) toast("Saved to My designs.");
      if (data.saved.id) {
        k.selectedId = data.saved.id;
        k.baseline = designJson(k.design);
        k.saveOn = false;
      }
      loadDesigns();
    }
    if (data.completed) {
      await refreshMine();
      setOverlay("done", { offer: data.offer });
      stopPoll();
      return;
    }
    setOverlay("waiting", { offer: data.offer });
    startPoll();
  }

  async function cancelTrade() {
    const s = state();
    const offer = s.tradeOffer;
    if (offer && offer.id) {
      try { await api("/api/trades/offers/" + encodeURIComponent(offer.id) + "/cancel", { method: "POST", body: {} }); } catch (_) {}
    }
    stopScan();
    stopPoll();
    s.tradeOffer = null;
    s.overlay = null;
    render();
  }

  async function applyOffer(offer, opts) {
    const s = state();
    if (!offer) return;
    if (s.tradeOffer && offer.id && s.tradeOffer.id && offer.id !== s.tradeOffer.id && s.overlay && s.overlay.type === "trade") return;
    s.tradeOffer = Object.assign({}, s.tradeOffer || {}, offer);
    if (offer.todayShows) s.tradeShows = offer.todayShows;
    const o = s.overlay;
    if (!o || o.type !== "trade") return;
    if (offer.status === "cancelled" || offer.status === "expired") {
      stopPoll();
      s.overlay = null;
      s.tradeOffer = null;
      toast(offer.status === "expired" ? "That trade code expired." : "The trade was cancelled.");
      render();
      return;
    }
    if (offer.status === "completed") {
      await refreshMine();
      setOverlay("done", { offer });
      stopPoll();
      return;
    }
    if (o.step === "host" && offer.guest && offer.status === "joined") {
      setOverlay("design", { offer });
      return;
    }
    if (o.step === "waiting" && offer.theirReady && offer.status !== "completed") {
      render();
      return;
    }
    if (o.step === "host") render();
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      const s = state();
      const offer = s.tradeOffer;
      if (!offer || !offer.id) return;
      if (!(s.overlay && s.overlay.type === "trade")) { stopPoll(); return; }
      try {
        const data = await api("/api/trades/offers/" + encodeURIComponent(offer.id));
        if (data && data.offer) await applyOffer(data.offer, { silent: true });
      } catch (_) {}
    }, 2000);
  }

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function drawQr(payload) {
    const canvas = document.getElementById("trade-qr");
    if (!canvas || typeof qrcode !== "function") return;
    if (payload === lastQr && lastOfferId === (state().tradeOffer && state().tradeOffer.id)) return;
    try {
      const qr = qrcode(0, "M");
      qr.addData(payload);
      qr.make();
      const cells = qr.getModuleCount();
      const size = 240;
      const scale = Math.floor(size / (cells + 2));
      const dim = scale * (cells + 2);
      canvas.width = dim;
      canvas.height = dim;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, dim, dim);
      ctx.fillStyle = "#111111";
      for (let r = 0; r < cells; r++) {
        for (let c = 0; c < cells; c++) {
          if (qr.isDark(r, c)) ctx.fillRect((c + 1) * scale, (r + 1) * scale, scale, scale);
        }
      }
      lastQr = payload;
      lastOfferId = state().tradeOffer && state().tradeOffer.id;
    } catch (err) {
      try { console.error("qr", err); } catch (_) {}
    }
  }

  function stopScan() {
    if (scanTimer) { cancelAnimationFrame(scanTimer); scanTimer = null; }
    if (scanStream) {
      scanStream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
      scanStream = null;
    }
  }

  async function startScan() {
    const video = document.getElementById("trade-scan-video");
    if (!video) { stopScan(); return; }
    if (scanStream && video.srcObject === scanStream) {
      loopScan();
      return;
    }
    stopScan();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const el = document.getElementById("trade-scan-status");
      if (el) el.textContent = "Camera isn't available here. Type the code instead.";
      return;
    }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (err) {
      const el = document.getElementById("trade-scan-status");
      if (el) el.textContent = "Camera access was denied. Type the code instead.";
      return;
    }
    const still = document.getElementById("trade-scan-video");
    if (!still) { stopScan(); return; }
    still.srcObject = scanStream;
    try { await still.play(); } catch (_) {}
    loopScan();
  }

  function loopScan() {
    if (scanTimer) cancelAnimationFrame(scanTimer);
    const video = document.getElementById("trade-scan-video");
    const canvas = document.getElementById("trade-scan-canvas");
    if (!video || !canvas || typeof jsQR !== "function") return;
    const tick = () => {
      if (!(state().overlay && state().overlay.type === "trade" && state().overlay.step === "join")) { stopScan(); return; }
      if (video.readyState >= 2 && video.videoWidth) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, w, h);
        try {
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" });
          if (code && code.data) {
            const c = extractCode(code.data);
            if (c) {
              stopScan();
              drafts().tradeCode = c;
              joinWithCode(c).catch((e) => {
                const el = document.getElementById("trade-scan-status");
                if (el) el.textContent = (e && e.message) || "Couldn't join that code.";
                startScan();
              });
              return;
            }
          }
        } catch (_) {}
      }
      scanTimer = requestAnimationFrame(tick);
    };
    scanTimer = requestAnimationFrame(tick);
  }

  function afterRender() {
    const s = state();
    const o = s.overlay;
    if (!(o && o.type === "trade")) {
      stopScan();
      if (!(o && (o.type === "trade" || o.step === "waiting" || o.step === "host"))) {
        /* keep poll only while a live trade is on screen */
      }
      if (!o || o.type !== "trade") stopPoll();
      return;
    }
    if (o.step === "host" && s.tradeOffer) {
      drawQr(s.tradeOffer.qrPayload || ("KANDI-TRADE:" + s.tradeOffer.code));
      startPoll();
    }
    if (o.step === "join") startScan();
    else stopScan();
    if (o.step === "waiting" || o.step === "host" || o.step === "design") startPoll();
    if (o.step === "design" || o.step === "editor") bindDesignerInputs();
  }

  function onMessage(msg) {
    if (!msg || msg.type !== "trade") return false;
    applyOffer(msg.offer, { silent: msg.action !== "joined" && msg.action !== "completed" });
    if (msg.action === "completed") toast("It's a trade!");
    if (msg.action === "joined") { /* applyOffer toasts */ }
    return true;
  }

  async function consumeDeepLink() {
    const qs = new URLSearchParams(location.search);
    const code = extractCode(qs.get("trade") || "") || (location.pathname.match(/^\/t\/([A-Z0-9]+)/i) || [])[1];
    if (!code) return false;
    history.replaceState({}, "", "/");
    const s = state();
    if (!(s.view === "app" && s.me)) {
      s.pendingTradeCode = code;
      return true;
    }
    try {
      await joinWithCode(code);
    } catch (err) {
      toast((err && err.message) || "That trade code isn't active.", "err");
      setOverlay("join", {});
      drafts().tradeCode = code;
      render();
    }
    return true;
  }

  async function handle(act, el, extra, id) {
    if (act === "close" && state().overlay && state().overlay.type === "trade") {
      /* fall through to trade-close only if they intend to leave; let default close run after we cancel open host? Keep open trades cancellable via button. */
    }
    if (act === "report" && state().overlay && state().overlay.type === "tradeItem") {
      const item = state().overlay.item;
      const fromId = item && item.from && item.from.id;
      if (fromId) {
        const back = state().overlay;
        state().overlay = { type: "report", id: Number(fromId), reason: "", returnTo: back };
        render();
        return true;
      }
    }
    if (!act || (act !== "trade-close" && !String(act).startsWith("trade-") && !String(act).startsWith("kd-") && act !== "report")) return false;
    if (act === "report") return false;

    if (act === "trade-open") { setOverlay("start", { offer: null }); return true; }
    if (act === "trade-open-host") { await startHost(); return true; }
    if (act === "trade-open-join") { openJoin(); return true; }
    if (act === "trade-close") {
      const s = state();
      const step = s.overlay && s.overlay.step;
      if (step === "editor") { setOverlay("designs", {}); return true; }
      if (step === "designs") {
        if (s.overlay.from === "start") { setOverlay("start", { offer: null }); return true; }
        s.overlay = null;
        render();
        return true;
      }
      if (step === "host" || step === "join" || step === "design" || step === "waiting") {
        /* leave an open host offer running so the other person can still join if they just close the scanner; cancel only from Cancel */
        if (step === "host" || step === "waiting" || step === "design") stopPoll();
      }
      stopScan();
      if (step === "host") {
        /* keep offer alive briefly — they can reopen from Trade kandi > Show my code would create a new one. Cancel on close of host so codes don't linger. */
        await cancelTrade();
        return true;
      }
      s.overlay = null;
      render();
      return true;
    }
    if (act === "trade-copy-code") {
      const code = state().tradeOffer && state().tradeOffer.code;
      if (!code) return true;
      try { await navigator.clipboard.writeText(code); toast("Copied " + code); } catch (_) { toast(code); }
      return true;
    }
    if (act === "trade-submit-code") {
      await joinWithCode(drafts().tradeCode || "");
      return true;
    }
    if (act === "kd-open") {
      const st = state().overlay;
      await openDesigns(st && st.type === "trade" && st.step === "start" ? "start" : "profile");
      return true;
    }
    if (act === "kd-new") {
      if ((state().kdList || []).length >= MAX_DESIGNS) { toast("You can save up to " + MAX_DESIGNS + " designs. Delete one first.", "err"); return true; }
      openEditor(null);
      return true;
    }
    if (act === "kd-edit") {
      const it = savedById(id);
      if (!it) { toast("That design isn't available.", "err"); return true; }
      openEditor(it);
      return true;
    }
    if (act === "kd-back") { setOverlay("designs", {}); return true; }
    if (act === "kd-del-ask") { state().kdDelAsk = id; render(); return true; }
    if (act === "kd-delete") { await deleteDesign(id); return true; }
    if (act === "kd-dup") { await duplicateDesign(id); return true; }
    if (act === "kd-save") { await saveEditor(); return true; }
    if (act === "kd-save-toggle") {
      const k = kd();
      k.saveOn = !k.saveOn;
      if (k.saveOn && !String(k.name || "").trim()) k.name = String(k.design.word || "").trim() ? (k.design.word.charAt(0) + k.design.word.slice(1).toLowerCase() + " kandi") : "My kandi";
      render();
      return true;
    }
    if (act === "kd-pick") {
      const s = state();
      const it = id ? savedById(id) : null;
      s.kd = it ? newKd(it.design, { selectedId: it.id, name: it.name }) : newKd(defaultDesign());
      render();
      return true;
    }
    if (String(act).startsWith("kd-")) { applyDesignerAct(act, id); return true; }
    if (act === "trade-goto-design") { setOverlay("design"); return true; }
    if (act === "trade-pick-event") {
      const offer = state().tradeOffer;
      if (!offer) return true;
      const data = await api("/api/trades/offers/" + encodeURIComponent(offer.id) + "/event", { method: "POST", body: { eventId: id } });
      state().tradeOffer = data.offer;
      render();
      return true;
    }
    if (act === "trade-clear-event") {
      const offer = state().tradeOffer;
      if (!offer) return true;
      const data = await api("/api/trades/offers/" + encodeURIComponent(offer.id) + "/event", { method: "POST", body: { eventId: "" } });
      state().tradeOffer = data.offer;
      render();
      return true;
    }
    if (act === "trade-ready") { await submitReady(); return true; }
    if (act === "trade-cancel") { await cancelTrade(); return true; }
    if (act === "trade-open-item") {
      let item = (state().myKandi || []).concat(state().profileKandi || []).find((i) => i.id === id);
      let isOwner = (state().myKandi || []).some((i) => i.id === id);
      try {
        const data = await api("/api/trades/items/" + encodeURIComponent(id));
        item = data.item;
        isOwner = data.isOwner;
      } catch (_) {}
      if (!item) { toast("Couldn't open that kandi.", "err"); return true; }
      state().overlayBack = state().overlay && state().overlay.type !== "tradeItem" ? state().overlay : state().overlayBack;
      state().overlay = { type: "tradeItem", id, item, isOwner };
      render();
      return true;
    }
    if (act === "trade-hide") {
      const data = await api("/api/trades/items/" + encodeURIComponent(id) + "/hide", { method: "POST", body: {} });
      const s = state();
      if (s.overlay && s.overlay.type === "tradeItem") s.overlay.item = data.item;
      await refreshMine();
      if (s.profileKandiUserId && s.me && Number(s.profileKandiUserId) === Number(s.me.id)) s.profileKandi = s.myKandi;
      toast(data.item.hidden ? "Hidden from your profile." : "Shown on your profile again.");
      render();
      return true;
    }
    if (act === "trade-goto-you") {
      stopScan();
      stopPoll();
      const s = state();
      s.overlay = null;
      s.tab = "you";
      await refreshMine();
      render();
      setTimeout(() => {
        const el = document.getElementById("kandi-collection");
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      return true;
    }
    return false;
  }

  async function resumePending() {
    const s = state();
    if (s.pendingTradeCode && s.me && s.view === "app") {
      const code = s.pendingTradeCode;
      s.pendingTradeCode = "";
      try { await joinWithCode(code); } catch (err) { toast((err && err.message) || "That trade code isn't active.", "err"); }
    }
  }

  function attach(helpers) {
    api = helpers.api;
    esc = helpers.esc;
    toast = helpers.toast;
    render = helpers.render;
    personAvatar = helpers.personAvatar;
    personName = helpers.personName;
    timeAgo = helpers.timeAgo;
    getState = helpers.getState;
    attached = true;
  }

  window.KandiTrades = {
    attach,
    INSTANT,
    collectionHtml,
    overlayHtml,
    handle,
    afterRender,
    onMessage,
    consumeDeepLink,
    loadForProfile,
    resumePending,
    braceletHtml,
    extractCode,
    STYLES,
  };
})();
