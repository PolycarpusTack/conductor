# Technical Debt Register

## Epic 1 — Prompt Archive Infrastructure (2026-04-29)

| ID | Description | File | Severity | Resolution |
|----|-------------|------|----------|------------|
| TD-001 | No caching — archive is re-read from disk on every request | src/lib/server/prompt-library.ts | Low | Add 60s in-memory cache in Epic 5 polish task |
| TD-002 | No recursive subfolder support (e.g. Anthropic/old/) | src/lib/server/prompt-library.ts | Low | Implement in a future iteration if needed |
| TD-003 | No file watcher — archive changes require app restart | src/lib/server/prompt-library.ts | Low | Acceptable for v1; add inotify/chokidar watch in v2 |
