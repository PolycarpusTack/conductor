// Self-service password reset + email invites (D-5).
//
// A reset token is a high-entropy `cr_…` string handed out ONCE (the caller
// emails it); only its SHA-256 hash is persisted — exactly like UserSession —
// so a DB leak never yields a live reset link. Tokens are single-use and
// expiring: consume validates unexpired + unused, sets the new password via
// the same scrypt hash used everywhere, marks the token used, and revokes the
// user's existing sessions ("everyone signs out when the password changes").
//
// Email delivery is env-gated on SMTP (SMTP_HOST). Unconfigured instances skip
// silently so the admin-users route falls back to its shown-temp-password flow.

import { createHash, randomBytes } from 'crypto'

import { db } from '@/lib/db'
import { scryptHash } from '@/lib/server/admin-config'
import { createSmtpTransport } from '@/lib/server/email-transport'
import { getLogger } from '@/lib/server/logger'
import { revokeUserSessions } from '@/lib/server/user-auth'

const log = getLogger('password-reset')

export const RESET_TOKEN_PREFIX = 'cr_'

const DEFAULT_RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Resolved TTL: env override (validated in env.ts) or the 1-hour default. */
function getResetTokenTtlMs(): number {
  const raw = Number(process.env.AGENTBOARD_RESET_TOKEN_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RESET_TOKEN_TTL_MS
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Typed, non-secret failure reasons — routes map these to a generic 400. */
export type ResetTokenErrorCode = 'invalid_token' | 'expired' | 'used'

export class ResetTokenError extends Error {
  constructor(public readonly code: ResetTokenErrorCode) {
    super(code)
    this.name = 'ResetTokenError'
  }
}

/**
 * Issues a reset token for a user. Stores only the hash + expiry and returns
 * the RAW token exactly once — the caller is responsible for emailing it.
 */
export async function issueResetToken(userId: string): Promise<string> {
  const token = `${RESET_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`
  await db.passwordResetToken.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + getResetTokenTtlMs()),
    },
  })
  return token
}

/**
 * Consumes a reset token: validates it is well-formed, unexpired and unused,
 * sets the new password, marks the token used, and revokes the user's live
 * sessions. Never throws a raw error — only `ResetTokenError` for the caller
 * to translate. Garbage / wrong-prefix tokens are rejected without a DB hit
 * (same short-circuit as resolveUserSession).
 */
export async function consumeResetToken(
  rawToken: string,
  newPassword: string,
): Promise<{ userId: string }> {
  if (!rawToken.startsWith(RESET_TOKEN_PREFIX)) {
    throw new ResetTokenError('invalid_token')
  }

  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  })
  if (!row) throw new ResetTokenError('invalid_token')
  if (row.usedAt) throw new ResetTokenError('used')
  if (row.expiresAt < new Date()) throw new ResetTokenError('expired')

  await db.user.update({
    where: { id: row.userId },
    data: { passwordHash: scryptHash(newPassword) },
  })
  await db.passwordResetToken.update({
    where: { id: row.id },
    data: { usedAt: new Date() },
  })
  // Changing the password revokes every live session for that user.
  await revokeUserSessions(row.userId)

  return { userId: row.userId }
}

// ---------------------------------------------------------------------------
// Email delivery. Env-gated on SMTP_HOST (same conventions as notifications.ts:
// SMTP_PORT/SMTP_USER/SMTP_PASS optional, NOTIFY_EMAIL_FROM/SMTP_USER for the
// from address). Unlike notifications the recipient is the user, not a fixed
// NOTIFY_EMAIL_TO. The transport factory is resolved through a mutable seam so
// tests can observe sends without the network.
// ---------------------------------------------------------------------------

export const resetEmailDeps = { createSmtpTransport }

export function setResetEmailDeps(overrides: Partial<typeof resetEmailDeps>): void {
  Object.assign(resetEmailDeps, overrides)
}

export function resetResetEmailDeps(): void {
  resetEmailDeps.createSmtpTransport = createSmtpTransport
}

/** True when the instance has an SMTP host configured for outbound mail. */
export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST)
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST
  if (!host) return null
  const user = process.env.SMTP_USER
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? '587'),
    user,
    pass: process.env.SMTP_PASS,
    from: process.env.NOTIFY_EMAIL_FROM || user || 'agentboard@localhost',
  }
}

/**
 * Emails a tokenized set-password link. `invite` tailors the copy for a brand
 * new account vs a password reset. Never throws — a mail failure must not fail
 * the admin action or leak whether an address exists; failures are logged.
 */
export async function sendSetPasswordEmail(opts: {
  to: string
  name?: string | null
  link: string
  invite: boolean
}): Promise<void> {
  const config = getSmtpConfig()
  if (!config) return // not configured — caller falls back to temp password

  const greeting = opts.name ? `Hi ${opts.name},` : 'Hi,'
  const subject = opts.invite
    ? '[AgentBoard] You have been invited — set your password'
    : '[AgentBoard] Reset your password'
  const intro = opts.invite
    ? 'An account has been created for you on AgentBoard. Set your password to get started:'
    : 'We received a request to reset your AgentBoard password. Set a new one here:'
  const text = `${greeting}\n\n${intro}\n\n${opts.link}\n\nThis link expires soon and can be used once. If you didn't expect this, you can ignore this email.`

  try {
    const transport = resetEmailDeps.createSmtpTransport({
      host: config.host,
      port: config.port,
      user: config.user,
      pass: config.pass,
    })
    await transport.sendMail({ from: config.from, to: opts.to, subject, text })
  } catch (err) {
    log.warn(`set-password email failed: ${String(err)}`)
  }
}

/**
 * Builds the absolute set-password link. Prefers AGENTBOARD_PUBLIC_URL (correct
 * behind a proxy); otherwise derives the origin from the request.
 */
export function buildSetPasswordLink(request: Request, token: string): string {
  const configured = process.env.AGENTBOARD_PUBLIC_URL
  let base = configured?.replace(/\/$/, '')
  if (!base) {
    const forwardedProto = request.headers.get('x-forwarded-proto')
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
    if (host) {
      const proto = forwardedProto || (host.startsWith('localhost') ? 'http' : 'https')
      base = `${proto}://${host}`
    } else {
      base = new URL(request.url).origin
    }
  }
  return `${base}/set-password?token=${encodeURIComponent(token)}`
}
