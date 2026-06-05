export async function register() {
  // Only run on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail fast on misconfigured env vars (throws at import time).
    // Skipped in tests where env vars may legitimately be unset.
    if (process.env.NODE_ENV !== 'test') {
      await import('@/lib/env')
    }

    // Route + fetch tracing. OTEL_EXPORTER_OTLP_ENDPOINT controls where
    // traces go; unset = spans are created but not exported (safe default).
    const { registerOTel } = await import('@vercel/otel')
    registerOTel({ serviceName: 'conductor-web' })

    const { initializeScheduler } = await import('@/lib/server/scheduler')
    await initializeScheduler()

    const { pollSentryTriggers } = await import('@/lib/server/triggers/sentry-poll')
    const SENTRY_POLL_INTERVAL_MS = 60_000
    setInterval(() => { pollSentryTriggers().catch(() => {}) }, SENTRY_POLL_INTERVAL_MS)
  }
}
