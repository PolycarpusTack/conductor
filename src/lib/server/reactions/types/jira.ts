export async function executeJiraReaction(
  config: Record<string, unknown>,
): Promise<{ issueKey: string; issueId: string; issueUrl: string }> {
  const domain    = process.env[config.domainEnvVar as string]
  const email     = process.env[config.emailEnvVar as string]
  const apiToken  = process.env[config.apiTokenEnvVar as string]

  if (!domain)   throw new Error(`Env var "${config.domainEnvVar}" is not set`)
  if (!email)    throw new Error(`Env var "${config.emailEnvVar}" is not set`)
  if (!apiToken) throw new Error(`Env var "${config.apiTokenEnvVar}" is not set`)

  const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64')

  const res = await fetch(`${domain}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      fields: {
        project:   { key: config.projectKey as string },
        summary:   config.summary as string,
        issuetype: { name: (config.issueType as string) || 'Task' },
        ...(config.description
          ? {
              description: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: config.description as string }],
                  },
                ],
              },
            }
          : {}),
      },
    }),
  })

  if (!res.ok) {
    const body = (await res.text()).slice(0, 500)
    throw new Error(`Jira API failed: ${res.status} — ${body}`)
  }

  const issue = (await res.json()) as { key: string; id: string; self: string }
  return { issueKey: issue.key, issueId: issue.id, issueUrl: issue.self }
}
