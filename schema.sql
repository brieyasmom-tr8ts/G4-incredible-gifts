-- G4 Retreat Database Schema
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS attendees;

CREATE TABLE attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_initial TEXT DEFAULT '',
  attendee_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id)
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('prayer', 'encouragement')),
  tagged_name TEXT,
  message TEXT NOT NULL,
  prayer_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
