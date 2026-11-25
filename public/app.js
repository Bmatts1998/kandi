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
    tab: "discover",
    overlay: null,
    feed: [],
    inbound: { locked: true, count: 0, people: [] },
    matches: [],
    events: [],
    live: { on: false },
    nearby: [],
    chat: [],
    chatWith: null,
    blocked: [],
    locationShare: null,
    drafts: { user: "", pass: "", name: "", age: "", comment: "", chat: "", promptQ: "", promptA: "" },
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
  function beads(n, size) {
    n = n || 8;
    return '<div class="beads" aria-hidden="true">' + Array.from({ length: n }, (_, i) =>
      `<span class="bead ${size || ""}" style="color:${BEADS[i % BEADS.length]};background:${BEADS[i % BEADS.length]}"></span>`
    ).join("") + "</div>";
  }
  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
      body: opts && opts.body && typeof opts.body !== "string" && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : (opts && opts.body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  let ws;
  function connectWs() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws");
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "message" && state.overlay && state.overlay.type === "chat" && state.chatWith && msg.from && msg.from.id === state.chatWith.id) {
        state.chat.push(msg.message);
        render();
      } else if (msg.type === "message") {
        loadMatches();
      } else if (msg.type === "match") {
        loadMatches();
        loadFeed();
      } else if (msg.type === "like") {
        loadInbound();
      }
    };
  }

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
    try {
      const me = await api("/api/me");
      applyMe(me);
      if (needsOnboard(state.me)) state.view = "onboard";
      else state.view = "app";
      connectWs();
      await refreshAll();
    } catch {
      state.view = "auth";
    }
    render();
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

  async function refreshAll() {
    await Promise.all([loadFeed(), loadInbound(), loadMatches(), loadEvents(), loadBlocks()]);
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
    state.events = data.events;
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
      ["discover", "✦", "Discover"],
      ["likes", "♡", "Likes You"],
      ["events", "✺", "Events"],
      ["matches", "✉", "Matches"],
      ["you", "●", "You"],
    ];
    return `<nav class="tabbar">${items.map((t) => {
      const on = state.tab === t[0];
      let badge = "";
      if (t[0] === "likes" && state.inbound.count) badge = `<span class="badge">${state.inbound.count}</span>`;
      if (t[0] === "matches" && state.matches.length) badge = `<span class="badge">${state.matches.length}</span>`;
      return `<button class="tab${on ? " on" : ""}" data-act="tab" data-id="${t[0]}"><span class="ic">${t[1]}</span>${t[2]}${badge}</button>`;
    }).join("")}</nav>`;
  }

  function photoEl(p, i, showWho) {
    const ph = (p.photos || [])[i] || (p.photos || [])[0];
    if (!ph) return "";
    const liked = false;
    const caption = ph.caption || "";
    if (ph.type === "file" && ph.url) {
      return `<div class="photo file" style="background-image:url('${esc(ph.url)}')">${showWho ? `<div class="who"><div class="nm">${esc(p.name)}, ${p.age}</div></div>` : ""}
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
      <input data-field="claimPass" type="password" placeholder="Password (8+ characters)" value="${esc(state.drafts.claimPass || "")}" style="margin-top:16px" autocomplete="new-password" />
      <input data-field="claimAge" inputmode="numeric" maxlength="2" placeholder="Your age (18+)" value="${esc(state.drafts.claimAge || "")}" style="margin-top:8px" />
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
        <input id="f-name" data-field="name" placeholder="Name" value="${esc(state.drafts.name)}" style="margin-top:24px" />
        <input id="f-age" data-field="age" inputmode="numeric" maxlength="2" placeholder="Age (18+)" value="${esc(state.drafts.age)}" style="margin-top:8px" />
        <input id="f-user" data-field="user" placeholder="Username" value="${esc(state.drafts.user)}" style="margin-top:8px" autocapitalize="none" autocomplete="username" autocorrect="off" spellcheck="false" inputmode="text" />
        <input id="f-pass" data-field="pass" type="password" placeholder="Password (8+ characters)" value="${esc(state.drafts.pass)}" style="margin-top:8px" />
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        <button class="btn primary" data-act="signup" style="margin-top:16px">Create account</button>
        <button class="btn ghost" data-act="show-login" style="margin-top:8px">I already have an account</button>
        <p class="tiny" style="margin-top:16px"><a href="/privacy" style="color:var(--muted)">Privacy</a> · <a href="/terms" style="color:var(--muted)">Terms</a> · 18+ only</p>
      ` : `
        <input id="f-user" data-field="user" placeholder="Username" value="${esc(state.drafts.user)}" style="margin-top:24px" autocapitalize="none" autocomplete="username" autocorrect="off" spellcheck="false" inputmode="text" />
        <input id="f-pass" data-field="pass" type="password" placeholder="Password" value="${esc(state.drafts.pass)}" style="margin-top:8px" />
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
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
      body = `<div class="label">Upcoming events</div><p class="example" style="margin-bottom:8px">Example events · sample data</p><div class="chips">${(state.events.length ? state.events : []).map((e) =>
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
      body = `<p class="sub">Upload a photo of yourself, or skip and add one later. Placeholder photos are fine for testing.</p>
        <div class="card photo-upload" style="margin-top:16px;padding:28px;text-align:center">
          <div>📷 Tap to upload a photo</div>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-act-file="upload-photo" />
        </div>
        <div class="stack" style="padding:12px 0">${(me.photos || []).map((ph, i) => photoEl({ ...me, name: me.name, age: me.age, photos: me.photos }, i, false)).join("")}</div>`;
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
      <button class="icon-btn" data-act="filters" title="Filters">✺</button>`;
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
        <button class="round pass" data-act="pass" data-id="${p.id}" aria-label="Pass">✕</button>
        <button class="round rewind" data-act="rewind" aria-label="Rewind">↺</button>
      </div>
      <p class="tiny" style="text-align:center;padding-bottom:8px">Like a photo or a prompt — or add a comment.</p></div>`;
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
        <p class="tiny" style="text-align:center;margin-top:10px">Example pricing · payment is stubbed, no real charges</p></div>`;
    }
    if (!state.inbound.people.length) {
      return head + `<div class="scroll pad"><div class="empty"><p>No new likes right now. When someone likes a photo or prompt, they'll land here.</p></div></div>`;
    }
    return head + `<div class="scroll pad">${state.inbound.people.map((p) => {
      const info = p.liked || {};
      const detail = info.type === "prompt" ? ((p.prompts.find((x) => x.id === info.targetId) || {}).q || "a prompt") : "a photo";
      return `<div class="card" style="margin-bottom:10px"><div class="row">
        <div class="av" style="width:56px;height:56px;font-size:26px;background:${esc((p.photos[0] && p.photos[0].gradient) || "#111111")}">${(p.photos[0] && p.photos[0].emoji) || "💫"}</div>
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
    let html = header("Events", liveBtn) + `<div class="scroll pad"><p class="example">Example events · sample data</p>
      <p class="sub" style="margin:6px 0 14px">Mark where you're going so people can find you on the floor.</p>`;
    state.events.forEach((e) => {
      html += `<button class="event" data-act="event" data-id="${e.id}" style="margin-bottom:10px">
        <div class="thumb" style="background:${esc(e.color)}">${e.emoji}</div>
        <div class="grow"><div style="font-weight:800">${esc(e.name)} ${e.imGoing ? `<span class="chip soft">You're going</span>` : ""}</div>
        <div class="muted">${esc(e.date)} · ${esc(e.city)}</div>
        <div class="tiny" style="margin-top:4px">${e.going.length} ravers going · ${e.genres.join(", ")}</div></div></button>`;
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
        <div class="av" style="width:52px;height:52px;font-size:24px;background:${esc((p.photos[0] && p.photos[0].gradient) || "#111111")}">${(p.photos[0] && p.photos[0].emoji) || "💫"}</div>
        <div class="grow"><div style="font-weight:800">${esc(p.name)}</div>
        <div class="muted">${esc(last ? last.text : "You matched. Say hi.")}</div></div></button>`;
    });
    return html + "</div>";
  }

  function viewYou() {
    const p = state.me;
    const plan = p.subscription ? (p.subscription === "vip" ? "Kandi VIP" : "Kandi+") : "Free";
    let html = header("You") + `<div class="scroll pad">`;
    html += `<div class="photo" style="background:linear-gradient(160deg,#000000,#ff5c00 60%,#ffc14d);height:220px"><div class="who"><div class="nm">${esc(p.name)}${p.age ? ", " + p.age : ""}</div></div><div class="emoji">💫</div></div>`;
    html += `<div class="chips" style="margin:12px 0">${p.vibes.map((v) => `<span class="chip soft">${esc(v)}</span>`).join("")}</div>`;
    html += `<div class="muted">@${esc(p.username)} · looking for ${p.looking.map((id) => LOOKING_LABEL[id] || id).join(", ")}</div>`;
    (p.prompts || []).forEach((pr) => {
      html += `<div class="prompt" style="padding-bottom:20px;margin-top:12px"><div class="q">${esc(pr.q)}</div><div class="a" style="font-size:18px">${esc(pr.a)}</div></div>`;
    });
    html += `<div class="card photo-upload" style="margin-top:16px;text-align:center"><div>📷 Add another photo</div>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-act-file="upload-photo" /></div>`;
    html += `<div class="card" style="margin-top:16px"><div class="row"><div class="grow"><div style="font-weight:800">${plan}</div>
      <div class="tiny">${p.subscription ? "Stub subscription — no real payment on file. TODO: Stripe / IAP." : "Free to use. Upgrade for unlimited likes and more."}</div></div>
      ${p.subscription ? `<button class="btn sm ghost" data-act="cancel-sub">Cancel stub</button>` : `<button class="btn sm primary" data-act="paywall" data-reason="upgrade">See Kandi+</button>`}
    </div>`;
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
      <p class="tiny" style="text-align:center;margin-top:8px">Kandi v1 · Add to Home Screen in Safari for the full app</p></div>`;
    return html;
  }

  function overlays() {
    const o = state.overlay;
    if (!o) return "";
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
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close">✕</button><span class="wordmark grad" style="font-size:15px">Kandi+</span></div></div>
        <div class="scroll pad">${beads(8)}
        <h2 class="h2" style="text-align:center;margin:12px 0 6px">Stay on the floor longer.</h2>
        <p class="example" style="text-align:center;margin:12px 0">Example pricing · payment stub · no real charges<br>TODO: Stripe or Apple / Google in-app purchase</p>
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
        <button class="btn primary" style="margin-top:18px" data-act="buy">Activate ${pending === "vip" ? "Kandi VIP" : "Kandi+"} (demo)</button>
        <p class="tiny" style="text-align:center;margin-top:10px">Nothing will be charged.</p></div></div>`;
    }
    if (o.type === "purchased") {
      return `<div class="overlay"><div class="match-wrap">${beads(8, "lg")}<h2>You're in.</h2>
        <p class="sub">Demo only — no payment was taken. TODO: hook up Stripe or in-app purchases before launch.</p>
        <button class="btn primary" style="margin-top:24px;max-width:280px" data-act="close">Start using it</button></div></div>`;
    }
    if (o.type === "match") {
      const p = o.person;
      return `<div class="overlay"><div class="match-wrap">
        <div class="avatars"><div class="av" style="background:linear-gradient(160deg,#000000,#ff5c00)">💫</div>${beads(5, "sm")}
        <div class="av" style="background:${esc((p.photos[0] && p.photos[0].gradient) || "#111111")}">${(p.photos[0] && p.photos[0].emoji) || "💫"}</div></div>
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
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close">✕</button><span style="font-weight:800">${esc(e.name)}</span></div></div>
        <div class="scroll pad"><div class="photo" style="background:${esc(e.color)};height:180px"><div class="emoji">${e.emoji}</div></div>
        <p class="example" style="margin:12px 0 6px">${e.isExample ? "Example event · sample data" : "Event"}</p>
        <div class="muted">${esc(e.date)} · ${esc(e.venue)} · ${esc(e.city)}</div>
        <div class="row" style="margin:14px 0"><div class="grow"><div style="font-weight:700">I'm going</div></div>
          <button class="toggle${e.imGoing ? " on" : ""}" data-act="toggle-going" data-id="${e.id}" aria-label="I'm going"><i></i></button></div>
        ${!isVip() ? `<button class="btn ghost" style="margin-bottom:12px" data-act="paywall" data-reason="priority">Get priority at events with Kandi VIP</button>` : `<div class="notice ok" style="margin-bottom:12px">Kandi VIP priority is on.</div>`}
        <div class="label">Who's going</div>
        ${e.going.map((p) => `<div class="row card" style="margin-bottom:8px"><div class="av" style="width:48px;height:48px;font-size:22px;background:${esc((p.photos[0] && p.photos[0].gradient) || "#111111")}">${(p.photos[0] && p.photos[0].emoji) || "💫"}</div>
          <div class="grow"><div style="font-weight:700">${esc(p.name)}, ${p.age}${isVip() && p.subscription === "vip" ? ' <span class="vip">Priority</span>' : ""}</div>
          <div class="tiny">${p.vibes.join(" · ")}</div></div></div>`).join("")}
        <button class="btn primary" style="margin-top:8px" data-act="open-live" data-id="${e.id}">Open at-the-show live mode</button></div></div>`;
    }
    if (o.type === "live") {
      const options = state.events.filter((e) => e.imGoing).length ? state.events.filter((e) => e.imGoing) : state.events;
      const eid = state.live.eventId || (options[0] && options[0].id);
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close">✕</button><span class="wordmark grad" style="font-size:15px">At the show</span></div>
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
            <div class="av" style="width:48px;height:48px;font-size:22px;background:${esc((p.photos[0] && p.photos[0].gradient) || "#111111")}">${(p.photos[0] && p.photos[0].emoji) || "💫"}</div>
            <div class="grow"><div style="font-weight:700">${esc(p.name)}, ${p.age}</div>
            <div class="tiny">${esc(p.meetupSpot || "At this event")} · ${p.vibes.slice(0, 2).join(", ")}</div></div></button>`).join("")}
        `}</div></div>`;
    }
    if (o.type === "chat") {
      const p = state.chatWith;
      if (!p) return "";
      return `<div class="overlay" style="background:var(--bg);display:flex;flex-direction:column">
        <div class="header"><div class="left"><button class="icon-btn" data-act="close">‹</button>
        <span style="font-weight:800">${esc(p.name)}</span></div>
        <div class="right"><button class="icon-btn" data-act="report" data-id="${p.id}" title="Report or block">⚑</button></div></div>
        <div class="notice warn" style="margin:0 16px 8px">Consent reminder: be direct, accept a no, and don't pressure anyone to meet or hook up.</div>
        <div class="scroll chat-log">${state.chat.map((m) => `<div class="bubble ${m.fromId === state.me.id ? "me" : "them"}">${esc(m.text)}</div>`).join("") || `<div class="tiny" style="text-align:center">You matched on Kandi. Say hi.</div>`}</div>
        <div class="chat-bar"><input data-field="chat" placeholder="Say something..." value="${esc(state.drafts.chat)}" />
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
    if (state.view === "boot") html = `<div class="screen splash top-pad"><div class="inner">${beads(8, "lg")}<h1 class="wordmark grad">Kandi</h1></div></div>`;
    else if (state.view === "claim") html = viewClaim();
    else if (state.view === "auth") html = viewAuth();
    else if (state.view === "onboard") html = viewOnboard();
    else {
      let body = "";
      if (state.tab === "discover") body = viewDiscover();
      else if (state.tab === "likes") body = viewLikes();
      else if (state.tab === "events") body = viewEvents();
      else if (state.tab === "matches") body = viewMatches();
      else body = viewYou();
      html = `<div class="screen">${body}${tabbar()}${overlays()}</div>`;
    }
    root.innerHTML = html;
  }

  async function handle(act, el) {
    const id = el && el.getAttribute("data-id");
    try {
      state.err = "";
      if (act === "dismiss-ios-tip") { localStorage.setItem("kandi-hide-ios-tip", "1"); render(); return; }
      if (act === "claim-finish") {
        const password = (state.drafts.claimPass || "").trim();
        const age = Number(state.drafts.claimAge);
        const data = await api("/api/claim", { method: "POST", body: { token: state.claimToken, password, age } });
        applyMe(data);
        connectWs();
        history.replaceState({}, "", "/");
        state.view = needsOnboard(state.me) ? "onboard" : "app";
        state.overlay = null;
        if (state.view === "app") await refreshAll();
        render(); return;
      }
      if (act === "show-signup") { state.overlay = { type: "signup" }; render(); return; }
      if (act === "show-login") { state.overlay = null; render(); return; }
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
        connectWs();
        await refreshAll();
        state.view = needsOnboard(state.me) ? "onboard" : "app";
        state.overlay = null;
        render(); return;
      }
      if (act === "logout") { await api("/api/logout", { method: "POST", body: {} }); state.me = null; state.view = "auth"; render(); return; }
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
        state.view = "app"; await refreshAll(); render(); return;
      }
      if (act === "onboard-back") { state.onboardStep = Math.max(0, state.onboardStep - 1); render(); return; }
      if (act === "tab") { state.tab = id; state.overlay = null; if (id === "likes") await loadInbound(); if (id === "matches") await loadMatches(); if (id === "events") await loadEvents(); render(); return; }
      if (act === "close") { state.overlay = null; render(); return; }
      if (act === "filters") {
        if (!isPlus()) { state.overlay = { type: "paywall", reason: "filters" }; render(); return; }
        state.overlay = { type: "filters" }; render(); return;
      }
      if (act === "set-genre") { state.filters.genre = id; render(); return; }
      if (act === "set-event-filter") { state.filters.event = id; render(); return; }
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
      if (act === "event") { state.overlay = { type: "event", id }; render(); return; }
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
        render(); return;
      }
      if (act === "send-chat") {
        const text = state.drafts.chat.trim();
        if (!text || !state.chatWith) return;
        const data = await api("/api/chats/" + state.chatWith.id, { method: "POST", body: { text } });
        state.chat.push(data.message);
        state.drafts.chat = "";
        render(); return;
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
      state.err = e.message || "Something went wrong";
      render();
      if (state.view === "app") alert(state.err);
    }
  }

  const root = document.getElementById("app");
  root.addEventListener("click", (e) => {
    if (e.target.classList && e.target.classList.contains("sheet-bg")) { state.overlay = null; render(); return; }
    const actEl = e.target.closest("[data-act]");
    if (!actEl) return;
    e.preventDefault();
    handle(actEl.getAttribute("data-act"), actEl);
  });
  root.addEventListener("input", (e) => {
    const field = e.target.getAttribute("data-field");
    if (!field) return;
    if (field === "user" || field === "pass" || field === "name" || field === "age" || field === "comment" || field === "chat" || field === "promptA") {
      let v = e.target.value;
      if (field === "user") {
        v = v.toLowerCase();
        if (e.target.value !== v) e.target.value = v;
      }
      state.drafts[field === "comment" ? "comment" : field] = v;
    }
    if (field === "claimPass" || field === "claimAge") {
      state.drafts[field] = e.target.value;
    }
  });
  root.addEventListener("keydown", (e) => {
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
  root.addEventListener("change", async (e) => {
    if (e.target.getAttribute("data-act-file") !== "upload-photo") return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    try {
      const res = await fetch("/api/me/photo", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      state.me = data.user;
      render();
    } catch (err) {
      alert(err.message);
    }
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  if (window.matchMedia("(display-mode: standalone)").matches) document.body.classList.add("standalone");
  boot();
})();
