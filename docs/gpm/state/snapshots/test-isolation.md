# CONTRACT SNAPSHOT: Verification isolation

Version: 1

Date: 2026-09-07

Scope: H-2; DELIVERY. Sources: [orchestrator](../../../../scripts/verify-ci.mjs), [tests](../../../../scripts/__tests__/verify-ci.test.mjs), [package scripts](../../../../package.json), [CI](../../../../.github/workflows/ci.yml).

## Entry and prerequisites

`node scripts/verify-ci.mjs` (also `verify:ci`) verifies a fresh, clean checkout with installed dependencies and no `.next` output. It rejects inherited nonempty `DATABASE_URL`, case-insensitively, and runtime dotenv filenames without reading their contents; `.env.example` is allowed. Dotenv presence is checked again before every child. CI installs the frozen lockfile first.

The runtime gate requires Node 22.x and Bun 1.3.13; CI declares that matrix. Node 22.15.0 is the observed local version. This contract does not certify every Node 22 patch.

## Fixture and child contract

`createFixture(tempParent)` returns a frozen handle containing `root` and `databaseUrl`; a private WeakMap establishes ownership. Each run gets a unique canonical temporary root. The URL is `file:` followed by its absolute filesystem path, with forward slashes and unencoded spaces.

`cleanupFixture(handle)` accepts only an owned handle and is repeatable after removal. Before recursive deletion it verifies canonical parent/root paths, directory identity and prefix, and rejects replacement roots, symlinks/junctions and linked descendants. Cleanup refusal preserves the target for inspection.

Children receive allowlisted operating-system fields, the fixture URL, private home/temp/Git locations, and newly generated throwaway admin/session/realtime secrets. Provider credentials, ambient secrets and injected runtime options are not inherited. Real environment validation remains active; there is no authentication bypass. Commands use argument arrays, no shell and hidden Windows subprocesses.

After runtime/checkout checks, the sequence is Node-executed installed Prisma `validate`, `generate`, expected-client check and plain `db push`; then package type-check, lint, test, Node/tsx offline doctor and packaged build. Schema push initializes only the new fixture: it proves no migration or upgrade behavior. Test scripts themselves carry `--no-env-file --no-install`, the 30-second timeout, and E2E/`.next` exclusions, so protection reaches the actual test child. Build includes standalone asset copying.

## Results and limits

Stages emit labeled progress. A failed child stops later stages and preserves its nonzero exit code; startup failure uses 127. Cleanup runs on success/failure; a cleanup refusal is reported without masking the original failure. Successful completion requires all stages.

Recorded checks: type-check passed; lint passed with four existing warnings; 19 focused Node tests passed, including real Prisma/SQLite fixture verification. The ordinary suite passed 925 tests across 94 files, including those 19. Actual offline fixture doctor returned 10 checks, 9 pass, one expected no-runtimes warning and zero failures; cleanup completed. See [H-2 evidence](../evidence/H-2-verification.md).

Offline doctor reads fixture data. Full verification creates database/generated/build artifacts and removes its owned fixture; it is not read-only. These checks do not prove hosted CI execution, deployment, production safety or H-3 daemon smoke. The ordinary local `verify` command has no fresh-checkout isolation guarantee.
