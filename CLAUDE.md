# G4 Incredible Gifts — Claude Code Instructions

## Who you're working with

- **Heather** is the primary contact and one of the retreat leaders. The
  repo handle `brieyasmom` comes from her (she is Brie's mom).
- The app serves the women who attended **G4 2026 Women's Retreat —
  "Incredible Gifts"**, held April 9-11, 2026 in Ocean City, MD.
- The post-retreat devotions run Monday April 13, 2026 → 15 weeks forward.
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

### Post-retreat (everything built in this branch)
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

## File organization reference

Key functions and roughly where they live in `index.html`:

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

Key admin functions in `admin.html`:

- `renderVisibilityToggles` / `toggleVisibilityKey` — unified
  nav+home admin page. `FEATURE_ITEMS_DEDUPED` is the source.
- `loadFeedback` / `renderRatingsBreakdown` / `renderSpeakers` /
  `renderAppFeedback` / `downloadFeedbackCsv`
- `loadTopics` / `toggleStarTopic` / `downloadTopicsCsv`
- `loadStories` / `renderStoriesList` / `updateStory` /
  `deleteStory` / `downloadStoriesCsv` / `setStoryFilter`

## Roadmap & open threads

Not yet built, deferred by agreement:

- **Year rollover to G4 2027** — add `retreat_year` column to year-
  specific tables, `retreat_years` config table, admin "active year"
  setting, preview mode. Build in late June / early July, invisible
  to 2026 women.
- **Stripe registration for 2027** — price + early bird + scholarship
  option, Checkout session flow, webhook to mark registered status.
  Build after rollover groundwork lands.
- **Session audio archive** — upload MP3 per session for women to
  re-listen. Highest-impact post-retreat feature; needs audio files
  from Heather first.
- **Monthly "Hey from Heather" video** — admin-recorded short video
  drops on the 1st of each month, home card announces it.
- **Sister Spotlight** — weekly featured sister rotation through
  the whole roster over several months.
- **Per-speaker CSV export of testimonies tagged to them** — if
  speakers want just their related stories.

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
