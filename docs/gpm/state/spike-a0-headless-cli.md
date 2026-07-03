# SPIKE A-0 — Headless CLI invocation contract (Claude Code)

Date: 2026-07-03 · Timebox S · Status: DONE · Unblocks: A-1
Tested on: Windows 11 (Git Bash), `claude` v2.1.199, logged-in user auth. Linux/WSL **not** tested on this machine — every platform-specific claim below is Windows-verified unless marked otherwise.
Total spike spend: ~$0.08 (2 billed invocations, haiku; 4 further invocations failed pre-API and cost nothing).

---

## 1. Question

How does the daemon runner (EPIC A) hand a composed Execution Payload — `agent.systemPrompt` + step `instructions`, potentially several KB — to a spawned `claude` process headlessly, and how does it read back success/failure, streaming output, and cost? What must stay CLI-agnostic so `commandTemplate` also works for a generic fallback CLI?

## 2. Findings

### 2.1 Headless mode & prompt delivery

- `claude -p` / `--print` runs one non-interactive turn-loop and exits. Prompt is either the positional argument **or piped stdin**. (verified)
- **stdin works for large prompts**: an 18,797-byte prompt piped via stdin was delivered intact (model echoed a token buried behind 200 filler lines). Exit 0. (verified, Windows)
- Positional-arg delivery is bounded by the Windows `CreateProcess` command-line limit (~32,767 chars total, including program path and all flags). (ASSUMED — documented OS limit, not probed to the byte). Linux `ARG_MAX` is far larger (~2MB) but the limit still exists. (ASSUMED)
- Args passed via `spawn(cmd, argsArray)` on Windows are still joined into one command line by the OS, so the 32KB ceiling applies to *flag values* too, not just the positional prompt. (ASSUMED — Node/libuv documented behavior)
- Conclusion: **instructions go on stdin, always.** No length ceiling observed, nothing appears in the process list, nothing is shell-parsed.

### 2.2 System prompt options

- `--append-system-prompt <str>` — appends to the default Claude Code system prompt; honored in `-p` mode (verified: model obeyed a token instruction placed there).
- `--system-prompt <str>` — replaces the default system prompt entirely (verified flag exists via help; behavior ASSUMED — replacing removes the harness's tool-use guidance, generally undesirable for a coding agent).
- **Hidden file variants exist**: `--append-system-prompt-file <path>` and `--system-prompt-file <path>`. Not in the main `--help` listing (only referenced in the `--bare` description) but both parse, resolve the path relative to cwd, and fail fast with exit 1 + clear message when the file is missing — *before* any API call. (verified)
- Recommendation: agent `systemPrompt` → temp file + `--append-system-prompt-file`. Avoids the arg-length ceiling, keeps multi-KB prompts out of the process list, and fails loudly if the runner's temp-file write raced or was cleaned up.

### 2.3 Output formats (only with `--print`)

- `--output-format text` (default): final response text only. (verified in help; default behavior ASSUMED-trivial)
- `--output-format json`: **single JSON object on stdout** (verified). Shape observed:
  `{"type":"result","subtype":"success","is_error":false,"num_turns":1,"result":"OK","stop_reason":"end_turn","session_id":"…","total_cost_usd":0.017,"usage":{…},"modelUsage":{…},"permission_denials":[],"terminal_reason":"completed",…}`
- `--output-format stream-json`: **NDJSON, one event per line** (verified). Observed line types: `system` (init/status), `assistant` (message content incl. `thinking`/`text` blocks), `rate_limit_event`, and a final `result` line identical in shape to the `json` format. Ideal for the existing `daemon/sessions/[id]/events` streaming.
- I passed `--verbose` alongside `stream-json`; older versions *require* it in `-p` mode. (requirement ASSUMED — not tested without it; keep the flag, it is harmless)
- `--include-partial-messages` adds token-level chunks to stream-json (verified in help; untested).
- `--json-schema <schema>` exists for structured final output (verified in help; untested) — useful later for machine-readable step results.

### 2.4 Turn / spend limits

- `--max-turns <n>` is **not listed** in v2.1.199 `--help` but **is accepted** (verified: parsed without "unknown option" and a run with `--max-turns 1` succeeded with `num_turns: 1`). Enforcement at the limit boundary ASSUMED (documented historically; expect a `result` with an error subtype when exhausted).
- `--max-budget-usd <amount>` — print-mode-only spend ceiling (verified in help; behavior untested). Direct hook for EPIC B budgets: pass the project's remaining budget per invocation.
- Real cost floor: even a one-word reply cost $0.017–0.067 because the harness system prompt is cache-written each fresh session (verified from `total_cost_usd`/`usage`). Budgets matter.

### 2.5 Permissions & tools

- `--permission-mode <mode>`: `default | acceptEdits | auto | bypassPermissions | dontAsk | plan` (verified in help). In `-p` mode nobody can answer a permission prompt, so the runner must set an explicit mode; unpermitted tool calls surface in `permission_denials` in the result JSON. (runtime behavior ASSUMED)
- Finer control: `--allowedTools` / `--disallowedTools` / `--tools` (verified in help). E.g. a `readOnly` step policy → `--permission-mode plan` or `--disallowedTools "Write Edit Bash"`.
- `--dangerously-skip-permissions` exists; help itself recommends it only for sandboxes. Do not default to it.

### 2.6 cwd, trust, and repo selection

- The spawned process's **cwd is the working repo**: CLAUDE.md auto-discovery, git status, and file tools all root there (verified indirectly — spike runs executed in the scratchpad dir and session files/relative paths resolved there; also stated in help).
- The workspace **trust dialog is skipped** in non-interactive mode — help says verbatim: "Only use this in directories you trust." (verified in help). So the runner's cwd enforcement (A-2) is a *security* control, not just correctness.
- `--add-dir` grants extra directories; `--no-session-persistence` (print-only) keeps daemon runs off the user's session history (verified: flag accepted, run succeeded).

### 2.7 Auth inheritance

- With no `ANTHROPIC_API_KEY` in env, the spawned child used the logged-in user's stored credentials — a process spawned from a shell (i.e. exactly what the daemon does) inherits auth via the *user account's* config, no env plumbing needed. (verified, Windows)
- `ANTHROPIC_API_KEY` in env overrides; a bogus key under `--bare` → `Invalid API key` and **exit 1** with no spend. (verified) Without `--bare`, precedence between a conflicting env key and stored OAuth is ASSUMED (may consult keychain/apiKeyHelper).
- Headless Linux deploy host: no OS keychain; auth is `~/.claude` credentials (after `claude setup-token` for a long-lived subscription token) or `ANTHROPIC_API_KEY`. (ASSUMED — not testable from this machine)
- `--bare` mode: strictly env-key auth, skips hooks/CLAUDE.md/plugins — maximally deterministic runner invocations, but forfeits logged-in OAuth and repo CLAUDE.md context. Not recommended for v1; note for a future "hermetic" policy.

### 2.8 Exit codes (all verified on Windows)

| Case | Exit | Notes |
|---|---|---|
| Success | 0 | result JSON has `is_error: false`, `subtype: "success"` |
| Unknown flag | 1 | commander parse error on stderr, no API call |
| Auth failure (bad key, `--bare`) | 1 | `Invalid API key` on stdout/stderr, no spend |
| Missing `--*-system-prompt-file` | 1 | clear error, pre-API |
| Daemon-side timeout kill | 124 | existing daemon convention (index.ts), unchanged |
| Error result with exit 0? | — | **open** — treat `is_error: true` in the result line as failure even when exit is 0 |

### 2.9 Command-injection safety (verified by code reading, not new testing)

- `mini-services/conductor-daemon/index.ts` `buildCommand()` currently runs a configured `commandTemplate` through `cmd /c` / `sh -c`. That is tolerable **only** because `resolveCommandTemplate` (server-side, `src/lib/server/session-policy.ts`, invoked in `src/app/api/daemon/steps/next/route.ts:88-93`) substitutes a fixed whitelist of server-owned tokens (`agent.runtimeModel`, `task.id`, `step.id`, `step.mode`) — no user prose.
- **The prompt must never become a template token.** `instructions` and `systemPrompt` are user/LLM-authored prose; one backtick or `$(...)` would execute under `sh -c`. EPIC A DoD (3) already mandates this.
- Recommendation confirmed: runner spawns with an **argument array, `shell: false`**, prompt via **stdin**, system prompt via **temp file path** (path generated by the runner, never templated from user input).

### 2.10 Generic-CLI fallback mapping

`commandTemplate` stays CLI-agnostic. The contract the runner offers any CLI:

- Template resolves to `argv[0..n]` from the existing whitelisted tokens (extend with `{model}` etc. as needed — values remain server-owned scalars).
- Composed prompt is **written to the child's stdin, then stdin is closed**. Any CLI that reads stdin (`cat`, `codex exec`, a build script reading `-`) participates for free.
- Optional token `{promptFile}`: for CLIs that cannot read stdin, the runner writes the prompt to a temp file and substitutes its path. (design proposal, not implemented)
- Success = exit 0; streaming = raw stdout lines forwarded as session events (already implemented in index.ts). `stream-json` parsing is a **claude-specific enrichment** layered on top when `capability === 'claude-code'`; generic CLIs get plain text passthrough.

## 3. Recommended invocation spec for the runner (A-1)

```
spawn("claude", [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--append-system-prompt-file", <tempSysPromptPath>,   // written by runner, 1 per attempt, deleted in finally
  ...(agent.runtimeModel ? ["--model", agent.runtimeModel] : []),
  "--max-turns", String(policy.maxTurns ?? 30),
  "--permission-mode", mapStepMode(step.mode),          // e.g. readOnly→"plan", default→"acceptEdits"
  ...(budgetUsd ? ["--max-budget-usd", String(budgetUsd)] : []),
], { cwd: workspacePath, shell: false, stdio: ["pipe","pipe","pipe"] })

child.stdin.write(composedInstructions); child.stdin.end()
```

- **Stdin protocol**: full composed instructions (step.instructions + task title/description context) as UTF-8, single write, close stdin. No positional prompt argument.
- **System prompt**: `agent.systemPrompt` (+ `modeInstructions[step.mode]`) → temp file → `--append-system-prompt-file`. Fallback if the hidden flag disappears in a future CLI version: `--append-system-prompt <str>` for prompts < ~8KB.
- **Streaming**: forward each stdout NDJSON line as a session event (batched — A-3); on close, take the last `"type":"result"` line.
- **Exit interpretation**: exit ≠ 0 → fail step with stderr tail (existing path). Exit 0 → parse result line; `is_error: true` or missing result line → fail; else `result` string → step output, `total_cost_usd` → cost recording (feeds B-7), `session_id`/`num_turns`/`permission_denials` → evidence.
- **Timeout**: keep daemon-side kill (existing 124 convention); do not rely on CLI-internal limits.

## 4. Risks & open questions

1. **Hidden-flag churn**: `--max-turns`, `--append-system-prompt-file` are undocumented in `--help` for 2.1.199. Mitigation: record the CLI version at daemon registration (capabilities already carry a version field); A-1 tests pin against a fake CLI, and the real-CLI smoke (A-4) will catch removals. (open)
2. **Exit-0-but-error**: unverified whether `error_max_turns` / budget-exhausted terminate non-zero. Runner must treat `is_error` as authoritative. (open — verify free of charge in A-4 by setting `--max-budget-usd 0.001`)
3. **Linux/WSL parity**: nothing platform-blocking found, but stdin piping, exit codes, and auth-file location are ASSUMED on Linux. A-4 smoke must run once on the deploy host. (open)
4. **Headless auth provisioning** on a server: `claude setup-token` or `ANTHROPIC_API_KEY` in the daemon's env — needs a runbook entry (epic-A runbook, A-4-T2). (open)
5. **Concurrent runs in one cwd**: untested; `--no-session-persistence` avoids session-file contention, git-level conflicts remain the operator's problem until workspace leasing exists. (open)
6. **Cost floor per invocation** (~$0.02 minimum observed): a chain of many tiny steps is disproportionately expensive; consider session reuse (`--resume <session_id>` per SessionBlock `sessionKey`) as a later optimization — do NOT build into A-1. (open)
7. `--verbose`-with-stream-json requirement unverified in this version; keeping the flag is the safe default. (minor)

## 5. Recommendation for A-1

Adopt the spec in §3. Concretely for A-1-T1:

- Replace the echo runner's spawn path with: build argv from Execution Payload (never through a shell), write systemPrompt temp file, pipe instructions to stdin, keep the existing timeout/kill/stream plumbing.
- Keep `commandTemplate` for the generic path but **narrow its semantics**: template output is parsed into an argv array (no `sh -c`), and the prompt is always stdin — template tokens never carry prose. Registration of a template referencing unknown tokens fails loudly (A-1 AC 3).
- Fake CLI for TDD: a tiny bun script that asserts flags, echoes stdin length, and emits a canned `stream-json` result line — lets every AC run without spend.
- A-1-T2 payload additions needed: nothing structural — `systemPrompt`, `instructions`, `step.mode`, `agent.runtimeModel` are already in `daemon/steps/next`; add `payloadVersion` as planned.
