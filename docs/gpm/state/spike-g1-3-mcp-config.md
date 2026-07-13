# SPIKE G1-3-T0 — MCP tools for daemon agents via `claude --mcp-config`

Date: 2026-07-13 · Timebox S · Status: DONE · Verdict: **GO for G1-3-T1** · Confirms: A13
Tested on: Windows 11 (Git Bash), `claude` v2.1.207, logged-in user auth — same host
and method as spike A-0 (`spike-a0-headless-cli.md`).
Total spike spend: ~$0.08 (5 billed haiku invocations; parse-error probes cost nothing).

---

## 1. Question

Can the daemon hand a spawned headless `claude` process a set of MCP servers derived
from Conductor's `ProjectMcpConnection` rows — with secrets via env indirection, never
in the Execution Payload or argv — and observe whether the tools actually loaded?
(Gap 1.6; AC per A13.)

## 2. Findings

### 2.1 Flags (all verified on 2.1.207, `-p` headless mode)

- `--mcp-config <configs...>` — accepts **file paths AND inline JSON strings**,
  space-separated, and **merges multiple configs** (verified: inline + file in one
  invocation produced the union of servers).
- `--strict-mcp-config` — ignores every other MCP source (user/project `.mcp.json`,
  plugins). **The daemon must always pass this**: without it, a step would silently
  inherit whatever MCP servers the daemon host user has configured.
- A string that fails to parse as JSON is interpreted as a file path → clean pre-API
  error (`MCP config file not found`) — loud, no spend.

### 2.2 Config format + live round trip (verified)

Standard `mcpServers` map. Both shapes accepted:

```json
{ "mcpServers": {
    "spike":   { "command": "node", "args": ["<abs path>"], "env": { "SPIKE_TOKEN": "${SPIKE_HOST_SECRET}" } },
    "remote":  { "type": "http", "url": "http://…/mcp", "headers": { "Authorization": "Bearer ${VAR}" } }
} }
```

Live proof (stdio fixture speaking spec-MCP: initialize/tools/list/tools/call):
the tool loaded, the model called it, and the result string round-tripped into the
`-p --output-format json` result. Tool naming is `mcp__<server>__<tool>`, and
`--allowedTools "mcp__spike__ping"` permits it (no `permission_denials`).

### 2.3 Secrets via env indirection — WORKS (the AC mechanism is confirmed)

`${VAR}` expansion from the **spawning process env** is performed by the CLI in BOTH
secret-bearing positions (verified):

- stdio server `env` block: child received the expanded value;
- **http server `headers` block**: a header-capturing local server received
  `Authorization: Bearer <expanded value>`.

So the generated config can carry only env-var *names*; the value lives solely in the
daemon host's environment — never in the payload, argv, or the config file. This is
the same env-name-indirection convention `ProjectRuntime.apiKeyEnvVar` already uses.

### 2.4 ⚠️ Failure semantics — two silent-degradation traps T1 must guard

1. **Unset env var → the literal `${NAME}` string is passed through silently.** No
   warning, no error; the server "works" with a garbage credential. → T1: the daemon
   must validate every referenced env var is set BEFORE composing the config, and
   fail the step loudly (same philosophy as `commandError`) when one is missing.
2. **A broken MCP server (bad command, unreachable URL) does not fail the run.** The
   invocation succeeds with zero MCP tools, `is_error: false`, no denials — a "no
   silent pretend" violation if unguarded. Detection hook: the stream-json
   `system:init` event carries `mcp_servers: [{name, status}]` — `"failed"` there is
   definitive. Caveat: init is emitted before slow handshakes complete, so healthy
   servers can still read `"pending"` at init (tools become available later in the
   run); `"pending"` is NOT a failure. (Open: whether a later stream event reports
   the transition — not needed for go/no-go.)

### 2.5 Conductor mapping (T1 design sketch)

- `Agent.mcpConnectionIds` (ids) is already in the payload; the connection defs
  (`ProjectMcpConnection.name/type/endpoint/config`) live server-side only. T1 ships a
  **sanitized, server-generated `mcpServers` fragment in the Execution Payload**
  (optional field, no version bump — same pattern as G1-4's `modeInstructions`):
  URLs + header *templates* with `${VAR}` placeholders, never secret values. The
  daemon validates the referenced env vars, writes a temp config file (same lifecycle
  as the system-prompt temp file), and passes `--mcp-config <file> --strict-mcp-config`.
- Auth convention: `ProjectMcpConnection.config` (currently never read — gap 1.17) is
  where header templates/env-var names go; exact schema is T1's call.
- **The claude CLI is a real spec-MCP client** (handshake, session, both transports)
  — on the daemon path it talks to the MCP servers directly, so Conductor's non-spec
  `mcp-resolver` (gap 1.17) is bypassed entirely. Daemon-path MCP can be *more*
  correct than the HTTP path until G3 fixes the resolver.
- Generic runner: MCP documented unsupported; step proceeds without it (A13 half 2 —
  no mechanics needed, just docs + no silent pretend in the payload composition).

## 3. Recommended invocation delta for the runner (G1-3-T1)

Extend the A-0 spec (§3 of that doc) with:

```
  "--mcp-config", <tempMcpConfigPath>,   // written by runner iff payload carries mcp servers; deleted in finally
  "--strict-mcp-config",                 // ALWAYS when --mcp-config is passed
```

- Before writing the file: collect `${VAR}` references; any unset in the daemon env →
  fail the step pre-spawn with an explicit message listing the missing vars.
- Parse the `system:init` stream event; if any configured server reports `"failed"`,
  fail or annotate the step per policy (recommend: fail — the agent was promised
  those tools). `"pending"` at init is healthy.
- `--allowedTools`: compose `mcp__<name>__*` patterns from the shipped fragment if
  step-mode policy wants to scope MCP; deny-by-default stays with the existing
  readOnly/write policy mapping.

## 4. Go/no-go

**GO.** All A13 mechanics verified on the dev host: flags exist and work headlessly,
config format known, env indirection works in both secret positions, tool round trip
proven, failure modes identified with concrete guards. No blocker found; the two
silent-degradation traps (§2.4) become T1 acceptance criteria, not risks.
