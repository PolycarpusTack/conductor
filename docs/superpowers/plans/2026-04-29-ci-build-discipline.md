# CI & Build Discipline Implementation Plan

> **STATUS: COMPLETED 2026-04-29** — Merged to main as part of v0.0.5 release.

**Goal:** Achieve a clean, reproducible build baseline: all TypeScript errors fixed, Prisma client drift detected before type-check, and CI enforcing the correct step order.

**Architecture:** Fix two pre-existing TypeScript errors, add a `postinstall` hook so `prisma generate` runs automatically after `bun install`, and create a GitHub Actions workflow that enforces the order: validate schema → detect stale client → type-check → test → build. The stale-client check runs `prisma generate` and asserts no git diff, so a committed-but-not-regenerated schema change fails CI loudly before TypeScript ever sees it.

**Tech Stack:** Bun 1.3.4, Prisma 7, TypeScript 5, GitHub Actions, Next.js 16

---

## File Map

| File | Change |
|---|---|
| `src/components/help-page.tsx` | Fix two `tone="blue"` type errors |
| `src/lib/server/__tests__/trigger-evaluator.test.ts` | Type `makeTrigger` to match Prisma-generated Trigger shape |
| `package.json` | Add `postinstall: prisma generate` |
| `.github/workflows/ci.yml` | New — ordered CI pipeline |

---

### Task 1: Fix `help-page.tsx` tone type errors ✅

### Task 2: Fix `trigger-evaluator.test.ts` type errors ✅

### Task 3: Add `postinstall` hook for automatic client generation ✅

### Task 4: Create GitHub Actions CI workflow ✅

### Task 5: Full build verification ✅

**Result:** 0 TypeScript errors, 179/179 tests pass, lint clean. Merged to main.
