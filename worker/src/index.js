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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ===== DB MIGRATION (one-time) =====
      if (path === '/api/admin/migrate' && request.method === 'POST') {
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
            user_name TEXT NOT NULL,
            score INTEGER NOT NULL,
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
        const userId = parseInt(debugUserMatch[1]);
        const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
        return json(user || { error: 'not found' }, corsHeaders);
      }

      // GET /api/admin/stats — usage stats for admin dashboard
      if (path === '/api/admin/stats' && request.method === 'GET') {
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
            env.DB.prepare('SELECT COUNT(*) as c FROM journal_entries').first('c').catch(() => 0),
            env.DB.prepare('SELECT COUNT(DISTINCT user_id) as c FROM journal_entries').first('c').catch(() => 0),
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
        const { results } = await env.DB.prepare("PRAGMA table_info(users)").all();
        return json(results, corsHeaders);
      }

      // POST /api/admin/debug-update/:id — test direct update of show_about
      const debugUpdateMatch = path.match(/^\/api\/admin\/debug-update\/(\d+)$/);
      if (debugUpdateMatch && request.method === 'POST') {
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

        const cleanName = first_name.trim();
        const cleanLastName = (last_name || '').trim();
        const cleanInitial = cleanLastName ? cleanLastName.charAt(0).toUpperCase() : (last_initial || '').trim().charAt(0).toUpperCase();
        const displayName = cleanInitial ? `${cleanName} ${cleanInitial}.` : cleanName;

        // Check for existing user — return them (re-login)
        const existing = await env.DB.prepare(
          'SELECT id, first_name, last_initial FROM users WHERE first_name = ? AND last_initial = ?'
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
            `SELECT u.id, u.first_name, u.last_initial, u.photo_data, u.email, u.phone, u.birthday,
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
        let user;
        try {
          user = await env.DB.prepare(
            'SELECT id, first_name, last_initial, last_name, email, phone, birthday, photo_data, show_email, show_phone, show_birthday, show_about, instagram, facebook, location, job, church, retreat_years, about, is_team, is_speaker, created_at FROM users WHERE id = ?'
          ).bind(userId).first();
        } catch (e) {
          user = await env.DB.prepare(
            'SELECT id, first_name, last_initial, email, phone, birthday, photo_data, show_email, show_phone, show_birthday, show_about, instagram, facebook, location, job, church, retreat_years, about, created_at FROM users WHERE id = ?'
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
          show_email: user.show_email || 0,
          show_phone: user.show_phone || 0,
          show_birthday: user.show_birthday || 0,
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
          created_at: user.created_at
        }, corsHeaders);
      }

      // POST /api/users/:id/profile - update profile
      const profileMatch = path.match(/^\/api\/users\/(\d+)\/profile$/);
      if (profileMatch && request.method === 'POST') {
        const userId = parseInt(profileMatch[1]);
        const body = await request.json();

        const allowed = ['email', 'phone', 'birthday', 'photo_data', 'show_email', 'show_phone', 'show_birthday', 'show_about', 'instagram', 'facebook', 'location', 'job', 'church', 'retreat_years', 'about'];
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
        const tables = ['messages', 'moments', 'video_moments', 'feedback', 'fun_facts', 'packing_scores', 'secret_sister', 'wyr_votes', 'wyr_questions', 'announcements', 'poll_responses', 'polls', 'users'];
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

      // DELETE /api/moments/:id (admin override with user_id = -1)
      const momentDeleteMatch = path.match(/^\/api\/moments\/(\d+)$/);
      if (momentDeleteMatch && request.method === 'DELETE') {
        const momentId = parseInt(momentDeleteMatch[1]);
        const { user_id } = await request.json();

        if (user_id !== -1) {
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
        const { results } = await env.DB.prepare(
          `SELECT id, user_id, author_name, type, tagged_name, message, prayer_count, created_at
           FROM messages ORDER BY created_at DESC LIMIT 200`
        ).all();
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

      // GET /api/moments - get all moments
      if (path === '/api/moments' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT id, user_id, author_name, photo_data, caption, gift_tag, created_at
           FROM moments ORDER BY created_at DESC LIMIT 200`
        ).all();
        return json(results, corsHeaders);
      }

      // POST /api/moments - upload a moment (max 5 per user)
      if (path === '/api/moments' && request.method === 'POST') {
        const { user_id, author_name, photo_data, caption, gift_tag } = await request.json();

        if (!user_id || !author_name || !photo_data) {
          return json({ error: 'user_id, author_name, and photo_data are required' }, corsHeaders, 400);
        }

        if (caption && containsBlockedWords(caption)) {
          return json({ error: 'Please keep captions kind and uplifting.' }, corsHeaders, 400);
        }

        // Check upload limit
        const count = await env.DB.prepare(
          'SELECT COUNT(*) as cnt FROM moments WHERE user_id = ?'
        ).bind(user_id).first();

        if (count && count.cnt >= 5) {
          return json({ error: 'You can share up to 5 moments. Delete one to add more.' }, corsHeaders, 400);
        }

        // Limit photo size (~2MB base64)
        if (photo_data.length > 2800000) {
          return json({ error: 'Photo is too large. Please choose a smaller image.' }, corsHeaders, 400);
        }

        const result = await env.DB.prepare(
          'INSERT INTO moments (user_id, author_name, photo_data, caption, gift_tag) VALUES (?, ?, ?, ?, ?)'
        ).bind(user_id, author_name, photo_data, caption || '', gift_tag || '').run();

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
        if (user_id !== -1 && video.user_id !== user_id) {
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
        // Upsert — one score per user
        await env.DB.prepare(
          'INSERT INTO packing_scores (user_id, author_name, score, answers) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET score = excluded.score, answers = excluded.answers, author_name = excluded.author_name'
        ).bind(user_id, author_name || '', score, answers || '').run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/games/packing - get packing leaderboard
      if (path === '/api/games/packing' && request.method === 'GET') {
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

      // ===== WOULD YOU RATHER =====

      // GET /api/games/wyr/questions - get all questions (admin)
      if (path === '/api/games/wyr/questions' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, option_a, option_b, active, created_at FROM wyr_questions ORDER BY id DESC'
        ).all();
        return json(results, corsHeaders);
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
      if (path === '/api/games/wyr/feed' && request.method === 'GET') {
        try {
          const { results: questions } = await env.DB.prepare(
            'SELECT id, option_a, option_b, created_at FROM wyr_questions ORDER BY id DESC'
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

      // ===== FEEDBACK =====

      // POST /api/feedback - submit retreat feedback
      if (path === '/api/feedback' && request.method === 'POST') {
        const body = await request.json();
        const rating = body.rating;

        if (!rating) {
          return json({ error: 'Rating is required' }, corsHeaders, 400);
        }

        // Migrate feedback table to add new columns
        const newCols = [
          ['liked_most', 'TEXT DEFAULT ""'],
          ['liked_least', 'TEXT DEFAULT ""'],
          ['ratings', 'TEXT DEFAULT ""'],
          ['rating_comments', 'TEXT DEFAULT ""'],
          ['more_of', 'TEXT DEFAULT ""'],
          ['invite_friend', 'TEXT DEFAULT ""'],
          ['final_thoughts', 'TEXT DEFAULT ""'],
        ];
        for (const [col, type] of newCols) {
          try { await env.DB.prepare(`ALTER TABLE feedback ADD COLUMN ${col} ${type}`).run(); } catch(e) { /* exists */ }
        }

        await env.DB.prepare(
          'INSERT INTO feedback (user_id, name, rating, favorite, improve, come_again, other, liked_most, liked_least, ratings, rating_comments, more_of, invite_friend, final_thoughts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
          body.final_thoughts || ''
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

      // GET /api/polls/feed - get recent poll responses for public display (only polls with show_responses = 1)
      if (path === '/api/polls/feed' && request.method === 'GET') {
        try {
          const { results } = await env.DB.prepare(
            `SELECT pr.user_name, pr.response, pr.created_at, p.question, p.id as poll_id, p.type
             FROM poll_responses pr
             JOIN polls p ON pr.poll_id = p.id
             WHERE p.show_responses = 1
             ORDER BY pr.created_at DESC
             LIMIT 100`
          ).all();
          return json(results, corsHeaders);
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
      if (path === '/api/hunt/submit' && request.method === 'POST') {
        const { user_id, user_name, prompt_id, photo_data, caption } = await request.json();
        if (!user_id || !prompt_id || !photo_data) return json({ error: 'user_id, prompt_id, photo_data required' }, corsHeaders, 400);
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
      if (path === '/api/hunt/vote' && request.method === 'POST') {
        const { user_id, prompt_id, submission_id } = await request.json();
        if (!user_id || !prompt_id || !submission_id) return json({ error: 'user_id, prompt_id, submission_id required' }, corsHeaders, 400);
        // Check voting cutoff (7 PM Friday April 10 2026 ET)
        const now = new Date();
        const cutoff = new Date('2026-04-10T23:00:00Z'); // 7 PM ET = 11 PM UTC
        if (now > cutoff) return json({ error: 'Voting has closed!' }, corsHeaders, 400);
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
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}
