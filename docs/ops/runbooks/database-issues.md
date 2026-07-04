# Runbook — Database issues (SQLite locked / Postgres switch)

**Symptoms.** `/api/health` returns **503** with `db: "error"`; `bun run doctor`
`database` row FAILS (`unreachable`); requests 500; logs show
`SQLITE_BUSY`/`database is locked`, or connection-refused / auth errors against
Postgres.

Relevant SLO: SLO-5 (app health). A `db: error` is a hard health failure. See
[../slos.md](../slos.md).

## Which database am I on?

Runtime is chosen by `DATABASE_URL` prefix (`src/lib/db.ts`,
`isPostgresDb = startsWith('postgresql')`):
- `file:./prisma/dev.db` (or unset) → **SQLite** via `better-sqlite3` adapter (default).
- `postgresql://…` → **Postgres** via `adapter-pg` (enables pgvector features).

> **Fragile duality.** The Prisma **schema `provider` is hardcoded `sqlite`**
> (`prisma/schema.prisma`). The runtime *adapter* switches on the URL, but the
> generated client/migrations are sqlite-shaped. Moving to Postgres is **not**
> just changing `DATABASE_URL` — see "Switching to Postgres" below. (This is
> known debt; ADR pending in F-3.)

## Checks

```bash
bun run doctor                 # database + prisma-client rows
curl -s localhost:3000/api/health | jq '.db, .status'   # "error" + "degraded"?
```

1. `doctor` `prisma-client` FAILS (`missing`) → client not generated:
   `bun run db:generate`.
2. `doctor` `database` FAILS → the adapter can't reach the DB. Read the log
   detail (first 200 chars are surfaced) to tell "locked" from "unreachable".

## SQLite: `database is locked` / `SQLITE_BUSY`

Cause: SQLite is single-writer; a **second process** (a stray app instance, a
leftover `bun run smoke:daemon`, an open `sqlite3`/GUI session, or a second
scheduler) is holding a write lock. This ties into the **single-instance**
constraint — see [dispatch-stalled.md](dispatch-stalled.md) step 2.

Resolution:
- Find and stop the extra writer. Ensure **exactly one** app process (and one
  scheduler) per `dev.db` file.
- Check for a stuck `dev.db-wal` / `dev.db-shm` alongside the DB — a clean
  shutdown clears them; if the app is stopped and they linger with a lock, no
  other process should be attached.
- Long writes (big migrations) briefly hold the lock — retry after they finish.
- If corruption is suspected, the DB is a file: stop the app, back up
  `prisma/dev.db*`, and restore/recreate (`bun run db:push` / migrate) as a last
  resort. **This is destructive to local data — back up first.**

## Postgres: unreachable / auth / pgvector

Resolution:
- Verify `DATABASE_URL` host/port/credentials and that the server is up
  (`pg_isready`, or a manual `psql`). Connection-refused ⇒ server down / wrong
  host; auth error ⇒ bad credentials or `pg_hba`.
- pgvector: semantic skill search requires the `vector` extension
  (`CREATE EXTENSION IF NOT EXISTS vector;`). Without it, embeddings fall back to
  text search — not a DB outage, just degraded search.

## Switching SQLite → Postgres (planned migration, not a live fix)

This is a **deliberate migration**, not incident recovery — do it in a
maintenance window:
1. Set `DATABASE_URL=postgresql://…`.
2. Change the schema `provider` to `postgresql` in `prisma/schema.prisma`
   (currently hardcoded `sqlite`), regenerate the client, and apply
   migrations/`db push` against the Postgres instance.
3. Install the `vector` extension for pgvector features.
4. Data does **not** copy itself — export/import if you need existing rows.
5. Verify with `bun run doctor` (`database` PASS) and `/api/health` (`status:ok`).

## Escalation

If `/api/health` reports `db: error` with the DB demonstrably up and reachable
(`psql`/`pg_isready` fine, no SQLite lock), capture the full error detail from
the app logs and the `doctor --json` `database` row and escalate to the
persistence owner — suspect adapter/URL mismatch (e.g. a `postgresql://` URL
against a sqlite-generated client, or vice-versa).
