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

  if (owned) await db.close();
  const flag = path.join(__dirname, "..", "data", ".seeded");
  fs.writeFileSync(flag, new Date().toISOString());
  console.log("Seeded example events and 10 demo ravers.");
  console.log("Demo login password for all of them: " + DEMO_PASSWORD);
  console.log("Usernames: " + USERS.map((u) => u.username).join(", "));
}

if (require.main === module) {
  seed().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seed, DEMO_PASSWORD, EVENTS, USERS };
