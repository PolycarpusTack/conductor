import { NextResponse } from 'next/server'

import { getLogger } from '@/lib/server/logger'

const log = getLogger('api')

/**
 * Typed HTTP error a route can throw to short-circuit into a clean response.
 * Anything else that bubbles out becomes a generic 500 (details are logged,
 * not returned, to avoid leaking internals).
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, message, details)
export const unauthorized = (message = 'Unauthorized') => new ApiError(401, message)
export const forbidden = (message = 'Forbidden') => new ApiError(403, message)
export const notFound = (message = 'Not found') => new ApiError(404, message)
export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, message, details)
export const tooLarge = (message = 'Payload too large') => new ApiError(413, message)

/**
 * Shape Next.js passes as the second arg to every route handler. Even
 * non-dynamic routes receive `{ params: Promise<{}> }`. Dynamic routes
 * narrow this via the generic.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type RouteContext = { params: Promise<{}> }

type RouteHandler<Ctx extends RouteContext = RouteContext> = (
  request: Request,
  context: Ctx,
) => Promise<Response>

/**
 * Wraps a Next.js route handler with uniform error handling.
 *
 * - `ApiError` instances become JSON responses at their `.status` (the one
 *   place to express expected failure modes).
 * - Anything else is logged with the given `tag` and returned as a 500
 *   with a generic message. Stack traces stay in the server logs.
 *
 * The `tag` should identify the route (e.g. `"api/tasks"`) so logs can be
 * correlated with a specific handler.
 */
export function withErrorHandling<Ctx extends RouteContext = RouteContext>(
  tag: string,
  handler: RouteHandler<Ctx>,
): RouteHandler<Ctx> {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(
          err.details !== undefined
            ? { error: err.message, details: err.details }
            : { error: err.message },
          { status: err.status },
        )
      }
      log.error(`unhandled error in ${tag}`, err)
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 },
      )
    }
  }
}
