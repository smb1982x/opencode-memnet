# src/web/

Browser-based admin UI for exploring, searching, and managing memories and user profiles served by the backend API.

## Responsibility

- Single-page frontend (no build step) that lets users browse, search, add, edit, delete, pin, and bulk-manage stored memories.
- Display linked prompt→memory pairs as combined cards.
- Show the learned user profile (preferences, patterns, workflows) with version history.
- Handle data migration flows (dimension mismatch, tag re-vectorization) through guided modals.
- Provide EN/ZH bilingual UI via `i18n.js`.

## Design

- **Vanilla JS SPA** — `app.js` holds a global `state` object and imperative DOM manipulation. No framework; all rendering is template-literal HTML injected via `innerHTML`.
- **Centralized state** (`state` object): tracks tags, memories, pagination, search, selection, and active view.
- **i18n via `data-i18n` attributes** — `i18n.js` exposes `t(key, params)` with `{placeholder}` interpolation and persists language choice in `localStorage`. Static elements are translated with `applyLanguage()`; dynamic content calls `t()` at render time.
- **Markdown rendering** — uses `marked` + `DOMPurify` for safe rendering of memory content.
- **CDN dependencies** — Lucide icons, marked, DOMPurify, jsonrepair loaded via `<script>` tags in `index.html`.
- **Terminal-inspired aesthetic** — monospace fonts, dark background (#0a0a0a), green (#00ff00) / cyan (#00ccff) / magenta (#ff00ff) accent palette. Responsive layout with `@media (max-width: 768px)` breakpoints.

### Key files

| File          | Role                                                                                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`  | Page structure: header, scope tabs (Project / Profile), controls bar, memory list, add-memory form, edit modal, toast, migration modals, changelog modal                                       |
| `app.js`      | All application logic: API calls (`fetchAPI`), CRUD operations, rendering (`renderMemories`, `renderUserProfile`), pagination, search, bulk selection, auto-refresh (30s), migration workflows |
| `styles.css`  | Full stylesheet: layout, card styles, badges, modals, animations, responsive breakpoints                                                                                                       |
| `i18n.js`     | Translation dictionaries (EN/ZH), `t()` helper with interpolation, `applyLanguage()` for DOM updates                                                                                           |
| `favicon.ico` | Browser tab icon                                                                                                                                                                               |

## Flow

1. **Init** (`DOMContentLoaded`): binds all event listeners, then sequentially calls `loadTags()` → `loadMemories()` → `loadStats()` → `checkMigrationStatus()`, then starts a 30-second `autoRefresh` interval.
2. **Read**: `loadMemories()` calls `GET /api/memories` (or `GET /api/search` when searching) with pagination/tag params, updates `state.memories`, then calls `renderMemories()` → `groupMemories()` pairs linked items → renders combined/prompt/memory cards.
3. **Write**: `addMemory()` posts to `POST /api/memories`; `saveEdit()` puts to `PUT /api/memories/:id`; deletes hit `DELETE /api/memories/:id?cascade=true` or `DELETE /api/prompts/:id?cascade=true`.
4. **Bulk ops**: selection tracked via `state.selectedMemories` (Set); bulk delete splits IDs into prompt vs memory arrays and calls respective bulk-delete endpoints.
5. **Migration**: `checkMigrationStatus()` detects dimension mismatches (`/api/migration/detect`) and tag migrations (`/api/migration/tags/detect`); shows modal with confirmation checkbox; batch migration runs via `POST /api/migration/tags/run-batch` in a loop with progress bar updates.
6. **Profile tab**: `loadUserProfile()` fetches `GET /api/user-profile`, parses potentially nested JSON fields with `jsonrepair`, renders preferences/patterns/workflows as card grids. Changelog via `GET /api/user-profile/changelog`.

## Integration

- **Backend API** — all data comes from REST endpoints under `/api/*` served by the Go backend. `fetchAPI()` wraps `fetch` with a 60-second timeout. `API_BASE` is empty (same-origin).
- **External CDN libs** — Lucide (icons), marked (Markdown), DOMPurify (HTML sanitization), jsonrepair (lenient JSON parsing for profile data).
- **localStorage** — used by `i18n.js` to persist language preference (`opencode-mem-lang`).
