# G4 2027 Registration Landing Page & Access Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate g4retreatapp.org behind a landing page + universal access code so only registered women can enter the app, with year separation for fresh 2027 content and a read-only archive toggle for 2026 memories.

**Architecture:** Landing page is built into `index.html` as the default view. A new `POST /api/auth/enter` worker endpoint validates the universal code and creates/matches users. All content tables gain a `retreat_year` column so 2027 data is cleanly separated from 2026. A `viewingYear` variable in the frontend controls which year's data is loaded, with archive mode disabling write actions.

**Tech Stack:** Vanilla HTML/JS frontend, Cloudflare Worker (JS), Cloudflare D1 (SQLite), R2 for media.

**Spec:** `docs/superpowers/specs/2026-08-24-registration-landing-page-design.md`

## Global Constraints

- No frameworks — vanilla HTML + JS only.
- D1 crashes on `undefined` in `.bind()` — always use `|| null` or `|| ''` fallbacks.
- Use `Promise.allSettled()` for parallel D1 queries, never `Promise.all()`.
- Video uploads use `multipart/form-data`, never base64 in JSON.
- Never silently `catch {}` API errors on submit — show actual error to user.
- Lazy migrations via `ALTER TABLE ADD COLUMN` in try/catch for all new columns.
- Bottom nav: solid white background, `padding-bottom: max(6px, env(safe-area-inset-bottom, 0px) * 0.5)`.
- Buttons: `touch-action: manipulation` + `type="button"` + `-webkit-tap-highlight-color: transparent`.
- Count spans: `-apple-system` font + `font-variant-numeric: tabular-nums`.
- Fonts: Playfair Display (headers), Cormorant Garamond (italic accents), Georgia (body).
- CSS custom properties: `--cream`, `--taupe`, `--sage`, `--blush`, `--accent`, `--rose`, `--dark-text`, `--light-text`, `--warm-grey`.
- Deploy worker: `cd C:\Users\Heather\G4-incredible-gifts\worker && npx wrangler deploy`
- Frontend deploys via git push to main (Cloudflare Pages auto-deploy).
- CORS origins: `g4retreatapp.org`, `www.g4retreatapp.org` (http + https), `localhost:8080`, `127.0.0.1:8080`.
- Admin auth: `X-Admin-Key` header, validated by `requireAdmin()`.
- `game_settings` write endpoint currently filters keys to `registration_*` prefix.

---

### Task 1: Worker — Access Code Validation Endpoint

**Files:**
- Modify: `worker/src/index.js`

**Interfaces:**
- Consumes: `game_settings` table (key `registration_access_code`), `users` table
- Produces: `POST /api/auth/enter` → `{ id, first_name, last_initial, display_name, retreat_year, opted_in_2027, returning? }` or `{ error }` with 401

- [ ] **Step 1: Add lazy migration for `password_hash` column**

In the existing lazy migration block near the top of the fetch handler (around lines 100-105 where `retreat_year` and `opted_in_2027` are added), add:

```javascript
try { await env.DB.prepare('ALTER TABLE users ADD COLUMN password_hash TEXT').run(); } catch(e) {}
```

- [ ] **Step 2: Add `POST /api/auth/enter` endpoint**

Add this BEFORE the existing `POST /api/users` handler (around line 588). This is the new gated entry point:

```javascript
// POST /api/auth/enter — validate access code, create or match user
if (path === '/api/auth/enter' && request.method === 'POST') {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid request' }, corsHeaders, 400);

  const firstName = (body.first_name || '').trim();
  const lastName = (body.last_name || '').trim();
  const code = (body.code || '').trim();

  if (!firstName || !lastName) {
    return json({ error: 'First and last name are required' }, corsHeaders, 400);
  }
  if (!code) {
    return json({ error: 'Access code is required' }, corsHeaders, 400);
  }

  // Validate code against stored access code OR user's personal password
  const storedCode = await env.DB.prepare(
    "SELECT value FROM game_settings WHERE key = 'registration_access_code'"
  ).first();

  const universalMatch = storedCode && storedCode.value && code === storedCode.value;

  const cleanFirst = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  const cleanLast = lastName;
  const cleanInitial = cleanLast.charAt(0).toUpperCase();
  const displayName = `${cleanFirst} ${cleanInitial}.`;

  // Try to match existing user by name
  const existing = await env.DB.prepare(
    'SELECT id, first_name, last_initial, last_name, retreat_year, COALESCE(opted_in_2027, 0) AS opted_in_2027, password_hash FROM users WHERE LOWER(first_name) = LOWER(?) AND UPPER(last_initial) = UPPER(?)'
  ).bind(cleanFirst, cleanInitial).first();

  // If not universal code, check personal password
  if (!universalMatch) {
    if (!existing || !existing.password_hash) {
      return json({ error: "That code doesn't match. Check your confirmation email and try again." }, corsHeaders, 401);
    }
    // Compare personal password (stored as SHA-256 hex)
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(code));
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (hashHex !== existing.password_hash) {
      return json({ error: "That code doesn't match. Check your confirmation email and try again." }, corsHeaders, 401);
    }
  }

  if (existing) {
    // Returning sister — update last_name if missing, mark for 2027
    const updates = [];
    const binds = [];
    if (cleanLast && !existing.last_name) {
      updates.push('last_name = ?');
      binds.push(cleanLast);
    }
    // Add 2027 access: set retreat_year to 2027 (keeps 2026 data via year columns on content tables)
    updates.push('retreat_year = 2027');
    updates.push('reg_registered = 1');

    if (updates.length) {
      binds.push(existing.id);
      await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...binds).run();
    }

    return json({
      id: existing.id,
      first_name: existing.first_name,
      last_initial: existing.last_initial,
      display_name: existing.last_initial ? `${existing.first_name} ${existing.last_initial}.` : existing.first_name,
      retreat_year: 2027,
      opted_in_2027: existing.opted_in_2027 || 0,
      returning: true
    }, corsHeaders);
  }

  // New user — create with retreat_year 2027
  await ensureRegColumns(env.DB);
  const result = await env.DB.prepare(
    'INSERT INTO users (first_name, last_initial, last_name, retreat_year, reg_registered) VALUES (?, ?, ?, 2027, 1)'
  ).bind(cleanFirst, cleanInitial, cleanLast).run();

  return json({
    id: result.meta.last_row_id,
    first_name: cleanFirst,
    last_initial: cleanInitial,
    display_name: displayName,
    retreat_year: 2027
  }, corsHeaders);
}
```

- [ ] **Step 3: Add `POST /api/users/:id/password` endpoint**

Add after the auth/enter endpoint. This lets a woman set a personal password:

```javascript
// POST /api/users/:id/password — set personal password
if (path.match(/^\/api\/users\/(\d+)\/password$/) && request.method === 'POST') {
  const userId = path.match(/^\/api\/users\/(\d+)\/password$/)[1];
  const body = await request.json().catch(() => null);
  if (!body || !body.password || body.password.trim().length < 4) {
    return json({ error: 'Password must be at least 4 characters' }, corsHeaders, 400);
  }
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(body.password.trim()));
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hashHex, userId).run();
  return json({ success: true }, corsHeaders);
}
```

- [ ] **Step 4: Expand `POST /api/admin/registration/settings` to accept `access_code`**

Find the existing settings write endpoint (around line 2794). Change the key filter from:

```javascript
if (!key.startsWith('registration_')) continue;
```

to:

```javascript
if (!key.startsWith('registration_') && key !== 'access_code' && key !== 'active_retreat_year') continue;
```

- [ ] **Step 5: Expand `GET /api/registration/settings` to include access_code presence**

In the GET endpoint (around line 2776), after building the `settings` object, add a boolean flag so the frontend knows a code is required without leaking the actual code:

```javascript
// Don't send actual code to unauthenticated clients
settings.code_required = !!(settings.access_code || settings.registration_access_code);
delete settings.access_code;
delete settings.registration_access_code;
```

Wait — the access code is stored under the key `registration_access_code` (to fit the prefix filter on write). But in Step 4 we also allow `access_code`. Let's standardize: use `registration_access_code` everywhere since it already passes the prefix filter without modification. Remove the Step 4 change to the prefix filter for `access_code` — it's not needed.

**Revised Step 4:** In the admin settings write endpoint, no prefix filter change needed for the code (it already starts with `registration_`). Only add `active_retreat_year`:

```javascript
if (!key.startsWith('registration_') && key !== 'active_retreat_year') continue;
```

**Revised Step 5:** After building `settings`, before returning:

```javascript
settings.code_required = !!(settings.registration_access_code);
delete settings.registration_access_code;
```

- [ ] **Step 6: Deploy worker and verify**

```bash
cd "C:\Users\Heather\G4-incredible-gifts\worker" && npx wrangler deploy
```

Test with curl:
```bash
# Should return 401 with wrong code
curl -X POST https://g4-retreat-api.brieyasmom.workers.dev/api/auth/enter -H "Content-Type: application/json" -d '{"first_name":"Test","last_name":"User","code":"wrong"}'

# Settings should show code_required but not the actual code
curl https://g4-retreat-api.brieyasmom.workers.dev/api/registration/settings
```

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\Heather\G4-incredible-gifts" && git add worker/src/index.js && git commit -m "$(cat <<'EOF'
Add access code auth endpoint and personal password support

- POST /api/auth/enter validates universal code or personal password
- POST /api/users/:id/password for setting personal passwords
- registration_access_code stored in game_settings
- code_required flag in public settings (code value not leaked)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Admin — Access Code Field in Registration Settings

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: `GET /api/registration/settings`, `POST /api/admin/registration/settings` (from Task 1)
- Produces: Admin UI for setting `registration_access_code` and `active_retreat_year`

- [ ] **Step 1: Add access code input to registration settings HTML**

Find the registration settings form section (around line 1363). After the `reg-form-url` input group, add:

```html
<div style="margin-bottom:14px;">
  <label style="font-weight:600;font-size:13px;color:var(--dark-text);display:block;margin-bottom:4px;">Access Code</label>
  <input type="text" id="reg-access-code" placeholder="e.g. G4Women2027" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
  <div style="font-size:11px;color:#888;margin-top:3px;">Women enter this code after registering to unlock the app. Include it in the church confirmation email.</div>
</div>
```

- [ ] **Step 2: Add active year selector**

After the access code input, add:

```html
<div style="margin-bottom:14px;">
  <label style="font-weight:600;font-size:13px;color:var(--dark-text);display:block;margin-bottom:4px;">Active Retreat Year</label>
  <select id="reg-active-year" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
    <option value="2027">2027</option>
    <option value="2026">2026</option>
  </select>
  <div style="font-size:11px;color:#888;margin-top:3px;">Which year the app is currently running. Controls what sisters see by default.</div>
</div>
```

- [ ] **Step 3: Wire up load and save**

In `loadRegistrationSettings()` (around line 4290), add after existing field loads:

```javascript
document.getElementById('reg-access-code').value = settings.registration_access_code || '';
document.getElementById('reg-active-year').value = settings.active_retreat_year || '2027';
```

In `saveRegistrationSettings()` (around line 4303), add to the payload object:

```javascript
registration_access_code: document.getElementById('reg-access-code').value.trim(),
active_retreat_year: document.getElementById('reg-active-year').value
```

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Heather\G4-incredible-gifts" && git add admin.html && git commit -m "$(cat <<'EOF'
Add access code and active year fields to admin registration settings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Frontend — Landing Page HTML & CSS

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `GET /api/registration/settings` for dynamic URL/price
- Produces: `#landing-page` div visible by default, hidden on auth; `#app-container` (existing `.app-container`) hidden by default, shown on auth

- [ ] **Step 1: Add landing page HTML before `.app-container`**

Find the opening `<div class="app-container">` (around line 3340). BEFORE it, add the landing page div. The app container itself gets `style="display:none"` added (it will be shown by JS on auth):

```html
<!-- ===== LANDING PAGE ===== -->
<div id="landing-page">
  <!-- Hero -->
  <div style="text-align:center;padding:60px 24px 40px;background:linear-gradient(180deg,rgba(138,158,122,0.12) 0%,var(--cream) 100%);">
    <div style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:15px;color:var(--sage);letter-spacing:1px;margin-bottom:8px;">APRIL 8-10, 2027 &middot; OCEAN CITY, MD</div>
    <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:clamp(32px,8vw,48px);color:var(--dark-text);margin:0 0 8px;line-height:1.15;">G4 Women's Retreat</h1>
    <div style="font-family:'Playfair Display',Georgia,serif;font-size:clamp(18px,4.5vw,24px);color:var(--sage);margin-bottom:6px;">2027</div>
    <div id="landing-theme" style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;color:var(--rose);margin-top:12px;display:none;"></div>
    <div style="width:60px;height:2px;background:var(--sage);margin:20px auto 0;border-radius:2px;"></div>
  </div>

  <!-- What's Included -->
  <div style="padding:32px 24px;max-width:500px;margin:0 auto;">
    <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:var(--dark-text);margin:0 0 16px;text-align:center;">What's Included</h2>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;font-size:15px;color:var(--dark-text);"><span style="color:var(--sage);font-size:18px;">&#10003;</span> 2 nights at the Hyatt Place Oceanfront</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:15px;color:var(--dark-text);"><span style="color:var(--sage);font-size:18px;">&#10003;</span> Retreat sessions &amp; speakers</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:15px;color:var(--dark-text);"><span style="color:var(--sage);font-size:18px;">&#10003;</span> Gift bags</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:15px;color:var(--dark-text);"><span style="color:var(--sage);font-size:18px;">&#10003;</span> Hot buffet breakfast Friday &amp; Saturday</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:15px;color:var(--dark-text);"><span style="color:var(--sage);font-size:18px;">&#10003;</span> Friday night party</div>
      <div style="display:flex;align-items:center;gap:10px;font-size:15px;color:var(--dark-text);"><span style="color:var(--sage);font-size:18px;">&#10003;</span> Rooms with 2 queen beds + pull-out sofa</div>
    </div>
  </div>

  <!-- Room Pricing -->
  <div style="padding:0 24px 32px;max-width:500px;margin:0 auto;">
    <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:var(--dark-text);margin:0 0 16px;text-align:center;">Room Pricing</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div style="background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:var(--shadow-sm);">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:var(--sage);font-weight:700;">$430</div>
        <div style="font-size:13px;color:var(--dark-text);margin-top:4px;">per person</div>
        <div style="font-size:12px;color:#888;margin-top:2px;">1 person room</div>
      </div>
      <div style="background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:var(--shadow-sm);">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:var(--sage);font-weight:700;">$280</div>
        <div style="font-size:13px;color:var(--dark-text);margin-top:4px;">per person</div>
        <div style="font-size:12px;color:#888;margin-top:2px;">2 person room</div>
      </div>
      <div style="background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:var(--shadow-sm);">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:var(--sage);font-weight:700;">$230</div>
        <div style="font-size:13px;color:var(--dark-text);margin-top:4px;">per person</div>
        <div style="font-size:12px;color:#888;margin-top:2px;">3 person room</div>
      </div>
      <div style="background:white;border-radius:12px;padding:16px;text-align:center;box-shadow:var(--shadow-sm);">
        <div style="font-family:'Playfair Display',Georgia,serif;font-size:24px;color:var(--sage);font-weight:700;">$190</div>
        <div style="font-size:13px;color:var(--dark-text);margin-top:4px;">per person</div>
        <div style="font-size:12px;color:#888;margin-top:2px;">4 person room</div>
      </div>
    </div>
  </div>

  <!-- Schedule Snapshot -->
  <div style="padding:0 24px 32px;max-width:500px;margin:0 auto;">
    <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:var(--dark-text);margin:0 0 16px;text-align:center;">Schedule</h2>
    <div style="background:white;border-radius:12px;padding:20px;box-shadow:var(--shadow-sm);">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
        <span style="font-weight:600;color:var(--dark-text);font-size:14px;">Thursday</span>
        <span style="color:#888;font-size:14px;">Check-in 5:00 PM &middot; Session 1 at 7:00 PM</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
        <span style="font-weight:600;color:var(--dark-text);font-size:14px;">Friday</span>
        <span style="color:#888;font-size:14px;">Breakfast &middot; Sessions &middot; Party</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">
        <span style="font-weight:600;color:var(--dark-text);font-size:14px;">Saturday</span>
        <span style="color:#888;font-size:14px;">Breakfast &middot; Final Session &middot; Ends 12:00 PM</span>
      </div>
    </div>
  </div>

  <!-- Hotel -->
  <div style="padding:0 24px 32px;max-width:500px;margin:0 auto;text-align:center;">
    <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:var(--dark-text);margin:0 0 8px;">Our Home for the Weekend</h2>
    <p style="font-size:15px;color:var(--dark-text);margin:0 0 8px;">Hyatt Place Oceanfront, Ocean City, MD</p>
    <a href="https://www.hyatt.com/hyatt-place/en-US/occzn-hyatt-place-ocean-city-oceanfront" target="_blank" rel="noopener" style="font-size:14px;color:var(--sage);text-decoration:underline;">View hotel &amp; amenities</a>
  </div>

  <!-- Register CTA -->
  <div style="padding:0 24px 32px;max-width:500px;margin:0 auto;text-align:center;">
    <div style="background:linear-gradient(135deg,rgba(138,158,122,0.15),rgba(138,158,122,0.05));border:1.5px solid rgba(138,158,122,0.3);border-radius:16px;padding:28px 24px;">
      <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;color:var(--dark-text);margin:0 0 8px;">Register Now</h2>
      <p style="font-size:14px;color:#888;margin:0 0 4px;">Registration &amp; full payment due by January 30, 2027</p>
      <p style="font-size:14px;color:var(--accent);font-weight:600;margin:0 0 16px;">Limited space available. Don't wait!</p>
      <a id="landing-register-btn" href="https://graceseaford.ccbchurch.com/goto/forms/189/responses/new" target="_blank" rel="noopener"
         style="display:inline-block;padding:14px 36px;background:var(--sage);color:white;font-family:'Playfair Display',Georgia,serif;font-size:16px;font-weight:600;border-radius:28px;text-decoration:none;letter-spacing:0.5px;box-shadow:var(--shadow-md);transition:var(--transition);">
        Register for G4 2027
      </a>
    </div>
  </div>

  <!-- Already Registered — Code Entry -->
  <div style="padding:0 24px 48px;max-width:500px;margin:0 auto;">
    <div style="background:white;border-radius:16px;padding:28px 24px;box-shadow:var(--shadow-sm);text-align:center;">
      <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;color:var(--dark-text);margin:0 0 6px;">Already Registered?</h2>
      <p style="font-size:13px;color:#888;margin:0 0 16px;">Check your registration confirmation email for your access code</p>
      <div id="landing-error" style="display:none;color:var(--accent);font-size:13px;margin-bottom:10px;"></div>
      <input type="text" id="landing-first" placeholder="First name" autocomplete="given-name"
             style="width:100%;padding:12px 14px;border:1.5px solid #ddd;border-radius:10px;font-size:16px;margin-bottom:10px;box-sizing:border-box;font-family:Georgia,serif;">
      <input type="text" id="landing-last" placeholder="Last name" autocomplete="family-name"
             style="width:100%;padding:12px 14px;border:1.5px solid #ddd;border-radius:10px;font-size:16px;margin-bottom:10px;box-sizing:border-box;font-family:Georgia,serif;">
      <input type="text" id="landing-code" placeholder="Access code" autocomplete="off"
             style="width:100%;padding:12px 14px;border:1.5px solid #ddd;border-radius:10px;font-size:16px;margin-bottom:16px;box-sizing:border-box;font-family:Georgia,serif;">
      <button type="button" id="landing-enter-btn"
              style="width:100%;padding:14px;background:var(--sage);color:white;border:none;border-radius:28px;font-family:'Playfair Display',Georgia,serif;font-size:16px;font-weight:600;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:var(--transition);">
        Enter the App
      </button>
    </div>
  </div>

  <!-- Footer -->
  <div style="text-align:center;padding:0 24px 40px;font-size:12px;color:#aaa;">
    G4 Women's Retreat &middot; Grace Community Church, Seaford, DE
  </div>
</div>
<!-- ===== END LANDING PAGE ===== -->
```

Then add `style="display:none"` to the existing `.app-container` div:

```html
<div class="app-container" style="display:none;">
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\Heather\G4-incredible-gifts" && git add index.html && git commit -m "$(cat <<'EOF'
Add landing page HTML with retreat info, pricing, and code entry form

App container hidden by default — shown only after code validation.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Frontend — Auth Flow (Code Entry → App Unlock)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `POST /api/auth/enter` (from Task 1), `#landing-page` and `#landing-*` elements (from Task 3)
- Produces: `unlockApp()` function that hides landing, shows app, sets `currentUser`; modified `initSetup()` that checks auth state

- [ ] **Step 1: Modify `initSetup()` to gate on landing page**

Find `initSetup()` (around line 4717). Replace the beginning of the function to check auth AND show landing page:

```javascript
function initSetup() {
  const saved = localStorage.getItem('g4user') || getCookie('g4user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      // Valid user with current year access — show app
      unlockApp();
      showWelcome();
      document.getElementById('prayer-compose').style.display = 'block';
      document.getElementById('moments-upload').style.display = 'block';
      document.getElementById('video-section').style.display = 'block';
      loadPeople();
      return;
    } catch(e) {
      localStorage.removeItem('g4user');
    }
  }
  // No valid user — show landing page, hide app
  var landing = document.getElementById('landing-page');
  if (landing) landing.style.display = 'block';
  document.querySelector('.app-container').style.display = 'none';
  initLandingPage();
}
```

- [ ] **Step 2: Add `unlockApp()` function**

Add this above `initSetup()`:

```javascript
function unlockApp() {
  var landing = document.getElementById('landing-page');
  if (landing) landing.style.display = 'none';
  document.querySelector('.app-container').style.display = '';
  // Also hide the old setup modal if it was somehow visible
  var setupModal = document.getElementById('setup-modal');
  if (setupModal) setupModal.style.display = 'none';
}
```

- [ ] **Step 3: Add `initLandingPage()` function with code entry handler**

Add below `unlockApp()`:

```javascript
function initLandingPage() {
  // Load dynamic registration URL from settings
  fetch(API_BASE + '/api/registration/settings')
    .then(function(r) { return r.json(); })
    .then(function(settings) {
      var regBtn = document.getElementById('landing-register-btn');
      if (regBtn && settings.registration_form_url) {
        regBtn.href = settings.registration_form_url;
      }
    })
    .catch(function() {});

  // Code entry handler
  var enterBtn = document.getElementById('landing-enter-btn');
  if (!enterBtn) return;
  enterBtn.addEventListener('click', async function() {
    var firstName = document.getElementById('landing-first').value.trim();
    var lastName = document.getElementById('landing-last').value.trim();
    var code = document.getElementById('landing-code').value.trim();
    var errorEl = document.getElementById('landing-error');

    // Validation
    if (!firstName || !lastName || !code) {
      errorEl.textContent = 'Please fill in all fields.';
      errorEl.style.display = 'block';
      if (!firstName) document.getElementById('landing-first').style.borderColor = 'var(--accent)';
      if (!lastName) document.getElementById('landing-last').style.borderColor = 'var(--accent)';
      if (!code) document.getElementById('landing-code').style.borderColor = 'var(--accent)';
      return;
    }

    enterBtn.disabled = true;
    enterBtn.textContent = 'Checking...';
    errorEl.style.display = 'none';

    try {
      var resp = await fetch(API_BASE + '/api/auth/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, code: code })
      });
      var result = await resp.json();

      if (!resp.ok || result.error) {
        errorEl.textContent = result.error || 'Something went wrong. Please try again.';
        errorEl.style.display = 'block';
        enterBtn.disabled = false;
        enterBtn.textContent = 'Enter the App';
        return;
      }

      // Success — save user and unlock
      currentUser = result;
      saveUser(currentUser);
      unlockApp();
      showWelcome();
      document.getElementById('prayer-compose').style.display = 'block';
      document.getElementById('moments-upload').style.display = 'block';
      document.getElementById('video-section').style.display = 'block';
      loadPeople();
      launchConfetti();
      showToast('Welcome to G4, ' + currentUser.first_name + '! ✨');
    } catch(e) {
      errorEl.textContent = 'Could not connect. Check your internet and try again.';
      errorEl.style.display = 'block';
      enterBtn.disabled = false;
      enterBtn.textContent = 'Enter the App';
    }
  });
}
```

- [ ] **Step 4: Remove the old setup modal auto-display from `initSetup`**

The old code shows `#setup-modal` when no user is found. Since we now show the landing page instead, remove or gate the old setup modal display. Find the line `modal.style.display = 'flex'` in `initSetup()` and wrap it so it only runs if there's no landing page:

```javascript
// Only show old setup modal if landing page doesn't exist (fallback)
if (!document.getElementById('landing-page')) {
  modal.style.display = 'flex';
  modal.classList.add('animate-in');
  // ... existing setup-btn listener ...
}
```

- [ ] **Step 5: Add personal password UI in profile**

Find the `openProfile()` function. Inside the profile modal content, after existing fields, add a password section:

```javascript
// Inside the profile modal HTML generation, after the last existing field:
var pwSection = '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(0,0,0,0.06);">' +
  '<div style="font-weight:600;font-size:14px;color:var(--dark-text);margin-bottom:8px;">Personal Password</div>' +
  '<div style="font-size:12px;color:#888;margin-bottom:10px;">Set a personal password so you don\'t need the access code every time.</div>' +
  '<input type="password" id="profile-password" placeholder="New password (4+ characters)" style="width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:10px;font-size:14px;margin-bottom:8px;box-sizing:border-box;">' +
  '<button type="button" id="save-password-btn" style="padding:8px 20px;background:var(--sage);color:white;border:none;border-radius:20px;font-size:13px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;">Save Password</button>' +
  '</div>';
```

Add the click handler for the save button after rendering the profile modal:

```javascript
var savePwBtn = document.getElementById('save-password-btn');
if (savePwBtn) {
  savePwBtn.addEventListener('click', async function() {
    var pw = document.getElementById('profile-password').value.trim();
    if (pw.length < 4) { showToast('Password must be at least 4 characters'); return; }
    try {
      var resp = await fetch(API_BASE + '/api/users/' + currentUser.id + '/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      if (resp.ok) {
        showToast('Password saved! You can use it next time you log in.');
        document.getElementById('profile-password').value = '';
      } else {
        var err = await resp.json();
        showToast(err.error || 'Could not save password');
      }
    } catch(e) {
      showToast('Could not save password. Check your connection.');
    }
  });
}
```

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\Heather\G4-incredible-gifts" && git add index.html && git commit -m "$(cat <<'EOF'
Wire landing page auth flow: code entry, app unlock, personal password

- initSetup gates on landing page instead of setup modal
- unlockApp() toggles landing/app visibility
- initLandingPage() handles code entry via POST /api/auth/enter
- Personal password UI in profile modal

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Worker — Add `retreat_year` to Content Tables

**Files:**
- Modify: `worker/src/index.js`

**Interfaces:**
- Consumes: All existing content tables
- Produces: `retreat_year` column on every content table; `getActiveYear(db)` helper function

- [ ] **Step 1: Add `getActiveYear()` helper**

Near the top of the worker (after the `requireAdmin` function, around line 192), add:

```javascript
async function getActiveYear(db) {
  try {
    const row = await db.prepare("SELECT value FROM game_settings WHERE key = 'active_retreat_year'").first();
    return parseInt(row && row.value) || 2027;
  } catch(e) { return 2027; }
}
```

- [ ] **Step 2: Add lazy migrations for `retreat_year` on all content tables**

In the existing lazy migration block (around lines 100-105), add after existing migrations:

```javascript
// Year separation for content tables
const yearTables = ['moments', 'moment_reactions', 'moment_comments', 'feedback', 'gratitude', 'journal_activity', 'quiz_scores', 'poll_responses', 'wyr_votes', 'stories', 'celebration_messages', 'secret_sister_pairings'];
for (const tbl of yearTables) {
  try { await env.DB.prepare(`ALTER TABLE ${tbl} ADD COLUMN retreat_year INTEGER DEFAULT 2026`).run(); } catch(e) {}
}
```

This sets all existing rows to 2026 (the default), so current data is automatically tagged as 2026 data.

- [ ] **Step 3: Update INSERT statements to include `retreat_year`**

For each content table's INSERT endpoint, add `retreat_year` to the column list and bind the active year. The key endpoints to modify:

**Moments upload** (find `INSERT INTO moments`):
Add `retreat_year` column and bind `activeYear`:
```javascript
const activeYear = await getActiveYear(env.DB);
// In the INSERT statement, add retreat_year to columns and activeYear to binds
```

**Prayer wall / messages** (find `INSERT INTO messages`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Gratitude** (find `INSERT INTO gratitude`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Feedback** (find `INSERT INTO feedback`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Moment reactions** (find `INSERT INTO moment_reactions`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Moment comments** (find `INSERT INTO moment_comments`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Journal activity** (find `INSERT INTO journal_activity`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Quiz scores** (find `INSERT INTO quiz_scores`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Poll responses** (find `INSERT INTO poll_responses`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**WYR votes** (find `INSERT INTO wyr_votes`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Stories** (find `INSERT INTO stories`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Celebration messages** (find `INSERT INTO celebration_messages`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

**Secret sister pairings** (find `INSERT INTO secret_sister_pairings`):
```javascript
const activeYear = await getActiveYear(env.DB);
// Add retreat_year column + bind
```

For each INSERT, the pattern is the same: add `, retreat_year` to the column list, add `, ?` to the values, and add `activeYear` to the `.bind()` arguments.

- [ ] **Step 4: Update SELECT statements to filter by `retreat_year`**

For each content table's GET endpoint, add `WHERE retreat_year = ?` (or `AND retreat_year = ?` if there's already a WHERE clause). Accept an optional `?year=` query parameter to allow the frontend to request a specific year (for archive mode), defaulting to the active year:

```javascript
const url = new URL(request.url);
const requestedYear = parseInt(url.searchParams.get('year')) || await getActiveYear(env.DB);
```

Then add `AND retreat_year = ?` and bind `requestedYear` to each SELECT query.

Key GET endpoints to modify:
- `GET /api/moments`
- `GET /api/messages` (prayer wall)
- `GET /api/gratitude`
- `GET /api/feedback` (admin)
- `GET /api/moments/:id/reactions`
- `GET /api/moments/:id/comments`
- `GET /api/journal/stats`
- `GET /api/quiz/scores`
- `GET /api/polls`
- `GET /api/wyr`
- `GET /api/stories`
- `GET /api/celebrations`

- [ ] **Step 5: Deploy and verify**

```bash
cd "C:\Users\Heather\G4-incredible-gifts\worker" && npx wrangler deploy
```

Verify existing 2026 data still loads (default year = 2027 but existing rows have retreat_year = 2026, so need to confirm the active year setting is 2026 until Heather switches it, OR set the active year to 2027 and confirm 2026 data comes back when `?year=2026` is passed).

**Important:** Before deploying, set `active_retreat_year = 2026` in game_settings via admin so the app doesn't suddenly show empty content. Heather will switch to 2027 when she's ready.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\Heather\G4-incredible-gifts" && git add worker/src/index.js && git commit -m "$(cat <<'EOF'
Add retreat_year to all content tables for year separation

- Lazy migrations add retreat_year (default 2026) to all content tables
- All INSERTs tag with active year from game_settings
- All SELECTs filter by year, accept ?year= param for archive mode
- getActiveYear() helper reads active_retreat_year from settings

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend — Year Toggle & Archive Mode

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `currentUser.retreat_year`, all data-loading functions, `?year=` query param support on API (from Task 5)
- Produces: `viewingYear` global, `switchYear()` function, archive mode banner, year toggle UI

- [ ] **Step 1: Add `viewingYear` global and year-aware API helper**

Near the top of the script section (around where `currentUser` is declared), add:

```javascript
var viewingYear = 2027; // Set on auth, controls which year's data loads
var activeYear = 2027;  // The year the app is "running" for

function apiGetYear(endpoint) {
  var sep = endpoint.includes('?') ? '&' : '?';
  return fetch(API_BASE + endpoint + sep + 'year=' + viewingYear).then(function(r) { return r.json(); });
}
```

- [ ] **Step 2: Update data-loading functions to use `viewingYear`**

For each function that fetches content data, append `?year=` + `viewingYear` to the API call. The key functions:

- `loadMoments()` — change `apiGet('/api/moments')` to `apiGet('/api/moments?year=' + viewingYear)`
- `initPrayerWall()` / prayer wall load — add year param
- `loadGratitude()` — add year param
- `loadStoryFeed()` — add year param
- `loadCelebrationsHomeCard()` — add year param
- `loadMyCelebrationStatus()` — add year param

For each, find the `apiGet` or `fetch` call and append the year parameter. Use the pattern:

```javascript
var yearParam = 'year=' + viewingYear;
// If URL already has ?, use &yearParam, otherwise use ?yearParam
```

- [ ] **Step 3: Add year toggle UI**

In the profile modal (inside `openProfile()`), add a year toggle section before the password section (only for women who have 2026 data — check if `currentUser.retreat_year` was originally 2026 or if they are a returning user):

```javascript
var yearToggle = '';
// Show toggle if user existed before 2027 (returning sister)
if (currentUser.returning || (currentUser.retreat_year_original && currentUser.retreat_year_original <= 2026)) {
  yearToggle = '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(0,0,0,0.06);">' +
    '<div style="font-weight:600;font-size:14px;color:var(--dark-text);margin-bottom:8px;">Past Retreats</div>' +
    '<button type="button" id="toggle-year-btn" style="padding:10px 20px;background:' + (viewingYear === 2026 ? 'var(--accent)' : 'var(--taupe)') + ';color:white;border:none;border-radius:20px;font-size:13px;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;">' +
    (viewingYear === 2026 ? 'Back to 2027' : 'View 2026 Memories') +
    '</button></div>';
}
```

Add the click handler:

```javascript
var toggleBtn = document.getElementById('toggle-year-btn');
if (toggleBtn) {
  toggleBtn.addEventListener('click', function() {
    if (viewingYear === 2026) {
      viewingYear = activeYear;
    } else {
      viewingYear = 2026;
    }
    closeProfile();
    switchYear();
  });
}
```

- [ ] **Step 4: Add `switchYear()` function and archive banner**

```javascript
function switchYear() {
  // Show/hide archive banner
  var banner = document.getElementById('archive-banner');
  if (viewingYear !== activeYear) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'archive-banner';
      banner.style.cssText = 'background:var(--taupe);color:white;text-align:center;padding:8px 16px;font-size:13px;font-weight:600;position:sticky;top:0;z-index:1000;';
      banner.innerHTML = 'Viewing your 2026 memories <button type="button" onclick="viewingYear=' + activeYear + ';switchYear();" style="margin-left:10px;padding:4px 12px;background:white;color:var(--taupe);border:none;border-radius:12px;font-size:12px;cursor:pointer;touch-action:manipulation;">Back to ' + activeYear + '</button>';
      document.body.insertBefore(banner, document.body.firstChild);
    }
    banner.style.display = 'block';
  } else {
    if (banner) banner.style.display = 'none';
  }

  // Hide write actions in archive mode
  var writeElements = document.querySelectorAll('.write-action');
  writeElements.forEach(function(el) {
    el.style.display = (viewingYear !== activeYear) ? 'none' : '';
  });

  // Reload all data for the new year
  if (typeof loadMoments === 'function') loadMoments();
  if (typeof initPrayerWall === 'function') initPrayerWall();
  if (typeof loadStoryFeed === 'function') loadStoryFeed();
  if (typeof loadCelebrationsHomeCard === 'function') loadCelebrationsHomeCard();
  // Trigger home tab refresh
  var homeTab = document.getElementById('home-tab');
  if (homeTab && homeTab.classList.contains('active')) {
    buildHome();
  }
}
```

- [ ] **Step 5: Tag write-action elements with `class="write-action"`**

Find the key submit/compose elements and add `class="write-action"` (or append to existing classes):
- `#prayer-compose` — prayer submit form
- `#moments-upload` — photo upload area
- Moment reaction buttons
- Moment comment forms
- Story submit button
- Celebration send buttons
- Gratitude submit form

These get `display:none` in archive mode so the woman can browse but not post.

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\Heather\G4-incredible-gifts" && git add index.html && git commit -m "$(cat <<'EOF'
Add year toggle and archive mode for 2026 memories

- viewingYear global controls which year's data loads
- Year toggle in profile for returning sisters
- Archive banner with back button when viewing past year
- Write actions hidden in archive mode
- All data-loading functions pass year param

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Integration Test & Deploy

**Files:**
- All files from Tasks 1-6

**Interfaces:**
- Consumes: Everything built in Tasks 1-6
- Produces: Fully deployed and working landing page + gated app

- [ ] **Step 1: Set the access code in admin**

Go to admin.html, Registration settings, set the Access Code to `G4Women2027`. Save.

- [ ] **Step 2: Set active year to 2026 temporarily**

In admin, set Active Retreat Year to `2026` so existing content keeps showing while we test. Heather will flip to 2027 when ready for the fresh start.

- [ ] **Step 3: Test landing page in incognito**

1. Open g4retreatapp.org in incognito (no localStorage).
2. Verify landing page shows with all sections: hero, included, pricing, schedule, hotel, register CTA, code entry.
3. Verify Register button links to the church form.
4. Try entering wrong code — verify error message shows.
5. Enter correct code (G4Women2027) with a test name — verify app unlocks.

- [ ] **Step 4: Test returning user flow**

1. Clear localStorage.
2. Enter code with the name of an existing 2026 sister.
3. Verify she's matched to her existing account (returning: true).
4. Verify her profile data carried over.

- [ ] **Step 5: Test year toggle**

1. Log in as a returning sister.
2. Open profile, verify "View 2026 Memories" button appears.
3. Click it — verify archive banner shows, content switches to 2026 data.
4. Verify write actions (compose prayer, upload moment, etc.) are hidden.
5. Click "Back to 2027" — verify live app returns.

- [ ] **Step 6: Test personal password**

1. In profile, set a personal password.
2. Clear localStorage.
3. On landing page, enter name + personal password (not universal code).
4. Verify app unlocks.

- [ ] **Step 7: Deploy everything**

```bash
cd "C:\Users\Heather\G4-incredible-gifts\worker" && npx wrangler deploy
cd "C:\Users\Heather\G4-incredible-gifts" && git add -A && git commit -m "$(cat <<'EOF'
Final integration: landing page, access code gating, year separation

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)" && git push origin main
```

- [ ] **Step 8: Verify production**

1. Visit g4retreatapp.org in incognito — landing page should show.
2. Existing logged-in sisters (with localStorage) should still see the app directly.
3. Admin panel should show access code and year fields.
