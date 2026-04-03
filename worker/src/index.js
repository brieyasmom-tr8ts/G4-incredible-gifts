export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // GET /api/attendees - list all attendees
      if (path === '/api/attendees' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, first_name, last_name, claimed FROM attendees ORDER BY first_name, last_name'
        ).all();
        return json(results, corsHeaders);
      }

      // POST /api/attendees/claim - claim a name
      if (path === '/api/attendees/claim' && request.method === 'POST') {
        const { id } = await request.json();
        // Check if already claimed
        const attendee = await env.DB.prepare(
          'SELECT id, first_name, last_name, claimed FROM attendees WHERE id = ?'
        ).bind(id).first();

        if (!attendee) {
          return json({ error: 'Attendee not found' }, corsHeaders, 404);
        }
        if (attendee.claimed) {
          return json({ error: 'This name has already been claimed' }, corsHeaders, 409);
        }

        await env.DB.prepare(
          'UPDATE attendees SET claimed = 1 WHERE id = ?'
        ).bind(id).run();

        return json({
          success: true,
          attendee: { id: attendee.id, first_name: attendee.first_name, last_name: attendee.last_name }
        }, corsHeaders);
      }

      // POST /api/attendees/unclaim - unclaim a name (in case of mistakes)
      if (path === '/api/attendees/unclaim' && request.method === 'POST') {
        const { id } = await request.json();
        await env.DB.prepare(
          'UPDATE attendees SET claimed = 0 WHERE id = ?'
        ).bind(id).run();
        return json({ success: true }, corsHeaders);
      }

      // GET /api/messages - get prayer wall messages
      if (path === '/api/messages' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, author_name, tagged_name, message, created_at FROM messages ORDER BY created_at DESC LIMIT 200'
        ).all();
        return json(results, corsHeaders);
      }

      // POST /api/messages - post a new message
      if (path === '/api/messages' && request.method === 'POST') {
        const { author_id, author_name, tagged_name, message } = await request.json();

        if (!author_id || !author_name || !message) {
          return json({ error: 'author_id, author_name, and message are required' }, corsHeaders, 400);
        }

        const result = await env.DB.prepare(
          'INSERT INTO messages (author_id, author_name, tagged_name, message) VALUES (?, ?, ?, ?)'
        ).bind(author_id, author_name, tagged_name || null, message).run();

        return json({ success: true, id: result.meta.last_row_id }, corsHeaders);
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
