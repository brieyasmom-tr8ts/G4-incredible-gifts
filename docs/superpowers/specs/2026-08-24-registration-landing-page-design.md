# G4 2027 Registration Landing Page & Access Flow

## Overview

Transform g4retreatapp.org from an open app into a gated experience: every visitor sees a public landing page first. Only women who have registered through the church form and entered the universal access code can get into the app. Returning 2026 sisters go through the same flow but can toggle back to view their archived 2026 content.

## Landing Page

Built into `index.html` as the default view when not authenticated. Uses the existing aesthetic (Playfair Display headers, sage/cream/blush palette). Scrollable, mobile-first.

### Content blocks (top to bottom)

1. **Hero** — "G4 Women's Retreat 2027" + April 8-10, 2027 + Ocean City, MD. Placeholder area for the theme tagline once decided. Background image or soft gradient.

2. **What's Included** — bullet list:
   - Overnight stay at the Hyatt Place Oceanfront (2 nights)
   - Retreat sessions & speakers
   - Gift bags
   - Hot buffet breakfast Friday & Saturday mornings
   - Friday night party
   - Hotel rooms: 2 queen beds + pull-out sofa

3. **Room Pricing** — clean tier cards:
   - One Person Room: $430/person
   - Two Person Room: $280/person
   - Three Person Room: $230/person
   - Four Person Room: $190/person

4. **Schedule Snapshot** — Check-in 5pm Thursday, Session 1 at 7pm Thursday, retreat ends Saturday noon.

5. **Hotel Highlight** — Hyatt Place Oceanfront mention with outbound link to their amenities page.

6. **Registration CTA** — deadline (Jan 30, 2027), "Limited space available" urgency text, prominent button linking to `https://graceseaford.ccbchurch.com/goto/forms/189/responses/new`. Price text pulled from admin settings so it can be updated without code changes.

7. **Already Registered?** — code entry section:
   - First name + last name fields
   - Access code field
   - "Enter" button
   - Small helper text: "Check your registration confirmation email for your access code"

8. **Past Attendee Link** — subtle link at the bottom: "Were you at G4 2026? Enter your code to access this year's app and view your 2026 memories too."

## Auth & Access Flow

### Universal access code

- Stored in `game_settings` as key `access_code`.
- Admin sets/changes it in Admin > Registration settings (new field).
- One code for all women. Included in the church's registration confirmation email by Heather.

### First-time entry (new woman)

1. She visits g4retreatapp.org, sees landing page.
2. Clicks "Register" button, goes to church form, pays, gets confirmation email with the code.
3. Returns to g4retreatapp.org, scrolls to "Already Registered?", enters first name + last name + code.
4. Worker validates code against `game_settings.access_code`.
5. If valid: creates new user with `retreat_year = 2027`, `reg_registered = 1`. Returns auth token. App loads.
6. If invalid: shows error "That code doesn't match. Check your confirmation email and try again."

### First-time entry (returning 2026 sister)

1. Same landing page, same code entry.
2. Worker matches her by name against existing users (same fuzzy matching already in `POST /api/users`).
3. If matched: updates her record — adds 2027 access, keeps all 2026 data intact. Returns auth token.
4. If not matched (name changed, etc.): creates new user record for 2027. She can contact Heather to link accounts later.

### Subsequent visits

- Auth token stored in localStorage (existing pattern). If valid token exists on page load, skip landing page, show app directly.
- If token is expired/cleared, she sees the landing page again and re-enters her name + code (or personal password if she set one).

### Optional personal password

- After first login, profile section offers "Set a personal password" so she doesn't need the universal code every time.
- Stored hashed on her user record (`password_hash` column).
- Login then accepts either the universal code OR her personal password in the code field.
- Password reset: she just uses the universal code again and can set a new personal password.

## Year Toggle & Fresh App Reset

### Fresh start for 2027

When a woman enters the app after code entry, she sees a clean 2027 experience:
- Empty moments wall, fresh prayer wall, clean gratitude wall
- New schedule, polls, journey (when configured)
- Her profile carries over (name, photo, church, birthday, anniversary)
- All activity is fresh for 2027

### Database year separation

Year-specific tables get a `retreat_year` column (where not already present):
- `moments` — photos/videos
- `prayers` — prayer wall posts
- `gratitude` — gratitude wall entries
- `poll_votes` — poll responses
- `quiz_scores` — quiz results
- `stories` — testimonies
- `celebrations` — birthday/anniversary messages
- `moment_reactions`, `moment_comments` — interaction data
- `journal_activity` — activity pings (journal content stays in localStorage, no year issue)

All frontend queries filter by the active year. All inserts tag with the current year. Nothing from 2026 is deleted.

Tables that are NOT year-separated (shared across years):
- `users` — one record per woman, carries forward
- `game_settings` — app-wide config
- `secret_sisters` — re-paired each year (new rows with `retreat_year`)

### Year toggle UI

- Accessible from the user's profile or a subtle footer/header control.
- "View 2026 Memories" switches to a read-only archive view.
- In archive mode: she can browse her 2026 moments, journal, journey responses, devotions, celebrations. She cannot post, react, or comment.
- "Back to 2027" returns to the live app.
- Only visible to women who have 2026 data (new 2027-only women don't see it).

### Admin controls

- Active retreat year setting in admin (already partially built via `retreat_year` on users).
- New admin field: "Active Year" that controls which year the app is running for.
- 2026 admin data remains viewable — admin can switch year context to review old feedback, stories, etc.
- Registration settings (URL, price, code, open/closed) are per the active year.

## Worker Changes

### New/modified endpoints

- `POST /api/auth/enter` — new endpoint. Accepts `{ first_name, last_name, code }`. Validates code against `game_settings.access_code`. Creates or matches user. Returns user object + auth token.
- `POST /api/users/:id/password` — new endpoint. Accepts `{ password }`. Hashes and stores on user record. Requires auth.
- `GET /api/registration/settings` — add `access_code` to response (or a boolean `code_required: true` so the code itself isn't leaked to unauthenticated clients).
- Modify all year-specific GET endpoints to accept/filter by `retreat_year` parameter.
- Modify all year-specific POST endpoints to tag inserts with the active retreat year.

### New columns (lazy migration)

- `users.password_hash` — TEXT, nullable. For optional personal passwords.
- `retreat_year` column on all year-specific tables listed above (some may already have it).
- `users.years_attended` — TEXT, nullable. Comma-separated list like "2026,2027" to track multi-year access. Alternative: just query by name match across year-tagged data.

### Settings keys (game_settings)

- `access_code` — the universal gate code
- `active_retreat_year` — which year the app is currently running (default 2027)

## Frontend Changes

### index.html modifications

1. **On page load**: check for valid auth token in localStorage.
   - If valid token exists and user has access to active year: show app (existing behavior).
   - If no token or invalid: show landing page, hide app entirely.

2. **Landing page HTML**: new section at the top of body, hidden when authenticated. All the content blocks described above.

3. **Code entry form**: POSTs to `/api/auth/enter`, stores token on success, hides landing page, initializes app.

4. **Year toggle**: new UI element in profile area. Switches a global `viewingYear` variable that all data-fetching functions reference.

5. **Archive mode**: when `viewingYear !== activeYear`, hide all post/submit/react buttons. Show a subtle banner: "You're viewing your 2026 memories".

### admin.html modifications

1. **Registration settings**: add "Access Code" field alongside existing URL/price/toggle.
2. **Active Year selector**: dropdown or toggle to switch admin context between years.
3. **Year filter on data tabs**: feedback, stories, moments, etc. can be filtered by year.

## Security

- The universal code is NOT a security boundary — it's a friction gate. The real access control is the auth token.
- Personal passwords are hashed (bcrypt or Web Crypto SHA-256 + salt, whatever is available in Workers runtime).
- The access code is not exposed to unauthenticated API callers. The `/api/auth/enter` endpoint validates it server-side.
- Existing admin auth model unchanged (`X-Admin-Key` header).

## What does NOT change

- No Stripe, no in-app payments.
- Church form remains the payment surface.
- Admin CSV import still works for payment reconciliation.
- Marnie / Send Love tab stays intact.
- Existing retreat-time features untouched.
- Journal content stays in localStorage (privacy model unchanged).
- Standalone slideshow HTML files unchanged.
