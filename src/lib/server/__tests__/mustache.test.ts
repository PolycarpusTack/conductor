import { describe, test, expect } from 'bun:test'
import { renderMustache, renderConfigMustache } from '../reactions/mustache'

describe('renderMustache', () => {
  test('renders flat variables', () => {
    expect(renderMustache('Hello {{name}}!', { name: 'World' })).toBe('Hello World!')
  })

  test('renders nested paths', () => {
    expect(renderMustache('Task: {{event.taskId}}', { event: { taskId: 'abc-123' } })).toBe('Task: abc-123')
  })

  test('renders reaction output', () => {
    const ctx = { reactions: { create_jira: { issueKey: 'PROJ-42' } } }
    expect(renderMustache('Ticket: {{reactions.create_jira.issueKey}}', ctx)).toBe('Ticket: PROJ-42')
  })
})

describe('renderConfigMustache', () => {
  test('renders all string values in config', () => {
    const config = { text: 'Chain {{event.taskId}} done', url: 'https://example.com', retries: 3 }
    const result = renderConfigMustache(config, { event: { taskId: 'xyz' } })
    expect(result.text).toBe('Chain xyz done')
    expect(result.url).toBe('https://example.com')
    expect(result.retries).toBe(3)
  })

  test('recurses into nested objects', () => {
    const config = { body: { message: 'Hi {{name}}' } }
    const result = renderConfigMustache(config, { name: 'Alice' })
    expect((result.body as Record<string, unknown>).message).toBe('Hi Alice')
  })
})
