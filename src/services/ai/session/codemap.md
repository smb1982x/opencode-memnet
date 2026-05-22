# src/services/ai/session/

## Responsibility

Manages AI conversation session lifecycle — persistence, message sequencing, retention/expiry, and cleanup. Acts as the authoritative store for all multi-turn AI interactions across provider backends.

**Key responsibilities:**
- **Session CRUD** — create, read, update, and delete AI sessions keyed by `(sessionId, provider)`.
- **Message persistence** — store and retrieve ordered messages per session with support for tool calls and structured content blocks.
- **Sequence management** — assign monotonically increasing sequence numbers to messages within a session, enabling ordered replay for provider context windows.
- **Retention & expiry** — TTL-based expiry (`CONFIG.aiSessionRetentionDays`, default 7 days); expired sessions are pruned by `cleanupExpiredSessions()`.
- **Cascading cleanup** — deleting a session cascades to all its messages via SQL foreign key `ON DELETE CASCADE`.

## Design Patterns

| Pattern | Application |
|---|---|
| **Singleton** | `AISessionManager` is instantiated once as a module-level export (`aiSessionManager`). The factory and all providers reference this single instance. |
| **Data Mapper** | Private methods `rowToSession()` / `rowToMessage()` translate raw SQLite rows into typed `AISession` / `AIMessage` objects, isolating the domain layer from the storage schema. |
| **Strategy / Dependency Injection** | `AISessionManager` is injected into every `BaseAIProvider` subclass via constructor. This allows the session store to be swapped or mocked independently from provider logic. |
| **Repository** | The manager encapsulates all SQLite access for both `ai_sessions` and `ai_messages` tables behind a clean domain API (no raw SQL leaks into callers). |
| **Factory wiring** | `AIProviderFactory.createProvider()` wires the singleton into each provider, keeping instantiation centralized. |

## Data & Control Flow

```
                      ┌─────────────────────────┐
                      │   AIProviderFactory      │
                      │  (wires aiSessionManager)│
                      └─────────┬───────────────┘
                                │ injects singleton
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
  OpenAIChatCompletion   AnthropicMessages      GoogleGemini
  OpenAIResponses
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
                      ┌─────────▼───────────────┐
                      │    AISessionManager      │
                      │  (singleton, SQLite)     │
                      └─────────┬───────────────┘
                                │
                      ┌─────────▼───────────────┐
                      │   connectionManager      │
                      │   (db pool, WAL mode)    │
                      └─────────────────────────┘
```

### Session lifecycle (per provider call)

```
provider.sendMessage(sessionId, ...)
  │
  ├─ getSession(sessionId, provider)     — lookup existing, check expires_at
  ├─ [if null] createSession({...})      — new row with expires_at = now + retention
  ├─ getMessages(session.id)             — ordered ASC by sequence
  ├─ addMessage({..., sequence})         — user/tool messages written immediately
  ├─ [API call to OpenAI/Anthropic/etc]
  ├─ addMessage({..., sequence})         — assistant response written
  └─ [on error] addMessage({retry...})   — error/retry entries sequenced in
```

### Message sequencing

Sequences are 0-based, auto-incremented per `ai_session_id` via `getLastSequence() + 1`. This guarantees ordered replay regardless of insertion timing. The `idx_ai_messages_session` index enforces efficient ordered scans.

### Retention & expiry

- `expires_at` is computed at session creation as `Date.now() + sessionRetentionMs`.
- `getSession()` implicitly filters out expired rows (`WHERE expires_at > ?`), so expired sessions are invisible to providers.
- `cleanupExpiredSessions()` runs a bulk `DELETE` — called via `AIProviderFactory.cleanupExpiredSessions()` for scheduled or on-demand GC.
- The `idx_ai_sessions_expires_at` index supports efficient expiry scans.

## Integration Points

| Component | Direction | Details |
|---|---|---|
| **`session-types.ts`** | Types consumed by | Defines `AISession`, `AIMessage`, `AIProviderType`, `SessionCreateParams`, `SessionUpdateParams`. Imported by all providers, the factory, and the manager. |
| **`ai-provider-factory.ts`** | Wires singleton | Imports the `aiSessionManager` instance and injects it into every provider constructor. Also exposes `cleanupExpiredSessions()` as a static facade. |
| **`providers/*.ts`** (4 providers) | Consumers | Each provider receives `AISessionManager` via constructor and calls: `getSession`, `createSession`, `getMessages`, `addMessage`, `getLastSequence`, `updateSession`. |
| **`connection-manager.ts`** | SQLite connection lifecycle | `connectionManager.getConnection(dbPath)` returns a cached connection with WAL mode, busy timeout, and foreign keys enabled. The manager holds a single connection for `ai-sessions.db`. |
| **`config.ts`** | Configuration | `CONFIG.storagePath` — directory for the DB file. `CONFIG.aiSessionRetentionDays` — TTL for session expiry (default 7). |
| **External callers** | Cleanup trigger | `AIProviderFactory.cleanupExpiredSessions()` (which delegates to `aiSessionManager.cleanupExpiredSessions()`) is the intended entry point for cron/scheduler-based GC. |

### Database schema

```
ai_sessions
  id            TEXT PRIMARY KEY         — internal UUID (sess_{ts}_{rand})
  provider      TEXT NOT NULL            — AIProviderType discriminator
  session_id    TEXT NOT NULL            — caller-provided logical session key
  conversation_id TEXT                   — provider-side conversation handle
  metadata      TEXT                     — JSON blob for extensible metadata
  created_at    INTEGER NOT NULL
  updated_at    INTEGER NOT NULL
  expires_at    INTEGER NOT NULL         — epoch ms, filtered by getSession()
  INDEX idx_ai_sessions_session_id (session_id)
  INDEX idx_ai_sessions_expires_at (expires_at)
  INDEX idx_ai_sessions_provider (provider)

ai_messages
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  ai_session_id   TEXT NOT NULL          — FK → ai_sessions.id ON DELETE CASCADE
  sequence        INTEGER NOT NULL       — 0-based, per-session ordering
  role            TEXT NOT NULL           — system | user | assistant | tool
  content         TEXT NOT NULL
  tool_calls      TEXT                   — JSON array of tool call objects
  tool_call_id    TEXT                   — links tool result to its call
  content_blocks  TEXT                   — JSON array of structured content
  created_at      INTEGER NOT NULL
  INDEX idx_ai_messages_session (ai_session_id, sequence)
  INDEX idx_ai_messages_role (ai_session_id, role)
```
