/* Kandi — Find My Crew (show-day crews). Loaded before app.js; app.js calls KandiShowCrew.init(ctx).
   Server API: src/show-crew.js. Everything here is web-only (browser geolocation, no native plugins). */
(function () {
  "use strict";
  let ctx = null;
  let gpsTimer = null;
  let gpsEvent = null;
  const GPS_EVERY_MS = 3 * 60 * 1000;
  const NOTE_CHIPS = ["rail left side", "rail right side", "by the Ferris wheel", "near the sound booth", "back by the bar", "at the merch tent", "water station", "leaving soon"];
  const PIN_CHIPS = ["Ferris wheel", "Sound booth", "Merch tent", "Main entrance", "Water station", "Left speaker stack"];

  const S = () => ctx.state;
  const esc = (s) => ctx.esc(s);
  const shareKey = (id) => "kandiCrewShare:" + id;
  const wantsShare = (id) => { try { return localStorage.getItem(shareKey(id)) === "1"; } catch (_) { return false; } };
  const setWantsShare = (id, on) => { try { on ? localStorage.setItem(shareKey(id), "1") : localStorage.removeItem(shareKey(id)); } catch (_) {} };
  const crew = () => S().showCrew || null;
  const enc = encodeURIComponent;

  function ago(iso) {
    if (!iso) return "";
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 60000) return "just now";
    const m = Math.round(ms / 60000);
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    return h + " hr ago";
  }
  function endsLabel(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) + " MT";
    } catch (_) { return ""; }
  }
  function meters(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function bearing(a, b) {
    const rad = Math.PI / 180;
    const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }
  function compass(deg) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8]; }
  function distLabel(m) { return m < 1000 ? Math.max(5, Math.round(m / 5) * 5) + " m" : (m / 1609.34).toFixed(1) + " mi"; }
  function away(meLoc, loc) {
    if (!meLoc || !loc) return "";
    const d = meters(meLoc, loc);
    return d < 15 ? "right by you" : distLabel(d) + " " + compass(bearing(meLoc, loc));
  }
  function mapsUrl(loc, label) {
    return "https://maps.apple.com/?ll=" + loc.lat + "," + loc.lng + "&q=" + enc(label || "Crew");
  }
  function avatar(u, cls) { return ctx.personAvatar(u || {}, cls || "av sm"); }
  function firstName(u) { return String((u && (u.name || u.username)) || "Someone").split(/\s+/)[0]; }

  // ---------- data ----------
  async function load(eventId) {
    const c = crew();
    const data = await ctx.api("/api/show-crew/" + enc(eventId));
    if (crew() !== c) return data;
    S().showCrew = Object.assign({}, c || {}, { eventId: String(eventId), data, loading: false });
    return data;
  }
  async function loadToday() {
    try {
      const data = await ctx.api("/api/show-crew/today");
      S().showCrewToday = data.crews || [];
    } catch (_) { S().showCrewToday = S().showCrewToday || []; }
    return S().showCrewToday;
  }

  // ---------- GPS (opt-in, only while the crew screen is open) ----------
  function stopGps() { if (gpsTimer) clearInterval(gpsTimer); gpsTimer = null; gpsEvent = null; }
  function sendPosition(eventId, quietFail) {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { if (!quietFail) ctx.toast("Location isn't available on this device. Use a location note instead.", "err"); return resolve(false); }
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const data = await ctx.api("/api/show-crew/" + enc(eventId) + "/location", { method: "POST", body: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } });
          const c = crew();
          if (c && c.eventId === String(eventId)) { c.data = data; ctx.render(); }
          resolve(true);
        } catch (err) { if (!quietFail) ctx.toast(err.message, "err"); resolve(false); }
      }, (err) => {
        if (!quietFail) {
          ctx.toast(err && err.code === 1 ? "Location is off for Kandi. You can still share a location note." : "Couldn't get your location. Try again in a spot with better signal.", "err");
        }
        if (err && err.code === 1) { setWantsShare(eventId, false); stopGps(); }
        resolve(false);
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    });
  }
  function ensureGps() {
    const c = crew();
    const o = S().overlay;
    const open = o && o.type === "showCrew" && c && c.data && c.data.status === "active" && c.data.me && !c.data.me.left;
    if (!open || !wantsShare(c.eventId)) { stopGps(); return; }
    if (gpsTimer && gpsEvent === c.eventId) return;
    stopGps();
    gpsEvent = c.eventId;
    gpsTimer = setInterval(() => {
      const cur = crew();
      const ov = S().overlay;
      if (!cur || !ov || ov.type !== "showCrew" || cur.eventId !== gpsEvent || document.hidden) { if (!ov || ov.type !== "showCrew") stopGps(); return; }
      sendPosition(gpsEvent, true);
    }, GPS_EVERY_MS);
  }
  document.addEventListener("visibilitychange", () => {
    const c = crew();
    if (!document.hidden && gpsTimer && c && c.eventId === gpsEvent) sendPosition(gpsEvent, true);
  });

  // ---------- views ----------
  function radar(d) {
    const meLoc = d.me && d.me.location;
    if (!meLoc) return "";
    const pts = [];
    d.members.forEach((m) => { if (m.location) pts.push({ kind: "m", loc: m.location, label: firstName(m.user), u: m.user, fresh: m.location.fresh }); });
    d.pins.forEach((p) => { if (p.lat != null && p.lng != null) pts.push({ kind: "p", loc: { lat: p.lat, lng: p.lng }, label: p.label }); });
    if (!pts.length) return "";
    const far = Math.max(60, ...pts.map((p) => meters(meLoc, p.loc)));
    const scale = Math.min(far * 1.15, 3000);
    const R = 120;
    const dots = pts.map((p) => {
      const dist = Math.min(meters(meLoc, p.loc), scale);
      const b = bearing(meLoc, p.loc) * Math.PI / 180;
      const r = (dist / scale) * (R - 14);
      const x = R + r * Math.sin(b), y = R - r * Math.cos(b);
      if (p.kind === "p") return `<g class="sc-rpin"><rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" rx="2" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"></rect><text x="${x.toFixed(1)}" y="${(y + 20).toFixed(1)}">${esc(p.label.length > 16 ? p.label.slice(0, 15) + "…" : p.label)}</text></g>`;
      return `<g class="sc-rdot${p.fresh ? "" : " stale"}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11"></circle><text class="ini" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${esc(p.label.charAt(0).toUpperCase())}</text><text x="${x.toFixed(1)}" y="${(y + 25).toFixed(1)}">${esc(p.label.slice(0, 12))}</text></g>`;
    }).join("");
    return `<div class="sc-radar" aria-label="Where your crew is, relative to you">
      <svg viewBox="0 0 ${R * 2} ${R * 2}" role="img"><circle class="ring" cx="${R}" cy="${R}" r="${R - 2}"></circle><circle class="ring" cx="${R}" cy="${R}" r="${(R - 2) * 0.66}"></circle><circle class="ring" cx="${R}" cy="${R}" r="${(R - 2) * 0.33}"></circle>
      <text class="north" x="${R}" y="14">N</text>${dots}<circle class="me" cx="${R}" cy="${R}" r="7"></circle></svg>
      <div class="tiny sc-radar-cap">Edge of the circle ≈ ${distLabel(scale)} · approximate</div></div>`;
  }

  function memberRow(m, meLoc) {
    const loc = m.location;
    const where = loc ? away(meLoc, loc) : "";
    return `<div class="sc-member">
      ${avatar(m.user, "av sm")}
      <div class="grow"><div class="sc-name">${esc(m.user && m.user.name)}</div>
        <div class="sc-note">${m.note ? "📍 " + esc(m.note) : `<span class="dim">No location note yet</span>`}</div>
        ${loc ? `<div class="tiny">${where ? esc(where) + " · " : ""}GPS ${esc(ago(loc.at))}${loc.fresh ? "" : " (old)"}</div>` : ""}
      </div>
      ${loc ? `<a class="btn sm ghost" href="${esc(mapsUrl(loc, m.user && m.user.name))}" target="_blank" rel="noopener">Map</a>` : ""}
    </div>`;
  }

  function overlayHtml(o) {
    const c = crew();
    const close = `<button class="icon-btn" data-act="close" aria-label="Close">✕</button>`;
    const head = (title) => `<div class="header"><div class="left">${close}<span class="sc-title">${title}</span></div><div class="right"><button class="icon-btn" data-act="screw-refresh" data-id="${esc(o.id)}" aria-label="Refresh">↻</button></div></div>`;
    if (!c || !c.data || String(c.eventId) !== String(o.id)) {
      return `<div class="overlay top-pad sc">${head("Find My Crew")}<div class="scroll pad"><p class="sub"><span class="spin"></span> Finding your crew…</p></div></div>`;
    }
    const d = c.data;
    const ev = d.event || {};
    const drafts = S().drafts || {};
    const top = `<div class="sc-hero"><div class="sc-kicker">Find My Crew</div><div class="sc-show">${esc(ev.name || "This show")}</div>
      <div class="tiny">${esc([ev.venue, ev.city].filter(Boolean).join(" · "))}${d.expiresAt && d.status === "active" ? ` · Clears ${esc(endsLabel(d.expiresAt))}` : ""}</div></div>`;
    let body = "";
    if (d.status === "not_going") {
      body = `<div class="empty"><p>Mark yourself going to this show to open its crew. Your friends and matches who are going will show up here on show day.</p>
        <button class="btn primary" style="margin-top:12px" data-act="event" data-id="${esc(ev.id)}">Open show</button></div>`;
    } else if (d.status === "ended") {
      body = `<div class="empty"><p>This show's crew has ended. Notes, pins and locations were deleted.</p></div>`;
    } else if (d.status === "no_time") {
      body = `<div class="empty"><p>This show doesn't have a start time yet, so its crew can't open.</p></div>`;
    } else if (d.status === "upcoming") {
      body = `<div class="notice">Your crew opens on show day${d.opensAt ? " (" + esc(endsLabel(d.opensAt)) + ")" : ""}. Everything clears at 6 AM the morning after.</div>
        <div class="label" style="margin-top:16px">Going with you (${d.members.length})</div>
        ${d.members.length ? d.members.map((m) => `<div class="sc-member">${avatar(m.user)}<div class="grow sc-name">${esc(m.user && m.user.name)}</div></div>`).join("") : `<p class="tiny">None of your friends or matches are going yet.</p>`}`;
    } else if (d.me && d.me.left) {
      body = `<div class="empty"><p>You left this crew. Nobody can see your notes, pins or location for this show.</p>
        <button class="btn primary" style="margin-top:12px" data-act="screw-rejoin" data-id="${esc(ev.id)}">Rejoin crew</button></div>`;
    } else {
      const me = d.me || {};
      const meLoc = me.location;
      const sharing = Boolean(me.sharing) && wantsShare(ev.id);
      const openPings = d.pings.filter((p) => !p.resolvedAt);
      const myPing = openPings.find((p) => p.mine);
      const alerts = openPings.filter((p) => !p.mine).map((p) => `<div class="sc-alert" role="alert">
          ${avatar(p.by, "av sm")}<div class="grow"><strong>${esc(firstName(p.by))} is lost</strong>
          <div class="tiny">${p.note ? "Last at: " + esc(p.note) + " · " : ""}${esc(ago(p.at))}${p.lat != null && meLoc ? " · " + esc(away(meLoc, { lat: p.lat, lng: p.lng })) : ""}</div></div>
          ${p.lat != null ? `<a class="btn sm primary" href="${esc(mapsUrl({ lat: p.lat, lng: p.lng }, firstName(p.by)))}" target="_blank" rel="noopener">Find</a>` : ""}</div>`).join("");
      const noteVal = drafts.crewNote != null ? drafts.crewNote : (me.note || "");
      body = `${alerts}
        <div class="sc-card">
          <div class="label" style="margin:0 0 8px">Where are you?</div>
          <div class="row" style="gap:8px"><input data-field="crewNote" maxlength="60" aria-label="Location note" placeholder="e.g. rail, left side" value="${esc(noteVal)}" />
            <button type="button" class="btn sm primary" data-act="screw-note-save" data-id="${esc(ev.id)}">Share</button></div>
          <div class="chips sc-chips">${NOTE_CHIPS.map((n) => `<button type="button" class="chip${me.note === n ? " on" : ""}" data-act="screw-note-chip" data-id="${esc(ev.id)}" data-t="${esc(n)}">${esc(n)}</button>`).join("")}</div>
          ${me.note ? `<div class="tiny" style="margin-top:6px">Your crew sees: “${esc(me.note)}” · ${esc(ago(me.noteAt))}</div>` : ""}
        </div>
        <div class="sc-card row sc-share">
          <div class="grow"><div class="sc-name">Share my location</div><div class="tiny">${sharing ? `On · updates every few minutes while this screen is open${meLoc ? " · sent " + esc(ago(meLoc.at)) : ""}` : "Off · approximate GPS, only your crew sees it, deleted after the show"}</div></div>
          <button class="toggle${sharing ? " on" : ""}" data-act="screw-share-toggle" data-id="${esc(ev.id)}" aria-label="Share my location" aria-pressed="${sharing}"><i></i></button>
        </div>
        ${myPing
          ? `<button type="button" class="btn sc-found" data-act="screw-found" data-id="${esc(ev.id)}" data-ping="${esc(myPing.id)}">✓ I found my crew</button><p class="tiny sc-center">Your crew was pinged ${esc(ago(myPing.at))}.</p>`
          : `<button type="button" class="btn sc-lost" data-act="screw-lost" data-id="${esc(ev.id)}"${d.members.length ? "" : " disabled"}>I'm lost</button><p class="tiny sc-center">${d.members.length ? "Pings everyone in your crew with your note" + (sharing ? " and location" : "") + "." : "Nobody from your crew is here yet."}</p>`}
        ${radar(d)}
        <div class="label" style="margin-top:18px">Your crew here (${d.members.length})</div>
        ${d.members.length ? d.members.map((m) => memberRow(m, meLoc)).join("") : `<p class="tiny">None of your friends or matches going to this show are in the crew yet. Crews include mutual follows and matches who marked “going.”</p>`}
        <div class="row" style="margin-top:18px"><div class="label grow" style="margin:0">Meet-up pins</div></div>
        ${d.pins.length ? d.pins.map((p) => `<div class="sc-pin"><span class="sc-pin-ic">◆</span><div class="grow"><div class="sc-name">${esc(p.label)}</div>
            <div class="tiny">${p.mine ? "Your pin" : esc(firstName(p.by))} · ${esc(ago(p.at))}${p.lat != null && meLoc ? " · " + esc(away(meLoc, { lat: p.lat, lng: p.lng })) : ""}</div></div>
            ${p.lat != null ? `<a class="btn sm ghost" href="${esc(mapsUrl({ lat: p.lat, lng: p.lng }, p.label))}" target="_blank" rel="noopener">Map</a>` : ""}
            ${p.mine ? `<button class="icon-btn" data-act="screw-pin-del" data-id="${esc(ev.id)}" data-pin="${esc(p.id)}" aria-label="Remove pin">✕</button>` : ""}</div>`).join("") : `<p class="tiny">No meet-up spot yet. Drop one so everyone knows where to regroup.</p>`}
        <div class="sc-card" style="margin-top:8px">
          <div class="row" style="gap:8px"><input data-field="crewPin" maxlength="40" aria-label="Meet-up spot name" placeholder="Meet-up spot (e.g. Ferris wheel)" value="${esc(drafts.crewPin || "")}" />
            <button type="button" class="btn sm primary" data-act="screw-pin-add" data-id="${esc(ev.id)}">Drop pin</button></div>
          <div class="chips sc-chips">${PIN_CHIPS.map((n) => `<button type="button" class="chip" data-act="screw-pin-chip" data-id="${esc(ev.id)}" data-t="${esc(n)}">${esc(n)}</button>`).join("")}</div>
          <div class="tiny" style="margin-top:6px">${sharing && meLoc ? "Pins use your current spot." : "Turn on location to pin your exact spot, or just name it."}</div>
        </div>
        <div class="sc-privacy tiny">🔒 Only friends and matches going to this show see this. Blocking someone hides you from each other. Everything here is deleted at ${esc(endsLabel(d.expiresAt))}.</div>
        <button type="button" class="btn ghost" style="margin-top:12px" data-act="screw-leave" data-id="${esc(ev.id)}">Leave this crew</button>`;
    }
    return `<div class="overlay top-pad sc">${head("")}<div class="scroll pad">${top}${body}<div style="height:40px"></div></div></div>`;
  }

  function eventEntryHtml(e) {
    if (!e || !e.imGoing) return "";
    const today = (S().showCrewToday || []).find((c) => c.event && String(c.event.id) === String(e.id));
    return `<button type="button" class="sc-entry${today ? " live" : ""}" data-act="screw-open" data-id="${esc(e.id)}">
      <span class="sc-entry-ic">◎</span><span class="grow"><strong>Find My Crew</strong><span class="tiny">${today
        ? (today.memberCount ? today.memberCount + (today.memberCount === 1 ? " friend or match going" : " friends & matches going") + " · notes, pins, I'm lost" : "Live today · notes, pins, I'm lost")
        : "Opens on show day for your friends and matches who are going"}</span></span><span class="sc-chev">›</span></button>`;
  }

  function homeBannerHtml() {
    const list = (S().showCrewToday || []).filter((c) => !c.left);
    if (!list.length) return "";
    let dismissed = {};
    try { dismissed = JSON.parse(localStorage.getItem("kandiCrewBannerHide") || "{}"); } catch (_) {}
    const c = list.find((x) => !dismissed[x.event.id + "|" + x.expiresAt]) || null;
    if (!c) return "";
    const faces = (c.members || []).slice(0, 4).map((u) => avatar(u, "av xs")).join("");
    const alert = c.openLost ? `<span class="sc-banner-alert">${c.openLost} lost</span>` : "";
    return `<div class="sc-banner" data-act="screw-open" data-id="${esc(c.event.id)}" role="button" tabindex="0">
      <div class="grow"><div class="sc-kicker"><span>Show day · Find My Crew</span>${alert}</div><div class="sc-banner-show">${esc(c.event.name)}</div>
      <div class="tiny">${c.memberCount ? c.memberCount + (c.memberCount === 1 ? " friend or match is" : " friends and matches are") + " going" : "Share where you are and regroup fast"}</div></div>
      <div class="sc-faces">${faces}</div>
      <button class="icon-btn sc-banner-x" data-act="screw-banner-hide" data-id="${esc(c.event.id + "|" + c.expiresAt)}" aria-label="Hide for today">✕</button></div>`;
  }

  // ---------- actions ----------
  async function openCrew(eventId) {
    const prev = S().overlay;
    S().showCrew = { eventId: String(eventId), data: null, loading: true };
    S().drafts.crewNote = null; S().drafts.crewPin = "";
    S().overlay = { type: "showCrew", id: String(eventId), returnTo: prev && prev.type !== "showCrew" ? prev : (prev && prev.returnTo) || null };
    ctx.render();
    try { await load(eventId); } catch (err) { S().overlay = S().overlay && S().overlay.type === "showCrew" ? S().overlay.returnTo : S().overlay; ctx.render(); throw err; }
    const d = crew() && crew().data;
    if (d && d.status === "active" && d.me && !d.me.left && wantsShare(eventId)) {
      if (!d.me.sharing || !d.me.location || !d.me.location.fresh) sendPosition(eventId, true);
    }
    ctx.render();
    ensureGps();
  }
  function setData(data) { const c = crew(); if (c) c.data = data; }
  async function post(eventId, path, body, method) {
    const data = await ctx.api("/api/show-crew/" + enc(eventId) + path, { method: method || "POST", body: body || {} });
    setData(data);
    return data;
  }

  async function handle(act, el) {
    if (!act || act.indexOf("screw-") !== 0) return false;
    const id = el && el.getAttribute("data-id");
    const st = S();
    if (act === "screw-open") { await openCrew(id); return true; }
    if (act === "screw-banner-hide") {
      let m = {};
      try { m = JSON.parse(localStorage.getItem("kandiCrewBannerHide") || "{}"); } catch (_) {}
      m[id] = 1;
      try { localStorage.setItem("kandiCrewBannerHide", JSON.stringify(m)); } catch (_) {}
      ctx.render(); return true;
    }
    if (act === "screw-refresh") { await load(id); ctx.render(); return true; }
    if (act === "screw-note-chip" || act === "screw-note-save") {
      const note = act === "screw-note-chip" ? el.getAttribute("data-t") : String(st.drafts.crewNote != null ? st.drafts.crewNote : "").trim();
      await post(id, "/note", { note });
      st.drafts.crewNote = null;
      ctx.toast(note ? "Your crew can see that you're " + note + "." : "Location note cleared.");
      ctx.render(); return true;
    }
    if (act === "screw-share-toggle") {
      const d = crew() && crew().data;
      const on = !(d && d.me && d.me.sharing && wantsShare(id));
      if (on) {
        setWantsShare(id, true);
        const ok = await sendPosition(id, false);
        if (!ok) { setWantsShare(id, false); ctx.render(); return true; }
        ctx.toast("Sharing your approximate location with your crew.");
      } else {
        setWantsShare(id, false);
        stopGps();
        await post(id, "/location/stop");
        ctx.toast("Location sharing is off and your last spot was deleted.");
      }
      ctx.render(); ensureGps(); return true;
    }
    if (act === "screw-pin-chip" || act === "screw-pin-add") {
      const label = act === "screw-pin-chip" ? el.getAttribute("data-t") : String(st.drafts.crewPin || "").trim();
      if (!label) { ctx.toast("Name the meet-up spot first.", "err"); return true; }
      const d = crew() && crew().data;
      const loc = d && d.me && d.me.sharing && d.me.location && d.me.location.fresh ? d.me.location : null;
      await post(id, "/pins", { label, lat: loc ? loc.lat : null, lng: loc ? loc.lng : null });
      st.drafts.crewPin = "";
      ctx.toast("Pinned “" + label + "” for your crew.");
      ctx.render(); return true;
    }
    if (act === "screw-pin-del") {
      await post(id, "/pins/" + enc(el.getAttribute("data-pin")), null, "DELETE");
      ctx.render(); return true;
    }
    if (act === "screw-lost") {
      const d = crew() && crew().data;
      if (wantsShare(id)) await sendPosition(id, true);
      const note = (d && d.me && d.me.note) || "";
      const data = await post(id, "/lost", { note });
      ctx.toast(data.notified ? "Pinged " + data.notified + (data.notified === 1 ? " person" : " people") + " in your crew." : "Your crew will see it when they open Kandi.");
      ctx.render(); return true;
    }
    if (act === "screw-found") {
      await post(id, "/pings/" + enc(el.getAttribute("data-ping")) + "/resolve");
      ctx.toast("Nice. Your crew knows you're good.");
      ctx.render(); return true;
    }
    if (act === "screw-leave") {
      if (!window.confirm("Leave this show's crew? Your note, pins and location are deleted and your crew won't see you.")) return true;
      setWantsShare(id, false); stopGps();
      await post(id, "/leave");
      quietToday();
      ctx.render(); return true;
    }
    if (act === "screw-rejoin") {
      await post(id, "/rejoin");
      quietToday();
      ctx.render(); return true;
    }
    return false;
  }
  function quietToday() { loadToday().then(() => ctx.render()).catch(() => {}); }

  // ---------- realtime ----------
  function onWs(msg) {
    if (!msg || msg.type !== "show-crew") return false;
    const c = crew();
    const o = S().overlay;
    const name = (msg.from && msg.from.name) || "Someone in your crew";
    if (msg.kind === "lost") ctx.toast("🆘 " + name + " is lost" + (msg.note ? " · last at " + msg.note : "") + ". Open Find My Crew.", "err");
    else if (msg.kind === "found") ctx.toast(name + " found the crew.");
    else if (msg.kind === "pin" && msg.label) ctx.toast(name + " dropped a pin: " + msg.label);
    if (c && o && o.type === "showCrew" && String(c.eventId) === String(msg.eventId)) {
      load(msg.eventId).then(() => {
        const a = document.activeElement;
        if (a && a.getAttribute && /^crew(Note|Pin)$/.test(a.getAttribute("data-field") || "")) return; // don't yank the keyboard
        ctx.render();
      }).catch(() => {});
    }
    if (msg.kind === "lost" || msg.kind === "found" || msg.kind === "leave" || msg.kind === "join") quietToday();
    return true;
  }

  function notifText(n) {
    if (n.kind !== "crew_lost") return null;
    const who = n.user ? `<strong>${esc(n.user.name)}</strong>` : "<strong>Someone</strong>";
    if (n.resolved) return `${who} found the crew${n.eventName ? " at " + esc(n.eventName) : ""}`;
    return `🆘 ${who} is lost${n.eventName ? " at " + esc(n.eventName) : ""}${n.text ? `: “${esc(n.text)}”` : ""}`;
  }
  function notifAct(n) {
    if (n.kind !== "crew_lost") return null;
    return `data-act="screw-open" data-id="${esc(n.eventId)}"`;
  }

  window.KandiShowCrew = {
    init(c) { ctx = c; },
    overlayHtml, eventEntryHtml, homeBannerHtml, handle, onWs, loadToday, notifText, notifAct,
    afterRender() { ensureGps(); },
  };
})();
