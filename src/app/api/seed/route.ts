import { randomUUID } from 'crypto'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createAgentApiKey, createProjectApiKey } from '@/lib/server/api-keys'
import { requireAdminSession } from '@/lib/server/admin-session'

export async function POST() {
  try {
    const unauthorized = await requireAdminSession()
    if (unauthorized) {
      return unauthorized
    }

    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Seeding is disabled in production' }, { status: 403 })
    }

    // Check if data already exists
    const existingProjects = await db.project.count()
    if (existingProjects > 0) {
      return NextResponse.json({ message: 'Database already seeded' })
    }
    
    const projectId = randomUUID()
    const projectKey = createProjectApiKey(projectId)
    const project = await db.project.create({
      data: {
        id: projectId,
        name: 'API Project',
        description: 'Main development project - Demo for AgentBoard',
        color: '#3b82f6',
        apiKeyHash: projectKey.hash,
        apiKeyPreview: projectKey.preview,
      },
    })
    const coderId = randomUUID()
    const researchId = randomUUID()
    const writerId = randomUUID()
    const qaId = randomUUID()
    const coderKey = createAgentApiKey(coderId)
    const researchKey = createAgentApiKey(researchId)
    const writerKey = createAgentApiKey(writerId)
    const qaKey = createAgentApiKey(qaId)
    const coder = await db.agent.create({
      data: {
        id: coderId,
        name: 'Coder',
        emoji: '🤖',
        color: '#3b82f6',
        description: 'Backend & frontend development',
        apiKeyHash: coderKey.hash,
        apiKeyPreview: coderKey.preview,
        projectId: project.id,
        isActive: false,
      },
    })    
    const research = await db.agent.create({
      data: {
        id: researchId,
        name: 'Research',
        emoji: '🔍',
        color: '#8b5cf6',
        description: 'Research & analysis',
        apiKeyHash: researchKey.hash,
        apiKeyPreview: researchKey.preview,
        projectId: project.id,
        isActive: false,
      },
    })    
    const writer = await db.agent.create({
      data: {
        id: writerId,
        name: 'Writer',
        emoji: '✏️',
        color: '#f59e0b',
        description: 'Content & documentation',
        apiKeyHash: writerKey.hash,
        apiKeyPreview: writerKey.preview,
        projectId: project.id,
        isActive: false,
      },
    })    
    const qa = await db.agent.create({
      data: {
        id: qaId,
        name: 'QA',
        emoji: '🧪',
        color: '#10b981',
        description: 'Testing & quality assurance',
        apiKeyHash: qaKey.hash,
        apiKeyPreview: qaKey.preview,
        projectId: project.id,
        isActive: false,
      },
    })    
    // Create sample tasks
    const tasks = await db.task.createMany({
      data: [
        {
          title: 'Research competitor APIs',
          description: 'Analyze top 5 competitors API design patterns',
          status: 'BACKLOG',
          priority: 'MEDIUM',
          tag: 'research',
          projectId: project.id,
          agentId: research.id,
          order: 1,
        },
        {
          title: 'Write changelog for v2.1',
          description: 'Document all changes for the upcoming release',
          status: 'BACKLOG',
          priority: 'LOW',
          tag: 'docs',
          projectId: project.id,
          agentId: writer.id,
          order: 2,
        },
        {
          title: 'Implement auth middleware',
          description: 'Add JWT authentication to API routes',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          tag: 'backend',
          projectId: project.id,
          agentId: coder.id,
          notes: 'Running tests on token refresh flow...',
          order: 1,
          startedAt: new Date(Date.now() - 3600000), // Started 1 hour ago
        },
        {
          title: 'Summarize user interviews',
          description: 'Compile insights from 12 user interviews',
          status: 'IN_PROGRESS',
          priority: 'MEDIUM',
          tag: 'research',
          projectId: project.id,
          agentId: research.id,
          notes: 'Processed 8/12 transcripts',
          order: 2,
          startedAt: new Date(Date.now() - 7200000), // Started 2 hours ago
        },
        {
          title: 'Draft onboarding emails',
          description: 'Create email sequence for new users',
          status: 'REVIEW',
          priority: 'MEDIUM',
          tag: 'copy',
          projectId: project.id,
          agentId: writer.id,
          order: 1,
          output: 'Created 5-email welcome sequence. Awaiting review.',
        },
        {
          title: 'Set up CI pipeline',
          description: 'Configure GitHub Actions for automated testing',
          status: 'DONE',
          priority: 'HIGH',
          tag: 'devops',
          projectId: project.id,
          agentId: coder.id,
          order: 1,
          completedAt: new Date(Date.now() - 86400000), // Completed yesterday
        },
        {
          title: 'Design system components',
          description: 'Create reusable UI component library',
          status: 'DONE',
          priority: 'MEDIUM',
          tag: 'frontend',
          projectId: project.id,
          agentId: coder.id,
          order: 2,
          completedAt: new Date(Date.now() - 172800000), // Completed 2 days ago
        },
        {
          title: 'API documentation',
          description: 'Write OpenAPI specs for all endpoints',
          status: 'DONE',
          priority: 'HIGH',
          tag: 'docs',
          projectId: project.id,
          agentId: writer.id,
          order: 3,
          completedAt: new Date(Date.now() - 259200000), // Completed 3 days ago
        },
      ],
    })
    // Create some activity logs
    await db.activityLog.createMany({
      data: [
        {
          action: 'started',
          taskId: null, // We don't have the IDs from createMany
          agentId: coder.id,
          projectId: project.id,
          details: 'Started working on auth middleware',
          createdAt: new Date(Date.now() - 3600000),
        },
        {
          action: 'progress',
          agentId: coder.id,
          projectId: project.id,
          details: 'Running tests on token refresh flow...',
          createdAt: new Date(Date.now() - 1800000),
        },
        {
          action: 'started',
          agentId: research.id,
          projectId: project.id,
          details: 'Started summarizing user interviews',
          createdAt: new Date(Date.now() - 7200000),
        },
        {
          action: 'completed',
          agentId: coder.id,
          projectId: project.id,
          details: 'CI pipeline configured and running',
          createdAt: new Date(Date.now() - 86400000),
        },
      ],
    })    
    return NextResponse.json({
      success: true,
      message: 'Database seeded successfully',
      project: {
        id: project.id,
        name: project.name,
      },
      agents: [
        { id: coder.id, name: coder.name },
        { id: research.id, name: research.name },
        { id: writer.id, name: writer.name },
        { id: qa.id, name: qa.name },
      ],
      tasksCount: tasks.count,
    })
  } catch (error) {
    console.error('Error seeding database:', error)
    return NextResponse.json({ error: 'Failed to seed database' }, { status: 500 })
  }
}
