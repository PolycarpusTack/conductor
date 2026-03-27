import { createServer } from 'http'
import { timingSafeEqual } from 'crypto'

import { Server } from 'socket.io'

import { verifyRealtimeToken } from '../../src/lib/server/realtime'

const PORT = Number(process.env.PORT || 3003)
const INTERNAL_BROADCAST_SECRET = process.env.AGENTBOARD_WS_INTERNAL_SECRET || ''
const allowedOrigins = new Set(
  (process.env.AGENTBOARD_WS_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

const projectRooms = new Map<string, Set<string>>()

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'POST' && url.pathname === '/broadcast') {
    const authHeader = req.headers.authorization || ''
    const expectedHeader = `Bearer ${INTERNAL_BROADCAST_SECRET}`

    const authBuffer = Buffer.from(authHeader)
    const expectedBuffer = Buffer.from(expectedHeader)
    if (
      !INTERNAL_BROADCAST_SECRET ||
      authBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(authBuffer, expectedBuffer)
    ) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return
    }

    let body = ''
    const MAX_BODY_SIZE = 1024 * 1024 // 1MB
    let overflow = false
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY_SIZE) {
        overflow = true
        req.destroy()
      }
    })

    req.on('end', () => {
      if (overflow) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Request body too large' }))
        return
      }

      try {
        const parsed = JSON.parse(body || '{}') as {
          projectId?: string
          event?: string
          payload?: unknown
        }

        if (!parsed.projectId || !parsed.event) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Missing projectId or event' }))
          return
        }

        io.to(`project:${parsed.projectId}`).emit(parsed.event, parsed.payload)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (error) {
        console.error('[WS] Broadcast error:', error)
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }))
      }
    })

    return
  }

  if (url.pathname === '/socket.io/' || url.pathname === '/socket.io') {
    return
  }

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('Origin not allowed'))
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

io.use((socket, next) => {
  const token =
    (typeof socket.handshake.auth.token === 'string' && socket.handshake.auth.token) ||
    (typeof socket.handshake.query.token === 'string' && socket.handshake.query.token) ||
    null

  if (!token) {
    next(new Error('Missing realtime token'))
    return
  }

  const payload = verifyRealtimeToken(token)
  if (!payload) {
    next(new Error('Invalid realtime token'))
    return
  }

  socket.data.projectId = payload.projectId
  next()
})

io.on('connection', (socket) => {
  const projectId = socket.data.projectId as string
  const roomName = `project:${projectId}`

  socket.join(roomName)

  if (!projectRooms.has(projectId)) {
    projectRooms.set(projectId, new Set())
  }

  projectRooms.get(projectId)?.add(socket.id)

  console.log(`[WS] Client ${socket.id} connected to project ${projectId}`)

  socket.to(roomName).emit('user-joined', {
    socketId: socket.id,
    userCount: projectRooms.get(projectId)?.size || 0,
  })

  socket.on('cursor-position', (data: unknown) => {
    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as { x: unknown }).x !== 'number' ||
      typeof (data as { y: unknown }).y !== 'number' ||
      !Number.isFinite((data as { x: number }).x) ||
      !Number.isFinite((data as { y: number }).y)
    ) {
      return
    }

    socket.to(roomName).emit('cursor-position', {
      socketId: socket.id,
      x: (data as { x: number }).x,
      y: (data as { y: number }).y,
    })
  })

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`)

    const sockets = projectRooms.get(projectId)
    if (!sockets) {
      return
    }

    sockets.delete(socket.id)

    socket.to(roomName).emit('user-left', {
      socketId: socket.id,
      userCount: sockets.size,
    })

    if (sockets.size === 0) {
      projectRooms.delete(projectId)
    }
  })
})

httpServer.listen(PORT, () => {
  console.log(`[WS] Conductor WebSocket server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('[WS] Shutting down...')
  io.close(() => {
    httpServer.close(() => {
      process.exit(0)
    })
  })
})
