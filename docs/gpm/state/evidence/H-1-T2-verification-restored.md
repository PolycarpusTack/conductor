# H-1-T2 — verification restored without dependency changes

Date: 2026-09-07. Mode: DELIVERY. Hat: PREPARATORY (operational documentation;
the planned FEATURE repair was unnecessary after diagnosis). Tier: X.
DoR and pull gate: PASS from the [H-1-T1 diagnosis](H-1-T1-verification-diagnosis.md).

**Result: 906 pass, 0 fail, 3,930 assertions across 93 files; exit 0.**
The full supported mocked suite ran under Bun 1.3.13 / Node 22.15.0 outside the
managed sandbox, using the existing packages and unchanged application/test code.
No lockfile change, reinstall, version upgrade, new mock or assertion suppression
was needed. The first task's independent test-quality audit returned PASS.

## Full-suite evidence

Exact child command from the fixed, reviewed credential-free runner:

```powershell
bun --no-env-file --no-install run test --no-env-file --no-install
```

Start/end: 2026-09-07 16:20:41–16:21:20 UTC; Bun reports 37.53 seconds.
Source: `e85706e251ff0a3c481992ac7b1f3a6a18ec7472`. Diagnostic runner and sanitized
raw log are retained locally at `tmp/gpm/H-1-T2/run-suite.mjs` and `suite.log`.
The runner uses a child environment allowlist, disables inherited Git configuration
and hooks, provides an empty Git template, scopes temporary files to its own root,
sets a Git discovery ceiling and an explicit unused scratch SQLite URL, and disables
dotenv/autoinstall in both Bun processes. No scratch database file was created.

The GPM partner reviewed isolation before execution. Ordinary tests mock network,
provider and database behavior; daemon tests also execute real fake CLI processes
and temporary Git commits. Four Playwright E2E files are excluded by the existing
package script. This is not the daemon end-to-end smoke.

Two static import weaknesses remain visible: `legacy-key-purge.test.ts` injects a
fake database but its service imports the real DB module, and `wizard-composer`
imports that module while testing a pure scoring function. No database operation
was observed in this run; the explicit scratch URL prevents a live fallback.
Do not introduce unrelated production refactoring under this operational task.

## Accepted operational contract and limits

[Verification guidance](../../../verification.md) now explains canonical scripts,
diagnostic dotenv flags, inherited-environment limits and the observed sandbox
failure. [Entrypoint snapshot](../snapshots/verification-entrypoints.md) records
the current runtime/command contract for H-2.

The earlier 604/43/27 result was an environment-failing run. The new total is an
observation, not a permanently required count. Full-suite success under one
controlled execution does not prove coverage, all Windows/Bun combinations,
Linux CI, a packaged build, actual provider integration or daemon completion.

TDD/new-logic coverage: N/A because no implementation repair was justified.
Existing tests provided the red/green diagnostic evidence. Documentation checks:
links and whitespace checked. Rollback is removal of the added guidance/snapshot;
no application rollback is needed. Rework: zero dependency/product repair attempts.

**H-1 COMPLETE. H-2 READY:** align CI's scripts/runtime, guard its disposable
database, remove the ineffective generated-client Git-diff assertion, and include
asset packaging in `verify`. These are actual remaining orchestration changes.
