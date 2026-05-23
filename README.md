# opencode-mem

Persistent memory system for AI coding agents — Postgres + pgvector backend with a standalone server and thin client plugin.

## Architecture

```
┌─────────────────┐     HTTP (API Key)     ┌──────────────────────┐
│  Thin Plugin    │ ────────────────────→  │  Standalone Server   │
│  (OpenCode)     │                        │  (Bun + Postgres)    │
│                 │ ←────────────────────   │                      │
│  Context inject │     JSON responses     │  API + WebUI + AI    │
└─────────────────┘                        └──────────────────────┘
                                                    │
                                                    ▼
                                           ┌──────────────────┐
                                           │  Postgres +      │
                                           │  pgvector         │
                                           │  (HNSW indexes)   │
                                           └──────────────────┘
```

- **Server**: Standalone Bun process serving REST API + WebUI, connected to Postgres/pgvector
- **Client**: Thin OpenCode plugin that communicates with the server over HTTP
- **Storage**: Postgres with pgvector extension for 1024-dim vector embeddings with HNSW indexing
- **Embeddings**: Remote OpenAI-compatible API (configurable model and dimensions)
- **AI**: OpenAI Chat Completions API for memory extraction and profile learning

## Prerequisites

- **Bun** ≥ 1.x (runtime)
- **PostgreSQL** 16+ with **pgvector** extension
- **Embedding API**: Any OpenAI-compatible endpoint (e.g., text-embedding-3-small, voyage-3, or self-hosted)
- **Chat API**: OpenAI-compatible Chat Completions endpoint

## Quick Start

### Docker Compose (recommended)

```bash
git clone https://github.com/tickernelz/opencode-mem
cd opencode-mem

# Set your API endpoints
export EMBEDDING_API_URL="https://api.openai.com/v1"
export EMBEDDING_MODEL="text-embedding-3-small"
export EMBEDDING_API_KEY="sk-..."
export SERVER_API_KEY="your-secret-key"
export MEMORY_MODEL="gpt-4o-mini"
export MEMORY_API_URL="https://api.openai.com/v1"
export MEMORY_API_KEY="sk-..."

docker compose up -d
```

Server runs on **http://localhost:4747** — open the WebUI and enter your `SERVER_API_KEY` in the settings panel (gear icon).

### Manual (Bun)

```bash
git clone https://github.com/tickernelz/opencode-mem
cd opencode-mem
bun install

# Start PostgreSQL with pgvector
docker run -d --name pgvector \
  -e POSTGRES_USER=opencode \
  -e POSTGRES_PASSWORD=opencode \
  -e POSTGRES_DB=opencode_mem \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Start the server
SERVER_API_KEY=my-secret-key \
POSTGRES_URL=postgresql://opencode:opencode@localhost:5432/opencode_mem \
POSTGRES_SSL=false \
EMBEDDING_API_URL="https://api.openai.com/v1" \
EMBEDDING_MODEL="text-embedding-3-small" \
EMBEDDING_API_KEY="sk-..." \
MEMORY_MODEL="gpt-4o-mini" \
MEMORY_API_URL="https://api.openai.com/v1" \
MEMORY_API_KEY="sk-..." \
bun run src/server.ts
```

### Plugin Configuration

In your OpenCode project, create `.opencode/opencode-mem.jsonc`:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "my-secret-key",
  "autoCaptureEnabled": true,
}
```

The plugin auto-detects this config and switches to remote mode. Without it, the legacy in-process mode runs with a deprecation warning.

## Environment Variables

### Required

| Variable            | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `SERVER_API_KEY`    | API key for authenticating all requests               |
| `POSTGRES_URL`      | PostgreSQL connection string                          |
| `EMBEDDING_API_URL` | OpenAI-compatible embedding API base URL              |
| `EMBEDDING_MODEL`   | Embedding model name (e.g., `text-embedding-3-small`) |
| `EMBEDDING_API_KEY` | API key for the embedding service                     |

### Optional

| Variable                             | Default       | Description                             |
| ------------------------------------ | ------------- | --------------------------------------- |
| `SERVER_PORT`                        | `4747`        | HTTP server port                        |
| `SERVER_HOST`                        | `0.0.0.0`     | HTTP server bind address                |
| `POSTGRES_SSL`                       | `require`     | SSL mode (`false` for local dev)        |
| `POSTGRES_MAX_CONNECTIONS`           | `10`          | Connection pool size                    |
| `POSTGRES_VECTOR_TYPE`               | `vector`      | pgvector type (`vector` or `halfvec`)   |
| `EMBEDDING_DIMENSIONS`               | auto-detected | Override embedding dimensions           |
| `SIMILARITY_THRESHOLD`               | `0.6`         | Minimum similarity for search results   |
| `MAX_MEMORIES`                       | `10`          | Max memories in context injection       |
| `MEMORY_MODEL`                       | —             | Chat model for memory extraction        |
| `MEMORY_API_URL`                     | —             | Chat completions API URL                |
| `MEMORY_API_KEY`                     | —             | API key for chat completions            |
| `MEMORY_TEMPERATURE`                 | `0.3`         | Temperature for memory generation       |
| `AUTO_CAPTURE_MAX_ITERATIONS`        | `5`           | Max auto-capture iterations per session |
| `AUTO_CAPTURE_ITERATION_TIMEOUT`     | `30000`       | Auto-capture timeout (ms)               |
| `AUTO_CAPTURE_LANGUAGE`              | `auto`        | Language for generated memories         |
| `AI_SESSION_RETENTION_DAYS`          | `7`           | Retention for AI session data           |
| `USER_PROFILE_ANALYSIS_INTERVAL`     | `10`          | Sessions between profile analysis       |
| `USER_PROFILE_MAX_PREFERENCES`       | `20`          | Max learned preferences                 |
| `USER_PROFILE_MAX_PATTERNS`          | `15`          | Max detected patterns                   |
| `USER_PROFILE_MAX_WORKFLOWS`         | `10`          | Max identified workflows                |
| `USER_PROFILE_CONFIDENCE_DECAY_DAYS` | `30`          | Confidence decay period                 |
| `WEB_SERVER_ALLOWED_ORIGIN`          | `*`           | CORS allowed origin                     |

## API Endpoints

All `/api/*` routes require `Authorization: Bearer <SERVER_API_KEY>`. Health endpoint is unauthenticated.

### Health

| Method | Path          | Description                                            |
| ------ | ------------- | ------------------------------------------------------ |
| `GET`  | `/api/health` | Server health (db status, embedding readiness, uptime) |

### Memories

| Method   | Path                        | Description                                                                                  |
| -------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `GET`    | `/api/memories`             | List memories (optional: `?tag=`, `?page=`, `?pageSize=`, `?userEmail=`, `?includePrompts=`) |
| `POST`   | `/api/memories`             | Add a memory                                                                                 |
| `PUT`    | `/api/memories/:id`         | Update a memory                                                                              |
| `DELETE` | `/api/memories/:id`         | Delete a memory                                                                              |
| `POST`   | `/api/memories/bulk-delete` | Bulk delete memories                                                                         |
| `POST`   | `/api/memories/:id/pin`     | Pin a memory                                                                                 |
| `POST`   | `/api/memories/:id/unpin`   | Unpin a memory                                                                               |

### Search & Context

| Method | Path                  | Description                                                   |
| ------ | --------------------- | ------------------------------------------------------------- |
| `GET`  | `/api/search`         | Semantic search (`?q=`, `?tag=`, `?pageSize=`, `?userEmail=`) |
| `POST` | `/api/context/inject` | Context injection for chat messages                           |
| `POST` | `/api/auto-capture`   | Server-side auto-capture from conversation data               |

### User Profiles

| Method | Path                          | Description                               |
| ------ | ----------------------------- | ----------------------------------------- |
| `GET`  | `/api/user-profile`           | Get active profile (optional: `?userId=`) |
| `GET`  | `/api/user-profiles`          | List all active profiles                  |
| `POST` | `/api/user-profile/learn`     | Trigger profile learning                  |
| `POST` | `/api/user-profile/refresh`   | Refresh profile data                      |
| `GET`  | `/api/user-profile/changelog` | Profile version history                   |
| `GET`  | `/api/user-profile/snapshot`  | Profile snapshot at version               |

### Tags & Stats

| Method | Path         | Description                                  |
| ------ | ------------ | -------------------------------------------- |
| `GET`  | `/api/tags`  | List distinct project tags                   |
| `GET`  | `/api/stats` | Memory statistics (total, by scope, by type) |

## WebUI

A management interface served at `/` with:

- **Memory list**: View, search, edit, delete, and bulk-delete memories
- **Add memory form**: Create new memories with tags and type classification
- **User profile viewer**: Preferences, patterns, workflows, and changelog history
- **Profile switcher**: Dropdown to manage multiple user profiles from one UI
- **Settings panel**: Gear icon → centered API settings with API key and profile selection
- **Tag filtering**: Filter memories by project tag
- **Pagination**: Browse large memory sets
- **i18n**: English and Chinese language support
- **Migration tools**: Tag migration and dimension migration workflows

## Client Plugin

When configured with `serverUrl` and `apiKey`, the plugin runs as a thin client:

- **chat.message hook**: Injects relevant `[MEMORY]` context before each chat message
- **tool.memory**: Adds, searches, lists, and deletes memories via the memory tool
- **session.idle**: Fire-and-forget auto-capture to the server
- **session.compacted**: Restores session memory after context compaction
- **User profile**: View learned preferences and patterns

## User Profiles

Profiles are learned automatically from chat sessions:

- **Preferences**: Coding style, tool choices, architectural preferences (with confidence scores)
- **Patterns**: Repeated behaviors (TDD, commit conventions, review habits) with frequency counts
- **Workflows**: Multi-step processes the user follows
- **Changelog**: Versioned history of profile evolution

User identity is auto-detected from `git config user.email` in the project directory. Profiles are keyed by email — switching git identities switches profiles automatically.

## Development

```bash
bun install
bun run typecheck    # tsc --noEmit
bun run build        # tsc + copy web assets
bun run dev:server   # bun --watch src/server.ts
bun test             # 160 tests
```

## License

MIT
