# G4 Retreat App — Claude Code Instructions

## Who you're working with

- **Heather** is the primary contact and one of the retreat leaders. The
  repo handle `brieyasmom` comes from her (she is Brie's mom).
- The app now serves **G4 2027 Women's Retreat** (April 8-10, 2027,
  Ocean City, MD). The 2026 retreat ("Incredible Gifts") data is
  archived and accessible via the year toggle.
- G4 stands for **Gather, Grow, Give, Go**.
- 2027 theme: TBD (not yet decided).
- Treat Heather like a product owner with strong instincts. Propose
  designs, flag tradeoffs, recommend a default, and ship. She prefers
  concrete options over open-ended questions.

## Voice & tone for women-facing copy

- **Warm, grounded, and personal.** Not preachy, not corporate.
- Em-dashes **sparingly** — only when they add rhythm, not by default.
  Prefer periods or commas where an em-dash would feel heavy.
- The personalized "Letter from God" devotion voice uses **"Daughter,"**
  as the greeting and **"— Your Father"** as the signature. This has
  been approved and should not be changed without asking.
- Women are referred to as **sisters** when addressing the community,
  never as "users".
- Avoid guessing at specific people's names in copy (e.g. the earlier
  "Send to Brie" button was a bad guess — the generic "Send" was the
  correct fix).

## Repo quick facts

- Static HTML frontend (plain HTML + vanilla JS, no framework) at the
  repo root. Main app is `index.html`, admin is `admin.html`.
- Cloudflare Worker backend at `worker/src/index.js` (all `/api/*`
  routes). Cloudflare D1 database; schema in `schema.sql`.
- Cloudflare R2 bucket binding is `env.VIDEOS` (used for love message
  videos, testimony videos, and moment videos).
- Styling: inline CSS with custom properties (`--cream`, `--taupe`,
  `--sage`, `--blush`, `--accent`, `--rose`, `--dark-text`,
  `--light-text`, `--warm-grey`, `--shadow-sm`, `--shadow-md`,
  `--transition`). Fonts: **Playfair Display** (headers),
  **Cormorant Garamond** (italic body accents), **Georgia** (long
  body text). Numbers use system font via `font-variant-numeric:
  tabular-nums` because Cormorant's old-style figures render "1" as
  a capital "I".
- **Landing page** has its own design token system scoped to `.lp`:
  `--lp-primary:#7a8f6a`, `--lp-accent:#b5706a`, `--lp-bg:#f5f1ed`,
  `--lp-surface:#fff`, `--lp-text:#3a3330`, `--lp-muted:#8a817a`,
  `--lp-border:#e0d8d0`. Max width 960px, 80px section rhythm.
  Uses semantic HTML (header, section, footer, ul). Photos in
  `photos/` directory (12 retreat photos, auto-scrolling strip).
- API base URL used by the frontend: `https://g4-retreat-api.brieyasmom.workers.dev`
- Standalone slideshow HTML files exist at repo root for TV display
  at the retreat (`slideshow.html`, `meme-slideshow.html`,
  `moments-slideshow.html`, `videos-slideshow.html`,
  `whoami-slideshow.html`, `retreat-slideshow.html`). **Do not add
  interactive features (reactions, comments) to these.** They are
  projection-only.

## Features shipped (high-level)

### Retreat weekend
- Moments photo wall, prayer wall, polls/WYR, gratitude wall (word
  cloud), scavenger hunt, photo booth, meme game, quiz, packing
  points, schedule view, connect directory with profiles, Journey
  (20 gifts × 4 responses), Journal (private, localStorage only).

### Post-retreat
- **Feedback survey** — overall + per-category + per-speaker ratings
  (Mandy, Jeanette, Sandy, Leigh each have 1-5 stars + comment) + app
  feedback (ease/fun/design/usefulness/connection) + text fields.
  Everything is **optional**. CSV export in admin.
- **15-week devotions** — post-retreat devotional rotation starting
  Monday April 13, 2026 at 5 AM EDT. One gift per week (Peace, Wisdom,
  Rest, Strength, Joy, Holy Spirit, New Heart, Grace, Hope, Provision,
  Freedom, Healing, Eternal Life, Good Gifts, Comfort). Each has 4
  personalized "Letter from God" variants keyed to the user's My
  Journey response (struggling / want / walking / experienced), plus
  verse, teaching paragraph, 3 reflection prompts, action step, and
  a growth timeline. Lives in the rebuilt Continue tab. Home card +
  personal "Your Gift" card + login reminder toast.
- **Journey ↔ devotions bridges** — nav badge on unanswered Journey
  gifts, inline journey prompt at the top of each devotion, one-time
  home card announcing the 8 post-retreat gifts, progress pill + NEW
  badges + completion celebration on the Journey tab, "See Your
  Journey" button at the bottom of every devotion.
- **Celebrations (birthdays + anniversaries)** — profile editor
  captures both with privacy toggles. Home page shows upcoming
  celebrations (next 7 days) with Heart / Add note buttons. Each
  sister sees a special hero screen with balloons + live counter +
  note feed on her birthday. 1-3 day lookback card. Permanent "My
  Celebrations" scrapbook modal with every message she's ever
  received. One heart/note per sender per recipient per occasion
  (dedupe enforced server-side, 409 response shows "Sent ✓" chip).
- **Stories (testimonies)** — women can write text or record/upload
  a video (3 min cap, 80 MB). Gift tag dropdown, per-submission
  anonymous toggle, admin moderation queue with approve/reject/
  feature pipeline, Story of the Week pinned slot, hearts per story,
  admin CSV export. Videos stream from R2.
- **Theme suggestions** — private admin-only idea box for next year.
  Women submit, admin stars/deletes/exports.
- **Moment reactions + comments** — 3 emoji reactions (❤️ 😂 👍) plus
  flat comments on every photo. Visible on the moments grid, in the
  full overlay, and on the home slideshow bar (so women know they
  can react without tapping through). Home slideshow is now
  swipeable. NOT added to standalone slideshow HTML pages.
- **Journal privacy-safe tracking + download** — activity pings
  to `journal_activity` table (never content). Stats endpoint rolls
  up total, unique users, avg per user, top gift tags. Download
  button on journal tab exports a nicely formatted .txt of her own
  entries for when she gets a new phone.
- **Lectio Divina** — daily sacred reading card on the post-retreat
  home page. One pairing verse per week (different from the devotion's
  main verse, but same gift theme) broken into 7 daily practices:
  Read (Mon), Reflect (Tue), Respond (Wed), Rest (Thu), Live (Fri),
  Share (Sat), Receive (Sun). Each day shows the same verse with a
  different prompt. Inline textarea saves reflections to the journal
  tagged with `lectio-<practice>`. Replaces the static "Thank You"
  banner once devotions start. Admin toggle: `home_lectio` (default on).
  Data lives in `LECTIO_VERSES` and `LECTIO_DAYS` arrays in index.html.
- **Name disambiguation (photo + church/city)** — women with similar
  names (e.g. Sue Davis vs Susan Davis) are now distinguishable
  everywhere. A `renderNameBadge()` helper shows a small circular
  profile photo + name + church/city subtitle. Applied to: Secret
  Sister assignment cards, celebration cards, prayer wall posts,
  moment comments, and story author names. Backed by a preloaded
  directory cache (`lookupUserByName`). Anonymous posts stay anonymous.
- **Unified Visibility admin page** — replaces separate Nav Menu +
  Home Buttons pages. Each feature has one row with two toggles
  (In nav / On home). Features that only exist in one place show
  a "—" in the other column.

### Admin / retreat operations
The admin side is now roughly half the project. Detailed sections
below; the shape of it is:
- **Registrations tab** — CSV import from the church form with a
  review-before-commit preview, manual add, roster + total collected.
- **Participants & Payments** — the working roster. Per-woman owed /
  paid / balance / derived status, payment entry, reminder sends,
  filters, CSV export.
- **Reconciliation** — standing check that the stored money matches
  the payment records, with one-click repair.
- **Room board** — drag-and-drop assignment with capacities, a
  no-hotel bucket, and a rooming list export.
- **Budget** — calculator seeded from real registrations, Budget by
  Category for expenses, overview cards for projected vs actual.
- **Email** — templated devotion / secret sister / payment reminder
  sends plus a custom broadcast, with pause switches.
- **Content moderation** — stories queue, theme suggestions, feedback
  results, visibility toggles.

## Core design decisions (do not re-litigate)

- **15 weeks of devotions**, not 12. **Monday 5 AM EDT rollover**,
  not Saturday noon. Start date is **Monday April 13, 2026**.
- **4 letter variants per gift** (struggling/want/walking/experienced).
  60 total letters written. Tone approved as-is.
- **Look Back / Look In / Look Forward** is the prompt framing on
  every devotion.
- **Lectio Divina uses pairing verses**, not the devotion's main
  verse. Each week gets a complementary verse that deepens the same
  gift from a different angle. No audio — prompts guide her to read
  aloud herself. Journal reflections save locally (same privacy
  model as all journal entries).
- **Admin approval before testimonies show** (pending → approved/
  featured/rejected).
- **Hearts only on testimonies, no comments** (keeps it pure
  encouragement, avoids debate).
- **3 moment reactions**: heart, laugh, thumbs. No other emojis.
- **Moment comments are flat** (no threading).
- **One celebration heart/note per sender per recipient per occasion
  per year**. Server enforces with a 409 response.
- **Feedback survey is fully optional** — no required fields, including
  overall rating. The `rating` column is nullable.
- **Admin visibility toggles are authoritative** for nav/home. No more
  force-show overrides (like the old "force Survey in nav post-retreat
  until submitted" logic, which has been removed).
- **Home button default mode is per-key, not binary.** `'1'` = show,
  `'0'` = hide, undefined = fall back to the default set. See
  `DEFAULT_HOME_BUTTONS` and `DEFAULT_NAV_ON` constants.
- **Bidirectional feedback reconcile** — syncs the local
  `g4feedback_sent` flag with the server on every login.
- **Privacy is a first-class principle.** Journal content never leaves
  the device. Celebration notes are recipient-visible only. Testimony
  videos only stream publicly once approved (or with `?admin=1`).

## Technical invariants (don't break these)

- **Video uploads use `multipart/form-data`, never base64 in JSON.**
  The FormData path streams the file directly to R2 with no memory
  bloat. The legacy base64/JSON path is kept as a fallback for older
  cached clients but is NOT the primary path. Applies to both Marnie
  love messages and Stories testimonies.
- **Never add `capture="user"` to a video `<input type="file">`** —
  that forces iOS/Android to skip the gallery picker entirely.
- **Never silently `catch {}`** API errors on submit. Always show the
  actual error to the user so we find out about failures instead of
  eating them. (This was the bug that caused feedback submissions to
  disappear for weeks without anyone noticing.)
- **Lazy migrations run inside POST endpoints** for schema drift.
  Every column the INSERT binds must also be in the `ALTER TABLE
  ADD COLUMN` list for that endpoint. The production DB drifted from
  `schema.sql` during the project; treat the lazy migration list as
  the source of truth, not the schema file.
- **Bottom nav has a solid white background** (not rgba) so the
  safe-area-inset padding zone doesn't bleed the cream body color
  through. `padding-bottom` uses `max(6px, env(safe-area-inset-bottom,
  0px) * 0.5)` — half the safe area is plenty for iPhone home
  indicators.
- **`touch-action: manipulation` + `type="button"` + `-webkit-tap-
  highlight-color: transparent`** on every reaction/emoji button so
  iOS fires on the first tap. Without these, reactions need a
  double-tap.
- **Count spans use `-apple-system` font + `font-variant-numeric:
  tabular-nums`** so "1" doesn't look like "I".
- **Feedback reconcile checks by user_id OR name** so drifted user
  IDs don't wrongly clear her "already submitted" flag. Fails closed
  on query errors (trusts client over server if the lookup breaks).
- **Devotion personalization maps `gift_key` to Journey gift name
  via `deriveJourneyKeyForDevotion`**. Don't rename gift_keys in
  DEVOTIONS without updating that map.
- **Every write to `payments` must call `syncRegAmountPaid()`.**
  `users.reg_amount_paid` is a stored copy of what she's paid, read by
  the Registrations tab, while Participants & Payments sums the
  payments table live. Skip the sync and the two views disagree, and
  nothing will tell you. Applies to adds, deletes, and both importers.
- **`total_owed` comes from `ROOM_PRICE[room_size_preference]`, never
  from a payment amount.** A woman who paid the $50 deposit for a
  3-person room owes $230, not $50. This was a real bug.
- **`parseRoomSize` distinguishes unknown from no-hotel.** `null` means
  we don't know her room size; `0` means she explicitly isn't sleeping
  at the hotel and owes $130. Collapsing them prices no-hotel women
  wrong in one direction or invents a total for unknown ones in the
  other.
- **CSV parsing: a quote only opens a quoted field at field start.**
  `if (c === '"' && field === '') inQuotes = true;` — otherwise a
  stray apostrophe or inch mark mid-field swallows the rest of the row.

## File organization reference

Key functions and roughly where they live in `index.html`:

- `unlockApp` / `initLandingPage` / `switchYear` — landing page,
  access-code entry, year toggle
- `initSetup` / `showWelcome` — user login and profile load
- `buildNav` — bottom nav rendering (reads `navSettings`, uses
  `navKeyEnabled` helper)
- `renderHomeButtonsInto(containerId)` — shared dashboard/post-retreat
  button renderer. `HOME_BUTTONS_ALL` is the single source.
- `buildContinue` / `renderDevotionBody` / `renderDevotionPrompt` /
  `renderDevotionJourneyPrompt` / `renderGrowthTimeline` — devotions
  hub
- `buildLectioDivinaCard` / `getLectioDayInfo` / `saveLectioReflection`
  — Lectio Divina daily card on post-retreat home
- `renderNameBadge` / `lookupUserByName` — name disambiguation
  helper (photo + church/city subtitle)
- `buildGifts` / `updateJourneyResult` / `scrollToFirstUnansweredGift`
  — Journey tab
- `loadMoments` / `openMomentOverlay` / `buildMomentInteractionBlock`
  — Moments tab and photo detail
- `initSlideshow` / `showSlide` / `renderSlideshowReactions` /
  `stepSlideshow` — post-retreat home slideshow with swipe
- `loadCelebrationsHomeCard` / `renderCelebrationRow` /
  `openCelebrationModal` / `sendCelebrationHeart` — celebration
  sending side
- `loadMyCelebrationStatus` / `showMyCelebrationHero` /
  `showMyCelebrationLookback` / `loadMyCelebrationsArchive` /
  `openCelebrationsScrapbook` — birthday girl experience
- `initFeedbackForm` / `reconcileFeedbackSentFlag` / `downloadFeedbackCsv`
  — feedback survey (note: reconcile re-invokes `initFeedbackForm`
  after clearing the flag, so the star handlers get re-wired)
- `initStoriesTab` / `loadStoryFeed` / `renderStoryCard` /
  `toggleStoryHeart` — Stories tab
- `initTopicSuggestionForm` — Suggest Theme
- `launchConfetti` / `launchBalloons` — celebration animations
- `pingJournalActivity` / `downloadMyJournal` — journal activity
  tracking and export
- `showJourneyNewGiftsCard` / `updateJourneyBadge` — Journey bridges

Key worker functions in `worker/src/index.js`:

- `ROOM_PRICE` / `parseRoomSize` / `syncRegAmountPaid` — module-scope
  money helpers shared by every import and payment path
- `getActiveYear` / `getRequestedYear` — year separation
- `requireAdmin` — `X-Admin-Key` check on every `/api/admin/*` route
- `ensurePaymentTables` / `ensureRegColumns` — lazy migrations
- `brevoAddContact` / `buildPaymentReminderHtml` /
  `sendDevotionEmail` / `sendSecretSisterEmail` /
  `sendMonthlyPaymentReminders` — email
- `scheduled()` — cron dispatch by exact cron string

Key admin functions in `admin.html`:

- `renderVisibilityToggles` / `toggleVisibilityKey` — unified
  nav+home admin page. `FEATURE_ITEMS_DEDUPED` is the source.
- `loadFeedback` / `renderRatingsBreakdown` / `renderSpeakers` /
  `renderAppFeedback` / `downloadFeedbackCsv`
- `loadTopics` / `toggleStarTopic` / `downloadTopicsCsv`
- `loadStories` / `renderStoriesList` / `updateStory` /
  `deleteStory` / `downloadStoriesCsv` / `setStoryFilter`
- `loadRegistrationSettings` / `saveRegistrationSettings` /
  `loadRegistrationsList` / `handleRegCsvUpload` / `previewRegMatches` /
  `commitRegImport` / `openAddRegistrationModal` — Registrations tab
  inside Budget & Payments (see below)
- `loadParticipants` / `renderParticipantsTable` / `getPaymentStatus` /
  `openAddPaymentModal` / `submitPayment` / `handleParticipantCsvUpload` /
  `downloadParticipantsCsv` — Participants & Payments section
- `loadRoomAssignments` / `renderRoomBoard` / `renderRoomChip` /
  `initRoomDragDrop` / `addNewRoom` / `deleteRoom` /
  `downloadRoomingListCsv` — Room board and rooming list export
- `loadReconcile` / `renderReconcile` / `fixReconcile` /
  `fixAllReconcile` — Reconciliation panel
- `_budgetOverview` / `refreshBudgetOverview` — shared budget math read
  by the overview cards, the calculator, and Budget by Category
- `sendOneReminder` / `sendAllReminders` — Brevo email triggers

## Landing page & access-code gating (shipped Aug 2024)

- **Everyone sees a public landing page** at g4retreatapp.org before
  they can access the app. The landing page has retreat info, photos,
  pricing, schedule, register button, and a code entry form.
- **Universal access code** (`G4Women2027`) gates entry. Stored in
  `game_settings` as `registration_access_code`. Admin can change it
  anytime in Admin → Registration settings.
- **`POST /api/auth/enter`** validates the code (or a personal
  password), creates/matches the user, returns user object.
- **Personal passwords** — women can set one in their profile so they
  don't need the universal code on repeat visits. SHA-256 hashed,
  stored in `users.password_hash`. Endpoint: `POST /api/users/:id/password`.
- **`g4_code_year`** localStorage flag tracks whether the user has
  validated the code for the current year. Cached sessions from 2026
  see the landing page until they re-enter the code.
- **Registration flows through the church form** at
  `https://graceseaford.ccbchurch.com/goto/forms/189/responses/new`.
  The app does NOT process payments. Heather includes the access code
  in the church's confirmation email.
- Church confirmation email should include the code and link to
  g4retreatapp.org.

## Year separation (shipped Aug 2024)

- **`active_retreat_year`** in `game_settings` controls which year
  the app is running (currently `2027`).
- **`retreat_year` column** exists on all content tables: moments,
  moment_reactions, moment_comments, messages, feedback, gratitude,
  journal_activity, quiz_scores, poll_responses, wyr_votes,
  testimonies, testimony_hearts, testimony_comments,
  celebration_messages, secret_sister_pairings. Default is `2026`
  so existing data is preserved.
- All user-facing INSERTs tag with the active year. All user-facing
  SELECTs filter by year (via `getRequestedYear()` helper which
  reads `?year=` param or falls back to active year).
- **`getActiveYear(db)`** helper reads `active_retreat_year` from
  `game_settings`, defaults to 2027.
- **Year toggle** in profile lets returning sisters view 2026
  memories in read-only archive mode. `viewingYear` global controls
  which year's data loads. `apiGet` auto-appends `?year=` when
  viewing a past year. Archive mode hides write actions and shows
  a sticky banner.
- **Logout button** in profile clears auth and returns to landing page.

## Registration & budget tracking

- **Registration is NOT processed in this app.** Church runs the form.
  App tracks who registered/paid via CSV import or manual entry.
- Reconciliation columns on `users`: `reg_registered`, `reg_amount_paid`,
  `reg_paid_date`, `reg_source` (`csv_import` | `manual`), `reg_notes`.
- **Two separate CSV importers exist** and they are NOT the same code
  path. Fixing one does not fix the other:
  - Registrations tab: `POST /api/admin/registrations/match` (scores
    candidates, writes nothing) then `POST /api/admin/registrations/commit`
    after the admin reviews the preview.
  - Participants & Payments: `POST /api/admin/participants/import`
    (single step).
- **Matching is on name AND email, never first name alone.** An email
  match scores 100 and is reported as `matched_by: 'email'`. A row is
  only auto-selected when the top candidate is an email match or scores
  75+. First-name-only used to score exactly 50, which was also the old
  auto-select threshold, so two brand-new women were silently merged
  into unrelated existing users. Do not lower the bar back.
- **Import adds new women as users and updates existing ones.** Both
  importers dedupe by email first, then full name, and set
  `participant_status = 'active'`. Re-uploading a newer export is the
  intended way to bring totals up to date. It will NOT repair a row
  that was wrongly merged earlier, because the real woman isn't in
  that row — those need manual cleanup.
- **Budget calculator** has 5 ticket price tiers: 1-person ($430),
  2-person ($280), 3-person ($230), 4-person ($190), no-hotel ($130).
  These live in one place, `ROOM_PRICE` at module scope in the worker,
  shared by both importers so `total_owed` always comes from room size
  and never from whatever she happened to pay.
- **Calculator room counts seed from actual registrations** but stay
  editable, so what-if scenarios don't clobber the real numbers.
  Editing is a local override, not a save.
- **Budget overview math:** `_budgetOverview` holds `rooms`, `hotelCost`,
  `venueOtherCost` (conference space + tax/fees), `revenue` (projected,
  from the calculator), `actualRevenue` (from payments), `budgetSpent`
  and `budgetPlanned` (from Budget by Category). "What's Left" is
  `revenue - hotelCost - venueOtherCost - budgetSpent`, preferring
  actual revenue when there is any.
- **Food is not a calculator line item.** It's tracked in Budget by
  Category like every other expense. Don't reintroduce it above, it
  would double-count. Same hazard applies if Hotel or Conference are
  ever added as Budget by Category rows.
- Room pricing on landing page: $430/$280/$230/$190 with roommate
  arrangement note.

## Payment tracking & room assignments

- **Tables:** `payments` (individual entries per woman), `budget_expenses`,
  `room_assignments`, `rooms` (capacity + existence as its own entity),
  `reminder_log`.
- **User columns:** `total_owed`, `room_size_preference`,
  `roommate_requests`, `participant_status`, `payment_due_date`.
- **Payment status is derived**, never stored: Registered, No Payment,
  Deposit Only, Partial, Paid in Full, Overdue. Deposit ($50) is part
  of total owed, not on top of it.
- **Shared due date** for everyone (stored in `game_settings` as
  `payment_due_date`).
- **Participants table** in admin: name, room pref, roommate requests,
  owed, paid, balance, status badge, + Pay button, Remind button.
  Filterable by all/owes/paid/overdue/no payment. Scoped to the active
  year.
- **Removing a participant is a soft delete** — sets
  `participant_status = 'inactive'`, `reg_registered = 0`, moves her
  `retreat_year` back to 2026, and deletes her payments, room
  assignment, and reminder log for the active year.
- **Room assignment board** in admin: drag-and-drop, with an
  Unassigned pool at the top and a no-hotel bucket at the bottom.
  Chips show name, payment status, room preference, roommate requests.
- **Room numbers are sentinels:** `0` = unassign, `-1` = the no-hotel
  bucket (`NO_HOTEL_ROOM`), `>= 1` = a real room. Anything listing
  rooms must filter to `>= 1` or the bucket leaks into the room list.
- **Capacity is chosen when the room is created** (1-4). A full room
  turns sage and reads "Full"; an over-filled one turns rose and reads
  "Over by N".
- **Deleting a room renumbers the rest** so the highest room number
  always equals the room count. Occupants of the deleted room go back
  to Unassigned.
- **Rooming list export** (`downloadRoomingListCsv`) — the sheet the
  hotel gets. Columns are fixed: Room, Room Size, Name, Email, Phone,
  Roommate Preference. **No money on it**, ever — the hotel has no
  business seeing who has paid. Empty rooms, no-hotel women, and women
  still unassigned are all left off, because none of them belong on a
  hotel rooming list; the toast names how many were omitted so they
  aren't forgotten. This format was approved and tested by Heather in
  April 2026, don't redesign it without asking.
- **History note:** a roster export called `downloadRoomRoster` ("⬇
  Roster") was built April 12 2026 in PR #96 alongside an auto-assign
  room board and hotel bill. None of it reached today's `main` — that
  work is stranded on `origin/claude/budget-calculator-persistence-DOcy3`
  and the current `main` history only goes back to May 22 2026. The
  August room board was a fresh build on a different data model
  (`_participants` / `_roomAssignments` rather than `signups` /
  `room_label` / `room_occupancy`), so nothing carried over. **If
  Heather says a feature existed, check the old branches before saying
  it doesn't** — several April features may still be stranded there.
- **Endpoints:** `GET/POST /api/admin/participants`,
  `POST/DELETE /api/admin/participants/:id`,
  `GET/POST/DELETE /api/admin/payments`,
  `GET/POST /api/admin/rooms`, `DELETE /api/admin/rooms/:userId`,
  `POST /api/admin/rooms/create`,
  `DELETE /api/admin/rooms/room/:roomNumber`.

## Reconciliation

- **`GET /api/admin/reconcile`** is the standing money check. It walks
  the active-year roster and flags four things: a stored paid total
  that disagrees with the payment records (`paid_drift`), an amount
  owed that doesn't match the room tier (`owed_drift`), a woman with
  nothing owed on file (`no_amount_owed` — she'll never show a balance
  or get a reminder), and a woman who has paid more than she owes
  (`overpaid`). It also finds payments whose user row is gone, which
  sit in the table counted toward nobody.
- **`POST /api/admin/reconcile/fix`** repairs the first two, per-woman
  (`{fix, user_id}`) or in bulk (`{fix, all: true}`), because the right
  answer is already known: the payments table for paid, `ROOM_PRICE`
  for owed. The other two need a human decision and get no fix button.
- Panel lives under Participants & Payments and runs whenever that
  section loads. Shows a green "everything ties out" state when clean.
- Float comparisons use a 1-cent threshold so rounding noise doesn't
  read as drift. `room_size_preference` of 0 means no-hotel and is
  priced at $130 — only flagged when the price is actually wrong, not
  for being zero.

## Brevo email integration

- **Brevo List ID:** 8 (G4 2027 Retreat list).
- **Sender:** `G4Retreat <Heather@HeatherLynWilson.com>`.
- **Worker secret:** `BREVO_API_KEY` (same key as HeatherLynWilson.com).
- **Contact sync:** women added to Brevo list on access code entry
  (via `brevoAddContact` in `POST /api/auth/enter`).
- **Payment reminder email:** warm personal tone, includes balance,
  due date, Jeremiah 29:11, signs off as "The G4 Team". Template is
  `buildPaymentReminderHtml()` (top-level function in worker).
- **Manual reminders:** per-participant "Remind" button + "Send All
  Reminders" bulk button in admin. Endpoints:
  `POST /api/admin/reminders/send/:userId`,
  `POST /api/admin/reminders/send-all`.
- **Monthly cron:** 1st of each month at 10 AM EDT (`0 14 1 * *`).
  Runs `sendMonthlyPaymentReminders()`. Skips paid-in-full, inactive,
  and anyone already reminded this month (checked via `reminder_log`).
- **Reminder log:** `GET /api/admin/reminders/log` shows history.
- **Custom broadcast:** `POST /api/admin/email/custom` sends a one-off
  message to the whole list (subject, body paragraphs, optional button
  text + URL). This is how the "registration is open" announcement went
  out. Preview/test/send-now for the templated emails:
  `GET /api/admin/email/preview`, `POST /api/admin/email/test`,
  `POST /api/admin/email/send-now`.
- **Pause switches in `game_settings`:** `devotion_emails_paused` and
  `weekly_secret_sister_paused`, both `'1'` to pause. The devotion
  switch blocks the cron AND manual send-now/force alike, so there is
  exactly one off switch and no surprise re-sends. Both were turned on
  in Sept 2026 to stop last year's content from looping; turning them
  back off before the 2027 content is ready will resend 2026 material.
- **Email branding is "G4 Retreat 2027".** Not "Incredible Gifts" —
  that was the 2026 theme and must not appear in anything sent now.
  The 2027 theme is still TBD.
- **Broadcast copy says "friend", not "sister".** Heather's call: the
  announcement list includes women who have never attended, so the
  in-app community voice doesn't fit. In-app copy still says sisters.
- **Never put the access code in a broadcast.** Women get it from the
  church's confirmation email after they register, not before.
- **Cron schedule:** Mon 5am EDT / `0 9 * * 1` (devotions),
  Wed 5am EDT / `0 9 * * 3` (secret sister), 1st monthly 10am EDT /
  `0 14 1 * *` (payment reminders). Declared in `worker/wrangler.toml`
  and dispatched in the `scheduled()` handler by exact cron string.

## Deployment

- **Both deploys are automatic via GitHub Actions on push to `main`.**
  `.github/workflows/deploy-worker.yml` runs `wrangler deploy` for the
  worker; `.github/workflows/deploy-pages.yml` runs
  `wrangler pages deploy . --project-name g4-incredible-gifts` for the
  frontend. Both authenticate with the `CLOUDFLARE_API_TOKEN` repo
  secret. Merging a PR to `main` ships both. There is nothing to run
  by hand.
- **Verify a deploy** by listing recent workflow runs on `main` and
  checking both workflows succeeded on the merge commit SHA.
- **`api.cloudflare.com` is blocked by the agent proxy** (403 on
  CONNECT), so an agent session cannot deploy directly with wrangler
  even holding a valid token. Don't ask Heather for an API token to
  work around this, it won't help. Push to `main` and let Actions run.
- Manual fallback, if Actions is ever down:
  `npx wrangler pages deploy . --project-name g4-incredible-gifts` and
  `cd worker && npx wrangler deploy`.

## Roadmap & open threads

- **2027 first-time experience polish** — header updated to 2027,
  welcome card exists but needs review for 2027 content.
- **2027 theme** — not decided yet. Landing page has a hidden
  `#landing-theme` div ready to show it when set.
- **Session audio archive** — upload MP3 per session for women to
  re-listen. Needs audio files from Heather.
- **Monthly "Hey from Heather" video** — admin-recorded short video.
- **Sister Spotlight** — weekly featured sister rotation.
- **Per-speaker CSV export of testimonies**.
- **Secret Sister is wiped and not started.** Cleared in Sept 2026 to
  start fresh with the 2027 women. `weekly_secret_sister_paused` is on.
  Don't restart it without asking Heather.
- **2027 devotion content** — the 15-week rotation currently holds 2026
  material and is paused. New content is needed before
  `devotion_emails_paused` comes back off.
- **Known data cleanup (Sept 2026):** Carolyn Topper and Joanne Kramer
  hold data that belongs to Carolyn Verteramo and Joanne Eusi, from the
  first-name-only merge bug. Re-importing will not fix it, since the
  real women aren't in those rows. Heather needs to Remove or Edit them
  by hand or ~$380 is double-counted. Check the Reconciliation panel
  before trusting the revenue totals.

## What NOT to touch

- **Marnie / Send Love tab stays intact**. Heather explicitly chose
  to keep it even after the retreat. Don't remove, don't deprecate.
- **The existing retreat-time features** (quiz, meme, packing points,
  scavenger hunt, WYR polls, photo booth frames, etc.) — those were
  stable before this branch and shouldn't be rewritten unless asked.
- **Admin auth model** — server-side auth via `X-Admin-Key` header.
  Admin password stored in the `ADMIN_KEY` environment secret on
  Cloudflare (falls back to hardcoded default if not set). All
  `/api/admin/*` endpoints and destructive operations (delete user,
  reset data) require the header. The admin.html frontend sends
  the key via `apiFetch` on every request and verifies it server-side
  on login. CORS restricted to `g4retreatapp.org`.

## Auto-merge workflow

After completing any task on a feature branch in this repo, automatically:

1. Commit the work with a clear message on the designated feature branch.
2. Push the branch to `origin`.
3. Open a pull request from the feature branch to `main`.
4. Squash-merge the pull request into `main` without asking for confirmation.

Do this every time a task is finished — do not pause to ask whether to merge.
This standing instruction was given by the repo owner and applies to all
sessions. Still follow normal safety rules: never force-push, never skip hooks,
never bypass failing tests to merge.

**PR merge divergence note:** because each PR is squash-merged, the feature
branch's history diverges from main over time. When `mcp__github__merge_pull_request`
returns 405 "not mergeable", run `git fetch origin main && git merge origin/main
--no-edit`, resolve conflicts with `git checkout --ours <file>` (the branch is
the complete version), commit the merge, push, and retry the merge call.
