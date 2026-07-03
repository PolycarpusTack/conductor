import { z } from 'zod'

/**
 * Startup environment validation.
 *
 * Imported once from `src/instrumentation.ts` so a misconfigured deployment
 * fails fast at boot with a clear message instead of a confusing runtime
 * error on the first request.
 *
 * Required vs optional mirrors how the codebase actually behaves:
 * - DATABASE_URL is optional — `src/lib/db.ts` falls back to file:./prisma/dev.db
 * - AGENTBOARD_ADMIN_PASSWORD is required in production (admin auth is the
 *   only way into the dashboard); in development it may be unset, which the
 *   UI surfaces as "not configured"
 * - AGENTBOARD_ADMIN_SESSION_SECRET falls back to the admin password when
 *   unset (see admin-session.ts), but when present it must not be trivially short
 * - AGENTBOARD_WS_SECRET / AGENTBOARD_WS_INTERNAL_SECRET are required in
 *   production: realtime.ts silently no-ops token minting and broadcasts
 *   when they're unset, so the board just stops updating with no error.
 *   In development they stay optional (realtime is an opt-in feature there).
 */
const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().min(1).optional(),
    AGENTBOARD_ADMIN_PASSWORD: z.string().min(8, 'AGENTBOARD_ADMIN_PASSWORD must be at least 8 characters').optional(),
    AGENTBOARD_ADMIN_SESSION_SECRET: z.string().min(16, 'AGENTBOARD_ADMIN_SESSION_SECRET must be at least 16 characters').optional(),
    AGENTBOARD_WS_SECRET: z.string().min(16, 'AGENTBOARD_WS_SECRET must be at least 16 characters').optional(),
    AGENTBOARD_WS_INTERNAL_SECRET: z.string().min(16, 'AGENTBOARD_WS_INTERNAL_SECRET must be at least 16 characters').optional(),
    PROMPT_LIBRARY_PATH: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.AGENTBOARD_ADMIN_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['AGENTBOARD_ADMIN_PASSWORD'],
        message: 'AGENTBOARD_ADMIN_PASSWORD is required in production',
      })
    }
    // Without AGENTBOARD_WS_SECRET, realtime.ts cannot mint or verify client
    // tokens; without AGENTBOARD_WS_INTERNAL_SECRET, broadcastProjectEvent
    // silently returns and the board never receives live updates. Fail fast
    // at boot instead of shipping a silently-frozen board.
    if (env.NODE_ENV === 'production' && !env.AGENTBOARD_WS_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AGENTBOARD_WS_SECRET'],
        message: 'AGENTBOARD_WS_SECRET is required in production',
      })
    }
    if (env.NODE_ENV === 'production' && !env.AGENTBOARD_WS_INTERNAL_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['AGENTBOARD_WS_INTERNAL_SECRET'],
        message: 'AGENTBOARD_WS_INTERNAL_SECRET is required in production',
      })
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

/** Parses `process.env` against the schema; throws with a readable summary on failure. */
export function validateEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse({
    NODE_ENV: source.NODE_ENV,
    DATABASE_URL: source.DATABASE_URL,
    AGENTBOARD_ADMIN_PASSWORD: source.AGENTBOARD_ADMIN_PASSWORD ?? source.ADMIN_PASSWORD,
    AGENTBOARD_ADMIN_SESSION_SECRET: source.AGENTBOARD_ADMIN_SESSION_SECRET,
    AGENTBOARD_WS_SECRET: source.AGENTBOARD_WS_SECRET,
    AGENTBOARD_WS_INTERNAL_SECRET: source.AGENTBOARD_WS_INTERNAL_SECRET,
    PROMPT_LIBRARY_PATH: source.PROMPT_LIBRARY_PATH,
    OPENAI_API_KEY: source.OPENAI_API_KEY,
  })

  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
  }

  return result.data
}

// Validates at import time — instrumentation.ts imports this module at startup.
export const env = validateEnv()
