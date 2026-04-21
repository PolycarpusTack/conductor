export async function register() {
  // Only run on the server, not during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeScheduler } = await import('@/lib/server/scheduler')
    await initializeScheduler()

    const { pollSentryTriggers } = await import('@/lib/server/triggers/sentry-poll')
    const SENTRY_POLL_INTERVAL_MS = 60_000
    setInterval(() => { pollSentryTriggers().catch(() => {}) }, SENTRY_POLL_INTERVAL_MS)
  }
}
