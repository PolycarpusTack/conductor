import nodemailer from 'nodemailer'

// Shared SMTP transport creation (C-4): the single place nodemailer transports
// are built. Used by the send:email reaction (reactions/types/email.ts, which
// resolves env-var NAMES from reaction config) and by the notification email
// path (notifications.ts, which reads the conventional SMTP_* vars directly).

export interface SmtpTransportConfig {
  host: string
  port?: number
  user?: string | null
  pass?: string | null
}

/** Minimal structural surface notifications need — lets tests substitute a fake. */
export interface MailTransport {
  sendMail(options: {
    from: string
    to: string
    subject: string
    text: string
    html?: string
  }): Promise<unknown>
}

export function createSmtpTransport({ host, port = 587, user, pass }: SmtpTransportConfig): MailTransport {
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  })
}
