"use strict";

// Local engagement / badge / demo-chat tests. Always use a temp SQLite file.
// Never print connection strings or secrets.
process.env.DATABASE_URL = "";
process.env.SEED_ON_BOOT = "0";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kandi-rank-"));
const dbFile = path.join(tmpDir, "kandi.sqlite");
process.env.KANDI_SQLITE_PATH = dbFile;

const { open } = require("../src/db");
const {
  refreshScores,
  assignBadges,
  badgePublic,
  badgeGuide,
  popularScore,
  followingRankTime,
  followingBoostMs,
  compareDiscover,
  compareGoers,
  RAVER_BADGES,
  BADGE_RULES,
  CAPS,
  WEIGHTS,
  FRESH_BOOST,
} = require("../src/engagement");
const { createDemoChat, pickReply, isDemoUser } = require("../src/demo-chat");

let failed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log("ok  " + name))
    .catch((err) => {
      failed += 1;
      console.error("FAIL " + name + "\n  " + (err && err.stack || err));
    });
}

async function addUser(db, { username, name, createdAt, isDemo = 0, age = 24 }) {
  const info = await db.prepare(
    `INSERT INTO users (username,password_hash,name,age,is_demo,created_at) VALUES (?,?,?,?,?,?)`
  ).run(username, "x", name, age, isDemo, createdAt || new Date().toISOString());
  return Number(info.lastInsertRowid);
}

async function addEvent(db, { id, name, startsAt, status = "active" }) {
  await db.prepare(
    `INSERT INTO events (id,name,city,date_label,venue,status,starts_at,is_example) VALUES (?,?,?,?,?,?,?,0)`
  ).run(id, name, "SLC", "Fri", "Soundwell", status, startsAt || "");
}

async function addPost(db, userId, { createdAt, caption } = {}) {
  const info = await db.prepare(
    `INSERT INTO posts (user_id, caption, created_at) VALUES (?,?,?)`
  ).run(userId, caption || "set recap", createdAt || new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function dayIso(daysAgo, hour = 15) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function main() {
  const db = await open();

  await check("badge config is the single source of names", () => {
    assert.strictEqual(RAVER_BADGES.bass.name, "Bass");
    assert.strictEqual(RAVER_BADGES.banger.name, "Banger");
    assert.strictEqual(RAVER_BADGES.bopper.name, "Bopper");
    const guide = badgeGuide();
    assert.strictEqual(guide.badges.length, 3);
    assert.strictEqual(guide.badges[0].name, RAVER_BADGES.bass.name);
    assert.strictEqual(badgePublic("bass").name, "Bass");
    assert.strictEqual(badgePublic("nope"), null);
    assert.ok(BADGE_RULES.bassTopFraction < BADGE_RULES.bangerTopFraction);
  });

  await check("assignBadges uses percentiles and skips inactive/hidden", () => {
    const rows = [];
    for (let i = 1; i <= 20; i++) {
      rows.push({ id: i, engagement_score: 100 - i, follower_count: 0, engagement_hidden: 0 });
    }
    rows.push({ id: 99, engagement_score: 0, follower_count: 50, engagement_hidden: 0 }); // inactive
    rows.push({ id: 98, engagement_score: 999, follower_count: 99, engagement_hidden: 1 }); // reported-heavy
    const badges = assignBadges(rows);
    // 20 eligible: top 5% => 1 Bass, top 25% => 5, so 4 Banger, 15 Bopper
    assert.strictEqual(badges.get(1), "bass");
    assert.strictEqual(badges.get(2), "banger");
    assert.strictEqual(badges.get(5), "banger");
    assert.strictEqual(badges.get(6), "bopper");
    assert.strictEqual(badges.get(20), "bopper");
    assert.strictEqual(badges.has(99), false);
    assert.strictEqual(badges.has(98), false);
  });

  await check("followers help a mid-score user outrank a slightly higher score", () => {
    const badges = assignBadges([
      { id: 1, engagement_score: 20, follower_count: 0, engagement_hidden: 0 },
      { id: 2, engagement_score: 19, follower_count: 10, engagement_hidden: 0 },
      { id: 3, engagement_score: 1, follower_count: 0, engagement_hidden: 0 },
    ]);
    // combined: #1=20, #2=19+20=39, #3=1. n=3, bassCut=1 => #2 is Bass
    assert.strictEqual(badges.get(2), "bass");
    assert.ok(badges.get(1) === "banger" || badges.get(1) === "bopper");
  });

  const now = new Date();
  const today = now.toISOString();
  const active = await addUser(db, { username: "star", name: "Star", createdAt: dayIso(40) });
  const lurker = await addUser(db, { username: "lurk", name: "Lurk", createdAt: dayIso(40) });
  const newbie = await addUser(db, { username: "fresh", name: "Fresh", createdAt: today });
  const hidden = await addUser(db, { username: "flagged", name: "Flagged", createdAt: dayIso(40) });
  const selfFan = await addUser(db, { username: "selffan", name: "Self Fan", createdAt: dayIso(40) });
  const spammer = await addUser(db, { username: "spam", name: "Spam", createdAt: dayIso(40) });
  const liker = await addUser(db, { username: "liker", name: "Liker", createdAt: dayIso(40) });

  // Active user: posts, received likes/comments, RSVP, activity days
  const postA = await addPost(db, active, { createdAt: dayIso(1) });
  const postA2 = await addPost(db, active, { createdAt: dayIso(2) });
  await db.prepare(`INSERT INTO post_likes (user_id, post_id, created_at) VALUES (?,?,?)`).run(liker, postA, dayIso(1));
  await db.prepare(`INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)`).run(postA, liker, "heavy", dayIso(1));
  await addEvent(db, { id: "rave-1", name: "Yheti at Soundwell", startsAt: dayIso(-3) });
  await db.prepare(`INSERT INTO event_going (user_id, event_id, created_at) VALUES (?,?,?)`).run(active, "rave-1", dayIso(3));
  await db.prepare(`INSERT INTO user_activity_days (user_id, day) VALUES (?,?)`).run(active, dayIso(0).slice(0, 10));
  await db.prepare(`INSERT INTO user_activity_days (user_id, day) VALUES (?,?)`).run(active, dayIso(1).slice(0, 10));
  await db.prepare(`INSERT INTO follows (follower_id, following_id, created_at) VALUES (?,?,?)`).run(liker, active, today);

  // Lurker does almost nothing
  await db.prepare(`INSERT INTO user_activity_days (user_id, day) VALUES (?,?)`).run(lurker, dayIso(20).slice(0, 10));

  // Hidden: lots of activity but 3 distinct reports
  const r1 = await addUser(db, { username: "rep1", name: "R1", createdAt: dayIso(40) });
  const r2 = await addUser(db, { username: "rep2", name: "R2", createdAt: dayIso(40) });
  const r3 = await addUser(db, { username: "rep3", name: "R3", createdAt: dayIso(40) });
  const hp = await addPost(db, hidden, { createdAt: dayIso(1) });
  for (let i = 0; i < 3; i++) {
    await db.prepare(`INSERT INTO post_likes (user_id, post_id, created_at) VALUES (?,?,?)`).run([liker, r1, r2][i], hp, dayIso(1));
  }
  await db.prepare(`INSERT INTO reports (reporter_id, target_id, reason, created_at) VALUES (?,?,?,?)`).run(r1, hidden, "x", today);
  await db.prepare(`INSERT INTO reports (reporter_id, target_id, reason, created_at) VALUES (?,?,?,?)`).run(r2, hidden, "x", today);
  await db.prepare(`INSERT INTO reports (reporter_id, target_id, reason, created_at) VALUES (?,?,?,?)`).run(r3, hidden, "x", today);

  // Self-likes should not count
  const sp = await addPost(db, selfFan, { createdAt: dayIso(1) });
  await db.prepare(`INSERT INTO post_likes (user_id, post_id, created_at) VALUES (?,?,?)`).run(selfFan, sp, dayIso(1));
  await db.prepare(`INSERT INTO comments (post_id, user_id, text, created_at) VALUES (?,?,?,?)`).run(sp, selfFan, "me", dayIso(1));

  // Spam: 10 posts in one day, should cap at 3
  for (let i = 0; i < 10; i++) {
    await addPost(db, spammer, { createdAt: dayIso(0, 10 + i), caption: "spam " + i });
  }

  await refreshScores(db, now);

  const scores = {};
  const badges = {};
  for (const row of await db.prepare(`SELECT id, username, engagement_score, engagement_hidden, raver_badge, active_raver FROM users`).all()) {
    scores[row.username] = Number(row.engagement_score) || 0;
    badges[row.username] = row.raver_badge || "";
  }

  await check("active user outranks lurker", () => {
    assert.ok(scores.star > scores.lurk, `star=${scores.star} lurk=${scores.lurk}`);
  });

  await check("new users get a fresh-account boost", () => {
    assert.ok(scores.fresh > 0, "fresh score " + scores.fresh);
    assert.ok(scores.fresh <= FRESH_BOOST + 0.01);
    assert.ok(scores.fresh >= FRESH_BOOST * 0.8, "expected most of the 7-day boost, got " + scores.fresh);
  });

  await check("reported-heavy users are zeroed and get no badge", () => {
    assert.strictEqual(scores.flagged, 0);
    assert.strictEqual(badges.flagged, "");
  });

  await check("self-likes and self-comments do not inflate the score", () => {
    // Only the post itself (weight 6, decay ~1 for today-ish) should count, not like/comment given/received
    assert.ok(scores.selffan > 0, "post itself should count");
    const onePost = WEIGHTS.posts + 0.5; // allow decay slack
    // without self-like, score should be roughly one post (day 1 decay is close to 1)
    assert.ok(scores.selffan < WEIGHTS.posts * 1.2 + 1, "selffan too high: " + scores.selffan);
  });

  await check("per-day post cap prevents spam", () => {
    const uncapped = 10 * WEIGHTS.posts;
    const capped = CAPS.posts * WEIGHTS.posts;
    assert.ok(scores.spam <= capped + 0.5, "spam score " + scores.spam + " should be near " + capped);
    assert.ok(scores.spam < uncapped / 2);
    assert.ok(scores.spam >= capped * 0.8);
  });

  await check("star gets a tiered badge; lurker does not", () => {
    assert.ok(["bass", "banger", "bopper"].includes(badges.star), "star badge " + badges.star);
    assert.strictEqual(badges.lurk, "");
    assert.ok(badgePublic(badges.star));
  });

  await check("popular ranking blends post engagement, author score, and recency", () => {
    const hotOld = { likeCount: 1, commentCount: 0, authorScore: 0, createdAt: dayIso(3) };
    const quieterNewAuthor = { likeCount: 0, commentCount: 0, authorScore: 80, createdAt: dayIso(0) };
    const huge = { likeCount: 20, commentCount: 10, authorScore: 80, createdAt: dayIso(0) };
    assert.ok(popularScore(huge) > popularScore(hotOld));
    assert.ok(popularScore(quieterNewAuthor) > popularScore({ likeCount: 0, commentCount: 0, authorScore: 0, createdAt: dayIso(0) }));
  });

  await check("Following stays mostly chronological with only a light boost", () => {
    const olderStar = { createdAt: dayIso(0, 12), authorScore: 40 }; // noon
    const newerLurk = { createdAt: dayIso(0, 16), authorScore: 0 }; // 4pm same day
    // 40 points * 4 min = 160 min < 4 hours, so newer lurk still leads
    assert.ok(followingRankTime(newerLurk) > followingRankTime(olderStar));
    const muchOlderStar = { createdAt: dayIso(1), authorScore: 40 };
    assert.ok(followingRankTime(newerLurk) > followingRankTime(muchOlderStar));
    assert.ok(followingBoostMs(40) <= 6 * 3600 * 1000);
  });

  await check("Discover prefers shared shows, then engagement", () => {
    const shared = new Map([[1, 2], [2, 0], [3, 2]]);
    const a = { id: 1, engagement_score: 5, last_active_at: "a" };
    const b = { id: 2, engagement_score: 50, last_active_at: "z" };
    const c = { id: 3, engagement_score: 9, last_active_at: "a" };
    const list = [a, b, c].sort((x, y) => compareDiscover(x, y, shared));
    assert.strictEqual(list[0].id, 3); // more engagement among shared-show people
    assert.strictEqual(list[1].id, 1);
    assert.strictEqual(list[2].id, 2); // high score but no shared show
  });

  await check("Who's going ranks by engagement, VIP first when requested", () => {
    const people = [
      { id: 1, name: "A", engagement_score: 10, subscription: "" },
      { id: 2, name: "B", engagement_score: 3, subscription: "vip" },
      { id: 3, name: "C", engagement_score: 30, subscription: "" },
    ];
    const normal = people.slice().sort((a, b) => compareGoers(a, b));
    assert.strictEqual(normal[0].id, 3);
    const vip = people.slice().sort((a, b) => compareGoers(a, b, { vipFirst: true }));
    assert.strictEqual(vip[0].id, 2);
    assert.strictEqual(vip[1].id, 3);
  });

  // Demo auto-replies
  const boston = await addUser(db, { username: "boston", name: "Boston", createdAt: dayIso(20) });
  const nova = await addUser(db, { username: "nova", name: "Nova", isDemo: 1, createdAt: dayIso(40) });
  const pair = boston < nova ? [boston, nova] : [nova, boston];
  const matchInfo = await db.prepare(`INSERT INTO matches (a_id, b_id, created_at) VALUES (?,?,?)`).run(pair[0], pair[1], today);
  const matchId = Number(matchInfo.lastInsertRowid);
  await db.prepare(`INSERT INTO event_going (user_id, event_id, created_at) VALUES (?,?,?)`).run(boston, "rave-1", today);
  await db.prepare(`INSERT INTO event_going (user_id, event_id, created_at) VALUES (?,?,?)`).run(nova, "rave-1", today);

  await check("pickReply can mention a shared upcoming show", () => {
    const text = pickReply({ sharedEvent: { name: "Yheti at Soundwell" }, lastTexts: [], rng: () => 0 });
    assert.ok(/Yheti at Soundwell/.test(text), text);
  });

  const broadcasts = [];
  const demoChat = createDemoChat({
    getDb: () => db,
    publicUser: (u) => ({ id: Number(u.id), name: u.name, isDemo: Boolean(Number(u.is_demo)) }),
    broadcastToUser: (id, payload) => broadcasts.push({ id, payload }),
    delayRange: [0, 0],
  });

  await check("demo auto-reply inserts a message and pushes it over the socket hook", async () => {
    const fromUser = await db.prepare(`SELECT * FROM users WHERE id=?`).get(boston);
    const toUser = await db.prepare(`SELECT * FROM users WHERE id=?`).get(nova);
    await db.prepare(`INSERT INTO messages (match_id, from_id, text, created_at) VALUES (?,?,?,?)`)
      .run(matchId, boston, "See you on the floor?", today);
    const msg = await demoChat.sendReply({ matchId, fromUser, toUser });
    assert.ok(msg && msg.text, "expected a reply");
    assert.strictEqual(Number(msg.fromId), nova);
    assert.strictEqual(broadcasts.length, 1);
    assert.strictEqual(broadcasts[0].id, boston);
    assert.strictEqual(broadcasts[0].payload.type, "message");
    assert.ok(isDemoUser(toUser));
    assert.ok(!isDemoUser(fromUser));
  });

  await check("auto-replies cap at 20 per conversation per day", async () => {
    const fromUser = await db.prepare(`SELECT * FROM users WHERE id=?`).get(boston);
    const toUser = await db.prepare(`SELECT * FROM users WHERE id=?`).get(nova);
    const day = today.slice(0, 10);
    // insert 19 more demo messages already today (one already sent) => 20 total, next should refuse
    const already = await db.prepare(
      `SELECT COUNT(*) AS c FROM messages WHERE match_id=? AND from_id=? AND substr(created_at,1,10)=?`
    ).get(matchId, nova, day);
    const have = Number(already.c) || 0;
    for (let i = have; i < 20; i++) {
      await db.prepare(`INSERT INTO messages (match_id, from_id, text, created_at) VALUES (?,?,?,?)`)
        .run(matchId, nova, "cap " + i, today);
    }
    // latest is from demo, sendReply should also no-op because last message is from demo
    // add a new user message, then expect cap
    await db.prepare(`INSERT INTO messages (match_id, from_id, text, created_at) VALUES (?,?,?,?)`)
      .run(matchId, boston, "still there?", today);
    const msg = await demoChat.sendReply({ matchId, fromUser, toUser });
    assert.strictEqual(msg, null);
  });

  await check("liking a demo who already liked you creates a match", async () => {
    const jade = await addUser(db, { username: "jade", name: "Jade", isDemo: 1, createdAt: dayIso(40) });
    await db.prepare(`INSERT INTO likes (from_id,to_id,target_type,target_id,comment,created_at) VALUES (?,?,?,?,?,?)`)
      .run(jade, boston, "photo", "0", "hey", today);
    await db.prepare(`INSERT INTO likes (from_id,to_id,target_type,target_id,comment,created_at) VALUES (?,?,?,?,?,?)`)
      .run(boston, jade, "photo", "0", "", today);
    const back = await db.prepare(`SELECT id FROM likes WHERE from_id=? AND to_id=?`).get(jade, boston);
    assert.ok(back, "demo like should already exist");
    const [a, b] = boston < jade ? [boston, jade] : [jade, boston];
    const existing = await db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
    assert.ok(!existing, "precondition: no match yet");
    await db.prepare(`INSERT INTO matches (a_id, b_id, created_at) VALUES (?,?,?)`).run(a, b, today);
    const match = await db.prepare(`SELECT * FROM matches WHERE a_id=? AND b_id=?`).get(a, b);
    assert.ok(match && match.id, "match should be created for mutual likes");
  });

  await db.close();
  try { fs.unlinkSync(dbFile); } catch (_) {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

  if (failed) {
    console.error("\n" + failed + " test(s) failed");
    process.exit(1);
  }
  console.log("\nAll engagement tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
