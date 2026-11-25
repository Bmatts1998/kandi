/* Kandi v1 client */
(function () {
  const DAILY = 8;
  const MAX_STORY_VIDEO_BYTES = 8 * 1024 * 1024;
  const MAX_STORY_VIDEO_SECONDS = 15;
  const VIBES = ["house", "techno", "dubstep", "bass", "trance", "drum & bass", "hardstyle", "EDM", "hip-hop", "disco", "garage", "trap"];
  const VIBE_LABEL = { "drum & bass": "DnB", "hip-hop": "Hip-hop" };
  const LOOKING = [
    { id: "date", label: "Dates" },
    { id: "friends", label: "Friends" },
    { id: "crew", label: "Rave crew" },
    { id: "hookup", label: "Hookups" },
    { id: "dance", label: "Dance partner" },
  ];
  const GENDERS = [
    { id: "woman", label: "Woman" },
    { id: "man", label: "Man" },
    { id: "nonbinary", label: "Nonbinary" },
    { id: "trans", label: "Trans" },
    { id: "agender", label: "Agender" },
    { id: "other", label: "Other" },
  ];
  const PRONOUNS = ["she/her", "he/him", "they/them", "she/they", "he/they", "any pronouns", "ask me"];
  const INTERESTED_IN = [
    { id: "women", label: "Women" },
    { id: "men", label: "Men" },
    { id: "nonbinary", label: "Nonbinary people" },
    { id: "everyone", label: "Everyone" },
  ];
  const KANDI_TRADES = [
    { id: "yes", label: "Always trading" },
    { id: "sometimes", label: "Sometimes" },
    { id: "no", label: "Not really" },
  ];
  const SEXES = [
    { id: "female", label: "Female" },
    { id: "male", label: "Male" },
    { id: "intersex", label: "Intersex" },
  ];
  const HOBBIES = ["dancing", "DJing", "producing", "kandi making", "photography", "festivals", "afters", "vinyl", "fashion", "thrifting", "hiking", "camping", "yoga", "gym", "skating", "art", "gaming", "travel", "animals", "tattooing"];
  const MAX_TUNES = 5;
  const MAX_POST_PHOTOS = 10;
  const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
  const MAX_VIDEO_SECONDS = 60;
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

  const GENDER_LABEL = Object.fromEntries(GENDERS.map((x) => [x.id, x.label]));
  const INTERESTED_LABEL = Object.fromEntries(INTERESTED_IN.map((x) => [x.id, x.label]));
  const KANDI_TRADES_LABEL = Object.fromEntries(KANDI_TRADES.map((x) => [x.id, x.label]));
  const SEX_LABEL = Object.fromEntries(SEXES.map((x) => [x.id, x.label]));
  function vibeLabel(v) { return VIBE_LABEL[v] || v; }
  function lookingLabel(id) { return LOOKING_LABEL[id] || id; }
  function genderLabel(id) { return GENDER_LABEL[id] || id; }
  function sexLabel(id) { return SEX_LABEL[id] || id; }
  function formatHeight(inches) {
    if (inches == null || inches === "") return "";
    const n = Number(inches);
    if (!Number.isFinite(n)) return "";
    const ft = Math.floor(n / 12);
    const inn = Math.round(n % 12);
    return ft + "\u2032" + inn + "\u2033";
  }
  function heightParts(inches) {
    if (inches == null || inches === "") return { ft: "", inn: "" };
    const n = Number(inches);
    if (!Number.isFinite(n)) return { ft: "", inn: "" };
    return { ft: String(Math.floor(n / 12)), inn: String(Math.round(n % 12)) };
  }

  function parseTuneUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    let u;
    try { u = new URL(s); } catch (_) { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.protocol === "http:") u.protocol = "https:";
    const host = String(u.hostname || "").toLowerCase().replace(/^www\./, "");
    if (host === "open.spotify.com" || host === "play.spotify.com") {
      const path = u.pathname.replace(/\/+$/, "");
      const m = path.match(/^(?:\/embed)?(?:\/intl-[a-z0-9-]+)?\/(track|playlist|album)\/([A-Za-z0-9]+)(?:\/.*)?$/i);
      if (!m) return null;
      return { url: "https://open.spotify.com/" + m[1].toLowerCase() + "/" + m[2], embedUrl: "https://open.spotify.com/embed/" + m[1].toLowerCase() + "/" + m[2] + "?theme=0", source: "spotify", kind: m[1].toLowerCase() };
    }
    if (host === "w.soundcloud.com") {
      return parseTuneUrl(u.searchParams.get("url") || "");
    }
    if (host === "soundcloud.com" || host === "m.soundcloud.com") {
      const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
      if (parts.length < 2) return null;
      const page = "https://soundcloud.com/" + parts.join("/");
      const params = new URLSearchParams({ url: page, color: "#ff5c00", auto_play: "false", hide_related: "true", show_comments: "false", show_user: "true", show_reposts: "false", show_teaser: "false", visual: "false" });
      return { url: page, embedUrl: "https://w.soundcloud.com/player/?" + params.toString(), source: "soundcloud", kind: parts[1] === "sets" ? "playlist" : "track" };
    }
    if (host === "music.apple.com" || host === "embed.music.apple.com" || host === "itunes.apple.com") {
      const path = u.pathname.replace(/\/+$/, "");
      const m = path.match(/^\/([a-z]{2})\/(song|album|playlist)\/([^/]+)(?:\/([^/]+))?$/i);
      if (!m) return null;
      const rest = m[4] ? m[3] + "/" + m[4] : m[3];
      const songQuery = u.searchParams.get("i");
      const q = songQuery ? ("?i=" + encodeURIComponent(songQuery)) : "";
      const kind = m[2].toLowerCase();
      return { url: "https://music.apple.com/" + m[1].toLowerCase() + "/" + kind + "/" + rest + q, embedUrl: "https://embed.music.apple.com/" + m[1].toLowerCase() + "/" + kind + "/" + rest + q, source: "apple", kind: songQuery ? "song" : kind };
    }
    return null;
  }
  function parseTuneList(arr) {
    const out = [];
    for (const item of (arr || [])) {
      const raw = typeof item === "string" ? item : (item && (item.url || item.embedUrl) || "");
      if (!String(raw).trim()) continue;
      const parsed = parseTuneUrl(typeof item === "string" ? item : raw);
      if (!parsed) return { error: true, tunes: out };
      if (!out.some((t) => t.url === parsed.url)) out.push(parsed);
      if (out.length >= MAX_TUNES) break;
    }
    return { error: false, tunes: out };
  }
  function tuneFrameHeight(tune) {
    if (!tune) return 152;
    if (tune.source === "spotify" && (tune.kind === "playlist" || tune.kind === "album")) return 352;
    if (tune.source === "apple" && (tune.kind === "playlist" || tune.kind === "album")) return 450;
    if (tune.source === "soundcloud") return 166;
    return 152;
  }
  function tuneSourceLabel(src) {
    return src === "spotify" ? "Spotify" : src === "soundcloud" ? "SoundCloud" : src === "apple" ? "Apple Music" : "Open in app";
  }
  function profileTunes(tunes) {
    const list = (tunes || []).filter((t) => t && t.embedUrl);
    if (!list.length) return "";
    return `<section class="prof-tunes"><div class="label">My Tunes</div>` + list.map((t) => {
      const h = tuneFrameHeight(t);
      return `<div class="tune-card">
        <iframe class="tune-frame" src="${esc(t.embedUrl)}" title="My Tunes player" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" style="height:${h}px"></iframe>
        <a class="tune-open" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">Open in ${esc(tuneSourceLabel(t.source))}</a>
      </div>`;
    }).join("") + `</section>`;
  }
  function profileCrewSlot() {
    // Reserved for rave groups / friend tagging (another worker). Keep this hook so Crew can land here without a layout rewrite.
    return `<section class="prof-crew" data-crew-slot></section>`;
  }

  function startEditDraft() {
    const me = state.me || {};
    const ht = heightParts(me.heightIn);
    state.editDraft = {
      gender: me.gender || "",
      pronouns: me.pronouns || "",
      sex: me.sex || "",
      interestedIn: (me.interestedIn || []).slice(),
      vibes: (me.vibes || []).slice(),
      looking: (me.looking || []).slice(),
      hobbies: (me.hobbies || []).slice(),
      kandiTrades: me.kandiTrades || "",
    };
    state.drafts.editName = me.name || "";
    state.drafts.editBio = me.bio || "";
    state.drafts.editAge = me.age != null ? String(me.age) : "";
    state.drafts.editHeightFt = ht.ft;
    state.drafts.editHeightIn = ht.inn;
    state.drafts.editFavoriteArtists = me.favoriteArtists || "";
    state.drafts.editFavoriteFestival = me.favoriteFestival || "";
    state.drafts.editFavoriteVenue = me.favoriteVenue || "";
    state.drafts.editFavoriteHangout = me.favoriteHangout || "";
    state.drafts.editRaveTotem = me.raveTotem || "";
    state.drafts.editYearsRaving = me.yearsRaving || "";
    state.drafts.editCustomHobby = "";
    const tuneUrls = (me.favoriteTunes || []).map((x) => x.url || "");
    for (let i = 0; i < MAX_TUNES; i++) state.drafts["editTune" + i] = tuneUrls[i] || "";
  }

  function collectEditFields() {
    const d = state.editDraft || {};
    const ageRaw = String(state.drafts.editAge || "").trim();
    const age = ageRaw ? Number(ageRaw) : null;
    if (ageRaw && (!Number.isInteger(age) || age < 18 || age > 99)) {
      return { error: "Kandi is 18+. Enter an age between 18 and 99." };
    }
    const ft = String(state.drafts.editHeightFt || "").trim();
    const inn = String(state.drafts.editHeightIn || "").trim();
    let heightIn = null;
    if (ft || inn) {
      const ftN = Number(ft);
      const inN = Number(inn || "0");
      if (!Number.isInteger(ftN) || ftN < 4 || ftN > 7 || !Number.isInteger(inN) || inN < 0 || inN > 11) {
        return { error: "Pick a height in feet and inches, or leave it blank." };
      }
      heightIn = ftN * 12 + inN;
    }
    const tuneRaw = [];
    for (let i = 0; i < MAX_TUNES; i++) tuneRaw.push(state.drafts["editTune" + i] || "");
    const parsedTunes = parseTuneList(tuneRaw);
    if (parsedTunes.error) {
      return { error: "Each My Tunes link needs to be a Spotify, SoundCloud, or Apple Music track, playlist, or album." };
    }
    const body = {
      name: state.drafts.editName,
      bio: state.drafts.editBio,
      age,
      gender: d.gender || "",
      pronouns: d.pronouns || "",
      sex: d.sex || "",
      interestedIn: d.interestedIn || [],
      vibes: d.vibes || [],
      looking: d.looking || [],
      hobbies: d.hobbies || [],
      favoriteArtists: state.drafts.editFavoriteArtists || "",
      favoriteFestival: state.drafts.editFavoriteFestival || "",
      favoriteVenue: state.drafts.editFavoriteVenue || "",
      favoriteHangout: state.drafts.editFavoriteHangout || "",
      kandiTrades: d.kandiTrades || "",
      raveTotem: state.drafts.editRaveTotem || "",
      yearsRaving: state.drafts.editYearsRaving || "",
      heightIn,
      favoriteTunes: parsedTunes.tunes,
    };
    return { body, parsedTunes };
  }

  function draftPreviewUser() {
    const collected = collectEditFields();
    if (collected.error) return collected;
    const me = state.me || {};
    const soc = state.profile && state.profile.user && Number(state.profile.user.id) === Number(me.id) ? state.profile.user : me;
    const b = collected.body;
    const preview = Object.assign({}, me, b, {
      name: String(b.name || "").trim() || me.name,
      photos: me.photos || [],
      username: me.username,
      id: me.id,
      followerCount: soc.followerCount,
      followingCount: soc.followingCount,
      upcomingShows: me.upcomingShows || soc.upcomingShows,
      upcomingHidden: me.showUpcoming === false,
      showUpcoming: me.showUpcoming,
      favoriteTunes: b.favoriteTunes,
    });
    return { user: preview };
  }

  function clearComposerMedia() {
    const media = state.composerMedia || {};
    (media.previews || []).forEach((u) => {
      if (u && String(u).startsWith("blob:")) { try { URL.revokeObjectURL(u); } catch (_) {} }
    });
    state.composerMedia = { photos: [], video: null, poster: null, previews: [] };
    state.drafts.postFile = null;
    state.drafts.postPreview = "";
  }

  function readVideoMeta(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("Choose a short video."));
      if (file.size > MAX_VIDEO_BYTES) return reject(new Error("That video is over 50 MB. Try a shorter clip."));
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.setAttribute("playsinline", "");
      let done = false;
      const finish = (err, meta) => {
        if (done) return;
        done = true;
        if (err) {
          try { URL.revokeObjectURL(url); } catch (_) {}
          reject(err);
        } else {
          resolve(meta);
        }
      };
      const capture = () => {
        const duration = v.duration;
        if (Number.isFinite(duration) && duration > MAX_VIDEO_SECONDS + 0.5) {
          finish(new Error("Videos can be up to 60 seconds."));
          return;
        }
        try {
          const canvas = document.createElement("canvas");
          const w = v.videoWidth || 640;
          const h = v.videoHeight || 360;
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(v, 0, 0, w, h);
          canvas.toBlob((blob) => {
            const preview = canvas.toDataURL("image/jpeg", 0.85);
            try { URL.revokeObjectURL(url); } catch (_) {}
            finish(null, { duration, poster: blob, preview });
          }, "image/jpeg", 0.85);
        } catch (_) {
          try { URL.revokeObjectURL(url); } catch (e) {}
          finish(null, { duration, poster: null, preview: "" });
        }
      };
      v.onloadeddata = () => {
        const t = Math.min(0.15, (v.duration && Number.isFinite(v.duration) ? v.duration : 1) / 4);
        try { v.currentTime = t; } catch (_) { capture(); }
      };
      v.onseeked = capture;
      v.onerror = () => finish(new Error("Couldn't read that video."));
      setTimeout(() => { if (!done) finish(new Error("Couldn't read that video.")); }, 8000);
      v.src = url;
    });
  }

  function findPost(id) {
    const lists = [state.homePosts || [], (state.profile && state.profile.posts) || [], state.openPost ? [state.openPost] : []];
    for (const list of lists) {
      const found = list.find((p) => String(p.id) === String(id));
      if (found) return found;
    }
    return null;
  }

  function findEvent(id) {
    const fromList = (state.events || []).find((x) => String(x.id) === String(id));
    if (fromList) return fromList;
    const lists = [state.homePosts || [], (state.profile && state.profile.posts) || [], state.openPost ? [state.openPost] : []];
    for (const list of lists) {
      for (const p of list) {
        if (p.event && String(p.event.id) === String(id)) {
          return Object.assign({
            going: [],
            color: "linear-gradient(135deg,#1a0a00,#ff5c00)",
            imGoing: false,
            category: "",
            artists: [],
            imageUrl: "",
            ageLimit: "",
            city: p.event.city || "",
            venue: p.event.venue || "",
          }, p.event);
        }
      }
    }
    return null;
  }

  function profilePhotoStrip(photos) {
    const list = (photos || []).filter(Boolean);
    if (!list.length) return "";
    return `<div class="photo-strip" aria-label="Photos">` + list.map((ph) => {
      if (ph.type === "file" && ph.url) return `<div class="photo-strip-item" style="background-image:url('${esc(mediaUrl(ph.url))}')"></div>`;
      const bg = ph.gradient ? `background:${esc(ph.gradient)}` : "background:#141414";
      return `<div class="photo-strip-item" style="${bg}"><span>${esc(ph.emoji || "")}</span></div>`;
    }).join("") + `</div>`;
  }

  function profileFact(label, value) {
    if (!value) return "";
    return `<div class="prof-fact"><div class="label">${esc(label)}</div><div class="prof-fact-val">${esc(value)}</div></div>`;
  }

  function profileDetails(p, compact) {
    if (!p) return "";
    const chips = [];
    if (p.age) chips.push(`<span class="chip soft">${esc(p.age)}</span>`);
    if (p.gender) chips.push(`<span class="chip soft">${esc(genderLabel(p.gender))}</span>`);
    if (p.sex) chips.push(`<span class="chip soft">${esc(sexLabel(p.sex))}</span>`);
    if (p.pronouns) chips.push(`<span class="chip soft">${esc(p.pronouns)}</span>`);
    const height = formatHeight(p.heightIn);
    if (height) chips.push(`<span class="chip soft">${esc(height)}</span>`);
    (p.vibes || []).forEach((v) => chips.push(`<span class="chip soft">${esc(vibeLabel(v))}</span>`));
    (p.hobbies || []).forEach((h) => chips.push(`<span class="chip soft">${esc(h)}</span>`));
    const looking = (p.looking || []).map(lookingLabel).join(", ");
    const interested = (p.interestedIn || []).map((id) => INTERESTED_LABEL[id] || id).join(", ");
    const trades = p.kandiTrades ? (KANDI_TRADES_LABEL[p.kandiTrades] || p.kandiTrades) : "";
    let html = "";
    if (chips.length) html += `<div class="chips prof-chips">${chips.join("")}</div>`;
    html += `<div class="prof-facts">`;
    html += profileFact("Interested in", interested);
    html += profileFact("Looking for", looking);
    html += profileFact("Hobbies", (p.hobbies || []).join(", "));
    html += profileFact("Favorite artists / DJs", p.favoriteArtists);
    html += profileFact("Favorite festival or show", p.favoriteFestival);
    html += profileFact("Favorite venue", p.favoriteVenue);
    html += profileFact("Favorite hangout", p.favoriteHangout);
    html += profileFact("Kandi trades", trades);
    html += profileFact("Rave totem", p.raveTotem);
    html += profileFact("Years raving", p.yearsRaving ? (String(p.yearsRaving).match(/year/i) ? p.yearsRaving : p.yearsRaving + " years") : "");
    html += `</div>`;
    if (!compact) {
      (p.prompts || []).forEach((pr) => {
        html += `<div class="prompt" style="padding-bottom:20px;margin-top:12px"><div class="q">${esc(pr.q)}</div><div class="a" style="font-size:18px">${esc(pr.a)}</div></div>`;
      });
    }
    return html;
  }

  function gridTile(post) {
    const play = post.videoUrl ? `<span class="grid-play" aria-hidden="true">▶</span>` : "";
    const src = post.posterUrl || post.photoUrl || ((post.photoUrls || [])[0]);
    if (src) {
      return `<button type="button" class="grid-tile" style="background-image:url('${esc(mediaUrl(src))}')" data-act="open-post" data-id="${post.id}" aria-label="Open post">${play}</button>`;
    }
    const txt = post.caption || (post.event && post.event.name) || "Post";
    return `<button type="button" class="grid-tile" data-act="open-post" data-id="${post.id}" aria-label="Open post"><span class="txt">${esc(String(txt).slice(0, 80))}</span></button>`;
  }

  function postGrid(posts, emptyText) {
    if (!posts || !posts.length) return `<div class="empty">${emptyText}</div>`;
    return `<div class="post-grid">` + posts.map(gridTile).join("") + `</div>`;
  }

  function storyRingWrap(inner, user, size) {
    const id = user && user.id != null ? String(user.id) : "";
    const sz = size || "lg";
    if (!user || !userHasStory(user.id)) {
      return `<div class="avatar-ring avatar-ring-${sz}" data-story-ring data-user-id="${esc(id)}">${inner}</div>`;
    }
    const ring = storyRingFor(user.id);
    const unseen = ring ? (ring.unseen !== false && !(ring.user && ring.user.isMe)) : true;
    return `<button type="button" class="avatar-ring avatar-ring-${sz} av-story-ring${unseen ? "" : " seen"}" data-story-ring data-user-id="${esc(id)}" data-act="open-story" data-id="${esc(id)}" aria-label="View story">${inner}</button>`;
  }

  function postsToolbar(posts) {
    const view = state.profilePostView === "list" ? "list" : "grid";
    const n = (posts || []).length;
    const count = n ? (n === 1 ? "1 post" : n + " posts") : "No posts yet";
    return `<div class="posts-toolbar">
      <div class="posts-heading"><div class="label" style="margin:0">Posts</div><div class="tiny">${esc(count)}</div></div>
      <div class="post-view-toggle" role="group" aria-label="Post layout">
        <button type="button" class="${view === "grid" ? "on" : ""}" data-act="post-view" data-id="grid" aria-label="Grid view" aria-pressed="${view === "grid" ? "true" : "false"}">▦</button>
        <button type="button" class="${view === "list" ? "on" : ""}" data-act="post-view" data-id="list" aria-label="List view" aria-pressed="${view === "list" ? "true" : "false"}">☰</button>
      </div>
    </div>`;
  }

  function profilePosts(posts, isMe) {
    const list = posts || [];
    const empty = isMe
      ? "No posts yet. Tap New Post to share a photo, a video, or a rave you're going to — just like a regular feed post."
      : "No posts yet.";
    const toolbar = postsToolbar(list);
    if (!list.length) return toolbar + `<div class="empty">${empty}</div>`;
    if (state.profilePostView === "list") {
      return toolbar + `<div class="profile-feed">` + list.map(postCard).join("") + `</div>`;
    }
    return toolbar + postGrid(list, empty);
  }

  function profilePreview(p, posts, opts) {
    opts = opts || {};
    const isMe = Boolean(opts.isMe);
    const tab = state.profileTab || "posts";
    const buttons = isMe
      ? `<div class="prof-actions"><button type="button" class="btn sm primary" data-act="edit-profile">Edit Profile</button>
          <button type="button" class="btn sm ghost" data-act="open-composer" data-id="you">New Post</button></div>`
      : "";
    const soc = opts.counts || {};
    const followerCount = soc.followerCount != null ? soc.followerCount : 0;
    const followingCount = soc.followingCount != null ? soc.followingCount : 0;
    const pronouns = p.pronouns ? ` · ${esc(p.pronouns)}` : "";
    let html = `<div class="prof-hero">${storyRingWrap(personAvatar(p, "av prof-av"), p, "lg")}<div class="grow">
      <div class="nm">${esc(p.name)}${p.age ? ", " + p.age : ""}</div>
      <div class="muted">@${esc(p.username)}${pronouns}</div>
      ${buttons}
    </div></div>`;
    html += `<div class="counts">
      <span><strong>${followerCount}</strong><span class="tiny">followers</span></span>
      <span><strong>${followingCount}</strong><span class="tiny">following</span></span>
      <span><strong>${(posts || []).length}</strong><span class="tiny">posts</span></span>
    </div>`;
    html += profileCrewSlot();
    const shows = p.upcomingShows || (isMe ? (p.upcomingShows || (state.events || []).filter((e) => e.imGoing)) : []);
    html += upcomingBlock(shows, { hidden: Boolean(p.upcomingHidden) || (isMe && p.showUpcoming === false), mine: isMe && !opts.asOthers });
    html += `<div class="seg event-cats profile-tabs">
      <button type="button" class="${tab === "posts" ? "on" : ""}" data-act="profile-tab" data-id="posts">Posts</button>
      <button type="button" class="${tab === "about" ? "on" : ""}" data-act="profile-tab" data-id="about">About</button>
    </div>`;
    if (tab === "about") {
      html += profilePhotoStrip(p.photos);
      if (p.bio) html += `<p class="prof-bio">${esc(p.bio)}</p>`;
      else if (isMe) html += `<p class="muted prof-bio">No bio yet. Tap Edit Profile to add one.</p>`;
      html += profileDetails(p, false);
      html += profileTunes(p.favoriteTunes);
    } else {
      if (p.bio) html += `<p class="prof-bio">${esc(p.bio)}</p>`;
      const topChips = [];
      if (p.age) topChips.push(`<span class="chip soft">${esc(p.age)}</span>`);
      if (p.gender) topChips.push(`<span class="chip soft">${esc(genderLabel(p.gender))}</span>`);
      if (p.sex) topChips.push(`<span class="chip soft">${esc(sexLabel(p.sex))}</span>`);
      const height = formatHeight(p.heightIn);
      if (height) topChips.push(`<span class="chip soft">${esc(height)}</span>`);
      (p.vibes || []).slice(0, 4).forEach((v) => topChips.push(`<span class="chip soft">${esc(vibeLabel(v))}</span>`));
      (p.hobbies || []).slice(0, 3).forEach((h) => topChips.push(`<span class="chip soft">${esc(h)}</span>`));
      if (topChips.length) html += `<div class="chips prof-chips">${topChips.join("")}</div>`;
      if ((p.favoriteTunes || []).length) {
        html += `<button type="button" class="btn sm ghost tunes-jump" data-act="profile-tab" data-id="about">My Tunes</button>`;
      }
      html += profilePosts(posts, isMe);
    }
    return html;
  }

  const state = {
    view: "boot",
    me: null,
    likesLeft: DAILY,
    tab: "home",
    feedTab: "following",
    homePosts: [],
    topRavers: [],
    storyRings: [],
    storyViewer: null,
    profile: null,
    profileTab: "posts",
    editDraft: null,
    openPost: null,
    overlayBack: null,
    composerMedia: { photos: [], video: null, poster: null, previews: [] },
    composerReturn: "home",
    profilePostView: "grid",
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
    drafts: { user: "", pass: "", name: "", age: "", comment: "", chat: "", promptQ: "", promptA: "", caption: "", postEvent: "", postPreview: "", commentText: "", reportReason: "", editName: "", editBio: "", editAge: "", editFavoriteArtists: "", editFavoriteFestival: "", editFavoriteVenue: "", editFavoriteHangout: "", editRaveTotem: "", editYearsRaving: "", filterAgeMin: "18", filterAgeMax: "99", claimPreview: "", storyText: "", storyEvent: "", storyReply: "" },
    uploadingPhoto: false,
    uploadProgress: null,
    uploadError: "",
    onboardStep: 0,
    filters: { event: "all", genre: "all", gender: "all", ageMin: 18, ageMax: 99 },
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

  function eventChipLabel(e) {
    if (!e) return "";
    if (e.chip) return e.chip;
    const name = String(e.name || "").replace(/\s+/g, " ").trim();
    const short = name.length > 22 ? name.slice(0, 20).trim() + "…" : name;
    const raw = e.startsAt || e.date || "";
    let wd = "";
    try {
      if (raw) wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" }).format(new Date(raw));
    } catch (_) {}
    if (!wd && /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(String(e.date || ""))) {
      wd = String(e.date).match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i)[1];
    }
    return wd ? short + " · " + wd : short;
  }
  function avatarStack(people, max) {
    max = max || 5;
    const list = (people || []).slice(0, max);
    if (!list.length) return "";
    const extra = Math.max(0, (people || []).length - list.length);
    return `<div class="av-stack">${list.map((p) => personAvatar(p, "av xs")).join("")}${extra ? `<span class="av-more">+${extra}</span>` : ""}</div>`;
  }
  function rsvpToggles(e) {
    return `<div class="rsvp-box">
      <div class="rsvp-item"><div class="grow"><div class="rsvp-label">I'm going</div></div>
        <button type="button" class="toggle${e.imGoing ? " on" : ""}" data-act="toggle-going" data-id="${esc(e.id)}" aria-pressed="${e.imGoing ? "true" : "false"}" aria-label="I'm going"><i></i></button></div>
      <div class="rsvp-item"><div class="grow"><div class="rsvp-label">Open to meet up</div>
        <div class="tiny">Let people at this show know they can say hi</div></div>
        <button type="button" class="toggle${e.imOpenToMeet ? " on" : ""}" data-act="toggle-meet" data-id="${esc(e.id)}" aria-pressed="${e.imOpenToMeet ? "true" : "false"}" aria-label="Open to meet up"><i></i></button></div>
    </div>`;
  }
  function goerActions(p) {
    if (state.me && Number(state.me.id) === Number(p.id)) return `<span class="tiny">You</span>`;
    const matched = (state.matches || []).some((m) => m.user && Number(m.user.id) === Number(p.id));
    if (matched) return `<button type="button" class="btn sm primary" data-act="chat" data-id="${p.id}">Message</button>`;
    return `<button type="button" class="btn sm primary" data-act="want-like" data-id="${p.id}" data-type="photo" data-target="0">Like</button>`;
  }
  function goerRow(p) {
    const note = p.openToMeet
      ? `<div class="tiny">Open to meet${p.meetNote ? " · " + esc(p.meetNote) : ""}</div>`
      : (p.vibes && p.vibes.length ? `<div class="tiny">${p.vibes.slice(0, 3).map(esc).join(" · ")}</div>` : "");
    return `<div class="goer card">
      <button type="button" class="goer-main" data-act="open-profile" data-id="${p.id}">
        ${personAvatar(p, "av sm")}
        <div class="grow"><div style="font-weight:700">${esc(p.name)}${p.age ? ", " + p.age : ""}${p.isDemo ? ` <span class="tiny">demo</span>` : ""}${isVip() && p.subscription === "vip" ? ' <span class="vip">Priority</span>' : ""}</div>${note}</div>
      </button>
      <div class="goer-actions">${goerActions(p)}</div>
    </div>`;
  }
  function bothGoingLine(shared, meetPlan) {
    if (!(shared && shared.length)) return "";
    const first = shared[0];
    const more = shared.length > 1 ? ` +${shared.length - 1} more` : "";
    let html = `<div class="meet-banner">You're both going to ${esc(first.name)}${more}</div>`;
    if (meetPlan && (meetPlan.spot || meetPlan.time)) {
      const evName = (meetPlan.event && meetPlan.event.name) || first.name;
      html += `<div class="meet-plan">Meet: ${esc(meetPlan.spot || evName)}${meetPlan.time ? " at " + esc(meetPlan.time) : ""}</div>`;
    }
    return html;
  }
  function upcomingBlock(shows, opts) {
    opts = opts || {};
    if (opts.hidden) return `<div class="label">Upcoming shows</div><p class="tiny">This person hides their upcoming shows.</p>`;
    if (!(shows && shows.length)) return opts.mine ? `<div class="label">Upcoming shows</div><p class="tiny">Mark I'm going on an event and it will show up here.</p>` : "";
    return `<div class="label">Upcoming shows</div><div class="upcoming-list">${shows.map((e) =>
      `<button type="button" class="upcoming-row" data-act="event" data-id="${esc(e.id)}">${esc(e.emoji || "✺")} <span class="grow">${esc(e.name)}</span><span class="tiny">${esc(e.date || eventChipLabel(e))}</span></button>`
    ).join("")}</div>`;
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
      } else if (msg.type === "meet-plan") {
        quiet(loadMatches());
        if (state.overlay && (state.overlay.type === "chat" || state.overlay.type === "meetSpot") && Number(msg.matchId) === Number(state.chatMatchId)) {
          state.chatMeetPlan = msg.meetPlan;
        }
        toast((msg.from && msg.from.name ? msg.from.name : "Your match") + " picked a meet spot.");
        render();
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
  function hiddenFileInput(kind, label, opts) {
    opts = opts || {};
    const id = "kandi-file-" + kind + "-" + (++fileInputSeq);
    const accept = opts.accept || "image/*";
    const multiple = opts.multiple ? " multiple" : "";
    const input = `<input id="${id}" class="file-sr" type="file" accept="${esc(accept)}" data-act-file="${kind}"${multiple} ${state.uploadingPhoto ? "disabled" : ""} aria-label="${esc(label)}" />`;
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
  async function loadStories() {
    try {
      const data = await api("/api/stories");
      state.storyRings = data.rings || [];
    } catch (_) {
      if (!state.storyRings) state.storyRings = [];
    }
  }
  async function loadHome() {
    const tab = state.feedTab === "popular" ? "popular" : "following";
    const [feed, top] = await Promise.all([
      api("/api/feed/" + tab),
      tab === "popular" ? api("/api/feed/top-ravers") : Promise.resolve({ people: state.topRavers || [] }),
      loadStories(),
    ]);
    state.homePosts = feed.posts || [];
    if (tab === "popular") state.topRavers = top.people || [];
  }
  async function loadProfile(userId) {
    const data = await api("/api/users/" + userId);
    state.profile = data;
    try {
      const st = await api("/api/stories/user/" + userId);
      if (data.user) data.user.hasActiveStory = Boolean(st.hasActiveStory);
      const existing = (state.storyRings || []).find((r) => Number(r.user && r.user.id) === Number(userId));
      if (st.stories && st.stories.length) {
        const ring = { user: st.user, stories: st.stories, unseen: (st.stories || []).some((s) => !s.viewed && !(st.user && st.user.isMe)), storyCount: st.stories.length };
        if (existing) Object.assign(existing, ring);
        else state.storyRings = (state.storyRings || []).concat([ring]);
      }
    } catch (_) {}
  }
  async function loadFeed() {
    const q = new URLSearchParams();
    if (isPlus() && state.filters.genre !== "all") q.set("genre", state.filters.genre);
    if (state.filters.event && state.filters.event !== "all") q.set("event", state.filters.event);
    if (state.filters.gender && state.filters.gender !== "all") q.set("gender", state.filters.gender);
    const ageMin = Number(state.filters.ageMin);
    const ageMax = Number(state.filters.ageMax);
    if (Number.isFinite(ageMin) && ageMin > 18) q.set("ageMin", String(ageMin));
    if (Number.isFinite(ageMax) && ageMax < 99) q.set("ageMax", String(ageMax));
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
      return `<div class="photo file" style="background-image:url('${esc(mediaUrl(ph.url))}')">${showWho ? `<div class="who"><div class="nm">${esc(p.name)}, ${p.age}</div>${p.sharedEventChip ? `<div class="meet-chip">${esc(p.sharedEventChip)}</div>` : ""}</div>` : ""}
        ${caption ? `<div class="caption">${esc(caption)}</div>` : ""}
        <button class="heart-fab" data-act="want-like" data-id="${p.id}" data-type="photo" data-target="${i}" aria-label="Like this photo">♡</button></div>`;
    }
    return `<div class="photo" style="background:${esc(ph.gradient || "#111111")}"><div class="grain"></div>
      ${showWho ? `<div class="who"><div class="nm">${esc(p.name)}, ${p.age}</div>${p.sharedEventChip ? `<div class="meet-chip">${esc(p.sharedEventChip)}</div>` : ""}</div>` : ""}
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
    const myShows = (state.events || []).filter((e) => e.imGoing);
    const sameOn = state.filters.event && state.filters.event !== "all";
    let sameBar = `<div class="same-show-bar"><button type="button" class="chip${sameOn ? " on" : ""}" data-act="same-show">Going to the same show</button></div>`;
    if (sameOn) {
      sameBar += `<div class="chips same-show-picks">
        <button type="button" class="chip${state.filters.event === "same" ? " on" : ""}" data-act="pick-same-event" data-id="same">Shows I'm going to</button>
        ${myShows.map((e) => `<button type="button" class="chip${state.filters.event === e.id ? " on" : ""}" data-act="pick-same-event" data-id="${esc(e.id)}">${esc(eventChipLabel(e))}</button>`).join("")}
      </div>`;
    }
    const p = state.feed[0];
    if (!p) {
      return header("Kandi", right) + `<div class="scroll pad">${sameBar}<div class="empty"><p>${sameOn ? "No one else is marked going to that show yet. Try another one, or invite a friend." : "You're caught up for now. Check back when more ravers join, or rewind a pass."}</p>
        <button class="btn sm primary" style="margin-top:16px" data-act="rewind">Rewind last pass</button></div></div>`;
    }
    const parts = [];
    parts.push(photoEl(p, 0, true));
    if (p.prompts[0]) parts.push(promptEl(p, p.prompts[0]));
    if (p.photos[1]) parts.push(photoEl(p, 1, false));
    if (p.prompts[1]) parts.push(promptEl(p, p.prompts[1]));
    if (p.prompts[2]) parts.push(promptEl(p, p.prompts[2]));
    const discoChips = [];
    if (p.age) discoChips.push(`<span class="chip soft">${esc(p.age)}</span>`);
    if (p.gender) discoChips.push(`<span class="chip soft">${esc(genderLabel(p.gender))}</span>`);
    if (p.sex) discoChips.push(`<span class="chip soft">${esc(sexLabel(p.sex))}</span>`);
    const discoHeight = formatHeight(p.heightIn);
    if (discoHeight) discoChips.push(`<span class="chip soft">${esc(discoHeight)}</span>`);
    (p.vibes || []).forEach((v) => discoChips.push(`<span class="chip soft">${esc(vibeLabel(v))}</span>`));
    (p.hobbies || []).slice(0, 4).forEach((h) => discoChips.push(`<span class="chip soft">${esc(h)}</span>`));
    parts.push(`<div class="meta-card"><div class="chips" style="margin-bottom:8px">${discoChips.join("")}</div>
      <div class="muted">Looking for ${(p.looking || []).map((lid) => lookingLabel(lid)).join(", ") || "—"}</div>
      ${p.favoriteFestival ? `<div class="tiny" style="margin-top:6px">Favorite show: ${esc(p.favoriteFestival)}</div>` : ""}
      <div class="tiny" style="margin-top:10px">${p.isDemo ? "Example / demo profile" : "Member on Kandi"}</div></div>`);
    return header("Kandi", right) + `<div class="scroll">${sameBar}<div class="stack" style="padding-top:4px">${parts.join("")}</div>
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
      const goingN = e.goingCount != null ? e.goingCount : (e.going || []).length;
      const openN = e.openCount != null ? e.openCount : (e.openToMeet || []).length;
      const bits = [`${goingN} going`];
      if (openN) bits.push(`${openN} open to meet`);
      if (e.ageLimit) bits.push(esc(e.ageLimit));
      if ((e.genres || []).length) bits.push(e.genres.map(esc).join(", "));
      else if (e.category) bits.push(e.category === "rave" ? "Rave / EDM" : "Concert");
      html += `<div class="event" style="margin-bottom:10px">
        <button type="button" class="event-main" data-act="event" data-id="${esc(e.id)}">
          <div class="thumb" style="background:${esc(e.color || "#1a0a00")}">${eventThumb(e)}</div>
          <div class="grow"><div style="font-weight:800">${esc(e.name)} ${e.imGoing ? `<span class="chip soft">You're going</span>` : ""}${e.imOpenToMeet ? `<span class="chip soft">Open to meet</span>` : ""}</div>
          <div class="muted">${esc(eventWhen(e))}</div>
          <div class="muted">${esc(e.venue || "Venue TBA")}${e.city ? " · " + esc(e.city) : ""}</div>
          <div class="tiny going-line" style="margin-top:6px">${avatarStack(e.going)}<span>${bits.join(" · ")}</span></div></div>
        </button>
        ${rsvpToggles(e)}
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
        <div class="muted">${esc(last ? last.text : "You matched. Say hi.")}</div>
        ${m.sharedEvents && m.sharedEvents[0] ? `<div class="tiny meet-mini">Both going to ${esc(m.sharedEvents[0].name)}</div>` : ""}
        ${m.meetPlan && (m.meetPlan.spot || m.meetPlan.time) ? `<div class="tiny meet-mini">Meet: ${esc(m.meetPlan.spot || "")}${m.meetPlan.time ? " at " + esc(m.meetPlan.time) : ""}</div>` : ""}</div></button>`;
    });
    return html + "</div>";
  }



  function userHasStory(userId) {
    const id = Number(userId);
    return (state.storyRings || []).some((r) => Number(r.user && r.user.id) === id && (r.storyCount || (r.stories || []).length));
  }
  function storyRingFor(userId) {
    return (state.storyRings || []).find((r) => Number(r.user && r.user.id) === Number(userId));
  }
  function storyAvatar(p, cls, userId) {
    const inner = personAvatar(p, cls);
    if (!userHasStory(userId)) return inner;
    const ring = storyRingFor(userId);
    const unseen = ring ? ring.unseen !== false && !ring.user.isMe : true;
    return `<button type="button" class="av-story-ring${unseen ? "" : " seen"}" data-act="open-story" data-id="${userId}" aria-label="View story">${inner}</button>`;
  }
  function clearStoryDraft() {
    if (state.storyDraft && state.storyDraft.preview && String(state.storyDraft.preview).startsWith("blob:")) {
      try { URL.revokeObjectURL(state.storyDraft.preview); } catch (_) {}
    }
    state.storyDraft = null;
    state.drafts.storyText = "";
    state.drafts.storyEvent = "";
  }
  function storyBarHtml() {
    const rings = state.storyRings || [];
    const me = state.me || {};
    const mine = rings.find((r) => r.user && r.user.isMe) || {
      user: { id: me.id, name: "You", username: me.username, avatar: (me.photos && me.photos[0]) || me.avatar, isMe: true, isDemo: me.isDemo },
      stories: [], unseen: false, storyCount: 0,
    };
    const others = rings.filter((r) => r.user && !r.user.isMe && (r.stories || []).length);
    function ringBtn(r, isMe) {
      const u = r.user;
      const count = r.storyCount || (r.stories || []).length;
      const unseen = !isMe && r.unseen;
      const name = isMe ? "Your story" : (u.name || u.username || "Raver");
      const label = isMe
        ? (count ? "View your story" : "Add to your story")
        : ("View " + name + "'s story");
      const act = isMe && !count ? "open-story-composer" : "open-story";
      const plus = isMe ? `<button type="button" class="plus" data-act="open-story-composer" aria-label="Add to your story">＋</button>` : "";
      const demo = u.isDemo && !isMe ? `<div class="demo-tag">Demo</div>` : "";
      return `<div class="story-ring-wrap">
        <button type="button" class="story-ring${unseen || (isMe && count) ? " unseen" : ""}" data-act="${act}" data-id="${u.id}" aria-label="${esc(label)}">
          <div class="ring">${avatarEl(u.avatar, "av", (u.name || "?")[0])}</div>
          <div class="nm">${esc(name)}</div>${demo}
        </button>
        ${plus}
      </div>`;
    }
    return `<div class="story-bar" aria-label="Stories">${ringBtn(mine, true)}${others.map((r) => ringBtn(r, false)).join("")}</div>`;
  }
  function currentStory() {
    const v = state.storyViewer;
    if (!v || !v.rings) return null;
    const ring = v.rings[v.ringIndex];
    if (!ring) return null;
    const stories = ring.stories || [];
    const story = stories[v.storyIndex];
    return story ? { ring, story, stories } : null;
  }
  function storyDurationMs(story, videoEl) {
    if (story && story.kind === "video") {
      const d = videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration * 1000 : 8000;
      return Math.min(MAX_STORY_VIDEO_SECONDS * 1000, Math.max(1500, d));
    }
    return 5000;
  }
  let storyAnimTimer = null;
  function stopStoryPlayback() {
    if (storyAnimTimer) { clearTimeout(storyAnimTimer); storyAnimTimer = null; }
    const vid = document.querySelector(".story-viewer video");
    if (vid) { try { vid.pause(); } catch (_) {} }
  }
  function goStory(delta) {
    const v = state.storyViewer;
    if (!v) return;
    const ring = v.rings[v.ringIndex];
    if (!ring) { closeStoryViewer(); return; }
    const next = v.storyIndex + delta;
    if (next >= 0 && next < (ring.stories || []).length) {
      v.storyIndex = next;
      v.showViewers = false;
      v.viewers = null;
      render();
      return;
    }
    const nextRing = v.ringIndex + (delta > 0 ? 1 : -1);
    if (nextRing >= 0 && nextRing < v.rings.length) {
      v.ringIndex = nextRing;
      const stories = v.rings[nextRing].stories || [];
      v.storyIndex = delta > 0 ? 0 : Math.max(0, stories.length - 1);
      v.showViewers = false;
      v.viewers = null;
      render();
      return;
    }
    if (delta > 0) closeStoryViewer();
  }
  function closeStoryViewer() {
    stopStoryPlayback();
    state.storyViewer = null;
    if (state.overlay && (state.overlay.type === "story" || state.overlay.type === "storyComposer")) {
      if (state.overlay.type === "storyComposer") clearStoryDraft();
      state.overlay = null;
    }
    render();
  }
  async function markStoryViewed(story) {
    if (!story || !story.id) return;
    try {
      await api("/api/stories/" + story.id + "/view", { method: "POST", body: {} });
      (state.storyRings || []).forEach((r) => {
        (r.stories || []).forEach((s) => { if (Number(s.id) === Number(story.id)) s.viewed = true; });
        if (r.stories && r.stories.length && r.stories.every((s) => s.viewed)) r.unseen = false;
      });
    } catch (_) {}
  }
  function startStoryPlayback() {
    const viewer = document.querySelector(".story-viewer");
    if (!viewer) { stopStoryPlayback(); return; }
    const cur = currentStory();
    if (!cur) return;
    markStoryViewed(cur.story);
    const video = viewer.querySelector("video");
    const bar = viewer.querySelector(".story-prog.now i");
    const run = (ms) => {
      if (storyAnimTimer) clearTimeout(storyAnimTimer);
      if (bar) bar.style.animationDuration = (ms / 1000) + "s";
      storyAnimTimer = setTimeout(() => {
        if (state.storyViewer && !viewer.classList.contains("paused")) goStory(1);
      }, ms);
    };
    if (video) {
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "true");
      const kick = () => {
        const ms = storyDurationMs(cur.story, video);
        if (bar) bar.style.animationDuration = (ms / 1000) + "s";
        video.play().catch(() => {});
        run(ms);
      };
      if (video.readyState >= 1) kick();
      else video.addEventListener("loadedmetadata", kick, { once: true });
      video.addEventListener("ended", () => goStory(1), { once: true });
    } else {
      run(storyDurationMs(cur.story));
    }
  }
  function setStoryPaused(on) {
    const viewer = document.querySelector(".story-viewer");
    if (!viewer) return;
    viewer.classList.toggle("paused", on);
    const video = viewer.querySelector("video");
    if (video) {
      try { if (on) video.pause(); else video.play().catch(() => {}); } catch (_) {}
    }
  }
  function storyViewerHtml() {
    const cur = currentStory();
    if (!cur) return "";
    const { ring, story, stories } = cur;
    const u = ring.user;
    const idx = state.storyViewer.storyIndex;
    const mine = u && u.isMe;
    const media = story.kind === "video"
      ? `<video src="${esc(mediaUrl(story.mediaUrl))}"${story.posterUrl ? ` poster="${esc(mediaUrl(story.posterUrl))}"` : ""} autoplay muted playsinline webkit-playsinline loop="false"></video>`
      : `<img src="${esc(mediaUrl(story.mediaUrl))}" alt="">`;
    const progs = stories.map((_, i) => `<div class="story-prog${i < idx ? " done" : ""}${i === idx ? " now" : ""}"><i></i></div>`).join("");
    const demo = u.isDemo && !mine ? `<span class="meta"> · Demo</span>` : "";
    const viewersSheet = (state.storyViewer.showViewers)
      ? `<div class="story-viewers" data-stop="1"><div class="grab"></div>
          <div class="row"><h2 class="h2" style="flex:1">Viewers</h2><button type="button" class="icon-btn" data-act="story-hide-viewers" aria-label="Close viewers">✕</button></div>
          ${(state.storyViewer.viewers || []).length
            ? state.storyViewer.viewers.map((p) => `<div class="row" style="margin:10px 0">${personAvatar(p, "av")}<div class="grow"><div style="font-weight:700">${esc(p.name)}</div><div class="tiny">${esc(timeAgo(p.viewedAt))}</div></div></div>`).join("")
            : `<p class="muted" style="margin-top:12px">No views yet.</p>`}
        </div>`
      : "";
    const foot = mine
      ? `<div class="story-foot">
          <button type="button" class="btn sm ghost" data-act="story-viewers">${story.viewCount == null ? "Viewers" : (story.viewCount + " view" + (story.viewCount === 1 ? "" : "s"))}</button>
          <button type="button" class="btn sm danger" data-act="delete-story" data-id="${story.id}">Delete</button>
        </div>`
      : `<div class="story-foot">
          <input data-field="storyReply" aria-label="Reply to story" enterkeyhint="send" autocomplete="off" placeholder="Reply..." value="${esc(state.drafts.storyReply || "")}" />
          <button type="button" class="btn sm primary" data-act="story-reply">Send</button>
        </div>`;
    return `<div class="story-viewer" data-story-nav="1">
      <div class="story-progs">${progs}</div>
      <div class="story-chrome">
        <button type="button" class="who" data-act="open-profile" data-id="${u.id}">${avatarEl(u.avatar, "av", (u.name || "?")[0])}
          <span><div class="nm">${esc(u.name)}</div><div class="meta">${esc(timeAgo(story.createdAt))}${demo}</div></span>
        </button>
        <button type="button" class="icon-btn" data-act="story-close" aria-label="Close">✕</button>
      </div>
      <div class="story-stage">
        ${media}
        ${story.event ? `<div class="story-event">${esc((story.event.emoji || "") + " " + story.event.name)}</div>` : ""}
        ${story.textOverlay ? `<div class="story-text">${esc(story.textOverlay)}</div>` : ""}
        <button type="button" class="story-hit left" aria-label="Previous story"></button>
        <button type="button" class="story-hit right" aria-label="Next story"></button>
      </div>
      ${foot}${viewersSheet}
    </div>`;
  }
  function storyComposerHtml() {
    const d = state.storyDraft || {};
    const evs = state.events || [];
    const preview = d.preview
      ? `<div class="story-preview">${d.kind === "video"
          ? `<video src="${esc(d.preview)}" muted playsinline webkit-playsinline autoplay loop></video>`
          : `<img src="${esc(d.preview)}" alt="">`}
          ${state.drafts.storyText ? `<div class="story-text">${esc(state.drafts.storyText)}</div>` : ""}</div>`
      : `<label class="card photo-upload big-pick"><div style="font-size:30px">◎</div>
          <div style="font-weight:700;margin-top:6px">Add to your story</div>
          <div class="tiny" style="margin-top:4px">Photo or a video up to 15 seconds. Any size photo works.</div>
          <input type="file" accept="image/*,video/*,video/mp4,video/quicktime" data-act-file="story-media" aria-label="Add a photo or short video to your story" /></label>`;
    return `<div class="sheet-bg" data-act="story-composer-close"><div class="sheet" data-stop="1"><div class="grab"></div>
      <h2 class="h2">New story</h2>
      <p class="muted" style="margin-top:6px">It stays up for 24 hours, then it disappears.</p>
      ${preview}
      ${d.preview ? `<div class="label" style="margin-top:12px">Text overlay (optional)</div>
        <input data-field="storyText" maxlength="140" placeholder="Add a line..." value="${esc(state.drafts.storyText || "")}" />
        <div class="label" style="margin-top:12px">Tag an event (optional)</div>
        <div class="chips"><button type="button" class="chip${!(state.drafts.storyEvent) ? " on" : ""}" data-act="story-event" data-id="">None</button>
          ${evs.map((e) => `<button type="button" class="chip${state.drafts.storyEvent === e.id ? " on" : ""}" data-act="story-event" data-id="${esc(e.id)}">${esc(e.emoji || "")} ${esc(e.name)}</button>`).join("")}</div>` : ""}
      ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
      ${uploadBusy()}
      ${d.preview ? `<button type="button" class="btn primary" style="margin-top:16px" data-act="submit-story">Share story</button>
        <button type="button" class="btn ghost" style="margin-top:8px" data-act="story-composer-close">Cancel</button>` : `<button type="button" class="btn ghost" style="margin-top:8px" data-act="story-composer-close">Cancel</button>`}
    </div></div>`;
  }

  function viewHome() {
    const following = state.feedTab !== "popular";
    let html = header("Kandi", `<button class="icon-btn" data-act="open-composer" title="New post" aria-label="New post">＋</button>`);
    html += `<div class="feed-tabs">
      <button class="${following ? "on" : ""}" data-act="feed-tab" data-id="following">Following</button>
      <button class="${!following ? "on" : ""}" data-act="feed-tab" data-id="popular">Popular</button>
    </div>`;
    html += `<div class="scroll">`;
    html += storyBarHtml();
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

  function postMedia(p) {
    const burst = state.heartBurst === p.id ? `<div class="burst">♥</div>` : "";
    if (p.videoUrl) {
      const poster = p.posterUrl || p.photoUrl;
      return `<div class="post-video-wrap">
        <video src="${esc(mediaUrl(p.videoUrl))}"${poster ? ` poster="${esc(mediaUrl(poster))}"` : ""} playsinline webkit-playsinline controls preload="metadata"></video>
        ${burst}
      </div>`;
    }
    const urls = (p.photoUrls && p.photoUrls.length) ? p.photoUrls : (p.photoUrl ? [p.photoUrl] : []);
    if (urls.length) return postGallery(p, burst);
    if (p.caption) {
      return `<div class="post-photo post-text" data-act="post-like-tap" data-id="${p.id}"><div class="post-text-inner">${esc(p.caption)}</div>${burst}</div>`;
    }
    return "";
  }

  function postCard(p) {
    const hasVisual = Boolean(p.videoUrl || p.photoUrl || (p.photoUrls && p.photoUrls.length));
    const cap = p.caption ? `<div class="cap"><strong>${esc(p.author.name)}</strong> ${esc(p.caption)}</div>` : "";
    const ev = p.event
      ? `<button type="button" class="chip soft event-tag" data-act="event" data-id="${esc(p.event.id)}">${esc(p.event.emoji || "")} ${esc(p.event.name)}</button>`
      : "";
    const followBtn = p.author.id !== (state.me && state.me.id) && !p.author.following
      ? `<button class="btn sm ghost" data-act="follow" data-id="${p.author.id}">Follow</button>`
      : (p.author.id !== (state.me && state.me.id)
        ? `<button class="btn sm ghost" data-act="unfollow" data-id="${p.author.id}">Following</button>`
        : "");
    const more = p.author.id === (state.me && state.me.id)
      ? `<button class="icon-btn" data-act="delete-post" data-id="${p.id}" title="Delete" aria-label="Delete">✕</button>`
      : `<button class="icon-btn" data-act="report-post" data-id="${p.id}" title="Report" aria-label="Report">⋯</button>`;
    return `<article class="post">
      <div class="post-hd">
        <button type="button" data-act="open-profile" data-id="${p.author.id}">${avatarEl(p.author.avatar, "av", (p.author.name||"?")[0])}</button>
        <button type="button" class="who" data-act="open-profile" data-id="${p.author.id}"><div class="nm">${esc(p.author.name)}</div><div class="un">@${esc(p.author.username)} · ${esc(timeAgo(p.createdAt))}</div></button>
        ${followBtn}${more}
      </div>
      ${postMedia(p)}
      <div class="post-actions">
        <button type="button" class="${p.liked ? "loved" : ""}" data-act="toggle-post-like" data-id="${p.id}" aria-label="Like">♥</button>
        <button type="button" data-act="open-comments" data-id="${p.id}" aria-label="Comments">💬</button>
        <span class="spacer"></span>
      </div>
      <div class="post-body">
        <div class="likes">${p.likeCount} like${p.likeCount === 1 ? "" : "s"} · ${p.commentCount} comment${p.commentCount === 1 ? "" : "s"}</div>
        ${hasVisual || !p.caption ? cap : ""}
        ${ev}
      </div>
    </article>`;
  }

  function viewYou() {
    const p = state.me;
    const soc = state.profile && state.profile.user && state.profile.user.id === p.id ? state.profile : null;
    const posts = (soc && soc.posts) || [];
    const counts = soc && soc.user ? { followerCount: soc.user.followerCount, followingCount: soc.user.followingCount } : {};
    let html = header("You", `<button type="button" class="btn sm ghost" data-act="settings">Settings</button>`);
    html += `<div class="scroll pad">`;
    html += profilePreview(p, posts, { isMe: true, counts });
    html += `</div>`;
    return html;
  }

  function settingsBody() {
    const p = state.me || {};
    const plan = p.subscription ? (p.subscription === "vip" ? "Kandi VIP" : "Kandi+") : "Free";
    let html = `<div class="card" style="margin-top:8px"><div class="row"><div class="grow"><div style="font-weight:800">${plan}</div>
      <div class="tiny">${p.subscription ? "Free during the beta — no payment on file." : "Free to use. Kandi+ (free during the beta) adds unlimited likes and more."}</div></div>
      ${p.subscription ? `<button type="button" class="btn sm ghost" data-act="cancel-sub">Turn off</button>` : `<button type="button" class="btn sm primary" data-act="paywall" data-reason="upgrade">See Kandi+</button>`}
    </div>`;
    html += `<div class="rsvp-item" style="margin-top:14px"><div class="grow"><div class="rsvp-label">Show upcoming shows on my profile</div>
      <div class="tiny">Turn this off if you want to keep your RSVPs off your public profile.</div></div>
      <button type="button" class="toggle${p.showUpcoming !== false ? " on" : ""}" data-act="toggle-show-upcoming" aria-pressed="${p.showUpcoming !== false ? "true" : "false"}" aria-label="Show upcoming shows on my profile"><i></i></button></div>`;
    html += `<h3 style="margin:22px 0 10px;font-size:16px">Safety</h3>
      <div class="notice warn" style="margin-bottom:10px"><strong>Consent first.</strong> Ask, wait for a yes, and look out for each other. You never owe anyone a dance, a meetup, or a hookup.</div>`;
    if (state.locationShare) {
      html += `<div class="notice ok" style="margin-bottom:10px">Meetup note shared with ${esc(state.locationShare.with)}${state.locationShare.event ? " · " + esc(state.locationShare.event) : ""}. In-app only — no real location was sent.</div>`;
    } else {
      html += `<button type="button" class="btn ghost" style="margin-bottom:10px" data-act="share-loc">Share a meetup note with a friend</button>`;
    }
    if ((state.blocked || []).length) {
      html += `<div class="label" style="margin-top:16px">Blocked</div>` + state.blocked.map((b) =>
        `<div class="row" style="margin:6px 0"><div class="grow">${esc(b.name)}</div><button type="button" class="btn sm ghost" data-act="unblock" data-id="${b.id}">Unblock</button></div>`
      ).join("");
    }
    html += iosTip();
    html += `<button type="button" class="btn ghost" style="margin-top:24px" data-act="logout">Log out</button>
      <button type="button" class="btn danger" style="margin-top:8px;width:100%" data-act="delete-account">Delete account</button>
      <p class="tiny" style="text-align:center;margin-top:12px"><a href="/privacy" style="color:var(--muted)">Privacy</a> · <a href="/terms" style="color:var(--muted)">Terms</a></p>
      <p class="tiny" style="text-align:center;margin-top:8px">Kandi v1.1</p>`;
    return html;
  }

  function clearPostFiles() {
    (state.drafts.postFiles || []).forEach((f) => { try { URL.revokeObjectURL(f.url); } catch (_) {} });
    state.drafts.postFiles = [];
  }
  function postGallery(p, burst) {
    const urls = (p.photoUrls && p.photoUrls.length) ? p.photoUrls : (p.photoUrl ? [p.photoUrl] : []);
    if (!urls.length) return "";
    if (urls.length <= 1) {
      return `<div class="post-photo" style="background-image:url('${esc(mediaUrl(urls[0]))}')" data-act="post-like-tap" data-id="${p.id}" role="img" aria-label="Photo by ${esc(p.author.name)}. Double-tap to like.">${burst || ""}</div>`;
    }
    return `<div class="post-carousel-wrap"><div class="post-carousel" data-act="post-like-tap" data-id="${p.id}">
      ${urls.map((u, i) => `<div class="post-photo slide" style="background-image:url('${esc(mediaUrl(u))}')" role="img" aria-label="Photo ${i + 1} of ${urls.length} by ${esc(p.author.name)}"></div>`).join("")}
      </div>${burst || ""}<span class="carousel-count">1/${urls.length}</span></div>`;
  }


  function editChipRow(label, items, selected, act, single) {
    const sel = selected == null ? "" : selected;
    const isOn = (id) => single ? String(sel) === String(id) : (Array.isArray(sel) && sel.includes(id));
    const chips = items.map((it) => {
      const id = typeof it === "string" ? it : it.id;
      const lab = typeof it === "string" ? it : it.label;
      return `<button type="button" class="chip${isOn(id) ? " on" : ""}" data-act="${act}" data-id="${esc(id)}">${esc(lab)}</button>`;
    }).join("");
    return `<div class="label" style="margin-top:14px">${esc(label)}</div><div class="chips">${chips}</div>`;
  }

  function editProfileForm() {
    const me = state.me || { photos: [] };
    const d = state.editDraft || { gender: "", pronouns: "", sex: "", interestedIn: [], vibes: [], looking: [], hobbies: [], kandiTrades: "" };
    const ft = state.drafts.editHeightFt || "";
    const inn = state.drafts.editHeightIn || "";
    const ftOpts = ["", "4", "5", "6", "7"].map((v) => `<option value="${v}"${ft === v ? " selected" : ""}>${v ? v + " ft" : "—"}</option>`).join("");
    const inOpts = [""].concat(["0","1","2","3","4","5","6","7","8","9","10","11"]).map((v) => `<option value="${v}"${inn === v ? " selected" : ""}>${v === "" ? "—" : v + " in"}</option>`).join("");
    const hobbySet = Array.from(new Set(HOBBIES.concat(d.hobbies || [])));
    const customHobbies = (d.hobbies || []).filter((h) => !HOBBIES.includes(h));
    let tunes = "";
    for (let i = 0; i < MAX_TUNES; i++) {
      tunes += `<input data-field="editTune${i}" type="url" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Paste a Spotify, SoundCloud, or Apple Music link" value="${esc(state.drafts["editTune" + i] || "")}" style="margin-top:8px" />`;
    }
    return `<div style="display:flex;justify-content:center;margin:8px 0 16px">${profileAvatarEditor(me)}</div>
      ${photoEditor(me.photos)}
      <div class="label" style="margin-top:8px">Name</div>
      <input data-field="editName" placeholder="Name" value="${esc(state.drafts.editName || "")}" />
      <div class="label" style="margin-top:12px">Age (18+)</div>
      <input data-field="editAge" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="Age" value="${esc(state.drafts.editAge || "")}" />
      <div class="label" style="margin-top:12px">Bio</div>
      <textarea data-field="editBio" placeholder="A little about you...">${esc(state.drafts.editBio || "")}</textarea>
      ${editChipRow("Gender", GENDERS, d.gender, "edit-set-gender", true)}
      ${editChipRow("Pronouns", PRONOUNS.map((x) => ({ id: x, label: x })), d.pronouns, "edit-set-pronouns", true)}
      ${editChipRow("Sex", SEXES, d.sex, "edit-set-sex", true)}
      <div class="label" style="margin-top:14px">Height</div>
      <div class="row height-row"><select data-field="editHeightFt" aria-label="Height in feet">${ftOpts}</select>
        <select data-field="editHeightIn" aria-label="Height in inches">${inOpts}</select></div>
      ${editChipRow("Interested in", INTERESTED_IN, d.interestedIn, "edit-toggle-interested", false)}
      ${editChipRow("Music genres", VIBES.map((v) => ({ id: v, label: vibeLabel(v) })), d.vibes, "edit-toggle-vibe", false)}
      ${editChipRow("Looking for", LOOKING, d.looking, "edit-toggle-look", false)}
      <div class="label" style="margin-top:14px">Hobbies</div>
      <div class="chips">${hobbySet.map((h) => `<button type="button" class="chip${(d.hobbies || []).includes(h) ? " on" : ""}" data-act="edit-toggle-hobby" data-id="${esc(h)}">${esc(h)}</button>`).join("")}</div>
      <div class="row" style="margin-top:8px"><input data-field="editCustomHobby" placeholder="Add your own hobby" value="${esc(state.drafts.editCustomHobby || "")}" />
        <button type="button" class="btn sm ghost" data-act="edit-add-hobby">Add</button></div>
      ${customHobbies.length ? `<p class="tiny" style="margin-top:6px">Custom: ${customHobbies.map(esc).join(", ")}</p>` : ""}
      <div class="label" style="margin-top:14px">Favorite artists / DJs</div>
      <input data-field="editFavoriteArtists" placeholder="Who do you play on repeat?" value="${esc(state.drafts.editFavoriteArtists || "")}" />
      <div class="label" style="margin-top:12px">Favorite festival or show</div>
      <input data-field="editFavoriteFestival" placeholder="e.g. Das Energi, CRSSD" value="${esc(state.drafts.editFavoriteFestival || "")}" />
      <div class="label" style="margin-top:12px">Favorite venue</div>
      <input data-field="editFavoriteVenue" placeholder="e.g. The Great Saltair, Soundwell" value="${esc(state.drafts.editFavoriteVenue || "")}" />
      <div class="label" style="margin-top:12px">Favorite hangout</div>
      <input data-field="editFavoriteHangout" placeholder="Where do you post up?" value="${esc(state.drafts.editFavoriteHangout || "")}" />
      ${editChipRow("Kandi trades", KANDI_TRADES, d.kandiTrades, "edit-set-trades", true)}
      <div class="label" style="margin-top:12px">Rave totem</div>
      <input data-field="editRaveTotem" placeholder="How do people find you in the crowd?" value="${esc(state.drafts.editRaveTotem || "")}" />
      <div class="label" style="margin-top:12px">Years raving</div>
      <input data-field="editYearsRaving" placeholder="e.g. 6" value="${esc(state.drafts.editYearsRaving || "")}" />
      <div class="label" style="margin-top:18px">My Tunes</div>
      <p class="tiny">Paste up to 5 links from Spotify, SoundCloud, or Apple Music — tracks, playlists, or albums. We'll show a player on your profile.</p>
      ${tunes}
      ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
      <div class="edit-preview-actions">
        <button type="button" class="btn ghost" data-act="preview-profile">Preview</button>
        <button type="button" class="btn primary" data-act="save-profile">Save</button>
      </div>
      <div style="height:24px"></div>`;
  }

  function composerMediaPreview() {
    const media = state.composerMedia || { photos: [], video: null, previews: [] };
    if (media.video) {
      const src = (media.previews && media.previews[0]) || "";
      const videoUrl = media.videoUrl || "";
      return `<div class="composer-preview-wrap">
        <video class="composer-video" ${videoUrl ? `src="${esc(videoUrl)}"` : ""} ${src ? `poster="${esc(src)}"` : ""} playsinline webkit-playsinline controls preload="metadata"></video>
        <button type="button" class="btn sm ghost" data-act="clear-composer-media">Remove video</button>
      </div>`;
    }
    if (media.photos && media.photos.length) {
      return `<div class="composer-preview-wrap"><div class="composer-thumbs">` + media.photos.map((file, i) => {
        const src = (media.previews && media.previews[i]) || "";
        return `<div class="composer-thumb" style="background-image:url('${esc(src)}')"><button type="button" class="slot-x" data-act="remove-composer-photo" data-i="${i}" aria-label="Remove photo">×</button></div>`;
      }).join("") + `</div>
        <button type="button" class="btn sm ghost" data-act="clear-composer-media">Remove photos</button></div>`;
    }
    return `<p class="muted" style="margin-top:8px">Add photos or one short video (up to 60 seconds). Caption and a rave tag are optional — same as a regular feed post.</p>`;
  }

  function composerView() {
    const evs = state.events || [];
    const photo = hiddenFileInput("post-photos", "Add photos", { accept: "image/*", multiple: true });
    const video = hiddenFileInput("post-video", "Add a short video", { accept: "video/*,video/mp4,video/quicktime,.mov,.mp4,.m4v" });
    return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Cancel">✕</button><span style="font-weight:800">New post</span></div>
      <div class="right"><button type="button" class="btn sm primary" data-act="submit-post">Post</button></div></div>
      <div class="scroll pad">
        <textarea data-field="caption" placeholder="Write a caption..." style="margin-top:8px;min-height:96px">${esc(state.drafts.caption || "")}</textarea>
        ${composerMediaPreview()}
        <div class="composer-add">
          ${photo.input}<label class="btn sm ghost" for="${photo.id}">Add photos</label>
          ${video.input}<label class="btn sm ghost" for="${video.id}">Add video</label>
        </div>
        <div class="label" style="margin-top:16px">Tag a rave or concert (optional)</div>
        <div class="chips"><button type="button" class="chip${!(state.drafts.postEvent) ? " on" : ""}" data-act="post-event" data-id="">None</button>
          ${evs.map((e) => `<button type="button" class="chip${state.drafts.postEvent === e.id ? " on" : ""}" data-act="post-event" data-id="${esc(e.id)}">${esc(e.emoji || "")} ${esc(e.name)}</button>`).join("")}</div>
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        <div style="height:28px"></div>
      </div></div>`;
  }

  function overlays() {
    if (state.storyViewer) return storyViewerHtml();
    const o = state.overlay;
    if (!o) return "";
    if (o.type === "storyComposer") return storyComposerHtml();
    if (o.type === "composer") {
      return composerView();
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
      if (o.preview) {
        const built = draftPreviewUser();
        const me = state.me || {};
        const soc = state.profile && state.profile.user && Number(state.profile.user.id) === Number(me.id) ? state.profile : null;
        const posts = (soc && soc.posts) || [];
        const counts = soc && soc.user ? { followerCount: soc.user.followerCount, followingCount: soc.user.followingCount } : {};
        const view = built.user || Object.assign({}, me);
        return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="btn sm ghost" data-act="edit-back">Back to editing</button></div>
          <div class="right"><button type="button" class="btn sm primary" data-act="save-profile">Save</button></div></div>
          <div class="scroll pad">
            <p class="tiny edit-preview-note">This is how other people see your profile. Unsaved edits are included.</p>
            ${built.error ? `<div class="err">${esc(built.error)}</div>` : profilePreview(view, posts, { isMe: false, asOthers: true, counts })}
          </div></div>`;
      }
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Cancel">✕</button><span style="font-weight:800">Edit Profile</span></div>
        <div class="right"><button type="button" class="btn sm ghost" data-act="preview-profile">Preview</button><button type="button" class="btn sm primary" data-act="save-profile">Save</button></div></div>
        <div class="scroll pad">${editProfileForm()}</div></div>`;
    }
    if (o.type === "settings") {
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button><span style="font-weight:800">Settings</span></div></div>
        <div class="scroll pad">${settingsBody()}</div></div>`;
    }
    if (o.type === "post") {
      const p = state.openPost || findPost(o.id);
      if (!p) return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button></div></div><div class="empty">Couldn't load this post.</div></div>`;
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button><span style="font-weight:800">Post</span></div></div>
        <div class="scroll">${postCard(p)}</div></div>`;
    }

    if (o.type === "profile") {
      const data = state.profile;
      if (!data || !data.user) return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button></div></div><div class="empty">Couldn't load this profile.</div></div>`;
      const u = data.user;
      const followBtn = u.isMe ? "" : (u.following
        ? `<button type="button" class="btn sm ghost" data-act="unfollow" data-id="${u.id}">Following</button>`
        : `<button type="button" class="btn sm primary" data-act="follow" data-id="${u.id}">Follow</button>`);
      const extra = u.isMe
        ? ""
        : `<button type="button" class="btn ghost" style="margin-top:24px" data-act="report" data-id="${u.id}">Report / block</button>`;
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button><span style="font-weight:800">${esc(u.name)}</span></div><div class="right">${followBtn}</div></div>
        <div class="scroll pad">
          ${profilePreview(u, data.posts || [], { isMe: Boolean(u.isMe), counts: { followerCount: u.followerCount, followingCount: u.followingCount } })}
          ${!u.isMe ? `<div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">${goerActions(u)}</div>` : ""}
          ${extra}
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
        ${bothGoingLine(o.sharedEvents || (state.matches.find((m) => m.user && m.user.id === p.id) || {}).sharedEvents, o.meetPlan || (state.matches.find((m) => m.user && m.user.id === p.id) || {}).meetPlan)}
        ${(o.sharedEvents || (state.matches.find((m) => m.user && m.user.id === p.id) || {}).sharedEvents || []).length ? `<button class="btn ghost" style="margin-top:12px;max-width:280px" data-act="pick-meet" data-id="${p.id}">Pick a meet spot</button>` : ""}
        <button class="btn primary" style="margin-top:12px;max-width:280px" data-act="chat" data-id="${p.id}">Send a message</button>
        <button class="btn ghost" style="margin-top:8px;max-width:280px" data-act="close">Keep browsing</button></div></div>`;
    }
    if (o.type === "liked") {
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Like sent</h2>
        <p class="sub">If they like you back, you'll match and can start chatting.</p>
        <button class="btn primary" style="margin-top:18px" data-act="close">Nice</button></div></div>`;
    }
    if (o.type === "likeSheet") {
      const p = state.feed.find((x) => x.id === o.id) || (state.inbound.people || []).find((x) => x.id === o.id)
        || (state.events || []).flatMap((e) => e.going || []).find((x) => Number(x.id) === Number(o.id))
        || (state.profile && state.profile.user && Number(state.profile.user.id) === Number(o.id) ? state.profile.user : null)
        || o.person || { name: "" };
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
      const f = state.filters || {};
      const ageMin = f.ageMin != null ? f.ageMin : 18;
      const ageMax = f.ageMax != null ? f.ageMax : 99;
      const eventBlock = isPlus()
        ? `<div class="label" style="margin-top:14px">Event</div><div class="chips">
        <button type="button" class="chip${f.event === "all" ? " on" : ""}" data-act="set-event-filter" data-id="all">All events</button>
        ${(state.events || []).map((e) => `<button type="button" class="chip${f.event === e.id ? " on" : ""}" data-act="set-event-filter" data-id="${e.id}">${esc(e.name)}</button>`).join("")}</div>`
        : `<div class="label" style="margin-top:14px">Event</div><p class="tiny">Event filters are a Kandi+ feature. <button type="button" class="tiny" data-act="paywall" data-reason="filters" style="color:var(--orange2);font-weight:700">See Kandi+</button></p>`;
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Filters</h2>
        <div class="label">Age range</div>
        <div class="row height-row"><input data-field="filterAgeMin" type="number" min="18" max="99" inputmode="numeric" aria-label="Minimum age" value="${esc(String(ageMin))}" />
          <span class="muted">to</span>
          <input data-field="filterAgeMax" type="number" min="18" max="99" inputmode="numeric" aria-label="Maximum age" value="${esc(String(ageMax))}" /></div>
        <div class="label" style="margin-top:14px">Gender</div><div class="chips"><button type="button" class="chip${(f.gender || "all") === "all" ? " on" : ""}" data-act="set-gender-filter" data-id="all">Everyone</button>
        ${GENDERS.map((g) => `<button type="button" class="chip${f.gender === g.id ? " on" : ""}" data-act="set-gender-filter" data-id="${g.id}">${esc(g.label)}</button>`).join("")}</div>
        <div class="label" style="margin-top:14px">Music genre</div><div class="chips"><button type="button" class="chip${(f.genre || "all") === "all" ? " on" : ""}" data-act="set-genre" data-id="all">All genres</button>
        ${VIBES.map((g) => `<button type="button" class="chip${f.genre === g ? " on" : ""}" data-act="set-genre" data-id="${g}">${esc(vibeLabel(g))}</button>`).join("")}</div>
        ${eventBlock}
        <button type="button" class="btn primary" style="margin-top:16px" data-act="apply-filters">Done</button></div></div>`;
    }
    if (o.type === "event") {
      const e = findEvent(o.id);
      if (!e) return `<div class="overlay top-pad"><div class="header"><div class="left"><button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button></div></div><div class="empty">Couldn't load this event.</div></div>`;
      return `<div class="overlay top-pad"><div class="header"><div class="left"><button class="icon-btn" data-act="close" aria-label="Close">✕</button><span style="font-weight:800">${esc(e.name)}</span></div></div>
        <div class="scroll pad"><div class="photo" style="background:${esc(e.color)};height:180px">${e.imageUrl ? `<img src="${esc(e.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<div class="emoji">${e.emoji}</div>`}</div>
        <p class="event-updated" style="margin:12px 0 6px">${e.category === "rave" ? "Rave / EDM" : "Concert"}${e.ageLimit ? " · " + esc(e.ageLimit) : ""}</p>
        <div class="event-detail-row"><div class="label" style="margin:0">Date &amp; time</div><div class="muted">${esc(eventWhen(e))}</div></div>
        <div class="event-detail-row"><div class="label" style="margin:0">Venue</div><div class="muted">${esc(e.venue || "Venue TBA")}${e.city ? " · " + esc(e.city) : ""}</div></div>
        <div class="event-detail-row"><div class="label" style="margin:0">Address</div><div>${eventAddressLine(e)}</div></div>
        <div class="event-detail-row"><div class="label" style="margin:0">Tickets</div><div>${eventTicketLine(e)}</div></div>
        ${(e.artists || []).length ? `<div class="tiny" style="margin-top:6px">${e.artists.map(esc).join(" · ")}</div>` : ""}
        ${eventActions(e)}
        ${rsvpToggles(e)}
        ${e.imOpenToMeet ? `<div class="meet-note-box"><div class="tiny" style="margin-bottom:8px">Your meetup note</div>
          <div class="chips">${["down to rail", "looking for a crew", "date"].map((n) =>
            `<button type="button" class="chip${(e.meetNote || "") === n ? " on" : ""}" data-act="meet-note" data-id="${esc(e.id)}" data-t="${esc(n)}">${esc(n)}</button>`).join("")}</div>
          <div class="row" style="margin-top:8px;gap:8px"><input data-field="meetNote" aria-label="Meetup note" placeholder="Or write your own (e.g. down to rail)" value="${esc(state.drafts.meetNote != null && state.drafts.meetNote !== "" ? state.drafts.meetNote : (e.meetNote || ""))}" />
          <button type="button" class="btn sm primary" data-act="save-meet-note" data-id="${esc(e.id)}">Save</button></div></div>` : ""}
        ${!isVip() ? `<button class="btn ghost" style="margin-bottom:12px" data-act="paywall" data-reason="priority">Get priority at events with Kandi VIP</button>` : `<div class="notice ok" style="margin-bottom:12px">Kandi VIP priority is on.</div>`}
        <div class="row" style="margin:6px 0 8px"><div class="label grow" style="margin:0">Photos from this show</div>
          <button class="btn sm primary" data-act="open-composer" data-event="${esc(e.id)}">📷 Add photos</button></div>
        ${(state.eventPosts && state.eventPosts.id === e.id)
          ? ((state.eventPosts.posts || []).length
            ? `<div class="post-grid" style="margin-bottom:16px">${state.eventPosts.posts.map((post) => post.photoUrl
                ? `<button style="background-image:url('${esc(mediaUrl(post.photoUrl))}')" data-act="open-post" data-id="${post.id}" aria-label="Photo by ${esc(post.author.name)}">${(post.photoUrls || []).length > 1 ? `<span class="multi">▣ ${post.photoUrls.length}</span>` : ""}</button>`
                : `<button data-act="open-post" data-id="${post.id}"><span class="txt">${esc((post.caption || "").slice(0, 80))}</span></button>`).join("")}</div>`
            : `<p class="tiny" style="margin-bottom:16px">No photos yet. Going? Be the first to share the vibe.</p>`)
          : `<p class="tiny" style="margin-bottom:16px"><span class="spin"></span> Loading photos…</p>`}
        <div class="label">Who's going (${e.goingCount != null ? e.goingCount : (e.going || []).length})</div>
        ${(e.going || []).length ? e.going.map((p) => goerRow(p)).join("") : `<p class="tiny">No one has marked this show yet. Be the first.</p>`}
        ${(e.openToMeet || []).length ? `<div class="label" style="margin-top:16px">Open to meet (${e.openCount != null ? e.openCount : e.openToMeet.length})</div>` + e.openToMeet.map((p) => goerRow(p)).join("") : ""}
        <button type="button" class="btn primary" style="margin-top:8px" data-act="open-live" data-id="${e.id}">Open at-the-show live mode</button></div></div>`;
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
        <div class="chat-head">${personAvatar(p, "av chat")}<div><div class="nm">${esc(p.name)}</div>${state.chatShared && state.chatShared[0] ? `<div class="tiny">Both going to ${esc(state.chatShared[0].name)}</div>` : ""}</div></div></div>
        <div class="right"><button class="icon-btn" data-act="report" data-id="${p.id}" title="Report or block" aria-label="Report or block">⚑</button></div></div>
        ${bothGoingLine(state.chatShared, state.chatMeetPlan)}
        ${state.chatShared && state.chatShared.length ? `<div style="padding:0 16px 8px"><button type="button" class="btn sm ghost" data-act="pick-meet" data-id="${p.id}">${state.chatMeetPlan && (state.chatMeetPlan.spot || state.chatMeetPlan.time) ? "Edit meet spot" : "Pick a meet spot"}</button></div>` : ""}
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
    if (o.type === "meetSpot") {
      const shared = o.sharedEvents || state.chatShared || [];
      const plan = o.meetPlan || state.chatMeetPlan || {};
      const evKey = state.drafts.meetEvent || plan.eventKey || (shared[0] && (shared[0].eventKey || shared[0].id)) || "";
      return `<div class="sheet-bg" data-act="close"><div class="sheet" data-stop="1"><div class="grab"></div>
        <h2 class="h2" style="font-size:22px">Pick a meet spot</h2>
        <p class="sub">Saved for both of you — e.g. “By the merch booth at 10:30”.</p>
        ${shared.length > 1 ? `<div class="label" style="margin-top:12px">Show</div><div class="chips">${shared.map((e) =>
          `<button type="button" class="chip${(e.eventKey || e.id) === evKey ? " on" : ""}" data-act="meet-event" data-id="${esc(e.eventKey || e.id)}">${esc(eventChipLabel(e))}</button>`).join("")}</div>` : (shared[0] ? `<p class="muted" style="margin-top:12px">${esc(shared[0].name)}</p>` : "")}
        <input data-field="meetSpot" aria-label="Meet spot" placeholder="By the merch booth" value="${esc(state.drafts.meetSpot || plan.spot || "")}" style="margin-top:12px" />
        <input data-field="meetTime" aria-label="Meet time" placeholder="10:30" value="${esc(state.drafts.meetTime || plan.time || "")}" style="margin-top:8px" />
        ${state.err ? `<div class="err">${esc(state.err)}</div>` : ""}
        <button type="button" class="btn primary" style="margin-top:16px" data-act="save-meet" data-id="${o.id}">Save meet plan</button>
        <button type="button" class="btn ghost" style="margin-top:8px" data-act="close-meet">Cancel</button></div></div>`;
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
      const storyOpen = Boolean(state.storyViewer);
      html = `<div class="screen has-tabs${storyOpen ? " story-open" : ""}">${body}${tabbar()}${overlays()}</div>`;
    }
    // Keep scroll position and the focused field across re-renders (likes, follows, typing feedback).
    const v = state.storyViewer;
    const key = state.view + "|" + state.tab + "|" + state.feedTab + "|" + ((state.overlay && state.overlay.type) || "") + "|" + (v ? (v.ringIndex + ":" + v.storyIndex + ":" + (v.showViewers ? "v" : "")) : "");
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
    if (state.storyViewer) startStoryPlayback();
    else stopStoryPlayback();
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
        startEditDraft();
        state.overlay = { type: "editProfile" };
        render(); return;
      }
      if (act === "settings") { state.overlay = { type: "settings" }; render(); return; }
      if (act === "profile-tab") { state.profileTab = id === "about" ? "about" : "posts"; render(); return; }
      if (act === "post-view") { state.profilePostView = id === "list" ? "list" : "grid"; render(); return; }
      if (act === "edit-set-gender") { state.editDraft = state.editDraft || {}; state.editDraft.gender = state.editDraft.gender === id ? "" : id; render(); return; }
      if (act === "edit-set-pronouns") { state.editDraft = state.editDraft || {}; state.editDraft.pronouns = state.editDraft.pronouns === id ? "" : id; render(); return; }
      if (act === "edit-set-sex") { state.editDraft = state.editDraft || {}; state.editDraft.sex = state.editDraft.sex === id ? "" : id; render(); return; }
      if (act === "edit-set-trades") { state.editDraft = state.editDraft || {}; state.editDraft.kandiTrades = state.editDraft.kandiTrades === id ? "" : id; render(); return; }
      if (act === "edit-toggle-vibe") {
        state.editDraft = state.editDraft || { vibes: [] };
        const cur = state.editDraft.vibes || [];
        state.editDraft.vibes = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
        render(); return;
      }
      if (act === "edit-toggle-look") {
        state.editDraft = state.editDraft || { looking: [] };
        const cur = state.editDraft.looking || [];
        state.editDraft.looking = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
        render(); return;
      }
      if (act === "edit-toggle-interested") {
        state.editDraft = state.editDraft || { interestedIn: [] };
        const cur = state.editDraft.interestedIn || [];
        state.editDraft.interestedIn = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
        render(); return;
      }
      if (act === "edit-toggle-hobby") {
        state.editDraft = state.editDraft || { hobbies: [] };
        const cur = state.editDraft.hobbies || [];
        state.editDraft.hobbies = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
        render(); return;
      }
      if (act === "edit-add-hobby") {
        const raw = String(state.drafts.editCustomHobby || "").trim();
        if (!raw) return;
        state.editDraft = state.editDraft || { hobbies: [] };
        const cur = state.editDraft.hobbies || [];
        if (!cur.includes(raw) && cur.length < 20) state.editDraft.hobbies = cur.concat(raw);
        state.drafts.editCustomHobby = "";
        render(); return;
      }
      if (act === "preview-profile") {
        const built = draftPreviewUser();
        if (built.error) { state.err = built.error; render(); return; }
        state.err = "";
        state.profileTab = state.profileTab || "posts";
        state.overlay = { type: "editProfile", preview: true };
        render(); return;
      }
      if (act === "edit-back") {
        state.err = "";
        state.overlay = { type: "editProfile" };
        render(); return;
      }
      if (act === "save-profile") {
        const collected = collectEditFields();
        if (collected.error) {
          state.err = collected.error;
          if (state.overlay && state.overlay.type === "editProfile" && state.overlay.preview) {
            state.overlay = { type: "editProfile" };
          }
          render(); return;
        }
        const body = collected.body;
        const data = await api("/api/me", { method: "PUT", body });
        state.me = data.user;
        state.overlay = null;
        state.err = "";
        if (state.me) await loadProfile(state.me.id);
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
        if (state.storyViewer) { stopStoryPlayback(); state.storyViewer = null; }
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
        if (state.storyViewer) { closeStoryViewer(); return; }
        if (state.overlay && state.overlay.type === "storyComposer") { clearStoryDraft(); state.overlay = null; render(); return; }
        if (state.overlay && state.overlay.type === "editProfile" && state.overlay.preview) {
          state.overlay = { type: "editProfile" };
          state.err = "";
          render(); return;
        }
        const back = (state.overlay && state.overlay.returnTo) || state.overlayBack;
        if (state.overlay && state.overlay.type === "composer") {
          clearComposerMedia();
          clearPostFiles();
        }
        state.overlayBack = null;
        if (back && back !== state.overlay) {
          state.overlay = back;
          render(); return;
        }
        state.overlay = null;
        state.openPost = null;
        render(); return;
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
        if (!state.events.length) await loadEvents();
        state.err = "";
        state.drafts.caption = "";
        state.drafts.postEvent = fromEvent || "";
        clearComposerMedia();
        clearPostFiles();
        state.composerReturn = fromEvent ? "event" : ((id === "you" || state.tab === "you" || (state.overlay && state.overlay.type === "profile")) ? "you" : "home");
        state.overlay = { type: "composer", returnTo: fromEvent ? { type: "event", id: fromEvent } : null };
        render(); return;
      }
      if (act === "remove-post-photo") {
        const i = Number(id);
        const list = state.drafts.postFiles || [];
        if (list[i]) { try { URL.revokeObjectURL(list[i].url); } catch (_) {} list.splice(i, 1); }
        render(); return;
      }
      if (act === "post-event") { state.drafts.postEvent = id || ""; render(); return; }
      if (act === "clear-composer-media") { clearComposerMedia(); render(); return; }
      if (act === "remove-composer-photo") {
        const i = Number(el.getAttribute("data-i"));
        const media = state.composerMedia || { photos: [], previews: [] };
        if (Number.isInteger(i) && media.photos[i]) {
          const prev = media.previews[i];
          if (prev && String(prev).startsWith("blob:")) { try { URL.revokeObjectURL(prev); } catch (_) {} }
          media.photos.splice(i, 1);
          media.previews.splice(i, 1);
          state.composerMedia = media;
        }
        render(); return;
      }
      if (act === "submit-post") {
        const media = state.composerMedia || { photos: [], video: null, poster: null };
        const caption = state.drafts.caption || "";
        const leftoverPhotos = (state.drafts.postFiles || []).map((f) => f.file).filter(Boolean);
        const photos = (media.photos && media.photos.length) ? media.photos : leftoverPhotos;
        if (!caption && !photos.length && !media.video && !state.drafts.postEvent) {
          state.err = "Add a photo, a short video, a caption, or tag a rave.";
          render(); return;
        }
        const fd = new FormData();
        fd.append("caption", caption);
        if (state.drafts.postEvent) fd.append("eventId", state.drafts.postEvent);
        if (media.video) {
          fd.append("video", media.video, media.video.name || "clip.mp4");
          if (media.poster) fd.append("poster", media.poster, "poster.jpg");
        } else {
          const allPhotos = photos;
          for (let i = 0; i < allPhotos.length; i++) {
            if (allPhotos.length > 1) toast(`Preparing photo ${i + 1} of ${allPhotos.length}…`);
            let photo = allPhotos[i];
            try {
              const compressed = await compressImage(photo);
              if (compressed) photo = compressed;
            } catch (_) { /* send the original; the server will normalize it */ }
            fd.append("photos", photo, (photo && photo.name) || ("photo-" + (i + 1) + ".jpg"));
          }
        }
        const created = await api("/api/posts", { method: "POST", body: fd, timeout: 120000 });
        clearComposerMedia();
        clearPostFiles();
        const back = state.overlay && state.overlay.returnTo;
        toast((photos && photos.length) || media.video ? "Posted! 📸" : "Posted!");
        state.err = "";
        state.profileTab = "posts";
        if (back && back.type === "event") {
          state.overlay = back;
          state.overlayBack = null;
          await loadEventPosts(back.id);
          if (created && created.post) state.homePosts = [created.post].concat((state.homePosts || []).filter((x) => x.id !== created.post.id));
          if (state.me) await loadProfile(state.me.id);
          render(); return;
        }
        state.overlay = null;
        state.overlayBack = null;
        if (state.composerReturn === "you") {
          state.tab = "you";
        } else {
          state.feedTab = "following";
          state.tab = "home";
          if (created && created.post) state.homePosts = [created.post].concat((state.homePosts || []).filter((x) => x.id !== created.post.id));
        }
        await loadHome();
        if (created && created.post && !(state.homePosts || []).some((x) => x.id === created.post.id)) state.homePosts.unshift(created.post);
        if (state.me) await loadProfile(state.me.id);
        render(); return;
      }
      if (act === "open-post") {
        let post = findPost(id);
        if (!post) {
          const data = await api("/api/posts/" + id);
          post = data.post;
        }
        if (!post) throw new Error("Couldn't load this post.");
        state.openPost = post;
        if (state.overlay) state.overlayBack = state.overlay;
        state.overlay = { type: "post", id: post.id };
        render(); return;
      }
      if (act === "open-profile") {
        await loadProfile(id);
        state.profileTab = "posts";
        if (state.overlay && state.overlay.type !== "profile") state.overlayBack = state.overlay;
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
        const post = findPost(id);
        const liked = post && post.liked;
        const data = await api("/api/posts/" + id + "/like", { method: liked ? "DELETE" : "POST", body: {} });
        const apply = (p) => { if (p && String(p.id) === String(id)) { p.liked = data.liked; p.likeCount = data.likeCount; } };
        (state.homePosts || []).forEach(apply);
        if (state.profile && state.profile.posts) state.profile.posts.forEach(apply);
        if (state.openPost) apply(state.openPost);
        render(); return;
      }
      if (act === "post-like-tap") {
        const now = Date.now();
        const prev = state._lastTap || {};
        if (prev.id === String(id) && now - prev.at < 350) {
          const post = findPost(id);
          if (!post || !post.liked) {
            const data = await api("/api/posts/" + id + "/like", { method: "POST", body: {} });
            const apply = (p) => { if (p && String(p.id) === String(id)) { p.liked = data.liked; p.likeCount = data.likeCount; } };
            (state.homePosts || []).forEach(apply);
            if (state.profile && state.profile.posts) state.profile.posts.forEach(apply);
            if (state.openPost) apply(state.openPost);
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
        if (prev && prev.type !== "comments") state.overlayBack = prev;
        state.overlay = { type: "comments", returnTo: prev && (prev.type === "event" || prev.type === "profile" || prev.type === "post") ? prev : null };
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
        if (state.openPost && String(state.openPost.id) === String(id)) {
          state.openPost = null;
          if (state.overlay && state.overlay.type === "post") {
            state.overlay = state.overlayBack;
            state.overlayBack = null;
          }
        }
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
        state.drafts.filterAgeMin = String((state.filters && state.filters.ageMin) || 18);
        state.drafts.filterAgeMax = String((state.filters && state.filters.ageMax) || 99);
        state.overlay = { type: "filters" }; render(); return;
      }
      if (act === "set-genre") { state.filters.genre = id; render(); return; }
      if (act === "set-gender-filter") { state.filters.gender = id || "all"; render(); return; }
      if (act === "set-event-filter") {
        if (!isPlus() && id && id !== "all") { state.overlay = { type: "paywall", reason: "filters" }; render(); return; }
        state.filters.event = id; render(); return;
      }
      if (act === "event-cat") { state.eventCategory = id || "all"; render(); return; }
      if (act === "apply-filters") {
        const lo = Number(state.drafts.filterAgeMin);
        const hi = Number(state.drafts.filterAgeMax);
        state.filters.ageMin = Number.isFinite(lo) ? Math.max(18, Math.min(99, lo)) : 18;
        state.filters.ageMax = Number.isFinite(hi) ? Math.max(18, Math.min(99, hi)) : 99;
        if (state.filters.ageMin > state.filters.ageMax) {
          const swap = state.filters.ageMin;
          state.filters.ageMin = state.filters.ageMax;
          state.filters.ageMax = swap;
        }
        state.overlay = null;
        await loadFeed();
        render(); return;
      }
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
        if (!state.events.length) await loadEvents();
        if (state.overlay && state.overlay.type !== "event") state.overlayBack = state.overlay;
        state.overlay = { type: "event", id };
        render();
        await loadEventPosts(id);
        if (state.overlay && state.overlay.type === "event" && state.overlay.id === id) render();
        return;
      }

      if (act === "toggle-meet") {
        const ev = state.events.find((x) => x.id === id);
        if (!ev) return;
        const open = !ev.imOpenToMeet;
        await api("/api/events/" + encodeURIComponent(id) + "/meet", { method: "POST", body: { open, note: ev.meetNote || state.drafts.meetNote || "" } });
        await loadEvents();
        if (open && state.overlay && state.overlay.type === "event") state.drafts.meetNote = ev.meetNote || "";
        render(); return;
      }
      if (act === "meet-note") {
        const note = (el && el.getAttribute("data-t")) || "";
        state.drafts.meetNote = note;
        await api("/api/events/" + encodeURIComponent(id) + "/meet", { method: "POST", body: { open: true, note } });
        await loadEvents(); render(); return;
      }
      if (act === "save-meet-note") {
        const note = String(state.drafts.meetNote || "").trim();
        await api("/api/events/" + encodeURIComponent(id) + "/meet", { method: "POST", body: { open: true, note } });
        await loadEvents(); toast(note ? "Meetup note saved." : "Meetup note cleared."); render(); return;
      }
      if (act === "same-show") {
        state.filters.event = (state.filters.event && state.filters.event !== "all") ? "all" : "same";
        await loadFeed(); render(); return;
      }
      if (act === "pick-same-event") {
        state.filters.event = id || "same";
        await loadFeed(); render(); return;
      }
      if (act === "toggle-show-upcoming") {
        const on = !(state.me && state.me.showUpcoming !== false);
        const data = await api("/api/me", { method: "PUT", body: { showUpcoming: on } });
        state.me = data.user; render(); return;
      }
      if (act === "pick-meet") {
        const m = state.matches.find((x) => String(x.user.id) === String(id)) || {};
        const shared = state.chatShared && state.chatWith && String(state.chatWith.id) === String(id)
          ? state.chatShared
          : (m.sharedEvents || []);
        const plan = (state.chatWith && String(state.chatWith.id) === String(id) && state.chatMeetPlan) || m.meetPlan || null;
        state.drafts.meetSpot = (plan && plan.spot) || "";
        state.drafts.meetTime = (plan && plan.time) || "";
        state.drafts.meetEvent = (plan && plan.eventKey) || (shared[0] && (shared[0].eventKey || shared[0].id)) || "";
        state.overlay = { type: "meetSpot", id: Number(id), sharedEvents: shared, meetPlan: plan, back: state.overlay && state.overlay.type === "chat" ? "chat" : (state.overlay && state.overlay.type) };
        render(); return;
      }
      if (act === "meet-event") { state.drafts.meetEvent = id; render(); return; }
      if (act === "close-meet") {
        if (state.overlay && state.overlay.back === "chat" && state.chatWith) state.overlay = { type: "chat", id: state.chatWith.id };
        else state.overlay = null;
        state.err = ""; render(); return;
      }
      if (act === "save-meet") {
        const m = state.matches.find((x) => String(x.user.id) === String(id));
        const matchId = state.chatMatchId || (m && m.matchId);
        if (!matchId) { state.err = "Open the chat from Matches to save a meet spot."; render(); return; }
        const data = await api("/api/matches/" + matchId + "/meet", { method: "POST", body: { eventKey: state.drafts.meetEvent || "", spot: state.drafts.meetSpot || "", time: state.drafts.meetTime || "" } });
        state.chatMeetPlan = data.meetPlan;
        state.chatShared = data.sharedEvents || state.chatShared;
        await loadMatches();
        if (state.chatWith) state.overlay = { type: "chat", id: state.chatWith.id };
        else state.overlay = null;
        toast("Meet plan saved."); render(); return;
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
      if (act === "open-story") {
        const uid = Number(id);
        let rings = (state.storyRings || []).filter((r) => (r.stories || []).length);
        let idx = rings.findIndex((r) => Number(r.user && r.user.id) === uid);
        if (idx < 0) {
          const st = await api("/api/stories/user/" + uid);
          if (!st.stories || !st.stories.length) { toast("No active story."); return; }
          const ring = { user: st.user, stories: st.stories, unseen: st.stories.some((s) => !s.viewed), storyCount: st.stories.length };
          rings = rings.concat([ring]);
          idx = rings.length - 1;
        }
        // From the home bar, start at this person and continue through the rest of the tray.
        const start = rings.splice(idx, 1)[0];
        const ordered = [start].concat(rings.filter((r) => !(r.user && r.user.isMe) || Number(r.user.id) === uid));
        state.drafts.storyReply = "";
        state.overlay = { type: "story" };
        state.storyViewer = { rings: ordered, ringIndex: 0, storyIndex: 0, showViewers: false, viewers: null };
        render();
        return;
      }
      if (act === "story-close") { closeStoryViewer(); return; }
      if (act === "story-next") { goStory(1); return; }
      if (act === "story-prev") { goStory(-1); return; }
      if (act === "open-story-composer") {
        if (state.storyViewer) closeStoryViewer();
        clearStoryDraft();
        state.storyDraft = { file: null, preview: "", kind: "photo" };
        state.overlay = { type: "storyComposer" };
        state.err = "";
        if (!(state.events || []).length) try { await loadEvents(); } catch (_) {}
        render();
        return;
      }
      if (act === "story-composer-close") {
        clearStoryDraft();
        state.overlay = null;
        render();
        return;
      }
      if (act === "story-event") { state.drafts.storyEvent = id || ""; render(); return; }
      if (act === "submit-story") {
        const d = state.storyDraft;
        if (!d || !d.file) { state.err = "Add a photo or a short video first."; render(); return; }
        state.uploadingPhoto = true;
        state.uploadProgress = 0;
        state.uploadError = "";
        render();
        try {
          const fd = new FormData();
          if (d.kind === "video") fd.append("video", d.file);
          else fd.append("photo", d.file);
          if (state.drafts.storyText) fd.append("textOverlay", state.drafts.storyText.trim());
          if (state.drafts.storyEvent) fd.append("eventId", state.drafts.storyEvent);
          const data = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/stories");
            xhr.withCredentials = true;
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = () => {
              let body = {};
              try { body = JSON.parse(xhr.responseText || "{}"); } catch (_) {}
              if (xhr.status >= 200 && xhr.status < 300) resolve(body);
              else reject(new Error(body.error || "Couldn't post that story."));
            };
            xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
            xhr.send(fd);
          });
          clearStoryDraft();
          state.overlay = null;
          state.uploadingPhoto = false;
          state.uploadProgress = null;
          await loadStories();
          render();
          toast("Story is live for 24 hours.");
        } catch (err) {
          state.uploadingPhoto = false;
          state.uploadProgress = null;
          state.uploadError = err.message || "Couldn't post that story.";
          state.err = state.uploadError;
          render();
          toast(state.err, "err");
        }
        return;
      }
      if (act === "delete-story") {
        const sid = Number(id);
        await api("/api/stories/" + sid, { method: "DELETE" });
        const v = state.storyViewer;
        if (v) {
          const ring = v.rings[v.ringIndex];
          if (ring) ring.stories = (ring.stories || []).filter((s) => Number(s.id) !== sid);
          if (!ring || !ring.stories.length) {
            v.rings.splice(v.ringIndex, 1);
            if (!v.rings.length) { await loadStories(); closeStoryViewer(); return; }
            v.ringIndex = Math.min(v.ringIndex, v.rings.length - 1);
            v.storyIndex = 0;
          } else if (v.storyIndex >= ring.stories.length) {
            v.storyIndex = ring.stories.length - 1;
          }
        }
        await loadStories();
        render();
        toast("Story deleted.");
        return;
      }
      if (act === "story-viewers") {
        const cur = currentStory();
        if (!cur) return;
        const data = await api("/api/stories/" + cur.story.id + "/viewers");
        state.storyViewer.showViewers = true;
        state.storyViewer.viewers = data.viewers || [];
        render();
        return;
      }
      if (act === "story-hide-viewers") {
        if (state.storyViewer) { state.storyViewer.showViewers = false; render(); }
        return;
      }
      if (act === "story-reply") {
        const cur = currentStory();
        const text = (state.drafts.storyReply || "").trim();
        if (!cur || !text) return;
        try {
          await api("/api/stories/" + cur.story.id + "/reply", { method: "POST", body: { text } });
          state.drafts.storyReply = "";
          const input = document.querySelector('[data-field="storyReply"]');
          if (input) input.value = "";
          toast("Reply sent.");
        } catch (err) {
          if (err.data && err.data.code === "need_match") toast("Match with them first to reply to their story.", "warn");
          else toast(err.message || "Couldn't send that reply.", "err");
        }
        return;
      }
      if (act === "chat") {
        const m = state.matches.find((x) => String(x.user.id) === String(id));
        state.chatWith = m ? m.user : { id: Number(id), name: "Chat" };
        const data = await api("/api/chats/" + id);
        state.chat = data.messages;
        state.chatShared = data.sharedEvents || (m && m.sharedEvents) || [];
        state.chatMeetPlan = data.meetPlan || (m && m.meetPlan) || null;
        state.chatMatchId = data.matchId || (m && m.matchId) || null;
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
    "set-genre", "set-event-filter", "set-gender-filter", "event-cat", "post-event", "like-chip", "pick-prompt", "dismiss-ios-tip", "dismiss-photo-nudge",
    "edit-profile", "event", "paywall", "remove-post-photo", "report", "report-post", "want-like", "delete-account", "share-loc", "onboard-back", "post-like-tap", "filters",
    "settings", "profile-tab", "post-view", "edit-set-gender", "edit-set-pronouns", "edit-set-sex", "edit-set-trades",
    "edit-toggle-vibe", "edit-toggle-look", "edit-toggle-interested", "edit-toggle-hobby", "edit-add-hobby",
    "clear-composer-media", "remove-composer-photo", "same-show", "pick-same-event", "meet-event",
    "preview-profile", "edit-back",
    "open-story-composer", "story-close", "story-next", "story-prev", "story-composer-close", "story-event", "story-hide-viewers"]);
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
  // Story viewer: tap left/right, hold to pause, swipe down to close. Real buttons stay tappable in WKWebView.
  (function bindStoryNav() {
    let startX = 0, startY = 0, startT = 0, held = false, tracking = false, pointerId = null;
    let holdTimer = null;
    const clearHold = () => { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } };
    const viewerOf = (e) => e.target && e.target.closest && e.target.closest("[data-story-nav]");
    const onChrome = (t) => t.closest && t.closest(".story-chrome, .story-foot, .story-viewers, .story-event, input, textarea, button.btn, button.icon-btn, button.who");
    root.addEventListener("pointerdown", (e) => {
      const viewer = viewerOf(e);
      if (!viewer || !state.storyViewer) return;
      if (onChrome(e.target)) return;
      tracking = true;
      held = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startT = Date.now();
      clearHold();
      holdTimer = setTimeout(() => {
        held = true;
        setStoryPaused(true);
      }, 180);
    });
    root.addEventListener("pointermove", (e) => {
      if (!tracking || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 12) clearHold();
      if (dy > 70 && dy > Math.abs(dx) * 1.2) {
        tracking = false;
        clearHold();
        setStoryPaused(false);
        closeStoryViewer();
      }
    });
    const end = (e) => {
      if (!tracking || (e.pointerId != null && e.pointerId !== pointerId)) return;
      tracking = false;
      clearHold();
      if (held) { setStoryPaused(false); return; }
      const dx = (e.clientX || startX) - startX;
      const dy = (e.clientY || startY) - startY;
      if (Math.abs(dy) > 70 && dy > Math.abs(dx)) { closeStoryViewer(); return; }
      const viewer = document.querySelector("[data-story-nav]");
      if (!viewer) return;
      const rect = viewer.getBoundingClientRect();
      const x = e.clientX != null ? e.clientX : startX;
      if (x - rect.left < rect.width * 0.33) goStory(-1);
      else goStory(1);
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", (e) => {
      if (!tracking || e.pointerId !== pointerId) return;
      tracking = false;
      clearHold();
      setStoryPaused(false);
    });
  })();

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
    if (e.key === "Enter" && e.target.getAttribute("data-field") === "storyReply") {
      e.preventDefault();
      handle("story-reply", e.target);
    }
    if (e.key === "Enter" && (e.target.getAttribute("data-field") === "pass" || e.target.getAttribute("data-field") === "user")) {
      e.preventDefault();
      handle(state.overlay && state.overlay.type === "signup" ? "signup" : "login", e.target);
    }
  });
  function probeVideoDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.playsInline = true;
      v.onloadedmetadata = () => {
        const d = v.duration;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) ? d : 0);
      };
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that video.")); };
      v.src = url;
    });
  }
  async function onPickedFile(e) {
    const kind = e.target.getAttribute("data-act-file");
    if (kind === "story-media") {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const typ = String(file.type || "").toLowerCase();
      const name = String(file.name || "").toLowerCase();
      const isVideo = typ.startsWith("video/") || /\.(mov|mp4|m4v|webm|qt)$/.test(name);
      if (isVideo) {
        if (file.size > MAX_STORY_VIDEO_BYTES) {
          toast("That video is over 8 MB. Try a shorter clip (15 seconds or less).", "err");
          return;
        }
        try {
          const dur = await probeVideoDuration(file);
          if (dur > MAX_STORY_VIDEO_SECONDS + 0.25) {
            toast("Stories can be up to 15 seconds. Try a shorter clip.", "err");
            return;
          }
        } catch (err) {
          toast(err.message || "Couldn't read that video.", "err");
          return;
        }
        if (state.storyDraft && state.storyDraft.preview) {
          try { URL.revokeObjectURL(state.storyDraft.preview); } catch (_) {}
        }
        state.storyDraft = { file, preview: URL.createObjectURL(file), kind: "video" };
        state.overlay = { type: "storyComposer" };
        render();
        return;
      }
      let ready = file;
      try { ready = (await compressImage(file)) || file; } catch (_) { ready = file; }
      if (state.storyDraft && state.storyDraft.preview) {
        try { URL.revokeObjectURL(state.storyDraft.preview); } catch (_) {}
      }
      state.storyDraft = { file: ready, preview: URL.createObjectURL(ready), kind: "photo" };
      state.overlay = { type: "storyComposer" };
      render();
      return;
    }
    if (kind === "post-photo" || kind === "post-photos") {
      const files = Array.from((e.target.files || [])).filter(Boolean);
      e.target.value = "";
      if (!files.length) return;
      if (state.composerMedia && state.composerMedia.video) clearComposerMedia();
      const next = (state.composerMedia && state.composerMedia.photos) ? state.composerMedia : { photos: [], video: null, poster: null, previews: [] };
      const room = MAX_POST_PHOTOS - (next.photos || []).length;
      const accepted = files.slice(0, Math.max(0, room));
      for (const file of accepted) {
        next.photos.push(file);
        next.previews.push(URL.createObjectURL(file));
      }
      if (files.length > room) toast(`Up to ${MAX_POST_PHOTOS} photos per post — added the first ${Math.max(0, room)}.`, "warn");
      next.video = null;
      next.poster = null;
      next.videoUrl = "";
      state.composerMedia = next;
      render();
      return;
    }
    if (kind === "post-video") {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const meta = await readVideoMeta(file);
        clearComposerMedia();
        const preview = meta.preview || (meta.poster ? URL.createObjectURL(meta.poster) : URL.createObjectURL(file));
        state.composerMedia = {
          photos: [],
          video: file,
          poster: meta.poster || null,
          previews: [preview],
          videoUrl: URL.createObjectURL(file),
        };
        state.err = "";
      } catch (err) {
        state.err = err.message || "Couldn't use that video.";
        if (typeof toast === "function") toast(state.err, "err");
      }
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
