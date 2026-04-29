# Technical Debt Register

## Epic 1 — Prompt Archive Infrastructure (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-001 | No caching — archive is re-read from disk on every request | src/lib/server/prompt-library.ts | Low | Add 60s in-memory cache in Epic 5 polish task |
| TD-002 | No recursive subfolder support (e.g. Anthropic/old/) | src/lib/server/prompt-library.ts | Low | Implement in a future iteration if needed |
| TD-003 | No file watcher — archive changes require app restart | src/lib/server/prompt-library.ts | Low | Acceptable for v1; add inotify/chokidar watch in v2 |

## Epic 2 — Archive Browser UI (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-004 | No search/filter within the archive picker | prompt-archive-picker.tsx | Low | Add client-side filter in Epic 5 polish task |
| TD-005 | No keyboard navigation for the entry list (accessibility gap) | prompt-archive-picker.tsx | Medium | Add aria-* attributes and keyboard handler in a follow-up |
| TD-006 | Inline fetch logic in PromptArchivePicker could be extracted to a custom hook | prompt-archive-picker.tsx | Low | Extract to usePomptLibrary hook if component grows |
