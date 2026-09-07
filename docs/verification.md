# Verification

Conductor uses **Node for the application and doctor** and **Bun for the mocked
test suite and tooling**. See [ADR-0007](adr/ADR-0007-node-runtime-bun-tooling.md).
The September diagnostic environment is Windows, Node 22.15.0 and Bun 1.3.13.
This is observed evidence, not a claim that every Node/Bun version is supported.

Run the existing package scripts from the repository root:

```powershell
bun run type-check
bun run lint
bun run test
bun run test ./src/__tests__/api/projects.test.ts
```

`test` disables dotenv/autoinstall in its Bun process, preserves the 30-second
per-test timeout and excludes Playwright `e2e` and generated `.next` tests.
A filtered run proves only its selected tests.
Use `bun run e2e` separately when the browser fixture environment is ready.

For a configured disposable database, `bun run doctor --offline` invokes Node
through `tsx`. The doctor can access the configured database; offline means no
network checks, not no database access. Do not point verification fixture setup
at an existing application database.

`bun run build` compiles Next and copies standalone assets. `bun run verify`
includes that full build between tests and offline doctor. Production packaging
and deployment require their separate gates.

## Isolated CI verification

In an env-file-free, clean checkout without `.next`, run `bun run verify:ci`
after installing the frozen lockfile. It requires Node 22.x and Bun 1.3.13 and
refuses an inherited `DATABASE_URL`. It creates its own temporary SQLite database,
generates the client, initializes the fixture schema, and runs types, lint, tests,
offline doctor and the packaged build. Each failing stage stops the run.

The runner isolates credentials, home/temp directories and Git configuration.
Run-local generated credentials satisfy configuration validation; provider and
SMTP credentials are not inherited. Cleanup deletes only the fixture it created
and refuses replaced or linked paths. Existing application databases are outside
this command's contract. See the [isolation snapshot](gpm/state/snapshots/test-isolation.md).

## Diagnosing installed-package failures

On this Windows host, the managed execution sandbox prevented Bun from resolving
the installed `mustache` and `@opentelemetry/api` package names, despite readable
entry files. The same executable and packages resolved outside the sandbox, and
the unchanged projects test passed all eight assertions there. See the
[H-1-T1 evidence](gpm/state/evidence/H-1-T1-verification-diagnosis.md).

Check Node and Bun package resolution before reinstalling dependencies:

```powershell
node -e 'for (const p of ["mustache", "@opentelemetry/api"]) console.log(p, require.resolve(p))'
bun --no-env-file --no-install -e 'for (const p of ["mustache", "@opentelemetry/api"]) console.log(p, require.resolve(p))'
```

A difference is diagnostic evidence; it does not by itself identify the cause.
Where the host requires permission for execution outside a sandbox, request a
scoped diagnostic through that host. Repository scripts do not change host
permissions or retry with elevated privileges.

For a diagnostic that must not load local dotenv files, apply suppression to
both the outer command and the nested test process:

```powershell
bun --no-env-file --no-install run test --no-env-file --no-install ./src/__tests__/api/projects.test.ts
```

These flags do not remove already inherited environment variables. A protected
diagnostic additionally uses a child-environment allowlist and an explicit unused
fixture database URL. The full suite also spawns local fake CLIs and temporary
Git repositories; isolate its temporary storage and Git configuration/hooks.
Never treat a missing-import error as a failed business assertion, hide it with
extra mocks, or use an old passing test count as today's acceptance criterion.
