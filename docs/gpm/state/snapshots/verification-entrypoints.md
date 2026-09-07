# Contract snapshot: verification entrypoints

Version: 2 (H-2 implementation), 2026-09-07. Owner: package scripts / ADR-0007.

| Entrypoint | Actual interpreter and contract |
|---|---|
| `bun run type-check` | TypeScript, no emit, no incremental artifacts. |
| `bun run lint` | ESLint; existing warnings remain visible. |
| `bun run test [pattern]` | Bun with dotenv/autoinstall disabled; 30-second timeout; excludes `e2e` and `.next`; optional pattern narrows discovery. |
| `bun run doctor --offline [--json]` | Node through tsx; configured database reads/counts; network checks skipped. |
| `bun run build` | Next compilation plus Node `copy-standalone.mjs`; failure of either fails the command. |
| `bun run verify` | Types, lint, tests, packaged `build`, offline doctor; requires a configured development/fixture environment. |
| `bun run verify:ci` | Node `scripts/verify-ci.mjs`; fresh checkout, owned temporary SQLite, isolated environment, canonical checks and packaged build; refuses live DB/dotenv inputs. |
| `bun run smoke:daemon` | Bun exception; fixture/process/server/database smoke, separate H-3 scope. |

Observed Windows matrix: Node 22.15.0, Bun 1.3.13. CI requires Node 22.x and
Bun 1.3.13. After H-2 changes the isolated unrestricted full suite passes 925
tests in 94 files; restricted package-name resolution fails on this host.
Installed packages were unchanged. [Evidence](../evidence/H-2-verification.md).

Errors: package scripts propagate nonzero child status; import failures can
prevent test registration/assertions. A failed check is never a skipped pass.
Offline doctor requires an explicit disposable database for verification; both
Prisma config and app DB otherwise fall back to `prisma/dev.db`.

Diagnostic flags `--no-env-file --no-install` must reach the nested Bun test
process. They do not sanitize inherited credentials or suppress Next's own
dotenv behavior. Host permission changes require the host's scoped approval.

CI uses the same package test/doctor/build entrypoints and frozen installation.
Prisma runs through its installed Node CLI with an explicit new fixture URL;
there is no destructive data-loss flag or migration claim. See the
[isolation contract](test-isolation.md). No hosted CI or packaging success has
been observed in this session.
