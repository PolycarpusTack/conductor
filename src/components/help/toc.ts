/**
 * E-1: Help & User Guide — table of contents data.
 *
 * Shared between the server-rendered guide content (help-content.tsx) and
 * the client TOC/nav island (help-toc-nav.tsx). Pure data, no directives.
 */

type TocItem = { id: string; title: string }
type TocGroup = { label: string; items: TocItem[] }

export const TOC: TocGroup[] = [
  {
    label: 'Release notes',
    items: [
      { id: 'help-release-0-4-0', title: "What's new in 0.4.0" },
      { id: 'help-release-0-3-0', title: "What's new in 0.3.0" },
      { id: 'help-release-0-2-0', title: "What's new in 0.2.0" },
      { id: 'help-release-0-1-0', title: "What's new in 0.1.0" },
      { id: 'help-release-0-6', title: "What's new in 0.6" },
      { id: 'help-release-0-5', title: "What's new in 0.5" },
      { id: 'help-release-0-4', title: "What's new in 0.4" },
      { id: 'help-release-0-3', title: "What's new in 0.3" },
      { id: 'help-release-0-2', title: "What's new in 0.2" },
      { id: 'help-release-0-1', title: "What's new in 0.1" },
    ],
  },
  {
    label: 'Getting Started',
    items: [
      { id: 'help-overview', title: 'What is Conductor?' },
      { id: 'help-audience', title: 'Who is this for?' },
      { id: 'help-concepts', title: 'Core concepts' },
      { id: 'help-quickstart', title: '10-minute quick start' },
      { id: 'help-first-project', title: 'Your first project, step by step' },
      { id: 'help-anatomy', title: 'Anatomy of the app' },
    ],
  },
  {
    label: 'The Board',
    items: [
      { id: 'help-board', title: 'The Kanban board' },
      { id: 'help-tasks', title: 'Creating and editing tasks' },
      { id: 'help-task-states', title: 'Task state machine' },
      { id: 'help-task-drawer', title: 'Task detail drawer' },
      { id: 'help-review-gates', title: 'Human review gates' },
    ],
  },
  {
    label: 'Agents',
    items: [
      { id: 'help-agents', title: 'What is an agent?' },
      { id: 'help-agent-create', title: 'Creating an agent' },
      { id: 'help-agent-roles', title: 'Agent roles' },
      { id: 'help-agent-invocation', title: 'HTTP vs. Daemon' },
      { id: 'help-agent-keys', title: 'Agent API keys' },
      { id: 'help-agent-status', title: 'Active, idle, and muted' },
    ],
  },
  {
    label: 'Modes',
    items: [
      { id: 'help-modes', title: 'What are modes?' },
      { id: 'help-modes-builtin', title: 'Built-in modes' },
      { id: 'help-modes-custom', title: 'Custom modes' },
      { id: 'help-modes-permissions', title: 'Scoped tool permissions' },
    ],
  },
  {
    label: 'Chains & Workflows',
    items: [
      { id: 'help-chains', title: 'What is a chain?' },
      { id: 'help-chain-templates', title: 'Chain templates' },
      { id: 'help-chain-builder', title: 'Using the chain builder' },
      { id: 'help-workflow-editor', title: 'Workflow editor' },
      { id: 'help-handoffs', title: 'Automatic handoffs' },
    ],
  },
  {
    label: 'Skills Library',
    items: [
      { id: 'help-skills', title: 'Skills overview' },
      { id: 'help-skills-search', title: 'Semantic search' },
      { id: 'help-skills-create', title: 'Creating skills' },
    ],
  },
  {
    label: 'MCP Connections',
    items: [
      { id: 'help-mcp', title: 'What is MCP?' },
      { id: 'help-mcp-connect', title: 'Connecting a server' },
      { id: 'help-mcp-tools', title: 'Tool execution loop' },
    ],
  },
  {
    label: 'Runtimes',
    items: [
      { id: 'help-runtimes', title: 'What is a runtime?' },
      { id: 'help-runtimes-add', title: 'Adding a runtime' },
    ],
  },
  {
    label: 'Templates',
    items: [
      { id: 'help-templates', title: 'Task templates' },
      { id: 'help-chain-templates-ref', title: 'Chain templates reference' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { id: 'help-automation', title: 'Automation overview' },
      { id: 'help-automation-dispatch', title: 'Auto-dispatch rules' },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'help-integrations', title: 'Triggers & Reactions overview' },
      { id: 'help-integrations-triggers', title: 'Triggers' },
      { id: 'help-integrations-reactions', title: 'Reactions' },
      { id: 'help-integrations-templates', title: 'Mustache templates' },
      { id: 'help-integrations-failures', title: 'Failure handling' },
    ],
  },
  {
    label: 'Observability',
    items: [
      { id: 'help-obs-runtime', title: 'Runtime dashboard' },
      { id: 'help-obs-agent', title: 'Agent activity dashboard' },
      { id: 'help-obs-overview', title: 'Observability dashboard' },
      { id: 'help-obs-daemon-log', title: 'Daemon log viewer' },
      { id: 'help-obs-step-output', title: 'Step output viewer' },
      { id: 'help-obs-attempts', title: 'Attempt comparison' },
      { id: 'help-obs-artifacts', title: 'Artifacts' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { id: 'help-settings-general', title: 'General' },
      { id: 'help-settings-agents', title: 'Agents' },
      { id: 'help-settings-api', title: 'API keys' },
      { id: 'help-settings-activity', title: 'Activity log' },
      { id: 'help-settings-modes', title: 'Modes' },
      { id: 'help-settings-runtimes', title: 'Runtimes' },
      { id: 'help-settings-mcp', title: 'MCP' },
      { id: 'help-settings-templates', title: 'Templates' },
      { id: 'help-settings-analytics', title: 'Analytics' },
      { id: 'help-settings-automation', title: 'Automation' },
      { id: 'help-settings-integrations', title: 'Integrations' },
    ],
  },
  {
    label: 'Daemon mode',
    items: [
      { id: 'help-daemon', title: 'Daemon mode overview' },
      { id: 'help-daemon-setup', title: 'Setting up the daemon' },
      { id: 'help-daemon-heartbeat', title: 'Heartbeat & registration' },
      { id: 'help-daemon-steps', title: 'Claiming steps' },
    ],
  },
  {
    label: 'APIs (advanced)',
    items: [
      { id: 'help-api-cli', title: 'CLI-style API' },
      { id: 'help-api-http', title: 'HTTP agent API' },
      { id: 'help-api-auth', title: 'Authentication' },
    ],
  },
  {
    label: 'Security',
    items: [
      { id: 'help-security', title: 'Admin login & session' },
      { id: 'help-security-keys', title: 'Key storage' },
      { id: 'help-security-rotation', title: 'Key rotation' },
    ],
  },
  {
    label: 'Troubleshooting',
    items: [
      { id: 'help-trouble-ws', title: 'WebSocket shows Offline' },
      { id: 'help-trouble-stuck', title: 'A task is stuck' },
      { id: 'help-trouble-agent', title: "An agent won't claim" },
      { id: 'help-trouble-daemon', title: 'Daemon keeps disconnecting' },
      { id: 'help-trouble-clear', title: 'Clearing data & reset' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { id: 'help-faq', title: 'FAQ' },
      { id: 'help-glossary', title: 'Glossary' },
      { id: 'help-shortcuts', title: 'Keyboard shortcuts' },
      { id: 'help-storage', title: 'Where data is stored' },
    ],
  },
]

export type { TocItem, TocGroup }
