"use strict";

const WINDOW_DAYS = 14;
const HALF_LIFE_DAYS = 7;
const FRESH_DAYS = 7;
const FRESH_BOOST = 8;
const REPORT_HEAVY = 3;
const BLOCK_HEAVY = 5;
const RSVP_CAP = 8;
const FOLLOWING_MS_PER_POINT = 4 * 60 * 1000;
const FOLLOWING_BOOST_CAP_MS = 6 * 60 * 60 * 1000;
const POPULAR_AUTHOR_WEIGHT = 0.25;
const REFRESH_DEBOUNCE_MS = 2500;
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const CAPS = {
  posts: 3,
  likesGiven: 20,
  commentsGiven: 15,
  likesReceived: 30,
  commentsReceived: 20,
};

const WEIGHTS = {
  posts: 6,
  likesGiven: 1,
  commentsGiven: 2,
  likesReceived: 2,
  commentsReceived: 3,
  rsvp: 4,
  activeDay: 3,
};

// Display names may change — keep all badge copy in this one config.
const RAVER_BADGES = Object.freeze({
  bass: {
    id: "bass",
    name: "Bass",
    icon: "bass",
    tagline: "The floor already knows your name.",
    how: "Top about 5% of active ravers, ranked by recent posts, likes, comments, shows, and followers.",
  },
  banger: {
    id: "banger",
    name: "Banger",
    icon: "banger",
    tagline: "You're in the mix.",
    how: "About the next 20% of active ravers (the top 25% overall) by recent engagement and followers.",
  },
  bopper: {
    id: "bopper",
    name: "Bopper",
    icon: "bopper",
    tagline: "You're showing up.",
    how: "Any raver who's been active recently. Post, like, comment, RSVP to shows, and keep coming back to climb.",
  },
});

const BADGE_RULES = Object.freeze({
  bassTopFraction: 0.05,
  bangerTopFraction: 0.25,
  followerWeight: 2,
});

function combinedRankScore(row) {
  return (Number(row.engagement_score) || 0) + BADGE_RULES.followerWeight * (Number(row.follower_count) || 0);
}

function assignBadges(rows) {
  const eligible = (rows || []).filter((r) => !Number(r.engagement_hidden) && Number(r.engagement_score) > 0);
  eligible.sort((a, b) => {
    const d = combinedRankScore(b) - combinedRankScore(a);
    if (d) return d;
    return Number(a.id) - Number(b.id);
  });
  const n = eligible.length;
  const bassCut = n ? Math.max(1, Math.ceil(n * BADGE_RULES.bassTopFraction)) : 0;
  const bangerCut = n ? Math.max(bassCut, Math.ceil(n * BADGE_RULES.bangerTopFraction)) : 0;
  const out = new Map();
  eligible.forEach((r, i) => {
    const rank = i + 1;
    let id = "bopper";
    if (rank <= bassCut) id = "bass";
    else if (rank <= bangerCut) id = "banger";
    out.set(Number(r.id), id);
  });
  return out;
}

function badgePublic(id) {
  const b = RAVER_BADGES[String(id || "")];
  if (!b) return null;
  return { id: b.id, name: b.name, icon: b.icon };
}

function badgeGuide() {
  return {
    badges: [RAVER_BADGES.bass, RAVER_BADGES.banger, RAVER_BADGES.bopper],
    rules: {
      windowDays: WINDOW_DAYS,
      bassShare: "top 5%",
      bangerShare: "next 20%",
      bopper: "anyone active recently",
      followerWeight: BADGE_RULES.followerWeight,
    },
  };
}

function utcDay(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function windowStartDay(now = new Date()) {
  return utcDay(new Date(now.getTime() - WINDOW_DAYS * 86400000));
}

function dateSubSql(driver, leftDate, rightDate) {
  if (driver === "postgres") {
    return `(CAST(${leftDate} AS DATE) - CAST(${rightDate} AS DATE))`;
  }
  return `CAST(julianday(${leftDate}) - julianday(${rightDate}) AS INTEGER)`;
}

function capSql(countExpr, cap) {
  return `CASE WHEN (${countExpr}) > ${cap} THEN ${cap} ELSE (${countExpr}) END`;
}

function decaySql(driver, todayLit, dayExpr) {
  const daysAgo = dateSubSql(driver, todayLit, dayExpr);
  return `CASE WHEN (${daysAgo}) <= 0 THEN 1.0 ELSE power(0.5, ((${daysAgo}) * 1.0) / ${HALF_LIFE_DAYS}) END`;
}

function scoresCte(driver, today, since) {
  const todayLit = "'" + today + "'";
  const sinceLit = "'" + since + "'";
  const dayOf = (col) => `substr(${col}, 1, 10)`;
  const decay = (dayCol) => decaySql(driver, todayLit, dayCol);
  const ageDays = dateSubSql(driver, todayLit, dayOf("u.created_at"));
  return `
  WITH
  posts_d AS (
    SELECT user_id, ${dayOf("created_at")} AS day, ${capSql("COUNT(*)", CAPS.posts)} AS n
    FROM posts
    WHERE ${dayOf("created_at")} >= ${sinceLit}
    GROUP BY user_id, ${dayOf("created_at")}
  ),
  likes_given_d AS (
    SELECT user_id, day, ${capSql("COUNT(*)", CAPS.likesGiven)} AS n
    FROM (
      SELECT pl.user_id AS user_id, ${dayOf("pl.created_at")} AS day
      FROM post_likes pl
      JOIN posts p ON p.id = pl.post_id
      WHERE ${dayOf("pl.created_at")} >= ${sinceLit} AND pl.user_id != p.user_id
      UNION ALL
      SELECT l.from_id AS user_id, ${dayOf("l.created_at")} AS day
      FROM likes l
      WHERE ${dayOf("l.created_at")} >= ${sinceLit} AND l.from_id != l.to_id
    ) x
    GROUP BY user_id, day
  ),
  comments_given_d AS (
    SELECT c.user_id, ${dayOf("c.created_at")} AS day, ${capSql("COUNT(*)", CAPS.commentsGiven)} AS n
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE ${dayOf("c.created_at")} >= ${sinceLit} AND c.user_id != p.user_id
    GROUP BY c.user_id, ${dayOf("c.created_at")}
  ),
  likes_recv_d AS (
    SELECT user_id, day, ${capSql("COUNT(*)", CAPS.likesReceived)} AS n
    FROM (
      SELECT p.user_id AS user_id, ${dayOf("pl.created_at")} AS day
      FROM post_likes pl
      JOIN posts p ON p.id = pl.post_id
      WHERE ${dayOf("pl.created_at")} >= ${sinceLit} AND pl.user_id != p.user_id
      UNION ALL
      SELECT l.to_id AS user_id, ${dayOf("l.created_at")} AS day
      FROM likes l
      WHERE ${dayOf("l.created_at")} >= ${sinceLit} AND l.from_id != l.to_id
    ) x
    GROUP BY user_id, day
  ),
  comments_recv_d AS (
    SELECT p.user_id AS user_id, ${dayOf("c.created_at")} AS day, ${capSql("COUNT(*)", CAPS.commentsReceived)} AS n
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE ${dayOf("c.created_at")} >= ${sinceLit} AND c.user_id != p.user_id
    GROUP BY p.user_id, ${dayOf("c.created_at")}
  ),
  rsvps AS (
    SELECT g.user_id, ${capSql("COUNT(*)", RSVP_CAP)} AS n
    FROM event_going g
    JOIN events e ON e.id = g.event_id
    WHERE COALESCE(e.status, 'active') != 'removed'
      AND COALESCE(e.is_example, 0) = 0
      AND (e.starts_at IS NULL OR e.starts_at = '' OR ${dayOf("e.starts_at")} >= ${todayLit})
    GROUP BY g.user_id
  ),
  active_d AS (
    SELECT user_id, day, 1 AS n
    FROM user_activity_days
    WHERE day >= ${sinceLit}
  ),
  hidden AS (
    SELECT u.id AS user_id
    FROM users u
    WHERE (SELECT COUNT(DISTINCT reporter_id) FROM reports r WHERE r.target_id = u.id) >= ${REPORT_HEAVY}
       OR (SELECT COUNT(DISTINCT b.user_id) FROM blocks b WHERE b.blocked_id = u.id) >= ${BLOCK_HEAVY}
  ),
  parts AS (
    SELECT user_id, SUM(n * ${WEIGHTS.posts} * (${decay("day")})) AS pts FROM posts_d GROUP BY user_id
    UNION ALL
    SELECT user_id, SUM(n * ${WEIGHTS.likesGiven} * (${decay("day")})) FROM likes_given_d GROUP BY user_id
    UNION ALL
    SELECT user_id, SUM(n * ${WEIGHTS.commentsGiven} * (${decay("day")})) FROM comments_given_d GROUP BY user_id
    UNION ALL
    SELECT user_id, SUM(n * ${WEIGHTS.likesReceived} * (${decay("day")})) FROM likes_recv_d GROUP BY user_id
    UNION ALL
    SELECT user_id, SUM(n * ${WEIGHTS.commentsReceived} * (${decay("day")})) FROM comments_recv_d GROUP BY user_id
    UNION ALL
    SELECT user_id, n * ${WEIGHTS.rsvp} * 1.0 FROM rsvps
    UNION ALL
    SELECT user_id, SUM(n * ${WEIGHTS.activeDay} * (${decay("day")})) FROM active_d GROUP BY user_id
  ),
  raw AS (
    SELECT u.id AS user_id,
      CASE WHEN h.user_id IS NOT NULL THEN 0
           ELSE COALESCE((SELECT SUM(pts) FROM parts p WHERE p.user_id = u.id), 0)
             + CASE
                 WHEN ${ageDays} IS NULL THEN 0
                 WHEN ${ageDays} < 0 THEN 0
                 WHEN ${ageDays} < ${FRESH_DAYS}
                   THEN ${FRESH_BOOST} * (1.0 - (${ageDays} * 1.0) / ${FRESH_DAYS})
                 ELSE 0
               END
      END AS score,
      CASE WHEN h.user_id IS NOT NULL THEN 1 ELSE 0 END AS hidden
    FROM users u
    LEFT JOIN hidden h ON h.user_id = u.id
  )
  `;
}

async function refreshScores(db, now = new Date()) {
  const today = utcDay(now);
  const since = windowStartDay(now);
  const cte = scoresCte(db.driver, today, since);
  const stamp = now.toISOString();
  if (db.driver === "postgres") {
    await db.exec(
      cte +
      `UPDATE users AS u SET
         engagement_score = ROUND(COALESCE(s.score, 0)::numeric, 2),
         engagement_hidden = COALESCE(s.hidden, 0),
         engagement_updated_at = '${stamp.replace(/'/g, "''")}',
         active_raver = 0,
         raver_badge = ''
       FROM raw s
       WHERE u.id = s.user_id`
    );
  } else {
    await db.exec(
      cte +
      `UPDATE users SET
         engagement_score = ROUND(COALESCE((SELECT score FROM raw WHERE user_id = users.id), 0), 2),
         engagement_hidden = COALESCE((SELECT hidden FROM raw WHERE user_id = users.id), 0),
         engagement_updated_at = '${stamp.replace(/'/g, "''")}',
         active_raver = 0,
         raver_badge = ''`
    );
  }
  const rows = await db.prepare(
    `SELECT u.id, u.engagement_score, u.engagement_hidden,
       (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count
     FROM users u`
  ).all();
  const badges = assignBadges(rows);
  const byTier = { bass: [], banger: [], bopper: [] };
  for (const [id, tier] of badges) {
    if (byTier[tier]) byTier[tier].push(id);
  }
  for (const [tier, ids] of Object.entries(byTier)) {
    if (!ids.length) continue;
    const ph = ids.map(() => "?").join(",");
    await db.prepare(
      `UPDATE users SET raver_badge=?, active_raver=1 WHERE id IN (${ph})`
    ).run(tier, ...ids);
  }
  return {
    updated: true,
    badges: { bass: byTier.bass.length, banger: byTier.banger.length, bopper: byTier.bopper.length },
    at: stamp,
  };
}

function hoursAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 48;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function popularScore(post) {
  const likes = Number(post.likeCount) || 0;
  const comments = Number(post.commentCount) || 0;
  const author = Number(post.authorScore) || 0;
  return (likes * 2 + comments * 3 + author * POPULAR_AUTHOR_WEIGHT) / Math.pow(hoursAgo(post.createdAt) + 2, 1.2);
}

function followingBoostMs(score) {
  return Math.min(Math.max(0, Number(score) || 0) * FOLLOWING_MS_PER_POINT, FOLLOWING_BOOST_CAP_MS);
}

function followingRankTime(post) {
  const t = new Date(post.createdAt).getTime();
  return (Number.isFinite(t) ? t : 0) + followingBoostMs(post.authorScore);
}

function compareDiscover(a, b, sharedMap, genreMap) {
  const sa = sharedMap.get(Number(a.id)) || 0;
  const sb = sharedMap.get(Number(b.id)) || 0;
  if (sb !== sa) return sb - sa;
  const ga = (genreMap && genreMap.get(Number(a.id))) || 0;
  const gb = (genreMap && genreMap.get(Number(b.id))) || 0;
  if (gb !== ga) return gb - ga;
  const ea = Number(a.engagement_score) || 0;
  const eb = Number(b.engagement_score) || 0;
  if (eb !== ea) return eb - ea;
  const la = String(a.last_active_at || "");
  const lb = String(b.last_active_at || "");
  if (lb !== la) return lb.localeCompare(la);
  return Number(a.id) - Number(b.id);
}

function compareGoers(a, b, { vipFirst } = {}) {
  if (vipFirst) {
    const v = Number(b.subscription === "vip") - Number(a.subscription === "vip");
    if (v) return v;
  }
  const ea = Number(a.engagement_score) || 0;
  const eb = Number(b.engagement_score) || 0;
  if (eb !== ea) return eb - ea;
  return String(a.name || "").localeCompare(String(b.name || "")) || Number(a.id) - Number(b.id);
}

function stripScoreFields(post) {
  if (!post) return post;
  delete post.authorScore;
  return post;
}

function createEngagement(getDb) {
  let refreshTimer = null;
  let refreshing = false;
  const activitySeen = new Map();

  async function recordActivity(userId) {
    if (!userId) return;
    const day = utcDay();
    const key = String(userId);
    if (activitySeen.get(key) === day) return;
    activitySeen.set(key, day);
    const db = getDb();
    if (!db) return;
    try {
      await db.prepare(`INSERT OR IGNORE INTO user_activity_days (user_id, day) VALUES (?,?)`).run(userId, day);
      await db.prepare(`UPDATE users SET last_active_at=? WHERE id=?`).run(new Date().toISOString(), userId);
    } catch (err) {
      activitySeen.delete(key);
      console.error("recordActivity", err.message || err);
    }
  }

  function scheduleRefresh(delayMs = REFRESH_DEBOUNCE_MS) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshNow().catch((err) => console.error("engagement refresh", err.message || err));
    }, delayMs);
  }

  async function refreshNow(now) {
    const db = getDb();
    if (!db) return null;
    if (refreshing) {
      scheduleRefresh(4000);
      return null;
    }
    refreshing = true;
    try {
      return await refreshScores(db, now || new Date());
    } finally {
      refreshing = false;
    }
  }

  function startPeriodicRefresh() {
    const iv = setInterval(() => {
      refreshNow().catch((err) => console.error("engagement refresh", err.message || err));
    }, REFRESH_INTERVAL_MS);
    if (typeof iv.unref === "function") iv.unref();
    return iv;
  }

  return {
    recordActivity,
    scheduleRefresh,
    refreshNow,
    startPeriodicRefresh,
    popularScore,
    followingRankTime,
    compareDiscover,
    compareGoers,
    stripScoreFields,
  };
}

module.exports = {
  createEngagement,
  refreshScores,
  popularScore,
  followingRankTime,
  followingBoostMs,
  compareDiscover,
  compareGoers,
  stripScoreFields,
  hoursAgo,
  utcDay,
  windowStartDay,
  assignBadges,
  badgePublic,
  badgeGuide,
  combinedRankScore,
  RAVER_BADGES,
  BADGE_RULES,
  WINDOW_DAYS,
  FRESH_BOOST,
  FRESH_DAYS,
  WEIGHTS,
  CAPS,
  RSVP_CAP,
  POPULAR_AUTHOR_WEIGHT,
  REPORT_HEAVY,
  BLOCK_HEAVY,
};
