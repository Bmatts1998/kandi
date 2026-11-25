"use strict";

require("./load-env");

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { open } = require("./db");

const DEMO_PASSWORD = "plur-demo";

const EVENTS = [
  { id: "crssd", name: "CRSSD Festival", city: "San Diego", date_label: "Mar 6-7, 2027", venue: "Waterfront Park", genres: ["house", "techno"], emoji: "🌊", color: "linear-gradient(135deg,#0d6e8a,#2ef0ff)" },
  { id: "movement", name: "Movement", city: "Detroit", date_label: "May 23-25, 2027", venue: "Hart Plaza", genres: ["techno", "house"], emoji: "🖤", color: "linear-gradient(135deg,#1a1030,#b44aff)" },
  { id: "edc", name: "EDC Las Vegas", city: "Las Vegas", date_label: "May 14-16, 2027", venue: "Las Vegas Motor Speedway", genres: ["house", "trance", "bass", "dubstep"], emoji: "🎡", color: "linear-gradient(135deg,#3b0a5c,#ff3d9a)" },
  { id: "forest", name: "Electric Forest", city: "Rothbury, MI", date_label: "Jun 24-27, 2027", venue: "Double JJ Resort", genres: ["house", "bass", "trance"], emoji: "🌲", color: "linear-gradient(135deg,#0c3b28,#d4ff3f)" },
  { id: "basscanyon", name: "Bass Canyon", city: "George, WA", date_label: "Aug 20-22, 2027", venue: "The Gorge", genres: ["bass", "dubstep"], emoji: "⛰️", color: "linear-gradient(135deg,#2a1050,#7a5cff)" },
  { id: "lostlands", name: "Lost Lands", city: "Thornville, OH", date_label: "Sep 17-19, 2027", venue: "Legend Valley", genres: ["dubstep", "bass"], emoji: "🦖", color: "linear-gradient(135deg,#3a2a10,#ffd56a)" },
  { id: "warehouse", name: "Neon Warehouse", city: "Your city", date_label: "Sat 10pm-4am", venue: "Secret warehouse", genres: ["techno", "house"], emoji: "🏭", color: "linear-gradient(135deg,#140816,#ff3d9a)" },
];

const USERS = [
  { username: "nova", name: "Nova", age: 26, emoji: "🌙", gradients: ["linear-gradient(160deg,#1b1040,#6b2bd6 55%,#ff7ad9)", "linear-gradient(160deg,#0b1a3a,#2ef0ff)"], photoCaps: ["Rail, Movement weekend", "Sunrise somewhere in Detroit"], vibes: ["techno", "house"], looking: ["dance", "date"], events: ["movement", "crssd"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "A 3-hour dark techno rabbit hole with no photos, only strobes." },
    { id: "moment", q: "Best festival moment...", a: "Sunrise at the warehouse after we all thought the night was over." },
    { id: "findme", q: "You'll find me...", a: "Left rail, eyes closed, probably crying at a breakdown." },
  ]},
  { username: "hex", name: "Hex", age: 24, emoji: "⚡", gradients: ["linear-gradient(160deg,#2a0830,#ff3d9a 50%,#ffd56a)", "linear-gradient(160deg,#12061c,#7a5cff)"], photoCaps: ["Pit, Lost Lands", "Totem duty"], vibes: ["dubstep", "bass"], looking: ["friends", "hookup"], events: ["lostlands", "basscanyon"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "If the lasers look like a spaceship landing, I'm already in the pit." },
    { id: "kandi", q: "The kandi I'm trading says...", a: "STAY BASSY" },
    { id: "talk", q: "Let's talk if you also...", a: "Have a totem and zero sense of direction at 2am." },
  ]},
  { username: "luna", name: "Luna", age: 28, emoji: "🦋", gradients: ["linear-gradient(160deg,#0c2830,#2ee0c0 50%,#e2b0ff)", "linear-gradient(160deg,#1a2040,#8ab4ff)"], photoCaps: ["Canopy, Electric Forest", "Favorite sequin jacket, obviously"], vibes: ["trance", "house"], looking: ["date", "friends"], events: ["forest", "edc"], prompts: [
    { id: "moment", q: "Best festival moment...", a: "Strangers becoming a family under the Electric Forest canopy." },
    { id: "late", q: "My 3am song is...", a: "Whatever's playing when the stars still look close enough to grab." },
    { id: "plur", q: "PLUR to me means...", a: "Handing someone water before they have to ask." },
  ]},
  { username: "riot", name: "Riot", age: 23, emoji: "🔥", gradients: ["linear-gradient(160deg,#3a0a10,#ff5a1f 55%,#ffd56a)", "linear-gradient(160deg,#1a0810,#ff3d9a)"], photoCaps: ["The Gorge, golden hour", "Duck totem, still standing"], vibes: ["bass", "dubstep"], looking: ["friends"], events: ["basscanyon"], prompts: [
    { id: "findme", q: "You'll find me...", a: "Under a giant rubber duck totem. Come honk." },
    { id: "moment", q: "Best festival moment...", a: "The set that melted my shoes and somehow improved my personality." },
  ]},
  { username: "vesper", name: "Vesper", age: 27, emoji: "🌸", gradients: ["linear-gradient(160deg,#3a1030,#ff6aa8 50%,#ffd1e8)", "linear-gradient(160deg,#22102a,#b44aff)"], photoCaps: ["CRSSD waterfront", "Kandi trade, still on my wrist"], vibes: ["house", "techno"], looking: ["dance", "date"], events: ["crssd", "movement"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "Sunset house, dusty boots, one last song that turns into five." },
    { id: "moment", q: "Best festival moment...", a: "Trading kandi with someone I'd just met and somehow already trusted." },
  ]},
  { username: "sol", name: "Sol", age: 25, emoji: "☀️", gradients: ["linear-gradient(160deg,#4a2a00,#ffd56a 50%,#fff3c0)", "linear-gradient(160deg,#3a1050,#ff3d9a)"], photoCaps: ["Kinetic Field, sequins", "EDC night two"], vibes: ["trance", "bass"], looking: ["friends", "date"], events: ["edc"], prompts: [
    { id: "findme", q: "You'll find me...", a: "On the rail at kinetic field, sequin jacket, cannot be missed." },
    { id: "talk", q: "Let's talk if you also...", a: "Plan your hydration like it's a professional sport." },
  ]},
  { username: "ember", name: "Ember", age: 29, emoji: "💫", gradients: ["linear-gradient(160deg,#140816,#6b1fff 45%,#ff3d9a)", "linear-gradient(160deg,#0a0a12,#445)"], photoCaps: ["Warehouse cement and strobes", "Afters, don't ask the time"], vibes: ["techno"], looking: ["hookup", "dance"], events: ["movement", "warehouse"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "Warehouse. Cement. A kick drum that rearranges your bones." },
    { id: "looking", q: "I'm looking for someone who...", a: "Can hold a stare and a rhythm at the same time." },
  ]},
  { username: "pixel", name: "Pixel", age: 22, emoji: "🎮", gradients: ["linear-gradient(160deg,#081820,#00d4aa 50%,#c8ff5a)", "linear-gradient(160deg,#1a1040,#7a5cff)"], photoCaps: ["Getting lost on purpose", "LED jacket test shot"], vibes: ["house", "bass"], looking: ["dance"], events: ["forest"], prompts: [
    { id: "kandi", q: "The kandi I'm trading says...", a: "BE KIND, REWIND (the drop)" },
    { id: "moment", q: "Best festival moment...", a: "Getting lost on purpose and finding the better stage." },
  ]},
  { username: "jade", name: "Jade", age: 26, emoji: "🌈", gradients: ["linear-gradient(160deg,#102018,#3dff9a 45%,#2ef0ff)", "linear-gradient(160deg,#2a1040,#ff7ad9)"], photoCaps: ["Wherever the wub meets the weird", "Crew photo, faces not included"], vibes: ["house", "techno", "trance", "bass"], looking: ["friends"], events: ["edc", "forest"], prompts: [
    { id: "plur", q: "PLUR to me means...", a: "We look out for each other. That's the whole thing." },
    { id: "findme", q: "You'll find me...", a: "Wherever the wub meets the weird." },
  ]},
  { username: "orion", name: "Orion", age: 31, emoji: "🪐", gradients: ["linear-gradient(160deg,#0a1028,#3a6bff 50%,#c9d6ff)", "linear-gradient(160deg,#1a1028,#b44aff)"], photoCaps: ["Closing hours", "Late-night walk home in our heads"], vibes: ["techno", "trance"], looking: ["date"], events: ["movement"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "Closing hours, hands up, no talking, just the ride home in our heads." },
    { id: "talk", q: "Let's talk if you also...", a: "Want breakfast after, not just a song recommendation." },
  ]},
];

async function seed(existingDb) {
  const owned = !existingDb;
  const db = existingDb || await open();
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const evIns = await db.prepare(`INSERT OR REPLACE INTO events (id,name,city,date_label,venue,genres,emoji,color,is_example) VALUES (?,?,?,?,?,?,?,?,1)`);
  for (const e of EVENTS) await evIns.run(e.id, e.name, e.city, e.date_label, e.venue, JSON.stringify(e.genres), e.emoji, e.color);

  const userIns = await db.prepare(`INSERT INTO users (username,password_hash,name,age,vibes,looking,prompts,photos,events,is_demo) VALUES (?,?,?,?,?,?,?,?,?,1)`);
  const find = await db.prepare(`SELECT id FROM users WHERE username=?`);
  const goingIns = await db.prepare(`INSERT OR IGNORE INTO event_going (user_id, event_id) VALUES (?,?)`);

  // Incoming likes toward later real signups are created after a real user exists.
  // Demo users like each other in a few cases so the feed feels alive once you sign up
  // and some already like other demo accounts.
  const likeIns = await db.prepare(`INSERT OR IGNORE INTO likes (from_id,to_id,target_type,target_id,comment) VALUES (?,?,?,?,?)`);

  const ids = {};
  for (const u of USERS) {
    const existing = await find.get(u.username);
    let id;
    if (existing) {
      id = existing.id;
      await db.prepare(`UPDATE users SET name=?, age=?, vibes=?, looking=?, prompts=?, photos=?, events=?, is_demo=1, password_hash=? WHERE id=?`)
        .run(u.name, u.age, JSON.stringify(u.vibes), JSON.stringify(u.looking), JSON.stringify(u.prompts),
          JSON.stringify(u.gradients.map((g, i) => ({ type: "gradient", gradient: g, emoji: u.emoji, caption: u.photoCaps[i] || "" }))),
          JSON.stringify(u.events), hash, id);
    } else {
      const info = await userIns.run(
        u.username, hash, u.name, u.age,
        JSON.stringify(u.vibes), JSON.stringify(u.looking), JSON.stringify(u.prompts),
        JSON.stringify(u.gradients.map((g, i) => ({ type: "gradient", gradient: g, emoji: u.emoji, caption: u.photoCaps[i] || "" }))),
        JSON.stringify(u.events)
      );
      id = Number(info.lastInsertRowid);
    }
    ids[u.username] = id;
    for (const ev of u.events) await goingIns.run(id, ev);
  }

  // Some demo-to-demo likes so mutual matches can happen among seeds if needed
  const incoming = [
    ["nova", "vesper", "prompt", "moment", "This is the whole reason I still go."],
    ["hex", "nova", "prompt", "goto", "This is exactly my night."],
    ["ember", "nova", "photo", "0", "Warehouse lighting is elite."],
    ["jade", "luna", "prompt", "plur", "Need more of this on the floor."],
    ["vesper", "pixel", "prompt", "kandi", "BE KIND, REWIND forever."],
  ];
  for (const [from, to, typ, tid, note] of incoming) {
    if (ids[from] && ids[to]) await likeIns.run(ids[from], ids[to], typ, tid, note);
  }

  await seedSocial(db, ids);

  if (owned) await db.close();
  const flag = path.join(__dirname, "..", "data", ".seeded");
  fs.writeFileSync(flag, new Date().toISOString());
  console.log("Seeded example events and 10 demo ravers.");
  console.log("Demo login password for all of them: " + DEMO_PASSWORD);
  console.log("Usernames: " + USERS.map((u) => u.username).join(", "));
}

async function readSeedImage(name) {
  const file = path.join(__dirname, "..", "seed-media", name + ".png");
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  return { mime: "image/png", data: buf.toString("base64") };
}

async function storeSeedPhoto(db, userId, name) {
  const img = await readSeedImage(name);
  if (!img) return null;
  const fileId = "seed-" + name + "-" + userId + ".png";
  const existing = await db.prepare(`SELECT id FROM photo_files WHERE id=?`).get(fileId);
  if (!existing) {
    await db.prepare(`INSERT INTO photo_files (id, user_id, mime, data) VALUES (?,?,?,?)`).run(fileId, userId, img.mime, img.data);
  }
  return fileId;
}

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

async function seedSocial(db, ids) {
  ids = ids || {};
  const find = await db.prepare(`SELECT id, username FROM users WHERE lower(username)=?`);
  for (const u of USERS) {
    if (!ids[u.username]) {
      const row = await find.get(u.username);
      if (row) ids[u.username] = row.id;
    }
  }
  const boston = await db.prepare(`SELECT id FROM users WHERE lower(username)='boston'`).get();
  if (boston) ids.boston = boston.id;

  const followIns = await db.prepare(`INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?,?,?)`);
  const followGraph = [
    ["nova", "vesper"], ["nova", "ember"], ["nova", "orion"], ["nova", "luna"],
    ["hex", "riot"], ["hex", "nova"], ["hex", "jade"],
    ["luna", "nova"], ["luna", "sol"], ["luna", "jade"], ["luna", "pixel"],
    ["riot", "hex"], ["riot", "jade"], ["riot", "sol"],
    ["vesper", "nova"], ["vesper", "luna"], ["vesper", "pixel"], ["vesper", "jade"],
    ["sol", "vesper"], ["sol", "jade"], ["sol", "luna"],
    ["ember", "nova"], ["ember", "orion"], ["ember", "vesper"],
    ["pixel", "luna"], ["pixel", "jade"], ["pixel", "hex"],
    ["jade", "luna"], ["jade", "nova"], ["jade", "vesper"], ["jade", "sol"], ["jade", "pixel"],
    ["orion", "nova"], ["orion", "ember"], ["orion", "luna"],
    // Boston auto-follows a few so Following is not empty
    ["boston", "nova"], ["boston", "vesper"], ["boston", "luna"], ["boston", "jade"], ["boston", "orion"],
  ];
  for (const [a, b] of followGraph) {
    if (ids[a] && ids[b] && ids[a] !== ids[b]) {
      await followIns.run(ids[a], ids[b], isoHoursAgo(20 + Math.abs(hashCode(a + b)) % 80));
    }
  }

  const existing = await db.prepare(`SELECT COUNT(*) AS c FROM posts`).get();
  if (existing && Number(existing.c) > 0) {
    console.log("Social seed: follows upserted; posts already present, leaving them.");
    return;
  }

  const posts = [
    { user: "nova", image: "movement-rail", event: "movement", hours: 4, caption: "Left rail, eyes closed, Movement already has me in my feelings." },
    { user: "nova", image: "warehouse-strobe", event: "warehouse", hours: 30, caption: "Warehouse afters. No photos of the DJ, only the strobes." },
    { user: "hex", image: "lost-lands-pit", event: "lostlands", hours: 8, caption: "Pit report: the lasers looked like a spaceship landing. I'm fine." },
    { user: "hex", image: "totem-night", event: "basscanyon", hours: 52, caption: "Totem duty. If you're lost, look for the lightning bolt." },
    { user: "luna", image: "forest-canopy", event: "forest", hours: 6, caption: "Strangers became a little family under the canopy tonight." },
    { user: "luna", image: "forest-path", event: "forest", hours: 40, caption: "Getting lost on purpose. The path always finds you." },
    { user: "luna", image: "kandi-trade", hours: 70, caption: "The kandi I traded today just says stay soft." },
    { user: "riot", image: "gorge-gold", event: "basscanyon", hours: 11, caption: "The Gorge at golden hour. The duck totem is still standing." },
    { user: "riot", image: "bass-canyon", event: "basscanyon", hours: 26, caption: "That set melted my shoes and somehow improved my personality." },
    { user: "vesper", image: "crssd-sunset", event: "crssd", hours: 3, caption: "Sunset house, dusty boots, one last song that turned into five." },
    { user: "vesper", image: "waterfront", event: "crssd", hours: 22, caption: "CRSSD waterfront. Traded kandi with someone I already trusted." },
    { user: "vesper", image: "kandi-trade", hours: 58, caption: "Still on my wrist. That's the whole post." },
    { user: "sol", image: "edc-kinetic", event: "edc", hours: 9, caption: "Kinetic Field, sequin jacket, cannot be missed. Hydrate like it's a sport." },
    { user: "sol", image: "sequin-rail", event: "edc", hours: 33, caption: "EDC night two. Rail reserved by vibes only." },
    { user: "ember", image: "warehouse-strobe", event: "warehouse", hours: 7, caption: "Cement. A kick drum that rearranges your bones. Don't ask the time." },
    { user: "ember", image: "afters", event: "movement", hours: 44, caption: "Afters in Detroit. Hold a stare and a rhythm at the same time." },
    { user: "pixel", image: "forest-path", event: "forest", hours: 13, caption: "LED jacket test shot. BE KIND, REWIND (the drop)." },
    { user: "pixel", image: "forest-canopy", event: "forest", hours: 61, caption: "Found the better stage by getting lost on purpose." },
    { user: "jade", image: "edc-kinetic", event: "edc", hours: 5, caption: "Wherever the wub meets the weird. We look out for each other." },
    { user: "jade", image: "kandi-trade", event: "forest", hours: 28, caption: "Crew photo, faces not included. PLUR is the whole thing." },
    { user: "jade", image: "waterfront", hours: 49, caption: "Day party glows different when the crew shows up early." },
    { user: "orion", image: "closing-hours", event: "movement", hours: 15, caption: "Closing hours, hands up, no talking. Just the ride home in our heads." },
    { user: "orion", image: "movement-rail", event: "movement", hours: 38, caption: "Late-night walk between stages. Breakfast after, not just a song rec." },
  ];

  const postIds = [];
  for (const p of posts) {
    const uid = ids[p.user];
    if (!uid) continue;
    const photoId = p.image ? await storeSeedPhoto(db, uid, p.image) : null;
    const info = await db.prepare(
      `INSERT INTO posts (user_id, caption, photo_id, event_id, created_at) VALUES (?,?,?,?,?)`
    ).run(uid, p.caption, photoId, p.event || null, isoHoursAgo(p.hours));
    postIds.push({ id: Number(info.lastInsertRowid), user: p.user });
  }

  const likeIns = await db.prepare(`INSERT OR IGNORE INTO post_likes (user_id, post_id, created_at) VALUES (?,?,?)`);
  const commentIns = await db.prepare(`INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)`);
  const likers = ["nova", "hex", "luna", "riot", "vesper", "sol", "ember", "pixel", "jade", "orion"];
  const commentsPool = [
    ["nova", "This is exactly my night."],
    ["hex", "The pit is calling."],
    ["luna", "Need more of this on the floor."],
    ["riot", "Honk if you see the duck."],
    ["vesper", "Saving this for the afters playlist."],
    ["sol", "Hydration check, then I'll be there."],
    ["ember", "Warehouse lighting is elite."],
    ["pixel", "BE KIND, REWIND forever."],
    ["jade", "PLUR. That's the post."],
    ["orion", "See you at close."],
  ];

  for (let i = 0; i < postIds.length; i++) {
    const post = postIds[i];
    // more likes on earlier (newer / popular) posts, varied
    const nLikes = 3 + ((i * 3) % 7);
    for (let k = 0; k < nLikes; k++) {
      const who = likers[(i + k * 3) % likers.length];
      if (ids[who] && who !== post.user) {
        await likeIns.run(ids[who], post.id, isoHoursAgo(1 + (i + k) % 20));
      }
    }
    const nComments = 1 + (i % 3);
    for (let k = 0; k < nComments; k++) {
      const [who, text] = commentsPool[(i + k * 2) % commentsPool.length];
      if (ids[who] && who !== post.user) {
        await commentIns.run(post.id, ids[who], text, isoHoursAgo(1 + (i + k) % 18));
      }
    }
  }
  console.log("Social seed: " + postIds.length + " posts, follows, likes, and comments.");
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seed, seedSocial, DEMO_PASSWORD, EVENTS, USERS };
