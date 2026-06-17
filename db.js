const path = require("path");

// Use PostgreSQL in production, SQLite locally
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      skills TEXT DEFAULT '[]',
      availability TEXT DEFAULT 'side project',
      location TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id),
      skills_needed TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      max_members INTEGER DEFAULT 4,
      likes INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS idea_likes (
      user_id INTEGER NOT NULL,
      idea_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, idea_id)
    );
    CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      idea_id INTEGER NOT NULL REFERENCES ideas(id),
      name TEXT NOT NULL,
      stage TEXT DEFAULT 'Idea',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES groups(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      id SERIAL PRIMARY KEY,
      idea_id INTEGER NOT NULL REFERENCES ideas(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `).catch(console.error);

  module.exports = {
    isPg: true,
    query: (sql, params) => pool.query(sql.replace(/\?/g, (_, i) => `$${++i}`), params),
    pool,
  };
} else {
  const Database = require("better-sqlite3");
  const db = new Database(path.join(__dirname, "styabu.db"));

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      skills TEXT DEFAULT '[]',
      availability TEXT DEFAULT 'side project',
      location TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      skills_needed TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      max_members INTEGER DEFAULT 4,
      likes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS idea_likes (
      user_id INTEGER NOT NULL,
      idea_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, idea_id)
    );
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      stage TEXT DEFAULT 'Idea',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idea_id) REFERENCES ideas(id)
    );
    CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (idea_id) REFERENCES ideas(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Wrap SQLite to match async pg interface
  module.exports = {
    isPg: false,
    query: async (sql, params = []) => {
      // Convert $1, $2 placeholders back to ? for SQLite
      const sqliteSql = sql.replace(/\$\d+/g, "?");
      if (/^\s*(select|pragma)/i.test(sqliteSql)) {
        return { rows: db.prepare(sqliteSql).all(...params) };
      }
      const result = db.prepare(sqliteSql).run(...params);
      return { rows: [{ id: result.lastInsertRowid }], rowCount: result.changes };
    },
  };
}
