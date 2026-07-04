# Runbook — Realtime / board not updating

**Symptoms.** Steps *do* complete (you see `succeeded` events, `/api/health` ok,
DB advances) but the board doesn't move until you refresh. Cursors/presence
missing. This is the **realtime** path, not dispatch — work is fine, the live
push isn't arriving.

Relevant SLO: SLO-4 (board-ws availability / broadcast attempts). See
[../slos.md](../slos.md).

## Key fact: silent degrade is by design

When `AGENTBOARD_WS_INTERNAL_SECRET` is **unset**, `broadcastProjectEvent`
(`realtime.ts`) **returns immediately and does nothing** — no error, no log. The
board falls back to polling. So "board not updating live" with everything else
healthy is almost always **realtime not configured**, not a crash. In **prod**
this is a hard env-validation failure (B-5), so silent-degrade should only
happen in dev / misconfigured deploys.

## Checks

```bash
bun run doctor        # realtime-secrets + realtime-service rows
curl -s ${AGENTBOARD_WS_URL:-http://127.0.0.1:3003}/healthz | jq
# → 200 {"status":"ok","connections":N}. N = live Socket.IO clients.
```

1. **Secrets set?** `doctor` `realtime-secrets`:
   - `AGENTBOARD_WS_SECRET` — mints/verifies client realtime tokens
     (`createRealtimeToken`/`verifyRealtimeToken`). Unset ⇒ tokens can't be
     minted ⇒ clients can't authenticate the socket.
   - `AGENTBOARD_WS_INTERNAL_SECRET` — Bearer for app→board-ws POST `/broadcast`.
     Unset ⇒ broadcasts silently no-op (see above).
   Both must be set (and **match** between the app and the board-ws process).

2. **Is board-ws up and reachable?** `doctor` `realtime-service` hits `/healthz`.
   - Unreachable → board-ws isn't running or `AGENTBOARD_WS_URL` is wrong. Start
     it (`bun mini-services/board-ws/index.ts`, honors `PORT`, default 3003) and
     confirm the app's `AGENTBOARD_WS_URL` points at it.
   - Reachable but `connections: 0` while users have the board open → clients
     aren't completing the socket handshake: token minting/verification
     mismatch (secret drift between app and board-ws), or a **CORS/origin**
     rejection. board-ws only allows origins in `AGENTBOARD_WS_ALLOWED_ORIGINS`
     (default `localhost:3000,127.0.0.1:3000`) — add your real origin.

3. **Broadcast failures?** Grep app logs for `broadcast failed` (`[realtime]`
   tag) with an HTTP status:
   - `401` → internal secret mismatch between app and board-ws.
   - connection refused → board-ws down (step 2).

4. **Token expiry.** Realtime tokens are short-lived (default 10 min TTL). A tab
   left open past expiry silently stops receiving until it reconnects — a
   refresh re-mints. Persistent per-user failure right after minting points at
   `AGENTBOARD_WS_SECRET` drift.

## Resolution

- Set **both** secrets identically on the app and board-ws; restart both.
- Start board-ws; point `AGENTBOARD_WS_URL` at it; add the real origin to
  `AGENTBOARD_WS_ALLOWED_ORIGINS`.
- Confirm: `curl …/healthz` shows `connections > 0` with the board open, and
  step completions now move the board live.

## Escalation

If secrets match, `/healthz` shows connections, and broadcasts log no failures
but the board still doesn't move, the issue is client-side event reconciliation
(WS event → context update). Capture the browser console + the `[realtime]`
server logs and escalate to the frontend/realtime owner. Note: the board keeps
working on polling meanwhile — this is degraded, not down.
