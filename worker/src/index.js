// G4 Retreat API Worker
// Blocked words filter
const BLOCKED_WORDS = [
  'damn', 'hell', 'shit', 'fuck', 'ass', 'bitch', 'crap',
  'bastard', 'dick', 'piss', 'slut', 'whore'
];

function containsBlockedWords(text) {
  const lower = text.toLowerCase();
  return BLOCKED_WORDS.some(w => lower.includes(w));
}

// Allowed MIME types for uploads
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];

function isAllowedVideoType(type) {
  if (!type) return true; // fallback to default
  return ALLOWED_VIDEO_TYPES.some(t => type.toLowerCase().startsWith(t));
}

function isAllowedImageType(type) {
  if (!type) return true;
  return ALLOWED_IMAGE_TYPES.some(t => type.toLowerCase().startsWith(t));
}

// ===== WEEKLY SECRET SISTER =====
// The retreat-time secret_sister table handles the one-time weekend game.
// secret_sister_pairings is the post-retreat weekly rotation: every
// Wednesday at 5am EDT a new round of pairings is created lazily on the
// first request that asks for it. No cron needed — the round number is
// derived from an anchor date and pairings are generated on demand.
//
// Wednesday April 15 2026 5:00am EDT = 9:00am UTC. First round starts here.
const SS_ANCHOR_UTC_MS = Date.UTC(2026, 3, 15, 9, 0, 0); // month 3 = April
const SS_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SS_DELIVERY_DELAY_SQL = "'-1 hours'"; // SQLite modifier for the delay

function getCurrentSSRound() {
  const now = Date.now();
  if (now < SS_ANCHOR_UTC_MS) return 0;
  return Math.floor((now - SS_ANCHOR_UTC_MS) / SS_WEEK_MS) + 1;
}

async function ensureWeeklySSTable(db) {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS secret_sister_pairings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_number INTEGER NOT NULL,
      giver_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      giver_name TEXT DEFAULT '',
      receiver_name TEXT DEFAULT '',
      note TEXT DEFAULT '',
      written_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(round_number, giver_id)
    )`).run();
  } catch (e) { /* already exists */ }
  // Round-creation lock table so two concurrent requests don't both try
  // to generate pairings for the same round with different shuffles.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS secret_sister_round_locks (
      round_number INTEGER PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
  } catch (e) { /* already exists */ }
  // Admin-sent anonymous notes. No sender_id stored — truly anonymous to
  // both the recipient AND the server audit trail. Admin can send these
  // to women who've been overlooked by the random weekly rotation.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS secret_sister_admin_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_number INTEGER NOT NULL,
      recipient_user_id INTEGER NOT NULL,
      recipient_name TEXT DEFAULT '',
      note TEXT NOT NULL,
      written_at TEXT DEFAULT (datetime('now'))
    )`).run();
  } catch (e) { /* already exists */ }
  // Lazy column: per-user opt-out from the weekly rotation.
  try {
    await db.prepare('ALTER TABLE users ADD COLUMN secret_sister_opt_out INTEGER DEFAULT 0').run();
  } catch (e) { /* already exists */ }
}

async function ensureSSRoundExists(db, roundNumber) {
  if (roundNumber <= 0) return false;
  // Claim the lock — only the winning request generates pairings. Other
  // concurrent callers hit UNIQUE(round_number) on the lock table and bail
  // out, then read the pairings the winner created.
  try {
    await db.prepare('INSERT INTO secret_sister_round_locks (round_number) VALUES (?)').bind(roundNumber).run();
  } catch (e) {
    // Lock already claimed — someone else is generating, or already did.
    return true;
  }
  // We won the lock. Fetch eligible users (opted in, have a real profile).
  const { results: users } = await db.prepare(
    `SELECT id, first_name, COALESCE(last_initial, '') AS last_initial
     FROM users
     WHERE COALESCE(secret_sister_opt_out, 0) = 0
       AND first_name IS NOT NULL AND first_name != ''
     ORDER BY id`
  ).all();
  if (!users || users.length < 2) return false;
  // Shuffle
  const shuffled = [...users];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Cyclic pairings: giver[i] → receiver[(i+1) % n]. Guarantees no
  // self-pairings and gives every woman exactly one giver and one receiver.
  for (let i = 0; i < shuffled.length; i++) {
    const giver = shuffled[i];
    const receiver = shuffled[(i + 1) % shuffled.length];
    const giverName = giver.last_initial ? `${giver.first_name} ${giver.last_initial}.` : giver.first_name;
    const receiverName = receiver.last_initial ? `${receiver.first_name} ${receiver.last_initial}.` : receiver.first_name;
    try {
      await db.prepare(
        'INSERT INTO secret_sister_pairings (round_number, giver_id, receiver_id, giver_name, receiver_name) VALUES (?, ?, ?, ?, ?)'
      ).bind(roundNumber, giver.id, receiver.id, giverName, receiverName).run();
    } catch (e) { /* concurrent insert lost race, ignore */ }
  }
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const origin = request.headers.get('Origin') || '';
    const ALLOWED_ORIGINS = [
      'https://g4retreatapp.org',
      'https://www.g4retreatapp.org',
      'http://g4retreatapp.org',
      'http://www.g4retreatapp.org',
      'http://localhost:8080',
      'http://127.0.0.1:8080'
    ];
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const corsHeaders = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    };

    // Security headers added to every response
    const securityHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Admin auth check — validates X-Admin-Key header against the
    // ADMIN_KEY environment secret (set in Cloudflare dashboard).
    // Falls back to a hardcoded default only if the secret isn't configured.
    function isAdmin(req) {
      const key = req.headers.get('X-Admin-Key') || '';
      const expected = env.ADMIN_KEY || 'g4p@ssw0rd';
      return key.length > 0 && key === expected;
    }

    function requireAdmin(req) {
      if (!isAdmin(req)) {
        return json({ error: 'Unauthorized' }, corsHeaders, 401);
      }
      return null; // auth passed
    }

    // Rate limiter — uses a simple sliding window per IP+action.
    // Stores counts in a global Map that resets each worker invocation
    // (adequate for Cloudflare Workers' per-request isolation).
    // For persistent rate limiting, Cloudflare Rate Limiting rules
    // should be configured in the dashboard.

    try {
      // ===== DB MIGRATION (one-time) =====
      if (path === '/api/admin/migrate' && request.method === 'POST') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        const cols = [
          ['last_name', 'TEXT DEFAULT ""'],
          ['show_email', 'INTEGER DEFAULT 0'],
          ['show_phone', 'INTEGER DEFAULT 0'],
          ['show_birthday', 'INTEGER DEFAULT 0'],
          ['show_about', 'INTEGER DEFAULT 0'],
          ['instagram', 'TEXT DEFAULT ""'],
          ['facebook', 'TEXT DEFAULT ""'],
          ['location', 'TEXT DEFAULT ""'],
          ['job', 'TEXT DEFAULT ""'],
          ['church', 'TEXT DEFAULT ""'],
          ['retreat_years', 'TEXT DEFAULT ""'],
          ['about', 'TEXT DEFAULT ""'],
        ];
        const added = [];
        for (const [col, type] of cols) {
          try {
            await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run();
            added.push(col);
          } catch(e) { /* already exists */ }
        }
        // Create game tables if they don't exist
        const gameTables = [
          `CREATE TABLE IF NOT EXISTS game_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
          )`,
          `CREATE TABLE IF NOT EXISTS fun_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            author_name TEXT NOT NULL,
            fact TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          `CREATE TABLE IF NOT EXISTS packing_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            user_name TEXT DEFAULT '',
            author_name TEXT DEFAULT '',
            score INTEGER NOT NULL,
            answers TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          `CREATE TABLE IF NOT EXISTS wyr_questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            option_a TEXT NOT NULL,
            option_b TEXT NOT NULL,
            active INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          `CREATE TABLE IF NOT EXISTS wyr_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            choice TEXT NOT NULL CHECK(choice IN ('A', 'B')),
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, question_id)
          )`,
          `CREATE TABLE IF NOT EXISTS secret_sister (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            giver_id INTEGER NOT NULL UNIQUE,
            receiver_id INTEGER NOT NULL,
            note TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
          )`,
          `CREATE TABLE IF NOT EXISTS announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT DEFAULT '',
            active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
          )`
        ];
        const tablesCreated = [];
        for (const sql of gameTables) {
          try {
            await env.DB.prepare(sql).run();
            tablesCreated.push(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1]);
          } catch(e) { /* already exists */ }
        }

        // Add show_responses column to polls if missing
        try { await env.DB.prepare('ALTER TABLE polls ADD COLUMN show_responses INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }

        // Add is_team column to users if missing
        try { await env.DB.prepare('ALTER TABLE users ADD COLUMN is_team INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        // Add is_speaker column to users if missing
        try { await env.DB.prepare('ALTER TABLE users ADD COLUMN is_speaker INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        // Add is_worship column to users if missing
        try { await env.DB.prepare('ALTER TABLE users ADD COLUMN is_worship INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }

        return json({ success: true, columns_added: added, tables_ensured: tablesCreated, message: added.length ? 'Added missing columns' : 'All columns already exist' }, corsHeaders);
      }

      // GET /api/admin/debug-user/:id — see raw DB values for a user
      const debugUserMatch = path.match(/^\/api\/admin\/debug-user\/(\d+)$/);
      if (debugUserMatch && request.method === 'GET') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        const userId = parseInt(debugUserMatch[1]);
        const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
        return json(user || { error: 'not found' }, corsHeaders);
      }

      // GET /api/admin/stats — usage stats for admin dashboard
      if (path === '/api/admin/stats' && request.method === 'GET') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        try {
          const [
            usersTotal, usersWithPhoto, usersWithProfile,
            messagesTotal, messagesPrayer, messagesEncouragement,
            momentsTotal, momentsUnique,
            journalTotal, journalUnique,
            huntSubs, huntVotes, huntUnique,
            pollResponses,
            wyrVotes,
            memeCaptions, memeVotes,
            feedbackTotal,
            videosTotal
          ] = await Promise.all([
            env.DB.prepare('SELECT COUNT(*) as c FROM users').first('c').catch(() => 0),
            env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE photo_data IS NOT NULL AND photo_data != ''").first('c').catch(() => 0),
            env.DB.prepare("SELECT COUNT(*) as c FROM users WHERE (email IS NOT NULL AND email != '') OR (phone IS NOT NULL AND phone != '') OR (about IS NOT NULL AND about != '')").first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM messages').first('c').catch(() => 0),
            env.DB.prepare("SELECT COUNT(*) as c FROM messages WHERE type='prayer'").first('c').catch(() => 0),
            env.DB.prepare("SELECT COUNT(*) as c FROM messages WHERE type='encouragement'").first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM moments').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(DISTINCT user_id) as c FROM moments').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM journal_activity').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(DISTINCT user_id) as c FROM journal_activity').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM hunt_submissions').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM hunt_votes').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(DISTINCT user_id) as c FROM hunt_submissions').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM poll_responses').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM wyr_votes').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM meme_captions').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM meme_votes').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM feedback').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(*) as c FROM videos').first('c').catch(() => 0),
          ]);

          // Top contributors: users with most activity (only reference guaranteed tables)
          const topUsers = await env.DB.prepare(`
            SELECT u.id, u.first_name, u.last_initial,
              (SELECT COUNT(*) FROM moments WHERE user_id = u.id) as moments,
              (SELECT COUNT(*) FROM messages WHERE user_id = u.id) as messages
            FROM users u
            ORDER BY (
              (SELECT COUNT(*) FROM moments WHERE user_id = u.id) +
              (SELECT COUNT(*) FROM messages WHERE user_id = u.id)
            ) DESC
            LIMIT 15
          `).all().then(r => r.results).catch(() => []);

          return json({
            users: { total: usersTotal, withPhoto: usersWithPhoto, withProfile: usersWithProfile },
            messages: { total: messagesTotal, prayer: messagesPrayer, encouragement: messagesEncouragement },
            moments: { total: momentsTotal, uniqueUsers: momentsUnique },
            journal: { total: journalTotal || 0, uniqueUsers: journalUnique || 0 },
            hunt: { submissions: huntSubs || 0, votes: huntVotes || 0, uniqueUsers: huntUnique || 0 },
            polls: { responses: pollResponses || 0 },
            wyr: { votes: wyrVotes || 0 },
            meme: { captions: memeCaptions || 0, votes: memeVotes || 0 },
            feedback: { total: feedbackTotal || 0 },
            videos: { total: videosTotal || 0 },
            topUsers
          }, corsHeaders);
        } catch(e) {
          return json({ error: e.message }, corsHeaders, 500);
        }
      }

      // GET /api/admin/debug-schema — show table columns
      if (path === '/api/admin/debug-schema' && request.method === 'GET') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        const { results } = await env.DB.prepare("PRAGMA table_info(users)").all();
        return json(results, corsHeaders);
      }

      // GET /api/churches — list unique church names currently in use
      // with attendee counts. Publicly readable so the profile datalist
      // can suggest existing churches.
      if (path === '/api/churches' && request.method === 'GET') {
        try {
          const { results } = await env.DB.prepare(
            "SELECT TRIM(church) as name, COUNT(*) as count FROM users WHERE church IS NOT NULL AND TRIM(church) != '' GROUP BY LOWER(TRIM(church)) ORDER BY TRIM(church) ASC"
          ).all();
          return json(results || [], corsHeaders);
        } catch (e) {
          return json([], corsHeaders);
        }
      }

      // POST /api/admin/churches/rename — bulk-rename/merge the church
      // field across all users. Body: { from: "old", to: "new" }. Matches
      // case-insensitively and trims whitespace on the stored value.
      // Passing an empty `to` clears the church on matching users.
      if (path === '/api/admin/churches/rename' && request.method === 'POST') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        try {
          const body = await request.json();
          const from = (body.from || '').trim();
          const to = (body.to || '').trim();
          if (!from) return json({ error: '"from" is required' }, corsHeaders, 400);
          const result = await env.DB.prepare(
            "UPDATE users SET church = ? WHERE LOWER(TRIM(COALESCE(church, ''))) = ?"
          ).bind(to, from.toLowerCase()).run();
          const changes = (result && result.meta && typeof result.meta.changes === 'number') ? result.meta.changes : 0;
          return json({ success: true, changes }, corsHeaders);
        } catch (e) {
          return json({ error: e.message || String(e) }, corsHeaders, 500);
        }
      }

      // POST /api/admin/debug-update/:id — test direct update of show_about
      const debugUpdateMatch = path.match(/^\/api\/admin\/debug-update\/(\d+)$/);
      if (debugUpdateMatch && request.method === 'POST') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        const userId = parseInt(debugUpdateMatch[1]);
        const body = await request.json();
        try {
          await env.DB.prepare(
            'UPDATE users SET show_about = ?, location = ?, job = ?, church = ? WHERE id = ?'
          ).bind(body.show_about || 1, body.location || 'test', body.job || 'test', body.church || 'test', userId).run();
          const after = await env.DB.prepare('SELECT show_about, location, job, church FROM users WHERE id = ?').bind(userId).first();
          return json({ success: true, after }, corsHeaders);
        } catch(e) {
          return json({ error: e.message }, corsHeaders, 500);
        }
      }

      // ===== ATTENDEES =====

      // GET /api/attendees - list all attendee names (for tagging)
      if (path === '/api/attendees' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, first_name, last_name FROM attendees ORDER BY first_name, last_name'
        ).all();
        return json(results, corsHeaders);
      }

      // ===== USERS (simple setup) =====

      // POST /api/users - create or retrieve user
      if (path === '/api/users' && request.method === 'POST') {
        const { first_name, last_initial, last_name, attendee_id } = await request.json();

        if (!first_name || !first_name.trim()) {
          return json({ error: 'First name is required' }, corsHeaders, 400);
        }

        const rawName = first_name.trim();
        // Capitalize first letter, lowercase rest for consistent matching
        const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
        const cleanLastName = (last_name || '').trim();
        const cleanInitial = cleanLastName ? cleanLastName.charAt(0).toUpperCase() : (last_initial || '').trim().charAt(0).toUpperCase();
        const displayName = cleanInitial ? `${cleanName} ${cleanInitial}.` : cleanName;

        // Check for existing user — case-insensitive match
        const existing = await env.DB.prepare(
          'SELECT id, first_name, last_initial, last_name FROM users WHERE LOWER(first_name) = LOWER(?) AND UPPER(last_initial) = UPPER(?)'
        ).bind(cleanName, cleanInitial).first();

        if (existing) {
          // Update last_name if provided and missing
          if (cleanLastName && !existing.last_name) {
            await env.DB.prepare('UPDATE users SET last_name = ? WHERE id = ?').bind(cleanLastName, existing.id).run();
          }
          return json({
            id: existing.id,
            first_name: existing.first_name,
            last_initial: existing.last_initial,
            display_name: existing.last_initial ? `${existing.first_name} ${existing.last_initial}.` : existing.first_name,
            returning: true
          }, corsHeaders);
        }

        const result = await env.DB.prepare(
          'INSERT INTO users (first_name, last_initial, last_name, attendee_id) VALUES (?, ?, ?, ?)'
        ).bind(cleanName, cleanInitial, cleanLastName, attendee_id || null).run();

        const userId = result.meta.last_row_id;

        return json({
          id: userId,
          first_name: cleanName,
          last_initial: cleanInitial,
          display_name: displayName
        }, corsHeaders);
      }

      // GET /api/users - list all users (admin)
      if (path === '/api/users' && request.method === 'GET') {
        let results;
        try {
          ({ results } = await env.DB.prepare(
            'SELECT id, first_name, last_initial, last_name, email, phone, birthday, instagram, facebook, is_team, is_speaker, is_worship, created_at FROM users ORDER BY created_at DESC'
          ).all());
        } catch (e) {
          try {
            ({ results } = await env.DB.prepare(
              'SELECT id, first_name, last_initial, last_name, email, phone, birthday, instagram, facebook, is_team, is_speaker, created_at FROM users ORDER BY created_at DESC'
            ).all());
          } catch (e2) {
            ({ results } = await env.DB.prepare(
              'SELECT id, first_name, last_initial, last_name, email, phone, birthday, instagram, facebook, created_at FROM users ORDER BY created_at DESC'
            ).all());
          }
        }
        return json(results, corsHeaders);
      }

      // GET /api/users/directory - public directory (only shared fields)
      if (path === '/api/users/directory' && request.method === 'GET') {
        let results;
        try {
          ({ results } = await env.DB.prepare(
            `SELECT u.id, u.first_name, u.last_initial, u.last_name, u.photo_data, u.email, u.phone, u.birthday,
                    u.show_email, u.show_phone, u.show_birthday, u.show_about,
                    u.instagram, u.facebook, u.location, u.job, u.church, u.retreat_years, u.about,
                    p.score as packing_score
             FROM users u LEFT JOIN packing_scores p ON u.id = p.user_id
             ORDER BY u.first_name ASC`
          ).all());
        } catch (e) {
          ({ results } = await env.DB.prepare(
            'SELECT id, first_name, last_initial, photo_data, email, phone, birthday, show_email, show_phone, show_birthday, show_about, instagram, facebook, location, job, church, retreat_years, about FROM users ORDER BY first_name ASC'
          ).all());
        }
        // Add is_team, is_speaker, is_worship safely
        try {
          let flagRows;
          try {
            ({ results: flagRows } = await env.DB.prepare('SELECT id, is_team, is_speaker, is_worship FROM users').all());
          } catch (e) {
            ({ results: flagRows } = await env.DB.prepare('SELECT id, is_team, is_speaker FROM users').all());
          }
          const teamIds = new Set(flagRows.filter(r => r.is_team).map(r => r.id));
          const speakerIds = new Set(flagRows.filter(r => r.is_speaker).map(r => r.id));
          const worshipIds = new Set(flagRows.filter(r => r.is_worship).map(r => r.id));
          for (const u of results) {
            u.is_team = teamIds.has(u.id) ? 1 : 0;
            u.is_speaker = speakerIds.has(u.id) ? 1 : 0;
            u.is_worship = worshipIds.has(u.id) ? 1 : 0;
          }
        } catch (e) { /* columns don't exist yet */ }
        const directory = results.map(u => ({
          id: u.id,
          first_name: u.first_name,
          last_initial: u.last_initial || '',
          last_name: u.last_name || '',
          photo_data: u.photo_data || '',
          email: u.show_email ? (u.email || '') : '',
          phone: u.show_phone ? (u.phone || '') : '',
          birthday: u.show_birthday ? (u.birthday || '') : '',
          instagram: u.instagram || '',
          facebook: u.facebook || '',
          location: u.show_about ? (u.location || '') : '',
          job: u.show_about ? (u.job || '') : '',
          church: u.show_about ? (u.church || '') : '',
          retreat_years: u.show_about ? (u.retreat_years || '') : '',
          about: u.show_about ? (u.about || '') : '',
          packing_score: u.packing_score != null ? u.packing_score : null,
          is_team: u.is_team ? 1 : 0,
          is_speaker: u.is_speaker ? 1 : 0,
          is_worship: u.is_worship ? 1 : 0
        }));
        return json(directory, corsHeaders);
      }

      // GET /api/users/:id - get user profile (public view — respects visibility)
      const userGetMatch = path.match(/^\/api\/users\/(\d+)$/);
      if (userGetMatch && request.method === 'GET') {
        const userId = parseInt(userGetMatch[1]);
        // Lazy migration so anniversary + weekly SS opt-out columns exist before we SELECT them.
        for (const col of [
          ['anniversary', 'TEXT DEFAULT ""'],
          ['show_anniversary', 'INTEGER DEFAULT 0'],
          ['secret_sister_opt_out', 'INTEGER DEFAULT 0']
        ]) {
          try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col[0]} ${col[1]}`).run(); } catch(e) { /* exists */ }
        }
        let user;
        try {
          user = await env.DB.prepare(
            'SELECT id, first_name, last_initial, last_name, email, phone, birthday, anniversary, show_anniversary, photo_data, show_email, show_phone, show_birthday, show_about, instagram, facebook, location, job, church, retreat_years, about, is_team, is_speaker, secret_sister_opt_out, created_at FROM users WHERE id = ?'
          ).bind(userId).first();
        } catch (e) {
          user = await env.DB.prepare(
            'SELECT id, first_name, last_initial, email, phone, birthday, anniversary, show_anniversary, photo_data, show_email, show_phone, show_birthday, show_about, instagram, facebook, location, job, church, retreat_years, about, created_at FROM users WHERE id = ?'
          ).bind(userId).first();
        }
        if (!user) return json({ error: 'User not found' }, corsHeaders, 404);

        // Return public profile — only show fields user opted in
        const isOwner = url.searchParams.get('owner') === '1';
        return json({
          id: user.id,
          first_name: user.first_name,
          last_initial: user.last_initial,
          last_name: user.last_name || '',
          photo_data: user.photo_data || '',
          email: (isOwner || user.show_email) ? user.email : '',
          phone: (isOwner || user.show_phone) ? user.phone : '',
          birthday: (isOwner || user.show_birthday) ? user.birthday : '',
          anniversary: (isOwner || user.show_anniversary) ? (user.anniversary || '') : '',
          show_email: user.show_email || 0,
          show_phone: user.show_phone || 0,
          show_birthday: user.show_birthday || 0,
          show_anniversary: user.show_anniversary || 0,
          instagram: user.instagram || '',
          facebook: user.facebook || '',
          show_about: user.show_about || 0,
          location: (isOwner || user.show_about) ? (user.location || '') : '',
          job: (isOwner || user.show_about) ? (user.job || '') : '',
          church: (isOwner || user.show_about) ? (user.church || '') : '',
          retreat_years: (isOwner || user.show_about) ? (user.retreat_years || '') : '',
          about: (isOwner || user.show_about) ? (user.about || '') : '',
          is_team: user.is_team || 0,
          is_speaker: user.is_speaker || 0,
          secret_sister_opt_out: user.secret_sister_opt_out || 0,
          created_at: user.created_at
        }, corsHeaders);
      }

      // POST /api/users/:id/profile - update profile
      const profileMatch = path.match(/^\/api\/users\/(\d+)\/profile$/);
      if (profileMatch && request.method === 'POST') {
        const userId = parseInt(profileMatch[1]);
        const body = await request.json();

        // Lazy migration: ensure anniversary + weekly SS opt-out columns exist
        for (const col of [
          ['anniversary', 'TEXT DEFAULT ""'],
          ['show_anniversary', 'INTEGER DEFAULT 0'],
          ['secret_sister_opt_out', 'INTEGER DEFAULT 0']
        ]) {
          try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col[0]} ${col[1]}`).run(); } catch(e) { /* exists */ }
        }
        const allowed = ['email', 'phone', 'birthday', 'anniversary', 'photo_data', 'show_email', 'show_phone', 'show_birthday', 'show_anniversary', 'show_about', 'instagram', 'facebook', 'location', 'job', 'church', 'retreat_years', 'about', 'secret_sister_opt_out'];
        const fields = [];
        const values = [];
        for (const key of allowed) {
          if (body[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(body[key]);
          }
        }

        if (fields.length === 0) return json({ error: 'No fields to update' }, corsHeaders, 400);

        values.push(userId);
        const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
        await env.DB.prepare(sql).bind(...values).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/users/:id/photo - get user photo (lightweight)
      const photoMatch = path.match(/^\/api\/users\/(\d+)\/photo$/);
      if (photoMatch && request.method === 'GET') {
        const userId = parseInt(photoMatch[1]);
        const user = await env.DB.prepare(
          'SELECT photo_data FROM users WHERE id = ?'
        ).bind(userId).first();
        if (!user || !user.photo_data) return json({ photo_data: '' }, corsHeaders);
        return json({ photo_data: user.photo_data }, corsHeaders);
      }

      // DELETE /api/users/:id - delete user (admin)
      const userDeleteMatch = path.match(/^\/api\/users\/(\d+)$/);
      if (userDeleteMatch && request.method === 'DELETE') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        const userId = parseInt(userDeleteMatch[1]);
        await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/users/:id/team - toggle team badge (admin)
      const teamToggleMatch = path.match(/^\/api\/users\/(\d+)\/team$/);
      if (teamToggleMatch && request.method === 'POST') {
        const userId = parseInt(teamToggleMatch[1]);
        const { is_team } = await request.json();
        try { await env.DB.prepare('ALTER TABLE users ADD COLUMN is_team INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        await env.DB.prepare('UPDATE users SET is_team = ? WHERE id = ?').bind(is_team ? 1 : 0, userId).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/users/:id/speaker - toggle speaker flag
      const speakerToggleMatch = path.match(/^\/api\/users\/(\d+)\/speaker$/);
      if (speakerToggleMatch && request.method === 'POST') {
        const userId = parseInt(speakerToggleMatch[1]);
        const { is_speaker } = await request.json();
        try { await env.DB.prepare('ALTER TABLE users ADD COLUMN is_speaker INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        await env.DB.prepare('UPDATE users SET is_speaker = ? WHERE id = ?').bind(is_speaker ? 1 : 0, userId).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/users/:id/worship - toggle worship team flag
      const worshipToggleMatch = path.match(/^\/api\/users\/(\d+)\/worship$/);
      if (worshipToggleMatch && request.method === 'POST') {
        const userId = parseInt(worshipToggleMatch[1]);
        const { is_worship } = await request.json();
        try { await env.DB.prepare('ALTER TABLE users ADD COLUMN is_worship INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        await env.DB.prepare('UPDATE users SET is_worship = ? WHERE id = ?').bind(is_worship ? 1 : 0, userId).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== ADMIN =====

      // DELETE /api/admin/reset - clear all test data
      if (path === '/api/admin/reset' && request.method === 'DELETE') {
        const authErr = requireAdmin(request);
        if (authErr) return authErr;
        const tables = ['messages', 'moments', 'moment_reactions', 'moment_comments', 'video_moments', 'feedback', 'fun_facts', 'packing_scores', 'secret_sister', 'secret_sister_pairings', 'secret_sister_round_locks', 'secret_sister_admin_notes', 'wyr_votes', 'wyr_questions', 'announcements', 'poll_responses', 'polls', 'theme_suggestions', 'celebration_messages', 'testimony_hearts', 'testimonies', 'journal_activity', 'users'];
        for (const t of tables) {
          try { await env.DB.prepare(`DELETE FROM ${t}`).run(); } catch(e) { /* table may not exist */ }
        }
        // Clear R2 videos
        const listed = await env.VIDEOS.list();
        for (const obj of listed.objects) {
          await env.VIDEOS.delete(obj.key);
        }
        return json({ success: true, message: 'All data cleared' }, corsHeaders);
      }

      // DELETE /api/moments/:id (admin or own content)
      const momentDeleteMatch = path.match(/^\/api\/moments\/(\d+)$/);
      if (momentDeleteMatch && request.method === 'DELETE') {
        const momentId = parseInt(momentDeleteMatch[1]);
        const { user_id } = await request.json();

        if (!isAdmin(request)) {
          const moment = await env.DB.prepare('SELECT user_id FROM moments WHERE id = ?').bind(momentId).first();
          if (!moment) return json({ error: 'Not found' }, corsHeaders, 404);
          if (moment.user_id !== user_id) return json({ error: 'Not yours' }, corsHeaders, 403);
        }

        await env.DB.prepare('DELETE FROM moments WHERE id = ?').bind(momentId).run();
        return json({ success: true }, corsHeaders);
      }

      // DELETE /api/messages/:id
      const msgDeleteMatch = path.match(/^\/api\/messages\/(\d+)$/);
      if (msgDeleteMatch && request.method === 'DELETE') {
        const msgId = parseInt(msgDeleteMatch[1]);
        await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(msgId).run();
        return json({ success: true }, corsHeaders);
      }

      // DELETE /api/feedback/:id
      const fbDeleteMatch = path.match(/^\/api\/feedback\/(\d+)$/);
      if (fbDeleteMatch && request.method === 'DELETE') {
        const fbId = parseInt(fbDeleteMatch[1]);
        await env.DB.prepare('DELETE FROM feedback WHERE id = ?').bind(fbId).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== MESSAGES =====

      // GET /api/messages - get prayer wall messages
      if (path === '/api/messages' && request.method === 'GET') {
        // Resolve the author's full name (first + last) from the users table
        // when possible so name policy changes apply to existing posts too.
        // Falls back to the stored author_name if user is missing or the
        // join column doesn't exist on legacy schemas.
        let results;
        try {
          ({ results } = await env.DB.prepare(
            `SELECT m.id, m.user_id, m.author_name, m.type, m.tagged_name, m.message,
                    m.prayer_count, m.created_at,
                    u.first_name, u.last_name, u.last_initial
             FROM messages m
             LEFT JOIN users u ON m.user_id = u.id
             ORDER BY m.created_at DESC LIMIT 200`
          ).all());
          for (const r of results) {
            if (r.first_name) {
              if (r.last_name) {
                r.author_name = `${r.first_name} ${r.last_name}`;
              } else if (r.last_initial) {
                r.author_name = `${r.first_name} ${r.last_initial}.`;
              } else {
                r.author_name = r.first_name;
              }
            }
            delete r.first_name;
            delete r.last_name;
            delete r.last_initial;
          }
        } catch (e) {
          ({ results } = await env.DB.prepare(
            `SELECT id, user_id, author_name, type, tagged_name, message, prayer_count, created_at
             FROM messages ORDER BY created_at DESC LIMIT 200`
          ).all());
        }
        return json(results, corsHeaders);
      }

      // POST /api/messages - create a new post
      if (path === '/api/messages' && request.method === 'POST') {
        const { user_id, author_name, type, tagged_name, message } = await request.json();

        if (!user_id || !author_name || !message || !type) {
          return json({ error: 'user_id, author_name, type, and message are required' }, corsHeaders, 400);
        }

        if (type !== 'prayer' && type !== 'encouragement') {
          return json({ error: 'type must be "prayer" or "encouragement"' }, corsHeaders, 400);
        }

        if (containsBlockedWords(message)) {
          return json({ error: 'Please keep messages kind and uplifting.' }, corsHeaders, 400);
        }

        if (message.length > 500) {
          return json({ error: 'Message must be 500 characters or less.' }, corsHeaders, 400);
        }

        const result = await env.DB.prepare(
          'INSERT INTO messages (user_id, author_name, type, tagged_name, message) VALUES (?, ?, ?, ?, ?)'
        ).bind(user_id, author_name, type, tagged_name || null, message).run();

        return json({ success: true, id: result.meta.last_row_id }, corsHeaders);
      }

      // POST /api/messages/:id/pray - increment prayer count
      const prayMatch = path.match(/^\/api\/messages\/(\d+)\/pray$/);
      if (prayMatch && request.method === 'POST') {
        const msgId = parseInt(prayMatch[1]);
        await env.DB.prepare(
          'UPDATE messages SET prayer_count = prayer_count + 1 WHERE id = ?'
        ).bind(msgId).run();

        const updated = await env.DB.prepare(
          'SELECT prayer_count FROM messages WHERE id = ?'
        ).bind(msgId).first();

        return json({ success: true, prayer_count: updated?.prayer_count || 0 }, corsHeaders);
      }

      // DELETE /api/messages/:id - delete a post (only by author)
      const deleteMatch = path.match(/^\/api\/messages\/(\d+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const msgId = parseInt(deleteMatch[1]);
        const { user_id } = await request.json();

        // Verify ownership
        const msg = await env.DB.prepare(
          'SELECT user_id FROM messages WHERE id = ?'
        ).bind(msgId).first();

        if (!msg) {
          return json({ error: 'Message not found' }, corsHeaders, 404);
        }
        if (msg.user_id !== user_id) {
          return json({ error: 'You can only delete your own posts' }, corsHeaders, 403);
        }

        await env.DB.prepare('DELETE FROM messages WHERE id = ?').bind(msgId).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== MESSAGE REACTIONS =====

      // Create reactions table if needed
      if (path.startsWith('/api/messages') && path.includes('/react')) {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS message_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, user_id, emoji)
          )`).run();
        } catch(e) { /* already exists */ }
      }

      // POST /api/messages/:id/react - toggle a reaction
      const reactMatch = path.match(/^\/api\/messages\/(\d+)\/react$/);
      if (reactMatch && request.method === 'POST') {
        const msgId = parseInt(reactMatch[1]);
        const { user_id, emoji } = await request.json();
        if (!user_id || !emoji) return json({ error: 'user_id and emoji required' }, corsHeaders, 400);

        const existing = await env.DB.prepare(
          'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
        ).bind(msgId, user_id, emoji).first();

        if (existing) {
          await env.DB.prepare('DELETE FROM message_reactions WHERE id = ?').bind(existing.id).run();
        } else {
          await env.DB.prepare(
            'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
          ).bind(msgId, user_id, emoji).run();
        }

        const { results: counts } = await env.DB.prepare(
          'SELECT emoji, COUNT(*) as count FROM message_reactions WHERE message_id = ? GROUP BY emoji'
        ).bind(msgId).all();
        const { results: userReactions } = await env.DB.prepare(
          'SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?'
        ).bind(msgId, user_id).all();

        return json({
          success: true,
          reactions: counts.reduce((acc, r) => { acc[r.emoji] = r.count; return acc; }, {}),
          user_reacted: userReactions.map(r => r.emoji)
        }, corsHeaders);
      }

      // GET /api/messages/reactions - bulk load all reactions
      if (path === '/api/messages/reactions' && request.method === 'GET') {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS message_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(message_id, user_id, emoji)
          )`).run();
        } catch(e) {}
        const { results } = await env.DB.prepare(
          'SELECT message_id, emoji, COUNT(*) as count FROM message_reactions GROUP BY message_id, emoji'
        ).all();
        const userId = parseInt(url.searchParams.get('user_id') || '0');
        let userReactions = [];
        if (userId) {
          ({ results: userReactions } = await env.DB.prepare(
            'SELECT message_id, emoji FROM message_reactions WHERE user_id = ?'
          ).bind(userId).all());
        }
        return json({ reactions: results, user_reacted: userReactions }, corsHeaders);
      }

      // ===== JOURNEY RESPONSES =====

      // POST /api/journey - submit or update a gift response
      if (path === '/api/journey' && request.method === 'POST') {
        const { user_id, gift, response } = await request.json();
        if (!user_id || !gift || !response) {
          return json({ error: 'user_id, gift, and response are required' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          `INSERT INTO journey_responses (user_id, gift, response)
           VALUES (?, ?, ?)
           ON CONFLICT(user_id, gift) DO UPDATE SET response = excluded.response`
        ).bind(user_id, gift, response).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/journey/:user_id - return this user's saved responses
      const journeyUserMatch = path.match(/^\/api\/journey\/(\d+)$/);
      if (journeyUserMatch && request.method === 'GET') {
        const uid = parseInt(journeyUserMatch[1]);
        const { results } = await env.DB.prepare(
          'SELECT gift, response FROM journey_responses WHERE user_id = ?'
        ).bind(uid).all();
        const responses = {};
        (results || []).forEach(r => { responses[r.gift] = r.response; });
        return json({ responses }, corsHeaders);
      }

      // GET /api/journey/insights - anonymous aggregated stats
      if (path === '/api/journey/insights' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT gift, response, COUNT(*) as count
           FROM journey_responses
           GROUP BY gift, response
           ORDER BY gift, count DESC`
        ).all();

        const totalUsers = await env.DB.prepare(
          'SELECT COUNT(DISTINCT user_id) as total FROM journey_responses'
        ).first();

        return json({
          total_participants: totalUsers?.total || 0,
          responses: results
        }, corsHeaders);
      }

      // ===== MOMENTS =====

      // GET /api/moments/latest - just metadata for slideshow (no photo data)
      if (path === '/api/moments/latest' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, author_name, caption, created_at
           FROM moments ORDER BY created_at DESC LIMIT 15`
        ).all();
        return json(results, corsHeaders);
      }

      // GET /api/moments/:id/photo - serve photo (R2 or base64 fallback)
      const momentPhotoMatch = path.match(/^\/api\/moments\/(\d+)\/photo$/);
      if (momentPhotoMatch && request.method === 'GET') {
        const id = parseInt(momentPhotoMatch[1]);
        const row = await env.DB.prepare('SELECT photo_data, r2_key FROM moments WHERE id = ?').bind(id).first();
        if (!row) return json({ error: 'Not found' }, corsHeaders, 404);

        // Try R2 first
        if (row.r2_key && env.VIDEOS) {
          const obj = await env.VIDEOS.get(row.r2_key);
          if (obj) {
            return new Response(obj.body, {
              headers: { ...corsHeaders, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }
            });
          }
        }
        // Fall back to base64 in DB
        if (row.photo_data) {
          return json({ photo_data: row.photo_data }, corsHeaders);
        }
        return json({ error: 'Not found' }, corsHeaders, 404);
      }

      // GET /api/moments/:id/image - redirect-friendly image URL
      const momentImgMatch = path.match(/^\/api\/moments\/(\d+)\/image$/);
      if (momentImgMatch && request.method === 'GET') {
        const id = parseInt(momentImgMatch[1]);
        const row = await env.DB.prepare('SELECT photo_data, r2_key FROM moments WHERE id = ?').bind(id).first();
        if (!row) return new Response('Not found', { status: 404, headers: corsHeaders });

        if (row.r2_key && env.VIDEOS) {
          const obj = await env.VIDEOS.get(row.r2_key);
          if (obj) {
            return new Response(obj.body, {
              headers: { ...corsHeaders, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }
            });
          }
        }
        if (row.photo_data) {
          // Convert base64 to binary response
          const base64 = row.photo_data.split(',')[1] || row.photo_data;
          const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          return new Response(binary, {
            headers: { ...corsHeaders, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }
          });
        }
        return new Response('Not found', { status: 404, headers: corsHeaders });
      }

      // Helper: ensure reactions + comments tables exist for moments.
      const ensureMomentInteractionTables = async () => {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS moment_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            moment_id INTEGER NOT NULL,
            user_id INTEGER,
            emoji TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(moment_id, user_id, emoji)
          )`).run();
        } catch(e) { /* exists */ }
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS moment_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            moment_id INTEGER NOT NULL,
            user_id INTEGER,
            name TEXT DEFAULT 'A G4 sister',
            text TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
          )`).run();
        } catch(e) { /* exists */ }
      };

      // GET /api/moments - get all moments
      if (path === '/api/moments' && request.method === 'GET') {
        await ensureMomentInteractionTables();
        let results;
        try {
          ({ results } = await env.DB.prepare(
            `SELECT id, user_id, author_name, photo_data, caption, gift_tag, r2_key, created_at
             FROM moments ORDER BY created_at DESC LIMIT 200`
          ).all());
        } catch(e) {
          ({ results } = await env.DB.prepare(
            `SELECT id, user_id, author_name, photo_data, caption, gift_tag, created_at
             FROM moments ORDER BY created_at DESC LIMIT 200`
          ).all());
        }
        // Aggregate reaction counts per emoji per moment
        const reactionCounts = {};
        try {
          const { results: rx } = await env.DB.prepare(
            'SELECT moment_id, emoji, COUNT(*) as c FROM moment_reactions GROUP BY moment_id, emoji'
          ).all();
          (rx || []).forEach(r => {
            if (!reactionCounts[r.moment_id]) reactionCounts[r.moment_id] = {};
            reactionCounts[r.moment_id][r.emoji] = r.c;
          });
        } catch(e) {}
        // Comment counts per moment
        const commentCounts = {};
        try {
          const { results: cc } = await env.DB.prepare(
            'SELECT moment_id, COUNT(*) as c FROM moment_comments GROUP BY moment_id'
          ).all();
          (cc || []).forEach(r => { commentCounts[r.moment_id] = r.c; });
        } catch(e) {}
        // Which emojis the requesting user has already tapped, per moment
        const myReactions = {};
        const requesterId = parseInt(url.searchParams.get('user_id') || '0', 10);
        if (requesterId) {
          try {
            const { results: mine } = await env.DB.prepare(
              'SELECT moment_id, emoji FROM moment_reactions WHERE user_id = ?'
            ).bind(requesterId).all();
            (mine || []).forEach(r => {
              if (!myReactions[r.moment_id]) myReactions[r.moment_id] = {};
              myReactions[r.moment_id][r.emoji] = 1;
            });
          } catch(e) {}
        }
        // For R2 photos, provide image URL instead of empty photo_data
        const baseUrl = new URL(request.url).origin;
        const withUrls = results.map(m => ({
          ...m,
          photo_data: m.photo_data || (m.r2_key ? baseUrl + '/api/moments/' + m.id + '/image' : ''),
          image_url: baseUrl + '/api/moments/' + m.id + '/image',
          reactions: reactionCounts[m.id] || {},
          comment_count: commentCounts[m.id] || 0,
          my_reactions: myReactions[m.id] || {}
        }));
        return json(withUrls, corsHeaders);
      }

      // POST /api/moments/:id/react - toggle a reaction emoji on a moment
      const momentReactMatch = path.match(/^\/api\/moments\/(\d+)\/react$/);
      if (momentReactMatch && request.method === 'POST') {
        await ensureMomentInteractionTables();
        const momentId = parseInt(momentReactMatch[1]);
        const { user_id, emoji } = await request.json();
        if (!user_id || !emoji) return json({ error: 'user_id and emoji required' }, corsHeaders, 400);
        // Whitelist to the 3 supported emojis so the client can't stuff arbitrary data
        const allowed = ['heart', 'laugh', 'thumbs'];
        if (allowed.indexOf(emoji) === -1) return json({ error: 'unknown emoji' }, corsHeaders, 400);
        const existing = await env.DB.prepare(
          'SELECT id FROM moment_reactions WHERE moment_id = ? AND user_id = ? AND emoji = ?'
        ).bind(momentId, parseInt(user_id), emoji).first();
        if (existing) {
          await env.DB.prepare('DELETE FROM moment_reactions WHERE id = ?').bind(existing.id).run();
          return json({ reacted: false }, corsHeaders);
        }
        await env.DB.prepare(
          'INSERT INTO moment_reactions (moment_id, user_id, emoji) VALUES (?, ?, ?)'
        ).bind(momentId, parseInt(user_id), emoji).run();
        return json({ reacted: true }, corsHeaders);
      }

      // GET /api/moments/:id/comments - list comments for a moment
      const momentCommentsGetMatch = path.match(/^\/api\/moments\/(\d+)\/comments$/);
      if (momentCommentsGetMatch && request.method === 'GET') {
        await ensureMomentInteractionTables();
        const momentId = parseInt(momentCommentsGetMatch[1]);
        const { results } = await env.DB.prepare(
          'SELECT id, user_id, name, text, created_at FROM moment_comments WHERE moment_id = ? ORDER BY created_at ASC'
        ).bind(momentId).all();
        return json(results || [], corsHeaders);
      }

      // POST /api/moments/:id/comments - add a comment
      if (momentCommentsGetMatch && request.method === 'POST') {
        await ensureMomentInteractionTables();
        const momentId = parseInt(momentCommentsGetMatch[1]);
        const body = await request.json();
        const text = (body.text || '').trim();
        if (!text) return json({ error: 'text required' }, corsHeaders, 400);
        if (text.length > 300) return json({ error: 'comment too long' }, corsHeaders, 400);
        await env.DB.prepare(
          'INSERT INTO moment_comments (moment_id, user_id, name, text) VALUES (?, ?, ?, ?)'
        ).bind(
          momentId,
          body.user_id ? parseInt(body.user_id) : null,
          (body.name || 'A G4 sister').slice(0, 80),
          text
        ).run();
        return json({ success: true }, corsHeaders);
      }

      // DELETE /api/moments/:moment_id/comments/:comment_id - delete a comment
      // Body: { user_id } — must be the author OR admin (-1)
      const momentCommentDeleteMatch = path.match(/^\/api\/moments\/(\d+)\/comments\/(\d+)$/);
      if (momentCommentDeleteMatch && request.method === 'DELETE') {
        await ensureMomentInteractionTables();
        const commentId = parseInt(momentCommentDeleteMatch[2]);
        const body = await request.json().catch(() => ({}));
        const requesterId = parseInt(body.user_id || 0);
        const row = await env.DB.prepare('SELECT user_id FROM moment_comments WHERE id = ?').bind(commentId).first();
        if (!row) return json({ error: 'not found' }, corsHeaders, 404);
        // Author or admin (-1) can delete
        if (requesterId !== -1 && row.user_id !== requesterId) {
          return json({ error: 'not allowed' }, corsHeaders, 403);
        }
        await env.DB.prepare('DELETE FROM moment_comments WHERE id = ?').bind(commentId).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/moments - upload a moment (save to R2)
      if (path === '/api/moments' && request.method === 'POST') {
        const { user_id, author_name, photo_data, caption, gift_tag } = await request.json();

        if (!user_id || !author_name || !photo_data) {
          return json({ error: 'user_id, author_name, and photo_data are required' }, corsHeaders, 400);
        }

        if (caption && containsBlockedWords(caption)) {
          return json({ error: 'Please keep captions kind and uplifting.' }, corsHeaders, 400);
        }

        const count = await env.DB.prepare(
          'SELECT COUNT(*) as cnt FROM moments WHERE user_id = ?'
        ).bind(user_id).first();

        if (count && count.cnt >= 20) {
          return json({ error: 'You can share up to 20 moments. Delete one to add more.' }, corsHeaders, 400);
        }

        if (photo_data.length > 5000000) {
          return json({ error: 'Photo is too large.' }, corsHeaders, 400);
        }

        // Add r2_key column if missing
        try { await env.DB.prepare("ALTER TABLE moments ADD COLUMN r2_key TEXT DEFAULT ''").run(); } catch(e) {}

        // Save to R2 if available
        let r2Key = '';
        if (env.VIDEOS) {
          r2Key = 'moments/' + user_id + '-' + Date.now() + '.jpg';
          try {
            const base64 = photo_data.split(',')[1] || photo_data;
            const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            await env.VIDEOS.put(r2Key, binary, { httpMetadata: { contentType: 'image/jpeg' } });
          } catch(e) {
            r2Key = '';
          }
        }

        // Save to DB — store r2_key, and photo_data as fallback only if R2 failed
        const result = await env.DB.prepare(
          'INSERT INTO moments (user_id, author_name, photo_data, caption, gift_tag, r2_key) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(user_id, author_name, r2Key ? '' : photo_data, caption || '', gift_tag || '', r2Key).run();

        return json({ success: true, id: result.meta.last_row_id }, corsHeaders);
      }

      // DELETE /api/moments/:id - delete own moment
      const deleteMomentMatch = path.match(/^\/api\/moments\/(\d+)$/);
      if (deleteMomentMatch && request.method === 'DELETE') {
        const momentId = parseInt(deleteMomentMatch[1]);
        const { user_id } = await request.json();

        const moment = await env.DB.prepare(
          'SELECT user_id FROM moments WHERE id = ?'
        ).bind(momentId).first();

        if (!moment) {
          return json({ error: 'Moment not found' }, corsHeaders, 404);
        }
        if (moment.user_id !== user_id) {
          return json({ error: 'You can only delete your own moments' }, corsHeaders, 403);
        }

        await env.DB.prepare('DELETE FROM moments WHERE id = ?').bind(momentId).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== VIDEO MOMENTS (R2 storage) =====

      // GET /api/videos - list all video moments (metadata + thumbnails only)
      if (path === '/api/videos' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, user_id, author_name, session_tag, thumbnail_data, duration, created_at
           FROM video_moments ORDER BY created_at DESC LIMIT 100`
        ).all();
        return json(results, corsHeaders);
      }

      // GET /api/videos/:id - get video metadata (for playback info)
      const videoGetMatch = path.match(/^\/api\/videos\/(\d+)$/);
      if (videoGetMatch && request.method === 'GET') {
        const videoId = parseInt(videoGetMatch[1]);
        const video = await env.DB.prepare(
          'SELECT id, user_id, author_name, session_tag, thumbnail_data, duration, created_at FROM video_moments WHERE id = ?'
        ).bind(videoId).first();

        if (!video) {
          return json({ error: 'Video not found' }, corsHeaders, 404);
        }
        return json(video, corsHeaders);
      }

      // GET /api/videos/:id/stream - stream actual video from R2
      const videoStreamMatch = path.match(/^\/api\/videos\/(\d+)\/stream$/);
      if (videoStreamMatch && request.method === 'GET') {
        const videoId = parseInt(videoStreamMatch[1]);
        const obj = await env.VIDEOS.get(`video-${videoId}`);
        if (!obj) {
          return new Response('Video not found', { status: 404, headers: corsHeaders });
        }
        return new Response(obj.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': obj.httpMetadata?.contentType || 'video/webm',
            'Cache-Control': 'public, max-age=86400',
          }
        });
      }

      // POST /api/videos - upload a video moment to R2
      if (path === '/api/videos' && request.method === 'POST') {
        const { user_id, author_name, session_tag, video_data, thumbnail_data, duration, content_type } = await request.json();

        if (!user_id || !author_name || !video_data) {
          return json({ error: 'user_id, author_name, and video_data are required' }, corsHeaders, 400);
        }

        // Check upload limit
        const count = await env.DB.prepare(
          'SELECT COUNT(*) as cnt FROM video_moments WHERE user_id = ?'
        ).bind(user_id).first();

        if (count && count.cnt >= 3) {
          return json({ error: 'You can share up to 3 video moments. Delete one to add more.' }, corsHeaders, 400);
        }

        // Insert metadata into D1 (no video_data)
        const result = await env.DB.prepare(
          'INSERT INTO video_moments (user_id, author_name, session_tag, video_data, thumbnail_data, duration) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(user_id, author_name, session_tag || '', '', thumbnail_data || '', duration || 0).run();

        const videoId = result.meta.last_row_id;

        // Decode base64 and store in R2
        let base64Body = video_data;
        if (base64Body.includes(',')) {
          base64Body = base64Body.split(',')[1];
        }
        // Clean any whitespace or invalid chars
        base64Body = base64Body.replace(/\s/g, '');

        // Use fetch to decode base64 reliably
        const dataUrl = `data:${content_type || 'video/webm'};base64,${base64Body}`;
        const videoResponse = await fetch(dataUrl);
        const videoBlob = await videoResponse.arrayBuffer();

        await env.VIDEOS.put(`video-${videoId}`, videoBlob, {
          httpMetadata: { contentType: content_type || 'video/webm' }
        });

        return json({ success: true, id: videoId }, corsHeaders);
      }

      // DELETE /api/videos/:id - delete own video
      const deleteVideoMatch = path.match(/^\/api\/videos\/(\d+)$/);
      if (deleteVideoMatch && request.method === 'DELETE') {
        const videoId = parseInt(deleteVideoMatch[1]);
        const { user_id } = await request.json();

        const video = await env.DB.prepare(
          'SELECT user_id FROM video_moments WHERE id = ?'
        ).bind(videoId).first();

        if (!video) {
          return json({ error: 'Video not found' }, corsHeaders, 404);
        }
        if (!isAdmin(request) && video.user_id !== user_id) {
          return json({ error: 'You can only delete your own videos' }, corsHeaders, 403);
        }

        // Delete from both D1 and R2
        await env.DB.prepare('DELETE FROM video_moments WHERE id = ?').bind(videoId).run();
        await env.VIDEOS.delete(`video-${videoId}`);
        return json({ success: true }, corsHeaders);
      }

      // ===== GAMES =====

      // GET /api/games/settings - check which games are active
      if (path === '/api/games/settings' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT key, value FROM game_settings'
        ).all();
        const settings = {};
        for (const r of results) settings[r.key] = r.value;
        return json(settings, corsHeaders);
      }

      // POST /api/games/settings - admin toggle a game on/off
      if (path === '/api/games/settings' && request.method === 'POST') {
        const { key, value } = await request.json();
        if (!key) return json({ error: 'key is required' }, corsHeaders, 400);
        await env.DB.prepare(
          'INSERT INTO game_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).bind(key, value || '').run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/games/funfact - submit a fun fact
      if (path === '/api/games/funfact' && request.method === 'POST') {
        const { user_id, author_name, fact } = await request.json();
        if (!user_id || !fact || !fact.trim()) {
          return json({ error: 'user_id and fact are required' }, corsHeaders, 400);
        }
        if (containsBlockedWords(fact)) {
          return json({ error: 'Please keep it fun and kind!' }, corsHeaders, 400);
        }
        // Upsert — one fact per user
        await env.DB.prepare(
          'INSERT INTO fun_facts (user_id, author_name, fact) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET fact = excluded.fact, author_name = excluded.author_name'
        ).bind(user_id, author_name || '', fact.trim()).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/games/funfacts - admin: get all fun facts
      if (path === '/api/games/funfacts' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, user_id, author_name, fact, created_at FROM fun_facts ORDER BY created_at DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // DELETE /api/games/funfacts - admin: delete all fun facts
      if (path === '/api/games/funfacts' && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM fun_facts').run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/games/packing - submit packing score
      if (path === '/api/games/packing' && request.method === 'POST') {
        const { user_id, author_name, score, answers } = await request.json();
        if (!user_id || score === undefined) {
          return json({ error: 'user_id and score are required' }, corsHeaders, 400);
        }
        // Lazy migrations: add any missing columns
        try { await env.DB.prepare("ALTER TABLE packing_scores ADD COLUMN user_name TEXT DEFAULT ''").run(); } catch(e) {}
        try { await env.DB.prepare("ALTER TABLE packing_scores ADD COLUMN author_name TEXT DEFAULT ''").run(); } catch(e) {}
        try { await env.DB.prepare("ALTER TABLE packing_scores ADD COLUMN answers TEXT DEFAULT ''").run(); } catch(e) {}
        // Upsert — one score per user
        await env.DB.prepare(
          'INSERT INTO packing_scores (user_id, user_name, author_name, score, answers) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET score = excluded.score, answers = excluded.answers, author_name = excluded.author_name, user_name = excluded.user_name'
        ).bind(user_id, author_name || '', author_name || '', score, answers || '').run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/games/packing - get packing leaderboard
      if (path === '/api/games/packing' && request.method === 'GET') {
        try { await env.DB.prepare("ALTER TABLE packing_scores ADD COLUMN author_name TEXT DEFAULT ''").run(); } catch(e) {}
        try { await env.DB.prepare("ALTER TABLE packing_scores ADD COLUMN answers TEXT DEFAULT ''").run(); } catch(e) {}
        const { results } = await env.DB.prepare(
          'SELECT id, user_id, author_name, score, created_at FROM packing_scores ORDER BY score DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // DELETE /api/games/packing - clear all packing scores
      if (path === '/api/games/packing' && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM packing_scores').run();
        return json({ success: true }, corsHeaders);
      }

      // ===== ANNOUNCEMENTS =====

      // GET /api/announcements/active - get current active announcement
      if (path === '/api/announcements/active' && request.method === 'GET') {
        const ann = await env.DB.prepare(
          'SELECT id, message, created_at FROM announcements WHERE active = 1 ORDER BY id DESC LIMIT 1'
        ).first();
        return json(ann || { id: null }, corsHeaders);
      }

      // POST /api/announcements - create an announcement (admin)
      if (path === '/api/announcements' && request.method === 'POST') {
        const { message } = await request.json();
        if (!message || !message.trim()) return json({ error: 'Message required' }, corsHeaders, 400);
        // Deactivate all previous
        await env.DB.prepare('UPDATE announcements SET active = 0').run();
        const result = await env.DB.prepare(
          'INSERT INTO announcements (message, active) VALUES (?, 1)'
        ).bind(message.trim()).run();
        return json({ success: true, id: result.meta.last_row_id }, corsHeaders);
      }

      // DELETE /api/announcements/active - dismiss/deactivate current announcement
      if (path === '/api/announcements/active' && request.method === 'DELETE') {
        await env.DB.prepare('UPDATE announcements SET active = 0').run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/announcements - all announcements (admin)
      if (path === '/api/announcements' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, message, active, created_at FROM announcements ORDER BY id DESC LIMIT 50'
        ).all();
        return json(results, corsHeaders);
      }

      // ===== NEWS / REMINDERS (retreat slideshow) =====
      // Separate from the main-app announcement banner. Multiple can be
      // active at once; each active item becomes its own slideshow slide.

      // Lazy-create the news_items table on every news-related request.
      if (path.startsWith('/api/news')) {
        try {
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS news_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              message TEXT NOT NULL,
              icon TEXT DEFAULT '',
              active INTEGER DEFAULT 1,
              created_at TEXT DEFAULT (datetime('now'))
            )`
          ).run();
        } catch (e) { /* already exists */ }
      }

      // GET /api/news — list active news items (public; used by slideshow)
      if (path === '/api/news' && request.method === 'GET') {
        try {
          const { results } = await env.DB.prepare(
            'SELECT id, message, icon, active, created_at FROM news_items WHERE active = 1 ORDER BY id DESC'
          ).all();
          return json(results || [], corsHeaders);
        } catch (e) {
          return json([], corsHeaders);
        }
      }

      // GET /api/news/all — list all news items incl. inactive (admin)
      if (path === '/api/news/all' && request.method === 'GET') {
        try {
          const { results } = await env.DB.prepare(
            'SELECT id, message, icon, active, created_at FROM news_items ORDER BY id DESC LIMIT 200'
          ).all();
          return json(results || [], corsHeaders);
        } catch (e) {
          return json([], corsHeaders);
        }
      }

      // POST /api/news — create a news item
      if (path === '/api/news' && request.method === 'POST') {
        try {
          const { message, icon } = await request.json();
          if (!message || !message.trim()) return json({ error: 'message required' }, corsHeaders, 400);
          const result = await env.DB.prepare(
            'INSERT INTO news_items (message, icon, active) VALUES (?, ?, 1)'
          ).bind(message.trim(), (icon || '').trim()).run();
          return json({ success: true, id: result.meta ? result.meta.last_row_id : null }, corsHeaders);
        } catch (e) {
          return json({ error: e.message || String(e) }, corsHeaders, 500);
        }
      }

      // POST /api/news/:id/toggle — toggle active on/off
      const newsToggleMatch = path.match(/^\/api\/news\/(\d+)\/toggle$/);
      if (newsToggleMatch && request.method === 'POST') {
        const id = parseInt(newsToggleMatch[1]);
        try {
          const current = await env.DB.prepare('SELECT active FROM news_items WHERE id = ?').bind(id).first();
          if (!current) return json({ error: 'not found' }, corsHeaders, 404);
          const next = current.active ? 0 : 1;
          await env.DB.prepare('UPDATE news_items SET active = ? WHERE id = ?').bind(next, id).run();
          return json({ success: true, active: next }, corsHeaders);
        } catch (e) {
          return json({ error: e.message || String(e) }, corsHeaders, 500);
        }
      }

      // PUT /api/news/:id — update a news item
      const newsUpdateMatch = path.match(/^\/api\/news\/(\d+)$/);
      if (newsUpdateMatch && request.method === 'PUT') {
        const id = parseInt(newsUpdateMatch[1]);
        try {
          const { message, icon } = await request.json();
          if (!message || !message.trim()) return json({ error: 'message required' }, corsHeaders, 400);
          await env.DB.prepare(
            'UPDATE news_items SET message = ?, icon = ? WHERE id = ?'
          ).bind(message.trim(), icon || '📢', id).run();
          return json({ success: true }, corsHeaders);
        } catch (e) {
          return json({ error: e.message || String(e) }, corsHeaders, 500);
        }
      }

      // DELETE /api/news/:id — delete a news item
      const newsDeleteMatch = path.match(/^\/api\/news\/(\d+)$/);
      if (newsDeleteMatch && request.method === 'DELETE') {
        const id = parseInt(newsDeleteMatch[1]);
        try {
          await env.DB.prepare('DELETE FROM news_items WHERE id = ?').bind(id).run();
          return json({ success: true }, corsHeaders);
        } catch (e) {
          return json({ error: e.message || String(e) }, corsHeaders, 500);
        }
      }

      // ===== WOULD YOU RATHER =====

      // GET /api/games/wyr/questions - get all questions (admin)
      if (path === '/api/games/wyr/questions' && request.method === 'GET') {
        // Add show_on_polls column if missing (lazy migration)
        try { await env.DB.prepare('ALTER TABLE wyr_questions ADD COLUMN show_on_polls INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        const { results } = await env.DB.prepare(
          'SELECT id, option_a, option_b, active, show_on_polls, created_at FROM wyr_questions ORDER BY id DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // POST /api/games/wyr/show-toggle - toggle a single WYR question's visibility on the polls page (admin)
      if (path === '/api/games/wyr/show-toggle' && request.method === 'POST') {
        const { question_id, show } = await request.json();
        if (!question_id) return json({ error: 'question_id required' }, corsHeaders, 400);
        try { await env.DB.prepare('ALTER TABLE wyr_questions ADD COLUMN show_on_polls INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        await env.DB.prepare('UPDATE wyr_questions SET show_on_polls = ? WHERE id = ?').bind(show ? 1 : 0, question_id).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/games/wyr/questions - create a new question (admin)
      if (path === '/api/games/wyr/questions' && request.method === 'POST') {
        const { option_a, option_b } = await request.json();
        if (!option_a || !option_b) return json({ error: 'Both options required' }, corsHeaders, 400);
        const result = await env.DB.prepare(
          'INSERT INTO wyr_questions (option_a, option_b, active) VALUES (?, ?, 0)'
        ).bind(option_a.trim(), option_b.trim()).run();
        return json({ success: true, id: result.meta.last_row_id }, corsHeaders);
      }

      // POST /api/games/wyr/activate - activate a question (deactivates others)
      if (path === '/api/games/wyr/activate' && request.method === 'POST') {
        const { question_id } = await request.json();
        // Deactivate all
        await env.DB.prepare('UPDATE wyr_questions SET active = 0').run();
        if (question_id) {
          await env.DB.prepare('UPDATE wyr_questions SET active = 1 WHERE id = ?').bind(question_id).run();
        }
        return json({ success: true }, corsHeaders);
      }

      // GET /api/games/wyr/active - get the currently active question + results
      if (path === '/api/games/wyr/active' && request.method === 'GET') {
        const question = await env.DB.prepare(
          'SELECT id, option_a, option_b FROM wyr_questions WHERE active = 1'
        ).first();
        if (!question) return json({ active: false }, corsHeaders);

        const { results: votes } = await env.DB.prepare(
          'SELECT choice, COUNT(*) as count FROM wyr_votes WHERE question_id = ? GROUP BY choice'
        ).bind(question.id).all();

        let countA = 0, countB = 0;
        for (const v of votes) {
          if (v.choice === 'A') countA = v.count;
          if (v.choice === 'B') countB = v.count;
        }
        const total = countA + countB;

        return json({
          active: true,
          id: question.id,
          option_a: question.option_a,
          option_b: question.option_b,
          count_a: countA,
          count_b: countB,
          total: total,
          pct_a: total ? Math.round((countA / total) * 100) : 0,
          pct_b: total ? Math.round((countB / total) * 100) : 0
        }, corsHeaders);
      }

      // POST /api/games/wyr/vote - cast a vote
      if (path === '/api/games/wyr/vote' && request.method === 'POST') {
        const { user_id, question_id, choice } = await request.json();
        if (!user_id || !question_id || !choice) return json({ error: 'user_id, question_id, choice required' }, corsHeaders, 400);
        if (choice !== 'A' && choice !== 'B') return json({ error: 'choice must be A or B' }, corsHeaders, 400);

        // Upsert — one vote per user per question
        await env.DB.prepare(
          'INSERT INTO wyr_votes (user_id, question_id, choice) VALUES (?, ?, ?) ON CONFLICT(user_id, question_id) DO UPDATE SET choice = excluded.choice'
        ).bind(user_id, question_id, choice).run();

        // Return updated results
        const { results: votes } = await env.DB.prepare(
          'SELECT choice, COUNT(*) as count FROM wyr_votes WHERE question_id = ? GROUP BY choice'
        ).bind(question_id).all();

        let countA = 0, countB = 0;
        for (const v of votes) {
          if (v.choice === 'A') countA = v.count;
          if (v.choice === 'B') countB = v.count;
        }
        const total = countA + countB;

        return json({
          success: true,
          count_a: countA,
          count_b: countB,
          total: total,
          pct_a: total ? Math.round((countA / total) * 100) : 0,
          pct_b: total ? Math.round((countB / total) * 100) : 0
        }, corsHeaders);
      }

      // GET /api/games/wyr/voters/:id - get who voted for what (admin)
      const wyrVotersMatch = path.match(/^\/api\/games\/wyr\/voters\/(\d+)$/);
      if (wyrVotersMatch && request.method === 'GET') {
        const qId = parseInt(wyrVotersMatch[1]);
        const { results } = await env.DB.prepare(
          `SELECT v.choice, u.first_name, u.last_initial
           FROM wyr_votes v JOIN users u ON v.user_id = u.id
           WHERE v.question_id = ?
           ORDER BY v.choice, u.first_name`
        ).bind(qId).all();
        const voters = results.map(r => ({
          name: r.last_initial ? `${r.first_name} ${r.last_initial}.` : r.first_name,
          choice: r.choice
        }));
        return json(voters, corsHeaders);
      }

      // GET /api/games/wyr/feed - public feed of WYR results with voters
      // Only returns questions admin has flagged with show_on_polls = 1
      if (path === '/api/games/wyr/feed' && request.method === 'GET') {
        try {
          try { await env.DB.prepare('ALTER TABLE wyr_questions ADD COLUMN show_on_polls INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
          const { results: questions } = await env.DB.prepare(
            'SELECT id, option_a, option_b, created_at FROM wyr_questions WHERE show_on_polls = 1 ORDER BY id DESC'
          ).all();
          const feed = [];
          for (const q of questions) {
            const { results: votes } = await env.DB.prepare(
              'SELECT v.choice, u.first_name, u.last_initial FROM wyr_votes v JOIN users u ON v.user_id = u.id WHERE v.question_id = ? ORDER BY v.choice, u.first_name'
            ).bind(q.id).all();
            const votersA = votes.filter(v => v.choice === 'A').map(v => v.last_initial ? `${v.first_name} ${v.last_initial}.` : v.first_name);
            const votersB = votes.filter(v => v.choice === 'B').map(v => v.last_initial ? `${v.first_name} ${v.last_initial}.` : v.first_name);
            const total = votes.length;
            feed.push({
              id: q.id,
              option_a: q.option_a,
              option_b: q.option_b,
              count_a: votersA.length,
              count_b: votersB.length,
              pct_a: total > 0 ? Math.round((votersA.length / total) * 100) : 0,
              pct_b: total > 0 ? Math.round((votersB.length / total) * 100) : 0,
              total,
              voters_a: votersA,
              voters_b: votersB
            });
          }
          return json(feed, corsHeaders);
        } catch (e) {
          return json([], corsHeaders);
        }
      }

      // DELETE /api/games/wyr/questions/:id - delete a question and its votes
      const wyrDeleteMatch = path.match(/^\/api\/games\/wyr\/questions\/(\d+)$/);
      if (wyrDeleteMatch && request.method === 'DELETE') {
        const qId = parseInt(wyrDeleteMatch[1]);
        await env.DB.prepare('DELETE FROM wyr_votes WHERE question_id = ?').bind(qId).run();
        await env.DB.prepare('DELETE FROM wyr_questions WHERE id = ?').bind(qId).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== SECRET SISTER =====

      // POST /api/games/secretsister/assign - admin: randomly pair all users
      if (path === '/api/games/secretsister/assign' && request.method === 'POST') {
        // Get all users
        const { results: users } = await env.DB.prepare(
          'SELECT id, first_name, last_initial FROM users ORDER BY id'
        ).all();

        if (users.length < 2) {
          return json({ error: 'Need at least 2 users to assign sisters' }, corsHeaders, 400);
        }

        // Shuffle users into a random cycle: each person writes to the next
        const shuffled = [...users];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Clear old assignments
        await env.DB.prepare('DELETE FROM secret_sister').run();

        // Create cycle: person i writes to person (i+1), last writes to first
        for (let i = 0; i < shuffled.length; i++) {
          const giver = shuffled[i];
          const receiver = shuffled[(i + 1) % shuffled.length];
          const giverName = giver.last_initial ? `${giver.first_name} ${giver.last_initial}.` : giver.first_name;
          const receiverName = receiver.last_initial ? `${receiver.first_name} ${receiver.last_initial}.` : receiver.first_name;
          await env.DB.prepare(
            'INSERT INTO secret_sister (giver_id, receiver_id, giver_name, receiver_name) VALUES (?, ?, ?, ?)'
          ).bind(giver.id, receiver.id, giverName, receiverName).run();
        }

        return json({ success: true, pairs: shuffled.length }, corsHeaders);
      }

      // GET /api/games/secretsister/mine - get my assignment (who I write to) + note written for me
      const ssMatch = path.match(/^\/api\/games\/secretsister\/mine$/);
      if (ssMatch && request.method === 'GET') {
        const userId = parseInt(url.searchParams.get('user_id'));
        if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);

        // Who am I assigned to write to?
        const assignment = await env.DB.prepare(
          'SELECT receiver_id, receiver_name FROM secret_sister WHERE giver_id = ?'
        ).bind(userId).first();

        // Has someone written a note for me?
        const received = await env.DB.prepare(
          'SELECT note FROM secret_sister WHERE receiver_id = ?'
        ).bind(userId).first();

        return json({
          assignment: assignment ? { receiver_id: assignment.receiver_id, receiver_name: assignment.receiver_name } : null,
          received_note: (received && received.note) ? received.note : null
        }, corsHeaders);
      }

      // POST /api/games/secretsister/note - submit my note for my assigned sister
      if (path === '/api/games/secretsister/note' && request.method === 'POST') {
        const { user_id, note } = await request.json();
        if (!user_id || !note || !note.trim()) {
          return json({ error: 'user_id and note are required' }, corsHeaders, 400);
        }
        if (containsBlockedWords(note)) {
          return json({ error: 'Please keep it kind and uplifting!' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          'UPDATE secret_sister SET note = ? WHERE giver_id = ?'
        ).bind(note.trim(), user_id).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/games/secretsister/all - admin: see all pairings
      if (path === '/api/games/secretsister/all' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, giver_id, giver_name, receiver_id, receiver_name, note, created_at FROM secret_sister ORDER BY id'
        ).all();
        return json(results, corsHeaders);
      }

      // DELETE /api/games/secretsister/all - admin: clear all assignments
      if (path === '/api/games/secretsister/all' && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM secret_sister').run();
        return json({ success: true }, corsHeaders);
      }

      // ===== WEEKLY SECRET SISTER (post-retreat) =====

      // GET /api/secretsister/week?user_id=N - this week's state for me
      if (path === '/api/secretsister/week' && request.method === 'GET') {
        const userId = parseInt(url.searchParams.get('user_id'));
        if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);
        await ensureWeeklySSTable(env.DB);
        const round = getCurrentSSRound();
        if (round === 0) {
          // Before the first weekly round begins, bridge to the retreat-time
          // game if it's active. Heather's retreat-time game is running right
          // now; on Wednesday April 15 the round number will flip to 1 and
          // the weekly rotation takes over automatically.
          let retreatActive = false;
          let retreatRevealed = false;
          try {
            const gameOn = await env.DB.prepare(
              "SELECT value FROM game_settings WHERE key = 'secret_sister'"
            ).first();
            retreatActive = gameOn && gameOn.value === '1';
            const revealOn = await env.DB.prepare(
              "SELECT value FROM game_settings WHERE key = 'secret_sister_reveal'"
            ).first();
            retreatRevealed = revealOn && revealOn.value === '1';
          } catch (e) { /* settings table may not exist yet */ }

          let retreatAssignment = null;
          let retreatMyNote = null;
          let retreatReceivedNote = null;
          if (retreatActive) {
            try {
              const mine = await env.DB.prepare(
                'SELECT receiver_id, receiver_name, note FROM secret_sister WHERE giver_id = ?'
              ).bind(userId).first();
              if (mine) {
                retreatAssignment = { receiver_id: mine.receiver_id, receiver_name: mine.receiver_name };
                retreatMyNote = mine.note || null;
              }
              // Received note respects the old reveal toggle
              if (retreatRevealed) {
                const inbound = await env.DB.prepare(
                  'SELECT note FROM secret_sister WHERE receiver_id = ? AND note IS NOT NULL AND note != \'\''
                ).bind(userId).first();
                if (inbound) retreatReceivedNote = inbound.note;
              }
            } catch (e) { /* table may not exist yet */ }
          }

          return json({
            round: 0,
            starts_at: new Date(SS_ANCHOR_UTC_MS).toISOString(),
            my_assignment: null,
            my_note: null,
            received_note: null,
            // Retreat-time game state (null if not active / no assignment)
            retreat_active: retreatActive,
            retreat_assignment: retreatAssignment,
            retreat_my_note: retreatMyNote,
            retreat_received_note: retreatReceivedNote
          }, corsHeaders);
        }
        await ensureSSRoundExists(env.DB, round);
        // Who am I writing to this week?
        const mine = await env.DB.prepare(
          'SELECT receiver_id, receiver_name, note FROM secret_sister_pairings WHERE round_number = ? AND giver_id = ?'
        ).bind(round, userId).first();
        // Who wrote to me this week? Only reveal if the note is ≥1hr old
        // (blurs timing so senders stay anonymous).
        const received = await env.DB.prepare(
          `SELECT note FROM secret_sister_pairings
           WHERE round_number = ? AND receiver_id = ?
             AND note != '' AND written_at IS NOT NULL
             AND julianday(written_at) <= julianday('now', ${SS_DELIVERY_DELAY_SQL})`
        ).bind(round, userId).first();
        // Admin-sent anonymous notes for this round (no delay gate — they're
        // intentional pastoral sends, not peer-random timing).
        let receivedNote = received && received.note ? received.note : null;
        if (!receivedNote) {
          try {
            const adminRow = await env.DB.prepare(
              `SELECT note FROM secret_sister_admin_notes
               WHERE round_number = ? AND recipient_user_id = ?
               ORDER BY written_at DESC LIMIT 1`
            ).bind(round, userId).first();
            if (adminRow && adminRow.note) receivedNote = adminRow.note;
          } catch (e) { /* table may not exist yet */ }
        }
        return json({
          round,
          my_assignment: mine ? { receiver_id: mine.receiver_id, receiver_name: mine.receiver_name } : null,
          my_note: mine && mine.note ? mine.note : null,
          received_note: receivedNote
        }, corsHeaders);
      }

      // POST /api/secretsister/write - save my note for the current round
      if (path === '/api/secretsister/write' && request.method === 'POST') {
        const { user_id, note } = await request.json();
        if (!user_id || !note || !note.trim()) {
          return json({ error: 'Please write a note first' }, corsHeaders, 400);
        }
        if (containsBlockedWords(note)) {
          return json({ error: 'Please keep it kind and uplifting' }, corsHeaders, 400);
        }
        await ensureWeeklySSTable(env.DB);
        const round = getCurrentSSRound();
        if (round === 0) {
          return json({ error: "Secret Sister rounds haven't started yet" }, corsHeaders, 400);
        }
        await ensureSSRoundExists(env.DB, round);
        const result = await env.DB.prepare(
          `UPDATE secret_sister_pairings
           SET note = ?, written_at = datetime('now')
           WHERE round_number = ? AND giver_id = ?`
        ).bind(note.trim(), round, user_id).run();
        if (!result.meta || result.meta.changes === 0) {
          return json({ error: 'No assignment found for you this week' }, corsHeaders, 400);
        }
        return json({ success: true, round }, corsHeaders);
      }

      // GET /api/secretsister/history?user_id=N - my full sent + received archive
      if (path === '/api/secretsister/history' && request.method === 'GET') {
        const userId = parseInt(url.searchParams.get('user_id'));
        if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);
        await ensureWeeklySSTable(env.DB);
        // Notes I've sent — I can see who I wrote to each week.
        const { results: sentWeekly } = await env.DB.prepare(
          `SELECT round_number, receiver_name, note, written_at
           FROM secret_sister_pairings
           WHERE giver_id = ? AND note != ''
           ORDER BY round_number DESC`
        ).bind(userId).all();
        // Also pull any retreat-time note I wrote via the old secret_sister
        // table, so the scrapbook shows a complete history across both games.
        // Labeled with round_number = 0 so the frontend can render it as
        // "Retreat Weekend" instead of a numbered week.
        let sentRetreat = [];
        try {
          const row = await env.DB.prepare(
            `SELECT receiver_name, note, created_at AS written_at
             FROM secret_sister
             WHERE giver_id = ? AND note IS NOT NULL AND note != ''`
          ).bind(userId).first();
          if (row) sentRetreat = [Object.assign({ round_number: 0 }, row)];
        } catch (e) { /* table may not exist on a fresh deploy */ }
        const sent = [...(sentWeekly || []), ...sentRetreat];

        // Notes I've received — NEVER include giver info. Only show rounds
        // where the note is ≥1hr old so we don't leak timing.
        const { results: receivedWeekly } = await env.DB.prepare(
          `SELECT round_number, note, written_at
           FROM secret_sister_pairings
           WHERE receiver_id = ? AND note != ''
             AND written_at IS NOT NULL
             AND julianday(written_at) <= julianday('now', ${SS_DELIVERY_DELAY_SQL})
           ORDER BY round_number DESC`
        ).bind(userId).all();
        // Also pull retreat-time received note, but only if admin has flipped
        // the reveal toggle — same gate the retreat-time game uses.
        let receivedRetreat = [];
        try {
          const reveal = await env.DB.prepare(
            "SELECT value FROM game_settings WHERE key = 'secret_sister_reveal'"
          ).first();
          if (reveal && reveal.value === '1') {
            const row = await env.DB.prepare(
              `SELECT note, created_at AS written_at
               FROM secret_sister
               WHERE receiver_id = ? AND note IS NOT NULL AND note != ''`
            ).bind(userId).first();
            if (row) receivedRetreat = [Object.assign({ round_number: 0 }, row)];
          }
        } catch (e) { /* table may not exist on a fresh deploy */ }
        // Admin-sent anonymous notes — these show alongside regular received
        // notes in the Received tab, indistinguishable from a sister's note.
        let receivedAdmin = [];
        try {
          const { results } = await env.DB.prepare(
            `SELECT round_number, note, written_at
             FROM secret_sister_admin_notes
             WHERE recipient_user_id = ?
             ORDER BY round_number DESC`
          ).bind(userId).all();
          receivedAdmin = results || [];
        } catch (e) { /* table may not exist yet */ }
        const received = [...(receivedWeekly || []), ...receivedAdmin, ...receivedRetreat];

        return json({
          sent,
          received
        }, corsHeaders);
      }

      // GET /api/secretsister/status - admin: current round stats + pair list
      if (path === '/api/secretsister/status' && request.method === 'GET') {
        await ensureWeeklySSTable(env.DB);
        const round = getCurrentSSRound();
        const pairs = round > 0
          ? (await env.DB.prepare(
              'SELECT giver_name, receiver_name, note, written_at FROM secret_sister_pairings WHERE round_number = ? ORDER BY id'
            ).bind(round).all()).results
          : [];
        const writtenCount = (pairs || []).filter(p => p.note && p.note.trim()).length;
        const optOut = await env.DB.prepare(
          "SELECT COUNT(*) AS c FROM users WHERE COALESCE(secret_sister_opt_out, 0) = 1"
        ).first();
        return json({
          round,
          starts_at: new Date(SS_ANCHOR_UTC_MS).toISOString(),
          pair_count: pairs ? pairs.length : 0,
          written_count: writtenCount,
          opted_out_count: optOut ? optOut.c : 0,
          pairs: pairs || []
        }, corsHeaders);
      }

      // POST /api/secretsister/force-round - admin: lazily create pairings for
      // the current round right now (for testing). Non-destructive: if
      // pairings already exist, this is a no-op.
      if (path === '/api/secretsister/force-round' && request.method === 'POST') {
        await ensureWeeklySSTable(env.DB);
        const round = getCurrentSSRound();
        if (round === 0) {
          return json({ error: 'Weekly rotation has not started yet' }, corsHeaders, 400);
        }
        const created = await ensureSSRoundExists(env.DB, round);
        return json({ success: true, round, created }, corsHeaders);
      }

      // GET /api/secretsister/participation - admin: per-woman rotation stats
      // Returns every woman with her rounds_paired / notes_written /
      // notes_received / last_written / last_received. "Received" counts
      // both weekly pair notes AND admin-sent anonymous notes so the
      // dashboard stops flagging her as lonely once admin has intervened.
      if (path === '/api/secretsister/participation' && request.method === 'GET') {
        await ensureWeeklySSTable(env.DB);
        const currentRound = getCurrentSSRound();

        // Fetch all users
        const { results: users } = await env.DB.prepare(
          `SELECT id, first_name, COALESCE(last_initial, '') AS last_initial,
                  COALESCE(photo_data, '') AS photo_data,
                  COALESCE(secret_sister_opt_out, 0) AS opted_out
           FROM users
           WHERE first_name IS NOT NULL AND first_name != ''
           ORDER BY first_name`
        ).all();

        // Fetch all pairing rows (small table at ~50 women × N weeks)
        let pairings = [];
        try {
          const r = await env.DB.prepare(
            `SELECT round_number, giver_id, receiver_id, note, written_at
             FROM secret_sister_pairings`
          ).all();
          pairings = r.results || [];
        } catch (e) { /* table may not exist yet */ }

        // Fetch all admin-sent notes (also small)
        let adminNotes = [];
        try {
          const r = await env.DB.prepare(
            `SELECT round_number, recipient_user_id, note, written_at
             FROM secret_sister_admin_notes`
          ).all();
          adminNotes = r.results || [];
        } catch (e) { /* table may not exist yet */ }

        // Index by user_id for O(n) aggregation
        const givenBy = new Map();
        const receivedBy = new Map();
        for (const p of pairings) {
          if (!givenBy.has(p.giver_id)) givenBy.set(p.giver_id, []);
          givenBy.get(p.giver_id).push(p);
          if (p.note && p.note.trim()) {
            if (!receivedBy.has(p.receiver_id)) receivedBy.set(p.receiver_id, []);
            receivedBy.get(p.receiver_id).push(p);
          }
        }
        for (const a of adminNotes) {
          if (!receivedBy.has(a.recipient_user_id)) receivedBy.set(a.recipient_user_id, []);
          // Mark as admin-sent so the dashboard can show a small chip if desired
          receivedBy.get(a.recipient_user_id).push({ ...a, is_admin: true });
        }

        const rows = (users || []).map(u => {
          const given = givenBy.get(u.id) || [];
          const received = receivedBy.get(u.id) || [];
          const writtenNotes = given.filter(g => g.note && g.note.trim());
          const lastWrittenAt = writtenNotes.length
            ? writtenNotes.map(g => g.written_at).filter(Boolean).sort().slice(-1)[0]
            : null;
          const lastReceivedAt = received.length
            ? received.map(r => r.written_at).filter(Boolean).sort().slice(-1)[0]
            : null;
          // Check if the admin already sent to her THIS round (for the chip)
          const adminSentThisRound = adminNotes.some(
            a => a.recipient_user_id === u.id && a.round_number === currentRound
          );
          const displayName = u.last_initial ? `${u.first_name} ${u.last_initial}.` : u.first_name;
          return {
            user_id: u.id,
            name: displayName,
            photo_data: u.photo_data || '',
            opted_out: !!u.opted_out,
            rounds_paired: given.length,
            notes_written: writtenNotes.length,
            notes_received: received.length,
            last_written_at: lastWrittenAt,
            last_received_at: lastReceivedAt,
            admin_sent_this_round: adminSentThisRound
          };
        });

        return json({
          round: currentRound,
          users: rows
        }, corsHeaders);
      }

      // POST /api/secretsister/admin-send - admin sends an anonymous note to
      // a specific recipient. Note shows up in her scrapbook as just another
      // "Your Secret Sister 💛" note — no hint it came from admin. Multiple
      // sends per week allowed (admin judgment).
      if (path === '/api/secretsister/admin-send' && request.method === 'POST') {
        const { recipient_user_id, note } = await request.json();
        if (!recipient_user_id || !note || !note.trim()) {
          return json({ error: 'Recipient and note are required' }, corsHeaders, 400);
        }
        if (containsBlockedWords(note)) {
          return json({ error: 'Please keep it kind and uplifting' }, corsHeaders, 400);
        }
        await ensureWeeklySSTable(env.DB);
        const round = getCurrentSSRound();
        // Look up the recipient's display name
        const user = await env.DB.prepare(
          "SELECT first_name, COALESCE(last_initial, '') AS last_initial FROM users WHERE id = ?"
        ).bind(recipient_user_id).first();
        if (!user) return json({ error: 'Recipient not found' }, corsHeaders, 404);
        const recipientName = user.last_initial ? `${user.first_name} ${user.last_initial}.` : user.first_name;
        await env.DB.prepare(
          `INSERT INTO secret_sister_admin_notes (round_number, recipient_user_id, recipient_name, note)
           VALUES (?, ?, ?, ?)`
        ).bind(round, recipient_user_id, recipientName, note.trim()).run();
        return json({ success: true, round, recipient: recipientName }, corsHeaders);
      }

      // ===== BUDGET & PAYMENTS =====
      // Password gate. Single shared password stored in game_settings as a
      // SHA-256 hash. First visit prompts the admin to SET a password; later
      // visits CHECK it. No per-person accounts — this is a thin gate to keep
      // financial data separate from casual admin URL sharing.

      // Budget categories table (lazy-created on first hit)
      async function ensureBudgetCategoriesTable() {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS budget_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            planned REAL DEFAULT 0,
            actual REAL DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`).run();
        } catch (e) { /* already exists */ }
        // Child table: one row per uploaded receipt. r2_key points into the
        // VIDEOS R2 bucket (reused for all file storage).
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS budget_receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            r2_key TEXT NOT NULL,
            content_type TEXT DEFAULT '',
            size_bytes INTEGER DEFAULT 0,
            uploaded_at TEXT DEFAULT (datetime('now'))
          )`).run();
        } catch (e) { /* already exists */ }
      }

      // GET /api/budget/categories - list all categories
      if (path === '/api/budget/categories' && request.method === 'GET') {
        await ensureBudgetCategoriesTable();
        const { results } = await env.DB.prepare(
          'SELECT id, name, planned, actual, sort_order FROM budget_categories ORDER BY sort_order, id'
        ).all();
        return json({ categories: results || [] }, corsHeaders);
      }

      // POST /api/budget/categories - create a new category
      if (path === '/api/budget/categories' && request.method === 'POST') {
        const body = await request.json();
        const name = (body && body.name || '').toString().trim();
        if (!name) return json({ error: 'Name is required' }, corsHeaders, 400);
        const planned = parseFloat(body.planned) || 0;
        const actual = parseFloat(body.actual) || 0;
        const sortOrder = parseInt(body.sort_order, 10) || 0;
        await ensureBudgetCategoriesTable();
        const result = await env.DB.prepare(
          'INSERT INTO budget_categories (name, planned, actual, sort_order) VALUES (?, ?, ?, ?)'
        ).bind(name, planned, actual, sortOrder).run();
        return json({ success: true, id: result.meta ? result.meta.last_row_id : null }, corsHeaders);
      }

      // PATCH /api/budget/categories/:id - update a category
      const budgetCatUpdateMatch = path.match(/^\/api\/budget\/categories\/(\d+)$/);
      if (budgetCatUpdateMatch && request.method === 'PATCH') {
        const id = parseInt(budgetCatUpdateMatch[1], 10);
        const body = await request.json();
        await ensureBudgetCategoriesTable();
        const fields = [];
        const values = [];
        if (body.name !== undefined) { fields.push('name = ?'); values.push(String(body.name).trim()); }
        if (body.planned !== undefined) { fields.push('planned = ?'); values.push(parseFloat(body.planned) || 0); }
        if (body.actual !== undefined) { fields.push('actual = ?'); values.push(parseFloat(body.actual) || 0); }
        if (body.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(parseInt(body.sort_order, 10) || 0); }
        if (!fields.length) return json({ error: 'No fields to update' }, corsHeaders, 400);
        values.push(id);
        await env.DB.prepare(`UPDATE budget_categories SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        return json({ success: true }, corsHeaders);
      }

      // DELETE /api/budget/categories/:id - delete a category
      if (budgetCatUpdateMatch && request.method === 'DELETE') {
        const id = parseInt(budgetCatUpdateMatch[1], 10);
        await ensureBudgetCategoriesTable();
        await env.DB.prepare('DELETE FROM budget_categories WHERE id = ?').bind(id).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/budget/categories/:id/receipts - upload a receipt file.
      // Expects multipart/form-data with a "file" part. Stores in R2 under
      // budget/receipts/{categoryId}/{random}-{filename}.
      const budgetReceiptUploadMatch = path.match(/^\/api\/budget\/categories\/(\d+)\/receipts$/);
      if (budgetReceiptUploadMatch && request.method === 'POST') {
        const categoryId = parseInt(budgetReceiptUploadMatch[1], 10);
        await ensureBudgetCategoriesTable();
        const contentType = request.headers.get('content-type') || '';
        if (!contentType.includes('multipart/form-data')) {
          return json({ error: 'Expected multipart/form-data' }, corsHeaders, 400);
        }
        try {
          const form = await request.formData();
          const file = form.get('file');
          if (!file || typeof file === 'string') {
            return json({ error: 'No file in form' }, corsHeaders, 400);
          }
          if (file.size > 10 * 1024 * 1024) {
            return json({ error: 'File too large (10 MB max)' }, corsHeaders, 400);
          }
          const ALLOWED_RECEIPT_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/heic','application/pdf'];
          if (file.type && !ALLOWED_RECEIPT_TYPES.some(t => file.type.toLowerCase().startsWith(t))) {
            return json({ error: 'Invalid file type. Upload an image or PDF.' }, corsHeaders, 400);
          }
          const originalName = (file.name || 'receipt').replace(/[^a-zA-Z0-9._-]/g, '_');
          const rand = Math.random().toString(36).slice(2, 10);
          const r2Key = `budget/receipts/${categoryId}/${Date.now()}-${rand}-${originalName}`;
          await env.VIDEOS.put(r2Key, file.stream(), {
            httpMetadata: { contentType: file.type || 'application/octet-stream' }
          });
          await env.DB.prepare(
            'INSERT INTO budget_receipts (category_id, filename, r2_key, content_type, size_bytes) VALUES (?, ?, ?, ?, ?)'
          ).bind(categoryId, originalName, r2Key, file.type || '', file.size || 0).run();
          return json({ success: true }, corsHeaders);
        } catch (e) {
          return json({ error: 'Upload failed: ' + e.message }, corsHeaders, 500);
        }
      }

      // GET /api/budget/categories/:id/receipts - list receipts for a category
      if (budgetReceiptUploadMatch && request.method === 'GET') {
        const categoryId = parseInt(budgetReceiptUploadMatch[1], 10);
        await ensureBudgetCategoriesTable();
        const { results } = await env.DB.prepare(
          'SELECT id, filename, content_type, size_bytes, uploaded_at FROM budget_receipts WHERE category_id = ? ORDER BY uploaded_at DESC'
        ).bind(categoryId).all();
        return json({ receipts: results || [] }, corsHeaders);
      }

      // GET /api/budget/receipts/:id/file - stream the receipt from R2
      const budgetReceiptFileMatch = path.match(/^\/api\/budget\/receipts\/(\d+)\/file$/);
      if (budgetReceiptFileMatch && request.method === 'GET') {
        const receiptId = parseInt(budgetReceiptFileMatch[1], 10);
        await ensureBudgetCategoriesTable();
        const row = await env.DB.prepare(
          'SELECT r2_key, filename, content_type FROM budget_receipts WHERE id = ?'
        ).bind(receiptId).first();
        if (!row) return json({ error: 'Receipt not found' }, corsHeaders, 404);
        const obj = await env.VIDEOS.get(row.r2_key);
        if (!obj) return json({ error: 'File missing from storage' }, corsHeaders, 404);
        return new Response(obj.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': row.content_type || 'application/octet-stream',
            'Content-Disposition': `inline; filename="${row.filename || 'receipt'}"`
          }
        });
      }

      // DELETE /api/budget/receipts/:id - delete a receipt
      const budgetReceiptDeleteMatch = path.match(/^\/api\/budget\/receipts\/(\d+)$/);
      if (budgetReceiptDeleteMatch && request.method === 'DELETE') {
        const receiptId = parseInt(budgetReceiptDeleteMatch[1], 10);
        await ensureBudgetCategoriesTable();
        const row = await env.DB.prepare(
          'SELECT r2_key FROM budget_receipts WHERE id = ?'
        ).bind(receiptId).first();
        if (row && row.r2_key) {
          try { await env.VIDEOS.delete(row.r2_key); } catch (e) { /* ignore */ }
        }
        await env.DB.prepare('DELETE FROM budget_receipts WHERE id = ?').bind(receiptId).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/budget/categories/seed - insert Heather's default list
      // if the table is empty. No-op if any rows exist.
      if (path === '/api/budget/categories/seed' && request.method === 'POST') {
        await ensureBudgetCategoriesTable();
        const existing = await env.DB.prepare('SELECT COUNT(*) AS c FROM budget_categories').first();
        if (existing && existing.c > 0) return json({ success: true, seeded: 0 }, corsHeaders);
        const defaults = [
          'Food',
          'Table gift (3)',
          'Dinner',
          'Dessert',
          'Party',
          'Misc Supplies',
          'Welcome bags',
          'Table snacks',
          'Table decor',
          'Give aways'
        ];
        for (let i = 0; i < defaults.length; i++) {
          await env.DB.prepare(
            'INSERT INTO budget_categories (name, planned, actual, sort_order) VALUES (?, 0, 0, ?)'
          ).bind(defaults[i], i).run();
        }
        return json({ success: true, seeded: defaults.length }, corsHeaders);
      }

      // GET /api/budget/calculator/state - pull all retreat_calc_* settings
      // back as a single object so the calculator can rehydrate its inputs
      // on page load. Storing in game_settings means these values persist
      // across devices — if Heather types numbers on her phone, her laptop
      // sees the same state.
      if (path === '/api/budget/calculator/state' && request.method === 'GET') {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
          )`).run();
        } catch (e) { /* exists */ }
        const { results } = await env.DB.prepare(
          "SELECT key, value FROM game_settings WHERE key LIKE 'retreat_calc_%'"
        ).all();
        const state = {};
        (results || []).forEach(r => { state[r.key] = r.value; });
        return json({ state }, corsHeaders);
      }

      // POST /api/budget/calculator/state - upsert a batch of calculator
      // field values. Accepts any object whose keys start with
      // retreat_calc_ (anything else is silently ignored for safety).
      if (path === '/api/budget/calculator/state' && request.method === 'POST') {
        const body = await request.json();
        if (!body || typeof body !== 'object') {
          return json({ error: 'Expected object body' }, corsHeaders, 400);
        }
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
          )`).run();
        } catch (e) { /* exists */ }
        for (const key of Object.keys(body)) {
          if (!key.startsWith('retreat_calc_')) continue;
          const value = body[key] == null ? '' : String(body[key]);
          await env.DB.prepare(
            "INSERT INTO game_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
          ).bind(key, value).run();
        }
        return json({ success: true }, corsHeaders);
      }

      // GET /api/budget/auth/status - does a password exist yet?
      if (path === '/api/budget/auth/status' && request.method === 'GET') {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_settings (
            key TEXT PRIMARY KEY,
            value TEXT DEFAULT ''
          )`).run();
          const row = await env.DB.prepare(
            "SELECT value FROM game_settings WHERE key = 'budget_password_hash'"
          ).first();
          return json({ has_password: !!(row && row.value) }, corsHeaders);
        } catch (e) {
          return json({ has_password: false }, corsHeaders);
        }
      }

      // POST /api/budget/auth/set - set the password for the FIRST time.
      // Rejects if a password is already set (rotation is a separate flow).
      if (path === '/api/budget/auth/set' && request.method === 'POST') {
        const { password_hash } = await request.json();
        if (!password_hash || typeof password_hash !== 'string' || password_hash.length < 10) {
          return json({ error: 'Invalid password hash' }, corsHeaders, 400);
        }
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_settings (
          key TEXT PRIMARY KEY,
          value TEXT DEFAULT ''
        )`).run();
        const existing = await env.DB.prepare(
          "SELECT value FROM game_settings WHERE key = 'budget_password_hash'"
        ).first();
        if (existing && existing.value) {
          return json({ error: 'Password already set. Ask the admin who set it or reset via D1.' }, corsHeaders, 409);
        }
        await env.DB.prepare(
          "INSERT INTO game_settings (key, value) VALUES ('budget_password_hash', ?)"
        ).bind(password_hash).run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/budget/auth/check - verify a password attempt
      if (path === '/api/budget/auth/check' && request.method === 'POST') {
        const { password_hash } = await request.json();
        if (!password_hash) return json({ ok: false }, corsHeaders, 400);
        const row = await env.DB.prepare(
          "SELECT value FROM game_settings WHERE key = 'budget_password_hash'"
        ).first();
        if (!row || !row.value) return json({ ok: false, error: 'No password set' }, corsHeaders, 400);
        const ok = row.value === password_hash;
        return json({ ok }, corsHeaders);
      }

      // ===== FEEDBACK =====

      // POST /api/feedback - submit retreat feedback
      // Everything is optional. A blank submission is still a valid signal.
      if (path === '/api/feedback' && request.method === 'POST') {
        const body = await request.json();
        // Coerce to integer if present, null if missing/zero
        const rating = body.rating ? parseInt(body.rating, 10) || null : null;

        // Ensure the feedback table exists in case this is a fresh deploy.
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT DEFAULT 'Anonymous',
            rating INTEGER,
            favorite TEXT DEFAULT '',
            improve TEXT DEFAULT '',
            come_again TEXT DEFAULT '',
            other TEXT DEFAULT '',
            liked_most TEXT DEFAULT '',
            liked_least TEXT DEFAULT '',
            ratings TEXT DEFAULT '',
            rating_comments TEXT DEFAULT '',
            more_of TEXT DEFAULT '',
            invite_friend TEXT DEFAULT '',
            final_thoughts TEXT DEFAULT '',
            speakers TEXT DEFAULT '',
            app_feedback TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
          )`).run();
        } catch(e) { /* table exists */ }

        // Lazy migration: add every column the INSERT uses if it's missing.
        // Covers both the original columns (name, rating, favorite, etc.)
        // and the newer ones added over time. Self-heals regardless of how
        // old the production table is. Each ALTER is in its own try so one
        // failure doesn't block the rest. Note: rating (singular, overall
        // star 1-5) is DIFFERENT from ratings (plural, JSON breakdown).
        const feedbackCols = [
          ['user_id', 'INTEGER'],
          ['name', "TEXT DEFAULT 'Anonymous'"],
          ['rating', 'INTEGER'],
          ['favorite', "TEXT DEFAULT ''"],
          ['improve', "TEXT DEFAULT ''"],
          ['come_again', "TEXT DEFAULT ''"],
          ['other', "TEXT DEFAULT ''"],
          ['liked_most', "TEXT DEFAULT ''"],
          ['liked_least', "TEXT DEFAULT ''"],
          ['ratings', "TEXT DEFAULT ''"],
          ['rating_comments', "TEXT DEFAULT ''"],
          ['more_of', "TEXT DEFAULT ''"],
          ['invite_friend', "TEXT DEFAULT ''"],
          ['final_thoughts', "TEXT DEFAULT ''"],
          ['speakers', "TEXT DEFAULT ''"],
          ['app_feedback', "TEXT DEFAULT ''"],
        ];
        for (const [col, type] of feedbackCols) {
          try { await env.DB.prepare(`ALTER TABLE feedback ADD COLUMN ${col} ${type}`).run(); } catch(e) { /* exists */ }
        }

        await env.DB.prepare(
          'INSERT INTO feedback (user_id, name, rating, favorite, improve, come_again, other, liked_most, liked_least, ratings, rating_comments, more_of, invite_friend, final_thoughts, speakers, app_feedback) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
          body.user_id || null,
          body.name || 'Anonymous',
          rating,
          body.favorite || '',
          body.improve || '',
          body.come_again || '',
          body.other || '',
          body.liked_most || '',
          body.liked_least || '',
          body.ratings || '',
          body.rating_comments || '',
          body.more_of || '',
          body.invite_friend || '',
          body.final_thoughts || '',
          body.speakers || '',
          body.app_feedback || ''
        ).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/feedback - get all feedback (for you to review)
      if (path === '/api/feedback' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM feedback ORDER BY created_at DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // GET /api/feedback/mine?user_id=X&name=Name - has THIS user submitted?
      // Used by the client to reconcile its localStorage "already sent" flag
      // with what the server actually has, so women who hit a silent save
      // failure automatically get the form back on their next page load.
      // Matches by user_id OR by name so we find the row even if user_id
      // drifted (e.g. re-signup, legacy null user_id from early rows).
      if (path === '/api/feedback/mine' && request.method === 'GET') {
        const userId = parseInt(url.searchParams.get('user_id') || '0', 10);
        const name = (url.searchParams.get('name') || '').trim();
        if (!userId && !name) return json({ submitted: false }, corsHeaders);
        let row = null;
        try {
          if (userId) {
            row = await env.DB.prepare(
              'SELECT id FROM feedback WHERE user_id = ? LIMIT 1'
            ).bind(userId).first();
          }
          if (!row && name) {
            row = await env.DB.prepare(
              'SELECT id FROM feedback WHERE name = ? LIMIT 1'
            ).bind(name).first();
          }
        } catch(e) {
          // If the query errors (e.g. schema drift), fail CLOSED so we
          // don't auto-clear the local flag. Better to leave the form
          // hidden than to nag someone who already submitted.
          return json({ submitted: true, error: 'lookup_failed' }, corsHeaders);
        }
        return json({ submitted: !!row }, corsHeaders);
      }

      // ===== JOURNAL ACTIVITY (privacy-safe usage tracking) =====
      // The journal itself lives in each woman's localStorage — the server
      // never sees entry content. This endpoint only logs METADATA each
      // time she saves something: user id, optional gift tag, character
      // count, timestamp. Admin stats roll up these rows to show adoption
      // without reading a single word of what she wrote.
      const ensureJournalActivityTable = async () => {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS journal_activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT DEFAULT '',
            gift_tag TEXT DEFAULT '',
            char_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`).run();
        } catch(e) { /* exists */ }
      };

      // POST /api/journal/activity - fire and forget from the client after
      // she saves an entry locally. No content is sent or stored.
      if (path === '/api/journal/activity' && request.method === 'POST') {
        await ensureJournalActivityTable();
        const body = await request.json();
        await env.DB.prepare(
          'INSERT INTO journal_activity (user_id, name, gift_tag, char_count) VALUES (?, ?, ?, ?)'
        ).bind(
          body.user_id ? parseInt(body.user_id) : null,
          (body.name || '').slice(0, 100),
          (body.gift_tag || '').slice(0, 50),
          parseInt(body.char_count || 0) || 0
        ).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/journal/activity/stats - admin roll-up of journal usage
      if (path === '/api/journal/activity/stats' && request.method === 'GET') {
        await ensureJournalActivityTable();
        try {
          const [totalRow, uniqueRow] = await Promise.all([
            env.DB.prepare('SELECT COUNT(*) as c FROM journal_activity').first(),
            env.DB.prepare('SELECT COUNT(DISTINCT user_id) as c FROM journal_activity WHERE user_id IS NOT NULL').first()
          ]);
          const total = (totalRow && totalRow.c) || 0;
          const uniqueUsers = (uniqueRow && uniqueRow.c) || 0;
          // Top gift tags (which devotions are generating reflections)
          const { results: topGifts } = await env.DB.prepare(
            `SELECT gift_tag, COUNT(*) as c FROM journal_activity
             WHERE gift_tag IS NOT NULL AND gift_tag != ''
             GROUP BY gift_tag ORDER BY c DESC LIMIT 20`
          ).all();
          // Most recent entry
          const latestRow = await env.DB.prepare(
            'SELECT created_at FROM journal_activity ORDER BY created_at DESC LIMIT 1'
          ).first();
          // First entry (to show span)
          const firstRow = await env.DB.prepare(
            'SELECT created_at FROM journal_activity ORDER BY created_at ASC LIMIT 1'
          ).first();
          // Names of women who have journaled (from activity pings)
          // Join with users table to get names for user_ids
          let writers = [];
          try {
            const { results: writerRows } = await env.DB.prepare(
              `SELECT ja.user_id, ja.name, COUNT(*) as entry_count,
                      MAX(ja.created_at) as last_entry,
                      u.first_name, u.last_name
               FROM journal_activity ja
               LEFT JOIN users u ON ja.user_id = u.id
               WHERE ja.user_id IS NOT NULL
               GROUP BY ja.user_id
               ORDER BY last_entry DESC`
            ).all();
            writers = (writerRows || []).map(r => ({
              user_id: r.user_id,
              name: r.first_name ? (r.first_name + (r.last_name ? ' ' + r.last_name.charAt(0) + '.' : '')) : r.name,
              entries: r.entry_count,
              last: r.last_entry
            }));
          } catch(e) { /* writers list is best-effort */ }
          return json({
            total,
            uniqueUsers,
            avgPerUser: uniqueUsers ? Math.round((total / uniqueUsers) * 10) / 10 : 0,
            topGifts: topGifts || [],
            firstEntry: firstRow ? firstRow.created_at : null,
            latestEntry: latestRow ? latestRow.created_at : null,
            writers
          }, corsHeaders);
        } catch(e) {
          return json({ total: 0, uniqueUsers: 0, avgPerUser: 0, topGifts: [], error: e.message }, corsHeaders);
        }
      }

      // ===== JOURNAL SYNC (cross-device) =====

      const ensureJournalEntriesTable = async () => {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS journal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            entry_date TEXT NOT NULL,
            text TEXT NOT NULL DEFAULT '',
            gift TEXT DEFAULT '',
            gift_label TEXT DEFAULT '',
            week INTEGER DEFAULT 0,
            prompt_key TEXT DEFAULT '',
            prompt_text TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
          )`).run();
        } catch(e) { /* exists */ }
      };

      // POST /api/journal/sync — client sends its local entries, server
      // merges and returns the full set. Dedup by (user_id, entry_date, text).
      if (path === '/api/journal/sync' && request.method === 'POST') {
        await ensureJournalEntriesTable();
        try {
          const body = await request.json();
          const userId = parseInt(body.user_id);
          if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);
          const clientEntries = Array.isArray(body.entries) ? body.entries : [];

          // Insert any client entries the server doesn't have yet
          for (const e of clientEntries) {
            if (!e.date || !e.text) continue;
            const exists = await env.DB.prepare(
              'SELECT id FROM journal_entries WHERE user_id = ? AND entry_date = ? AND text = ? LIMIT 1'
            ).bind(userId, e.date, e.text.slice(0, 10000)).first();
            if (!exists) {
              await env.DB.prepare(
                `INSERT INTO journal_entries (user_id, entry_date, text, gift, gift_label, week, prompt_key, prompt_text)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                userId,
                e.date,
                (e.text || '').slice(0, 10000),
                (e.gift || ''),
                (e.gift_label || ''),
                parseInt(e.week || 0) || 0,
                (e.prompt_key || ''),
                (e.prompt_text || '')
              ).run();
            }
          }

          // Return all server entries for this user
          const { results } = await env.DB.prepare(
            'SELECT entry_date, text, gift, gift_label, week, prompt_key, prompt_text FROM journal_entries WHERE user_id = ? ORDER BY entry_date DESC'
          ).bind(userId).all();

          const entries = (results || []).map(r => {
            const entry = { date: r.entry_date, text: r.text };
            if (r.gift) entry.gift = r.gift;
            if (r.gift_label) entry.gift_label = r.gift_label;
            if (r.week) entry.week = r.week;
            if (r.prompt_key) entry.prompt_key = r.prompt_key;
            if (r.prompt_text) entry.prompt_text = r.prompt_text;
            return entry;
          });

          return json({ entries }, corsHeaders);
        } catch(e) {
          return json({ error: e.message }, corsHeaders, 500);
        }
      }

      // DELETE /api/journal/entry — remove a single entry by date+text
      if (path === '/api/journal/entry' && request.method === 'DELETE') {
        await ensureJournalEntriesTable();
        try {
          const body = await request.json();
          const userId = parseInt(body.user_id);
          if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);
          await env.DB.prepare(
            'DELETE FROM journal_entries WHERE user_id = ? AND entry_date = ? AND text = ?'
          ).bind(userId, body.date || '', (body.text || '').slice(0, 10000)).run();
          return json({ success: true }, corsHeaders);
        } catch(e) {
          return json({ error: e.message }, corsHeaders, 500);
        }
      }

      // ===== LOVE MESSAGES (MARNIE) =====

      // POST /api/lovemessages
      // Accepts either:
      //   - application/json with { user_id, name, message, video_data? }
      //     (legacy path, used for text-only submissions)
      //   - multipart/form-data with user_id, name, message, and a file
      //     field named "video" (used when a video is attached so we can
      //     stream the binary directly instead of JSON-wrapping it)
      if (path === '/api/lovemessages' && request.method === 'POST') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS love_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', message TEXT DEFAULT '', video_data TEXT DEFAULT '', has_video INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) {}

        const contentType = request.headers.get('content-type') || '';
        let user_id = null, name = 'Anonymous', message = '', videoKey = '', hasVideo = 0;

        if (contentType.indexOf('multipart/form-data') !== -1) {
          // FormData path: stream the video file directly to R2
          const formData = await request.formData();
          user_id = formData.get('user_id');
          name = (formData.get('name') || 'Anonymous').toString();
          message = (formData.get('message') || '').toString();
          const file = formData.get('video');
          if (file && typeof file === 'object' && file.size > 0 && env.VIDEOS) {
            if (file.size > 80 * 1024 * 1024) {
              return json({ error: 'Video too large (80 MB max)' }, corsHeaders, 400);
            }
            if (!isAllowedVideoType(file.type)) {
              return json({ error: 'Invalid video type' }, corsHeaders, 400);
            }
            videoKey = 'love-' + Date.now() + '-' + (user_id || 0);
            try {
              const arrayBuffer = await file.arrayBuffer();
              await env.VIDEOS.put(videoKey, arrayBuffer, {
                httpMetadata: { contentType: file.type || 'video/mp4' }
              });
              hasVideo = 1;
            } catch(e) {
              return json({ error: 'Video upload failed: ' + (e.message || 'unknown') }, corsHeaders, 500);
            }
          }
          if (!message && !hasVideo) {
            return json({ error: 'Please include a message or video' }, corsHeaders, 400);
          }
        } else {
          // Legacy JSON path (text-only or small base64 video)
          const body = await request.json();
          user_id = body.user_id || null;
          name = body.name || 'Anonymous';
          message = body.message || '';
          if (!message && !body.video_data) {
            return json({ error: 'Please include a message or video' }, corsHeaders, 400);
          }
          if (body.video_data && body.video_data.length > 0 && env.VIDEOS) {
            videoKey = 'love-' + Date.now() + '-' + (user_id || 0);
            try {
              const base64 = body.video_data.split(',')[1] || body.video_data;
              const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
              await env.VIDEOS.put(videoKey, binary, { httpMetadata: { contentType: 'video/mp4' } });
              hasVideo = 1;
            } catch(e) {
              videoKey = '';
            }
          }
        }

        await env.DB.prepare(
          'INSERT INTO love_messages (user_id, name, message, video_data, has_video) VALUES (?, ?, ?, ?, ?)'
        ).bind(
          user_id || null,
          name || 'Anonymous',
          (message || '').trim(),
          videoKey,
          hasVideo
        ).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/lovemessages
      if (path === '/api/lovemessages' && request.method === 'GET') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS love_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', message TEXT DEFAULT '', video_data TEXT DEFAULT '', has_video INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) {}

        const { results } = await env.DB.prepare(
          'SELECT id, user_id, name, message, video_data, has_video, created_at FROM love_messages ORDER BY created_at DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // GET /api/lovemessages/:id/video - stream video from R2
      const loveVideoMatch = path.match(/^\/api\/lovemessages\/(\d+)\/video$/);
      if (loveVideoMatch && request.method === 'GET') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS love_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', message TEXT DEFAULT '', video_data TEXT DEFAULT '', has_video INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) {}

        const msg = await env.DB.prepare('SELECT video_data FROM love_messages WHERE id = ?').bind(parseInt(loveVideoMatch[1])).first();
        if (!msg || !msg.video_data || !env.VIDEOS) {
          return json({ error: 'Video not found' }, corsHeaders, 404);
        }
        const obj = await env.VIDEOS.get(msg.video_data);
        if (!obj) return json({ error: 'Video not found' }, corsHeaders, 404);
        return new Response(obj.body, {
          headers: { ...corsHeaders, 'Content-Type': 'video/mp4', 'Cache-Control': 'public, max-age=86400' }
        });
      }

      // ===== GRATITUDE WALL =====

      // POST /api/gratitude - add a gratitude entry
      if (path === '/api/gratitude' && request.method === 'POST') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS gratitude (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) { /* exists */ }

        const body = await request.json();
        if (!body.text || !body.text.trim()) {
          return json({ error: 'Text is required' }, corsHeaders, 400);
        }
        if (body.text.trim().length > 60) {
          return json({ error: 'Keep it short — 60 characters max' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          'INSERT INTO gratitude (user_id, name, text) VALUES (?, ?, ?)'
        ).bind(
          body.user_id || null,
          body.name || 'Anonymous',
          body.text.trim()
        ).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/gratitude - get all entries
      if (path === '/api/gratitude' && request.method === 'GET') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS gratitude (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) { /* exists */ }

        const { results } = await env.DB.prepare(
          'SELECT id, user_id, name, text, created_at FROM gratitude ORDER BY created_at ASC'
        ).all();
        return json(results, corsHeaders);
      }

      // ===== SUGGESTIONS =====

      // POST /api/suggestions - submit a suggestion or feedback note
      if (path === '/api/suggestions' && request.method === 'POST') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', tag TEXT DEFAULT 'general', message TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) { /* exists */ }

        const body = await request.json();
        if (!body.message || !body.message.trim()) {
          return json({ error: 'Message is required' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          'INSERT INTO suggestions (user_id, name, tag, message) VALUES (?, ?, ?, ?)'
        ).bind(
          body.user_id || null,
          body.name || 'Anonymous',
          body.tag || 'general',
          body.message.trim()
        ).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/suggestions - get all suggestions (admin)
      if (path === '/api/suggestions' && request.method === 'GET') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', tag TEXT DEFAULT 'general', message TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) { /* exists */ }

        const { results } = await env.DB.prepare(
          'SELECT * FROM suggestions ORDER BY created_at DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // ===== THEME SUGGESTIONS (next year planning) =====

      // POST /api/theme-suggestions - submit a topic/theme idea for next year
      if (path === '/api/theme-suggestions' && request.method === 'POST') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS theme_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', suggestion TEXT NOT NULL, admin_starred INTEGER DEFAULT 0, admin_tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) { /* exists */ }

        const body = await request.json();
        if (!body.suggestion || !body.suggestion.trim()) {
          return json({ error: 'Suggestion text is required' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          'INSERT INTO theme_suggestions (user_id, name, suggestion) VALUES (?, ?, ?)'
        ).bind(
          body.user_id || null,
          body.name || 'Anonymous',
          body.suggestion.trim()
        ).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/theme-suggestions - admin: list all
      if (path === '/api/theme-suggestions' && request.method === 'GET') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS theme_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT DEFAULT 'Anonymous', suggestion TEXT NOT NULL, admin_starred INTEGER DEFAULT 0, admin_tags TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`).run(); } catch(e) { /* exists */ }

        const { results } = await env.DB.prepare(
          'SELECT * FROM theme_suggestions ORDER BY admin_starred DESC, created_at DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // DELETE /api/theme-suggestions/:id - admin
      const tsDeleteMatch = path.match(/^\/api\/theme-suggestions\/(\d+)$/);
      if (tsDeleteMatch && request.method === 'DELETE') {
        const tsId = parseInt(tsDeleteMatch[1]);
        await env.DB.prepare('DELETE FROM theme_suggestions WHERE id = ?').bind(tsId).run();
        return json({ success: true }, corsHeaders);
      }

      // PATCH /api/theme-suggestions/:id - admin: star/unstar or update tags
      if (tsDeleteMatch && request.method === 'PATCH') {
        const tsId = parseInt(tsDeleteMatch[1]);
        const body = await request.json();
        const updates = [];
        const values = [];
        if (typeof body.admin_starred !== 'undefined') {
          updates.push('admin_starred = ?');
          values.push(body.admin_starred ? 1 : 0);
        }
        if (typeof body.admin_tags === 'string') {
          updates.push('admin_tags = ?');
          values.push(body.admin_tags);
        }
        if (!updates.length) {
          return json({ error: 'No fields to update' }, corsHeaders, 400);
        }
        values.push(tsId);
        await env.DB.prepare('UPDATE theme_suggestions SET ' + updates.join(', ') + ' WHERE id = ?').bind(...values).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== CELEBRATIONS (birthdays + anniversaries) =====
      // Helper to ensure the celebration_messages table exists.
      const ensureCelebrationsTable = async () => {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS celebration_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipient_user_id INTEGER NOT NULL,
            sender_user_id INTEGER,
            sender_name TEXT DEFAULT 'Anonymous',
            sender_anonymous INTEGER DEFAULT 0,
            occasion TEXT NOT NULL,
            occasion_date TEXT NOT NULL,
            message_text TEXT DEFAULT '',
            has_heart INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (recipient_user_id) REFERENCES users(id),
            FOREIGN KEY (sender_user_id) REFERENCES users(id)
          )`).run();
        } catch(e) { /* exists */ }
        // Ensure anniversary columns on users
        for (const col of [['anniversary', 'TEXT DEFAULT ""'], ['show_anniversary', 'INTEGER DEFAULT 0']]) {
          try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN ${col[0]} ${col[1]}`).run(); } catch(e) { /* exists */ }
        }
      };

      // GET /api/celebrations/upcoming?days=7&user_id=X
      // Returns sisters with a visible birthday/anniversary in the next N days, excluding self.
      // Each row: { id (user id), first_name, last_initial, photo_data, occasion, month_day, days_away, is_today }
      if (path === '/api/celebrations/upcoming' && request.method === 'GET') {
        await ensureCelebrationsTable();
        const days = Math.max(1, Math.min(31, parseInt(url.searchParams.get('days') || '7', 10)));
        const requesterId = parseInt(url.searchParams.get('user_id') || '0', 10);
        const { results } = await env.DB.prepare(
          `SELECT id, first_name, last_initial, photo_data, birthday, anniversary, show_birthday, show_anniversary
           FROM users
           WHERE (show_birthday = 1 AND birthday IS NOT NULL AND birthday != '')
              OR (show_anniversary = 1 AND anniversary IS NOT NULL AND anniversary != '')`
        ).all();

        // Compute "days away" for any visible date in the next N days. We compare on
        // month-day only so years don't matter. All calculations use Eastern time
        // since the retreat community is in the Eastern US.
        const now = new Date();
        // Get current date in Eastern time
        const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const etYear = etNow.getFullYear();
        const etMonth = etNow.getMonth();
        const etDate = etNow.getDate();
        const upcoming = [];
        const pushIfWithinWindow = (user, occasion, dateStr) => {
          if (!dateStr) return;
          const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!m) return;
          const targetMonth = parseInt(m[2], 10) - 1;
          const targetDay = parseInt(m[3], 10);
          // Build the next occurrence (this year or next) using plain date math
          // (no UTC — we just need day-level comparison in Eastern time)
          let targetOrdinal = (targetMonth * 31 + targetDay); // rough ordinal for comparison
          let todayOrdinal = (etMonth * 31 + etDate);
          let daysAway;
          // Use Date objects for accurate day diff
          let target = new Date(etYear, targetMonth, targetDay);
          let today = new Date(etYear, etMonth, etDate);
          if (target < today) {
            target = new Date(etYear + 1, targetMonth, targetDay);
          }
          daysAway = Math.round((target - today) / (1000 * 60 * 60 * 24));
          if (daysAway > days) return;
          upcoming.push({
            user_id: user.id,
            first_name: user.first_name,
            last_initial: user.last_initial,
            photo_data: user.photo_data || '',
            occasion: occasion,
            month_day: m[2] + '-' + m[3],
            year_of_event: target.getUTCFullYear(),
            occasion_date: target.getUTCFullYear() + '-' + m[2] + '-' + m[3],
            days_away: daysAway,
            is_today: daysAway === 0
          });
        };
        for (const u of results) {
          if (u.id === requesterId) continue;
          if (u.show_birthday) pushIfWithinWindow(u, 'birthday', u.birthday);
          if (u.show_anniversary) pushIfWithinWindow(u, 'anniversary', u.anniversary);
        }
        upcoming.sort((a, b) => a.days_away - b.days_away);

        // Flag each upcoming celebration the requester has already sent to,
        // so the client can show "Sent" instead of the action buttons.
        if (requesterId && upcoming.length) {
          const { results: sent } = await env.DB.prepare(
            `SELECT recipient_user_id, occasion_date FROM celebration_messages
             WHERE sender_user_id = ?`
          ).bind(requesterId).all();
          const sentSet = new Set((sent || []).map(s => s.recipient_user_id + '|' + s.occasion_date));
          upcoming.forEach(u => {
            u.already_sent = sentSet.has(u.user_id + '|' + u.occasion_date) ? 1 : 0;
          });
        }

        return json(upcoming, corsHeaders);
      }

      // POST /api/celebrations/send
      // body: { recipient_user_id, sender_user_id, sender_name, sender_anonymous,
      //         occasion ('birthday'|'anniversary'), occasion_date 'YYYY-MM-DD', message_text? }
      if (path === '/api/celebrations/send' && request.method === 'POST') {
        await ensureCelebrationsTable();
        const body = await request.json();
        if (!body.recipient_user_id || !body.occasion || !body.occasion_date) {
          return json({ error: 'Missing required fields' }, corsHeaders, 400);
        }
        if (body.occasion !== 'birthday' && body.occasion !== 'anniversary') {
          return json({ error: 'Invalid occasion' }, corsHeaders, 400);
        }

        // Dedupe: one heart/note per sender per recipient per occasion_date.
        // A woman should only be able to celebrate each sister's birthday /
        // anniversary once per year. Subsequent attempts are rejected.
        if (body.sender_user_id) {
          const existing = await env.DB.prepare(
            `SELECT id FROM celebration_messages
             WHERE sender_user_id = ? AND recipient_user_id = ? AND occasion_date = ?
             LIMIT 1`
          ).bind(
            parseInt(body.sender_user_id),
            parseInt(body.recipient_user_id),
            body.occasion_date
          ).first();
          if (existing) {
            return json({ error: 'already_sent', message: 'You\'ve already celebrated this one' }, corsHeaders, 409);
          }
        }

        await env.DB.prepare(
          `INSERT INTO celebration_messages
            (recipient_user_id, sender_user_id, sender_name, sender_anonymous, occasion, occasion_date, message_text, has_heart)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          parseInt(body.recipient_user_id),
          body.sender_user_id ? parseInt(body.sender_user_id) : null,
          body.sender_name || 'A G4 sister',
          body.sender_anonymous ? 1 : 0,
          body.occasion,
          body.occasion_date,
          (body.message_text || '').trim(),
          1
        ).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/celebrations/mine?user_id=X[&occasion_date=YYYY-MM-DD]
      // Returns all celebration messages for the requesting user.
      // If occasion_date is provided, only returns messages for that specific celebration.
      if (path === '/api/celebrations/mine' && request.method === 'GET') {
        await ensureCelebrationsTable();
        const userId = parseInt(url.searchParams.get('user_id') || '0', 10);
        if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);
        const occasionDate = url.searchParams.get('occasion_date') || '';
        let query = 'SELECT * FROM celebration_messages WHERE recipient_user_id = ?';
        const binds = [userId];
        if (occasionDate) {
          query += ' AND occasion_date = ?';
          binds.push(occasionDate);
        }
        query += ' ORDER BY created_at DESC';
        const { results } = await env.DB.prepare(query).bind(...binds).all();
        return json(results, corsHeaders);
      }

      // GET /api/celebrations/check-mine?user_id=X
      // Quick check: is today the user's birthday or anniversary? Returns the active occasion(s).
      if (path === '/api/celebrations/check-mine' && request.method === 'GET') {
        await ensureCelebrationsTable();
        const userId = parseInt(url.searchParams.get('user_id') || '0', 10);
        if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);
        const user = await env.DB.prepare('SELECT id, birthday, anniversary FROM users WHERE id = ?').bind(userId).first();
        if (!user) return json({ active: [] }, corsHeaders);
        const now = new Date();
        // Use Eastern time for "is today her birthday?" check
        const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const todayMD = String(etNow.getMonth() + 1).padStart(2, '0') + '-' + String(etNow.getDate()).padStart(2, '0');
        const active = [];
        const checkDate = (occasion, dateStr) => {
          if (!dateStr) return;
          const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!m) return;
          if ((m[2] + '-' + m[3]) === todayMD) {
            active.push({
              occasion: occasion,
              occasion_date: etNow.getFullYear() + '-' + m[2] + '-' + m[3]
            });
          }
        };
        checkDate('birthday', user.birthday);
        checkDate('anniversary', user.anniversary);
        return json({ active: active }, corsHeaders);
      }

      // GET /api/celebrations/all - admin: list all celebration messages
      if (path === '/api/celebrations/all' && request.method === 'GET') {
        await ensureCelebrationsTable();
        const { results } = await env.DB.prepare(
          'SELECT * FROM celebration_messages ORDER BY created_at DESC LIMIT 500'
        ).all();
        return json(results, corsHeaders);
      }

      // ===== TESTIMONIES (Stories of what God's doing) =====
      const ensureTestimoniesTable = async () => {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS testimonies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT DEFAULT 'Anonymous',
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
          )`).run();
        } catch(e) { /* exists */ }
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS testimony_hearts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            testimony_id INTEGER NOT NULL,
            user_id INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(testimony_id, user_id),
            FOREIGN KEY (testimony_id) REFERENCES testimonies(id)
          )`).run();
        } catch(e) { /* exists */ }
      };

      // POST /api/testimonies - submit a new story
      // Accepts either:
      //   - application/json for text-only submissions (or small base64 video
      //     from older cached clients): { user_id, name, anonymous, kind,
      //     text, video_data, gift_tag }
      //   - multipart/form-data for video submissions so the file streams as
      //     binary instead of being base64-wrapped in JSON. Fields:
      //       user_id, name, anonymous, kind, text, gift_tag, video (file)
      if (path === '/api/testimonies' && request.method === 'POST') {
        await ensureTestimoniesTable();
        const contentType = request.headers.get('content-type') || '';

        let user_id = null, name = 'A G4 sister', anonymous = 0, kind = 'text';
        let text = '', gift_tag = '', videoKey = '';

        if (contentType.indexOf('multipart/form-data') !== -1) {
          const formData = await request.formData();
          user_id = formData.get('user_id');
          name = (formData.get('name') || 'A G4 sister').toString();
          anonymous = formData.get('anonymous') ? 1 : 0;
          kind = (formData.get('kind') || 'text').toString() === 'video' ? 'video' : 'text';
          text = (formData.get('text') || '').toString().trim();
          gift_tag = (formData.get('gift_tag') || '').toString();
          const file = formData.get('video');
          if (kind === 'video') {
            if (!file || typeof file !== 'object' || file.size <= 0) {
              return json({ error: 'Video recording is required' }, corsHeaders, 400);
            }
            if (file.size > 80 * 1024 * 1024) {
              return json({ error: 'Video too large (80 MB max)' }, corsHeaders, 400);
            }
            if (!isAllowedVideoType(file.type)) {
              return json({ error: 'Invalid video type' }, corsHeaders, 400);
            }
            if (!env.VIDEOS) {
              return json({ error: 'Video storage not configured' }, corsHeaders, 500);
            }
            videoKey = 'testimony-' + Date.now() + '-' + (user_id || 0);
            try {
              const arrayBuffer = await file.arrayBuffer();
              await env.VIDEOS.put(videoKey, arrayBuffer, {
                httpMetadata: { contentType: file.type || 'video/mp4' }
              });
            } catch(e) {
              return json({ error: 'Video upload failed: ' + (e.message || 'unknown') }, corsHeaders, 500);
            }
          }
        } else {
          // Legacy JSON path (text-only or small base64 video)
          const body = await request.json();
          user_id = body.user_id;
          name = body.name || 'A G4 sister';
          anonymous = body.anonymous ? 1 : 0;
          kind = body.kind === 'video' ? 'video' : 'text';
          text = (body.text || '').trim();
          gift_tag = body.gift_tag || '';
          if (kind === 'video' && !body.video_data) {
            return json({ error: 'Video recording is required' }, corsHeaders, 400);
          }
          if (kind === 'video' && body.video_data && env.VIDEOS) {
            videoKey = 'testimony-' + Date.now() + '-' + (user_id || 0);
            try {
              const base64 = body.video_data.split(',')[1] || body.video_data;
              const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
              await env.VIDEOS.put(videoKey, binary, { httpMetadata: { contentType: 'video/mp4' } });
            } catch(e) {
              return json({ error: 'Video upload failed' }, corsHeaders, 500);
            }
          }
        }

        if (kind === 'text' && text.length < 10) {
          return json({ error: 'Please write at least a few sentences' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          `INSERT INTO testimonies (user_id, name, anonymous, kind, text, video_key, gift_tag, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).bind(
          user_id || null,
          name || 'A G4 sister',
          anonymous,
          kind,
          text,
          videoKey,
          gift_tag || ''
        ).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/testimonies/:id/video - stream a testimony video from R2
      // Admin preview: ?admin=1 bypasses the approval check so admins can
      // watch pending videos before deciding to approve or reject.
      const testimonyVideoMatch = path.match(/^\/api\/testimonies\/(\d+)\/video$/);
      if (testimonyVideoMatch && request.method === 'GET') {
        await ensureTestimoniesTable();
        const tid = parseInt(testimonyVideoMatch[1]);
        const isAdminReq = isAdmin(request);
        const row = await env.DB.prepare('SELECT video_key, status FROM testimonies WHERE id = ?').bind(tid).first();
        if (!row || !row.video_key || !env.VIDEOS) {
          return json({ error: 'Video not found' }, corsHeaders, 404);
        }
        // Public access: only approved/featured. Admin access: any status.
        if (!isAdminReq && row.status !== 'approved' && row.status !== 'featured') {
          return json({ error: 'Not available' }, corsHeaders, 404);
        }
        const obj = await env.VIDEOS.get(row.video_key);
        if (!obj) return json({ error: 'Video not found' }, corsHeaders, 404);
        return new Response(obj.body, {
          headers: { ...corsHeaders, 'Content-Type': 'video/mp4', 'Cache-Control': 'public, max-age=86400' }
        });
      }

      // GET /api/testimonies - public feed of approved + featured stories
      // ?user_id=X to mark which ones the requester has hearted
      if (path === '/api/testimonies' && request.method === 'GET') {
        await ensureTestimoniesTable();
        // Ensure comments table exists
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS testimony_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          testimony_id INTEGER NOT NULL,
          user_id INTEGER,
          name TEXT DEFAULT 'A G4 sister',
          text TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run(); } catch(e) {}
        const requesterId = parseInt(url.searchParams.get('user_id') || '0', 10);
        const { results } = await env.DB.prepare(
          `SELECT * FROM testimonies WHERE status IN ('approved', 'featured')
           ORDER BY featured DESC, created_at DESC LIMIT 200`
        ).all();
        // Mark which stories the requester has hearted
        let heartedSet = new Set();
        if (requesterId) {
          const { results: hearts } = await env.DB.prepare(
            'SELECT testimony_id FROM testimony_hearts WHERE user_id = ?'
          ).bind(requesterId).all();
          heartedSet = new Set(hearts.map(h => h.testimony_id));
        }
        // Comment counts per story
        let commentCounts = {};
        try {
          const { results: cc } = await env.DB.prepare(
            'SELECT testimony_id, COUNT(*) as c FROM testimony_comments GROUP BY testimony_id'
          ).all();
          (cc || []).forEach(r => { commentCounts[r.testimony_id] = r.c; });
        } catch(e) {}
        const out = (results || []).map(t => {
          const display = t.anonymous ? { name: 'A G4 sister' } : { name: t.name };
          return Object.assign({}, t, {
            display_name: display.name,
            i_hearted: heartedSet.has(t.id) ? 1 : 0,
            comment_count: commentCounts[t.id] || 0
          });
        });
        return json(out, corsHeaders);
      }

      // GET /api/testimonies/all - admin: list everything (pending/approved/rejected/featured)
      if (path === '/api/testimonies/all' && request.method === 'GET') {
        await ensureTestimoniesTable();
        const { results } = await env.DB.prepare(
          'SELECT * FROM testimonies ORDER BY status = "pending" DESC, created_at DESC'
        ).all();
        return json(results || [], corsHeaders);
      }

      // POST /api/testimonies/:id/heart - toggle heart from a user
      const tHeartMatch = path.match(/^\/api\/testimonies\/(\d+)\/heart$/);
      if (tHeartMatch && request.method === 'POST') {
        await ensureTestimoniesTable();
        const tid = parseInt(tHeartMatch[1]);
        const body = await request.json();
        const uid = parseInt(body.user_id || 0);
        if (!uid) return json({ error: 'user_id required' }, corsHeaders, 400);
        const existing = await env.DB.prepare(
          'SELECT id FROM testimony_hearts WHERE testimony_id = ? AND user_id = ?'
        ).bind(tid, uid).first();
        if (existing) {
          await env.DB.prepare('DELETE FROM testimony_hearts WHERE id = ?').bind(existing.id).run();
          await env.DB.prepare('UPDATE testimonies SET heart_count = MAX(heart_count - 1, 0) WHERE id = ?').bind(tid).run();
          return json({ hearted: false }, corsHeaders);
        } else {
          await env.DB.prepare('INSERT INTO testimony_hearts (testimony_id, user_id) VALUES (?, ?)').bind(tid, uid).run();
          await env.DB.prepare('UPDATE testimonies SET heart_count = heart_count + 1 WHERE id = ?').bind(tid).run();
          return json({ hearted: true }, corsHeaders);
        }
      }

      // GET /api/testimonies/:id/comments - list comments for a story
      const tCommentsMatch = path.match(/^\/api\/testimonies\/(\d+)\/comments$/);
      if (tCommentsMatch && request.method === 'GET') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS testimony_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT, testimony_id INTEGER NOT NULL,
          user_id INTEGER, name TEXT DEFAULT 'A G4 sister', text TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run(); } catch(e) {}
        const tid = parseInt(tCommentsMatch[1]);
        const { results } = await env.DB.prepare(
          'SELECT id, user_id, name, text, created_at FROM testimony_comments WHERE testimony_id = ? ORDER BY created_at ASC'
        ).bind(tid).all();
        return json(results || [], corsHeaders);
      }

      // POST /api/testimonies/:id/comments - add a comment
      if (tCommentsMatch && request.method === 'POST') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS testimony_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT, testimony_id INTEGER NOT NULL,
          user_id INTEGER, name TEXT DEFAULT 'A G4 sister', text TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run(); } catch(e) {}
        const tid = parseInt(tCommentsMatch[1]);
        const body = await request.json();
        const text = (body.text || '').trim();
        if (!text) return json({ error: 'text required' }, corsHeaders, 400);
        if (text.length > 500) return json({ error: 'comment too long' }, corsHeaders, 400);
        await env.DB.prepare(
          'INSERT INTO testimony_comments (testimony_id, user_id, name, text) VALUES (?, ?, ?, ?)'
        ).bind(
          tid,
          body.user_id ? parseInt(body.user_id) : null,
          (body.name || 'A G4 sister').slice(0, 80),
          text
        ).run();
        return json({ success: true }, corsHeaders);
      }

      // DELETE /api/testimonies/:tid/comments/:cid
      const tCommentDeleteMatch = path.match(/^\/api\/testimonies\/(\d+)\/comments\/(\d+)$/);
      if (tCommentDeleteMatch && request.method === 'DELETE') {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS testimony_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT, testimony_id INTEGER NOT NULL,
          user_id INTEGER, name TEXT DEFAULT 'A G4 sister', text TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run(); } catch(e) {}
        const commentId = parseInt(tCommentDeleteMatch[2]);
        const body = await request.json().catch(() => ({}));
        const requesterId = parseInt(body.user_id || 0);
        const row = await env.DB.prepare('SELECT user_id FROM testimony_comments WHERE id = ?').bind(commentId).first();
        if (!row) return json({ error: 'not found' }, corsHeaders, 404);
        if (!isAdmin(request) && row.user_id !== requesterId) {
          return json({ error: 'not allowed' }, corsHeaders, 403);
        }
        await env.DB.prepare('DELETE FROM testimony_comments WHERE id = ?').bind(commentId).run();
        return json({ success: true }, corsHeaders);
      }

      // PATCH /api/testimonies/:id - admin: approve/reject/feature/unfeature
      // body: { status?: 'approved'|'rejected'|'pending', featured?: 0|1 }
      const tPatchMatch = path.match(/^\/api\/testimonies\/(\d+)$/);
      if (tPatchMatch && request.method === 'PATCH') {
        await ensureTestimoniesTable();
        const tid = parseInt(tPatchMatch[1]);
        const body = await request.json();
        const updates = [];
        const values = [];
        if (typeof body.status === 'string' && ['pending', 'approved', 'rejected', 'featured'].indexOf(body.status) !== -1) {
          updates.push('status = ?');
          values.push(body.status);
        }
        if (typeof body.featured !== 'undefined') {
          // When marking a story featured, unfeature any others first so only one can be featured at a time
          if (body.featured) {
            await env.DB.prepare('UPDATE testimonies SET featured = 0').run();
          }
          updates.push('featured = ?');
          values.push(body.featured ? 1 : 0);
        }
        if (!updates.length) return json({ error: 'No fields' }, corsHeaders, 400);
        values.push(tid);
        await env.DB.prepare('UPDATE testimonies SET ' + updates.join(', ') + ' WHERE id = ?').bind(...values).run();
        return json({ success: true }, corsHeaders);
      }

      // DELETE /api/testimonies/:id - admin
      if (tPatchMatch && request.method === 'DELETE') {
        await ensureTestimoniesTable();
        const tid = parseInt(tPatchMatch[1]);
        // Clean up R2 video if present
        try {
          const row = await env.DB.prepare('SELECT video_key FROM testimonies WHERE id = ?').bind(tid).first();
          if (row && row.video_key && env.VIDEOS) {
            await env.VIDEOS.delete(row.video_key);
          }
        } catch(e) { /* ignore cleanup failures */ }
        await env.DB.prepare('DELETE FROM testimony_hearts WHERE testimony_id = ?').bind(tid).run();
        await env.DB.prepare('DELETE FROM testimonies WHERE id = ?').bind(tid).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== QUIZ (Know Your Sisters) =====

      // POST /api/quiz/score - save a quiz score
      if (path === '/api/quiz/score' && request.method === 'POST') {
        const { user_id, user_name, day, score, total, time_seconds } = await request.json();
        if (!user_id || !day || score === undefined) {
          return json({ error: 'Missing fields' }, corsHeaders, 400);
        }

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS quiz_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          user_name TEXT NOT NULL,
          day INTEGER NOT NULL,
          score INTEGER NOT NULL,
          total INTEGER NOT NULL,
          time_seconds REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, day)
        )`).run();

        // Insert or ignore (one attempt per day)
        const existing = await env.DB.prepare('SELECT id FROM quiz_scores WHERE user_id = ? AND day = ?').bind(user_id, day).first();
        if (existing) {
          return json({ error: 'Already completed this quiz', already_done: true }, corsHeaders, 400);
        }

        await env.DB.prepare(
          'INSERT INTO quiz_scores (user_id, user_name, day, score, total, time_seconds) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(user_id, user_name, day, score, total, time_seconds || 0).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/quiz/scores - get all scores (for admin leaderboard)
      if (path === '/api/quiz/scores' && request.method === 'GET') {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS quiz_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          user_name TEXT NOT NULL,
          day INTEGER NOT NULL,
          score INTEGER NOT NULL,
          total INTEGER NOT NULL,
          time_seconds REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, day)
        )`).run();

        const { results } = await env.DB.prepare('SELECT * FROM quiz_scores ORDER BY day ASC, score DESC, time_seconds ASC').all();
        return json(results, corsHeaders);
      }

      // GET /api/quiz/my?user_id=X - get this user's completed days
      if (path === '/api/quiz/my' && request.method === 'GET') {
        const userId = url.searchParams.get('user_id');
        if (!userId) return json([], corsHeaders);

        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS quiz_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          user_name TEXT NOT NULL,
          day INTEGER NOT NULL,
          score INTEGER NOT NULL,
          total INTEGER NOT NULL,
          time_seconds REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(user_id, day)
        )`).run();

        const { results } = await env.DB.prepare('SELECT day, score, total, time_seconds FROM quiz_scores WHERE user_id = ?').bind(parseInt(userId)).all();
        return json(results, corsHeaders);
      }

      // ===== POLLS / Q&A =====

      // POST /api/polls - create a poll (admin)
      if (path === '/api/polls' && request.method === 'POST') {
        const { question, type, options } = await request.json();
        if (!question || !question.trim()) return json({ error: 'Question required' }, corsHeaders, 400);
        if (!type || (type !== 'open' && type !== 'multiple_choice')) return json({ error: 'type must be open or multiple_choice' }, corsHeaders, 400);
        if (type === 'multiple_choice' && (!options || options.length < 2)) return json({ error: 'Multiple choice needs at least 2 options' }, corsHeaders, 400);

        // Create table if not exists
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS polls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          question TEXT NOT NULL,
          type TEXT NOT NULL,
          options TEXT DEFAULT '',
          active INTEGER DEFAULT 0,
          show_responses INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run();
        // Add show_responses column if missing (existing tables)
        try { await env.DB.prepare('ALTER TABLE polls ADD COLUMN show_responses INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS poll_responses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          user_name TEXT NOT NULL,
          response TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(poll_id, user_id)
        )`).run();

        const result = await env.DB.prepare(
          'INSERT INTO polls (question, type, options, active) VALUES (?, ?, ?, 0)'
        ).bind(question.trim(), type, type === 'multiple_choice' ? JSON.stringify(options) : '').run();

        return json({ success: true, id: result.meta.last_row_id }, corsHeaders);
      }

      // GET /api/polls - list all polls (admin)
      if (path === '/api/polls' && request.method === 'GET') {
        try {
          const { results } = await env.DB.prepare(
            'SELECT id, question, type, options, active, show_responses, created_at FROM polls ORDER BY id DESC'
          ).all();
          // Get response counts
          for (const poll of results) {
            const cnt = await env.DB.prepare(
              'SELECT COUNT(*) as count FROM poll_responses WHERE poll_id = ?'
            ).bind(poll.id).first();
            poll.response_count = cnt?.count || 0;
          }
          return json(results, corsHeaders);
        } catch (e) {
          return json([], corsHeaders);
        }
      }

      // POST /api/polls/activate - activate a poll (deactivates others)
      if (path === '/api/polls/activate' && request.method === 'POST') {
        const { poll_id } = await request.json();
        await env.DB.prepare('UPDATE polls SET active = 0').run();
        if (poll_id) {
          await env.DB.prepare('UPDATE polls SET active = 1 WHERE id = ?').bind(poll_id).run();
        }
        return json({ success: true }, corsHeaders);
      }

      // GET /api/polls/active - get the currently active poll
      if (path === '/api/polls/active' && request.method === 'GET') {
        try {
          const poll = await env.DB.prepare(
            'SELECT id, question, type, options, created_at FROM polls WHERE active = 1'
          ).first();
          if (!poll) return json({ active: false }, corsHeaders);

          // Get response count
          const cnt = await env.DB.prepare(
            'SELECT COUNT(*) as count FROM poll_responses WHERE poll_id = ?'
          ).bind(poll.id).first();

          // For multiple choice, get aggregated counts
          let option_counts = null;
          if (poll.type === 'multiple_choice') {
            const { results } = await env.DB.prepare(
              'SELECT response, COUNT(*) as count FROM poll_responses WHERE poll_id = ? GROUP BY response'
            ).bind(poll.id).all();
            option_counts = {};
            for (const r of results) option_counts[r.response] = r.count;
          }

          return json({
            active: true,
            id: poll.id,
            question: poll.question,
            type: poll.type,
            options: poll.options ? JSON.parse(poll.options) : [],
            response_count: cnt?.count || 0,
            option_counts: option_counts
          }, corsHeaders);
        } catch (e) {
          return json({ active: false }, corsHeaders);
        }
      }

      // POST /api/polls/respond - submit a response
      if (path === '/api/polls/respond' && request.method === 'POST') {
        const { poll_id, user_id, user_name, response } = await request.json();
        if (!poll_id || !user_id || !response || !response.trim()) {
          return json({ error: 'poll_id, user_id, and response required' }, corsHeaders, 400);
        }
        if (containsBlockedWords(response)) {
          return json({ error: 'Please keep responses kind and uplifting.' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          'INSERT INTO poll_responses (poll_id, user_id, user_name, response) VALUES (?, ?, ?, ?) ON CONFLICT(poll_id, user_id) DO UPDATE SET response = excluded.response'
        ).bind(poll_id, user_id, user_name || '', response.trim()).run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/polls/:id/responses - get all responses (admin)
      const pollResponsesMatch = path.match(/^\/api\/polls\/(\d+)\/responses$/);
      if (pollResponsesMatch && request.method === 'GET') {
        const pollId = parseInt(pollResponsesMatch[1]);
        const { results } = await env.DB.prepare(
          'SELECT id, user_id, user_name, response, created_at FROM poll_responses WHERE poll_id = ? ORDER BY created_at DESC'
        ).bind(pollId).all();
        return json(results, corsHeaders);
      }

      // POST /api/polls/show-responses - toggle public visibility of poll responses (admin)
      if (path === '/api/polls/show-responses' && request.method === 'POST') {
        const { poll_id, show } = await request.json();
        if (!poll_id) return json({ error: 'poll_id required' }, corsHeaders, 400);
        // Add column if missing
        try { await env.DB.prepare('ALTER TABLE polls ADD COLUMN show_responses INTEGER DEFAULT 0').run(); } catch(e) { /* already exists */ }
        await env.DB.prepare('UPDATE polls SET show_responses = ? WHERE id = ?').bind(show ? 1 : 0, poll_id).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/polls/feed - get all polls flagged to show on the polls page,
      // including their options and any responses (polls with show_responses = 1).
      // Polls appear here even if they have zero responses so users can answer them.
      if (path === '/api/polls/feed' && request.method === 'GET') {
        try {
          const { results: polls } = await env.DB.prepare(
            `SELECT id, question, type, options, created_at
             FROM polls
             WHERE show_responses = 1
             ORDER BY id DESC`
          ).all();

          for (const poll of polls) {
            poll.options = poll.options ? JSON.parse(poll.options) : [];
            const { results: responses } = await env.DB.prepare(
              `SELECT id, user_id, user_name, response, created_at
               FROM poll_responses
               WHERE poll_id = ?
               ORDER BY created_at DESC`
            ).bind(poll.id).all();
            poll.responses = responses || [];
          }

          return json(polls, corsHeaders);
        } catch (e) {
          return json([], corsHeaders);
        }
      }

      // DELETE /api/polls/:id - delete a poll and its responses
      const pollDeleteMatch = path.match(/^\/api\/polls\/(\d+)$/);
      if (pollDeleteMatch && request.method === 'DELETE') {
        const pollId = parseInt(pollDeleteMatch[1]);
        await env.DB.prepare('DELETE FROM poll_responses WHERE poll_id = ?').bind(pollId).run();
        await env.DB.prepare('DELETE FROM polls WHERE id = ?').bind(pollId).run();
        return json({ success: true }, corsHeaders);
      }

      // DELETE /api/polls/response/:id - delete a single poll response
      const pollResponseDeleteMatch = path.match(/^\/api\/polls\/response\/(\d+)$/);
      if (pollResponseDeleteMatch && request.method === 'DELETE') {
        const responseId = parseInt(pollResponseDeleteMatch[1]);
        await env.DB.prepare('DELETE FROM poll_responses WHERE id = ?').bind(responseId).run();
        return json({ success: true }, corsHeaders);
      }

      // ===== SCAVENGER HUNT =====

      // Create tables on first use
      if (path.startsWith('/api/hunt')) {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            prompt_id TEXT NOT NULL,
            photo_data TEXT NOT NULL,
            caption TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, prompt_id)
          )`).run();
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS hunt_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            prompt_id TEXT NOT NULL,
            submission_id INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, prompt_id)
          )`).run();
        } catch(e) { /* tables exist */ }
      }

      // POST /api/hunt/submit - submit a photo for a prompt
      // Uploads only allowed Friday April 10 2026, 12:00 PM ET → 5:30 PM ET
      if (path === '/api/hunt/submit' && request.method === 'POST') {
        const { user_id, user_name, prompt_id, photo_data, caption } = await request.json();
        if (!user_id || !prompt_id || !photo_data) return json({ error: 'user_id, prompt_id, photo_data required' }, corsHeaders, 400);
        const now = new Date();
        const uploadStart = new Date('2026-04-10T16:00:00Z'); // 12:00 PM ET
        const uploadEnd   = new Date('2026-04-10T21:30:00Z'); // 5:30 PM ET
        if (now < uploadStart) return json({ error: 'The hunt has not started yet!' }, corsHeaders, 400);
        if (now >= uploadEnd) return json({ error: 'Photo uploads are closed — voting is now open!' }, corsHeaders, 400);
        await env.DB.prepare(
          'INSERT INTO hunt_submissions (user_id, user_name, prompt_id, photo_data, caption) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, prompt_id) DO UPDATE SET photo_data = excluded.photo_data, caption = excluded.caption'
        ).bind(user_id, user_name || '', prompt_id, photo_data, caption || '').run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/hunt/my - get which prompts the current user has submitted
      if (path === '/api/hunt/my' && request.method === 'GET') {
        const userId = url.searchParams.get('user_id');
        if (!userId) return json({ error: 'user_id required' }, corsHeaders, 400);
        const { results } = await env.DB.prepare(
          'SELECT prompt_id FROM hunt_submissions WHERE user_id = ?'
        ).bind(parseInt(userId)).all();
        return json(results.map(r => r.prompt_id), corsHeaders);
      }

      // GET /api/hunt/gallery/:promptId - get all submissions for a prompt
      const huntGalleryMatch = path.match(/^\/api\/hunt\/gallery\/(.+)$/);
      if (huntGalleryMatch && request.method === 'GET') {
        const promptId = decodeURIComponent(huntGalleryMatch[1]);
        const { results } = await env.DB.prepare(
          'SELECT s.id, s.user_id, s.user_name, s.photo_data, s.caption, s.created_at, (SELECT COUNT(*) FROM hunt_votes v WHERE v.submission_id = s.id) as votes FROM hunt_submissions s WHERE s.prompt_id = ? ORDER BY votes DESC, s.created_at ASC'
        ).bind(promptId).all();
        // Also get current user's vote for this prompt
        const userId = url.searchParams.get('user_id');
        let myVote = null;
        if (userId) {
          const vote = await env.DB.prepare('SELECT submission_id FROM hunt_votes WHERE user_id = ? AND prompt_id = ?').bind(parseInt(userId), promptId).first();
          if (vote) myVote = vote.submission_id;
        }
        return json({ submissions: results, my_vote: myVote }, corsHeaders);
      }

      // POST /api/hunt/vote - vote for a submission (one vote per prompt per user, can change)
      // Voting only allowed Friday April 10 2026, 5:30 PM ET → 7:00 PM ET
      if (path === '/api/hunt/vote' && request.method === 'POST') {
        const { user_id, prompt_id, submission_id } = await request.json();
        if (!user_id || !prompt_id || !submission_id) return json({ error: 'user_id, prompt_id, submission_id required' }, corsHeaders, 400);
        const now = new Date();
        const voteStart = new Date('2026-04-10T21:30:00Z'); // 5:30 PM ET
        const voteEnd   = new Date('2026-04-10T23:00:00Z'); // 7:00 PM ET
        if (now < voteStart) return json({ error: 'Voting opens at 5:30 PM!' }, corsHeaders, 400);
        if (now >= voteEnd)  return json({ error: 'Voting has closed!' }, corsHeaders, 400);
        // Can't vote for your own photo
        const sub = await env.DB.prepare('SELECT user_id FROM hunt_submissions WHERE id = ?').bind(submission_id).first();
        if (sub && sub.user_id === user_id) return json({ error: "You can't vote for your own photo!" }, corsHeaders, 400);
        await env.DB.prepare(
          'INSERT INTO hunt_votes (user_id, prompt_id, submission_id) VALUES (?, ?, ?) ON CONFLICT(user_id, prompt_id) DO UPDATE SET submission_id = excluded.submission_id'
        ).bind(user_id, prompt_id, submission_id).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/hunt/feed - all submissions for slideshow/feed
      if (path === '/api/hunt/feed' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT s.id, s.user_name, s.prompt_id, s.photo_data, s.caption, s.created_at, (SELECT COUNT(*) FROM hunt_votes v WHERE v.submission_id = s.id) as votes FROM hunt_submissions s ORDER BY s.created_at DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // POST /api/hunt/clear - delete all hunt data (admin)
      if (path === '/api/hunt/clear' && request.method === 'POST') {
        await env.DB.prepare('DELETE FROM hunt_votes').run();
        await env.DB.prepare('DELETE FROM hunt_submissions').run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/hunt/winners - top voted per prompt
      if (path === '/api/hunt/winners' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT s.id, s.user_name, s.prompt_id, s.photo_data, s.caption,
                  (SELECT COUNT(*) FROM hunt_votes v WHERE v.submission_id = s.id) as votes
           FROM hunt_submissions s
           ORDER BY s.prompt_id, votes DESC`
        ).all();
        // Group by prompt, take top per prompt
        const winners = {};
        for (const r of results) {
          if (!winners[r.prompt_id] || r.votes > winners[r.prompt_id].votes) {
            winners[r.prompt_id] = r;
          }
        }
        return json(Object.values(winners).filter(w => w.votes > 0), corsHeaders);
      }

      // ===== WHAT DO YOU MEME =====

      // Create tables on first use
      if (path.startsWith('/api/meme')) {
        try {
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS meme_rounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            photo_data TEXT NOT NULL,
            title TEXT DEFAULT '',
            active INTEGER DEFAULT 0,
            voting_open INTEGER DEFAULT 0,
            caption_deadline TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
          )`).run();
          try { await env.DB.prepare('ALTER TABLE meme_rounds ADD COLUMN caption_deadline TEXT DEFAULT ""').run(); } catch(e) { /* exists */ }
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS meme_captions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            round_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            user_name TEXT NOT NULL,
            caption TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(round_id, user_id)
          )`).run();
          await env.DB.prepare(`CREATE TABLE IF NOT EXISTS meme_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            caption_id INTEGER NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, caption_id)
          )`).run();
        } catch(e) { /* tables exist */ }
      }

      // POST /api/meme/rounds - admin: create a new meme round (upload image)
      if (path === '/api/meme/rounds' && request.method === 'POST') {
        const { photo_data, title } = await request.json();
        if (!photo_data) return json({ error: 'photo_data is required' }, corsHeaders, 400);
        if (photo_data.length > 2800000) return json({ error: 'Image too large. Please use a smaller image.' }, corsHeaders, 400);
        const result = await env.DB.prepare(
          'INSERT INTO meme_rounds (photo_data, title, active, voting_open) VALUES (?, ?, 0, 0)'
        ).bind(photo_data, title || '').run();
        return json({ success: true, id: result.meta.last_row_id }, corsHeaders);
      }

      // GET /api/meme/rounds - admin: list all rounds
      if (path === '/api/meme/rounds' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, title, active, voting_open, created_at FROM meme_rounds ORDER BY id DESC'
        ).all();
        for (const r of results) {
          const cnt = await env.DB.prepare('SELECT COUNT(*) as count FROM meme_captions WHERE round_id = ?').bind(r.id).first();
          r.caption_count = cnt?.count || 0;
        }
        return json(results, corsHeaders);
      }

      // POST /api/meme/activate - admin: activate a round (deactivates others)
      if (path === '/api/meme/activate' && request.method === 'POST') {
        const { round_id } = await request.json();
        await env.DB.prepare('UPDATE meme_rounds SET active = 0, caption_deadline = ""').run();
        if (round_id) {
          await env.DB.prepare('UPDATE meme_rounds SET active = 1 WHERE id = ?').bind(round_id).run();
        }
        return json({ success: true }, corsHeaders);
      }

      // POST /api/meme/start - start the 60-second caption timer for active round
      if (path === '/api/meme/start' && request.method === 'POST') {
        const { seconds } = await request.json();
        const duration = seconds || 60;
        const deadline = new Date(Date.now() + duration * 1000).toISOString();
        await env.DB.prepare(
          'UPDATE meme_rounds SET caption_deadline = ? WHERE active = 1'
        ).bind(deadline).run();
        return json({ success: true, deadline }, corsHeaders);
      }

      // POST /api/meme/stop - stop accepting captions (clear deadline, set to past)
      if (path === '/api/meme/stop' && request.method === 'POST') {
        await env.DB.prepare(
          'UPDATE meme_rounds SET caption_deadline = ? WHERE active = 1'
        ).bind('stopped').run();
        return json({ success: true }, corsHeaders);
      }

      // POST /api/meme/voting - admin: toggle voting open/closed for a round
      if (path === '/api/meme/voting' && request.method === 'POST') {
        const { round_id, open } = await request.json();
        if (!round_id) return json({ error: 'round_id required' }, corsHeaders, 400);
        await env.DB.prepare('UPDATE meme_rounds SET voting_open = ? WHERE id = ?').bind(open ? 1 : 0, round_id).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/meme/active - get active round with image + captions + deadline
      if (path === '/api/meme/active' && request.method === 'GET') {
        let round;
        try {
          round = await env.DB.prepare(
            'SELECT id, photo_data, title, voting_open, caption_deadline, created_at FROM meme_rounds WHERE active = 1'
          ).first();
        } catch(e) {
          round = await env.DB.prepare(
            'SELECT id, photo_data, title, voting_open, created_at FROM meme_rounds WHERE active = 1'
          ).first();
        }
        if (!round) return json({ active: false }, corsHeaders);

        const { results: captions } = await env.DB.prepare(
          `SELECT c.id, c.user_id, c.user_name, c.caption, c.created_at,
                  (SELECT COUNT(*) FROM meme_votes v WHERE v.caption_id = c.id) as vote_count
           FROM meme_captions c WHERE c.round_id = ?
           ORDER BY vote_count DESC, c.created_at ASC`
        ).bind(round.id).all();

        // Get current user's votes if user_id provided
        const userId = url.searchParams.get('user_id');
        let myVotes = [];
        let myCaption = null;
        if (userId) {
          const { results: votes } = await env.DB.prepare(
            'SELECT caption_id FROM meme_votes WHERE user_id = ?'
          ).bind(parseInt(userId)).all();
          myVotes = votes.map(v => v.caption_id);

          const existing = await env.DB.prepare(
            'SELECT id, caption FROM meme_captions WHERE round_id = ? AND user_id = ?'
          ).bind(round.id, parseInt(userId)).first();
          if (existing) myCaption = existing;
        }

        return json({
          active: true,
          id: round.id,
          photo_data: round.photo_data,
          title: round.title,
          voting_open: round.voting_open,
          caption_deadline: round.caption_deadline || '',
          captions,
          my_votes: myVotes,
          my_caption: myCaption
        }, corsHeaders);
      }

      // POST /api/meme/judge - AI picks the top funniest captions
      if (path === '/api/meme/judge' && request.method === 'POST') {
        const { round_id, top_n } = await request.json();
        if (!round_id) return json({ error: 'round_id required' }, corsHeaders, 400);

        const round = await env.DB.prepare(
          'SELECT id, photo_data, title FROM meme_rounds WHERE id = ?'
        ).bind(round_id).first();
        if (!round) return json({ error: 'Round not found' }, corsHeaders, 404);

        const { results: captions } = await env.DB.prepare(
          'SELECT id, user_name, caption FROM meme_captions WHERE round_id = ? ORDER BY created_at ASC'
        ).bind(round_id).all();

        if (captions.length === 0) return json({ ranked: [] }, corsHeaders);
        if (captions.length <= (top_n || 5)) {
          // Few enough to show all - just shuffle for fun
          const shuffled = [...captions].sort(() => Math.random() - 0.5);
          return json({ ranked: shuffled.map(c => ({ id: c.id, user_name: c.user_name, caption: c.caption })) }, corsHeaders);
        }

        // Build the list of captions for Claude
        const captionList = captions.map((c, i) => `${i + 1}. "${c.caption}"`).join('\n');
        const pickCount = Math.min(top_n || 5, captions.length);

        // Prepare the image for Claude (extract base64 and media type)
        let imageContent = [];
        if (round.photo_data && round.photo_data.startsWith('data:')) {
          const match = round.photo_data.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (match) {
            imageContent = [{
              type: 'image',
              source: { type: 'base64', media_type: match[1], data: match[2] }
            }];
          }
        }

        const prompt = `You're the judge of a "What Do You Meme?" caption contest at a women's Christian retreat. You're looking at a meme image and here are the submitted captions:

${captionList}

Pick the top ${pickCount} FUNNIEST captions. They should be:
- Genuinely funny, clever, or witty
- Clean and appropriate for a women's Christian retreat
- Good match for the image

Order them from "pretty funny" to "absolutely hilarious" (save the best for last - it's a dramatic reveal).

Skip any captions that are mean-spirited, inappropriate, or just not funny.

Respond ONLY with a JSON array of the caption numbers you picked, in order from least to most funny. Example: [3, 7, 1, 12, 5]

Just the JSON array, nothing else.`;

        try {
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': env.CLAUDE_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 200,
              messages: [{
                role: 'user',
                content: [
                  ...imageContent,
                  { type: 'text', text: prompt }
                ]
              }]
            })
          });

          const claudeData = await claudeRes.json();
          const responseText = claudeData.content?.[0]?.text || '[]';

          // Parse the array of indices
          const match = responseText.match(/\[[\d,\s]+\]/);
          if (!match) {
            // Fallback: return all captions shuffled
            const shuffled = [...captions].sort(() => Math.random() - 0.5);
            return json({ ranked: shuffled.map(c => ({ id: c.id, user_name: c.user_name, caption: c.caption })), ai_used: false }, corsHeaders);
          }

          const indices = JSON.parse(match[0]);
          const ranked = indices
            .map(i => captions[i - 1])
            .filter(Boolean)
            .map(c => ({ id: c.id, user_name: c.user_name, caption: c.caption }));

          return json({ ranked, ai_used: true }, corsHeaders);
        } catch (e) {
          // AI failed - fallback to random order
          const shuffled = [...captions].sort(() => Math.random() - 0.5).slice(0, top_n || 5);
          return json({ ranked: shuffled.map(c => ({ id: c.id, user_name: c.user_name, caption: c.caption })), ai_used: false, error: e.message }, corsHeaders);
        }
      }

      // POST /api/meme/caption - submit a caption (one per user per round)
      if (path === '/api/meme/caption' && request.method === 'POST') {
        const { round_id, user_id, user_name, caption } = await request.json();
        if (!round_id || !user_id || !caption || !caption.trim()) {
          return json({ error: 'round_id, user_id, and caption required' }, corsHeaders, 400);
        }
        if (caption.length > 200) return json({ error: 'Caption must be 200 characters or less' }, corsHeaders, 400);
        if (containsBlockedWords(caption)) {
          return json({ error: 'Please keep captions fun and kind!' }, corsHeaders, 400);
        }

        // Check if caption deadline has passed
        try {
          const round = await env.DB.prepare('SELECT caption_deadline FROM meme_rounds WHERE id = ?').bind(round_id).first();
          if (round && round.caption_deadline) {
            if (round.caption_deadline === 'stopped') {
              return json({ error: "Time's up! Captions are closed." }, corsHeaders, 400);
            }
            if (new Date(round.caption_deadline) < new Date()) {
              return json({ error: "Time's up! Captions are closed." }, corsHeaders, 400);
            }
          }
        } catch(e) { /* deadline column may not exist yet */ }

        await env.DB.prepare(
          'INSERT INTO meme_captions (round_id, user_id, user_name, caption) VALUES (?, ?, ?, ?) ON CONFLICT(round_id, user_id) DO UPDATE SET caption = excluded.caption'
        ).bind(round_id, user_id, user_name || '', caption.trim()).run();

        return json({ success: true }, corsHeaders);
      }

      // POST /api/meme/vote - toggle vote on a caption (vote as many as you want)
      if (path === '/api/meme/vote' && request.method === 'POST') {
        const { user_id, caption_id } = await request.json();
        if (!user_id || !caption_id) return json({ error: 'user_id and caption_id required' }, corsHeaders, 400);

        // Check if round voting is open
        const caption = await env.DB.prepare(
          'SELECT c.round_id, c.user_id FROM meme_captions c JOIN meme_rounds r ON c.round_id = r.id WHERE c.id = ? AND r.voting_open = 1'
        ).bind(caption_id).first();
        if (!caption) return json({ error: 'Voting is not open for this round' }, corsHeaders, 400);

        // Can't vote for your own caption
        if (caption.user_id === user_id) return json({ error: "You can't vote for your own caption!" }, corsHeaders, 400);

        // Toggle: if already voted, remove it; otherwise add it
        const existing = await env.DB.prepare(
          'SELECT id FROM meme_votes WHERE user_id = ? AND caption_id = ?'
        ).bind(user_id, caption_id).first();

        if (existing) {
          await env.DB.prepare('DELETE FROM meme_votes WHERE id = ?').bind(existing.id).run();
          return json({ success: true, voted: false }, corsHeaders);
        } else {
          await env.DB.prepare(
            'INSERT INTO meme_votes (user_id, caption_id) VALUES (?, ?)'
          ).bind(user_id, caption_id).run();
          return json({ success: true, voted: true }, corsHeaders);
        }
      }

      // DELETE /api/meme/rounds/:id - admin: delete a round and all its data
      const memeDeleteMatch = path.match(/^\/api\/meme\/rounds\/(\d+)$/);
      if (memeDeleteMatch && request.method === 'DELETE') {
        const roundId = parseInt(memeDeleteMatch[1]);
        // Delete votes for captions in this round
        await env.DB.prepare(
          'DELETE FROM meme_votes WHERE caption_id IN (SELECT id FROM meme_captions WHERE round_id = ?)'
        ).bind(roundId).run();
        await env.DB.prepare('DELETE FROM meme_captions WHERE round_id = ?').bind(roundId).run();
        await env.DB.prepare('DELETE FROM meme_rounds WHERE id = ?').bind(roundId).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/meme/results/:id - get results for a specific round (admin or public when voting closed)
      const memeResultsMatch = path.match(/^\/api\/meme\/results\/(\d+)$/);
      if (memeResultsMatch && request.method === 'GET') {
        const roundId = parseInt(memeResultsMatch[1]);
        const round = await env.DB.prepare('SELECT id, title, photo_data, voting_open FROM meme_rounds WHERE id = ?').bind(roundId).first();
        if (!round) return json({ error: 'Round not found' }, corsHeaders, 404);

        const { results: captions } = await env.DB.prepare(
          `SELECT c.id, c.user_name, c.caption,
                  (SELECT COUNT(*) FROM meme_votes v WHERE v.caption_id = c.id) as vote_count
           FROM meme_captions c WHERE c.round_id = ?
           ORDER BY vote_count DESC`
        ).bind(roundId).all();

        return json({ round, captions }, corsHeaders);
      }

      return json({ error: 'Not found' }, corsHeaders, 404);

    } catch (err) {
      return json({ error: err.message }, corsHeaders, 500);
    }
  }
};

function json(data, corsHeaders, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...corsHeaders
    }
  });
}
