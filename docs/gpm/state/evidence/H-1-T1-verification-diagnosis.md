# H-1-T1 — verification diagnosis

Date: 2026-09-07. Mode: DELIVERY. Hat: PREPARATORY. Tier: R.
**DoR: PASS. Pull gate: PASS. Diagnostic DoD: PASS.** User authorized execution
of the September plan. This report completes the diagnosis; it is not a full-suite
or release verdict.

## Preserved baseline and isolation

- Source: `e85706e251ff0a3c481992ac7b1f3a6a18ec7472`, package 0.4.0.
- Existing working-tree changes were the September planning files. No source,
  dependency, lockfile, CI, schema or active environment file changed in this task.
- Node 22.15.0: `C:/Program Files/nodejs/node.exe`.
- Bun 1.3.13 (`bf2e2cec`): `C:/Users/yannick.verrydt/.bun/bin/bun.exe`.
- Package scripts and ADR-0007 match the brief: Node app/doctor; Bun mocked tests;
  Bun-only daemon smoke exception. CI inconsistencies below are already-known gaps.
- The projects test registers mocked authentication and database access before its
  dynamic route import. Its project has no budget; only mocked project operations
  execute. Requests are in-memory. A separate GPM partner agent checked this path.
- The test child receives only Windows process essentials, `NODE_ENV=test`,
  `OTEL_SDK_DISABLED=true`, and an unused diagnostic database URL. Both Bun layers
  disable dotenv and automatic package installation. No application credentials
  are inherited. No database was created or contacted.

## Exact probes and results

Package-name probe, from the repository root, under both Node and Bun:

```powershell
node -e 'for (const p of ["mustache", "@opentelemetry/api"]) { try { console.log(p, require.resolve(p)) } catch (e) { console.log(p, e.code, e.message) } }'
bun --no-env-file --no-install -e 'for (const p of ["mustache", "@opentelemetry/api"]) { try { console.log(p, require.resolve(p)) } catch (e) { console.log(p, e.code, e.message); process.exitCode=1 } }'
```

| Experiment | Result |
|---|---|
| Node in managed sandbox | Both installed packages resolve. |
| Bun in managed sandbox | Both package names fail with `MODULE_NOT_FOUND`; explicit entry-file paths resolve. |
| Bun file inspection in sandbox | Package manifests and entry files can be read; directory enumeration succeeds. |
| Byte-identical copied Mustache package in scratch fixture | Package-name resolution succeeds in the sandbox. Manifest SHA-256 matches the installed copy. |
| Same Bun executable/probe outside sandbox, approved scoped diagnostic | Both original installed packages resolve; exit 0. No reinstall or configuration change. |

The original installed files are hardlinked; the scratch copies are ordinary files.
The copied Mustache manifest SHA-256 is
`6CD082A032F4C79C9F57D1BBD0EBBF9626D05E25F3347B20D3745708B57ECFAE`.
This is supporting evidence of an installation/access interaction, not proof
that all hardlinks fail or identification of Bun's internal failing system call.

The fixed scratch runner `tmp/gpm/H-1-T1/run-projects-diagnostic.mjs` invokes:

```powershell
bun --no-env-file --no-install run test --no-env-file --no-install ./src/__tests__/api/projects.test.ts
```

Its package-script expansion retains the existing 30-second timeout and path
exclusions. The same runner and unchanged source were used for both runs:

| Boundary | UTC start/end | Exit | Result |
|---|---|---|---|
| Managed sandbox | 15:20:21–15:20:24 | 1 | 0 pass, 8 fail; first causal error: cannot find package `mustache`. |
| Approved execution outside sandbox | 16:14:20–16:14:27 | 0 | 8 pass, 0 fail, 8 assertions; Bun duration 4.20 seconds. |

Elapsed wall time includes waiting for execution approval; it is not test duration.
Sanitized raw output is retained locally in `tmp/gpm/H-1-T1/projects-sandbox.log`
and `projects-diagnostic.log`. Scratch files are ignored by Git.

## Classification

**Confirmed:** the reported package-resolution failure depends on the execution
environment. The installed versions, manifest contents, application source and
test assertions need no repair to make this isolated test pass. Reinstalling,
upgrading, mocking away Mustache or weakening assertions is not justified.

The import chain is projects route → budget → project-event → trigger evaluator →
reaction executor → Mustache. Static imports explain why an authentication test
encounters a rendering dependency before its assertions execute.

**Unresolved:** the exact Bun/Windows/sandbox access mechanism and whether any
of the earlier full-suite failures remain in an unrestricted, isolated run.
The earlier 604 pass / 43 fail / 27 errors are historical diagnostic results;
they are not 43 established application defects. TD-014b mock leakage is not
established by this experiment. No full-suite, coverage, build or daemon smoke
claim is made here.

## H-1-T2 handoff

**READY for the bounded operational repair:** document the verified invocation
and runtime matrix, distinguish this sandbox failure from missing dependencies,
and classify the full supported suite in a credential-free environment after its
fixture isolation is checked. No dependency/version change or ADR amendment is
needed for the demonstrated mechanism. If that run reveals a separate defect,
record and refine its own regression before changing code.

Meaningful regression evidence is the existing eight authentication/origin/role
assertions passing with the unchanged packages. No synthetic test should merely
mirror this document. Produce the actual `snapshots/verification-entrypoints.md`
after the operational contract is verified. Do not add automatic privilege
escalation to application scripts; execution permission remains with the host.

Keep H-2's separate changes visible: CI runs raw `bun test` and Bun doctor,
declares no Node version, and calls destructive fixture setup “migrations”.
`verify` compiles Next directly while `build` also copies standalone assets.
These inconsistencies do not cause the local package-resolution failure.

Rework: zero application/dependency repair attempts. New debt candidate: document
the restricted Windows execution limitation without generalizing it to every Bun
or sandbox installation. New-code coverage, feature flags, TDD implementation and
schema rollback: N/A for this report-only task. Production rollback: unnecessary.
