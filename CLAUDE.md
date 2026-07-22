# JollofSwap — notes for AI assistants

## Deploying to production (jollofswap.com)

**Pushing `main` to `origin` does NOT deploy anything.** The live site is served by
GitHub Pages from the **`gh-pages`** branch, which is a `git subtree split` of the
committed `dist/` folder — a separate step. Forgetting it is a recurring mistake:
`main` looks done, tests pass, but the live site keeps serving whatever `dist/` was
last split to `gh-pages`, which can be several commits stale.

After any change to `src/` (or anything that affects the built output) that should
go live, run all of these, in order:

```bash
npm run build                                                  # rebuilds dist/
git add dist/ && git commit -m "Deploy: <what changed>"        # dist/ is tracked in git
git push origin main
git push origin $(git subtree split --prefix dist HEAD):gh-pages --force
```

Verify the deploy actually landed before telling the user it's live:

```bash
git fetch origin gh-pages
git log origin/gh-pages -1 --format="%H %cd %s" --date=iso
```

Its commit/date should match what you just pushed. If you only ran `git push origin
main`, `gh-pages` is untouched and the site is still stale — this is easy to miss
because `git push` succeeds either way with no error.

A small build badge (bottom-right corner of every page, `src/components/BuildBadge.tsx`)
shows the commit hash + build time baked into the currently-loaded bundle
(`vite.config.ts`'s `define`). Use it to confirm what's actually live matches what
you expect, rather than assuming a push deployed.

## Frontend-only vs backend

The ALKE bridge backend (`bridge.jollofswap.com`) lives in a separate repo. Changes
here should never touch backend routes/workers/contracts/db — see `ALKEBRIDGE.md`
for the bridge's frontend/backend contract.
