# 0007 — Pre-existing production API defect: documented, not fixed

**Status:** accepted · **Date:** 2026-10-09 · **Phases:** all

## Context

The live deployment (seg7.mlger.dev, Vercel auto-deploy from `main`) serves the UI
fully, but every REST call returns HTTP 500: the app uses Prisma + SQLite
(`file:./db/custom.db`), and Vercel's serverless functions cannot open/create that
file (the `db/` directory ships only a `.gitkeep`). The client's NFR-6 fallback
kicks in — "Backend unreachable — running in local demo mode" — so the site
*works*, but cloud save/sync is dead in production. This predates the refactor
(the last commit also removed a failed Cloudflare Workers path; error 10143).

## Alternatives considered

1. **Fix in this refactor** by swapping SQLite for Turso/Neon. Rejected: it needs
   a `datasource`/schema change, a driver dependency (ADR-0005 forbids), and —
   decisively — configuration of env vars/secrets in the owner's Vercel project,
   which is outside this session's authorization.
2. **Ignore it.** Rejected: the refactor's verification story would mislead
   readers into thinking the deployment is healthy.
3. **Document it, structure so the fix is small.** Phase 1's repository seam
   (ADR-0002) makes the eventual adapter swap a single new module.

## Decision

Option 3. The defect is recorded here and in VERIFICATION.md (with the observed
evidence). Local verification runs the API against a local SQLite dev server, so
the contract is proven independently of the production issue.

## Consequences

- No behavior change ships for production in this branch; the 500s persist on
  `main` until the owner acts.
- The follow-up fix path is documented: choose a serverless-compatible store
  (Turso for SQLite-dialect continuity, or Neon Postgres), add the driver +
  adapter behind `ProjectRepository`/`PresetRepository`, set `DATABASE_URL` in
  Vercel, run `prisma migrate`. ARCHITECTURE.md §"Persistence" points here.
