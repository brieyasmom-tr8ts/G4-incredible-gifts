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

        // Check for duplicate
        const existing = await env.DB.prepare(
          'SELECT id FROM users WHERE first_name = ? AND last_initial = ?'
        ).bind(cleanName, cleanInitial).first();

        if (existing) {
          return json({
            error: `"${displayName}" is already taken. If that's you, try clearing your app data. Otherwise, try a nickname.`
          }, corsHeaders, 409);
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
        const { results } = await env.DB.prepare(
          'SELECT id, first_name, last_initial, last_name, email, phone, birthday, instagram, facebook, created_at FROM users ORDER BY created_at DESC'
        ).all();
        return json(results, corsHeaders);
      }

      // GET /api/users/directory - public directory (only shared fields)
      if (path === '/api/users/directory' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT u.id, u.first_name, u.last_initial, u.photo_data, u.email, u.phone, u.birthday,
                  u.show_email, u.show_phone, u.show_birthday, u.show_about,
                  u.instagram, u.facebook, u.location, u.job, u.church, u.retreat_years, u.about,
                  p.score as packing_score
           FROM users u LEFT JOIN packing_scores p ON u.id = p.user_id
           ORDER BY u.first_name ASC`
        ).all();
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
          packing_score: u.packing_score != null ? u.packing_score : null
        }));
        return json(directory, corsHeaders);
      }

      // GET /api/users/:id - get user profile (public view — respects visibility)
      const userGetMatch = path.match(/^\/api\/users\/(\d+)$/);
      if (userGetMatch && request.method === 'GET') {
        const userId = parseInt(userGetMatch[1]);
        const user = await env.DB.prepare(
          'SELECT id, first_name, last_initial, email, phone, birthday, photo_data, show_email, show_phone, show_birthday, show_about, instagram, facebook, location, job, church, retreat_years, about, created_at FROM users WHERE id = ?'
        ).bind(userId).first();
        if (!user) return json({ error: 'User not found' }, corsHeaders, 404);

        // Return public profile — only show fields user opted in
        const isOwner = url.searchParams.get('owner') === '1';
        return json({
          id: user.id,
          first_name: user.first_name,
          last_initial: user.last_initial,
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
        await env.DB.prepare(
          `UPDATE users SET ${fields.join(', ')} WHERE id = ?`
        ).bind(...values).run();

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

      // ===== ADMIN =====

      // DELETE /api/admin/reset - clear all test data
      if (path === '/api/admin/reset' && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM messages').run();
        await env.DB.prepare('DELETE FROM moments').run();
        await env.DB.prepare('DELETE FROM video_moments').run();
        await env.DB.prepare('DELETE FROM feedback').run();
        await env.DB.prepare('DELETE FROM fun_facts').run();
        await env.DB.prepare('DELETE FROM packing_scores').run();
        await env.DB.prepare('DELETE FROM users').run();
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

      // ===== FEEDBACK =====

      // POST /api/feedback - submit retreat feedback
      if (path === '/api/feedback' && request.method === 'POST') {
        const { user_id, name, rating, favorite, improve, come_again, other } = await request.json();

        if (!rating) {
          return json({ error: 'Rating is required' }, corsHeaders, 400);
        }

        await env.DB.prepare(
          'INSERT INTO feedback (user_id, name, rating, favorite, improve, come_again, other) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).bind(user_id || null, name || 'Anonymous', rating, favorite || '', improve || '', come_again || '', other || '').run();

        return json({ success: true }, corsHeaders);
      }

      // GET /api/feedback - get all feedback (for you to review)
      if (path === '/api/feedback' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM feedback ORDER BY created_at DESC'
        ).all();
        return json(results, corsHeaders);
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
