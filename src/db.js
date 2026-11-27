"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const dbPath = process.env.KANDI_SQLITE_PATH || path.join(dataDir, "kandi.sqlite");

const SQLITE_SCHEMA = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      bio TEXT DEFAULT '',
      vibes TEXT DEFAULT '[]',
      looking TEXT DEFAULT '[]',
      prompts TEXT DEFAULT '[]',
      photos TEXT DEFAULT '[]',
      events TEXT DEFAULT '[]',
      is_demo INTEGER DEFAULT 0,
      subscription TEXT DEFAULT NULL,
      gender TEXT DEFAULT '',
      pronouns TEXT DEFAULT '',
      interested_in TEXT DEFAULT '[]',
      favorite_artists TEXT DEFAULT '',
      favorite_festival TEXT DEFAULT '',
      favorite_venue TEXT DEFAULT '',
      favorite_hangout TEXT DEFAULT '',
      kandi_trades TEXT DEFAULT '',
      rave_totem TEXT DEFAULT '',
      years_raving TEXT DEFAULT '',
      sex TEXT DEFAULT '',
      height_in INTEGER,
      hobbies TEXT DEFAULT '[]',
      favorite_tunes TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      comment TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (from_id, to_id),
      FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS passes (
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (from_id, to_id),
      FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      a_id INTEGER NOT NULL,
      b_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (a_id, b_id),
      FOREIGN KEY (a_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (b_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL,
      from_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
      FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      date_label TEXT NOT NULL,
      venue TEXT NOT NULL,
      genres TEXT DEFAULT '[]',
      emoji TEXT DEFAULT '',
      color TEXT DEFAULT '',
      is_example INTEGER DEFAULT 0,
      category TEXT DEFAULT 'concert',
      ticket_url TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      source TEXT DEFAULT '',
      sources TEXT DEFAULT '[]',
      artists TEXT DEFAULT '[]',
      image_url TEXT DEFAULT '',
      starts_at TEXT DEFAULT '',
      age_limit TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      updated_at TEXT,
      address TEXT DEFAULT '',
      ticket_seller TEXT DEFAULT '',
      time_tba INTEGER DEFAULT 0,
      ends_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS event_going (
      user_id INTEGER NOT NULL,
      event_id TEXT NOT NULL,
      PRIMARY KEY (user_id, event_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS live (
      user_id INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      meetup_spot TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS blocks (
      user_id INTEGER NOT NULL,
      blocked_id INTEGER NOT NULL,
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, blocked_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      post_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS like_days (
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS location_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      share_with TEXT NOT NULL,
      event_label TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rewind_days (
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS photo_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS setup_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      caption TEXT DEFAULT '',
      photo_id TEXT,
      event_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      video_id TEXT,
      poster_id TEXT,
      photo_ids TEXT DEFAULT '[]',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, post_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'photo',
      poster_id TEXT,
      text_overlay TEXT DEFAULT '',
      event_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS story_views (
      story_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (story_id, user_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at);

    CREATE TABLE IF NOT EXISTS crews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🧡',
      photo_id TEXT,
      bio TEXT DEFAULT '',
      home_scene TEXT DEFAULT '',
      join_mode TEXT NOT NULL DEFAULT 'request',
      created_by INTEGER NOT NULL,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS crew_members (
      crew_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (crew_id, user_id),
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS crew_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      invited_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (crew_id, user_id),
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS crew_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id INTEGER NOT NULL,
      from_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE,
      FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_crew_requests_user ON crew_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_crew_messages_crew ON crew_messages(crew_id, id);
`;

const PG_SCHEMA = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      bio TEXT DEFAULT '',
      vibes TEXT DEFAULT '[]',
      looking TEXT DEFAULT '[]',
      prompts TEXT DEFAULT '[]',
      photos TEXT DEFAULT '[]',
      events TEXT DEFAULT '[]',
      is_demo INTEGER DEFAULT 0,
      subscription TEXT DEFAULT NULL,
      gender TEXT DEFAULT '',
      pronouns TEXT DEFAULT '',
      interested_in TEXT DEFAULT '[]',
      favorite_artists TEXT DEFAULT '',
      favorite_festival TEXT DEFAULT '',
      favorite_venue TEXT DEFAULT '',
      favorite_hangout TEXT DEFAULT '',
      kandi_trades TEXT DEFAULT '',
      rave_totem TEXT DEFAULT '',
      years_raving TEXT DEFAULT '',
      sex TEXT DEFAULT '',
      height_in INTEGER,
      hobbies TEXT DEFAULT '[]',
      favorite_tunes TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      comment TEXT DEFAULT '',
      created_at TEXT DEFAULT (NOW()::text),
      UNIQUE (from_id, to_id)
    );
    CREATE TABLE IF NOT EXISTS passes (
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (from_id, to_id)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (NOW()::text),
      UNIQUE (a_id, b_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      date_label TEXT NOT NULL,
      venue TEXT NOT NULL,
      genres TEXT DEFAULT '[]',
      emoji TEXT DEFAULT '',
      color TEXT DEFAULT '',
      is_example INTEGER DEFAULT 0,
      category TEXT DEFAULT 'concert',
      ticket_url TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      source TEXT DEFAULT '',
      sources TEXT DEFAULT '[]',
      artists TEXT DEFAULT '[]',
      image_url TEXT DEFAULT '',
      starts_at TEXT DEFAULT '',
      age_limit TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      updated_at TEXT,
      address TEXT DEFAULT '',
      ticket_seller TEXT DEFAULT '',
      time_tba INTEGER DEFAULT 0,
      ends_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS event_going (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS live (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      meetup_spot TEXT,
      updated_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS blocks (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (user_id, blocked_id)
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      reporter_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text),
      post_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS like_days (
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS location_shares (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER NOT NULL,
      share_with TEXT NOT NULL,
      event_label TEXT DEFAULT '',
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS rewind_days (
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS photo_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS setup_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caption TEXT DEFAULT '',
      photo_id TEXT,
      event_id TEXT,
      created_at TEXT DEFAULT (NOW()::text),
      video_id TEXT,
      poster_id TEXT,
      photo_ids TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (follower_id, following_id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'photo',
      poster_id TEXT,
      text_overlay TEXT DEFAULT '',
      event_id TEXT,
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS story_views (
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (story_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at);

    CREATE TABLE IF NOT EXISTS crews (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🧡',
      photo_id TEXT,
      bio TEXT DEFAULT '',
      home_scene TEXT DEFAULT '',
      join_mode TEXT NOT NULL DEFAULT 'request',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE TABLE IF NOT EXISTS crew_members (
      crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (crew_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS crew_requests (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      invited_by INTEGER,
      created_at TEXT DEFAULT (NOW()::text),
      UNIQUE (crew_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS crew_messages (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text)
    );
    CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_crew_requests_user ON crew_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_crew_messages_crew ON crew_messages(crew_id, id);
`;

const REPLACE_CONFLICT = {
  events: { cols: ["id"], update: ["name", "city", "date_label", "venue", "genres", "emoji", "color", "is_example", "category", "ticket_url", "source_url", "source", "sources", "artists", "image_url", "starts_at", "age_limit", "status", "updated_at", "address", "ticket_seller", "time_tba", "ends_at", "event_key"] },
  app_meta: { cols: ["key"], update: ["value", "updated_at"] },
  passes: { cols: ["from_id", "to_id"], update: ["created_at"] },
  blocks: { cols: ["user_id", "blocked_id"], update: ["reason"] },
};

const SERIAL_TABLES = new Set(["users", "likes", "matches", "messages", "reports", "location_shares", "posts", "comments", "stories", "crews", "crew_requests", "crew_messages", "verification_requests", "referrals", "safety_checks", "safety_alerts", "safety_notifications"]);

function tableName(sql) {
  const m = String(sql).match(/\b(?:INTO|UPDATE|FROM|TABLE)\s+([a-zA-Z_][\w]*)/i);
  return m ? m[1].toLowerCase() : null;
}

function translateSqlite(sql) {
  let s = String(sql).trim();
  s = s.replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, "NOW()");
  s = s.replace(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi, (_, alias) => {
    if (alias !== alias.toLowerCase()) return `AS "${alias}"`;
    return `AS ${alias}`;
  });
  s = s.replace(/\bSELECT\s+count\s+FROM\b/gi, 'SELECT "count" FROM');
  s = s.replace(/\bSET\s+count\s*=/gi, 'SET "count" =');
  s = s.replace(/\(\s*user_id,\s*day,\s*count\s*\)/gi, "(user_id, day, \"count\")");
  const ignore = /^INSERT\s+OR\s+IGNORE\s+INTO/i.test(s);
  const replace = /^INSERT\s+OR\s+REPLACE\s+INTO/i.test(s);
  let table = null;
  if (ignore || replace) {
    const m = s.match(/^INSERT\s+OR\s+(?:IGNORE|REPLACE)\s+INTO\s+([a-zA-Z_][\w]*)/i);
    table = m && m[1].toLowerCase();
    s = s.replace(/^INSERT\s+OR\s+(?:IGNORE|REPLACE)\s+INTO/i, "INSERT INTO");
  }
  if (ignore && !/\bON CONFLICT\b/i.test(s)) s += " ON CONFLICT DO NOTHING";
  if (replace && table && !/\bON CONFLICT\b/i.test(s)) {
    const conf = REPLACE_CONFLICT[table];
    if (conf) {
      const updates = conf.update.map((c) => `${c}=EXCLUDED.${c}`).join(", ");
      s += ` ON CONFLICT (${conf.cols.join(", ")}) DO UPDATE SET ${updates}`;
    }
  }
  return s;
}

function toPgParams(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function convertValue(v) {
  if (v instanceof Date) return v.toISOString().replace("T", " ").slice(0, 19);
  return v;
}
function convertRow(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = convertValue(v);
  return out;
}

function sqliteStatements(raw) {
  return {
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        get: async (...p) => stmt.get(...p),
        all: async (...p) => stmt.all(...p),
        run: async (...p) => {
          const info = stmt.run(...p);
          return { lastInsertRowid: Number(info.lastInsertRowid), changes: Number(info.changes) };
        },
      };
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };
}

function wrapSqlite(raw) {
  const stmts = sqliteStatements(raw);
  return {
    driver: "sqlite",
    prepare: stmts.prepare,
    exec: stmts.exec,
    async transaction(fn) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const out = await fn({ driver: "sqlite", prepare: stmts.prepare, exec: stmts.exec });
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        try { raw.exec("ROLLBACK"); } catch (_) {}
        throw err;
      }
    },
    async close() {
      raw.close();
    },
  };
}

function pgStatements(queryable) {
  return {
    prepare(sql) {
      return {
        async get(...p) {
          const text = toPgParams(translateSqlite(sql));
          const res = await queryable.query(text, p);
          return convertRow(res.rows[0]);
        },
        async all(...p) {
          const text = toPgParams(translateSqlite(sql));
          const res = await queryable.query(text, p);
          return res.rows.map(convertRow);
        },
        async run(...p) {
          let translated = translateSqlite(sql);
          const table = tableName(translated);
          const isInsert = /^\s*INSERT\b/i.test(translated);
          if (isInsert && SERIAL_TABLES.has(table) && !/\bRETURNING\b/i.test(translated)) {
            translated += " RETURNING id";
          }
          const text = toPgParams(translated);
          const res = await queryable.query(text, p);
          const id = res.rows[0] && res.rows[0].id;
          return { lastInsertRowid: id != null ? Number(id) : 0, changes: res.rowCount || 0 };
        },
      };
    },
    async exec(sql) {
      await queryable.query(sql);
    },
  };
}

function wrapPg(pool) {
  const stmts = pgStatements(pool);
  return {
    driver: "postgres",
    prepare: stmts.prepare,
    exec: stmts.exec,
    async transaction(fn) {
      const client = await pool.connect();
      const tx = Object.assign({ driver: "postgres" }, pgStatements(client));
      try {
        await client.query("BEGIN");
        const out = await fn(tx);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

function makePgPool(url) {
  const { Pool } = require("pg");
  const needsSsl = /neon\.tech|sslmode=require|render\.com/i.test(url) && !/sslmode=disable/i.test(url);
  return new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 8),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 20000),
    ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
  });
}

function makeNeonServerlessPool(url) {
  const neon = require("@neondatabase/serverless");
  neon.neonConfig.webSocketConstructor = require("ws");
  return new neon.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 8) });
}


async function migrate(db) {
  const eventCols = [
    ["category", "TEXT DEFAULT 'concert'"],
    ["ticket_url", "TEXT DEFAULT ''"],
    ["source_url", "TEXT DEFAULT ''"],
    ["source", "TEXT DEFAULT ''"],
    ["sources", "TEXT DEFAULT '[]'"],
    ["artists", "TEXT DEFAULT '[]'"],
    ["image_url", "TEXT DEFAULT ''"],
    ["starts_at", "TEXT DEFAULT ''"],
    ["age_limit", "TEXT DEFAULT ''"],
    ["status", "TEXT DEFAULT 'active'"],
    ["updated_at", "TEXT"],
    ["address", "TEXT DEFAULT ''"],
    ["ticket_seller", "TEXT DEFAULT ''"],
    ["time_tba", "INTEGER DEFAULT 0"],
    ["ends_at", "TEXT DEFAULT ''"],
    ["event_key", "TEXT DEFAULT ''"],
  ];
  if (db.driver === "postgres") {
    await db.exec("ALTER TABLE users ALTER COLUMN age DROP NOT NULL");
    await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_profile INTEGER DEFAULT 0");

    const userDetailCols = [
      ["gender", "TEXT DEFAULT ''"],
      ["pronouns", "TEXT DEFAULT ''"],
      ["interested_in", "TEXT DEFAULT '[]'"],
      ["favorite_artists", "TEXT DEFAULT ''"],
      ["favorite_festival", "TEXT DEFAULT ''"],
      ["favorite_venue", "TEXT DEFAULT ''"],
      ["favorite_hangout", "TEXT DEFAULT ''"],
      ["kandi_trades", "TEXT DEFAULT ''"],
      ["rave_totem", "TEXT DEFAULT ''"],
      ["years_raving", "TEXT DEFAULT ''"],
      ["sex", "TEXT DEFAULT ''"],
      ["height_in", "INTEGER"],
      ["hobbies", "TEXT DEFAULT '[]'"],
      ["favorite_tunes", "TEXT DEFAULT '[]'"],
      ["instagram", "TEXT DEFAULT ''"],
      ["facebook", "TEXT DEFAULT ''"],
      ["spotify", "TEXT DEFAULT ''"],
      ["top_artists", "TEXT DEFAULT '[]'"],
    ];
    for (const [col, typ] of userDetailCols) {
      await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
    await db.exec("ALTER TABLE reports ADD COLUMN IF NOT EXISTS post_id INTEGER");
    await db.exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS extra_photos TEXT DEFAULT '[]'");
    for (const [col, typ] of eventCols) {
      await db.exec(`ALTER TABLE events ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
    await db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
    await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS show_upcoming INTEGER DEFAULT 1");
    await db.exec("ALTER TABLE event_going ADD COLUMN IF NOT EXISTS event_key TEXT DEFAULT ''");
    await db.exec("ALTER TABLE event_going ADD COLUMN IF NOT EXISTS open_to_meet INTEGER DEFAULT 0");
    await db.exec("ALTER TABLE event_going ADD COLUMN IF NOT EXISTS meet_note TEXT DEFAULT ''");
    await db.exec("ALTER TABLE matches ADD COLUMN IF NOT EXISTS meet_event_key TEXT DEFAULT ''");
    await db.exec("ALTER TABLE matches ADD COLUMN IF NOT EXISTS meet_spot TEXT DEFAULT ''");
    await db.exec("ALTER TABLE matches ADD COLUMN IF NOT EXISTS meet_time TEXT DEFAULT ''");
    await db.exec("ALTER TABLE events ADD COLUMN IF NOT EXISTS event_key TEXT DEFAULT ''");
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_events_event_key ON events(event_key)"); } catch (err) { console.error("idx_events_event_key:", err.message || err); }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_event_going_key ON event_going(event_key)"); } catch (err) { console.error("idx_event_going_key:", err.message || err); }
    await db.exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_id TEXT");
    await db.exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS poster_id TEXT");
    await db.exec("ALTER TABLE posts ADD COLUMN IF NOT EXISTS photo_ids TEXT DEFAULT '[]'");
    await db.exec(`CREATE TABLE IF NOT EXISTS stories (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'photo',
      poster_id TEXT,
      text_overlay TEXT DEFAULT '',
      event_id TEXT,
      created_at TEXT DEFAULT (NOW()::text)
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS story_views (
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (story_id, user_id)
    )`);
    await db.exec("CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at)");
    await db.exec(`CREATE TABLE IF NOT EXISTS crews (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🧡',
      photo_id TEXT,
      bio TEXT DEFAULT '',
      home_scene TEXT DEFAULT '',
      join_mode TEXT NOT NULL DEFAULT 'request',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (NOW()::text)
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS crew_members (
      crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT DEFAULT (NOW()::text),
      PRIMARY KEY (crew_id, user_id)
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS crew_requests (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      invited_by INTEGER,
      created_at TEXT DEFAULT (NOW()::text),
      UNIQUE (crew_id, user_id)
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS crew_messages (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text)
    )`);
    await db.exec("CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_crew_requests_user ON crew_requests(user_id)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_crew_messages_crew ON crew_messages(crew_id, id)");
  } else {
    try { await db.exec("ALTER TABLE users ADD COLUMN needs_profile INTEGER DEFAULT 0"); } catch (_) {}

    const userDetailCols = [
      ["gender", "TEXT DEFAULT ''"],
      ["pronouns", "TEXT DEFAULT ''"],
      ["interested_in", "TEXT DEFAULT '[]'"],
      ["favorite_artists", "TEXT DEFAULT ''"],
      ["favorite_festival", "TEXT DEFAULT ''"],
      ["favorite_venue", "TEXT DEFAULT ''"],
      ["favorite_hangout", "TEXT DEFAULT ''"],
      ["kandi_trades", "TEXT DEFAULT ''"],
      ["rave_totem", "TEXT DEFAULT ''"],
      ["years_raving", "TEXT DEFAULT ''"],
      ["sex", "TEXT DEFAULT ''"],
      ["height_in", "INTEGER"],
      ["hobbies", "TEXT DEFAULT '[]'"],
      ["favorite_tunes", "TEXT DEFAULT '[]'"],
      ["instagram", "TEXT DEFAULT ''"],
      ["facebook", "TEXT DEFAULT ''"],
      ["spotify", "TEXT DEFAULT ''"],
      ["top_artists", "TEXT DEFAULT '[]'"],
    ];
    for (const [col, typ] of userDetailCols) {
      try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
    try { await db.exec("ALTER TABLE reports ADD COLUMN post_id INTEGER"); } catch (_) {}
    try { await db.exec("ALTER TABLE posts ADD COLUMN extra_photos TEXT DEFAULT '[]'"); } catch (_) {}
    for (const [col, typ] of eventCols) {
      try { await db.exec(`ALTER TABLE events ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
    await db.exec("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)");
    for (const sql of [
      "ALTER TABLE users ADD COLUMN show_upcoming INTEGER DEFAULT 1",
      "ALTER TABLE event_going ADD COLUMN event_key TEXT DEFAULT ''",
      "ALTER TABLE event_going ADD COLUMN open_to_meet INTEGER DEFAULT 0",
      "ALTER TABLE event_going ADD COLUMN meet_note TEXT DEFAULT ''",
      "ALTER TABLE matches ADD COLUMN meet_event_key TEXT DEFAULT ''",
      "ALTER TABLE matches ADD COLUMN meet_spot TEXT DEFAULT ''",
      "ALTER TABLE matches ADD COLUMN meet_time TEXT DEFAULT ''",
    ]) {
      try { await db.exec(sql); } catch (_) {}
    }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_events_event_key ON events(event_key)"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_event_going_key ON event_going(event_key)"); } catch (_) {}
    for (const [col, typ] of [["video_id", "TEXT"], ["poster_id", "TEXT"], ["photo_ids", "TEXT DEFAULT '[]'"]]) {
      try { await db.exec(`ALTER TABLE posts ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
    await db.exec(`CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'photo',
      poster_id TEXT,
      text_overlay TEXT DEFAULT '',
      event_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS story_views (
      story_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (story_id, user_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, created_at)"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_stories_created ON stories(created_at)"); } catch (_) {}
    await db.exec(`CREATE TABLE IF NOT EXISTS crews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '🧡',
      photo_id TEXT,
      bio TEXT DEFAULT '',
      home_scene TEXT DEFAULT '',
      join_mode TEXT NOT NULL DEFAULT 'request',
      created_by INTEGER NOT NULL,
      is_demo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS crew_members (
      crew_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (crew_id, user_id),
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS crew_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      invited_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (crew_id, user_id),
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS crew_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id INTEGER NOT NULL,
      from_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE,
      FOREIGN KEY (from_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_crew_members_user ON crew_members(user_id)"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_crew_requests_user ON crew_requests(user_id)"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_crew_messages_crew ON crew_messages(crew_id, id)"); } catch (_) {}
  }
  const messageCols = [
    ["attach_type", "TEXT DEFAULT ''"],
    ["media_id", "TEXT DEFAULT ''"],
    ["duration", "INTEGER DEFAULT 0"],
    ["mime", "TEXT DEFAULT ''"],
    ["link_url", "TEXT DEFAULT ''"],
    ["waveform", "TEXT DEFAULT ''"],
    ["poster_id", "TEXT DEFAULT ''"],
    ["disappear", "INTEGER DEFAULT 0"],
    ["read_at", "TEXT DEFAULT ''"],
  ];
  if (db.driver === "postgres") {
    await db.exec("ALTER TABLE matches ADD COLUMN IF NOT EXISTS disappear INTEGER DEFAULT 0");
    for (const [col, typ] of messageCols) {
      await db.exec(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
    await db.exec(`CREATE TABLE IF NOT EXISTS chat_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      match_id INTEGER,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW()::text)
    )`);
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_messages_media_id ON messages(media_id)"); } catch (err) { console.error("idx_messages_media_id:", err.message || err); }
    await db.exec("ALTER TABLE photo_files ADD COLUMN IF NOT EXISTS thumb_data TEXT");
    await db.exec("ALTER TABLE photo_files ADD COLUMN IF NOT EXISTS thumb_mime TEXT");
    await db.exec("ALTER TABLE photo_files ADD COLUMN IF NOT EXISTS ready INTEGER DEFAULT 0");
    await db.exec("ALTER TABLE photo_files ADD COLUMN IF NOT EXISTS storage TEXT");
    await db.exec("ALTER TABLE photo_files ADD COLUMN IF NOT EXISTS object_key TEXT");
    await db.exec("ALTER TABLE photo_files ADD COLUMN IF NOT EXISTS thumb_key TEXT");
    await db.exec("ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS thumb_data TEXT");
    await db.exec("ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS thumb_mime TEXT");
    await db.exec("ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS storage TEXT");
    await db.exec("ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS object_key TEXT");
    await db.exec("ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS thumb_key TEXT");
  } else {
    try { await db.exec("ALTER TABLE matches ADD COLUMN disappear INTEGER DEFAULT 0"); } catch (_) {}
    for (const [col, typ] of messageCols) {
      try { await db.exec(`ALTER TABLE messages ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
    await db.exec(`CREATE TABLE IF NOT EXISTS chat_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      match_id INTEGER,
      mime TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_messages_media_id ON messages(media_id)"); } catch (_) {}
    for (const sql of [
      "ALTER TABLE photo_files ADD COLUMN thumb_data TEXT",
      "ALTER TABLE photo_files ADD COLUMN thumb_mime TEXT",
      "ALTER TABLE photo_files ADD COLUMN ready INTEGER DEFAULT 0",
      "ALTER TABLE photo_files ADD COLUMN storage TEXT",
      "ALTER TABLE photo_files ADD COLUMN object_key TEXT",
      "ALTER TABLE photo_files ADD COLUMN thumb_key TEXT",
      "ALTER TABLE chat_files ADD COLUMN thumb_data TEXT",
      "ALTER TABLE chat_files ADD COLUMN thumb_mime TEXT",
      "ALTER TABLE chat_files ADD COLUMN storage TEXT",
      "ALTER TABLE chat_files ADD COLUMN object_key TEXT",
      "ALTER TABLE chat_files ADD COLUMN thumb_key TEXT",
    ]) {
      try { await db.exec(sql); } catch (_) { /* already exists */ }
    }
  }

  try {
    const { backfillEventKeys } = require("./meetup");
    await backfillEventKeys(db);
  } catch (err) {
    console.error("event_key backfill failed:", err.message || err);
  }
  await migrateEngagement(db);
  try {
    const { migrateUserVibes } = require("./genres");
    const n = await migrateUserVibes(db);
    if (n) console.log("Migrated genre badges on " + n + " profiles.");
  } catch (err) {
    console.error("Genre vibe migration failed:", err.message || err);
  }
  await migrateBilling(db);
  await migrateFounding(db);
  await migrateEmail(db);
  await require("./follow-rules").migrateFollowRules(db);
  if (db.driver === "postgres") {
    await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_song TEXT DEFAULT ''");
  } else {
    try { await db.exec("ALTER TABLE users ADD COLUMN favorite_song TEXT DEFAULT ''"); } catch (_) {}
  }
  // "My songs" (up to 5). Each existing single favorite song moves into the first slot.
  if (db.driver === "postgres") await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS songs TEXT DEFAULT ''");
  else { try { await db.exec("ALTER TABLE users ADD COLUMN songs TEXT DEFAULT ''"); } catch (_) {} }
  try {
    const r = await db.prepare(`UPDATE users SET songs = '[' || favorite_song || ']' WHERE (songs IS NULL OR songs = '') AND favorite_song IS NOT NULL AND favorite_song <> ''`).run();
    if (r && r.changes) console.log("My songs: moved " + r.changes + " favorite songs into slot 1.");
  } catch (err) { console.error("songs migration:", err.message || err); }
  await migrateGenderValues(db);
  await require("./verification").migrateVerification(db);
  await require("./meet-intent").migrateMeetIntent(db);
  await require("./referrals").migrateReferrals(db);
  await require("./age-check").migrateAgeCheck(db);
  await require("./show-crew").migrateShowCrew(db);
  await require("./trade-routes").migrateTrades(db);
}

// man/woman -> male/female, and copy sex into gender when gender was left blank.
async function migrateGenderValues(db) {
  const steps = [
    [`UPDATE users SET gender = 'male' WHERE lower(trim(gender)) IN ('man', 'm')`, "man->male"],
    [`UPDATE users SET gender = 'female' WHERE lower(trim(gender)) IN ('woman', 'w')`, "woman->female"],
    [`UPDATE users SET gender = 'male' WHERE (gender IS NULL OR trim(gender) = '') AND lower(trim(sex)) IN ('male', 'man', 'm')`, "sex male->gender"],
    [`UPDATE users SET gender = 'female' WHERE (gender IS NULL OR trim(gender) = '') AND lower(trim(sex)) IN ('female', 'woman', 'w')`, "sex female->gender"],
    [`UPDATE users SET gender = 'intersex' WHERE (gender IS NULL OR trim(gender) = '') AND lower(trim(sex)) = 'intersex'`, "sex intersex->gender"],
  ];
  let total = 0;
  for (const [sql, label] of steps) {
    try {
      const r = await db.prepare(sql).run();
      const n = (r && r.changes) || 0;
      if (n) {
        total += n;
        console.log("Gender migrate " + label + ": " + n);
      }
    } catch (err) {
      console.error("Gender migrate " + label + ":", err.message || err);
    }
  }
  if (total) console.log("Gender labels normalized on " + total + " profiles.");
}

// Email + verification + password reset. Existing rows get email_verify_required=0,
// so accounts made before this feature are never locked out.
async function migrateEmail(db) {
  const cols = [
    ["email", "TEXT"],
    ["email_verified_at", "TEXT"],
    ["email_verify_required", "INTEGER DEFAULT 0"],
    ["email_verify_token_hash", "TEXT"],
    ["email_verify_expires_at", "TEXT"],
    ["email_verify_sent_at", "TEXT"],
    ["password_reset_token_hash", "TEXT"],
    ["password_reset_expires_at", "TEXT"],
  ];
  if (db.driver === "postgres") {
    for (const [col, typ] of cols) {
      await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
  } else {
    for (const [col, typ] of cols) {
      try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
  }
  for (const sql of [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email)) WHERE email IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_users_email_verify_token ON users (email_verify_token_hash) WHERE email_verify_token_hash IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users (password_reset_token_hash) WHERE password_reset_token_hash IS NOT NULL",
  ]) {
    try { await db.exec(sql); } catch (err) { console.error("email index:", err.message || err); }
  }
}

async function migrateFounding(db) {
  const cols = [
    ["date_of_birth", "TEXT"],
    ["home_location", "TEXT"],
    ["is_founder", "INTEGER DEFAULT 0"],
    ["founding_number", "INTEGER"],
    ["plus_until", "TEXT"],
  ];
  const meta = `CREATE TABLE IF NOT EXISTS founding_meta (
      id INTEGER PRIMARY KEY,
      claimed INTEGER NOT NULL DEFAULT 0,
      cap INTEGER NOT NULL DEFAULT 3000
    )`;
  if (db.driver === "postgres") {
    for (const [col, typ] of cols) {
      await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
    await db.exec(meta);
    try { await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_founding_number ON users(founding_number) WHERE founding_number IS NOT NULL"); } catch (err) { console.error("idx_users_founding_number:", err.message || err); }
  } else {
    for (const [col, typ] of cols) {
      try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
    await db.exec(meta);
    try { await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_founding_number ON users(founding_number)"); } catch (_) {}
  }
  const row = await db.prepare(`SELECT id FROM founding_meta WHERE id=1`).get();
  if (!row) await db.prepare(`INSERT INTO founding_meta (id, claimed, cap) VALUES (1, 0, 3000)`).run();
}

async function migrateBilling(db) {
  const cols = [
    ["stripe_customer_id", "TEXT"],
    ["stripe_subscription_id", "TEXT"],
    ["stripe_price_id", "TEXT"],
    ["subscription_status", "TEXT"],
  ];
  if (db.driver === "postgres") {
    for (const [col, typ] of cols) {
      await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)"); } catch (err) { console.error("idx_users_stripe_customer:", err.message || err); }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id)"); } catch (err) { console.error("idx_users_stripe_subscription:", err.message || err); }
  } else {
    for (const [col, typ] of cols) {
      try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id)"); } catch (_) {}
  }
}

async function migrateEngagement(db) {
  const userCols = [
    ["engagement_score", "DOUBLE PRECISION DEFAULT 0"],
    ["engagement_hidden", "INTEGER DEFAULT 0"],
    ["engagement_updated_at", "TEXT"],
    ["last_active_at", "TEXT"],
    ["active_raver", "INTEGER DEFAULT 0"],
    ["raver_badge", "TEXT DEFAULT ''"],
  ];
  const sqliteUserCols = [
    ["engagement_score", "REAL DEFAULT 0"],
    ["engagement_hidden", "INTEGER DEFAULT 0"],
    ["engagement_updated_at", "TEXT"],
    ["last_active_at", "TEXT"],
    ["active_raver", "INTEGER DEFAULT 0"],
    ["raver_badge", "TEXT DEFAULT ''"],
  ];
  if (db.driver === "postgres") {
    for (const [col, typ] of userCols) {
      await db.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col} ${typ}`);
    }
    await db.exec("ALTER TABLE event_going ADD COLUMN IF NOT EXISTS created_at TEXT DEFAULT (NOW()::text)");
    await db.exec(`CREATE TABLE IF NOT EXISTS user_activity_days (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      PRIMARY KEY (user_id, day)
    )`);
    await db.exec("CREATE INDEX IF NOT EXISTS idx_users_engagement ON users(engagement_score DESC)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_post_likes_created ON post_likes(created_at)");
    await db.exec("CREATE INDEX IF NOT EXISTS idx_comments_user_created ON comments(user_id, created_at)");
  } else {
    for (const [col, typ] of sqliteUserCols) {
      try { await db.exec(`ALTER TABLE users ADD COLUMN ${col} ${typ}`); } catch (_) {}
    }
    try { await db.exec("ALTER TABLE event_going ADD COLUMN created_at TEXT DEFAULT (datetime('now'))"); } catch (_) {}
    await db.exec(`CREATE TABLE IF NOT EXISTS user_activity_days (
      user_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      PRIMARY KEY (user_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_users_engagement ON users(engagement_score DESC)"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_post_likes_created ON post_likes(created_at)"); } catch (_) {}
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_comments_user_created ON comments(user_id, created_at)"); } catch (_) {}
  }
}

async function openPostgres(url) {
  const force = String(process.env.PG_DRIVER || "").toLowerCase();
  const tryTcp = force !== "neon-serverless";
  const tryWs = force !== "pg";
  let lastErr;
  if (tryTcp) {
    const pool = makePgPool(url);
    const db = wrapPg(pool);
    try {
      await db.exec("SELECT 1");
      await db.exec(PG_SCHEMA);
      await migrate(db);
      console.log("Database: Postgres via TCP (pg)");
      return db;
    } catch (err) {
      lastErr = err;
      try { await db.close(); } catch (_) {}
      if (!tryWs) throw err;
      console.log("Postgres TCP not reachable from this machine (" + (err.message || err.code || "error") + "); using Neon serverless (WebSocket) instead.");
    }
  }
  if (tryWs) {
    const db = wrapPg(makeNeonServerlessPool(url));
    await db.exec(PG_SCHEMA);
    await migrate(db);
    console.log("Database: Postgres via Neon serverless");
    return db;
  }
  throw lastErr || new Error("No Postgres driver available");
}

async function open() {
  const url = process.env.DATABASE_URL;
  if (url) {
    return openPostgres(url);
  }
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(dataDir, { recursive: true });
  const raw = new DatabaseSync(dbPath);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SQLITE_SCHEMA);
  const db = wrapSqlite(raw);
  await migrate(db);
  return db;
}

module.exports = { open, dbPath };
