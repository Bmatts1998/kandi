"use strict";

const { eventKey, chipLabel } = require("./event-key");

function isAdult(u) {
  return Number(u && u.age) >= 18;
}

function truthy(v) {
  return v === true || v === 1 || v === "1" || Number(v) === 1;
}

function compactShow(e, extra) {
  if (!e) return null;
  return {
    id: e.id,
    eventKey: e.event_key || e.eventKey || eventKey(e),
    name: e.name,
    date: e.date_label || e.date || "",
    startsAt: e.starts_at || e.startsAt || "",
    venue: e.venue || "",
    city: e.city || "",
    emoji: e.emoji || "",
    category: e.category || "concert",
    chip: chipLabel({ name: e.name, startsAt: e.starts_at || e.startsAt }),
    ...(extra || {}),
  };
}

function goingMatchesEvent(row, ev) {
  const id = String(ev.id);
  const key = String(ev.event_key || ev.eventKey || "");
  return String(row.going_event_id) === id || (key && String(row.going_event_key || "") === key);
}

async function loadGoingRows(db) {
  return db.prepare(`
    SELECT g.event_id AS going_event_id, g.event_key AS going_event_key,
           g.open_to_meet, g.meet_note, u.*
    FROM event_going g
    JOIN users u ON u.id = g.user_id
  `).all();
}

function shapeGoers(rows, ev, viewer, blocked, publicUser) {
  const mine = Number(viewer && viewer.id);
  return rows
    .filter((u) => goingMatchesEvent(u, ev))
    .filter((u) => Number(u.id) === mine || (isAdult(u) && !blocked.has(Number(u.id))))
    .map((u) => publicUser(u, {
      openToMeet: truthy(u.open_to_meet),
      meetNote: truthy(u.open_to_meet) ? String(u.meet_note || "").slice(0, 80) : "",
    }));
}

async function resolveEvent(db, idOrKey) {
  const id = String(idOrKey || "");
  if (!id) return null;
  return (await db.prepare(`SELECT * FROM events WHERE id=?`).get(id))
    || (await db.prepare(`SELECT * FROM events WHERE event_key=?`).get(id));
}

async function setRsvp(db, user, ev, { going, openToMeet, meetNote }) {
  const key = ev.event_key || eventKey(ev);
  const existing = await db.prepare(`SELECT * FROM event_going WHERE user_id=? AND (event_id=? OR event_key=?)`).get(user.id, ev.id, key);
  if (going === false) {
    await db.prepare(`DELETE FROM event_going WHERE user_id=? AND (event_id=? OR event_key=?)`).run(user.id, ev.id, key);
    const live = await db.prepare(`SELECT event_id FROM live WHERE user_id=?`).get(user.id);
    if (live && (live.event_id === ev.id || live.event_id === key)) {
      await db.prepare(`DELETE FROM live WHERE user_id=?`).run(user.id);
    }
  } else {
    const open = openToMeet == null ? (existing ? truthy(existing.open_to_meet) : 0) : (openToMeet ? 1 : 0);
    const note = meetNote == null ? (existing ? existing.meet_note : "") : String(meetNote || "").slice(0, 80);
    if (existing) {
      await db.prepare(`UPDATE event_going SET event_id=?, event_key=?, open_to_meet=?, meet_note=? WHERE user_id=? AND (event_id=? OR event_key=?)`)
        .run(ev.id, key, open, open ? note : "", user.id, ev.id, key);
    } else {
      await db.prepare(`INSERT INTO event_going (user_id, event_id, event_key, open_to_meet, meet_note) VALUES (?,?,?,?,?)`)
        .run(user.id, ev.id, key, open, open ? note : "");
    }
  }
  const rows = await db.prepare(`SELECT event_id FROM event_going WHERE user_id=?`).all(user.id);
  const ids = rows.map((r) => r.event_id);
  await db.prepare(`UPDATE users SET events=? WHERE id=?`).run(JSON.stringify(ids), user.id);
  const row = await db.prepare(`SELECT * FROM event_going WHERE user_id=? AND (event_id=? OR event_key=?)`).get(user.id, ev.id, key);
  return {
    going: Boolean(row),
    openToMeet: Boolean(row && truthy(row.open_to_meet)),
    meetNote: row && truthy(row.open_to_meet) ? String(row.meet_note || "") : "",
  };
}

async function userGoingShows(db, userId) {
  const rows = await db.prepare(`
    SELECT e.*, g.open_to_meet, g.meet_note
    FROM event_going g
    JOIN events e ON e.id = g.event_id OR (COALESCE(g.event_key,'') != '' AND e.event_key = g.event_key)
    WHERE g.user_id=?
  `).all(userId);
  const now = Date.now();
  const seen = new Set();
  const out = [];
  for (const e of rows) {
    if (e.is_example) continue;
    if (String(e.status || "active") === "removed") continue;
    const starts = e.starts_at ? Date.parse(e.starts_at) : NaN;
    if (!Number.isNaN(starts) && starts < now) continue;
    const key = e.event_key || e.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => String(a.starts_at || "").localeCompare(String(b.starts_at || "")));
  return out;
}

async function listUpcomingForProfile(db, targetUser, viewer) {
  const show = targetUser.show_upcoming == null || Number(targetUser.show_upcoming) !== 0;
  const isMe = Number(targetUser.id) === Number(viewer.id);
  if (!show && !isMe) return { hidden: true, showUpcoming: false, shows: [] };
  const rows = await userGoingShows(db, targetUser.id);
  return {
    hidden: false,
    showUpcoming: show,
    shows: rows.map((e) => compactShow(e, {
      openToMeet: isMe ? truthy(e.open_to_meet) : undefined,
    })),
  };
}

async function sharedShows(db, userAId, userBId) {
  const [a, b] = await Promise.all([userGoingShows(db, userAId), userGoingShows(db, userBId)]);
  const bKeys = new Set(b.map((e) => e.event_key || e.id));
  const bIds = new Set(b.map((e) => e.id));
  return a.filter((e) => bKeys.has(e.event_key || e.id) || bIds.has(e.id)).map((e) => compactShow(e));
}


async function upcomingByUser(db) {
  const rows = await db.prepare(`
    SELECT g.user_id AS going_user_id, e.*
    FROM event_going g
    JOIN events e ON e.id = g.event_id OR (COALESCE(g.event_key,'') != '' AND e.event_key = g.event_key)
    WHERE COALESCE(e.is_example,0)=0 AND COALESCE(e.status,'active')='active'
  `).all();
  const now = Date.now();
  const map = new Map();
  for (const e of rows) {
    const starts = e.starts_at ? Date.parse(e.starts_at) : NaN;
    if (!Number.isNaN(starts) && starts < now) continue;
    const uid = Number(e.going_user_id);
    if (!map.has(uid)) map.set(uid, []);
    const list = map.get(uid);
    const key = e.event_key || e.id;
    if (list.some((x) => (x.event_key || x.id) === key)) continue;
    list.push(e);
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(a.starts_at || "").localeCompare(String(b.starts_at || "")));
  }
  return map;
}

async function backfillEventKeys(db) {
  const rows = await db.prepare(`SELECT id, name, venue, starts_at, event_key FROM events`).all();
  for (const r of rows) {
    const key = eventKey({ name: r.name, venue: r.venue, startsAt: r.starts_at });
    if (!key || key === "||") continue;
    if (r.event_key !== key) {
      await db.prepare(`UPDATE events SET event_key=? WHERE id=?`).run(key, r.id);
    }
    await db.prepare(`UPDATE event_going SET event_key=? WHERE event_id=? AND (event_key IS NULL OR event_key='' OR event_key!=?)`).run(key, r.id, key);
  }
}

const DEMO_MEET_PLAN = [
  { user: "nova", take: [0, 2], open: [0], note: "down to rail" },
  { user: "luna", take: [1, 3], open: [1], note: "looking for a crew" },
  { user: "vesper", take: [0, 1], open: [0], note: "date" },
  { user: "hex", take: [2, 4], open: [2], note: "down to rail" },
  { user: "riot", take: [2], open: [2], note: "looking for a crew" },
  { user: "sol", take: [1, 5], open: [1], note: "date" },
  { user: "ember", take: [0, 4], open: [4], note: "down to rail" },
  { user: "pixel", take: [3], open: [3], note: "looking for a crew" },
  { user: "jade", take: [1, 2, 3], open: [1], note: "looking for a crew" },
  { user: "orion", take: [0], open: [0], note: "date" },
];

async function seedDemoMeetups(db) {
  const events = (await db.prepare(`
    SELECT * FROM events
    WHERE COALESCE(is_example,0)=0
      AND COALESCE(status,'active')='active'
    ORDER BY starts_at ASC
  `).all()).filter((e) => {
    const t = Date.parse(e.starts_at || "");
    return Number.isNaN(t) || t >= Date.now();
  });
  if (!events.length) {
    console.log("Demo meetups: no upcoming real events to attach yet.");
    return { seeded: 0 };
  }
  let seeded = 0;
  for (const plan of DEMO_MEET_PLAN) {
    const user = await db.prepare(`SELECT * FROM users WHERE lower(username)=? AND is_demo=1`).get(plan.user);
    if (!user) continue;
    const picked = [];
    for (const idx of plan.take) {
      const ev = events[idx % events.length];
      if (!ev || picked.some((p) => p.id === ev.id)) continue;
      picked.push(ev);
      const open = plan.open.includes(idx);
      await setRsvp(db, user, ev, {
        going: true,
        openToMeet: open,
        meetNote: open ? plan.note : "",
      });
      seeded += 1;
    }
  }
  console.log("Demo meetups: attached demo accounts to " + events.length + " upcoming shows (" + seeded + " RSVPs).");
  return { seeded };
}

module.exports = {
  isAdult,
  truthy,
  compactShow,
  goingMatchesEvent,
  loadGoingRows,
  shapeGoers,
  resolveEvent,
  setRsvp,
  userGoingShows,
  listUpcomingForProfile,
  sharedShows,
  backfillEventKeys,
  upcomingByUser,
  seedDemoMeetups,
};
