import { createSmtpTransport } from '@/lib/server/email-transport'

export async function executeEmailReaction(config: Record<string, unknown>): Promise<{ sent: true }> {
  const host = process.env[config.smtpHostEnvVar as string]
  if (!host) throw new Error(`Env var "${config.smtpHostEnvVar}" is not set`)

  const port = Number(process.env[config.smtpPortEnvVar as string] ?? '587')
  const user = process.env[config.smtpUserEnvVar as string]
  const pass = process.env[config.smtpPassEnvVar as string]

  const transporter = createSmtpTransport({ host, port, user, pass })

  await transporter.sendMail({
    from:    config.from as string,
    to:      config.to as string,
    subject: config.subject as string,
    text:    config.text as string,
    ...(config.html ? { html: config.html as string } : {}),
  })

  return { sent: true }
}
