# Integrations: Triggers & Reactions

**Status**: Design — not yet implemented
**Author**: 2026-04-17 session
**Related**: ChainTemplate, Scheduler, submitReview, rewindChain, advanceChain, broadcastProjectEvent

## The feature in one sentence

**Triggers** bring external events IN (create tasks/chains automatically); **Reactions** send agent events OUT (post to Slack, create Jira ticket, etc.). Chains plug into the tools the team already uses, in both directions, without the human having to bounce between AgentBoard and N other windows.

## Bi-directional picture

```
┌────────────────┐                                           ┌────────────────┐
│ Sentry / Jira  │ ── Trigger (poll or webhook) ──►  ┌───────────────────┐  │
│ PagerDuty /    │                                   │                   │  │
│ GitHub / ...   │                                   │   AgentBoard      │  │
└────────────────┘                                   │   chain / agents  │  │
                                                     │   / human review  │  │
┌────────────────┐                                   │                   │  │
│ Slack / Teams  │ ◄── Reaction (event-driven) ── ── │                   │  │
│ Email / Jira / │                                   └───────────────────┘  │
│ GitHub PR /... │                                                          │
└────────────────┘                                                          │
                                                                            │
                                                            ┌───────────────┘
                                                            │
                                            ┌───────────────▼───────────────┐
                                            │  agent-native Reactions:      │
                                            │   • spawn another chain       │
                                            │   • save chain as a Skill     │
                                            │   • budget/cost alert         │
                                            └───────────────────────────────┘
```

Ingress and egress share nearly everything below: the same config / credential / env-var pattern, the same JSON-Schema-ish filtered UI, the same per-record health + failure counter, the same project-scoped CRUD + test endpoints.

---

# Part 1 — Triggers (external → chain)

## The worked Sentry example

### What you configure, once

```
Project:              "SaaS Web"
Chain template:       "Bug Triage"
  step 1 (agent)      analyze      — Analyst agent, mode: analyze
  step 2 (agent)      verify       — Dev agent,     mode: verify
  step 3 (human)      review       — 1 reviewer,    mode: human

Trigger:              "Sentry prod errors"
  type:               poll:sentry
  template:           → Bug Triage
  interval:           5 min
  config:
    org:              acme
    project:          saas-web
    environment:      production
    levels:           [error, fatal]
    query:            is:unresolved
    titleTemplate:    "Triage: {{title}}"
  credentials:        SENTRY_API_TOKEN (env var)
```

### What happens, automatically

```
┌──────────────┐                ┌──────────────┐                ┌──────────────┐
│   Scheduler  │                │   Trigger    │                │    Sentry    │
│ (every 5min) │                │  (poll type) │                │              │
└──────┬───────┘                └──────┬───────┘                └──────┬───────┘
       │ tick                          │                               │
       ├──────────────────────────────►│                               │
       │                               │ GET /issues?since=lastCursor  │
       │                               ├──────────────────────────────►│
       │                               │                               │
       │                               │ [{id:SENTRY-123, title:...},  │
       │                               │  {id:SENTRY-124, title:...}]  │
       │                               │◄──────────────────────────────┤
       │                               │                               │
       │                        ┌──────┴──────┐                        │
       │                        │ for each id:│                        │
       │                        │ is it new?  │                        │
       │                        │  (DB dedup) │                        │
       │                        └──────┬──────┘                        │
┌──────┴────────┐                      │                               │
│  new Task     │◄─────── instantiate from Bug Triage template         │
│  externalId:  │         fill title/description from event            │
│  SENTRY-123   │         set triggerId + externalId                   │
└──────┬────────┘                                                      │
       │ startChain(task)                                              │
       ▼                                                               │
  step 1 active  ──► Analyst agent runs                                │
       │                                                               │
       ▼                                                               │
  step 2 active  ──► Dev agent verifies analysis                       │
       │                                                               │
       ▼                                                               │
  step 3 active  ──► human review card on board                        │
                                                                       │
                     Approve ───► chain DONE ─────────► (Reaction fires)
                     Revise  ───► rewind to step 1                     │
                     Reject  ───► closeChain                           │
```

## Data model — `Trigger`

```prisma
model Trigger {
  id                  String         @id @default(cuid())
  projectId           String
  project             Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name                String
  type                String         // 'poll:sentry' | 'webhook:sentry' | 'poll:jira' | 'poll:http' | 'webhook:generic' | ...
  chainTemplateId     String
  chainTemplate       ChainTemplate  @relation(fields: [chainTemplateId], references: [id], onDelete: Restrict)
  config              String         // JSON, type-specific

  pollIntervalMs      Int?
  lastPolledAt        DateTime?
  lastCursor          String?
  webhookSecretHash   String?        // for webhook:* types

  enabled             Boolean        @default(true)
  leasedBy            String?
  leasedAt            DateTime?

  lastError           String?
  consecutiveFailures Int            @default(0)
  tasksCreatedCount   Int            @default(0)

  tasks               Task[]
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  @@index([projectId, enabled])
}

// Additions to existing Task
model Task {
  // ...existing fields
  externalId  String?
  triggerId   String?
  trigger     Trigger? @relation(fields: [triggerId], references: [id], onDelete: SetNull)

  @@unique([triggerId, externalId])  // dedup guarantee
}
```

## Flow — poll

1. Project scheduler ticks (already runs every `automationPollMs`).
2. Calls `pollTriggers(projectId)` alongside `pollAndDispatch(projectId)`.
3. For each enabled trigger due for poll (and not leased): lease → call handler → for each returned event, `db.task.create` with `triggerId + externalId`. Catch Prisma `P2002` unique-violation → skip. Successful creates → `startChain(task)`.
4. Update `lastPolledAt`, `lastCursor`, release lease. On handler error: `consecutiveFailures++`, disable at 5.

## Flow — webhook

1. Sentry POSTs to `/api/triggers/webhook/[id]` with signature header.
2. HMAC-verify via `timingSafeEqual` (same length-guard pattern as `poll-steps`).
3. Dedup on `(triggerId, externalId)`; create task; `startChain`.
4. 200 OK — Sentry stops retrying on 2xx.

## Supported trigger types

| Type | Status | Notes |
|---|---|---|
| `poll:sentry` | **MVP** | Bearer token, REST |
| `webhook:sentry` | P2 | HMAC-signed |
| `poll:jira` | P2 | Basic auth (email:token) or Bearer (OAuth); JQL-based since-cursor |
| `webhook:jira` | P2 | Shared-secret signed |
| `poll:github` | P3 | Issues / PRs / workflow runs |
| `webhook:github` | P3 | Signed HMAC |
| `poll:pagerduty` | P3 | Incidents + updates |
| `poll:salesforce` | P4 | Needs OAuth 2.0 refresh — triggers `Credential` model addition |
| `poll:http` / `webhook:generic` | P3 | JSONPath-based; escape hatch |

---

# Part 2 — Reactions (chain → external)

## The worked Slack example

### What you configure, once

```
Project:              "SaaS Web"

Reaction:             "Critical review-gate → Slack"
  event:              step:activated
  filter:
    step.mode:        human
    task.priority:    [HIGH, URGENT]
  action:             post:slack
  config:
    webhookUrlEnv:    SLACK_WEBHOOK_ENG_URGENT
    text:             "⚠️ Review needed: *{{task.title}}* ({{task.priority}})\n{{taskUrl}}"
  debounceMs:         30000

Reaction:             "Chain done → create Jira ticket"
  event:              chain:completed
  filter:
    task.tag:         "customer-reported"
  action:             create:jira
  config:
    apiTokenEnv:      JIRA_API_TOKEN
    emailEnv:         JIRA_EMAIL
    project:          SUPPORT
    issueType:        Task
    summary:          "Fix: {{task.title}}"
    description:      "Resolution:\n\n{{task.output}}\n\nTriage: {{taskUrl}}"
    priority:         "{{task.priority}}"
```

### What happens, automatically

```
┌────────────────┐        ┌──────────────────┐        ┌─────────────┐
│   dispatch.ts  │        │ broadcastProject │        │  Reaction   │
│ advanceChain() │        │      Event       │        │  Processor  │
└───────┬────────┘        └────────┬─────────┘        └──────┬──────┘
        │                          │                         │
        │ emit 'step-activated'    │                         │
        ├─────────────────────────►│                         │
        │                          │ subscribe + filter      │
        │                          ├────────────────────────►│
        │                          │                         │
        │                                       ┌────────────┴──────────────┐
        │                                       │ find enabled Reactions    │
        │                                       │ where event matches       │
        │                                       │ evaluate filters          │
        │                                       │ apply debounce check      │
        │                                       └────────────┬──────────────┘
        │                                                    │
        │                                       ┌────────────▼──────────────┐
        │                                       │ for each matching:        │
        │                                       │   render templates        │
        │                                       │   call action handler     │
        │                                       │     (post:slack,          │
        │                                       │      create:jira, ...)    │
        │                                       │   record result           │
        │                                       └───────────────────────────┘
```

## Data model — `Reaction`

```prisma
model Reaction {
  id             String    @id @default(cuid())
  projectId      String
  project        Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name           String

  event          String    // 'task:created' | 'task:status-changed' | 'step:activated' |
                           // 'step:completed' | 'step:reviewed' | 'chain:completed' |
                           // 'chain:rewound' | 'chain:closed' | 'agent:output-matches'
  filter         String    // JSON: { taskStatus, tag, stepMode, decision, outputRegex, ... }

  action         String    // 'post:slack' | 'post:teams' | 'send:email' | 'create:jira' |
                           // 'update:jira' | 'open:github-pr' | 'post:http' |
                           // 'spawn:chain' | 'save:skill' | 'page:pagerduty' | ...
  config         String    // JSON, action-specific

  enabled        Boolean   @default(true)
  debounceMs     Int?      // optional coalescing per (reactionId, entityId)
  lastFiredAt    DateTime?

  lastResult     String?   // 'ok' | 'error' | 'skipped-dedup' | 'skipped-debounce'
  lastError      String?
  consecutiveFailures Int  @default(0)
  firedCount     Int       @default(0)

  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([projectId, enabled])
  @@index([event, enabled])
}
```

## Event catalog (what Reactions can subscribe to)

All of these are **already broadcast** today via `broadcastProjectEvent` — the ReactionProcessor just subscribes to the same in-process bus.

| Event | Fired when | Payload |
|---|---|---|
| `task:created` | New task (manual or trigger) | `{ task }` |
| `task:status-changed` | Task moves between columns | `{ task, from, to }` |
| `task:updated` | Title/description/notes/output updated | `{ task }` |
| `task:deleted` | Task deleted | `{ taskId }` |
| `step:activated` | Step transitions pending → active | `{ taskId, stepId, task, step }` |
| `step:completed` | Step done or skipped | `{ taskId, stepId, task, step }` |
| `step:failed` | Step exceeded retries, no fallback | `{ taskId, stepId, error }` |
| `step:reviewed` | Human submitted a StepReview | `{ taskId, stepId, decision, note, reviewer }` |
| `chain:completed` | Full chain DONE | `{ task, outputs[] }` |
| `chain:rewound` | Step rejected, chain rewound | `{ taskId, fromStepId, toStepId, rejectionNote }` |
| `chain:closed` | Chain closed (rejected by human) | `{ taskId, note }` |
| `agent:output-matches` | Agent output regex match (Reaction-defined) | `{ taskId, stepId, match[] }` |

## Reactions worth building

**Notification / communication**

| Action | Why interesting |
|---|---|
| `post:slack` | Table stakes. Incoming webhook URL per channel; text supports Slack's blocks for rich cards. |
| `post:teams` | MS-shop parity. Teams webhook has a similar shape but stricter card format. |
| `post:discord` | For consumer / dev-community projects. Works identically to Slack webhooks. |
| `send:email` | Formal notifications, stakeholder summaries. Env-var SMTP creds or SES/Resend API key. |
| `page:pagerduty` | Critical escalation — "chain closed with `rejected-hard`" or SLA breach. Uses PagerDuty Events API v2. |

**Ticket / work-item sync**

| Action | Why interesting |
|---|---|
| `create:jira` | Convert an agent's resolution into a traceable ticket. Bi-directional pairing: if a Trigger pulled a Sentry issue → a Reaction creates the corresponding Jira for the fix. |
| `update:jira` | Add comments as chain progresses; transition status when agent completes; keep Jira + board in sync without a human copying. |
| `create:linear` | Same story, different shop. Linear's API is cleaner than Jira's. |
| `create:github-issue` | For OSS / engineering projects using GitHub Issues as tracker. |
| `open:github-pr` | **Unusually valuable for agent work.** If a dev-agent step has committed changes, automatically open a PR with the agent's output as the description and the human reviewer on it. The chain's review step becomes "review the PR", not "read the agent output in a box". |

**Agent-native (things that wouldn't exist in Zapier)**

| Action | Why interesting |
|---|---|
| `spawn:chain` | Chain completed → start a *different* chain, optionally in a different project. Compose large workflows from small ones. Example: "bug triage chain done → spawn 'write regression test' chain, feeding the triage output as context." |
| `save:skill` | Chain completed successfully → write the final output as a new `Skill` entry, tagged with the task's tags. Closes the learning loop — the playbook that solved the bug becomes searchable in the Skills library. |
| `cost:alert` | Daily cost for a project exceeds threshold → email or Slack, optionally disable project automation. Uses the existing `StepExecution.cost`/`tokensUsed` fields. |
| `safety:hold` | Agent output matches a regex (e.g., `/\bAKIA[0-9A-Z]{16}\b/` — AWS access key pattern) → pause the task, flag for review, alert the owner. A content-safety reaction. |
| `escalate:template` | Chain closed with consecutive failures on the same template → spawn a new task from a more expensive/thorough template with the original as context. Automatic escalation from "fast triage" to "deep investigation". |

**Generic / escape hatch**

| Action | Why interesting |
|---|---|
| `post:http` | Send a JSON payload to any URL. Covers anything we haven't built a specific handler for. Pair with headers/auth config. |
| `write:file` | Upload a step artifact (code, diff, JSON) to S3/GCS/R2 with optional pre-signed link back. Useful when chain output is too big for a Slack message. |

## Config examples

### `post:slack`
```json
{
  "webhookUrlEnvVar": "SLACK_WEBHOOK_ENG_URGENT",
  "channel": "#eng-urgent",
  "text": "⚠️ *{{task.title}}* needs review\nPriority: {{task.priority}}\n{{taskUrl}}"
}
```

### `create:jira`
```json
{
  "emailEnvVar": "JIRA_EMAIL",
  "apiTokenEnvVar": "JIRA_API_TOKEN",
  "host": "acme.atlassian.net",
  "project": "SUPPORT",
  "issueType": "Task",
  "summaryTemplate": "Fix: {{task.title}}",
  "descriptionTemplate": "Resolution:\n\n{{task.output}}\n\n—\nTriage link: {{taskUrl}}",
  "labels": ["triaged-by-agent", "priority-{{task.priority}}"]
}
```

### `spawn:chain`
```json
{
  "targetProjectId": "proj_xyz",
  "targetChainTemplateId": "tpl_abc",
  "titleTemplate": "Regression test: {{task.title}}",
  "descriptionTemplate": "Parent task output:\n\n{{task.output}}",
  "inheritTags": true,
  "inheritPriority": true,
  "linkBack": true
}
```

### `save:skill`
```json
{
  "workspaceId": "auto",
  "titleTemplate": "Playbook: {{task.title}}",
  "bodyTemplate": "## Summary\n\n{{task.description}}\n\n## Resolution\n\n{{task.output}}\n\n## Steps taken\n\n{{#steps}}{{order}}. [{{mode}}] {{output}}\n{{/steps}}",
  "tags": ["auto-generated", "from-chain"],
  "onlyIfAllStepsSucceeded": true
}
```

---

# Shared concepts

## Authentication & secrets

| Auth kind | Pattern |
|---|---|
| Static bearer token | `"apiTokenEnvVar": "SENTRY_API_TOKEN"` — server reads from allowlisted env var |
| Basic auth (Jira email+token) | Two env-var references |
| Webhook shared secret | `webhookSecretHash` on record; raw secret shown once on creation |
| OAuth 2.0 (Salesforce, GitHub Apps) | **Not MVP.** Needs `Credential` model with refresh-token lifecycle (Phase 4) |

Env-var allowlist lives server-side. UI shows a dropdown of allowed var names, never user-typed values.

## Template rendering (`{{var}}`)

Simple mustache-style. No logic except `{{#steps}}...{{/steps}}` array expansion. Variables resolved from event payload at fire time.

Available:
- `{{task.title}}`, `{{task.status}}`, `{{task.priority}}`, `{{task.output}}`, `{{task.tag}}`
- `{{step.mode}}`, `{{step.output}}`, `{{step.agent.name}}`
- `{{decision}}`, `{{note}}`, `{{reviewer}}` (on step:reviewed)
- `{{taskUrl}}` — convenience, resolves to board URL with task filter
- `{{event.firstSeen}}`, `{{event.level}}` — trigger-event-specific fields
- `{{task.externalId}}`, `{{task.trigger.name}}` — link back to source

Missing keys render empty string. UI validator warns on unknown variables for the current event.

## Durability

V1: **fire-and-forget** via in-process bus. ReactionProcessor subscribes to `broadcastProjectEvent`. If Slack is down, log, increment `consecutiveFailures`, disable at 5.

P3: persistent `ReactionQueue` + worker with exponential backoff. Needed once teams depend on reactions for compliance/audit.

## Debounce

Reactions set `debounceMs`. Within the window, repeat fires for the same `(reactionId, entityId)` are suppressed (`lastResult = 'skipped-debounce'`). Latest-wins coalescing — appropriate for chat, not for semantic actions (`create:jira` wouldn't debounce).

## API surface

```
# Triggers (admin-session)
GET/POST    /api/projects/[id]/triggers
PUT/DELETE  /api/projects/[id]/triggers/[tid]
POST        /api/projects/[id]/triggers/[tid]/test        — dry-run poll
POST        /api/projects/[id]/triggers/[tid]/run-once    — force immediate poll

# Reactions (admin-session)
GET/POST    /api/projects/[id]/reactions
PUT/DELETE  /api/projects/[id]/reactions/[rid]
POST        /api/projects/[id]/reactions/[rid]/test       — fire once with synthetic event
POST        /api/projects/[id]/reactions/[rid]/replay     — re-fire against last N matching events

# Webhook ingress (HMAC-authed)
POST        /api/triggers/webhook/[id]
```

All admin routes use `withErrorHandling`. Webhooks use `timingSafeEqual` with length guard.

## UI — Integrations section in project settings

```
Project > Settings > Integrations
┌─────────────────────────────────────────────────────────────────────┐
│ ▼ Triggers (2)                                 [+ New trigger]      │
│   🟢 Sentry prod errors       poll:sentry    42 tasks  ...          │
│   🟡 GitHub webhook           webhook:sentry 3 failures ...         │
│                                                                     │
│ ▼ Reactions (4)                                [+ New reaction]     │
│   🟢 Critical review → Slack  post:slack     14 fires  ...          │
│   🟢 Chain done → Jira         create:jira    22 fires  ...          │
│   🟢 Security match → hold     safety:hold    0 fires   ...          │
│   🔴 Daily cost alert          cost:alert     last: error (SMTP 5xx) │
└─────────────────────────────────────────────────────────────────────┘
```

Both sections share: create dialog pattern, "test" button, enable/disable toggle, error surfacing, "view recent fires" drawer.

---

# Rollout phases (combined)

| Phase | Scope | Effort |
|---|---|---|
| **MVP** | `Trigger` + Sentry poll handler + CRUD + UI + test endpoint. `Reaction` + `post:slack` + `post:http` + `create:jira` + `send:email` + CRUD + UI + test endpoint. | ~4 days |
| **P2** | Sentry & Jira webhook receivers. `post:teams`, `open:github-pr`, `page:pagerduty`. | ~2 days |
| **P3** | Agent-native reactions: `spawn:chain`, `save:skill`, `cost:alert`, `safety:hold`. Persistent `ReactionQueue` for retry/backoff. | ~3 days |
| **P4** | `Credential` model + OAuth 2.0 refresh → Salesforce REST polling, GitHub Apps. | ~3 days |
| **P5** | `poll:http` / `webhook:generic` with JSONPath mappers — escape hatch. | ~2 days |

---

# Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scope creep into Zapier territory | Curate action/trigger list to agent-adjacent only. No visual flow editor. |
| Notification spam on rapid state changes | `debounceMs` + latest-wins per (reaction, entity). |
| Fire-and-forget loses events if Slack is down | `consecutiveFailures` + disable at 5 in V1. Durable queue in P3. |
| External rate limits (Slack webhooks, Sentry API, Jira) | Per-type minimum intervals; coalesce shared-credential triggers. |
| Credential sprawl | Env-var allowlist for V1; `Credential` table in P4 for shared auth. |
| Reactions firing on their own events (infinite loop) | `spawn:chain` tags the child's `task:created` with `parentReactionId` so the same reaction can't fire recursively. |
| Secret leak via API | Config returns env-var *names* not values. Webhook secrets shown once, hashed after. |
| Duplicate Jira tickets from chatty events | Reaction template can set a dedup key; if match exists, update instead of create. |
| Cascade-delete: ChainTemplate referenced by a Trigger | `onDelete: Restrict` + UI block on template delete. |

---

# Not in this design

- **Inline action-steps** (a `TaskStep` with `mode: 'notify'` that blocks the chain). Complementary feature; revisit if Reactions don't cover a real use case.
- **Generic visual flow editor.** We're not becoming Zapier.
- **Cross-workspace reactions** (fire in project A → affect project B outside the workspace). Same-workspace `spawn:chain` with `targetProjectId` is in scope; cross-workspace isn't.
- **Streaming-API subscribers** (Salesforce Platform Events, Slack Socket Mode). Different runtime shape; punt.
- **Template versioning / rollback** on config. YAGNI for V1.

---

# Open questions

1. **Template style**: `{{mustache}}` vs JSONPath vs both. Proposed mustache for simplicity. Switch if you want richer logic.

2. **Reaction concurrency**: if `chain:completed` fires and triggers both `create:jira` and `save:skill`, parallel or sequential? Parallel is simpler; sequential lets one reaction's output feed another (e.g., Slack message with the newly-created Jira URL). Lean parallel for V1.

3. **`spawn:chain` feedback**: when a spawned chain completes, does the parent get notified? Could fire `chain:completed-via-spawn`. Useful for dashboards, adds complexity. Defer?

4. **Reaction scope**: all project-scoped in this design. Workspace-wide ("any chain in this workspace completes → save skill") valuable but changes the FK shape. Decide before MVP.

5. **Filter expressiveness**: simple key-equality + one regex field is proposed. If we need AND/OR/nested/numeric comparisons, we'd need a tiny DSL. JSON Logic? Safe JS subset? Punt to P3?

6. **Durability baseline**: fire-and-forget V1 with queue in P3, or durable from day one? The queue is a day of extra work. Fire-and-forget is faster to ship but we'll need the queue eventually. Lean fire-and-forget + measure.

7. **Credential model timing**: OAuth unlocks Salesforce + GitHub Apps. Push from P4 to P2 so Jira can use OAuth from day one? Depends on how many OAuth-only services are on the near-term list.

8. **Sequential chaining of reactions**: related to #2 — if users want "Slack with Jira URL", we'd need either explicit chaining (`dependsOn: [otherReactionId]`) or sequential execution of reactions sharing the same trigger event. Lean explicit `dependsOn` if we add it at all; otherwise keep reactions independent.
