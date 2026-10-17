# Working on this repository

- Keep `docs/IMPROVEMENTS-AND-ROADMAP.md` current: with every user-visible change, add a dated line to its change log, and tick or move items in its future plan. Write it for the clinic owner (plain language, no code).
- `public/` is generated: edit `content/` and `scripts/`, run `npm run build`, and commit the output. CI fails if `public/` doesn't match a fresh build.
- Run `npm test` before committing.
