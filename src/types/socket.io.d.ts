declare module 'socket.io' {
  export interface Socket {
    id: string
    data: Record<string, unknown>
    handshake: {
      auth: Record<string, unknown>
      query: Record<string, unknown>
    }
    join(room: string): void
    to(room: string): {
      emit(event: string, payload?: unknown): void
    }
    on(event: string, listener: (data?: unknown) => void): void
  }

  export class Server {
    constructor(...args: any[])
    to(room: string): {
      emit(event: string, payload?: unknown): void
    }
    use(listener: (socket: Socket, next: (err?: Error) => void) => void): void
    on(event: 'connection', listener: (socket: Socket) => void): void
    close(callback?: () => void): void
  }
}
