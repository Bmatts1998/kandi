"use strict";

require("./load-env");

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { open } = require("./db");
const { seedDemoMeetups } = require("./meetup");
const { savePhotoFile } = require("./photo");

const DEMO_PASSWORD = "plur-demo";

const DETAILS = {
  nova: {
    gender: "female", pronouns: "she/her", interestedIn: ["men"],
    favoriteArtists: "Charlotte de Witte, AMELIE LENS",
    favoriteFestival: "Movement", favoriteVenue: "Hart Plaza",
    favoriteHangout: "Afters warehouse, no photos",
    kandiTrades: "sometimes", raveTotem: "A tiny moon on a stick", yearsRaving: "8",
    sex: "female", heightIn: 66, hobbies: ["dancing", "photography", "vinyl", "afters"],
  },
  hex: {
    gender: "male", pronouns: "he/him", interestedIn: ["everyone"],
    favoriteArtists: "Excision, Subtronics",
    favoriteFestival: "Lost Lands", favoriteVenue: "Legend Valley",
    favoriteHangout: "The pit, obviously",
    kandiTrades: "yes", raveTotem: "On totem duty — look for the lightning bolt", yearsRaving: "6",
    sex: "male", heightIn: 71, hobbies: ["DJing", "producing", "kandi making", "gaming"],
  },
  luna: {
    gender: "female", pronouns: "she/they", interestedIn: ["women", "nonbinary"],
    favoriteArtists: "Above & Beyond, Lane 8",
    favoriteFestival: "Electric Forest", favoriteVenue: "The Canopy",
    favoriteHangout: "Under the canopy at Forest",
    kandiTrades: "yes", raveTotem: "A butterfly with LEDs", yearsRaving: "10",
    sex: "female", heightIn: 65, hobbies: ["yoga", "kandi making", "hiking", "art"],
  },
  riot: {
    gender: "nonbinary", pronouns: "they/them", interestedIn: ["everyone"],
    favoriteArtists: "LSDream, GRiZ",
    favoriteFestival: "Bass Canyon", favoriteVenue: "The Gorge",
    favoriteHangout: "Golden hour at the rail",
    kandiTrades: "sometimes", raveTotem: "A duck. Still standing.", yearsRaving: "5",
    sex: "female", heightIn: 67, hobbies: ["skating", "totems", "camping", "fashion"],
    lookingExtra: ["crew"],
  },
  vesper: {
    gender: "female", pronouns: "she/her", interestedIn: ["men"],
    favoriteArtists: "Four Tet, Peggy Gou",
    favoriteFestival: "CRSSD Festival", favoriteVenue: "Waterfront Park",
    favoriteHangout: "The waterfront after the last set",
    kandiTrades: "yes", raveTotem: "", yearsRaving: "7",
    sex: "female", heightIn: 64, hobbies: ["kandi making", "thrifting", "photography", "dancing"],
  },
  sol: {
    gender: "male", pronouns: "he/him", interestedIn: ["women"],
    favoriteArtists: "Armin van Buuren, Rezz",
    favoriteFestival: "EDC Las Vegas", favoriteVenue: "Kinetic Field",
    favoriteHangout: "Under the big owl",
    kandiTrades: "yes", raveTotem: "A sun on a pole, can't miss it", yearsRaving: "6",
    sex: "male", heightIn: 70, hobbies: ["festivals", "fashion", "gym", "travel"],
  },
  ember: {
    gender: "female", pronouns: "she/her", interestedIn: ["men", "women"],
    favoriteArtists: "I Hate Models, Dax J",
    favoriteFestival: "Movement", favoriteVenue: "Whatever warehouse is running afters",
    favoriteHangout: "Cement floors and strobes",
    kandiTrades: "no", raveTotem: "", yearsRaving: "12",
    sex: "female", heightIn: 68, hobbies: ["afters", "vinyl", "producing", "tattooing"],
  },
  pixel: {
    gender: "nonbinary", pronouns: "they/them", interestedIn: ["everyone"],
    favoriteArtists: "Fred again.., ISOKNOCK",
    favoriteFestival: "Electric Forest", favoriteVenue: "Wherever I get lost",
    favoriteHangout: "The LED jacket meetup",
    kandiTrades: "sometimes", raveTotem: "A pixel heart", yearsRaving: "3",
    sex: "intersex", heightIn: 69, hobbies: ["gaming", "LED fashion", "art", "producing"],
    lookingExtra: ["crew"],
  },
  jade: {
    gender: "female", pronouns: "she/they", interestedIn: ["everyone"],
    favoriteArtists: "Skrillex, Dom Dolla",
    favoriteFestival: "EDC Las Vegas", favoriteVenue: "Circuit Grounds",
    favoriteHangout: "Crew camp, faces not included",
    kandiTrades: "yes", raveTotem: "A rainbow totem", yearsRaving: "9",
    sex: "female", heightIn: 63, hobbies: ["kandi making", "festivals", "dancing", "animals"],
    lookingExtra: ["crew"],
  },
  orion: {
    gender: "male", pronouns: "he/him", interestedIn: ["women"],
    favoriteArtists: "Tale Of Us, Stephan Bodzin",
    favoriteFestival: "Movement", favoriteVenue: "The afters, closing hours",
    favoriteHangout: "A late-night walk when the lights come up",
    kandiTrades: "sometimes", raveTotem: "", yearsRaving: "14",
    sex: "male", heightIn: 73, hobbies: ["vinyl", "late walks", "producing", "travel"],
  },
};


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
  { username: "nova", name: "Nova", age: 26, emoji: "🌙", gradients: ["linear-gradient(160deg,#1b1040,#6b2bd6 55%,#ff7ad9)", "linear-gradient(160deg,#0b1a3a,#2ef0ff)"], photoCaps: ["Rail, Movement weekend", "Sunrise somewhere in Detroit"], vibes: ["techno", "house", "tech-house"], looking: ["dance", "date"], events: ["movement", "crssd"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "A 3-hour dark techno rabbit hole with no photos, only strobes." },
    { id: "moment", q: "Best festival moment...", a: "Sunrise at the warehouse after we all thought the night was over." },
    { id: "findme", q: "You'll find me...", a: "Left rail, eyes closed, probably crying at a breakdown." },
  ]},
  { username: "hex", name: "Hex", age: 24, emoji: "⚡", gradients: ["linear-gradient(160deg,#2a0830,#ff3d9a 50%,#ffd56a)", "linear-gradient(160deg,#12061c,#7a5cff)"], photoCaps: ["Pit, Lost Lands", "Totem duty"], vibes: ["dubstep", "riddim", "bass-music"], looking: ["friends", "hookup"], events: ["lostlands", "basscanyon"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "If the lasers look like a spaceship landing, I'm already in the pit." },
    { id: "kandi", q: "The kandi I'm trading says...", a: "STAY BASSY" },
    { id: "talk", q: "Let's talk if you also...", a: "Have a totem and zero sense of direction at 2am." },
  ]},
  { username: "luna", name: "Luna", age: 28, emoji: "🦋", gradients: ["linear-gradient(160deg,#0c2830,#2ee0c0 50%,#e2b0ff)", "linear-gradient(160deg,#1a2040,#8ab4ff)"], photoCaps: ["Canopy, Electric Forest", "Favorite sequin jacket, obviously"], vibes: ["trance", "progressive-house", "deep-house"], looking: ["date", "friends"], events: ["forest", "edc"], prompts: [
    { id: "moment", q: "Best festival moment...", a: "Strangers becoming a family under the Electric Forest canopy." },
    { id: "late", q: "My 3am song is...", a: "Whatever's playing when the stars still look close enough to grab." },
    { id: "plur", q: "PLUR to me means...", a: "Handing someone water before they have to ask." },
  ]},
  { username: "riot", name: "Riot", age: 23, emoji: "🔥", gradients: ["linear-gradient(160deg,#3a0a10,#ff5a1f 55%,#ffd56a)", "linear-gradient(160deg,#1a0810,#ff3d9a)"], photoCaps: ["The Gorge, golden hour", "Duck totem, still standing"], vibes: ["bass-music", "future-bass", "melodic-bass"], looking: ["friends"], events: ["basscanyon"], prompts: [
    { id: "findme", q: "You'll find me...", a: "Under a giant rubber duck totem. Come honk." },
    { id: "moment", q: "Best festival moment...", a: "The set that melted my shoes and somehow improved my personality." },
  ]},
  { username: "vesper", name: "Vesper", age: 27, emoji: "🌸", gradients: ["linear-gradient(160deg,#3a1030,#ff6aa8 50%,#ffd1e8)", "linear-gradient(160deg,#22102a,#b44aff)"], photoCaps: ["CRSSD waterfront", "Kandi trade, still on my wrist"], vibes: ["house", "techno", "disco-funk"], looking: ["dance", "date"], events: ["crssd", "movement"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "Sunset house, dusty boots, one last song that turns into five." },
    { id: "moment", q: "Best festival moment...", a: "Trading kandi with someone I'd just met and somehow already trusted." },
  ]},
  { username: "sol", name: "Sol", age: 25, emoji: "☀️", gradients: ["linear-gradient(160deg,#4a2a00,#ffd56a 50%,#fff3c0)", "linear-gradient(160deg,#3a1050,#ff3d9a)"], photoCaps: ["Kinetic Field, sequins", "EDC night two"], vibes: ["trance", "big-room", "midtempo"], looking: ["friends", "date"], events: ["edc"], prompts: [
    { id: "findme", q: "You'll find me...", a: "On the rail at kinetic field, sequin jacket, cannot be missed." },
    { id: "talk", q: "Let's talk if you also...", a: "Plan your hydration like it's a professional sport." },
  ]},
  { username: "ember", name: "Ember", age: 29, emoji: "💫", gradients: ["linear-gradient(160deg,#140816,#6b1fff 45%,#ff3d9a)", "linear-gradient(160deg,#0a0a12,#445)"], photoCaps: ["Warehouse cement and strobes", "Afters, don't ask the time"], vibes: ["techno", "hardcore", "experimental"], looking: ["hookup", "dance"], events: ["movement", "warehouse"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "Warehouse. Cement. A kick drum that rearranges your bones." },
    { id: "looking", q: "I'm looking for someone who...", a: "Can hold a stare and a rhythm at the same time." },
  ]},
  { username: "pixel", name: "Pixel", age: 22, emoji: "🎮", gradients: ["linear-gradient(160deg,#081820,#00d4aa 50%,#c8ff5a)", "linear-gradient(160deg,#1a1040,#7a5cff)"], photoCaps: ["Getting lost on purpose", "LED jacket test shot"], vibes: ["house", "future-bass", "ukg"], looking: ["dance"], events: ["forest"], prompts: [
    { id: "kandi", q: "The kandi I'm trading says...", a: "BE KIND, REWIND (the drop)" },
    { id: "moment", q: "Best festival moment...", a: "Getting lost on purpose and finding the better stage." },
  ]},
  { username: "jade", name: "Jade", age: 26, emoji: "🌈", gradients: ["linear-gradient(160deg,#102018,#3dff9a 45%,#2ef0ff)", "linear-gradient(160deg,#2a1040,#ff7ad9)"], photoCaps: ["Wherever the wub meets the weird", "Crew photo, faces not included"], vibes: ["house", "techno", "bass-music", "color-bass"], looking: ["friends"], events: ["edc", "forest"], prompts: [
    { id: "plur", q: "PLUR to me means...", a: "We look out for each other. That's the whole thing." },
    { id: "findme", q: "You'll find me...", a: "Wherever the wub meets the weird." },
  ]},
  { username: "orion", name: "Orion", age: 31, emoji: "🪐", gradients: ["linear-gradient(160deg,#0a1028,#3a6bff 50%,#c9d6ff)", "linear-gradient(160deg,#1a1028,#b44aff)"], photoCaps: ["Closing hours", "Late-night walk home in our heads"], vibes: ["techno", "trance", "deep-house"], looking: ["date"], events: ["movement"], prompts: [
    { id: "goto", q: "My go-to set is...", a: "Closing hours, hands up, no talking, just the ride home in our heads." },
    { id: "talk", q: "Let's talk if you also...", a: "Want breakfast after, not just a song recommendation." },
  ]},
];

async function seed(existingDb) {
  const owned = !existingDb;
  const db = existingDb || await open();
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  // Real SLC events are loaded by scripts/import-events.js. Never re-insert the demo festivals.
  await db.prepare(`DELETE FROM events WHERE is_example=1`).run();

  const userIns = await db.prepare(`INSERT INTO users (username,password_hash,name,age,vibes,looking,prompts,photos,events,is_demo,gender,pronouns,interested_in,favorite_artists,favorite_festival,favorite_venue,favorite_hangout,kandi_trades,rave_totem,years_raving,sex,height_in,hobbies) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const find = await db.prepare(`SELECT id FROM users WHERE username=?`);
  // Incoming likes toward later real signups are created after a real user exists.
  // Demo users like each other in a few cases so the feed feels alive once you sign up
  // and some already like other demo accounts.
  const likeIns = await db.prepare(`INSERT OR IGNORE INTO likes (from_id,to_id,target_type,target_id,comment) VALUES (?,?,?,?,?)`);

  const ids = {};
  for (const u of USERS) {
    const d = DETAILS[u.username] || {};
    const looking = Array.from(new Set([...(u.looking || []), ...(d.lookingExtra || [])]));
    const photos = JSON.stringify(u.gradients.map((g, i) => ({ type: "gradient", gradient: g, emoji: u.emoji, caption: u.photoCaps[i] || "" })));
    const existing = await find.get(u.username);
    let id;
    if (existing) {
      id = existing.id;
      await db.prepare(`UPDATE users SET name=?, age=?, vibes=?, looking=?, prompts=?, photos=?, events=?, is_demo=1, password_hash=?, gender=?, pronouns=?, interested_in=?, favorite_artists=?, favorite_festival=?, favorite_venue=?, favorite_hangout=?, kandi_trades=?, rave_totem=?, years_raving=?, sex=?, height_in=?, hobbies=? WHERE id=?`)
        .run(u.name, u.age, JSON.stringify(u.vibes), JSON.stringify(looking), JSON.stringify(u.prompts),
          photos, JSON.stringify(u.events), hash, d.gender || "", d.pronouns || "",
          JSON.stringify(d.interestedIn || []), d.favoriteArtists || "", d.favoriteFestival || "",
          d.favoriteVenue || "", d.favoriteHangout || "", d.kandiTrades || "", d.raveTotem || "", d.yearsRaving || "", d.sex || "", d.heightIn != null ? d.heightIn : null, JSON.stringify(d.hobbies || []), id);
    } else {
      const info = await userIns.run(
        u.username, hash, u.name, u.age,
        JSON.stringify(u.vibes), JSON.stringify(looking), JSON.stringify(u.prompts),
        photos, JSON.stringify(u.events),
        d.gender || "", d.pronouns || "", JSON.stringify(d.interestedIn || []),
        d.favoriteArtists || "", d.favoriteFestival || "", d.favoriteVenue || "", d.favoriteHangout || "",
        d.kandiTrades || "", d.raveTotem || "", d.yearsRaving || "",
        d.sex || "", d.heightIn != null ? d.heightIn : null, JSON.stringify(d.hobbies || [])
      );
      id = Number(info.lastInsertRowid);
    }
    ids[u.username] = id;
  }

  // Attach demo accounts to upcoming real imported shows (not the retired sample festivals).
  await seedDemoMeetups(db);

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
  console.log("Seeded 10 demo ravers (events come from the importer).");
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
    await savePhotoFile(db, { id: fileId, userId, buffer: Buffer.from(img.data, "base64"), mime: img.mime, ext: ".png" });
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

  await seedCrews(db, ids);

  const existing = await db.prepare(`SELECT COUNT(*) AS c FROM posts`).get();
  if (existing && Number(existing.c) > 0) {
    console.log("Social seed: follows upserted; posts already present, leaving them.");
    await seedStories(db, ids);
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
  await seedCrews(db, ids);
  console.log("Social seed: " + postIds.length + " posts, follows, likes, and comments.");
  await seedStories(db, ids);
}


async function seedStories(db, ids) {
  ids = ids || {};
  const find = await db.prepare(`SELECT id, username FROM users WHERE lower(username)=?`);
  for (const username of ["nova", "luna"]) {
    if (!ids[username]) {
      const row = await find.get(username);
      if (row) ids[username] = row.id;
    }
  }
  if (!ids.nova && !ids.luna) return 0;

  async function pickEvent(preferred) {
    if (!preferred) return null;
    const ev = await db.prepare(`SELECT id FROM events WHERE id=?`).get(preferred);
    return ev ? preferred : null;
  }

  const specs = [
    { user: "nova", image: "movement-rail", hours: 2.2, text: "Left rail. No photos of the DJ — only strobes.", event: "movement" },
    { user: "nova", image: "warehouse-strobe", hours: 7.5, text: "Warehouse afters. Don't ask the time.", event: "warehouse" },
    { user: "luna", image: "forest-canopy", hours: 1.4, text: "Under the canopy tonight. Stay soft.", event: "forest" },
    { user: "luna", image: "kandi-trade", hours: 5.1, text: "The kandi I traded just says stay soft.", event: null },
  ];

  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let made = 0;
  for (const s of specs) {
    const uid = ids[s.user];
    if (!uid) continue;
    const photoId = await storeSeedPhoto(db, uid, s.image);
    if (!photoId) continue;
    const mediaId = "seed-story-" + s.user + "-" + s.image + ".png";
    const existingFile = await db.prepare(`SELECT id FROM photo_files WHERE id=?`).get(mediaId);
    if (!existingFile) {
      const src = await db.prepare(`SELECT mime, data FROM photo_files WHERE id=?`).get(photoId);
      if (!src) continue;
      await db.prepare(`INSERT INTO photo_files (id, user_id, mime, data) VALUES (?,?,?,?)`).run(mediaId, uid, src.mime, src.data);
    }
    const existing = await db.prepare(`SELECT id, created_at FROM stories WHERE media_id=?`).get(mediaId);
    if (existing && String(existing.created_at || "") >= cutoff) continue;
    if (existing) {
      await db.prepare(`DELETE FROM story_views WHERE story_id=?`).run(existing.id);
      await db.prepare(`DELETE FROM stories WHERE id=?`).run(existing.id);
    }
    const eventId = await pickEvent(s.event);
    await db.prepare(
      `INSERT INTO stories (user_id, media_id, kind, poster_id, text_overlay, event_id, created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(uid, mediaId, "photo", null, s.text, eventId, isoHoursAgo(s.hours));
    made += 1;
  }
  if (made) console.log("Story seed: refreshed " + made + " demo stories for nova and luna.");
  return made;
}


async function seedCrews(db, ids) {
  ids = ids || {};
  if (!ids.nova && !ids.hex) return;
  try {
    await db.prepare(`SELECT id FROM crews LIMIT 1`).get();
  } catch (_) {
    return; // tables not migrated yet
  }

  const specs = [
    {
      name: "Rail Fam",
      emoji: "🌙",
      bio: "House, techno, and whoever's holding the rail. We look out for each other on the floor and afters.",
      homeScene: "SLC house & techno",
      joinMode: "public",
      owner: "nova",
      members: [["nova", "owner"], ["luna", "admin"], ["vesper", "member"], ["jade", "member"]],
    },
    {
      name: "Bass Pit",
      emoji: "⚡",
      bio: "If the lasers look like a spaceship landing, we're already in the pit. Duck totems welcome.",
      homeScene: "Bass & dubstep festivals",
      joinMode: "request",
      owner: "hex",
      members: [["hex", "owner"], ["riot", "admin"], ["pixel", "member"]],
    },
  ];

  for (const spec of specs) {
    const ownerId = ids[spec.owner];
    if (!ownerId) continue;
    let row = await db.prepare(`SELECT id FROM crews WHERE is_demo=1 AND name=?`).get(spec.name);
    if (!row) {
      const info = await db.prepare(
        `INSERT INTO crews (name, emoji, bio, home_scene, join_mode, created_by, is_demo, created_at) VALUES (?,?,?,?,?,?,1,datetime('now'))`
      ).run(spec.name, spec.emoji, spec.bio, spec.homeScene, spec.joinMode, ownerId);
      row = { id: Number(info.lastInsertRowid) };
    } else {
      await db.prepare(`UPDATE crews SET emoji=?, bio=?, home_scene=?, join_mode=?, created_by=? WHERE id=?`)
        .run(spec.emoji, spec.bio, spec.homeScene, spec.joinMode, ownerId, row.id);
    }
    for (const [uname, role] of spec.members) {
      const uid = ids[uname];
      if (!uid) continue;
      await db.prepare(`INSERT OR IGNORE INTO crew_members (crew_id, user_id, role, created_at) VALUES (?,?,?,datetime('now'))`)
        .run(row.id, uid, role);
      await db.prepare(`UPDATE crew_members SET role=? WHERE crew_id=? AND user_id=?`).run(role, row.id, uid);
    }
  }

  // Mark a few crew members as going to upcoming real shows so the group page has something to show.
  try {
    const evs = await db.prepare(`
      SELECT id FROM events
      WHERE (status IS NULL OR status!='removed')
        AND (is_example IS NULL OR is_example=0)
        AND (starts_at IS NULL OR starts_at='' OR starts_at >= ?)
      ORDER BY starts_at
      LIMIT 6
    `).all(new Date().toISOString());
    const picks = [
      ["nova", 0], ["luna", 0], ["vesper", 1], ["jade", 0],
      ["hex", 2], ["riot", 2], ["pixel", 3],
    ];
    const goingIns = await db.prepare(`INSERT OR IGNORE INTO event_going (user_id, event_id) VALUES (?,?)`);
    for (const [uname, i] of picks) {
      if (ids[uname] && evs[i]) await goingIns.run(ids[uname], evs[i].id);
    }
  } catch (_) { /* event_going or events may be empty in a fresh local db */ }

  console.log("Seeded demo crews: Rail Fam and Bass Pit.");
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


async function ensureDemoGenres(db) {
  const { normalizeGenreIds } = require("./genres");
  let n = 0;
  for (const u of USERS) {
    const vibes = JSON.stringify(normalizeGenreIds(u.vibes));
    const info = await db.prepare(`UPDATE users SET vibes=? WHERE username=? AND is_demo=1`).run(vibes, u.username);
    if (info && Number(info.changes)) n += 1;
  }
  return n;
}


// Favorite songs for demo profiles (Apple iTunes Search results) so the song card shows up for reviewers.
const DEMO_SONGS = {
  "nova": {
    "trackId": 1678181925,
    "title": "Apollo",
    "artist": "Charlotte de Witte",
    "album": "Apollo - EP",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/60/b1/7c/60b17c70-52b7-953c-a5c9-b128232362a2/5060972806272.jpg/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/f8/07/d0/f807d05e-c4c9-fa8e-2cac-5e6cea404ea9/mzaf_16211535020780953557.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/apollo/1678181915?i=1678181925&uo=4"
  },
  "hex": {
    "trackId": 1655751168,
    "title": "Bunker Buster VIP",
    "artist": "Excision & Subtronics",
    "album": "Antifractals",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/4b/41/55/4b415500-2280-e444-2241-6db9cddfafa2/cover.jpg/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/1d/6b/2b/1d6b2b2f-ec9d-bd10-ead5-09566e097b8c/mzaf_7735411082079939647.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/bunker-buster-vip/1655750333?i=1655751168&uo=4"
  },
  "luna": {
    "trackId": 1642696621,
    "title": "Sun In Your Eyes",
    "artist": "Above & Beyond",
    "album": "Sun In Your Eyes (William Orbit Remix)",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/e3/f8/5d/e3f85d9f-f88e-3286-1f4c-636306dd1f53/5039060811092.png/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview122/v4/a9/7e/3a/a97e3a8a-fef6-44a4-f97f-76c6a3e4d9d5/mzaf_5177865841099490113.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/sun-in-your-eyes/1642696617?i=1642696621&uo=4"
  },
  "riot": {
    "trackId": 1803842104,
    "title": "A Fine Way to Die (feat. Leo Napier)",
    "artist": "GRiZ",
    "album": "Say It Loud",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/89/50/7e/89507e3f-9a51-35ba-2cd9-f48a9b77ff99/889326188070_cover.jpg/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/1c/ee/f1/1ceef16a-3eeb-7ba9-a9ad-b7b17faff3dd/mzaf_11351767312864833550.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/a-fine-way-to-die-feat-leo-napier/1803842098?i=1803842104&uo=4"
  },
  "vesper": {
    "trackId": 1706358880,
    "title": "(It Goes Like) Nanana",
    "artist": "Peggy Gou",
    "album": "(It Goes Like) Nanana - Single",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/65/6c/d8/656cd891-bcfe-96df-231f-5c925c7b6d35/191404901175.png/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/11/79/40/11794000-7943-49b0-3af3-91355a147167/mzaf_6018533596191950571.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/it-goes-like-nanana/1706358876?i=1706358880&uo=4"
  },
  "sol": {
    "trackId": 1478926053,
    "title": "Blah Blah Blah",
    "artist": "Armin van Buuren",
    "album": "Balance",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/bd/d2/dd/bdd2dd9e-c9a0-43d0-1cef-6b238c82fd4c/8718522270444.png/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/95/3a/a7/953aa7d7-89ae-c7eb-4fd3-0df708047389/mzaf_17147052923258036974.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/blah-blah-blah/1478925861?i=1478926053&uo=4"
  },
  "ember": {
    "trackId": 1232783021,
    "title": "Daydream",
    "artist": "I Hate Models",
    "album": "Warehouse Memories - EP",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/d7/45/3e/d7453ea0-7d3c-df96-8947-0499f90bda7f/8790001210110.png/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/40/65/cd/4065cda7-29c1-7fba-eb74-08b1ea147504/mzaf_17088445891898943864.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/daydream/1232782843?i=1232783021&uo=4"
  },
  "pixel": {
    "trackId": 1553064274,
    "title": "Marea (We’ve Lost Dancing)",
    "artist": "Fred again.. & The Blessed Madonna",
    "album": "Marea (We’ve Lost Dancing) - Single",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/68/49/e4/6849e4dc-2692-20c7-b80f-6e823c245643/190296770036.jpg/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/15/ea/4e/15ea4ed2-f7fc-f87c-b44f-9ca2c628437a/mzaf_1763923556124349361.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/marea-weve-lost-dancing/1553064273?i=1553064274&uo=4"
  },
  "jade": {
    "trackId": 1709178108,
    "title": "Saving Up",
    "artist": "Dom Dolla",
    "album": "Saving Up - Single",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/84/5e/33/845e3390-0d0c-ce76-b1b1-76f17126df60/196871470261.jpg/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/eb/f3/bb/ebf3bb3c-caf7-aae1-6b3b-9a7274e0e5f5/mzaf_7114324002687306631.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/saving-up/1709177801?i=1709178108&uo=4"
  },
  "orion": {
    "trackId": 1061140878,
    "title": "Powers of Ten (Gabriel Ananda Remix)",
    "artist": "Stephan Bodzin",
    "album": "Powers of Ten (Remixes)",
    "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music69/v4/b7/3a/8d/b73a8d04-8ff6-5f05-43cb-2c39742cb0c4/cover.jpg/600x600bb.jpg",
    "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/ef/51/b7/ef51b794-5e02-65af-2a0d-524bd0bf8039/mzaf_5077120334008838513.plus.aac.p.m4a",
    "trackViewUrl": "https://music.apple.com/us/album/powers-of-ten-gabriel-ananda-remix/1061140399?i=1061140878&uo=4"
  }
};

// Extra "My songs" for demo profiles (3–5 songs each with the favorite above). Looked up on iTunes Search.
const DEMO_EXTRA_SONGS = {
  "nova": [
    {
      "trackId": 1408454985,
      "title": "Losing It",
      "artist": "FISHER",
      "album": "Losing It - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b6/d0/78/b6d078c6-5a24-063e-548e-0d28af65dab9/18UMGIM41789.rgb.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/5e/73/3e/5e733e6a-ddae-6081-dbbd-0be7e9542e60/mzaf_15726405558792372151.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/losing-it/1408454984?i=1408454985&uo=4"
    },
    {
      "trackId": 1783998383,
      "title": "Cola",
      "artist": "CamelPhat & Elderbrook",
      "album": "Cola - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c7/c7/a0/c7c7a005-6cbe-a1a7-78c7-a97afb5d15da/826194369798.png/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/35/98/b4/3598b477-14a2-1063-ac76-14df1ea07f0e/mzaf_18428237531243601895.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/cola/1783998382?i=1783998383&uo=4"
    }
  ],
  "hex": [
    {
      "trackId": 1593750841,
      "title": "Griztronics II (Another Level)",
      "artist": "GRiZ & Subtronics",
      "album": "Griztronics II (Another Level) - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/85/0c/99/850c9960-50f3-6952-2ede-a45b8bda56c7/cover.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/72/d7/4a/72d74a00-688c-83f3-0425-f0a69358362d/mzaf_17735987981043109827.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/griztronics-ii-another-level/1593750838?i=1593750841&uo=4"
    },
    {
      "trackId": 1163512152,
      "title": "Throwin' Elbows (feat. Space Laces)",
      "artist": "Excision",
      "album": "Virus",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/d5/49/c0/d549c0e5-c471-4764-4ca6-f1fcac2b32ac/ROTD191-Orig.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/82/9a/56/829a561d-0255-67a5-20ad-58fd3943bf03/mzaf_3614767132483308034.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/throwin-elbows-feat-space-laces/1163512092?i=1163512152&uo=4"
    }
  ],
  "luna": [
    {
      "trackId": 1440851025,
      "title": "Opus",
      "artist": "Eric Prydz",
      "album": "Opus",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/e9/6e/5d/e96e5de7-f9ca-792c-014c-646017c2d854/00602547503701.rgb.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/76/89/b1/7689b1ff-209b-5d2b-0c39-5d1f60eb8c42/mzaf_15472529562433833316.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/opus/1440850027?i=1440851025&uo=4"
    },
    {
      "trackId": 1813489559,
      "title": "Strobe",
      "artist": "deadmau5",
      "album": "For Lack of A Better Name (The Extended Mixes)",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/f7/24/19/f724197c-b6b7-b2ad-94a9-06b2f5f95455/617465226458.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/68/f2/85/68f285ca-6cc6-5bc5-54da-5ee164bee249/mzaf_16955640893323702645.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/strobe/1813489294?i=1813489559&uo=4"
    },
    {
      "trackId": 775187389,
      "title": "Sun & Moon",
      "artist": "Above & Beyond",
      "album": "Acoustic",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music124/v4/20/11/93/20119343-b4fd-07e5-a5bc-e0fa6b78bbc9/5039060215395.png/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/df/eb/f6/dfebf6d7-320a-c381-f40c-c53e1de19c1f/mzaf_15431377587531624851.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/sun-moon/775187373?i=775187389&uo=4"
    }
  ],
  "riot": [
    {
      "trackId": 897564278,
      "title": "Say My Name (feat. Zyra)",
      "artist": "ODESZA",
      "album": "In Return",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/76/5d/55/765d554e-e421-0299-783f-d78ad559d5e5/5021392959191.png/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/7b/a8/de/7ba8dee7-2146-e403-ee04-d9ad6b8a17b1/mzaf_1843147315490267895.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/say-my-name-feat-zyra/897564246?i=897564278&uo=4"
    },
    {
      "trackId": 1885945784,
      "title": "Never Be Like You (feat. Kai) [Disclosure Remix]",
      "artist": "Flume",
      "album": "Never Be Like You (feat. Kai) [Remixes] - EP",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/29/f4/3b/29f43b3f-cbeb-2cdd-33d3-d3b6bd231a9d/112230.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/86/00/82/8600827a-320a-6995-1359-e24af53fd6d3/mzaf_14790995303205620519.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/never-be-like-you-feat-kai-disclosure-remix/1885945779?i=1885945784&uo=4"
    },
    {
      "trackId": 1462451663,
      "title": "Good Things Fall Apart",
      "artist": "ILLENIUM & Jon Bellion",
      "album": "Good Things Fall Apart - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/5a/ed/7d/5aed7ddd-8208-8c82-b9c6-c3b47882e233/19UMGIM38001.rgb.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/12/9d/cc/129dcc57-d299-cd6f-e838-cb139aff36a8/mzaf_13170629027581948356.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/good-things-fall-apart/1462451646?i=1462451663&uo=4"
    }
  ],
  "vesper": [
    {
      "trackId": 873131250,
      "title": "Gecko (Overdrive) [Radio Edit]",
      "artist": "Oliver Heldens & Becky Hill",
      "album": "Gecko (Overdrive) [Radio Edit] - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/2f/d5/e9/2fd5e98b-9726-bdfc-582f-a52aed6bb4d7/825646278572.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/fd/c3/7c/fdc37c9f-b0ad-434a-93b9-35ab1f87518a/mzaf_13776257952233740893.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/gecko-overdrive-radio-edit/873131193?i=873131250&uo=4"
    },
    {
      "trackId": 1783952517,
      "title": "Finally (feat. Julie McKnight) [Extended Mix]",
      "artist": "Kings of Tomorrow",
      "album": "Finally (feat. Julie McKnight) - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/8c/75/4d/8c754d77-ec61-1dbd-18b6-62ce3053651e/826194055097.png/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/cc/96/32/cc963234-0010-3b1a-b45e-0d58c7149162/mzaf_10849029244599127911.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/finally-feat-julie-mcknight-extended-mix/1783952516?i=1783952517&uo=4"
    }
  ],
  "sol": [
    {
      "trackId": 1670593167,
      "title": "Animals",
      "artist": "Martin Garrix",
      "album": "Animals - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/6e/1e/f0/6e1ef055-195a-bb73-d5a8-5926058366a5/8712944577525.png/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/8f/ca/53/8fca53bf-328f-4006-fb9c-eef2feee7790/mzaf_17242236602085711440.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/animals/1670593166?i=1670593167&uo=4"
    },
    {
      "trackId": 1440787349,
      "title": "Levels",
      "artist": "Avicii",
      "album": "Levels - EP",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/67/38/43/67384338-9ed7-fc68-5927-93f1fcf4705d/11UMGIM36900.rgb.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/66/dc/bd/66dcbd68-b557-bdfd-f2c2-a05491758783/mzaf_13654489760720011690.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/levels/1440787344?i=1440787349&uo=4"
    },
    {
      "trackId": 1499501875,
      "title": "Children (Original Version)",
      "artist": "Robert Miles",
      "album": "Dreamland",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/56/06/b8/5606b8b2-d9af-78e6-16d0-b8ea543680f6/DBX002.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/a8/66/d4/a866d461-4f5a-228f-6920-0a513896228b/mzaf_7437444357903810938.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/children-original-version/1499501866?i=1499501875&uo=4"
    }
  ],
  "ember": [
    {
      "trackId": 500162235,
      "title": "Firestarter",
      "artist": "The Prodigy",
      "album": "The Fat of the Land",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/96/8b/08/968b08e4-cb2b-54c2-32bb-dba77ad1c2ca/634904912161.png/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/fe/f0/48/fef048ad-df35-bbce-dc88-05e424cadba7/mzaf_15874742277122495094.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/firestarter/500162127?i=500162235&uo=4"
    },
    {
      "trackId": 1508239038,
      "title": "Spastik",
      "artist": "Plastikman",
      "album": "Recycled Plastik",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/84/79/10/8479109c-ac3d-ff06-0fbf-f04338b0c7c8/192641482243_Cover.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/71/78/f3/7178f389-3451-1a6e-d145-d778dff444eb/mzaf_15621981303545075686.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/spastik/1508238849?i=1508239038&uo=4"
    }
  ],
  "pixel": [
    {
      "trackId": 1640463908,
      "title": "Delilah (pull me out of this)",
      "artist": "Fred again.. & Delilah Montagu",
      "album": "Actual Life 3 (January 1 - September 9 2022)",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/b0/9c/b7/b09cb72c-cca9-5d66-bc9d-a9b5e5f86b22/5054197236389.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/b7/52/49/b75249d5-f30c-15bd-b6b6-2b2592a8273f/mzaf_16220054371150220513.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/delilah-pull-me-out-of-this/1640463893?i=1640463908&uo=4"
    },
    {
      "trackId": 1440862129,
      "title": "Latch",
      "artist": "Disclosure & Sam Smith",
      "album": "Settle (Deluxe)",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/57/93/e0/5793e0d6-4877-e015-ef54-3fd4eff87344/14UMGIM12348.rgb.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/4f/44/94/4f4494e5-8a5e-c9ef-548e-760cabd4fd80/mzaf_644961378672752727.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/latch/1440862011?i=1440862129&uo=4"
    },
    {
      "trackId": 1036141817,
      "title": "Flowers (Sunship Edit)",
      "artist": "Sweet Female Attitude",
      "album": "In Person",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/ad/36/f1/ad36f186-e0cf-9573-4243-912cf42843ae/mzm.gingixgt.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/89/4e/a0/894ea0af-6cc2-07c7-0565-bc4608f8308b/mzaf_11282141261461601725.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/flowers-sunship-edit/1036141510?i=1036141817&uo=4"
    }
  ],
  "jade": [
    {
      "trackId": 1479872574,
      "title": "San Frandisco",
      "artist": "Dom Dolla",
      "album": "San Frandisco - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/21/84/c7/2184c7a2-eaf6-3445-3e15-38fcf940729a/886447952214.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/77/19/7b/77197b46-6fe7-d3cc-913b-00a60cfdbe84/mzaf_539232983612957776.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/san-frandisco/1479872567?i=1479872574&uo=4"
    },
    {
      "trackId": 1673828907,
      "title": "Where You Are",
      "artist": "John Summit & HAYLA",
      "album": "Where You Are - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/26/86/a9/2686a9dc-0a17-8e7f-82e3-9bb7c53c1494/23UMGIM19042.rgb.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/01/c0/ec/01c0ecc6-36cb-6a62-faf4-e2617cc2e33d/mzaf_11012603604995349193.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/where-you-are/1673828877?i=1673828907&uo=4"
    },
    {
      "trackId": 1672155007,
      "title": "Rumble",
      "artist": "Skrillex, Fred again.. & Flowdan",
      "album": "Quest For Fire",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/fc/f4/6b/fcf46b95-cf27-9f04-94c2-4ad257b7a5a6/075679695239.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/51/e6/0d/51e60d1c-5375-530a-a434-4ff93b96fd2e/mzaf_6494976916814603599.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/rumble/1672154692?i=1672155007&uo=4"
    }
  ],
  "orion": [
    {
      "trackId": 1058740894,
      "title": "Innerbloom",
      "artist": "RÜFÜS DU SOL",
      "album": "Bloom",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/aa/5f/d8/aa5fd889-4c2e-7e24-e8b2-428beaf9d4fe/SWEATA009.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/2c/ce/8d/2cce8d43-f5c9-d691-d068-a7a65eeb8f3b/mzaf_3191095203385516246.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/innerbloom/1058740883?i=1058740894&uo=4"
    },
    {
      "trackId": 1831059987,
      "title": "Strings Of Life",
      "artist": "Rhythim Is Rhythim",
      "album": "Strings Of Life - Single",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/80/f6/a1/80f6a147-3841-dc7f-12d2-629e6d4cddd6/10063.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/34/bd/6b/34bd6ba7-c99d-1a24-6178-b499240133d1/mzaf_9818915045852185348.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/strings-of-life/1831059984?i=1831059987&uo=4"
    },
    {
      "trackId": 1440851025,
      "title": "Opus",
      "artist": "Eric Prydz",
      "album": "Opus",
      "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/e9/6e/5d/e96e5de7-f9ca-792c-014c-646017c2d854/00602547503701.rgb.jpg/600x600bb.jpg",
      "previewUrl": "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview211/v4/76/89/b1/7689b1ff-209b-5d2b-0c39-5d1f60eb8c42/mzaf_15472529562433833316.plus.aac.p.m4a",
      "trackViewUrl": "https://music.apple.com/us/album/opus/1440850027?i=1440851025&uo=4"
    }
  ]
};

async function ensureDemoSongs(db) {
  let n = 0;
  for (const [username, song] of Object.entries(DEMO_SONGS)) {
    if (!song) continue;
    const r = await db.prepare(`UPDATE users SET favorite_song=? WHERE lower(username)=? AND is_demo=1 AND (favorite_song IS NULL OR favorite_song='')`).run(JSON.stringify(song), username);
    if (r && r.changes) n += Number(r.changes);
    // Fill the demo's song list once (only while it still has 0–1 songs, so later edits stick).
    const row = await db.prepare(`SELECT id, songs, favorite_song FROM users WHERE lower(username)=? AND is_demo=1`).get(username);
    if (!row) continue;
    let current = [];
    try { current = row.songs ? JSON.parse(row.songs) : []; } catch (_) { current = []; }
    if (Array.isArray(current) && current.length > 1) continue;
    let first = song;
    try { if (row.favorite_song) first = JSON.parse(row.favorite_song); } catch (_) {}
    const list = [first, ...(DEMO_EXTRA_SONGS[username] || []).filter((x) => x.trackId !== first.trackId)].slice(0, 5);
    await db.prepare(`UPDATE users SET songs=? WHERE id=?`).run(JSON.stringify(list), row.id);
    n++;
  }
  return n;
}

module.exports = { seed, seedSocial, seedStories, seedDemoMeetups, seedCrews, ensureDemoGenres, ensureDemoSongs, DEMO_SONGS, DEMO_PASSWORD, EVENTS, USERS };
