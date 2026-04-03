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
      'Access-Control-Allow-Headers': 'Content-Type',
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
        const { first_name, last_initial, attendee_id } = await request.json();

        if (!first_name || !first_name.trim()) {
          return json({ error: 'First name is required' }, corsHeaders, 400);
        }

        const cleanName = first_name.trim();
        const cleanInitial = (last_initial || '').trim().charAt(0).toUpperCase();
        const displayName = cleanInitial ? `${cleanName} ${cleanInitial}.` : cleanName;

        // Check for duplicate display name
        const existing = await env.DB.prepare(
          'SELECT id FROM users WHERE first_name = ? AND last_initial = ?'
        ).bind(cleanName, cleanInitial).first();

        if (existing) {
          return json({
            error: cleanInitial
              ? `"${displayName}" is already taken. Try a different last initial or use your full first name.`
              : `"${cleanName}" is already taken. Please add your last initial to make it unique.`
          }, corsHeaders, 409);
        }

        const result = await env.DB.prepare(
          'INSERT INTO users (first_name, last_initial, attendee_id) VALUES (?, ?, ?)'
        ).bind(cleanName, cleanInitial, attendee_id || null).run();

        const userId = result.meta.last_row_id;

        return json({
          id: userId,
          first_name: cleanName,
          last_initial: cleanInitial,
          display_name: displayName
        }, corsHeaders);
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
