# H-2 — CI parity and fixture isolation

Date: 2026-09-07. Mode: DELIVERY. H-2-T1: PREPARATORY / X;
H-2-T2: PREPARATORY / V. DoR/pull gate: PASS from H-1's accepted environment
diagnosis and supported runtime contract. No architecture/schema decision changed.

## Result and scope

The CI workflow now installs the frozen lockfile under Node 22.x / Bun 1.3.13
and invokes `scripts/verify-ci.mjs`. The runner refuses ambient database URLs,
runtime dotenv files and non-fresh checkouts; creates an owned temporary SQLite
fixture; runs installed Prisma under Node; and calls the canonical type, lint,
test, Node-backed offline doctor and packaged build scripts.

The fixture is initialized with plain `db push`, without `--accept-data-loss`.
Successful client generation and output presence replace the ineffective Git-diff
check against ignored generated files. This is fixture initialization, not a
migration test. `verify` now includes the standalone asset-copy step through
`bun run build`. The nested Bun test process disables dotenv/autoinstall.

The child environment excludes ambient application credentials and injection
options. It contains generated, run-local credentials to satisfy real production
configuration validation, plus isolated home/temp/Git settings. No validation
bypass or automatic privilege escalation is added. Cleanup accepts only an opaque
handle created in the current process and checks the canonical directory, identity,
ownership and absence of links before deletion.

## Evidence

| Check | Result |
|---|---|
| Tests-first orchestration regressions | Initial missing-runner failure recorded by implementation agent; final Node run 19/19 passes. |
| Focused runner coverage | Implementation agent reported 92.27% lines / 86.49% branches under Node coverage. |
| Full canonical suite after changes | **925 pass, 0 fail across 94 files**, including all 19 new tests. Exit 0; 107.75 seconds. |
| `bun run type-check` | Exit 0, no diagnostics. |
| `bun run lint` | Exit 0, no errors; four existing hook-dependency warnings unchanged. |
| Independent static implementation review | PASS; no material implementation or cleanup/security defect found. |
| Real SQLite boundary | Focused test runs the installed Prisma CLI under Node and verifies the actual Project table using better-sqlite3 in a path containing spaces. |
| Actual offline fixture doctor | Node Prisma validate/db push and canonical Node-backed doctor each exit 0; 10 checks, 9 pass, 1 expected no-runtimes warning, 0 failures. Owned fixture removed. |
| Hosted Linux CI / packaged build | Not executed in this session; no run URL or successful-build claim. |

The full-suite run used the reviewed credential-free runner:

```powershell
node tmp/gpm/H-1-T2/run-suite.mjs H-2-T1
```

It executes `bun --no-env-file --no-install run test --no-env-file --no-install`
against the changed working tree; start/end 2026-09-07 18:31:47–18:33:39 UTC.
Sanitized raw output: `tmp/gpm/H-2-T1/suite.log`. Expected negative-test logger
messages are not failing assertions. Ordinary discovery includes the new
`scripts/__tests__/verify-ci.test.mjs`; no separate hidden test gate is required.

The 19 added cases cover rejected live database/dotenv inputs, missing/wrong
runtimes, non-fresh checkouts, generated output, literal child arguments, unique
fixture ownership, sibling/replacement/link refusal, repeated cleanup, failed-child
propagation, environment isolation and actual SQLite setup. Tests replace only
the application-owned command port where needed; filesystem/SQLite/child behavior
is exercised directly. No third-party behavioral mocks or production shortcuts.

## Handoff and limits

Contracts: [entrypoints](../snapshots/verification-entrypoints.md) and
[test isolation](../snapshots/test-isolation.md). Operator guidance:
[verification](../../../verification.md). No lockfile, application source,
production database or deployment was changed; no commit or remote workflow was
created. The workspace's pre-existing planning changes are preserved.

The runner deliberately requires an env-file-free, clean checkout without `.next`;
it is for CI and disposable verification checkouts. Ordinary development checks
remain available. A local mocked-suite pass does not establish Linux packaging,
production readiness or the daemon end-to-end path. H-3 owns the daemon tracer.

Rollback: revert the isolated CI/script/package changes together; retain the
evidence. Reverting these files does not undo or modify any application data.
No user-facing feature flag, migration or additional technical-debt shortcut.

Offline integration output is saved in `tmp/gpm/H-2-T1/doctor-fixture.log`.
The scratch helper initially returned 1 while parsing JSON preceded by Prisma
query logs; its three actual child commands had already returned 0 and cleanup
had completed. JSON was recovered from the saved output without rerunning the
database operations. This parsing correction affected only the scratch helper.

**H-2 implementation and local verification COMPLETE. H-2-T2: PASS.** The
independent reviewer accepted the actual check results, implementation and updated
contracts, including the explicitly recorded scratch-parser correction. Hosted
Linux CI and packaging remain unexecuted evidence; H-3-T1 daemon diagnosis is next.
