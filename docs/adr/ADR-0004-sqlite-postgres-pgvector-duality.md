# ADR-0004: SQLite / Postgres / pgvector duality

Status: Accepted

Date: 2026-07-04

## Context

Conductor must run turnkey with zero infrastructure (a single SQLite file) for
the solo-operator default, yet also support PostgreSQL + pgvector when semantic
memory/skill search is wanted. Prisma's schema `datasource` provider is a
compile-time constant — it cannot be "either/or" — and pgvector's `vector` type
has no SQLite equivalent. We need one schema and one codebase to serve both.

## Decision

- **Schema provider is hardcoded `sqlite`.** `prisma/schema.prisma` declares
  `datasource db { provider = "sqlite" }`. This keeps `prisma generate`, the
  client types, and the migration-free `db push` workflow SQLite-shaped for the
  default install.
- **Runtime adapter swap in `db.ts`.** `src/lib/db.ts` inspects
  `DATABASE_URL`: `isPostgresDb` is true when it starts with `postgresql`. When
  true it loads `@prisma/adapter-pg`; otherwise `@prisma/adapter-better-sqlite3`
  (default `file:./prisma/dev.db`). Both adapter packages are installed; exactly
  one is constructed per process. The Prisma driver-adapter layer lets a
  sqlite-provider client talk to Postgres at runtime.
- **Embeddings stored as `String?`, cast to `vector` via raw SQL on Postgres.**
  `Skill.embedding` and `AgentMemory.embedding` are `String?` columns holding a
  JSON float array (`prisma/schema.prisma` comments say so explicitly). On
  Postgres, semantic search casts inline in raw SQL —
  `embedding::vector <=> $1::vector AS distance` via `db.$queryRawUnsafe`
  (`src/lib/server/memory.ts`; the skills search route does the same). The
  `vector` extension is created by `scripts/init-pgvector.sql`
  (`CREATE EXTENSION IF NOT EXISTS vector`), run by the compose init hook.
- **Text fallback on SQLite (and Postgres without an embedding).** When
  `isPostgresDb` is false — or the OpenAI embedding is unavailable / non-finite
  — retrieval degrades to a substring/`findMany` match rather than failing
  (`memory.ts`). Embeddings are only generated when `OPENAI_API_KEY` is set
  (`src/lib/server/embeddings.ts`); otherwise memory still works, just without
  vector ranking.

## Consequences

- The default install needs no database server, no extension, no migration
  tooling — a file and `bun run db:push`.
- Semantic search is a strict enhancement: turning on Postgres + pgvector +
  `OPENAI_API_KEY` upgrades ranking; turning any of them off degrades to text
  match with no code branching at call sites beyond the one `isPostgresDb`
  check.
- **Fragility (flagged in the brownfield evaluation): the duality is
  under-constrained.** Because the provider is pinned to `sqlite`, Prisma's
  type/DDL awareness of the `vector` column is bypassed — the column is a
  `String` to Prisma and a `vector` only through hand-written raw SQL and the
  init script. A schema change touching those tables, or a Postgres deploy that
  skips `init-pgvector.sql`, can silently fall back to text search. The raw SQL
  paths (`$queryRawUnsafe`) are also outside Prisma's parameter-typing and must
  be reviewed as hand-written SQL.
- Any future column that needs a Postgres-only type must follow the same
  pattern: a portable Prisma column type plus raw SQL for the PG-specific
  behaviour, guarded by `isPostgresDb`.
</content>
