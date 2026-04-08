# G4 Incredible Gifts — Claude Code Instructions

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

## Repo quick facts

- Static HTML frontend (plain HTML + vanilla JS, no framework) at the repo root.
- Cloudflare Worker backend at `worker/src/index.js` (all `/api/*` routes).
- Cloudflare D1 database; schema in `schema.sql`, seed in `seed.sql`.
- Styling: inline CSS with custom properties (`--cream`, `--taupe`, `--sage`,
  `--blush`, etc.). Fonts: Playfair Display (headers), Cormorant Garamond (body).
- API base URL used by the frontend pages:
  `https://g4-retreat-api.brieyasmom.workers.dev`
- Admin dashboard is `admin.html`; main app is `index.html`.
- Slideshow pages live at the repo root as individual HTML files
  (`slideshow.html`, `meme-slideshow.html`, `moments-slideshow.html`,
  `videos-slideshow.html`, `whoami-slideshow.html`, `retreat-slideshow.html`).
