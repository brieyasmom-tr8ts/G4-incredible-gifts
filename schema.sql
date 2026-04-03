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
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  birthday TEXT DEFAULT '',
  photo_data TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (attendee_id) REFERENCES attendees(id)
);

-- Run these on existing DB to add profile fields:
-- ALTER TABLE users ADD COLUMN email TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN phone TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN birthday TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN photo_data TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN show_email INTEGER DEFAULT 0;
-- ALTER TABLE users ADD COLUMN show_phone INTEGER DEFAULT 0;
-- ALTER TABLE users ADD COLUMN show_birthday INTEGER DEFAULT 0;

CREATE TABLE journey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  gift TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, gift),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  photo_data TEXT NOT NULL,
  caption TEXT DEFAULT '',
  gift_tag TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT DEFAULT 'Anonymous',
  rating INTEGER NOT NULL,
  favorite TEXT DEFAULT '',
  improve TEXT DEFAULT '',
  come_again TEXT DEFAULT '',
  other TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE video_moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  session_tag TEXT DEFAULT '',
  video_data TEXT NOT NULL,
  thumbnail_data TEXT DEFAULT '',
  duration REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
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
