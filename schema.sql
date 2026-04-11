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
-- ALTER TABLE users ADD COLUMN instagram TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN facebook TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN show_about INTEGER DEFAULT 0;
-- ALTER TABLE users ADD COLUMN location TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN job TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN church TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN retreat_years TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN about TEXT DEFAULT '';
-- ALTER TABLE users ADD COLUMN last_name TEXT DEFAULT '';

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

CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('open', 'multiple_choice')),
  options TEXT DEFAULT '',
  active INTEGER DEFAULT 0,
  show_responses INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE poll_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(poll_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(id),
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

CREATE TABLE game_settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE fun_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  fact TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE packing_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  user_name TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE wyr_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  active INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE wyr_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  choice TEXT NOT NULL CHECK(choice IN ('A', 'B')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, question_id)
);

CREATE TABLE secret_sister (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giver_id INTEGER NOT NULL UNIQUE,
  receiver_id INTEGER NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE meme_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_data TEXT NOT NULL,
  title TEXT DEFAULT '',
  active INTEGER DEFAULT 0,
  voting_open INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE meme_captions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  user_name TEXT NOT NULL,
  caption TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(round_id, user_id),
  FOREIGN KEY (round_id) REFERENCES meme_rounds(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE meme_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  caption_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, caption_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (caption_id) REFERENCES meme_captions(id)
);

CREATE TABLE theme_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT DEFAULT 'Anonymous',
  suggestion TEXT NOT NULL,
  admin_starred INTEGER DEFAULT 0,
  admin_tags TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE celebration_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_user_id INTEGER NOT NULL,
  sender_user_id INTEGER,
  sender_name TEXT DEFAULT 'A G4 sister',
  sender_anonymous INTEGER DEFAULT 0,
  occasion TEXT NOT NULL,
  occasion_date TEXT NOT NULL,
  message_text TEXT DEFAULT '',
  has_heart INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (recipient_user_id) REFERENCES users(id),
  FOREIGN KEY (sender_user_id) REFERENCES users(id)
);

CREATE TABLE testimonies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT DEFAULT 'A G4 sister',
  anonymous INTEGER DEFAULT 0,
  kind TEXT DEFAULT 'text',
  text TEXT DEFAULT '',
  video_key TEXT DEFAULT '',
  gift_tag TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  featured INTEGER DEFAULT 0,
  heart_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE testimony_hearts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  testimony_id INTEGER NOT NULL,
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(testimony_id, user_id),
  FOREIGN KEY (testimony_id) REFERENCES testimonies(id)
);

-- Journal usage tracking — metadata only, never content. Each row is
-- a "she saved an entry" marker so admin can see adoption without
-- ever reading what women wrote in their private journals.
CREATE TABLE journal_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  name TEXT DEFAULT '',
  gift_tag TEXT DEFAULT '',
  char_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Reactions on moments photos (heart, laugh, thumbs). One of each
-- emoji per user per moment (UNIQUE prevents spam).
CREATE TABLE moment_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER NOT NULL,
  user_id INTEGER,
  emoji TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(moment_id, user_id, emoji),
  FOREIGN KEY (moment_id) REFERENCES moments(id)
);

-- Comments on moments photos. No threading — flat list.
CREATE TABLE moment_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER NOT NULL,
  user_id INTEGER,
  name TEXT DEFAULT 'A G4 sister',
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (moment_id) REFERENCES moments(id)
);
