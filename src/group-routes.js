"use strict";

const crypto = require("crypto");
const { normalizePhoto } = require("./photo");
const { contentRejected } = require("./content-filter");

const MAX_NAME = 40;
const MAX_BIO = 280;
const MAX_SCENE = 80;
const MAX_OWNED = 25;
const MAX_MEMBERS = 100;
const MAX_MESSAGE = 1000;
const CREW_EMOJIS = new Set("🧡🌙⚡🦋🔥🌸🌈🪐💫🎮🎧🪩🖤💜✨🎶🎤🎪".split(/[\uFE0F\u200D]/).filter(Boolean).concat(["🧡", "🌙", "⚡", "🦋", "🔥", "🌸", "🌈", "🪐", "💫", "🎮", "🎧", "🪩", "🖤", "💜", "✨", "🎶", "🎤", "🎪"]));

function firstAvatar(photosJson) {
  try {
    const photos = typeof photosJson === "string" ? JSON.parse(photosJson) : photosJson || [];
    const ph = photos[0];
    if (!ph) return null;
    if (ph.type === "file" && ph.url) return { type: "file", url: ph.url };
    return { type: "gradient", gradient: ph.gradient || "", emoji: ph.emoji || "●" };
  } catch (_) {
    return null;
  }
}

function slimMember(row, extra) {
  return {
    id: Number(row.user_id != null ? row.user_id : row.id),
    username: row.username,
    name: row.member_name || row.name,
    age: row.age == null || row.age === "" ? null : Number(row.age),
    avatar: firstAvatar(row.photos || row.user_photos),
    role: row.role || "member",
    ...(extra || {}),
  };
}

function publicCrew(row, extra) {
  return {
    id: Number(row.id),
    name: row.name,
    emoji: row.emoji || "🧡",
    photoUrl: row.photo_id ? "/uploads/" + row.photo_id : null,
    bio: row.bio || "",
    homeScene: row.home_scene || "",
    joinMode: row.join_mode === "public" ? "public" : "request",
    memberCount: Number(row.member_count != null ? row.member_count : 0) || 0,
    isDemo: Boolean(Number(row.is_demo)),
    createdAt: row.created_at,
    ...(extra || {}),
  };
}

function cleanName(raw) {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (name.length < 2) return { error: "Give your crew a name (at least 2 characters)." };
  if (name.length > MAX_NAME) return { error: "Crew names can be up to " + MAX_NAME + " characters." };
  return { name };
}

function cleanEmoji(raw) {
  const emoji = String(raw || "🧡").trim().slice(0, 8) || "🧡";
  return emoji;
}

function cleanJoinMode(raw) {
  return String(raw || "request") === "public" ? "public" : "request";
}

function installGroups({ app, getDb, auth, upload, publicUser, blockedSet, broadcastToUser }) {
  function db() {
    return getDb();
  }

  async function memberRow(crewId, userId) {
    return db().prepare(`SELECT * FROM crew_members WHERE crew_id=? AND user_id=?`).get(crewId, userId);
  }

  function isAdmin(mem) {
    return Boolean(mem && (mem.role === "owner" || mem.role === "admin"));
  }

  async function memberCount(crewId) {
    const row = await db().prepare(`SELECT COUNT(*) AS c FROM crew_members WHERE crew_id=?`).get(crewId);
    return Number(row && row.c) || 0;
  }

  async function getCrew(id) {
    const row = await db().prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM crew_members m WHERE m.crew_id=c.id) AS member_count
      FROM crews c WHERE c.id=?
    `).get(id);
    return row || null;
  }

  async function requestRow(crewId, userId) {
    return db().prepare(`SELECT * FROM crew_requests WHERE crew_id=? AND user_id=?`).get(crewId, userId);
  }

  async function addMember(crewId, userId, role) {
    await db().prepare(`INSERT OR IGNORE INTO crew_members (crew_id, user_id, role, created_at) VALUES (?,?,?,datetime('now'))`)
      .run(crewId, userId, role || "member");
    await db().prepare(`DELETE FROM crew_requests WHERE crew_id=? AND user_id=?`).run(crewId, userId);
  }

  async function visibleMembers(crewId, viewerId, blocked) {
    const rows = await db().prepare(`
      SELECT m.role, m.user_id, m.created_at AS joined_at, u.username, u.name, u.age, u.photos
      FROM crew_members m JOIN users u ON u.id=m.user_id
      WHERE m.crew_id=?
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at ASC
    `).all(crewId);
    return rows
      .filter((r) => Number(r.user_id) === Number(viewerId) || !blocked.has(Number(r.user_id)))
      .map((r) => slimMember(r, { isMe: Number(r.user_id) === Number(viewerId) }));
  }

  async function upcomingShows(crewId, blocked) {
    try {
      const now = new Date().toISOString();
      const rows = await db().prepare(`
        SELECT e.id, e.name, e.emoji, e.city, e.venue, e.date_label, e.starts_at, e.address, e.color,
               g.user_id, u.username, u.name AS member_name, u.photos
        FROM event_going g
        JOIN events e ON e.id=g.event_id
        JOIN crew_members m ON m.user_id=g.user_id AND m.crew_id=?
        JOIN users u ON u.id=g.user_id
        WHERE (e.status IS NULL OR e.status!='removed')
          AND (e.is_example IS NULL OR e.is_example=0)
          AND (e.starts_at IS NULL OR e.starts_at='' OR e.starts_at >= ?)
      `).all(crewId, now);
      const byEvent = new Map();
      for (const r of rows) {
        if (blocked.has(Number(r.user_id))) continue;
        if (!byEvent.has(r.id)) {
          byEvent.set(r.id, {
            id: r.id,
            name: r.name,
            emoji: r.emoji || "",
            city: r.city || "",
            venue: r.venue || "",
            date: r.date_label || "",
            startsAt: r.starts_at || "",
            address: r.address || "",
            color: r.color || "",
            going: [],
          });
        }
        byEvent.get(r.id).going.push(slimMember(r));
      }
      const list = Array.from(byEvent.values());
      list.sort((a, b) => String(a.startsAt || a.date).localeCompare(String(b.startsAt || b.date)));
      return list.slice(0, 8);
    } catch (_) {
      return null;
    }
  }

  async function membershipState(crewId, userId) {
    const mem = await memberRow(crewId, userId);
    if (mem) return { membership: "member", myRole: mem.role, request: null };
    const req = await requestRow(crewId, userId);
    if (req) {
      const membership = req.kind === "invite" ? "invited" : "requested";
      return { membership, myRole: null, request: req };
    }
    return { membership: null, myRole: null, request: null };
  }

  async function shapeGroup(crewId, viewerId) {
    const crew = await getCrew(crewId);
    if (!crew) return null;
    const blocked = await blockedSet(viewerId);
    const mine = await membershipState(crewId, viewerId);
    const members = await visibleMembers(crewId, viewerId, blocked);
    const upcoming = await upcomingShows(crewId, blocked);
    let pendingInvites = [];
    let pendingJoins = [];
    if (mine.myRole === "owner" || mine.myRole === "admin") {
      const pending = await db().prepare(`
        SELECT r.*, u.username, u.name, u.age, u.photos
        FROM crew_requests r JOIN users u ON u.id=r.user_id
        WHERE r.crew_id=?
        ORDER BY r.created_at ASC
      `).all(crewId);
      for (const r of pending) {
        if (blocked.has(Number(r.user_id))) continue;
        const item = {
          id: Number(r.id),
          kind: r.kind,
          createdAt: r.created_at,
          user: slimMember(r),
        };
        if (r.kind === "invite") pendingInvites.push(item);
        else pendingJoins.push(item);
      }
    }
    return {
      group: publicCrew(crew, { myRole: mine.myRole, membership: mine.membership }),
      members,
      memberCount: Number(crew.member_count) || members.length,
      myRole: mine.myRole,
      membership: mine.membership,
      pendingInvites,
      pendingJoins,
      upcoming,
    };
  }

  async function crewsForUser(userId, viewerId, blocked) {
    const rows = await db().prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM crew_members m2 WHERE m2.crew_id=c.id) AS member_count, m.role
      FROM crew_members m JOIN crews c ON c.id=m.crew_id
      WHERE m.user_id=?
      ORDER BY c.name COLLATE NOCASE
    `).all(userId);
    // COLLATE NOCASE is SQLite; Postgres may error. Fallback without it.
    let list = rows;
    if (!list) list = [];
    return list.map((r) => publicCrew(r, {
      myRole: Number(userId) === Number(viewerId) ? r.role : undefined,
    }));
  }

  async function safeCrewsForUser(userId, viewerId, blocked) {
    let rows;
    try {
      rows = await db().prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM crew_members m2 WHERE m2.crew_id=c.id) AS member_count, m.role
        FROM crew_members m JOIN crews c ON c.id=m.crew_id
        WHERE m.user_id=?
        ORDER BY lower(c.name)
      `).all(userId);
    } catch (_) {
      rows = await db().prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM crew_members m2 WHERE m2.crew_id=c.id) AS member_count, m.role
        FROM crew_members m JOIN crews c ON c.id=m.crew_id
        WHERE m.user_id=?
      `).all(userId);
    }
    return (rows || []).map((r) => publicCrew(r, {
      myRole: Number(userId) === Number(viewerId) ? r.role : undefined,
    }));
  }

  app.get("/api/groups", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const mine = await safeCrewsForUser(req.user.id, req.user.id, blocked);
    const mineIds = new Set(mine.map((c) => c.id));
    let discover = [];
    try {
      const rows = await db().prepare(`
        SELECT c.*, (SELECT COUNT(*) FROM crew_members m2 WHERE m2.crew_id=c.id) AS member_count
        FROM crews c
        ORDER BY lower(c.name)
      `).all();
      discover = (rows || [])
        .filter((r) => !mineIds.has(Number(r.id)))
        .map((r) => publicCrew(r))
        .slice(0, 60);
    } catch (_) {
      discover = [];
    }
    res.json({ mine, discover });
  });

  app.get("/api/groups/inbox", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const invites = (await db().prepare(`
      SELECT r.id, r.kind, r.created_at, r.invited_by, c.id AS crew_id, c.name, c.emoji, c.photo_id, c.bio, c.home_scene, c.join_mode, c.is_demo,
             (SELECT COUNT(*) FROM crew_members m2 WHERE m2.crew_id=c.id) AS member_count,
             u.name AS inviter_name, u.username AS inviter_username
      FROM crew_requests r
      JOIN crews c ON c.id=r.crew_id
      LEFT JOIN users u ON u.id=r.invited_by
      WHERE r.user_id=? AND r.kind='invite'
      ORDER BY r.created_at DESC
    `).all(req.user.id))
      .filter((r) => !r.invited_by || !blocked.has(Number(r.invited_by)))
      .map((r) => ({
        id: Number(r.id),
        kind: "invite",
        createdAt: r.created_at,
        invitedBy: r.inviter_name ? { name: r.inviter_name, username: r.inviter_username } : null,
        group: publicCrew(r, { id: Number(r.crew_id) }),
      }));

    const adminCrews = await db().prepare(`
      SELECT crew_id FROM crew_members WHERE user_id=? AND (role='owner' OR role='admin')
    `).all(req.user.id);
    const requests = [];
    for (const ac of adminCrews) {
      const rows = await db().prepare(`
        SELECT r.*, u.username, u.name, u.age, u.photos, c.name AS crew_name, c.emoji AS crew_emoji, c.photo_id, c.bio, c.home_scene, c.join_mode, c.is_demo,
               (SELECT COUNT(*) FROM crew_members m2 WHERE m2.crew_id=c.id) AS member_count
        FROM crew_requests r
        JOIN users u ON u.id=r.user_id
        JOIN crews c ON c.id=r.crew_id
        WHERE r.crew_id=? AND r.kind='join'
        ORDER BY r.created_at ASC
      `).all(ac.crew_id);
      for (const r of rows) {
        if (blocked.has(Number(r.user_id))) continue;
        requests.push({
          id: Number(r.id),
          kind: "join",
          createdAt: r.created_at,
          user: slimMember(r),
          group: publicCrew({
            id: r.crew_id,
            name: r.crew_name,
            emoji: r.crew_emoji,
            photo_id: r.photo_id,
            bio: r.bio,
            home_scene: r.home_scene,
            join_mode: r.join_mode,
            is_demo: r.is_demo,
            member_count: r.member_count,
            created_at: r.created_at,
          }),
        });
      }
    }
    res.json({ invites, requests });
  });

  app.get("/api/groups/for-users", auth, async (req, res) => {
    const blocked = await blockedSet(req.user.id);
    const ids = String(req.query.ids || "")
      .split(",")
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0 && !blocked.has(n))
      .slice(0, 40);
    const byUser = {};
    for (const id of ids) {
      byUser[String(id)] = (await safeCrewsForUser(id, req.user.id, blocked)).slice(0, 4);
    }
    // also include the viewer, used on the You tab
    if (!byUser[String(req.user.id)]) {
      byUser[String(req.user.id)] = (await safeCrewsForUser(req.user.id, req.user.id, blocked)).slice(0, 8);
    }
    res.json({ byUser });
  });

  app.get("/api/users/:id/crews", auth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid user." });
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(id) && id !== Number(req.user.id)) return res.status(404).json({ error: "User not found." });
    const user = await db().prepare(`SELECT id FROM users WHERE id=?`).get(id);
    if (!user) return res.status(404).json({ error: "User not found." });
    res.json({ crews: await safeCrewsForUser(id, req.user.id, blocked) });
  });

  app.post("/api/groups", auth, async (req, res) => {
    const cleaned = cleanName(req.body && req.body.name);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const owned = await db().prepare(`SELECT COUNT(*) AS c FROM crews WHERE created_by=?`).get(req.user.id);
    if ((Number(owned && owned.c) || 0) >= MAX_OWNED) {
      return res.status(400).json({ error: "You can start up to " + MAX_OWNED + " crews." });
    }
    const emoji = cleanEmoji(req.body && req.body.emoji);
    const bio = String((req.body && req.body.bio) || "").trim().slice(0, MAX_BIO);
    const bioBad = contentRejected(bio);
    if (bioBad) return res.status(400).json({ error: bioBad });
    const homeScene = String((req.body && req.body.homeScene) || "").trim().slice(0, MAX_SCENE);
    const joinMode = cleanJoinMode(req.body && req.body.joinMode);
    const info = await db().prepare(
      `INSERT INTO crews (name, emoji, bio, home_scene, join_mode, created_by, is_demo, created_at) VALUES (?,?,?,?,?,?,0,datetime('now'))`
    ).run(cleaned.name, emoji, bio, homeScene, joinMode, req.user.id);
    const crewId = Number(info.lastInsertRowid);
    await addMember(crewId, req.user.id, "owner");
    const data = await shapeGroup(crewId, req.user.id);
    res.json(data);
  });

  app.get("/api/groups/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    const data = await shapeGroup(id, req.user.id);
    if (!data) return res.status(404).json({ error: "Crew not found." });
    res.json(data);
  });

  app.put("/api/groups/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    const mem = await memberRow(id, req.user.id);
    if (!isAdmin(mem)) return res.status(403).json({ error: "Only the owner or an admin can edit this crew." });
    const crew = await getCrew(id);
    if (!crew) return res.status(404).json({ error: "Crew not found." });
    let name = crew.name;
    if (req.body && req.body.name != null) {
      const cleaned = cleanName(req.body.name);
      if (cleaned.error) return res.status(400).json({ error: cleaned.error });
      name = cleaned.name;
    }
    const emoji = req.body && req.body.emoji != null ? cleanEmoji(req.body.emoji) : crew.emoji;
    const bio = req.body && req.body.bio != null ? String(req.body.bio).trim().slice(0, MAX_BIO) : crew.bio;
    const editBioBad = contentRejected(bio);
    if (editBioBad) return res.status(400).json({ error: editBioBad });
    const homeScene = req.body && req.body.homeScene != null ? String(req.body.homeScene).trim().slice(0, MAX_SCENE) : crew.home_scene;
    const joinMode = req.body && req.body.joinMode != null ? cleanJoinMode(req.body.joinMode) : crew.join_mode;
    await db().prepare(`UPDATE crews SET name=?, emoji=?, bio=?, home_scene=?, join_mode=? WHERE id=?`)
      .run(name, emoji, bio, homeScene, joinMode, id);
    res.json(await shapeGroup(id, req.user.id));
  });

  app.post("/api/groups/:id/photo", auth, (req, res) => {
    upload.single("photo")(req, res, async (err) => {
      try {
        if (err) {
          const msg = err.code === "LIMIT_FILE_SIZE"
            ? "That file is over 30 MB. Try another photo."
            : (err.message || "Upload failed");
          return res.status(400).json({ error: msg });
        }
        const id = Number(req.params.id);
        const mem = await memberRow(id, req.user.id);
        if (!isAdmin(mem)) return res.status(403).json({ error: "Only the owner or an admin can change the crew photo." });
        const crew = await getCrew(id);
        if (!crew) return res.status(404).json({ error: "Crew not found." });
        if (!req.file) return res.status(400).json({ error: "Choose a photo to upload." });
        let normalized;
        try {
          normalized = await normalizePhoto(req.file.buffer);
        } catch (normErr) {
          return res.status(normErr.status || 400).json({ error: normErr.message || "Couldn't process that photo." });
        }
        const fileId = `crew-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${normalized.ext}`;
        await db().prepare(`INSERT INTO photo_files (id, user_id, mime, data) VALUES (?,?,?,?)`)
          .run(fileId, req.user.id, normalized.mime, normalized.buffer.toString("base64"));
        await db().prepare(`UPDATE crews SET photo_id=? WHERE id=?`).run(fileId, id);
        res.json(await shapeGroup(id, req.user.id));
      } catch (e) {
        console.error("crew photo", e);
        if (!res.headersSent) res.status(500).json({ error: "Something went wrong on our side. Try again." });
      }
    });
  });

  app.delete("/api/groups/:id", auth, async (req, res) => {
    const id = Number(req.params.id);
    const mem = await memberRow(id, req.user.id);
    if (!mem || mem.role !== "owner") return res.status(403).json({ error: "Only the owner can delete this crew." });
    await db().prepare(`DELETE FROM crew_messages WHERE crew_id=?`).run(id);
    await db().prepare(`DELETE FROM crew_requests WHERE crew_id=?`).run(id);
    await db().prepare(`DELETE FROM crew_members WHERE crew_id=?`).run(id);
    await db().prepare(`DELETE FROM crews WHERE id=?`).run(id);
    res.json({ ok: true });
  });

  app.post("/api/groups/:id/join", auth, async (req, res) => {
    const id = Number(req.params.id);
    const crew = await getCrew(id);
    if (!crew) return res.status(404).json({ error: "Crew not found." });
    const existing = await memberRow(id, req.user.id);
    if (existing) return res.json(await shapeGroup(id, req.user.id));
    const pending = await requestRow(id, req.user.id);
    if (pending && pending.kind === "invite") {
      if ((await memberCount(id)) >= MAX_MEMBERS) return res.status(400).json({ error: "This crew is full." });
      await addMember(id, req.user.id, "member");
      return res.json(await shapeGroup(id, req.user.id));
    }
    if (crew.join_mode === "public") {
      if ((await memberCount(id)) >= MAX_MEMBERS) return res.status(400).json({ error: "This crew is full." });
      await addMember(id, req.user.id, "member");
      return res.json(await shapeGroup(id, req.user.id));
    }
    if (pending && pending.kind === "join") return res.json(await shapeGroup(id, req.user.id));
    await db().prepare(`DELETE FROM crew_requests WHERE crew_id=? AND user_id=?`).run(id, req.user.id);
    await db().prepare(
      `INSERT INTO crew_requests (crew_id, user_id, kind, invited_by, created_at) VALUES (?,?,?,?,datetime('now'))`
    ).run(id, req.user.id, "join", null);
    res.json(await shapeGroup(id, req.user.id));
  });

  app.post("/api/groups/:id/leave", auth, async (req, res) => {
    const id = Number(req.params.id);
    const mem = await memberRow(id, req.user.id);
    if (!mem) {
      await db().prepare(`DELETE FROM crew_requests WHERE crew_id=? AND user_id=?`).run(id, req.user.id);
      return res.json({ ok: true, left: true });
    }
    if (mem.role === "owner") {
      const others = await db().prepare(`
        SELECT user_id, role FROM crew_members WHERE crew_id=? AND user_id!=?
        ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC
      `).all(id, req.user.id);
      if (!others.length) {
        await db().prepare(`DELETE FROM crew_messages WHERE crew_id=?`).run(id);
        await db().prepare(`DELETE FROM crew_requests WHERE crew_id=?`).run(id);
        await db().prepare(`DELETE FROM crew_members WHERE crew_id=?`).run(id);
        await db().prepare(`DELETE FROM crews WHERE id=?`).run(id);
        return res.json({ ok: true, left: true, deleted: true });
      }
      const next = others[0];
      await db().prepare(`UPDATE crew_members SET role='owner' WHERE crew_id=? AND user_id=?`).run(id, next.user_id);
      await db().prepare(`UPDATE crews SET created_by=? WHERE id=?`).run(next.user_id, id);
    }
    await db().prepare(`DELETE FROM crew_members WHERE crew_id=? AND user_id=?`).run(id, req.user.id);
    res.json({ ok: true, left: true });
  });

  app.post("/api/groups/:id/invite", auth, async (req, res) => {
    const id = Number(req.params.id);
    const mem = await memberRow(id, req.user.id);
    if (!mem) return res.status(403).json({ error: "Join this crew before you tag friends." });
    const userId = Number(req.body && req.body.userId);
    if (!Number.isInteger(userId) || userId < 1 || userId === Number(req.user.id)) {
      return res.status(400).json({ error: "Pick someone to tag." });
    }
    const blocked = await blockedSet(req.user.id);
    if (blocked.has(userId)) return res.status(403).json({ error: "You can't tag this person." });
    const user = await db().prepare(`SELECT id, name FROM users WHERE id=?`).get(userId);
    if (!user) return res.status(404).json({ error: "Person not found." });
    if (await memberRow(id, userId)) return res.status(400).json({ error: "They're already in this crew." });
    if ((await memberCount(id)) >= MAX_MEMBERS) return res.status(400).json({ error: "This crew is full." });
    const pending = await requestRow(id, userId);
    if (pending && pending.kind === "join") {
      // They already asked to join — tagging them is an approval.
      if (!isAdmin(mem)) return res.status(403).json({ error: "They already asked to join. An admin can approve it." });
      await addMember(id, userId, "member");
      if (typeof broadcastToUser === "function") {
        broadcastToUser(userId, { type: "crew-invite", accepted: true, group: publicCrew(await getCrew(id)) });
      }
      return res.json(await shapeGroup(id, req.user.id));
    }
    await db().prepare(`DELETE FROM crew_requests WHERE crew_id=? AND user_id=?`).run(id, userId);
    await db().prepare(
      `INSERT INTO crew_requests (crew_id, user_id, kind, invited_by, created_at) VALUES (?,?,?,?,datetime('now'))`
    ).run(id, userId, "invite", req.user.id);
    if (typeof broadcastToUser === "function") {
      broadcastToUser(userId, {
        type: "crew-invite",
        group: publicCrew(await getCrew(id)),
        from: { id: Number(req.user.id), name: req.user.name, username: req.user.username },
      });
    }
    res.json(await shapeGroup(id, req.user.id));
  });

  app.get("/api/groups/:id/people", auth, async (req, res) => {
    const id = Number(req.params.id);
    const mem = await memberRow(id, req.user.id);
    if (!mem) return res.status(403).json({ error: "Join this crew before you tag friends." });
    const q = String(req.query.q || "").trim().toLowerCase();
    if (q.length < 1) return res.json({ people: [] });
    const blocked = await blockedSet(req.user.id);
    const rows = await db().prepare(`
      SELECT id, username, name, age, photos FROM users
      WHERE id!=?
        AND (lower(username) LIKE ? OR lower(name) LIKE ?)
      ORDER BY lower(name)
    `).all(req.user.id, "%" + q + "%", "%" + q + "%");
    const memberIds = new Set((await db().prepare(`SELECT user_id FROM crew_members WHERE crew_id=?`).all(id)).map((r) => Number(r.user_id)));
    const pending = await db().prepare(`SELECT user_id, kind FROM crew_requests WHERE crew_id=?`).all(id);
    const pendingBy = new Map(pending.map((r) => [Number(r.user_id), r.kind]));
    const people = rows
      .filter((u) => !blocked.has(Number(u.id)))
      .slice(0, 20)
      .map((u) => ({
        id: Number(u.id),
        username: u.username,
        name: u.name,
        age: u.age == null || u.age === "" ? null : Number(u.age),
        avatar: firstAvatar(u.photos),
        inCrew: memberIds.has(Number(u.id)),
        pending: pendingBy.get(Number(u.id)) || null,
      }));
    res.json({ people });
  });

  app.post("/api/groups/:id/requests/:rid/accept", auth, async (req, res) => {
    const crewId = Number(req.params.id);
    const rid = Number(req.params.rid);
    const reqRow = await db().prepare(`SELECT * FROM crew_requests WHERE id=? AND crew_id=?`).get(rid, crewId);
    if (!reqRow) return res.status(404).json({ error: "That request isn't there anymore." });
    if (reqRow.kind === "invite") {
      if (Number(reqRow.user_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: "Only the tagged person can accept this." });
      }
    } else {
      const mem = await memberRow(crewId, req.user.id);
      if (!isAdmin(mem)) return res.status(403).json({ error: "Only an owner or admin can approve join requests." });
    }
    if ((await memberCount(crewId)) >= MAX_MEMBERS) return res.status(400).json({ error: "This crew is full." });
    await addMember(crewId, reqRow.user_id, "member");
    if (reqRow.kind === "join" && typeof broadcastToUser === "function") {
      broadcastToUser(reqRow.user_id, { type: "crew-invite", accepted: true, group: publicCrew(await getCrew(crewId)) });
    }
    if (Number(reqRow.user_id) === Number(req.user.id)) res.json(await shapeGroup(crewId, req.user.id));
    else res.json(await shapeGroup(crewId, req.user.id));
  });

  app.post("/api/groups/:id/requests/:rid/deny", auth, async (req, res) => {
    const crewId = Number(req.params.id);
    const rid = Number(req.params.rid);
    const reqRow = await db().prepare(`SELECT * FROM crew_requests WHERE id=? AND crew_id=?`).get(rid, crewId);
    if (!reqRow) return res.status(404).json({ error: "That request isn't there anymore." });
    if (reqRow.kind === "invite") {
      if (Number(reqRow.user_id) !== Number(req.user.id)) {
        return res.status(403).json({ error: "Only the tagged person can decline this." });
      }
    } else {
      const mem = await memberRow(crewId, req.user.id);
      if (!isAdmin(mem)) return res.status(403).json({ error: "Only an owner or admin can deny join requests." });
    }
    await db().prepare(`DELETE FROM crew_requests WHERE id=?`).run(rid);
    res.json({ ok: true });
  });

  app.post("/api/groups/:id/members/:userId/remove", auth, async (req, res) => {
    const crewId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const mem = await memberRow(crewId, req.user.id);
    if (!isAdmin(mem)) return res.status(403).json({ error: "Only an owner or admin can remove people." });
    if (userId === Number(req.user.id)) return res.status(400).json({ error: "Use Leave to step out of the crew." });
    const target = await memberRow(crewId, userId);
    if (!target) return res.status(404).json({ error: "They aren't in this crew." });
    if (target.role === "owner") return res.status(403).json({ error: "You can't remove the owner." });
    if (target.role === "admin" && mem.role !== "owner") return res.status(403).json({ error: "Only the owner can remove an admin." });
    await db().prepare(`DELETE FROM crew_members WHERE crew_id=? AND user_id=?`).run(crewId, userId);
    res.json(await shapeGroup(crewId, req.user.id));
  });

  app.post("/api/groups/:id/members/:userId/role", auth, async (req, res) => {
    const crewId = Number(req.params.id);
    const userId = Number(req.params.userId);
    const mem = await memberRow(crewId, req.user.id);
    if (!mem || mem.role !== "owner") return res.status(403).json({ error: "Only the owner can change roles." });
    const role = String((req.body && req.body.role) || "") === "admin" ? "admin" : "member";
    const target = await memberRow(crewId, userId);
    if (!target) return res.status(404).json({ error: "They aren't in this crew." });
    if (target.role === "owner") return res.status(400).json({ error: "The owner role stays with you unless you leave." });
    await db().prepare(`UPDATE crew_members SET role=? WHERE crew_id=? AND user_id=?`).run(role, crewId, userId);
    res.json(await shapeGroup(crewId, req.user.id));
  });

  app.get("/api/groups/:id/messages", auth, async (req, res) => {
    const id = Number(req.params.id);
    const mem = await memberRow(id, req.user.id);
    if (!mem) return res.status(403).json({ error: "Join this crew to see the chat." });
    const blocked = await blockedSet(req.user.id);
    const rows = await db().prepare(`
      SELECT m.id, m.from_id AS fromId, m.text, m.created_at AS at, u.name, u.username, u.photos
      FROM crew_messages m JOIN users u ON u.id=m.from_id
      WHERE m.crew_id=?
      ORDER BY m.id ASC
    `).all(id);
    const messages = (rows || [])
      .filter((m) => Number(m.fromId) === Number(req.user.id) || !blocked.has(Number(m.fromId)))
      .slice(-200)
      .map((m) => ({
        id: Number(m.id),
        fromId: Number(m.fromId),
        text: m.text,
        at: m.at,
        from: { id: Number(m.fromId), name: m.name, username: m.username, avatar: firstAvatar(m.photos) },
      }));
    res.json({ messages });
  });

  app.post("/api/groups/:id/messages", auth, async (req, res) => {
    const id = Number(req.params.id);
    const mem = await memberRow(id, req.user.id);
    if (!mem) return res.status(403).json({ error: "Join this crew to chat." });
    const text = String((req.body && req.body.text) || "").trim().slice(0, MAX_MESSAGE);
    if (!text) return res.status(400).json({ error: "Message is empty." });
    const crewMsgBad = contentRejected(text);
    if (crewMsgBad) return res.status(400).json({ error: crewMsgBad });
    const info = await db().prepare(`INSERT INTO crew_messages (crew_id, from_id, text, created_at) VALUES (?,?,?,datetime('now'))`)
      .run(id, req.user.id, text);
    const msg = await db().prepare(`SELECT id, from_id AS fromId, text, created_at AS at FROM crew_messages WHERE id=?`)
      .get(Number(info.lastInsertRowid));
    const payload = {
      type: "crew-message",
      crewId: id,
      message: { id: Number(msg.id), fromId: Number(msg.fromId), text: msg.text, at: msg.at },
      from: { id: Number(req.user.id), name: req.user.name, username: req.user.username, avatar: firstAvatar(req.user.photos) },
    };
    const members = await db().prepare(`SELECT user_id FROM crew_members WHERE crew_id=?`).all(id);
    const blocked = await blockedSet(req.user.id);
    if (typeof broadcastToUser === "function") {
      for (const m of members) {
        if (Number(m.user_id) === Number(req.user.id)) continue;
        if (blocked.has(Number(m.user_id))) continue;
        broadcastToUser(m.user_id, payload);
      }
    }
    res.json({ message: payload.message, from: payload.from });
  });
}

module.exports = { installGroups, CREW_EMOJIS };
