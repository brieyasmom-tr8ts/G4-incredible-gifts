-- G4 Retreat Database Schema
DROP TABLE IF EXISTS attendees;
DROP TABLE IF EXISTS messages;

CREATE TABLE attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  claimed INTEGER DEFAULT 0
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  tagged_name TEXT,
  message TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES attendees(id)
);
