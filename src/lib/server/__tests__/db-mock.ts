// TD-014b harness fix — leak-safe db mock.
//
// Bun's `mock.module` registry is GLOBAL and shared across test files, so a
// PARTIAL `@/lib/db` mock in one file can be the active mock while another file
// runs — and a call to a method that partial mock omits throws
// "db.<model>.<method> is not a function" (the documented TD-014b symptom).
//
// `dbMock(overrides)` returns a Proxy where every model → a Proxy where every
// method not explicitly provided resolves to a no-op returning `Promise<null>`.
// The file's own mocked methods behave exactly as given; the *gaps* can no
// longer crash a leaked-into file. Adopt it in any file whose `@/lib/db` mock is
// a partial surface:
//
//   mock.module('@/lib/db', () => ({
//     db: dbMock({ task: { findMany: myTaskFindMany } }),
//     isPostgresDb: false,
//   }))
//
// (This file is NOT a test — no `.test.ts` suffix — so the runner ignores it.)

type AnyRecord = Record<string, unknown>

const noop = () => Promise.resolve(null)

/** A model whose explicit methods win; any other property is a no-op mock. */
function modelProxy(override: AnyRecord): AnyRecord {
  return new Proxy(override, {
    get(target, prop: string) {
      return prop in target ? target[prop] : noop
    },
  })
}

/**
 * Leak-safe Prisma-client mock. `overrides` maps model name → its mocked methods;
 * everything else (unlisted models, unlisted methods) is a no-op. Prisma client
 * helpers ($transaction/$queryRaw/…) also resolve to the no-op.
 */
export function dbMock(overrides: Record<string, unknown> = {}): AnyRecord {
  const modelCache = new Map<string, unknown>()
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) {
        const val = target[prop]
        // Explicit client helper ($transaction/$queryRaw/…) or any function → as-is.
        if (typeof val === 'function') return val
        // Explicit model object → wrap so its *missing* methods are no-ops.
        if (!modelCache.has(prop)) modelCache.set(prop, modelProxy((val as AnyRecord) ?? {}))
        return modelCache.get(prop)
      }
      // Unlisted client helper → no-op; unlisted model → all-no-op model.
      if (prop.startsWith('$')) return noop
      if (!modelCache.has(prop)) modelCache.set(prop, modelProxy({}))
      return modelCache.get(prop)
    },
  })
}
