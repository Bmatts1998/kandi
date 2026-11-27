/* Digital kandi trades — loaded before app.js, attached from inside the app IIFE. */
(function () {
  const STYLES = [
    { id: "classic", label: "Classic", beads: ["#ff5c00", "#ff8a1a", "#ffc14d", "#fff7f0", "#ff5c00", "#1a120c", "#ff8a1a"] },
    { id: "glow", label: "Glow", beads: ["#ff5c00", "#ff8a3d", "#ffe14d", "#ff5c00", "#ff3d9a", "#ff8a1a", "#fff3c4"] },
    { id: "rainbow", label: "Rainbow", beads: ["#ff3b3b", "#ff8a1a", "#ffe14d", "#6dff6a", "#2ef0ff", "#4d7cff", "#b44aff"] },
    { id: "uv", label: "Blacklight", beads: ["#111111", "#7a5cff", "#d0b0ff", "#2ef0ff", "#ff5cff", "#111111", "#b44aff"] },
    { id: "sunset", label: "Sunset", beads: ["#ff3d9a", "#ff5c00", "#ff8a1a", "#ffc14d", "#ff7ad9", "#ff3b3b"] },
    { id: "forest", label: "Forest", beads: ["#0c3b28", "#1a6b3c", "#d4ff3f", "#6dff6a", "#0c3b28", "#fff7f0"] },
    { id: "ice", label: "Ice", beads: ["#e8f6ff", "#2ef0ff", "#7ad0ff", "#4d7cff", "#f5f5f7", "#2ef0ff"] },
    { id: "candy", label: "Candy", beads: ["#ff7ad9", "#ff8aa8", "#fff7f0", "#ff5c00", "#ffc14d", "#ff7ad9"] },
    { id: "midnight", label: "Midnight", beads: ["#140816", "#3b0a5c", "#b44aff", "#ff3d9a", "#111111", "#7a5cff"] },
    { id: "pearl", label: "Pearl", beads: ["#fff7f0", "#f0d4b8", "#e8c4a0", "#fff7f0", "#d4b08a", "#fff3e0"] },
    { id: "metallic", label: "Metallic", beads: ["#d4af37", "#c0c0c0", "#ffd56a", "#8a8a8a", "#d4af37", "#fff7f0"] },
  ];
  const PALETTE = ["#ff5c00", "#ff8a1a", "#ffc14d", "#ffe14d", "#fff7f0", "#ff3d9a", "#ff7ad9", "#ff3b3b", "#6dff6a", "#d4ff3f", "#2ef0ff", "#7ad0ff", "#4d7cff", "#b44aff", "#7a5cff", "#111111", "#3b0a5c", "#d4af37", "#c0c0c0"];
  const INSTANT = new Set([
    "trade-open", "trade-open-host", "trade-open-join", "trade-style", "trade-bead-add", "trade-bead-del",
    "trade-pick-event", "trade-open-item", "trade-goto-you", "trade-copy-code", "trade-clear-event",
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

  function designFromDraft() {
    const s = state();
    const d = s.tradeDesign || { style: "classic", beads: styleById("classic").beads.slice(), word: "PLUR", message: "" };
    const word = String(drafts().tradeWord != null ? drafts().tradeWord : (d.word || "")).toUpperCase();
    const message = String(drafts().tradeMessage != null ? drafts().tradeMessage : (d.message || ""));
    return { style: d.style || "classic", beads: (d.beads && d.beads.length ? d.beads : styleById(d.style || "classic").beads).slice(), word, message };
  }

  function setDesign(partial) {
    const s = state();
    const cur = designFromDraft();
    s.tradeDesign = Object.assign({}, cur, partial || {});
    if (partial && partial.word != null) drafts().tradeWord = partial.word;
    if (partial && partial.message != null) drafts().tradeMessage = partial.message;
  }

  function braceletHtml(design, opts) {
    opts = opts || {};
    const d = design || { beads: styleById("classic").beads, word: "", style: "classic" };
    const beads = (d.beads && d.beads.length ? d.beads : styleById(d.style).beads).slice();
    const word = String(d.word || "").toUpperCase();
    const letters = word.split("");
    const cls = "kandi-bracelet" + (d.style ? " style-" + esc(d.style) : "") + (opts.size ? " " + opts.size : "") + (opts.animate ? " assemble" : "");
    const mid = Math.max(0, Math.floor((beads.length - letters.length) / 2));
    const items = [];
    let li = 0;
    for (let i = 0; i < beads.length; i++) {
      if (i >= mid && li < letters.length) {
        items.push(`<span class="kandi-bead letter" style="--bead:${esc(beads[i])}"><i>${esc(letters[li])}</i></span>`);
        li++;
      } else {
        items.push(`<span class="kandi-bead" style="--bead:${esc(beads[i])}"></span>`);
      }
    }
    while (li < letters.length) {
      items.push(`<span class="kandi-bead letter" style="--bead:#fff7f0"><i>${esc(letters[li])}</i></span>`);
      li++;
    }
    const label = opts.caption ? `<span class="kandi-br-cap">${opts.caption}</span>` : "";
    return `<div class="${cls}" role="img" aria-label="${esc((word ? word + " kandi" : "Kandi bracelet") + (opts.caption ? " · " + String(opts.caption).replace(/<[^>]+>/g, "") : ""))}">${items.join("")}</div>${label}`;
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

  function collectionHtml(p, isMe) {
    if (!p) return "";
    const items = collectionFor(p.id);
    const visible = isMe ? items : items.filter((i) => !i.hidden);
    const hiddenCount = isMe ? items.filter((i) => i.hidden).length : 0;
    const shown = visible.filter((i) => isMe || !i.hidden);
    const publicCount = items.filter((i) => !i.hidden).length;
    let html = `<section class="kandi-collection" id="kandi-collection">
      <div class="kandi-col-head">
        <div>
          <div class="label">Kandi collection</div>
          <div class="tiny">${publicCount ? publicCount + (publicCount === 1 ? " trade" : " trades") : (isMe ? "Trade kandi when you meet someone" : "No kandi yet")}</div>
        </div>
        ${isMe ? `<button type="button" class="btn sm primary" data-act="trade-open">Trade kandi</button>` : ""}
      </div>`;
    if (!shown.length) {
      html += isMe
        ? `<p class="muted kandi-empty">When you meet someone at a show, trade a digital kandi. It stays on both of your profiles as a stamp of the night.</p>`
        : `<p class="muted kandi-empty">No kandi in this collection yet.</p>`;
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
    const title = step === "done" ? "It's a trade!" : "Trade kandi";
    return `<div class="overlay top-pad trade-overlay"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="trade-close" aria-label="Close">✕</button><span style="font-weight:600">${esc(title)}</span></div></div>
      <div class="scroll pad">${stepHtml(s, o, offer, step)}</div></div>`;
  }

  function stepHtml(s, o, offer, step) {
    if (step === "start") {
      return `<div class="trade-hero">${braceletHtml({ beads: styleById("classic").beads, word: "PLUR", style: "glow" }, { size: "lg" })}
        <h2 class="h2" style="margin-top:18px">Trade digital kandi</h2>
        <p class="sub">When you meet someone, one of you shows a code and the other scans it. You each design a bracelet, then swap.</p>
        <button type="button" class="btn primary" style="margin-top:20px;width:100%" data-act="trade-open-host">Show my code</button>
        <button type="button" class="btn ghost" style="margin-top:8px;width:100%" data-act="trade-open-join">Scan or enter a code</button>
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
    const d = designFromDraft();
    const other = otherName(offer, s);
    return `<div class="trade-design">
      <p class="sub">Design the kandi you're giving ${esc(other)}.</p>
      <div id="trade-live-br" class="kandi-live">${braceletHtml(d, { size: "lg" })}</div>
      <div class="label" style="margin-top:16px">Style</div>
      <div class="chips kandi-styles">${STYLES.map((st) => `<button type="button" class="chip${d.style === st.id ? " on" : ""}" data-act="trade-style" data-id="${st.id}">${esc(st.label)}</button>`).join("")}</div>
      <div class="label" style="margin-top:14px">Beads</div>
      <div class="kandi-bead-edit">${d.beads.map((c, i) => `<button type="button" class="kandi-bead" style="--bead:${esc(c)}" data-act="trade-bead-del" data-id="${i}" aria-label="Remove bead"></button>`).join("")}</div>
      <div class="kandi-palette">${PALETTE.map((c) => `<button type="button" class="kandi-bead sm" style="--bead:${esc(c)}" data-act="trade-bead-add" data-id="${esc(c)}" aria-label="Add bead"></button>`).join("")}</div>
      <label class="label" for="trade-word">Word</label>
      <input id="trade-word" data-field="tradeWord" maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="PLUR" value="${esc(d.word || "")}" aria-label="Word on your kandi" />
      <label class="label" for="trade-msg">Message <span class="tiny">(optional)</span></label>
      <textarea id="trade-msg" data-field="tradeMessage" maxlength="140" placeholder="A note for them…" aria-label="Optional message">${esc(d.message || "")}</textarea>
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
    drafts().tradeWord = drafts().tradeWord || "PLUR";
    setDesign({ style: "classic", beads: styleById("classic").beads.slice(), word: drafts().tradeWord, message: drafts().tradeMessage || "" });
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
    drafts().tradeWord = drafts().tradeWord || "PLUR";
    setDesign({ style: "classic", beads: styleById("classic").beads.slice(), word: drafts().tradeWord, message: drafts().tradeMessage || "" });
    setOverlay("design", { offer: data.offer });
    startPoll();
  }

  async function submitReady() {
    const s = state();
    const offer = s.tradeOffer;
    if (!offer) return;
    const design = designFromDraft();
    const data = await api("/api/trades/offers/" + encodeURIComponent(offer.id) + "/ready", { method: "POST", body: { design } });
    s.tradeOffer = data.offer;
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
    const live = document.getElementById("trade-live-br");
    if (live) {
      const update = () => { live.innerHTML = braceletHtml(designFromDraft(), { size: "lg" }); };
      const word = document.getElementById("trade-word");
      const msg = document.getElementById("trade-msg");
      if (word && !word._kandiBound) { word._kandiBound = true; word.addEventListener("input", update); }
    }
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
    if (!act || (act !== "trade-close" && !String(act).startsWith("trade-") && act !== "report")) return false;
    if (act === "report") return false;

    if (act === "trade-open") { setOverlay("start", { offer: null }); return true; }
    if (act === "trade-open-host") { await startHost(); return true; }
    if (act === "trade-open-join") { openJoin(); return true; }
    if (act === "trade-close") {
      const s = state();
      const step = s.overlay && s.overlay.step;
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
    if (act === "trade-style") {
      const st = styleById(id);
      setDesign({ style: st.id, beads: st.beads.slice() });
      render();
      return true;
    }
    if (act === "trade-bead-add") {
      const d = designFromDraft();
      if (d.beads.length >= 16) { toast("That's a full cuff.", "err"); return true; }
      d.beads.push(id);
      setDesign({ beads: d.beads, style: d.style });
      render();
      return true;
    }
    if (act === "trade-bead-del") {
      const d = designFromDraft();
      const i = Number(id);
      if (d.beads.length <= 5) { toast("Leave at least 5 beads."); return true; }
      d.beads.splice(i, 1);
      setDesign({ beads: d.beads, style: d.style });
      render();
      return true;
    }
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
