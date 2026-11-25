/* Kandi v1 client */
(function () {
  const DAILY = 8;
  const VIBES = ["house", "techno", "dubstep", "trance", "bass", "drum & bass", "hardstyle", "disco"];
  const LOOKING = [
    { id: "dance", label: "Dance partner" },
    { id: "friends", label: "Friends" },
    { id: "date", label: "Date" },
    { id: "hookup", label: "Hookup" },
  ];
  const SPOTS = ["Left of main stage", "Right of main stage", "Water station", "Merch booth", "Back of the floor", "Totem / meeting flag", "Rideshare / exit"];
  const PROMPT_BANK = [
    { id: "goto", q: "My go-to set is..." },
    { id: "moment", q: "Best festival moment..." },
    { id: "findme", q: "You'll find me..." },
    { id: "kandi", q: "The kandi I'm trading says..." },
    { id: "talk", q: "Let's talk if you also..." },
    { id: "plur", q: "PLUR to me means..." },
    { id: "late", q: "My 3am song is..." },
    { id: "looking", q: "I'm looking for someone who..." },
  ];
  const BEADS = ["#ff5c00", "#ff8a1a", "#ffc14d", "#ff3b00", "#ffb020", "#ff7a4a", "#ffffff", "#ffd4b0"];
  const LOOKING_LABEL = Object.fromEntries(LOOKING.map((x) => [x.id, x.label]));

  const state = {
    view: "boot",
    me: null,
    likesLeft: DAILY,
    tab: "home",
    feedTab: "following",
    homePosts: [],
    topRavers: [],
    profile: null,
    comments: [],
    commentPostId: null,
    heartBurst: null,
    overlay: null,
    feed: [],
    inbound: { locked: true, count: 0, people: [] },
    matches: [],
    events: [],
    eventsUpdatedAt: null,
    eventCategory: "all",
    live: { on: false },
    nearby: [],
    chat: [],
    chatWith: null,
    blocked: [],
    locationShare: null,
    drafts: { user: "", pass: "", name: "", age: "", comment: "", chat: "", promptQ: "", promptA: "", caption: "", postEvent: "", postPreview: "", commentText: "", reportReason: "", editName: "", editBio: "", claimPreview: "" },
    uploadingPhoto: false,
    uploadProgress: null,
    uploadError: "",
    onboardStep: 0,
    filters: { event: "all", genre: "all" },
    billing: "monthly",
    pendingPlan: "plus",
    err: "",
    info: "",
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function formatUpdatedAgo(iso) {
    if (!iso) return "";
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return "";
    const mins = Math.max(0, Math.round(ms / 60000));
    if (mins < 1) return "Updated just now";
    if (mins === 1) return "Updated 1 min ago";
    if (mins < 60) return "Updated " + mins + " min ago";
    const hrs = Math.round(mins / 60);
    if (hrs === 1) return "Updated 1 hr ago";
    if (hrs < 24) return "Updated " + hrs + " hr ago";
    const days = Math.round(hrs / 24);
    return days === 1 ? "Updated 1 day ago" : "Updated " + days + " days ago";
  }
  function eventThumb(e) {
    if (e.imageUrl) return `<img src="${esc(e.imageUrl)}" alt="" width="56" height="56">`;
    return esc(e.emoji || "✺");
  }
  function eventWhen(e) {
    if (e.timeTba) {
      const datePart = String(e.date || "").replace(/\s*·\s*Time TBA/i, "").replace(/\s*·\s*\d.*/, "").trim();
      return (datePart || "Date TBA") + " · Time TBA";
    }
    return e.date || "Date TBA";
  }
  function eventTicketLabel(e) {
    if (!e.ticketUrl) return "Tickets TBA";
    return e.ticketSeller ? "Tickets via " + e.ticketSeller : "Tickets";
  }
  function eventAddressLine(e) {
    const place = e.address || "Address TBA";
    if (e.address && (e.mapsUrl || e.address)) {
      const href = e.mapsUrl || ("https://maps.apple.com/?q=" + encodeURIComponent((e.venue ? e.venue + ", " : "") + e.address));
      return `<a class="event-addr" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(place)}</a>`;
    }
    return `<span class="event-addr tba">Address TBA</span>`;
  }
  function eventTicketLine(e) {
    const label = eventTicketLabel(e);
    if (!e.ticketUrl) return `<span class="event-tix-line tba">${esc(label)}</span>`;
    return `<span class="event-tix-line">${esc(label)}</span>`;
  }
  function eventActions(e) {
    const tix = e.ticketUrl
      ? `<a class="btn sm event-tix" href="${esc(e.ticketUrl)}" target="_blank" rel="noopener noreferrer">Get tickets</a>`
      : "";
    const ics = e.icsUrl
      ? `<a class="btn sm ghost event-cal-btn" href="${esc(e.icsUrl)}">Add to Calendar</a>`
      : "";
    const gcal = e.googleCalendarUrl
      ? `<a class="btn sm ghost event-cal-btn" href="${esc(e.googleCalendarUrl)}" target="_blank" rel="noopener noreferrer">Google Calendar</a>`
      : "";
    return `<div class="event-actions">${tix}${ics}${gcal}</div>`;
  }
  function beads(n, size) {
    n = n || 8;
    return '<div class="beads" aria-hidden="true">' + Array.from({ length: n }, (_, i) =>
      `<span class="bead ${size || ""}" style="color:${BEADS[i % BEADS.length]};background:${BEADS[i % BEADS.length]}"></span>`
    ).join("") + "</div>";
  }
  // ---- network: timeouts, cold-start retries, global loading bar ----
  let inflight = 0;
  let busyTimer = null;
  function netStart() {
    inflight += 1;
    if (!busyTimer) busyTimer = setTimeout(() => { document.body.classList.add("net-busy"); }, 350);
  }
  function netEnd() {
    inflight = Math.max(0, inflight - 1);
    if (!inflight) { clearTimeout(busyTimer); busyTimer = null; document.body.classList.remove("net-busy"); }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function friendlyNetError() {
    const e = new Error(navigator.onLine === false
      ? "You're offline. Reconnect and try again."
      : "Kandi is taking too long to answer. The server may be waking up — try again in a few seconds.");
    e.network = true;
    return e;
  }
  async function api(path, opts) {
    opts = opts || {};
    const method = String(opts.method || "GET").toUpperCase();
    const isForm = typeof FormData !== "undefined" && opts.body instanceof FormData;
    const body = opts.body && typeof opts.body !== "string" && !isForm ? JSON.stringify(opts.body) : opts.body;
    const headers = Object.assign({}, isForm ? {} : { "Content-Type": "application/json" }, opts.headers || {});
    const attempts = method === "GET" ? 3 : 2;
    netStart();
    try {
      for (let i = 0; i < attempts; i++) {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 45000) : null;
        let res;
        try {
          res = await fetch(path, { method, credentials: "include", cache: "no-store", headers, body, signal: ctrl ? ctrl.signal : undefined });
        } catch (err) {
          clearTimeout(timer);
          // Only retry writes when the request never reached the server (offline / DNS / cold start reset).
          if (i < attempts - 1 && (method === "GET" || !(err && err.name === "AbortError"))) { await sleep(1200 * (i + 1)); continue; }
          throw friendlyNetError();
        }
        clearTimeout(timer);
        if ((res.status === 502 || res.status === 503 || res.status === 504) && i < attempts - 1) { await sleep(1500 * (i + 1)); continue; }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = new Error(data.error || (res.status >= 500 ? "Something went wrong on our side. Try again." : res.statusText || "Request failed"));
          err.status = res.status;
          err.data = data;
          if (res.status === 401 && state.view === "app" && !/^\/api\/(login|signup|claim)/.test(path)) {
            state.me = null; state.view = "auth"; state.overlay = null;
            state.err = "Your session ended. Log in again.";
            render();
          }
          throw err;
        }
        return data;
      }
    } finally {
      netEnd();
    }
  }
  let toastTimer = null;
  function toast(msg, kind) {
    if (!msg) return;
    let el = document.getElementById("kandi-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "kandi-toast";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    el.className = "toast show" + (kind ? " " + kind : "");
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = "toast"; }, 4200);
  }

  let ws;
  let wsRetry = 0;
  let wsTimer = null;
  function quiet(promise) {
    return Promise.resolve(promise).then(() => render()).catch(() => {});
  }
  function connectWs() {
    if (!state.me) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    clearTimeout(wsTimer);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    try {
      ws = new WebSocket(proto + "//" + location.host + "/ws");
    } catch (_) {
      ws = null;
      return;
    }
    ws.onopen = () => { wsRetry = 0; };
    ws.onclose = (ev) => {
      ws = null;
      if (!state.me || ev.code === 4001) return;
      wsRetry = Math.min(wsRetry + 1, 6);
      wsTimer = setTimeout(connectWs, 1000 * Math.pow(2, wsRetry - 1));
    };
    ws.onerror = () => { /* onclose handles reconnects */ };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "message" && state.overlay && state.overlay.type === "chat" && state.chatWith && msg.from && Number(msg.from.id) === Number(state.chatWith.id)) {
        if (!state.chat.some((m) => m.id === msg.message.id)) state.chat.push(msg.message);
        render();
        scrollChatToEnd();
      } else if (msg.type === "message") {
        quiet(loadMatches());
        toast("New message" + (msg.from && msg.from.name ? " from " + msg.from.name : ""));
      } else if (msg.type === "match") {
        quiet(Promise.all([loadMatches(), loadFeed()]));
        toast("It's a match" + (msg.user && msg.user.name ? " with " + msg.user.name : "") + "! Check Matches.");
      } else if (msg.type === "like") {
        quiet(loadInbound());
      }
    };
  }
  function scrollChatToEnd() {
    const log = document.querySelector(".chat-log");
    if (log) log.scrollTop = log.scrollHeight;
  }
  // Chat fallback: if the socket is down (Render sleeping, network change), poll the open chat.
  setInterval(() => {
    if (document.hidden || !state.me || !state.overlay || state.overlay.type !== "chat" || !state.chatWith) return;
    if (ws && ws.readyState === 1) return;
    const id = state.chatWith.id;
    api("/api/chats/" + id).then((data) => {
      if (!state.overlay || state.overlay.type !== "chat" || !state.chatWith || state.chatWith.id !== id) return;
      if ((data.messages || []).length !== state.chat.length) { state.chat = data.messages || []; render(); scrollChatToEnd(); }
    }).catch(() => {});
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.me || state.view !== "app") return;
    connectWs();
    quiet(Promise.all([loadInbound(), loadMatches()]));
  });

  async function boot() {
    const claimToken = (function () {
      const path = location.pathname || "";
      const m = path.match(/^\/claim\/([^/]+)\/?$/);
      if (m) return decodeURIComponent(m[1]);
      const q = new URLSearchParams(location.search).get("claim");
      if (q) return q;
      const h = (location.hash || "").replace(/^#/, "");
      if (h.startsWith("claim=")) return h.slice(6);
      return "";
    })();
    if (claimToken) {
      state.claimToken = claimToken;
      state.drafts.claimPass = "";
      state.drafts.claimAge = "";
      try {
        const info = await api("/api/claim/" + encodeURIComponent(claimToken));
        state.claim = info;
        state.view = "claim";
      } catch (e) {
        state.err = e.message || "That setup link is invalid or expired.";
        state.view = "auth";
      }
      render();
      return;
    }
    let me;
    try {
      me = await api("/api/me");
    } catch (e) {
      state.view = e && e.status === 401 ? "auth" : "offline";
      state.err = state.view === "offline" ? (e.message || "Can't reach Kandi right now.") : "";
      render();
      return;
    }
    applyMe(me);
    state.view = needsOnboard(state.me) ? "onboard" : "app";
    connectWs();
    render();
    await refreshAll();
    if (state.me) render();
  }
  function applyMe(data) {
    state.me = data.user;
    state.likesLeft = data.likesLeft == null ? null : data.likesLeft;
    if (data.live) state.live = data.live;
    if (data.locationShare !== undefined) state.locationShare = data.locationShare;
  }
  function needsOnboard(u) {
    return !u || !u.age || u.needsProfile || !u.vibes.length || !u.looking.length || !u.prompts.length;
  }
  function isPlus() { return state.me && (state.me.subscription === "plus" || state.me.subscription === "vip"); }
  function isVip() { return state.me && state.me.subscription === "vip"; }
  function isIosSafari() {
    const ua = navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean(navigator.standalone);
    return iOS && !standalone && !localStorage.getItem("kandi-hide-ios-tip");
  }
  function iosTip() {
    if (!isIosSafari()) return "";
    return `<div class="ios-tip"><strong>Add Kandi to your Home Screen</strong>
      <p>In Safari, tap the Share button (the square with the arrow), then <strong>Add to Home Screen</strong>. Kandi opens like a real app, with its own icon and a black splash.</p>
      <div class="row"><button class="btn sm primary" data-act="dismiss-ios-tip">Got it</button></div></div>`;
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h";
    const days = Math.round(hrs / 24);
    if (days < 7) return days + "d";
    return days + "d";
  }
  function mediaUrl(url) {
    if (!url || String(url).startsWith("blob:") || String(url).startsWith("data:")) return url;
    if (/[?&]o=1(?:&|$)/.test(url)) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "o=1";
  }
  function avatarEl(av, cls, emojiFallback) {
    cls = cls || "av";
    if (av && av.type === "file" && av.url) return `<span class="${cls}" style="background-image:url('${esc(mediaUrl(av.url))}')"></span>`;
    const g = (av && av.gradient) || "linear-gradient(160deg,#111,#ff5c00)";
    const e = (av && av.emoji) || emojiFallback || "●";
    return `<span class="${cls}" style="background:${g}">${esc(e)}</span>`;
  }
  function hasRealPhoto(photos) {
    return (photos || []).some((ph) => ph && ph.type === "file" && ph.url);
  }
  function initialOf(p) {
    const name = (p && (p.name || p.username)) || "?";
    return (String(name).trim().charAt(0) || "?").toUpperCase();
  }
  function mainPhotoOf(p) {
    if (p && p.avatar) return p.avatar;
    const photos = (p && p.photos) || [];
    return photos[0] || null;
  }
  function personAvatar(p, cls) {
    return avatarEl(mainPhotoOf(p), cls || "av", initialOf(p));
  }
  function photoThumbStyle(ph) {
    if (ph && ph.type === "file" && ph.url) return `background-image:url('${esc(mediaUrl(ph.url))}')`;
    return `background:${esc((ph && ph.gradient) || "#1a1a1a")}`;
  }
  function uploadBusy() {
    if (!state.uploadingPhoto) {
      return state.uploadError ? `<div class="err upload-err" role="alert">${esc(state.uploadError)}</div>` : "";
    }
    const pct = state.uploadProgress == null ? "" : " " + state.uploadProgress + "%";
    return `<div class="upload-busy"><span class="spin"></span>Uploading photo${pct}…</div>`;
  }
  function setUploadProgress(pct) {
    state.uploadProgress = pct;
    const node = document.querySelector(".upload-busy");
    if (node) node.innerHTML = `<span class="spin"></span>Uploading photo${pct == null ? "" : " " + pct + "%"}…`;
  }
  let fileInputSeq = 0;
  function hiddenFileInput(kind, label) {
    const id = "kandi-file-" + kind + "-" + (++fileInputSeq);
    const input = `<input id="${id}" class="file-sr" type="file" accept="image/*" data-act-file="${kind}" ${state.uploadingPhoto ? "disabled" : ""} aria-label="${esc(label)}" />`;
    return { id, input };
  }
  function profileAvatarEditor(p) {
    const file = hiddenFileInput("upload-photo-main", "Set or change your main profile photo");
    return `${file.input}<label class="prof-avatar-wrap" for="${file.id}" title="Change your main photo">
      ${personAvatar(p, "av prof-av")}
      <span class="cam-badge" aria-hidden="true">📷</span>
    </label>`;
  }
  function photoEditor(photos) {
    const list = photos || [];
    const empty = Math.max(0, 6 - list.length);
    let slots = list.map((ph, i) => {
      const inner = (ph.type === "file" && ph.url) ? "" : `<span style="font-size:36px;display:grid;place-items:center;height:100%">${esc(ph.emoji || initialOf(state.me))}</span>`;
      return `<div class="photo-slot${i === 0 ? " main" : ""}" style="${photoThumbStyle(ph)}" draggable="true" data-drag-i="${i}">
        ${i === 0 ? `<span class="main-tag">Main</span>` : ""}
        ${inner}
        <button class="slot-x" type="button" data-act="del-photo" data-i="${i}" aria-label="Remove photo">×</button>
        <div class="slot-tools">
          ${i > 0 ? `<button type="button" data-act="photo-left" data-i="${i}" aria-label="Move left">‹</button>` : ""}
          ${i < list.length - 1 ? `<button type="button" data-act="photo-right" data-i="${i}" aria-label="Move right">›</button>` : ""}
          ${i > 0 ? `<button type="button" data-act="photo-main" data-i="${i}">Set as main</button>` : ""}
        </div>
      </div>`;
    }).join("");
    const addFile = hiddenFileInput("upload-photo", "Add a profile photo");
    for (let i = 0; i < empty; i++) {
      slots += `<label class="photo-slot add" for="${addFile.id}"><span>+</span></label>`;
    }
    return `<div class="photo-editor">
      ${addFile.input}
      <div class="photo-grid">${slots}</div>
      <p class="photo-hint">${list.length}/6 photos. Tap the camera or a + square to add one. On iPhone this offers Take Photo or Photo Library. Any size or format is fine — we'll shrink it automatically.</p>
      ${uploadBusy()}
    </div>`;
  }
  function u16(buf, i, le) {
    return le ? (buf[i] | (buf[i + 1] << 8)) : ((buf[i] << 8) | buf[i + 1]);
  }
  function u32(buf, i, le) {
    return le ? (buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24)) >>> 0
      : ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
  }
  function ascii(buf, i, n) {
    return String.fromCharCode.apply(null, buf.subarray(i, i + n));
  }
  function readExifOrientation(buf, offset, length) {
    if (offset + 8 > buf.length) return 1;
    if (ascii(buf, offset, 4) !== "Exif") return 1;
    const tiff = offset + 6;
    const le = ascii(buf, tiff, 2) === "II";
    if (!le && ascii(buf, tiff, 2) !== "MM") return 1;
    let dir = tiff + u32(buf, tiff + 4, le);
    if (dir + 2 > buf.length) return 1;
    const entries = u16(buf, dir, le);
    dir += 2;
    for (let i = 0; i < entries; i++) {
      const pos = dir + i * 12;
      if (pos + 12 > buf.length) break;
      if (u16(buf, pos, le) === 0x0112) return u16(buf, pos + 8, le) || 1;
    }
    return 1;
  }
  function probeImage(buf) {
    if (!buf || buf.length < 16) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      let orientation = 1;
      while (i + 8 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        if (marker === 0xda) break;
        const len = (buf[i + 2] << 8) | buf[i + 3];
        if (marker === 0xe1 && i + 4 + 6 < buf.length) {
          try { orientation = readExifOrientation(buf, i + 4, len - 2) || 1; } catch (_) {}
        }
        if ((marker >= 0xc0 && marker <= 0xc3) || marker === 0xc5 || marker === 0xc6 || marker === 0xc7 || marker === 0xc9 || marker === 0xca || marker === 0xcb) {
          const height = (buf[i + 5] << 8) | buf[i + 6];
          const width = (buf[i + 7] << 8) | buf[i + 8];
          return { width, height, orientation };
        }
        if (len < 2) break;
        i += 2 + len;
      }
      return null;
    }
    if (buf[0] === 0x89 && ascii(buf, 1, 3) === "PNG" && buf.length >= 24) {
      return { width: u32(buf, 16, false), height: u32(buf, 20, false), orientation: 1 };
    }
    if (ascii(buf, 0, 3) === "GIF" && buf.length >= 10) {
      return { width: u16(buf, 6, true), height: u16(buf, 8, true), orientation: 1 };
    }
    if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WEBP" && buf.length >= 30) {
      if (ascii(buf, 12, 4) === "VP8X") return { width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1, height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1, orientation: 1 };
      if (ascii(buf, 12, 4) === "VP8L") {
        const n = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24);
        return { width: (n & 0x3fff) + 1, height: ((n >> 14) & 0x3fff) + 1, orientation: 1 };
      }
      if (ascii(buf, 12, 4) === "VP8 " && buf.length >= 30) return { width: u16(buf, 26, true) & 0x3fff, height: u16(buf, 28, true) & 0x3fff, orientation: 1 };
    }
    if (ascii(buf, 4, 4) === "ftyp") {
      const end = Math.min(buf.length, 262144);
      for (let i = 8; i + 16 < end; i++) {
        if (ascii(buf, i, 4) !== "ispe") continue;
        const width = u32(buf, i + 8, false);
        const height = u32(buf, i + 12, false);
        if (width > 0 && width < 200000 && height > 0 && height < 200000) return { width, height, orientation: 1 };
      }
    }
    return null;
  }
  function sizeCanvas(orient, srcW, srcH, maxDim) {
    const swap = orient >= 5 && orient <= 8;
    const dispW = swap ? srcH : srcW;
    const dispH = swap ? srcW : srcH;
    const scale = Math.min(1, maxDim / Math.max(dispW, dispH));
    return { width: Math.max(1, Math.round(dispW * scale)), height: Math.max(1, Math.round(dispH * scale)), scale, swap };
  }
  function drawOriented(ctx, img, orient, dw, dh) {
    switch (orient) {
      case 2: ctx.translate(dw, 0); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, dw, dh); break;
      case 3: ctx.translate(dw, dh); ctx.rotate(Math.PI); ctx.drawImage(img, 0, 0, dw, dh); break;
      case 4: ctx.translate(0, dh); ctx.scale(1, -1); ctx.drawImage(img, 0, 0, dw, dh); break;
      case 5: ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); ctx.drawImage(img, 0, 0, dh, dw); break;
      case 6: ctx.translate(dw, 0); ctx.rotate(0.5 * Math.PI); ctx.drawImage(img, 0, 0, dh, dw); break;
      case 7: ctx.translate(dw, dh); ctx.rotate(0.5 * Math.PI); ctx.scale(1, -1); ctx.drawImage(img, 0, 0, dh, dw); break;
      case 8: ctx.translate(0, dh); ctx.rotate(-0.5 * Math.PI); ctx.drawImage(img, 0, 0, dh, dw); break;
      default: ctx.drawImage(img, 0, 0, dw, dh);
    }
  }
  async function blobFromCanvas(canvas, quality) {
    if (canvas.toBlob) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob) return blob;
    }
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const bin = atob(dataUrl.split(",")[1] || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  }
  async function encodeJpegLoop(canvas) {
    const maxBytes = Math.round(1.5 * 1024 * 1024);
    const qualities = [0.86, 0.8, 0.74, 0.68, 0.6, 0.52];
    let last = null;
    for (const q of qualities) {
      last = await blobFromCanvas(canvas, q);
      if (last && last.size <= maxBytes) return last;
    }
    return last;
  }
  function scaleCanvas(src, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
    if (scale >= 1) return src;
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(src.width * scale));
    next.height = Math.max(1, Math.round(src.height * scale));
    next.getContext("2d").drawImage(src, 0, 0, next.width, next.height);
    return next;
  }
  async function decodeToCanvas(file, maxDim) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const probed = probeImage(buf);
    const pixels = probed ? probed.width * probed.height : 0;
    const huge = pixels > 16 * 1000 * 1000 || file.size > 8 * 1024 * 1024;
    if (typeof createImageBitmap === "function") {
      const opts = { imageOrientation: "from-image", resizeQuality: "medium" };
      if (probed && probed.width && probed.height) {
        if (probed.width >= probed.height) opts.resizeWidth = Math.max(1, Math.min(probed.width, maxDim));
        else opts.resizeHeight = Math.max(1, Math.min(probed.height, maxDim));
      } else {
        opts.resizeWidth = maxDim;
      }
      try {
        const bmp = await createImageBitmap(file, opts);
        const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bmp.width * scale));
        canvas.height = Math.max(1, Math.round(bmp.height * scale));
        canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
        if (bmp.close) try { bmp.close(); } catch (_) {}
        return canvas;
      } catch (_) { /* fall through */ }
      if (!huge) {
        try {
          const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
          let canvas = document.createElement("canvas");
          const sized = sizeCanvas(1, bmp.width, bmp.height, maxDim);
          canvas.width = sized.width;
          canvas.height = sized.height;
          canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
          if (bmp.close) try { bmp.close(); } catch (_) {}
          return canvas;
        } catch (_) { /* fall through */ }
      }
    }
    if (huge) return null;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode"));
        el.src = url;
      });
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      let orient = 1;
      if (probed && probed.orientation >= 5 && probed.orientation <= 8 && nw === probed.width && nh === probed.height) {
        orient = probed.orientation;
      }
      const canvas = document.createElement("canvas");
      if (orient >= 5 && orient <= 8) {
        const scale = Math.min(1, maxDim / Math.max(nh, nw));
        canvas.width = Math.max(1, Math.round(nh * scale));
        canvas.height = Math.max(1, Math.round(nw * scale));
      } else {
        const scale = Math.min(1, maxDim / Math.max(nw, nh));
        canvas.width = Math.max(1, Math.round(nw * scale));
        canvas.height = Math.max(1, Math.round(nh * scale));
      }
      const ctx = canvas.getContext("2d");
      if (orient > 1) drawOriented(ctx, img, orient, canvas.width, canvas.height);
      else ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    } catch (_) {
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function compressImage(file) {
    if (!file) throw new Error("Choose a photo to upload.");
    const edges = [1600, 1080, 960];
    let canvas = await decodeToCanvas(file, edges[0]);
    if (!canvas) return null;
    for (let i = 0; i < edges.length; i++) {
      if (Math.max(canvas.width, canvas.height) > edges[i]) canvas = scaleCanvas(canvas, edges[i]);
      const blob = await encodeJpegLoop(canvas);
      if (blob && blob.size <= Math.round(1.5 * 1024 * 1024)) {
        return new File([blob], "photo.jpg", { type: "image/jpeg" });
      }
      if (i === edges.length - 1 && blob) return new File([blob], "photo.jpg", { type: "image/jpeg" });
    }
    return null;
  }
  function postPhoto(file, asMain) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/me/photo");
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch (_) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else if (xhr.status === 401) reject(new Error("You're signed out. Fully close the app, log in again, and then add the photo."));
        else reject(new Error(data.error || "Couldn't upload that photo. Try another one from your library."));
      };
      xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
      const fd = new FormData();
      fd.append("photo", file);
      if (asMain) fd.append("main", "1");
      xhr.send(fd);
    });
  }
  async function uploadProfilePhoto(file, asMain) {
    if (state.uploadingPhoto) return;
    const existing = (state.me && state.me.photos) || [];
    if (existing.length >= 6) {
      state.uploadError = "You can add up to 6 photos. Remove one to add another.";
      render();
      return;
    }
    state.uploadingPhoto = true;
    state.uploadProgress = 0;
    state.uploadError = "";
    render();
    try {
      let ready = null;
      try { ready = await compressImage(file); } catch (_) { ready = null; }
      const data = await postPhoto(ready || file, asMain);
      if (!data.user) throw new Error("Upload failed");
      state.me = data.user;
    } catch (err) {
      state.uploadError = err.message || "Couldn't add that photo. Try another one from your library, or take a new photo.";
      if (typeof toast === "function") toast(state.uploadError, "err");
    } finally {
      state.uploadingPhoto = false;
      state.uploadProgress = null;
      render();
    }
  }
  async function refreshAll() {
    const results = await Promise.allSettled([loadHome(), loadFeed(), loadInbound(), loadMatches(), loadEvents(), loadBlocks()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed && state.me) toast((failed.reason && failed.reason.message) || "Some things didn't load. Pull down or switch tabs to retry.", "warn");
  }
  async function loadHome() {
    const tab = state.feedTab === "popular" ? "popular" : "following";
    const [feed, top] = await Promise.all([
      api("/api/feed/" + tab),
      tab === "popular" ? api("/api/feed/top-ravers") : Promise.resolve({ people: state.topRavers || [] }),
    ]);
    state.homePosts = feed.posts || [];
    if (tab === "popular") state.topRavers = top.people || [];
  }
  async function loadProfile(userId) {
    const data = await api("/api/users/" + userId);
    state.profile = data;
  }
  async function loadFeed() {
    const q = new URLSearchParams();
    if (isPlus()) {
      if (state.filters.genre !== "all") q.set("genre", state.filters.genre);
      if (state.filters.event !== "all") q.set("event", state.filters.event);
    }
    const data = await api("/api/discover?" + q.toString());
    state.feed = data.people;
    if (data.likesLeft != null) state.likesLeft = data.likesLeft;
  }
  async function loadInbound() {
    state.inbound = await api("/api/likes-received");
  }
  async function loadMatches() {
    const data = await api("/api/matches");
    state.matches = data.matches;
  }
  async function loadEvents() {
    const data = await api("/api/events");
    state.events = data.events || [];
    state.eventsUpdatedAt = data.updatedAt || null;
  }
  async function loadEventPosts(id) {
    try {
      const data = await api("/api/events/" + encodeURIComponent(id) + "/posts");
      state.eventPosts = { id, posts: data.posts || [] };
    } catch (_) {
      state.eventPosts = { id, posts: [] };
    }
  }
  async function loadBlocks() {
    const data = await api("/api/blocks");
    state.blocked = data.blocked;
  }

  function header(title, right) {
    return `<div class="header"><div class="left">${beads(5, "sm")}<span class="wordmark grad" style="font-size:15px">${esc(title || "Kandi")}</span></div><div class="right">${right || ""}</div></div>`;
  }
  function tabbar() {
    const items = [
      ["home", "⌂", "Home"],
      ["discover", "✦", "Discover"],
      ["likes", "♡", "Likes"],
      ["events", "✺", "Events"],
      ["matches", "✉", "Matches"],
      ["you", "●", "You"],
    ];
    return `<nav class="tabbar" aria-label="Main">${items.map((t) => {
      const on = state.tab === t[0];
      let badge = "";
      if (t[0] === "likes" && state.inbound.count) badge = `<span class="badge">${state.inbound.count}</span>`;
      if (t[0] === "matches" && state.matches.length) badge = `<span class="badge">${state.matches.length}</span>`;
      return `<button class="tab${on ? " on" : ""}" data-act="tab" data-id="${t[0]}" aria-label="${t[2]}"${on ? ' aria-current="page"' : ""}><span class="ic" aria-hidden="true">${t[1]}</span>${t[2]}${badge}</button>`;
    }).join("")}</nav>`;
  }

  function photoEl(p, i, showWho) {
    const ph = (p.photos || [])[i] || (p.photos || [])[0];
    if (!ph) return "";
    const liked = false;
    const caption = ph.caption || "";
    if (ph.type === "file" && ph.url) {
      return `<div class="photo file" style="background-image:url('${esc(mediaUrl(ph.url))}')">${showWho ? `<div class="who"><div class="nm">${esc(p.name)}, ${p.age}</div></div>` : ""}
        ${caption ? `<div class="caption">${esc(caption)}</div>` : ""}
        <button class="heart-fab" data-act="want-like" data-id="${p.id}" data-type="photo" data-target="${i}" aria-label="Like this photo">♡</button></div>`;
    }
    return `<div class="photo" style="background:${esc(ph.gradient || "#111111")}"><div class="grain"></div>
      ${showWho ? `<div class="who"><div class="nm">${esc(p.name)}, ${p.age}</div></div>` : ""}
      <div class="emoji">${ph.emoji || "💫"}</div>
      ${caption ? `<div class="caption">${esc(caption)}</div>` : ""}
      <button class="heart-fab${liked ? " loved" : ""}" data-act="want-like" data-id="${p.id}" data-type="photo" data-target="${i}" aria-label="Like this photo">♡</button></div>`;
  }
  function promptEl(p, pr) {
    return `<div class="prompt"><div class="q">${esc(pr.q)}</div><div class="a">${esc(pr.a)}</div>
      <button class="heart-fab" data-act="want-like" data-id="${p.id}" data-type="prompt" data-target="${esc(pr.id)}" aria-label="Like this prompt">♡</button></div>`;
  }

  function viewClaim() {
    const c = state.claim || {};
    return `<div class="screen splash top-pad"><div class="inner auth-card claim-card">
      ${beads(8, "lg")}
      <h1 class="wordmark grad">Kandi</h1>
      <h2 class="h2" style="margin-top:18px">Set up your profile</h2>
      <p class="sub">${c.name ? "Welcome, " + esc(c.name) + ". " : ""}Choose a password and enter your age. Kandi is 18+ only — we didn't guess your age.</p>
      ${c.username ? `<p class="muted" style="margin-top:8px">Username: @${esc(c.username)}</p>` : ""}
      <input data-field="claimPass" type="password" aria-label="New password" placeholder="Password (8+ characters)" value="${esc(state.drafts.claimPass || "")}" style="margin-top:16px" autocomplete="new-password" />
      <input data-field="claimAge" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="Your age" placeholder="Your age (18+)" value="${esc(state.drafts.claimAge || "")}" style="margin-top:8px" />
      <label class="card photo-upload" style="display:block;margin-top:12px;text-align:center;padding:18px">
        ${state.drafts.claimPreview
          ? `<div class="photo-slot main" style="margin:0 auto 8px;width:96px;background-image:url('${esc(state.drafts.claimPreview)}')"></div><div class="tiny">Photo ready — we'll add it after you save</div>`
          : `<div>📷 Add a profile photo</div><p class="tiny" style="margin-top:6px">Optional, but people recognize you faster with a photo. You can also add one in the next steps.</p>`}
        <input type="file" accept="image/*" data-act-file="claim-photo" />
      </label>
      ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
      <button class="btn primary" data-act="claim-finish" style="margin-top:16px">Save and enter Kandi</button>
    </div></div>`;
  }

  function viewAuth() {
    const mode = state.overlay && state.overlay.type === "signup" ? "signup" : "login";
    return `<div class="screen splash top-pad"><div class="inner auth-card">
      ${beads(8, "lg")}
      <h1 class="wordmark grad">Kandi</h1>
      <p>Find your people on the floor. Trade kandi, meet ravers, stay PLUR.</p>
      <div class="demo-tag">18+ only · installable web app</div>
      ${mode === "signup" ? `
        <input id="f-name" data-field="name" aria-label="Name" autocomplete="given-name" placeholder="Name" value="${esc(state.drafts.name)}" style="margin-top:24px" />
        <input id="f-age" data-field="age" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" aria-label="Age" placeholder="Age (18+)" value="${esc(state.drafts.age)}" style="margin-top:8px" />
        <input id="f-user" data-field="user" aria-label="Username" placeholder="Username" value="${esc(state.drafts.user)}" style="margin-top:8px" autocapitalize="none" autocomplete="username" autocorrect="off" spellcheck="false" inputmode="text" />
        <input id="f-pass" data-field="pass" type="password" aria-label="Password" autocomplete="new-password" placeholder="Password (8+ characters)" value="${esc(state.drafts.pass)}" style="margin-top:8px" />
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        <button class="btn primary" data-act="signup" style="margin-top:16px">Create account</button>
        <button class="btn ghost" data-act="show-login" style="margin-top:8px">I already have an account</button>
        <p class="tiny" style="margin-top:16px"><a href="/privacy" style="color:var(--muted)">Privacy</a> · <a href="/terms" style="color:var(--muted)">Terms</a> · 18+ only</p>
      ` : `
        <input id="f-user" data-field="user" aria-label="Username" placeholder="Username" value="${esc(state.drafts.user)}" style="margin-top:24px" autocapitalize="none" autocomplete="username" autocorrect="off" spellcheck="false" inputmode="text" />
        <input id="f-pass" data-field="pass" type="password" aria-label="Password" autocomplete="current-password" placeholder="Password" value="${esc(state.drafts.pass)}" style="margin-top:8px" />
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        ${state.info ? `<div class="notice ok" style="margin-top:10px">${esc(state.info)}</div>` : ""}
        <button class="btn primary" data-act="login" style="margin-top:16px">Log in</button>
        <button class="btn ghost" data-act="show-signup" style="margin-top:8px">Create an account</button>
        <p class="tiny" style="margin-top:16px">Demo ravers (example profiles): nova, hex, luna, riot, vesper, sol, ember, pixel, jade, orion — password <strong>plur-demo</strong></p>
        <p class="tiny" style="margin-top:10px"><a href="/privacy" style="color:var(--muted)">Privacy</a> · <a href="/terms" style="color:var(--muted)">Terms</a> · 18+ only</p>
        ${iosTip()}
      `}
    </div></div>`;
  }

  function viewOnboard() {
    const s = state.onboardStep;
    const me = state.me || { vibes: [], looking: [], events: [], prompts: [], photos: [] };
    const titles = ["What's your sound?", "What are you open to?", "Where might you be?", "Add a prompt", "Add a photo", "PLUR, always."];
    let body = "";
    if (s === 0) {
      body = `<div class="label">Your vibes</div><div class="chips">${VIBES.map((v) =>
        `<button class="chip${me.vibes.includes(v) ? " on" : ""}" data-act="toggle-vibe" data-id="${v}">${esc(v)}</button>`
      ).join("")}</div>`;
    } else if (s === 1) {
      body = `<div class="label">Looking for</div><div class="chips">${LOOKING.map((v) =>
        `<button class="chip${me.looking.includes(v.id) ? " on" : ""}" data-act="toggle-look" data-id="${v.id}">${esc(v.label)}</button>`
      ).join("")}</div><p class="sub">Be honest — consent starts here.</p>`;
    } else if (s === 2) {
      body = `<div class="label">Upcoming events</div><p class="sub" style="margin-bottom:8px">Real SLC raves and concerts. Mark the ones you might hit.</p><div class="chips">${(state.events.length ? state.events.slice(0, 24) : []).map((e) =>
        `<button class="chip${me.events.includes(e.id) ? " on" : ""}" data-act="toggle-event" data-id="${e.id}">${e.emoji} ${esc(e.name)}</button>`
      ).join("") || "Loading events…"}</div>`;
    } else if (s === 3) {
      body = `<p class="sub" style="margin-bottom:12px">People can like a specific prompt, Hinge-style.</p>`;
      (me.prompts || []).forEach((pr, i) => {
        body += `<div class="prompt" style="padding-bottom:20px;margin-bottom:10px"><div class="q">${esc(pr.q)}</div><div class="a" style="font-size:18px">${esc(pr.a)}</div>
          <button class="tiny" style="margin-top:8px;color:var(--orange)" data-act="del-prompt" data-i="${i}">Remove</button></div>`;
      });
      if ((me.prompts || []).length < 3) {
        body += `<div class="chips">${PROMPT_BANK.filter((q) => !(me.prompts || []).some((x) => x.id === q.id)).map((q) =>
          `<button class="chip${state.drafts.promptQ === q.id ? " on" : ""}" data-act="pick-prompt" data-id="${q.id}">${esc(q.q)}</button>`
        ).join("")}</div>`;
        if (state.drafts.promptQ) {
          body += `<textarea data-field="promptA" placeholder="Your answer..." style="margin-top:12px">${esc(state.drafts.promptA)}</textarea>
            <button class="btn sm primary" style="margin-top:10px" data-act="add-prompt">Add this prompt</button>`;
        }
      }
    } else if (s === 4) {
      const hasPhoto = hasRealPhoto(me.photos);
      body = `<p class="sub">${hasPhoto ? "Looking good. You can add up to 6 photos, set a main, or rearrange them." : "Add a photo so people can recognize you on the floor. Take one or pick from your library. You can skip and add one later, but profiles with photos get more likes."}</p>
        <div style="display:flex;justify-content:center;margin:16px 0 8px">${profileAvatarEditor(me)}</div>
        ${photoEditor(me.photos)}`;
    } else {
      body = `<div class="notice warn"><strong>PLUR, always.</strong> Ask before you touch, wait for a yes, and look out for each other. Dates and hookups are fine — pressure is not.</div>
        <p class="sub">You can share a meetup note with a friend at a show, and you can report or block anyone at any time.</p>`;
    }
    const can = (s === 0 && me.vibes.length) || (s === 1 && me.looking.length) || s === 2 || (s === 3 && me.prompts.length >= 1) || s === 4 || s === 5;
    return `<div class="screen top-pad"><div class="scroll pad">${beads(6, "sm")}
      <div class="wordmark grad" style="font-size:12px;margin:10px 0 18px;text-align:center">Kandi</div>
      <h2 class="h2">${titles[s]}</h2>${body}</div>
      <div style="padding:10px 18px calc(16px + var(--safe-b))">
        <button class="btn primary" data-act="onboard-next" ${can ? "" : "disabled"}>${s === 5 ? "Enter Kandi" : "Continue"}</button>
        ${s > 0 ? `<button class="btn ghost" data-act="onboard-back" style="margin-top:8px">Back</button>` : ""}
      </div></div>`;
  }

  function viewDiscover() {
    const right = `<span class="pill">${isPlus() ? "Unlimited likes" : (state.likesLeft + " likes left")}</span>
      <button class="icon-btn" data-act="filters" title="Filters" aria-label="Filters">✺</button>`;
    const p = state.feed[0];
    if (!p) {
      return header("Kandi", right) + `<div class="scroll pad"><div class="empty"><p>You're caught up for now. Check back when more ravers join, or rewind a pass.</p>
        <button class="btn sm primary" style="margin-top:16px" data-act="rewind">Rewind last pass</button></div></div>`;
    }
    const parts = [];
    parts.push(photoEl(p, 0, true));
    if (p.prompts[0]) parts.push(promptEl(p, p.prompts[0]));
    if (p.photos[1]) parts.push(photoEl(p, 1, false));
    if (p.prompts[1]) parts.push(promptEl(p, p.prompts[1]));
    if (p.prompts[2]) parts.push(promptEl(p, p.prompts[2]));
    parts.push(`<div class="meta-card"><div class="chips" style="margin-bottom:8px">${p.vibes.map((v) => `<span class="chip soft">${esc(v)}</span>`).join("")}</div>
      <div class="muted">Looking for ${p.looking.map((id) => LOOKING_LABEL[id] || id).join(", ")}</div>
      <div class="tiny" style="margin-top:10px">${p.isDemo ? "Example / demo profile" : "Member on Kandi"}</div></div>`);
    return header("Kandi", right) + `<div class="scroll"><div class="stack" style="padding-top:4px">${parts.join("")}</div>
      <div class="float-actions">
        <button class="round rewind" data-act="rewind" aria-label="Rewind last pass">↺</button>
        <button class="round pass" data-act="pass" data-id="${p.id}" aria-label="Pass on ${esc(p.name)}">✕</button>
        <button class="round like" data-act="want-like" data-id="${p.id}" data-type="photo" data-target="0" aria-label="Like ${esc(p.name)}">♥</button>
      </div>
      <p class="tiny" style="text-align:center;padding-bottom:8px">Tap ♥ to like, ✕ to pass, or like a specific photo or prompt and add a comment.</p></div>`;
  }

  function viewLikes() {
    const head = header("Likes You", `<span class="pill">${state.inbound.count || 0}</span>`);
    if (state.inbound.locked) {
      const preview = state.inbound.people || [];
      return head + `<div class="scroll pad"><p class="sub" style="margin-bottom:14px">People who liked a photo or prompt of yours. Unlock Kandi+ to see who they are.</p>
        <div class="lock-grid">${preview.map((p, i) => `<div style="position:relative;overflow:hidden;border-radius:16px;height:180px;background:#111111">
          <div class="lock-card blurred" style="height:100%"></div>
          <div style="position:absolute;inset:0;display:grid;place-items:center;font-size:28px">🔒</div></div>`).join("")}</div>
        <button class="btn primary" style="margin-top:18px" data-act="paywall" data-reason="likesYou">See who likes you</button>
        <p class="tiny" style="text-align:center;margin-top:10px">Kandi+ is free during the beta.</p></div>`;
    }
    if (!state.inbound.people.length) {
      return head + `<div class="scroll pad"><div class="empty"><p>No new likes right now. When someone likes a photo or prompt, they'll land here.</p></div></div>`;
    }
    return head + `<div class="scroll pad">${state.inbound.people.map((p) => {
      const info = p.liked || {};
      const detail = info.type === "prompt" ? ((p.prompts.find((x) => x.id === info.targetId) || {}).q || "a prompt") : "a photo";
      return `<div class="card" style="margin-bottom:10px"><div class="row">
        ${personAvatar(p, "av md")}
        <div class="grow"><div style="font-weight:800">${esc(p.name)}, ${p.age}</div>
          <div class="muted">Liked ${esc(detail)}</div>
          ${info.comment ? `<div class="muted" style="margin-top:4px">“${esc(info.comment)}”</div>` : ""}</div></div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn sm primary" data-act="like-back" data-id="${p.id}">Like back</button>
          <button class="btn sm ghost" data-act="pass" data-id="${p.id}">Pass</button>
          <button class="btn sm ghost" data-act="report" data-id="${p.id}">Report / block</button>
        </div></div>`;
    }).join("")}</div>`;
  }

  function viewEvents() {
    const liveBtn = `<button class="btn sm ${state.live.on ? "primary" : "ghost"}" data-act="open-live">${state.live.on ? "Live · on" : "At the show"}</button>`;
    const cat = state.eventCategory || "all";
    const list = state.events.filter((e) => cat === "all" || e.category === cat);
    const updated = formatUpdatedAgo(state.eventsUpdatedAt);
    let html = header("Events", liveBtn) + `<div class="scroll pad">`;
    if (updated) html += `<p class="event-updated">${esc(updated)}</p>`;
    html += `<div class="seg event-cats" style="margin-bottom:12px">
        <button class="${cat === "all" ? "on" : ""}" data-act="event-cat" data-id="all">All</button>
        <button class="${cat === "rave" ? "on" : ""}" data-act="event-cat" data-id="rave">Raves &amp; EDM</button>
        <button class="${cat === "concert" ? "on" : ""}" data-act="event-cat" data-id="concert">Concerts</button>
      </div>
      <p class="sub" style="margin:0 0 14px">Upcoming Salt Lake City raves and concerts. Mark where you're going so people can find you on the floor.</p>`;
    if (!list.length) {
      html += `<div class="empty"><p>No upcoming ${cat === "rave" ? "raves" : cat === "concert" ? "concerts" : "shows"} in this list yet. Check back soon — we refresh every hour.</p></div>`;
    }
    list.forEach((e) => {
      const bits = [`${(e.going || []).length} ravers going`];
      if (e.ageLimit) bits.push(esc(e.ageLimit));
      if ((e.genres || []).length) bits.push(e.genres.map(esc).join(", "));
      else if (e.category) bits.push(e.category === "rave" ? "Rave / EDM" : "Concert");
      html += `<div class="event" style="margin-bottom:10px">
        <button class="event-main" data-act="event" data-id="${esc(e.id)}">
          <div class="thumb" style="background:${esc(e.color || "#1a0a00")}">${eventThumb(e)}</div>
          <div class="grow"><div style="font-weight:800">${esc(e.name)} ${e.imGoing ? `<span class="chip soft">You're going</span>` : ""}</div>
          <div class="muted">${esc(eventWhen(e))}</div>
          <div class="muted">${esc(e.venue || "Venue TBA")}${e.city ? " · " + esc(e.city) : ""}</div>
          <div class="tiny" style="margin-top:4px">${bits.join(" · ")}</div></div>
        </button>
        <div class="event-facts">
          ${eventAddressLine(e)}
          ${eventTicketLine(e)}
        </div>
        ${eventActions(e)}
      </div>`;
    });
    return html + "</div>";
  }

  function viewMatches() {
    let html = header("Matches") + `<div class="scroll pad">`;
    if (!state.matches.length) return html + `<div class="empty"><p>When you and another raver like each other, the match lands here.</p></div></div>`;
    state.matches.forEach((m) => {
      const p = m.user;
      const last = m.lastMessage;
      html += `<button class="nearby card row" style="margin-bottom:8px;width:100%;text-align:left" data-act="chat" data-id="${p.id}">
        ${personAvatar(p, "av sm")}
        <div class="grow"><div style="font-weight:800">${esc(p.name)}</div>
        <div class="muted">${esc(last ? last.text : "You matched. Say hi.")}</div></div></button>`;
    });
    return html + "</div>";
  }


  function viewHome() {
    const following = state.feedTab !== "popular";
    let html = header("Kandi", `<button class="icon-btn" data-act="open-composer" title="New post" aria-label="New post">＋</button>`);
    html += `<div class="feed-tabs">
      <button class="${following ? "on" : ""}" data-act="feed-tab" data-id="following">Following</button>
      <button class="${!following ? "on" : ""}" data-act="feed-tab" data-id="popular">Popular</button>
    </div>`;
    html += `<div class="scroll">`;
    if (state.me && !state.me.isDemo && !hasRealPhoto(state.me.photos) && !localStorage.getItem("kandi-hide-photo-nudge")) {
      html += `<div class="nudge"><div class="grow"><strong>Add a profile photo</strong><p>Ravers recognize you faster in the feed, in Discover, and in chat.</p></div>
        <button class="btn sm primary" data-act="edit-profile">Add photo</button>
        <button class="icon-btn" data-act="dismiss-photo-nudge" aria-label="Dismiss">✕</button></div>`;
    }
    if (!following && (state.topRavers || []).length) {
      html += `<div class="label" style="padding:0 14px 8px">Top ravers</div><div class="stories">`;
      html += state.topRavers.map((p) =>
        `<button class="story" data-act="open-profile" data-id="${p.id}">${avatarEl(p.avatar, "av", (p.name||"?")[0])}<div class="nm">${esc(p.name)}</div></button>`
      ).join("");
      html += `</div>`;
    }
    const posts = state.homePosts || [];
    if (!posts.length) {
      if (following) {
        html += `<div class="empty"><div style="font-size:40px;margin-bottom:8px">⌁</div><h2 class="h2" style="font-size:22px">Your floor is quiet</h2><p class="sub">Follow ravers and their posts show up here. Check Popular, or find people in Discover.</p>
          <button class="btn primary" style="margin-top:16px" data-act="feed-tab" data-id="popular">See what's popular</button></div>`;
      } else {
        html += `<div class="empty"><div style="font-size:40px;margin-bottom:8px">✦</div><h2 class="h2" style="font-size:22px">No posts yet</h2><p class="sub">Be the first to share a moment from the floor.</p>
          <button class="btn primary" style="margin-top:16px" data-act="open-composer">New post</button></div>`;
      }
    } else {
      html += posts.map(postCard).join("");
    }
    html += `<div style="height:72px"></div></div><button class="fab-post" data-act="open-composer" aria-label="New post">＋</button>`;
    return html;
  }

  function postCard(p) {
    const burst = state.heartBurst === p.id ? `<div class="burst">♥</div>` : "";
    const cap = p.caption ? `<div class="cap"><strong>${esc(p.author.name)}</strong>${esc(p.caption)}</div>` : "";
    const ev = p.event ? `<span class="chip soft event-tag">${esc(p.event.emoji || "")} ${esc(p.event.name)}</span>` : "";
    const followBtn = p.author.id !== (state.me && state.me.id) && !p.author.following
      ? `<button class="btn sm ghost" data-act="follow" data-id="${p.author.id}">Follow</button>`
      : (p.author.id !== (state.me && state.me.id)
        ? `<button class="btn sm ghost" data-act="unfollow" data-id="${p.author.id}">Following</button>`
        : "");
    const more = p.author.id === (state.me && state.me.id)
      ? `<button class="icon-btn" data-act="delete-post" data-id="${p.id}" title="Delete" aria-label="Delete">✕</button>`
      : `<button class="icon-btn" data-act="report-post" data-id="${p.id}" title="Report" aria-label="Report">⋯</button>`;
    const photo = p.photoUrl
      ? postGallery(p, burst)
      : (p.caption ? `<div class="post-photo" style="display:grid;place-items:center;padding:24px;aspect-ratio:auto;min-height:160px" data-act="post-like-tap" data-id="${p.id}"><div style="font-size:20px;font-weight:700;line-height:1.4;padding:12px">${esc(p.caption)}</div>${burst}</div>` : "");
    return `<article class="post">
      <div class="post-hd">
        <button data-act="open-profile" data-id="${p.author.id}">${avatarEl(p.author.avatar, "av", (p.author.name||"?")[0])}</button>
        <button class="who" data-act="open-profile" data-id="${p.author.id}"><div class="nm">${esc(p.author.name)}</div><div class="un">@${esc(p.author.username)} · ${esc(timeAgo(p.createdAt))}</div></button>
        ${followBtn}${more}
      </div>
      ${photo}
      <div class="post-actions">
        <button class="${p.liked ? "loved" : ""}" data-act="toggle-post-like" data-id="${p.id}" aria-label="Like">♥</button>
        <button data-act="open-comments" data-id="${p.id}" aria-label="Comments">💬</button>
        <span class="spacer"></span>
      </div>
      <div class="post-body">
        <div class="likes">${p.likeCount} like${p.likeCount === 1 ? "" : "s"} · ${p.commentCount} comment${p.commentCount === 1 ? "" : "s"}</div>
        ${p.photoUrl ? cap : ""}
        ${ev}
      </div>
    </article>`;
  }

  function viewYou() {
    const p = state.me;
    const plan = p.subscription ? (p.subscription === "vip" ? "Kandi VIP" : "Kandi+") : "Free";
    let html = header("You", `<button class="btn sm ghost" data-act="edit-profile">Edit profile</button>`) + `<div class="scroll pad">`;
    html += `<div class="prof-hero">${profileAvatarEditor(p)}<div class="grow"><div class="nm">${esc(p.name)}${p.age ? ", " + p.age : ""}</div>
      <div class="muted">@${esc(p.username)}</div>
      <button class="btn sm ghost" style="margin-top:10px" data-act="edit-profile">Edit profile</button></div></div>`;
    html += photoEditor(p.photos);
    html += `<div class="chips" style="margin:12px 0">${p.vibes.map((v) => `<span class="chip soft">${esc(v)}</span>`).join("")}</div>`;
    html += `<div class="muted">Looking for ${p.looking.map((id) => LOOKING_LABEL[id] || id).join(", ")}</div>`;
    (p.prompts || []).forEach((pr) => {
      html += `<div class="prompt" style="padding-bottom:20px;margin-top:12px"><div class="q">${esc(pr.q)}</div><div class="a" style="font-size:18px">${esc(pr.a)}</div></div>`;
    });
    const soc = state.profile && state.profile.user && state.profile.user.id === p.id ? state.profile : null;
    if (soc) {
      html += `<div class="counts">
        <span><strong>${soc.user.followerCount || 0}</strong><span class="tiny">followers</span></span>
        <span><strong>${soc.user.followingCount || 0}</strong><span class="tiny">following</span></span>
        <span><strong>${(soc.posts || []).length}</strong><span class="tiny">posts</span></span>
      </div>`;
      if ((soc.posts || []).length) {
        html += `<div class="label">Your posts</div><div class="post-grid">` + soc.posts.map((post) =>
          post.photoUrl
            ? `<button style="background-image:url('${esc(mediaUrl(post.photoUrl))}')" data-act="open-comments" data-id="${post.id}" aria-label="Your post${post.caption ? ": " + esc(post.caption.slice(0, 60)) : ""}"></button>`
            : `<button data-act="open-comments" data-id="${post.id}"><span class="txt">${esc((post.caption || "").slice(0, 80))}</span></button>`
        ).join("") + `</div>`;
      }
    }
    html += `<div class="card" style="margin-top:16px"><div class="row"><div class="grow"><div style="font-weight:800">${plan}</div>
      <div class="tiny">${p.subscription ? "Free during the beta — no payment on file." : "Free to use. Kandi+ (free during the beta) adds unlimited likes and more."}</div></div>
      ${p.subscription ? `<button class="btn sm ghost" data-act="cancel-sub">Turn off</button>` : `<button class="btn sm primary" data-act="paywall" data-reason="upgrade">See Kandi+</button>`}
    </div></div>`;
    html += `<h3 style="margin:22px 0 10px;font-size:16px">Safety</h3>
      <div class="notice warn" style="margin-bottom:10px"><strong>Consent first.</strong> Ask, wait for a yes, and look out for each other. You never owe anyone a dance, a meetup, or a hookup.</div>`;
    if (state.locationShare) {
      html += `<div class="notice ok" style="margin-bottom:10px">Meetup note shared with ${esc(state.locationShare.with)}${state.locationShare.event ? " · " + esc(state.locationShare.event) : ""}. In-app only — no real location was sent.</div>`;
    } else {
      html += `<button class="btn ghost" style="margin-bottom:10px" data-act="share-loc">Share a meetup note with a friend</button>`;
    }
    if (state.blocked.length) {
      html += `<div class="label" style="margin-top:16px">Blocked</div>` + state.blocked.map((b) =>
        `<div class="row" style="margin:6px 0"><div class="grow">${esc(b.name)}</div><button class="btn sm ghost" data-act="unblock" data-id="${b.id}">Unblock</button></div>`
      ).join("");
    }
    html += iosTip();
    html += `<button class="btn ghost" style="margin-top:24px" data-act="logout">Log out</button>
      <button class="btn danger" style="margin-top:8px;width:100%" data-act="delete-account">Delete account</button>
      <p class="tiny" style="text-align:center;margin-top:12px"><a href="/privacy" style="color:var(--muted)">Privacy</a> · <a href="/terms" style="color:var(--muted)">Terms</a></p>
      <p class="tiny" style="text-align:center;margin-top:8px">Kandi v1.1</p></div>`;
    return html;
  }

  const MAX_POST_PHOTOS = 10;
  function composerPhotos() {
    const list = state.drafts.postFiles || [];
    const picker = (label, big) => `<label class="${big ? "card photo-upload big-pick" : "pick-more"}">${label}
      <input type="file" accept="image/*" multiple data-act-file="post-photo" aria-label="Add photos from camera or library" /></label>`;
    if (!list.length) {
      return picker(`<div style="font-size:30px">📷</div><div style="font-weight:700;margin-top:6px">Add photos</div><div class="tiny" style="margin-top:4px">Take a photo or pick up to ${MAX_POST_PHOTOS} from your library. Any size works.</div>`, true);
    }
    return `<div class="composer-strip">${list.map((f, i) => `<div class="composer-thumb" style="background-image:url('${esc(f.url)}')">
        <button type="button" class="slot-x" data-act="remove-post-photo" data-id="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`).join("")}
      ${list.length < MAX_POST_PHOTOS ? picker(`<span style="font-size:26px">＋</span><span class="tiny">Add</span>`, false) : ""}</div>
      <p class="tiny" style="margin-top:6px">${list.length} photo${list.length === 1 ? "" : "s"} · swipe through them in the post</p>`;
  }
  function clearPostFiles() {
    (state.drafts.postFiles || []).forEach((f) => { try { URL.revokeObjectURL(f.url); } catch (_) {} });
    state.drafts.postFiles = [];
  }
  function postGallery(p, burst) {
    const urls = (p.photoUrls && p.photoUrls.length) ? p.photoUrls : (p.photoUrl ? [p.photoUrl] : []);
    if (urls.length <= 1) {
      return `<div class="post-photo" style="background-image:url('${esc(mediaUrl(urls[0]))}')" data-act="post-like-tap" data-id="${p.id}" role="img" aria-label="Photo by ${esc(p.author.name)}. Double-tap to like.">${burst}</div>`;
    }
    return `<div class="post-carousel-wrap"><div class="post-carousel" data-act="post-like-tap" data-id="${p.id}">
      ${urls.map((u, i) => `<div class="post-photo slide" style="background-image:url('${esc(mediaUrl(u))}')" role="img" aria-label="Photo ${i + 1} of ${urls.length} by ${esc(p.author.name)}"></div>`).join("")}
      </div>${burst}<span class="carousel-count">1/${urls.length}</span></div>`;
  }

  function overlays() {
    const o = state.overlay;
    if (!o) return "";
    if (o.type === "composer") {
      const evs = state.events || [];
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2">New post</h2>
        <p class="muted" style="margin-top:6px">Share a photo, a caption, or both. Optional festival tag.</p>
        ${composerPhotos()}
        <textarea data-field="caption" placeholder="Write a caption..." style="margin-top:10px">${esc(state.drafts.caption || "")}</textarea>
        <div class="label" style="margin-top:12px">Tag an event (optional)</div>
        <div class="chips"><button class="chip${!(state.drafts.postEvent) ? " on" : ""}" data-act="post-event" data-id="">None</button>
          ${evs.map((e) => `<button class="chip${state.drafts.postEvent === e.id ? " on" : ""}" data-act="post-event" data-id="${esc(e.id)}">${esc(e.emoji || "")} ${esc(e.name)}</button>`).join("")}</div>
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        <button class="btn primary" style="margin-top:16px" data-act="submit-post">Post</button>
        <button class="btn ghost" style="margin-top:8px" data-act="close">Cancel</button></div></div>`;
    }
    if (o.type === "comments") {
      const comments = state.comments || [];
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2">Comments</h2>
        <div style="margin-top:12px">${comments.length ? comments.map((c) => `<div class="row" style="margin-bottom:12px;align-items:flex-start">
          ${avatarEl(c.author && c.author.avatar, "av", ((c.author && c.author.name) || "?")[0])}
          <div class="grow"><div><strong>${esc(c.author.name)}</strong> <span class="tiny">${esc(timeAgo(c.createdAt))}</span></div>
          <div>${esc(c.text)}</div></div>
          ${c.mine ? `<button class="tiny" data-act="delete-comment" data-id="${c.id}">Delete</button>` : ""}
        </div>`).join("") : `<div class="muted">No comments yet. Be the first.</div>`}</div>
        <div class="row" style="margin-top:12px"><input data-field="commentText" aria-label="Add a comment" enterkeyhint="send" autocomplete="off" placeholder="Add a comment..." value="${esc(state.drafts.commentText || "")}" />
          <button class="btn sm primary" data-act="send-comment">Send</button></div></div></div>`;
    }
    if (o.type === "reportPost") {
      const reasons = ["Spam", "Harassment", "Inappropriate", "Impersonation", "Something else"];
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2">Report post</h2>
        <p class="muted" style="margin-top:8px">This also blocks the person who posted it. You won't see their posts anymore.</p>
        <div class="chips" style="margin-top:14px">${reasons.map((r) => `<button class="chip${state.drafts.reportReason === r ? " on" : ""}" data-act="report-reason" data-id="${esc(r)}">${esc(r)}</button>`).join("")}</div>
        <button class="btn danger" style="margin-top:16px;width:100%" data-act="submit-report-post">Report and block</button>
        <button class="btn ghost" style="margin-top:8px" data-act="close">Cancel</button></div></div>`;
    }
    if (o.type === "editProfile") {
      const me = state.me || { photos: [], name: "", bio: "" };
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Close">✕</button><span style="font-weight:800">Edit profile</span></div>
        <div class="right"><button class="btn sm primary" data-act="save-profile">Save</button></div></div>
        <div class="scroll pad">
          <div style="display:flex;justify-content:center;margin:8px 0 16px">${profileAvatarEditor(me)}</div>
          ${photoEditor(me.photos)}
          <div class="label" style="margin-top:8px">Name</div>
          <input data-field="editName" placeholder="Name" value="${esc(state.drafts.editName || "")}" />
          <div class="label" style="margin-top:12px">Bio</div>
          <textarea data-field="editBio" placeholder="A little about you...">${esc(state.drafts.editBio || "")}</textarea>
          ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        </div></div>`;
    }
    if (o.type === "profile") {
      const data = state.profile;
      if (!data || !data.user) return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Close">✕</button></div></div><div class="empty">Couldn't load this profile.</div></div>`;
      const u = data.user;
      const followBtn = u.isMe ? "" : (u.following
        ? `<button class="btn sm ghost" data-act="unfollow" data-id="${u.id}">Following</button>`
        : `<button class="btn sm primary" data-act="follow" data-id="${u.id}">Follow</button>`);
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Close">✕</button><span style="font-weight:800">${esc(u.name)}</span></div><div class="right">${followBtn}</div></div>
        <div class="scroll pad">
          <div class="profile-top">${personAvatar(u, "av lg")}<div class="grow">
            <div style="font-weight:800;font-size:20px">${esc(u.name)}${u.age ? ", " + u.age : ""}</div>
            <div class="muted">@${esc(u.username)}</div>
          </div></div>
          <div class="counts">
            <span><strong>${u.followerCount || 0}</strong><span class="tiny">followers</span></span>
            <span><strong>${u.followingCount || 0}</strong><span class="tiny">following</span></span>
            <span><strong>${(data.posts || []).length}</strong><span class="tiny">posts</span></span>
          </div>
          <div class="chips">${(u.vibes || []).map((v) => `<span class="chip soft">${esc(v)}</span>`).join("")}</div>
          ${(data.posts || []).length
            ? `<div class="post-grid" style="margin-top:16px">` + data.posts.map((post) =>
                post.photoUrl
                  ? `<button style="background-image:url('${esc(mediaUrl(post.photoUrl))}')" data-act="open-comments" data-id="${post.id}"></button>`
                  : `<button data-act="open-comments" data-id="${post.id}"><span class="txt">${esc((post.caption || "").slice(0, 80))}</span></button>`
              ).join("") + `</div>`
            : `<div class="empty">No posts yet.</div>`}
          ${!u.isMe ? `<button class="btn ghost" style="margin-top:24px" data-act="report" data-id="${u.id}">Report / block</button>` : ""}
        </div></div>`;
    }
    if (o.type === "deleteAccount") {
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2">Delete your account?</h2>
        <p class="muted" style="margin-top:8px">This permanently deletes your profile, photos, likes, matches, and messages. You can't undo it. Demo profiles can't be deleted.</p>
        <input data-field="deleteUser" placeholder="Type your username" value="${esc(state.drafts.deleteUser || "")}" style="margin-top:16px" autocapitalize="none" autocorrect="off" spellcheck="false" />
        <input data-field="deleteConfirm" placeholder="Type DELETE in all caps" value="${esc(state.drafts.deleteConfirm || "")}" style="margin-top:8px" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" />
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        <button class="btn danger" style="margin-top:16px;width:100%" data-act="delete-account-confirm">Delete my account</button>
        <button class="btn ghost" style="margin-top:8px" data-act="close">Keep my account</button></div></div>`;
    }
    if (o.type === "paywall") {
      const prices = { weekly: { plus: "$12.99", vip: "$19.99", n: "per week" }, monthly: { plus: "$24.99", vip: "$39.99", n: "per month" }, six: { plus: "$89.99", vip: "$149.99", n: "every 6 months" } }[state.billing];
      const pending = state.pendingPlan;
      const rows = [
        ["Unlimited likes", "✓", "✓"],
        ["See who likes you", "✓", "✓"],
        ["Advanced filters (genre, event)", "✓", "✓"],
        ["Rewinds", "5 / day", "Unlimited"],
        ["Priority at events and live mode", "—", "✓"],
      ];
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Close">✕</button><span class="wordmark grad" style="font-size:15px">Kandi+</span></div></div>
        <div class="scroll pad">${beads(8)}
        <h2 class="h2" style="text-align:center;margin:12px 0 6px">Stay on the floor longer.</h2>
        <div class="notice ok" style="text-align:center;margin:12px 0"><strong>Free during the beta.</strong> Kandi+ and VIP unlock right away with no payment. Prices below are what they'll cost after launch.</div>
        <div class="seg" style="margin:10px 0 14px">
          <button class="${state.billing === "weekly" ? "on" : ""}" data-act="billing" data-id="weekly">Weekly</button>
          <button class="${state.billing === "monthly" ? "on" : ""}" data-act="billing" data-id="monthly">Monthly</button>
          <button class="${state.billing === "six" ? "on" : ""}" data-act="billing" data-id="six">6 months</button>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
          <button class="plan${pending === "plus" ? " on" : ""}" data-act="pick-plan" data-id="plus"><div class="tiny">KANDI+</div><div class="price">${prices.plus}</div><div class="tiny">${prices.n}</div></button>
          <button class="plan${pending === "vip" ? " on" : ""}" data-act="pick-plan" data-id="vip"><div class="tiny">KANDI VIP</div><div class="price">${prices.vip}</div><div class="tiny">${prices.n}</div></button>
        </div>
        <div class="card">${rows.map((r) => `<div class="feat"><span>${r[0]}</span><span class="tiny">${pending === "vip" ? r[2] : r[1]}</span></div>`).join("")}</div>
        <button class="btn primary" style="margin-top:18px" data-act="buy">Unlock ${pending === "vip" ? "Kandi VIP" : "Kandi+"} free</button>
        <p class="tiny" style="text-align:center;margin-top:10px">No card needed. Nothing will be charged. You can turn it off anytime on the You tab.</p></div></div>`;
    }
    if (o.type === "purchased") {
      return `<div class="overlay"><div class="match-wrap">${beads(8, "lg")}<h2>You're in.</h2>
        <p class="sub">Unlimited likes, see who likes you, filters and rewinds are on. It's free during the beta — no payment was taken.</p>
        <button class="btn primary" style="margin-top:24px;max-width:280px" data-act="close">Start using it</button></div></div>`;
    }
    if (o.type === "match") {
      const p = o.person;
      return `<div class="overlay"><div class="match-wrap">
        <div class="avatars">${personAvatar(state.me, "av")}${beads(5, "sm")}
        ${personAvatar(p, "av")}</div>
        <h2>It's a trade!</h2>
        <p class="sub">${esc(state.me.name)} and ${esc(p.name)} liked each other. Time to trade kandi — or at least a hello.</p>
        <button class="btn primary" style="margin-top:24px;max-width:280px" data-act="chat" data-id="${p.id}">Send a message</button>
        <button class="btn ghost" style="margin-top:8px;max-width:280px" data-act="close">Keep browsing</button></div></div>`;
    }
    if (o.type === "liked") {
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Like sent</h2>
        <p class="sub">If they like you back, you'll match and can start chatting.</p>
        <button class="btn primary" style="margin-top:18px" data-act="close">Nice</button></div></div>`;
    }
    if (o.type === "likeSheet") {
      const p = state.feed.find((x) => x.id === o.id) || (state.inbound.people || []).find((x) => x.id === o.id) || o.person || { name: "" };
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Like this ${o.typeTarget}</h2>
        <p class="sub">Send a like to ${esc(p.name)}, or add a short comment.</p>
        <textarea data-field="comment" placeholder="Add a comment (optional)" style="margin-top:12px">${esc(state.drafts.comment)}</textarea>
        <div class="chips" style="margin-top:8px">${["Great prompt", "I'd dance to that", "Come say hi at the totem", "Saving you a rail spot"].map((c) =>
          `<button class="chip" data-act="like-chip" data-t="${esc(c)}">${esc(c)}</button>`).join("")}</div>
        <button class="btn primary" style="margin-top:16px" data-act="send-like">Send like${isPlus() ? "" : " · " + state.likesLeft + " left"}</button>
        <button class="btn ghost" style="margin-top:8px" data-act="close">Cancel</button></div></div>`;
    }
    if (o.type === "filters") {
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Filters</h2>
        <p class="example" style="margin:8px 0">Kandi+ · advanced filters</p>
        <div class="label">Genre</div><div class="chips"><button class="chip${state.filters.genre === "all" ? " on" : ""}" data-act="set-genre" data-id="all">All genres</button>
        ${VIBES.map((g) => `<button class="chip${state.filters.genre === g ? " on" : ""}" data-act="set-genre" data-id="${g}">${g}</button>`).join("")}</div>
        <div class="label" style="margin-top:14px">Event</div><div class="chips">
        <button class="chip${state.filters.event === "all" ? " on" : ""}" data-act="set-event-filter" data-id="all">All events</button>
        ${state.events.map((e) => `<button class="chip${state.filters.event === e.id ? " on" : ""}" data-act="set-event-filter" data-id="${e.id}">${esc(e.name)}</button>`).join("")}</div>
        <button class="btn primary" style="margin-top:16px" data-act="apply-filters">Done</button></div></div>`;
    }
    if (o.type === "event") {
      const e = state.events.find((x) => x.id === o.id);
      if (!e) return "";
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Close">✕</button><span style="font-weight:800">${esc(e.name)}</span></div></div>
        <div class="scroll pad"><div class="photo" style="background:${esc(e.color)};height:180px">${e.imageUrl ? `<img src="${esc(e.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<div class="emoji">${e.emoji}</div>`}</div>
        <p class="event-updated" style="margin:12px 0 6px">${e.category === "rave" ? "Rave / EDM" : "Concert"}${e.ageLimit ? " · " + esc(e.ageLimit) : ""}</p>
        <div class="event-detail-row"><div class="label" style="margin:0">Date &amp; time</div><div class="muted">${esc(eventWhen(e))}</div></div>
        <div class="event-detail-row"><div class="label" style="margin:0">Venue</div><div class="muted">${esc(e.venue || "Venue TBA")}${e.city ? " · " + esc(e.city) : ""}</div></div>
        <div class="event-detail-row"><div class="label" style="margin:0">Address</div><div>${eventAddressLine(e)}</div></div>
        <div class="event-detail-row"><div class="label" style="margin:0">Tickets</div><div>${eventTicketLine(e)}</div></div>
        ${(e.artists || []).length ? `<div class="tiny" style="margin-top:6px">${e.artists.map(esc).join(" · ")}</div>` : ""}
        ${eventActions(e)}
        <div class="row" style="margin:14px 0"><div class="grow"><div style="font-weight:700">I'm going</div></div>
          <button class="toggle${e.imGoing ? " on" : ""}" data-act="toggle-going" data-id="${e.id}" aria-label="I'm going"><i></i></button></div>
        ${!isVip() ? `<button class="btn ghost" style="margin-bottom:12px" data-act="paywall" data-reason="priority">Get priority at events with Kandi VIP</button>` : `<div class="notice ok" style="margin-bottom:12px">Kandi VIP priority is on.</div>`}
        <div class="row" style="margin:6px 0 8px"><div class="label grow" style="margin:0">Photos from this show</div>
          <button class="btn sm primary" data-act="open-composer" data-event="${esc(e.id)}">📷 Add photos</button></div>
        ${(state.eventPosts && state.eventPosts.id === e.id)
          ? ((state.eventPosts.posts || []).length
            ? `<div class="post-grid" style="margin-bottom:16px">${state.eventPosts.posts.map((post) => post.photoUrl
                ? `<button style="background-image:url('${esc(mediaUrl(post.photoUrl))}')" data-act="open-comments" data-id="${post.id}" aria-label="Photo by ${esc(post.author.name)}">${(post.photoUrls || []).length > 1 ? `<span class="multi">▣ ${post.photoUrls.length}</span>` : ""}</button>`
                : `<button data-act="open-comments" data-id="${post.id}"><span class="txt">${esc((post.caption || "").slice(0, 80))}</span></button>`).join("")}</div>`
            : `<p class="tiny" style="margin-bottom:16px">No photos yet. Going? Be the first to share the vibe.</p>`)
          : `<p class="tiny" style="margin-bottom:16px"><span class="spin"></span> Loading photos…</p>`}
        <div class="label">Who's going</div>
        ${e.going.map((p) => `<div class="row card" style="margin-bottom:8px">${personAvatar(p, "av sm")}
          <div class="grow"><div style="font-weight:700">${esc(p.name)}, ${p.age}${isVip() && p.subscription === "vip" ? ' <span class="vip">Priority</span>' : ""}</div>
          <div class="tiny">${p.vibes.join(" · ")}</div></div></div>`).join("")}
        <button class="btn primary" style="margin-top:8px" data-act="open-live" data-id="${e.id}">Open at-the-show live mode</button></div></div>`;
    }
    if (o.type === "live") {
      const options = state.events.filter((e) => e.imGoing).length ? state.events.filter((e) => e.imGoing) : state.events;
      const eid = state.live.eventId || (options[0] && options[0].id);
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Close">✕</button><span class="wordmark grad" style="font-size:15px">At the show</span></div>
        <div class="right"><button class="toggle${state.live.on ? " on" : ""}" data-act="toggle-live" data-id="${eid || ""}" aria-label="Live mode"><i></i></button></div></div>
        <div class="scroll pad"><p class="sub">Turn live mode on to see people at the same event and pick a meet-up spot. No GPS is used unless you later add it.</p>
        <div class="label" style="margin-top:16px">You're at</div><div class="chips">${options.map((e) =>
          `<button class="chip${e.id === eid ? " on" : ""}" data-act="live-event" data-id="${e.id}">${e.emoji} ${esc(e.name)}</button>`).join("")}</div>
        ${!state.live.on ? `<div class="empty"><p>Live mode is off. Toggle it on when you arrive.</p></div>` : `
          <div class="label" style="margin-top:16px">Meet-up spot</div><div class="chips">${SPOTS.map((s) =>
            `<button class="chip${state.live.meetupSpot === s ? " on" : ""}" data-act="spot" data-id="${esc(s)}">${esc(s)}</button>`).join("")}</div>
          ${state.live.meetupSpot ? `<div class="notice" style="margin-top:12px">You're meeting at <strong>${esc(state.live.meetupSpot)}</strong>.</div>` : ""}
          <div class="notice warn" style="margin-top:12px">Tell a friend where you are. <button data-act="share-loc" style="color:var(--gold);font-weight:700">Share a meetup note</button></div>
          <div class="label" style="margin-top:16px">Nearby at this event</div>
          ${state.nearby.map((p) => `<button class="nearby card row" style="margin-bottom:8px" data-act="want-like" data-id="${p.id}" data-type="photo" data-target="0">
            ${personAvatar(p, "av sm")}
            <div class="grow"><div style="font-weight:700">${esc(p.name)}, ${p.age}</div>
            <div class="tiny">${esc(p.meetupSpot || "At this event")} · ${p.vibes.slice(0, 2).join(", ")}</div></div></button>`).join("")}
        `}</div></div>`;
    }
    if (o.type === "chat") {
      const p = state.chatWith;
      if (!p) return "";
      return `<div class="overlay" style="background:var(--bg);display:flex;flex-direction:column">
        <div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Back">‹</button>
        <div class="chat-head">${personAvatar(p, "av chat")}<span class="nm">${esc(p.name)}</span></div></div>
        <div class="right"><button class="icon-btn" data-act="report" data-id="${p.id}" title="Report or block" aria-label="Report or block">⚑</button></div></div>
        <div class="notice warn" style="margin:0 16px 8px">Consent reminder: be direct, accept a no, and don't pressure anyone to meet or hook up.</div>
        <div class="scroll chat-log">${state.chat.map((m) => `<div class="bubble ${m.fromId === state.me.id ? "me" : "them"}">${esc(m.text)}</div>`).join("") || `<div class="tiny" style="text-align:center">You matched on Kandi. Say hi.</div>`}</div>
        <div class="chat-bar"><input data-field="chat" aria-label="Message" enterkeyhint="send" autocomplete="off" placeholder="Say something..." value="${esc(state.drafts.chat)}" />
        <button class="btn sm primary" data-act="send-chat">Send</button></div></div>`;
    }
    if (o.type === "share") {
      const evName = (state.events.find((e) => e.id === state.live.eventId) || {}).name || "your event";
      const friends = ["Riley (trusted friend)"].concat(state.matches.map((m) => m.user.name));
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Share a meetup note with a friend</h2>
        <p class="sub">In-app only. Nothing is actually sent or tracked. A real launch would share a live pin for 2 hours.</p>
        <div class="label" style="margin-top:12px">Share with</div>
        <div class="chips">${friends.map((n) => `<button class="chip${(o.with || friends[0]) === n ? " on" : ""}" data-act="share-with" data-id="${esc(n)}">${esc(n)}</button>`).join("")}</div>
        <p class="muted" style="margin-top:12px">They'd see you at ${esc(evName)}${state.live.meetupSpot ? ", " + esc(state.live.meetupSpot) : ""}.</p>
        <button class="btn primary" style="margin-top:16px" data-act="confirm-share">Share for 2 hours (demo)</button>
        <button class="btn ghost" style="margin-top:8px" data-act="close">Cancel</button></div></div>`;
    }
    if (o.type === "report") {
      const reasons = ["Inappropriate messages", "Fake or misleading", "Feels unsafe", "Harassment", "Something else"];
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Report or block</h2>
        <p class="sub">Reporting also blocks them. They'll disappear from Discover, Likes, Events, and chat.</p>
        <div class="chips" style="margin-top:12px">${reasons.map((r) => `<button class="chip${o.reason === r ? " on" : ""}" data-act="report-reason" data-id="${esc(r)}">${esc(r)}</button>`).join("")}</div>
        <button class="btn danger" style="margin-top:16px" data-act="confirm-block">Block and report</button>
        <button class="btn ghost" style="margin-top:8px" data-act="close">Cancel</button></div></div>`;
    }
    return "";
  }

  function render() {
    const root = document.getElementById("app");
    let html = "";
    if (state.view === "boot") html = `<div class="screen splash top-pad"><div class="inner">${beads(8, "lg")}<h1 class="wordmark grad">Kandi</h1><p class="sub" style="margin-top:12px"><span class="spin"></span> Loading…</p></div></div>`;
    else if (state.view === "offline") html = `<div class="screen splash top-pad"><div class="inner">${beads(8, "lg")}<h1 class="wordmark grad">Kandi</h1>
      <p style="margin-top:12px">${esc(state.err || "Can't reach Kandi right now.")}</p>
      <button class="btn primary" style="margin-top:20px;max-width:280px" data-act="retry-boot">Try again</button></div></div>`;
    else if (state.view === "claim") html = viewClaim();
    else if (state.view === "auth") html = viewAuth();
    else if (state.view === "onboard") html = viewOnboard();
    else {
      let body = "";
      if (state.tab === "home") body = viewHome();
      else if (state.tab === "discover") body = viewDiscover();
      else if (state.tab === "likes") body = viewLikes();
      else if (state.tab === "events") body = viewEvents();
      else if (state.tab === "matches") body = viewMatches();
      else body = viewYou();
      html = `<div class="screen has-tabs">${body}${tabbar()}${overlays()}</div>`;
    }
    // Keep scroll position and the focused field across re-renders (likes, follows, typing feedback).
    const key = state.view + "|" + state.tab + "|" + state.feedTab + "|" + ((state.overlay && state.overlay.type) || "");
    const scrollers = Array.from(root.querySelectorAll(".scroll, .overlay, .sheet"));
    const saved = lastRenderKey === key ? scrollers.map((n) => n.scrollTop) : null;
    const active = document.activeElement;
    const focusField = active && root.contains(active) && active.getAttribute ? active.getAttribute("data-field") : null;
    let selStart = null, selEnd = null;
    if (focusField) { try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (_) {} }
    root.innerHTML = html;
    if (saved) {
      Array.from(root.querySelectorAll(".scroll, .overlay, .sheet")).forEach((n, i) => { if (saved[i]) n.scrollTop = saved[i]; });
    }
    lastRenderKey = key;
    if (focusField) {
      const again = root.querySelector('[data-field="' + focusField + '"]');
      if (again) {
        try { again.focus({ preventScroll: true }); } catch (_) { again.focus(); }
        if (selStart != null) { try { again.setSelectionRange(selStart, selEnd); } catch (_) {} }
      }
    }
    root.querySelectorAll("[data-act]").forEach((n) => {
      const k = n.getAttribute("data-act") + ":" + (n.getAttribute("data-id") || "");
      if (busyActs.has(k)) { n.classList.add("busy"); n.setAttribute("aria-busy", "true"); }
    });
  }
  let lastRenderKey = "";
  const busyActs = new Set();

  async function handle(act, el) {
    const id = el && el.getAttribute("data-id");
    try {
      state.err = "";
      if (act === "retry-boot") { state.view = "boot"; state.err = ""; render(); await boot(); return; }
      if (act === "dismiss-ios-tip") { localStorage.setItem("kandi-hide-ios-tip", "1"); render(); return; }
      if (act === "claim-finish") {
        const password = (state.drafts.claimPass || "").trim();
        const age = Number(state.drafts.claimAge);
        const data = await api("/api/claim", { method: "POST", body: { token: state.claimToken, password, age } });
        applyMe(data);
        connectWs();
        history.replaceState({}, "", "/");
        if (state.drafts.claimFile) {
          await uploadProfilePhoto(state.drafts.claimFile, true);
          if (state.drafts.claimPreview && String(state.drafts.claimPreview).startsWith("blob:")) {
            try { URL.revokeObjectURL(state.drafts.claimPreview); } catch (_) {}
          }
          state.drafts.claimFile = null;
          state.drafts.claimPreview = "";
        }
        state.view = needsOnboard(state.me) ? "onboard" : "app";
        state.overlay = null;
        if (state.view === "app") await refreshAll();
        render(); return;
      }
      if (act === "dismiss-photo-nudge") { localStorage.setItem("kandi-hide-photo-nudge", "1"); render(); return; }
      if (act === "edit-profile") {
        state.err = "";
        state.drafts.editName = state.me ? state.me.name : "";
        state.drafts.editBio = state.me ? (state.me.bio || "") : "";
        state.overlay = { type: "editProfile" };
        render(); return;
      }
      if (act === "save-profile") {
        const data = await api("/api/me", { method: "PUT", body: { name: state.drafts.editName, bio: state.drafts.editBio } });
        state.me = data.user;
        state.overlay = null;
        render(); return;
      }
      if (act === "del-photo") {
        const i = Number(el.getAttribute("data-i"));
        const data = await api("/api/me/photo/" + i, { method: "DELETE", body: {} });
        state.me = data.user;
        render(); return;
      }
      if (act === "photo-main") {
        const i = Number(el.getAttribute("data-i"));
        const data = await api("/api/me/photo/main", { method: "POST", body: { index: i } });
        state.me = data.user;
        render(); return;
      }
      if (act === "photo-left" || act === "photo-right") {
        const i = Number(el.getAttribute("data-i"));
        const photos = (state.me && state.me.photos) || [];
        const j = act === "photo-left" ? i - 1 : i + 1;
        if (j < 0 || j >= photos.length) return;
        const order = photos.map((_, n) => n);
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        const data = await api("/api/me/photos", { method: "PUT", body: { order } });
        state.me = data.user;
        render(); return;
      }
      if (act === "show-signup") { state.overlay = { type: "signup" }; state.info = ""; render(); return; }
      if (act === "show-login") { state.overlay = null; state.info = ""; render(); return; }
      if (act === "signup") {
        const data = await api("/api/signup", { method: "POST", body: { username: state.drafts.user, password: state.drafts.pass, name: state.drafts.name, age: Number(state.drafts.age) } });
        applyMe({ user: data.user, likesLeft: DAILY });
        state.view = "onboard"; state.onboardStep = 0; state.overlay = null;
        connectWs();
        await loadEvents();
        render(); return;
      }
      if (act === "login") {
        const data = await api("/api/login", { method: "POST", body: { username: state.drafts.user, password: state.drafts.pass } });
        applyMe(data);
        state.drafts.pass = "";
        state.view = needsOnboard(state.me) ? "onboard" : "app";
        state.overlay = null; state.tab = "home";
        connectWs();
        render();
        if (state.view === "onboard") await loadEvents(); else await refreshAll();
        render(); return;
      }
      if (act === "logout") {
        try { await api("/api/logout", { method: "POST", body: {} }); } catch (_) { /* still sign out locally */ }
        state.me = null; state.view = "auth"; state.overlay = null; state.tab = "home"; state.drafts.pass = "";
        if (ws) { try { ws.close(); } catch (_) {} ws = null; }
        render(); return;
      }
      if (act === "delete-account") { state.err = ""; state.drafts.deleteUser = ""; state.drafts.deleteConfirm = ""; state.overlay = { type: "deleteAccount" }; render(); return; }
      if (act === "delete-account-confirm") {
        await api("/api/account", { method: "DELETE", body: { username: state.drafts.deleteUser, confirm: state.drafts.deleteConfirm } });
        state.me = null; state.view = "auth"; state.overlay = null; state.err = ""; state.info = "Your account and data were deleted.";
        if (ws) { try { ws.close(); } catch (_) {} ws = null; }
        render(); return;
      }
      if (act === "toggle-vibe") {
        const v = state.me.vibes.includes(id) ? state.me.vibes.filter((x) => x !== id) : state.me.vibes.concat(id);
        state.me.vibes = v; await api("/api/me", { method: "PUT", body: { vibes: v } }); render(); return;
      }
      if (act === "toggle-look") {
        const v = state.me.looking.includes(id) ? state.me.looking.filter((x) => x !== id) : state.me.looking.concat(id);
        state.me.looking = v; await api("/api/me", { method: "PUT", body: { looking: v } }); render(); return;
      }
      if (act === "toggle-event") {
        const going = !state.me.events.includes(id);
        await api("/api/events/" + id + "/going", { method: "POST", body: { going } });
        state.me.events = going ? state.me.events.concat(id) : state.me.events.filter((x) => x !== id);
        await loadEvents(); render(); return;
      }
      if (act === "pick-prompt") { state.drafts.promptQ = id; state.drafts.promptA = ""; render(); return; }
      if (act === "add-prompt") {
        const q = PROMPT_BANK.find((x) => x.id === state.drafts.promptQ);
        const a = state.drafts.promptA.trim();
        if (!q || !a) return;
        const prompts = (state.me.prompts || []).concat({ id: q.id, q: q.q, a });
        const data = await api("/api/me", { method: "PUT", body: { prompts } });
        state.me = data.user; state.drafts.promptQ = ""; state.drafts.promptA = ""; render(); return;
      }
      if (act === "del-prompt") {
        const prompts = state.me.prompts.filter((_, i) => i !== Number(el.getAttribute("data-i")));
        const data = await api("/api/me", { method: "PUT", body: { prompts } });
        state.me = data.user; render(); return;
      }
      if (act === "onboard-next") {
        if (state.onboardStep < 5) { state.onboardStep += 1; if (state.onboardStep === 2 && !state.events.length) await loadEvents(); render(); return; }
        state.view = "app"; state.tab = "home"; render(); await refreshAll(); render(); return;
      }
      if (act === "onboard-back") { state.onboardStep = Math.max(0, state.onboardStep - 1); render(); return; }
      if (act === "tab") {
        state.tab = id; state.overlay = null;
        render();
        const scroller = document.querySelector(".screen > .scroll");
        if (scroller) scroller.scrollTop = 0;
        if (id === "home") await loadHome();
        if (id === "discover") await loadFeed();
        if (id === "likes") await loadInbound();
        if (id === "matches") await loadMatches();
        if (id === "events") await loadEvents();
        if (id === "you" && state.me) await loadProfile(state.me.id);
        if (state.tab === id) render();
        return;
      }
      if (act === "close") {
        const back = state.overlay && state.overlay.returnTo;
        if (state.overlay && state.overlay.type === "composer") clearPostFiles();
        state.overlay = back || null; render(); return;
      }

      if (act === "feed-tab") {
        state.feedTab = id || "following";
        state.tab = "home";
        state.overlay = null;
        await loadHome();
        render(); return;
      }
      if (act === "open-composer") {
        const fromEvent = el && el.getAttribute("data-event");
        state.drafts.caption = "";
        state.drafts.postEvent = fromEvent || "";
        clearPostFiles();
        state.overlay = { type: "composer", returnTo: fromEvent ? { type: "event", id: fromEvent } : null };
        render();
        if (!state.events.length) { await loadEvents(); render(); }
        return;
      }
      if (act === "remove-post-photo") {
        const i = Number(id);
        const list = state.drafts.postFiles || [];
        if (list[i]) { try { URL.revokeObjectURL(list[i].url); } catch (_) {} list.splice(i, 1); }
        render(); return;
      }
      if (act === "post-event") { state.drafts.postEvent = id || ""; render(); return; }
      if (act === "submit-post") {
        const files = state.drafts.postFiles || [];
        if (!files.length && !(state.drafts.caption || "").trim()) throw new Error("Add a photo or write a caption.");
        const fd = new FormData();
        fd.append("caption", state.drafts.caption || "");
        if (state.drafts.postEvent) fd.append("eventId", state.drafts.postEvent);
        for (let i = 0; i < files.length; i++) {
          if (files.length > 1) toast(`Preparing photo ${i + 1} of ${files.length}…`);
          let photo = files[i].file;
          try {
            const compressed = await compressImage(photo);
            if (compressed) photo = compressed;
          } catch (_) { /* send the original; the server will normalize it */ }
          fd.append("photo", photo, "photo-" + (i + 1) + ".jpg");
        }
        await api("/api/posts", { method: "POST", body: fd, timeout: 120000 });
        clearPostFiles();
        const back = state.overlay && state.overlay.returnTo;
        toast(files.length ? "Posted! 📸" : "Posted!");
        if (back && back.type === "event") {
          state.overlay = back;
          await loadEventPosts(back.id);
          render(); return;
        }
        state.overlay = null;
        state.feedTab = "following";
        state.tab = "home";
        render();
        await loadHome();
        if (state.me) await loadProfile(state.me.id);
        render(); return;
      }
      if (act === "open-profile") {
        await loadProfile(id);
        state.overlay = { type: "profile" };
        render(); return;
      }
      if (act === "follow" || act === "unfollow") {
        const method = act === "follow" ? "POST" : "DELETE";
        const data = await api("/api/users/" + id + "/follow", { method, body: {} });
        (state.homePosts || []).forEach((p) => { if (String(p.author.id) === String(id)) p.author.following = data.following; });
        (state.topRavers || []).forEach((p) => { if (String(p.id) === String(id)) p.following = data.following; });
        if (state.profile && state.profile.user && String(state.profile.user.id) === String(id)) {
          state.profile.user.following = data.following;
          state.profile.user.followerCount = data.followerCount;
        }
        render(); return;
      }
      if (act === "toggle-post-like") {
        const post = (state.homePosts || []).find((x) => String(x.id) === String(id))
          || ((state.profile && state.profile.posts) || []).find((x) => String(x.id) === String(id));
        const liked = post && post.liked;
        const data = await api("/api/posts/" + id + "/like", { method: liked ? "DELETE" : "POST", body: {} });
        const apply = (p) => { if (String(p.id) === String(id)) { p.liked = data.liked; p.likeCount = data.likeCount; } };
        (state.homePosts || []).forEach(apply);
        if (state.profile && state.profile.posts) state.profile.posts.forEach(apply);
        render(); return;
      }
      if (act === "post-like-tap") {
        const now = Date.now();
        const prev = state._lastTap || {};
        if (prev.id === String(id) && now - prev.at < 350) {
          const post = (state.homePosts || []).find((x) => String(x.id) === String(id));
          if (!post || !post.liked) {
            const data = await api("/api/posts/" + id + "/like", { method: "POST", body: {} });
            const apply = (p) => { if (String(p.id) === String(id)) { p.liked = data.liked; p.likeCount = data.likeCount; } };
            (state.homePosts || []).forEach(apply);
            if (state.profile && state.profile.posts) state.profile.posts.forEach(apply);
          }
          state.heartBurst = Number(id);
          render();
          setTimeout(() => { if (state.heartBurst === Number(id)) { state.heartBurst = null; render(); } }, 700);
        }
        state._lastTap = { id: String(id), at: now };
        return;
      }
      if (act === "open-comments") {
        const data = await api("/api/posts/" + id + "/comments");
        state.comments = data.comments || [];
        state.commentPostId = Number(id);
        state.drafts.commentText = "";
        const prev = state.overlay;
        state.overlay = { type: "comments", returnTo: prev && (prev.type === "event" || prev.type === "profile") ? prev : null };
        render(); return;
      }
      if (act === "send-comment") {
        const text = (state.drafts.commentText || "").trim();
        if (!text || !state.commentPostId) return;
        const data = await api("/api/posts/" + state.commentPostId + "/comments", { method: "POST", body: { text } });
        state.comments = (state.comments || []).concat(data.comment);
        state.drafts.commentText = "";
        const apply = (p) => { if (p.id === state.commentPostId) p.commentCount = data.commentCount; };
        (state.homePosts || []).forEach(apply);
        if (state.profile && state.profile.posts) state.profile.posts.forEach(apply);
        render(); return;
      }
      if (act === "delete-comment") {
        const data = await api("/api/comments/" + id, { method: "DELETE", body: {} });
        state.comments = (state.comments || []).filter((c) => String(c.id) !== String(id));
        const apply = (p) => { if (p.id === data.postId) p.commentCount = data.commentCount; };
        (state.homePosts || []).forEach(apply);
        render(); return;
      }
      if (act === "delete-post") {
        if (!confirm("Delete this post?")) return;
        await api("/api/posts/" + id, { method: "DELETE", body: {} });
        state.homePosts = (state.homePosts || []).filter((p) => String(p.id) !== String(id));
        if (state.profile && state.profile.posts) state.profile.posts = state.profile.posts.filter((p) => String(p.id) !== String(id));
        render(); return;
      }
      if (act === "report-post") {
        state.drafts.reportReason = "Something else";
        state.overlay = { type: "reportPost", postId: Number(id) };
        render(); return;
      }
      if (act === "report-reason") { state.drafts.reportReason = id; render(); return; }
      if (act === "submit-report-post") {
        const postId = state.overlay && state.overlay.postId;
        await api("/api/posts/" + postId + "/report", { method: "POST", body: { reason: state.drafts.reportReason || "Something else" } });
        state.overlay = null;
        await loadHome();
        render(); return;
      }

      if (act === "filters") {
        if (!isPlus()) { state.overlay = { type: "paywall", reason: "filters" }; render(); return; }
        state.overlay = { type: "filters" }; render(); return;
      }
      if (act === "set-genre") { state.filters.genre = id; render(); return; }
      if (act === "set-event-filter") { state.filters.event = id; render(); return; }
      if (act === "event-cat") { state.eventCategory = id || "all"; render(); return; }
      if (act === "apply-filters") { state.overlay = null; await loadFeed(); render(); return; }
      if (act === "want-like") {
        if (!isPlus() && state.likesLeft === 0) { state.overlay = { type: "paywall", reason: "likes" }; render(); return; }
        state.drafts.comment = "";
        const person = state.feed.find((x) => String(x.id) === String(id)) || (state.inbound.people || []).find((x) => String(x.id) === String(id)) || state.nearby.find((x) => String(x.id) === String(id));
        state.overlay = { type: "likeSheet", id: Number(id), typeTarget: el.getAttribute("data-type"), targetId: el.getAttribute("data-target"), person }; render(); return;
      }
      if (act === "like-chip") { state.drafts.comment = el.getAttribute("data-t") || ""; render(); return; }
      if (act === "send-like") {
        const o = state.overlay;
        const result = await api("/api/like", { method: "POST", body: { userId: o.id, type: o.typeTarget, targetId: o.targetId, comment: state.drafts.comment } });
        state.likesLeft = result.likesLeft;
        if (result.matched) {
          let person = o.person;
          if (!person) {
            const m = await api("/api/matches");
            state.matches = m.matches;
            person = (m.matches.find((x) => x.user.id === o.id) || {}).user;
          }
          state.overlay = { type: "match", person: person || { id: o.id, name: "them", photos: [] } };
        } else state.overlay = { type: "liked" };
        await loadFeed(); await loadInbound(); await loadMatches();
        render(); return;
      }
      if (act === "like-back") {
        const result = await api("/api/like", { method: "POST", body: { userId: Number(id), type: "photo", targetId: "0", comment: "" } });
        state.likesLeft = result.likesLeft;
        await loadInbound(); await loadMatches(); await loadFeed();
        if (result.matched) {
          const m = state.matches.find((x) => String(x.user.id) === String(id));
          state.overlay = { type: "match", person: m ? m.user : { id: Number(id), name: "them", photos: [] } };
        }
        render(); return;
      }
      if (act === "pass") { await api("/api/pass", { method: "POST", body: { userId: Number(id) } }); await loadFeed(); await loadInbound(); render(); return; }
      if (act === "rewind") {
        await api("/api/rewind", { method: "POST", body: {} });
        await loadFeed(); render(); return;
      }
      if (act === "paywall") { state.overlay = { type: "paywall", reason: el.getAttribute("data-reason") || "upgrade" }; render(); return; }
      if (act === "billing") { state.billing = id; render(); return; }
      if (act === "pick-plan") { state.pendingPlan = id; render(); return; }
      if (act === "buy") {
        const data = await api("/api/subscribe", { method: "POST", body: { plan: state.pendingPlan } });
        state.me = data.user; state.overlay = { type: "purchased" }; await refreshAll(); render(); return;
      }
      if (act === "cancel-sub") { const data = await api("/api/subscribe/cancel", { method: "POST", body: {} }); state.me = data.user; render(); return; }
      if (act === "event") {
        state.overlay = { type: "event", id };
        render();
        await loadEventPosts(id);
        if (state.overlay && state.overlay.type === "event" && state.overlay.id === id) render();
        return;
      }
      if (act === "toggle-going") {
        const ev = state.events.find((e) => e.id === id);
        await api("/api/events/" + id + "/going", { method: "POST", body: { going: !ev.imGoing } });
        await loadEvents(); render(); return;
      }
      if (act === "open-live") {
        if (id) state.live.eventId = id;
        if (!state.live.eventId && state.events.find((e) => e.imGoing)) state.live.eventId = state.events.find((e) => e.imGoing).id;
        const data = await api("/api/live?eventId=" + encodeURIComponent(state.live.eventId || ""));
        state.live = data.live; state.nearby = data.nearby || [];
        state.overlay = { type: "live" }; render(); return;
      }
      if (act === "toggle-live") {
        const on = !state.live.on;
        const evId = id || state.live.eventId;
        const data = await api("/api/live", { method: "POST", body: { on, eventId: evId, meetupSpot: state.live.meetupSpot } });
        state.live = data.live;
        const near = await api("/api/live?eventId=" + encodeURIComponent(state.live.eventId || evId || ""));
        state.nearby = near.nearby || [];
        await loadEvents(); render(); return;
      }
      if (act === "live-event") {
        state.live.eventId = id;
        if (state.live.on) await api("/api/live", { method: "POST", body: { on: true, eventId: id, meetupSpot: state.live.meetupSpot } });
        const near = await api("/api/live?eventId=" + encodeURIComponent(id));
        state.nearby = near.nearby || [];
        render(); return;
      }
      if (act === "spot") {
        state.live.meetupSpot = id;
        if (state.live.on) await api("/api/live", { method: "POST", body: { on: true, eventId: state.live.eventId, meetupSpot: id } });
        render(); return;
      }
      if (act === "chat") {
        const m = state.matches.find((x) => String(x.user.id) === String(id));
        state.chatWith = m ? m.user : { id: Number(id), name: "Chat" };
        const data = await api("/api/chats/" + id);
        state.chat = data.messages;
        state.drafts.chat = "";
        state.overlay = { type: "chat", id: Number(id) };
        render(); scrollChatToEnd(); return;
      }
      if (act === "send-chat") {
        const text = state.drafts.chat.trim();
        if (!text || !state.chatWith) return;
        const data = await api("/api/chats/" + state.chatWith.id, { method: "POST", body: { text } });
        if (!state.chat.some((m) => m.id === data.message.id)) state.chat.push(data.message);
        state.drafts.chat = "";
        render(); scrollChatToEnd(); return;
      }
      if (act === "share-loc") { state.overlay = { type: "share", with: "Riley (trusted friend)" }; render(); return; }
      if (act === "share-with") { state.overlay = Object.assign({}, state.overlay, { with: id }); render(); return; }
      if (act === "confirm-share") {
        const evName = (state.events.find((e) => e.id === state.live.eventId) || {}).name || "";
        const data = await api("/api/safety/share", { method: "POST", body: { with: (state.overlay && state.overlay.with) || "Riley (trusted friend)", event: evName } });
        state.locationShare = { with: (state.overlay && state.overlay.with) || "Riley", event: evName };
        state.overlay = null; render(); return;
      }
      if (act === "report") { state.overlay = { type: "report", id: Number(id), reason: "" }; render(); return; }
      if (act === "report-reason") { state.overlay.reason = id; render(); return; }
      if (act === "confirm-block") {
        await api("/api/report", { method: "POST", body: { userId: state.overlay.id, reason: state.overlay.reason || "Something else" } });
        state.overlay = null; await refreshAll(); render(); return;
      }
      if (act === "unblock") { await api("/api/blocks/" + id + "/unblock", { method: "POST", body: {} }); await loadBlocks(); render(); return; }
    } catch (e) {
      if (e.data && e.data.code === "plus_required") {
        state.overlay = { type: "paywall", reason: e.data.reason || "upgrade" };
        render();
        return;
      }
      state.err = e.message || "Something went wrong. Try again.";
      render();
      if (state.view === "app" || state.view === "onboard") toast(state.err, "err");
    }
  }

  const root = document.getElementById("app");
  // Actions that only change local UI never need a busy guard.
  const INSTANT = new Set(["close", "show-signup", "show-login", "tab", "feed-tab", "billing", "pick-plan", "report-reason", "share-with",
    "set-genre", "set-event-filter", "event-cat", "post-event", "like-chip", "pick-prompt", "dismiss-ios-tip", "dismiss-photo-nudge",
    "edit-profile", "paywall", "remove-post-photo", "report", "report-post", "want-like", "delete-account", "share-loc", "onboard-back", "post-like-tap", "filters"]);
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest && t.closest("input[type=file], .file-sr, label[for^='kandi-file-']")) return;
    // Tapping the dimmed backdrop of a bottom sheet closes it; taps inside the sheet never do.
    if (t.classList && t.classList.contains("sheet-bg")) { e.preventDefault(); state.err = ""; handle("close", t); return; }
    const actEl = t.closest("[data-act]");
    if (!actEl || !root.contains(actEl)) return;
    if (actEl.classList.contains("sheet-bg")) return; // a tap on a field, label or text inside the sheet
    if (actEl.disabled || actEl.getAttribute("aria-disabled") === "true") return;
    e.preventDefault();
    const act = actEl.getAttribute("data-act");
    if (INSTANT.has(act)) { handle(act, actEl); return; }
    const key = act + ":" + (actEl.getAttribute("data-id") || "");
    if (busyActs.has(key)) return; // ignore double taps while the first one is still working
    busyActs.add(key);
    actEl.classList.add("busy");
    actEl.setAttribute("aria-busy", "true");
    Promise.resolve(handle(act, actEl)).finally(() => {
      busyActs.delete(key);
      document.querySelectorAll("[data-act].busy").forEach((n) => {
        const k = n.getAttribute("data-act") + ":" + (n.getAttribute("data-id") || "");
        if (!busyActs.has(k)) { n.classList.remove("busy"); n.removeAttribute("aria-busy"); }
      });
    });
  });
  // Keyboard users: Enter/Space on non-button elements that carry an action.
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (!t || !t.getAttribute || !t.getAttribute("data-act") || /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    t.click();
  });
  root.addEventListener("input", (e) => {
    const field = e.target.getAttribute("data-field");
    if (!field) return;
    let v = e.target.value;
    if (field === "user") {
      v = v.toLowerCase();
      if (e.target.value !== v) e.target.value = v;
    }
    state.drafts[field] = v;
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.getAttribute("data-field") === "commentText") {
      e.preventDefault();
      handle("send-comment", e.target);
    }
    if (e.key === "Enter" && e.target.getAttribute("data-field") === "chat") {
      e.preventDefault();
      const send = document.querySelector("[data-act=send-chat]");
      if (send) handle("send-chat", send);
    }
    if (e.key === "Enter" && (e.target.getAttribute("data-field") === "pass" || e.target.getAttribute("data-field") === "user")) {
      e.preventDefault();
      handle(state.overlay && state.overlay.type === "signup" ? "signup" : "login", e.target);
    }
  });
  async function onPickedFile(e) {
    const kind = e.target.getAttribute("data-act-file");
    if (kind === "post-photo") {
      const picked = Array.from((e.target.files) || []);
      if (!picked.length) return;
      const list = state.drafts.postFiles || (state.drafts.postFiles = []);
      const room = MAX_POST_PHOTOS - list.length;
      picked.slice(0, Math.max(0, room)).forEach((file) => list.push({ file, url: URL.createObjectURL(file) }));
      if (picked.length > room) toast(`Up to ${MAX_POST_PHOTOS} photos per post — added the first ${Math.max(0, room)}.`, "warn");
      e.target.value = "";
      render();
      return;
    }
    if (kind === "claim-photo") {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (state.drafts.claimPreview && String(state.drafts.claimPreview).startsWith("blob:")) {
        try { URL.revokeObjectURL(state.drafts.claimPreview); } catch (_) {}
      }
      state.drafts.claimFile = file;
      state.drafts.claimPreview = URL.createObjectURL(file);
      render();
      return;
    }
    if (kind === "upload-photo" || kind === "upload-photo-main") {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      await uploadProfilePhoto(file, kind === "upload-photo-main");
      e.target.value = "";
    }
  }
  root.addEventListener("change", onPickedFile);
  root.addEventListener("input", onPickedFile);

  // Multi-photo posts: keep the "2/5" counter in sync while swiping.
  root.addEventListener("scroll", (e) => {
    const c = e.target;
    if (!c || !c.classList || !c.classList.contains("post-carousel")) return;
    const n = c.children.length;
    const i = Math.min(n, Math.round(c.scrollLeft / Math.max(1, c.clientWidth)) + 1);
    const badge = c.parentNode && c.parentNode.querySelector(".carousel-count");
    if (badge) badge.textContent = i + "/" + n;
  }, true);

  let dragFrom = null;
  root.addEventListener("dragstart", (e) => {
    const slot = e.target.closest && e.target.closest("[data-drag-i]");
    if (!slot) return;
    dragFrom = Number(slot.getAttribute("data-drag-i"));
    try { e.dataTransfer.setData("text/plain", String(dragFrom)); e.dataTransfer.effectAllowed = "move"; } catch (_) {}
  });
  root.addEventListener("dragover", (e) => {
    const slot = e.target.closest && e.target.closest("[data-drag-i]");
    if (!slot) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
  });
  root.addEventListener("drop", async (e) => {
    const slot = e.target.closest && e.target.closest("[data-drag-i]");
    if (!slot) return;
    e.preventDefault();
    const to = Number(slot.getAttribute("data-drag-i"));
    const from = dragFrom;
    dragFrom = null;
    const photos = (state.me && state.me.photos) || [];
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= photos.length || to >= photos.length) return;
    const order = photos.map((_, n) => n);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    try {
      const data = await api("/api/me/photos", { method: "PUT", body: { order } });
      state.me = data.user;
      render();
    } catch (err) {
      toast(err.message || "Couldn't reorder photos.", "err");
    }
  });

  // Never fail silently: surface unexpected script errors as a visible toast.
  window.addEventListener("error", (ev) => {
    if (ev && ev.target && ev.target !== window) return; // broken image etc.
    toast("Something glitched: " + ((ev && ev.message) || "unknown error") + ". Try again.", "err");
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev && ev.reason;
    toast((r && r.message) || "Something didn't finish. Try again.", "err");
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
      .then((reg) => { try { reg.update(); } catch (_) {} })
      .catch(() => { /* not supported inside some iOS app WebViews; the app works without it */ });
  }
  // If a newer build is deployed while the app sits open in the background, reload into it on return.
  const BOOT_BUILD = (document.querySelector('script[src*="app.js"]') || {}).src || "";
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || state.overlay || !BOOT_BUILD.includes("?v=")) return;
    fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then((v) => {
      if (v && v.build && !BOOT_BUILD.includes("v=" + v.build)) location.reload();
    }).catch(() => {});
  });
  if (window.matchMedia("(display-mode: standalone)").matches) document.body.classList.add("standalone");
  boot();
})();
