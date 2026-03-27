import { db } from '@/lib/db'

const DEFAULT_CHAIN_TEMPLATES = [
  // --- Original templates ---
  {
    name: 'Bug Fix',
    description: 'Analyze → fix → QA → approve',
    icon: '🐛',
    steps: [
      { agentRole: 'developer', mode: 'analyze', autoContinue: true },
      { agentRole: 'developer', mode: 'develop', autoContinue: true },
      { agentRole: 'qa', mode: 'verify', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Code Review',
    description: 'Review → approve',
    icon: '👁️',
    steps: [
      { agentRole: 'reviewer', mode: 'review', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Documentation',
    description: 'Draft → review → approve',
    icon: '📝',
    steps: [
      { agentRole: 'writer', mode: 'draft', autoContinue: true },
      { agentRole: 'reviewer', mode: 'review', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Support Investigation',
    description: 'Analyze → verify → human review → fix → approve',
    icon: '🎧',
    steps: [
      { agentRole: 'support', mode: 'analyze', autoContinue: true },
      { agentRole: 'developer', mode: 'verify', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
      { agentRole: 'developer', mode: 'develop', autoContinue: true },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  // --- New templates ---
  {
    name: 'Security Audit',
    description: 'Scout analyzes → Sentinel scans → Inspector reviews → human decides',
    icon: '🛡️',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Map the codebase structure, dependencies, and data flows. Identify areas with security-relevant logic (auth, input handling, data access, external calls).' },
      { agentRole: 'security', mode: 'analyze', autoContinue: true, instructions: 'Perform a security analysis using the previous step\'s codebase map. Check OWASP Top 10, CWE Top 25, dependency CVEs, secrets in code, and access control gaps. Rate each finding by severity.' },
      { agentRole: 'reviewer', mode: 'review', autoContinue: true, instructions: 'Review the security findings for accuracy and completeness. Cross-reference against the code. Flag any false positives or missed areas.' },
      { humanLabel: 'Security Lead', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Architecture Review',
    description: 'Scout maps codebase → Architect evaluates → human decides',
    icon: '🏗️',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Map the current system architecture: components, dependencies, data flows, integration points. Identify complexity hotspots and technical debt.' },
      { agentRole: 'architect', mode: 'analyze', autoContinue: true, instructions: 'Evaluate the architecture from the previous analysis. Assess scalability, fault tolerance, maintainability, and security. Recommend improvements with effort estimates.' },
      { humanLabel: 'Tech Lead', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Feature Build',
    description: 'Design → approve → implement → test → review → approve',
    icon: '🚀',
    steps: [
      { agentRole: 'architect', mode: 'draft', autoContinue: true, instructions: 'Design the architecture for this feature. Define components, interfaces, data flow, and technology choices. Keep it concrete — name files and functions.' },
      { humanLabel: 'Tech Lead', mode: 'human', autoContinue: false },
      { agentRole: 'developer', mode: 'develop', autoContinue: true, instructions: 'Implement the feature following the approved architecture design from the previous steps.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Write and run tests for the implementation. Cover happy path, edge cases, and error handling.' },
      { agentRole: 'reviewer', mode: 'review', autoContinue: true, instructions: 'Review the implementation and tests for correctness, quality, and adherence to the approved design.' },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'API Design',
    description: 'Design API → security check → approve → implement → test → approve',
    icon: '🌐',
    steps: [
      { agentRole: 'architect', mode: 'draft', autoContinue: true, instructions: 'Design the API: endpoints, methods, request/response schemas, authentication, pagination, error format. Produce an OpenAPI-style specification.' },
      { agentRole: 'security', mode: 'verify', autoContinue: true, instructions: 'Verify the API design for security: auth on all endpoints, input validation, rate limiting, no data over-exposure, proper error responses.' },
      { humanLabel: 'API Owner', mode: 'human', autoContinue: false },
      { agentRole: 'developer', mode: 'develop', autoContinue: true, instructions: 'Implement the approved API design. Follow the specification exactly.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Write integration tests for all API endpoints. Test success cases, validation errors, auth failures, and edge cases.' },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Tech Debt Assessment',
    description: 'Scout analyzes debt → Architect prioritizes → human decides',
    icon: '🧹',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Analyze the codebase for technical debt: code smells, complexity hotspots, outdated dependencies, missing tests, duplicated logic, inconsistent patterns. Quantify each item by effort and risk.' },
      { agentRole: 'architect', mode: 'review', autoContinue: true, instructions: 'Review the tech debt findings. Prioritize by business impact and effort. Group into quick wins, planned improvements, and strategic refactors. Recommend a payoff order.' },
      { humanLabel: 'Tech Lead', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Modernization',
    description: 'Analyze legacy → design new → approve → implement → test → security check → approve',
    icon: '🔄',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Analyze the legacy system: architecture, business logic, dependencies, data models, integration points. Document what must be preserved and what can be dropped.' },
      { agentRole: 'architect', mode: 'draft', autoContinue: true, instructions: 'Design the modernized architecture based on the legacy analysis. Preserve all business logic. Plan the migration path — what can be done incrementally vs. what requires a cutover.' },
      { humanLabel: 'Tech Lead', mode: 'human', autoContinue: false },
      { agentRole: 'developer', mode: 'develop', autoContinue: true, instructions: 'Implement the modernization following the approved design. Migrate incrementally where possible.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Verify the modernized system preserves all business logic from the legacy system. Run regression tests and compare outputs.' },
      { agentRole: 'security', mode: 'verify', autoContinue: true, instructions: 'Verify the modernized system meets current security standards. Check that the migration did not introduce new vulnerabilities.' },
      { humanLabel: 'Reviewer', mode: 'human', autoContinue: false },
    ],
  },
]

export async function seedChainTemplates(projectId: string) {
  const existing = await db.chainTemplate.count({ where: { projectId } })
  if (existing > 0) return

  for (const template of DEFAULT_CHAIN_TEMPLATES) {
    await db.chainTemplate.create({
      data: {
        name: template.name,
        description: template.description,
        icon: template.icon,
        projectId,
        steps: JSON.stringify(template.steps),
      },
    })
  }
}
