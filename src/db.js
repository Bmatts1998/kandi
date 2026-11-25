"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "kandi.sqlite");

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
`;

const REPLACE_CONFLICT = {
  events: { cols: ["id"], update: ["name", "city", "date_label", "venue", "genres", "emoji", "color", "is_example", "category", "ticket_url", "source_url", "source", "sources", "artists", "image_url", "starts_at", "age_limit", "status", "updated_at", "address", "ticket_seller", "time_tba", "ends_at", "event_key"] },
  app_meta: { cols: ["key"], update: ["value", "updated_at"] },
  passes: { cols: ["from_id", "to_id"], update: ["created_at"] },
  blocks: { cols: ["user_id", "blocked_id"], update: ["reason"] },
};

const SERIAL_TABLES = new Set(["users", "likes", "matches", "messages", "reports", "location_shares", "posts", "comments"]);

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

function wrapSqlite(raw) {
  return {
    driver: "sqlite",
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
    async close() {
      raw.close();
    },
  };
}

function wrapPg(pool) {
  return {
    driver: "postgres",
    prepare(sql) {
      return {
        async get(...p) {
          const text = toPgParams(translateSqlite(sql));
          const res = await pool.query(text, p);
          return convertRow(res.rows[0]);
        },
        async all(...p) {
          const text = toPgParams(translateSqlite(sql));
          const res = await pool.query(text, p);
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
          const res = await pool.query(text, p);
          const id = res.rows[0] && res.rows[0].id;
          return { lastInsertRowid: id != null ? Number(id) : 0, changes: res.rowCount || 0 };
        },
      };
    },
    async exec(sql) {
      await pool.query(sql);
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
  }
  try {
    const { backfillEventKeys } = require("./meetup");
    await backfillEventKeys(db);
  } catch (err) {
    console.error("event_key backfill failed:", err.message || err);
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
