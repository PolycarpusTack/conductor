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
  // --- Framework-driven chains ---
  {
    name: 'Code Quality Pipeline',
    description: 'Full codebase quality audit: architecture → clean code → debt → remediation → security → tests',
    icon: '✅',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Map the codebase architecture: components, layers, dependencies, data flows. Identify complexity hotspots, coupling issues, and areas with security-relevant logic.' },
      { agentRole: 'reviewer', mode: 'review', autoContinue: true, instructions: 'Run clean code analysis on the codebase map from the previous step. Check layer violations, import rules, naming conventions, duplication, and code smells. Rate each finding by severity.' },
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Detect technical debt: outdated dependencies, missing tests, inconsistent patterns, complexity hotspots. Quantify each item by remediation effort and business risk.' },
      { agentRole: 'architect', mode: 'draft', autoContinue: true, instructions: 'Based on the quality and debt findings, generate a prioritized remediation plan. Group into quick wins, planned improvements, and strategic refactors. Include specific files and changes.' },
      { agentRole: 'developer', mode: 'develop', autoContinue: true, instructions: 'Execute the quick wins from the remediation plan. Fix the highest-priority items. Follow existing project conventions.' },
      { agentRole: 'security', mode: 'verify', autoContinue: true, instructions: 'Security review all changes made in the remediation step. Verify no new vulnerabilities were introduced and existing security controls remain intact.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Validate test coverage for all changes. Run existing tests and verify no regressions. Identify any untested code paths in the modified files.' },
      { humanLabel: 'Tech Lead', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'AI Evaluation & Guardrails',
    description: 'Golden set eval → adversarial probes → baseline comparison → report → human review',
    icon: '🛡️',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Load or define the golden test set for evaluation. Catalog the AI capabilities being tested: factuality, coherence, safety, instruction-following. Document baseline thresholds for each metric.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Run the capability evaluation suite against the golden test set. Measure factuality, coherence, safety, instruction-following, and hallucination rates. Compare results against baseline thresholds (95%+ preservation required).' },
      { agentRole: 'adversarial-tester', mode: 'verify', autoContinue: true, instructions: 'Execute adversarial probes: jailbreak attempts, toxicity injection, PII extraction, bias scenarios, prompt injection. Document every bypass or policy violation with severity and reproduction steps.' },
      { agentRole: 'reviewer', mode: 'review', autoContinue: true, instructions: 'Review the evaluation results and adversarial findings. Compare against the documented baseline. Flag any regressions, new vulnerabilities, or degraded capabilities. Determine overall pass/fail.' },
      { agentRole: 'writer', mode: 'draft', autoContinue: true, instructions: 'Generate a comprehensive evaluation report: summary, capability scores, adversarial findings, baseline comparison, regressions, and recommended actions. Format for stakeholder review.' },
      { humanLabel: 'AI Safety Lead', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Backlog Builder',
    description: 'Validate design → score → threat model → generate EPICs → decompose → validate → approve',
    icon: '📋',
    steps: [
      { agentRole: 'reviewer', mode: 'review', autoContinue: true, instructions: 'Validate the solution design quality gate. Check for required sections: business context, architecture, data models, APIs, user journeys. Score clarity, feasibility, and completeness (1-3 each). Block if total score is below 5/9.' },
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Deep analysis of the solution design: identify ambiguities, gaps, dependencies on external systems, scalability concerns. Produce a risk register with likelihood and impact for each item.' },
      { agentRole: 'security', mode: 'analyze', autoContinue: true, instructions: 'STRIDE threat assessment of the proposed design. For each component: identify Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, and Elevation of Privilege risks. Rate each threat by severity.' },
      { agentRole: 'architect', mode: 'draft', autoContinue: true, instructions: 'Generate EPICs from the design. Each EPIC needs: objective, definition of done, SLOs, and a runbook outline. Decompose each EPIC into user stories with persona, acceptance criteria, and priority score. Maximum 2 EPICs per iteration.' },
      { agentRole: 'developer', mode: 'draft', autoContinue: true, instructions: 'Decompose user stories into implementation tasks with: deliverables, quality gates, dependency chain (which tasks unblock which), estimated effort, and feature flag requirements. Ensure strict sequential ordering.' },
      { agentRole: 'reviewer', mode: 'verify', autoContinue: true, instructions: 'Run the backlog validator: verify DAG dependencies are acyclic, all tasks are idempotent, test coverage exists at all layers, feature flags are defined, SLOs are measurable, and token budgets are within limits.' },
      { humanLabel: 'Product Owner', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Incident Response',
    description: 'Detect → diagnose + assess blast radius → root cause → remediate → verify → postmortem',
    icon: '🚨',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Analyze the incident: gather logs, metrics, traces, and error reports. Map the timeline of events. Identify affected components and the scope of impact. Produce an initial situation report.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Run automated diagnostics on affected components. Execute health checks, smoke tests, and integration tests. Collect performance metrics and error rates. Compare against pre-incident baselines.' },
      { agentRole: 'security', mode: 'analyze', autoContinue: true, instructions: 'Assess the blast radius and security implications. Determine: is this a security incident? What data was affected? Is there lateral movement risk? What containment actions are needed immediately?' },
      { agentRole: 'architect', mode: 'analyze', autoContinue: true, instructions: 'Root cause analysis using the diagnostics and security assessment. Trace the failure chain from trigger to impact. Identify the systemic issue, not just the proximate cause. Recommend both immediate fix and long-term prevention.' },
      { agentRole: 'developer', mode: 'develop', autoContinue: true, instructions: 'Execute the remediation: implement the immediate fix from the root cause analysis. If a rollback is needed, execute it. Ensure the fix is minimal and targeted — do not refactor during incident response.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Verify the remediation: re-run all diagnostics from the earlier step. Confirm error rates are back to baseline, affected components are healthy, and no regressions were introduced.' },
      { agentRole: 'writer', mode: 'draft', autoContinue: true, instructions: 'Generate the postmortem report: timeline, root cause, impact assessment (users affected, duration, data impact), remediation taken, action items for prevention, and lessons learned.' },
      { humanLabel: 'Incident Commander', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Documentation & Onboarding',
    description: 'Analyze codebase → generate API docs → create examples → test examples → onboarding guide → review',
    icon: '📚',
    steps: [
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Analyze the codebase structure: map public APIs, component hierarchy, data models, configuration options, and integration points. Identify what needs documentation and what already has it.' },
      { agentRole: 'writer', mode: 'draft', autoContinue: true, instructions: 'Generate API documentation from the codebase analysis: endpoints, methods, parameters, response schemas, authentication, error codes, and rate limits. Include request/response examples for each endpoint.' },
      { agentRole: 'developer', mode: 'draft', autoContinue: true, instructions: 'Create cookbook-style code examples for the most common use cases. Each example should be self-contained, runnable, and demonstrate one concept clearly. Include setup instructions and expected output.' },
      { agentRole: 'qa', mode: 'verify', autoContinue: true, instructions: 'Test every code example from the previous step. Verify they run correctly, produce the expected output, and handle errors gracefully. Flag any examples that fail or produce confusing results.' },
      { agentRole: 'writer', mode: 'draft', autoContinue: true, instructions: 'Generate an onboarding guide: prerequisites, setup instructions, first project walkthrough, key concepts explanation, common pitfalls, and links to detailed documentation. Target audience: developer new to this codebase.' },
      { agentRole: 'reviewer', mode: 'review', autoContinue: true, instructions: 'Review all documentation for accuracy: cross-reference API docs against the code, verify examples still work, check for stale content, and ensure the onboarding guide covers the critical path.' },
      { humanLabel: 'Tech Lead', mode: 'human', autoContinue: false },
    ],
  },
  {
    name: 'Data & RAG Quality Audit',
    description: 'Validate data contracts → PII scan → retrieval eval → freshness check → report → human review',
    icon: '🔬',
    steps: [
      { agentRole: 'data-engineer', mode: 'analyze', autoContinue: true, instructions: 'Analyze the data pipeline and knowledge base. Assess data contracts, schema compliance, ingestion pipeline health, and chunking strategy effectiveness. Map all data sources with their freshness SLAs.' },
      { agentRole: 'security', mode: 'verify', autoContinue: true, instructions: 'PII detection scan across the knowledge base. Classify all personal data by sensitivity level. Verify PII handling matches the classification: redacted, masked, tokenized, or blocked as appropriate. Flag any unprotected PII.' },
      { agentRole: 'data-engineer', mode: 'verify', autoContinue: true, instructions: 'Run retrieval quality evaluation: measure precision@K, recall@K, MRR, NDCG, and answer relevance against the test dataset. Thresholds: 85%+ Top-K hit rate, 0.7+ MRR. Report failing queries with analysis.' },
      { agentRole: 'analyst', mode: 'analyze', autoContinue: true, instructions: 'Freshness and drift check: calculate document ages against SLAs, identify stale content, detect distribution drift in embeddings, check for data source availability. Flag any freshness violations.' },
      { agentRole: 'compliance-officer', mode: 'verify', autoContinue: true, instructions: 'Verify data governance compliance: retention policies enforced, audit trail complete, data subject rights implementable, third-party data sharing documented. Check against GDPR/CCPA requirements as applicable.' },
      { agentRole: 'writer', mode: 'draft', autoContinue: true, instructions: 'Generate a data quality report: overall quality score, dimension-by-dimension breakdown, PII findings, retrieval metrics, freshness status, compliance gaps, and prioritized remediation recommendations.' },
      { humanLabel: 'Data Steward', mode: 'human', autoContinue: false },
    ],
  },
]

export async function seedChainTemplates(projectId: string) {
  const existingTemplates = await db.chainTemplate.findMany({
    where: { projectId },
    select: { name: true },
  })
  const existingNames = new Set(existingTemplates.map(t => t.name))

  const missing = DEFAULT_CHAIN_TEMPLATES.filter(t => !existingNames.has(t.name))
  if (missing.length === 0) return

  for (const template of missing) {
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
