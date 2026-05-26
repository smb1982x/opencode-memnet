# opencode-memnet

Persistent memory system for AI coding agents — server + client architecture.

This project builds upon and would not exist without the original [OpenCode Memory](https://github.com/tickernelz/opencode-mem) by **tickernelz**. Thank you for creating and sharing this excellent work. For the original version with local vector database support and a lighter footprint suitable for single-user local use, visit **[github.com/tickernelz/opencode-mem](https://github.com/tickernelz/opencode-mem)**.

## Architecture

![opencode-memnet Architecture Diagram](src/web/opencode-memnet-diagram.svg)

- **Server** (`src/`): Standalone Bun process serving REST API + WebUI, connected to Postgres/pgvector
- **Client Plugin** (`plugin/`): Thin OpenCode plugin compiled to a single JS file, communicates via HTTP
- **Shared** (`shared/`): Utilities used by the plugin (client config, tags, logging)
- **Storage**: Postgres with pgvector extension for 1024-dim vector embeddings with HNSW indexing
- **Embeddings**: Remote OpenAI-compatible API (configurable model and dimensions)
- **AI**: OpenAI Chat Completions API for memory extraction and profile learning

The server and client plugin are fully independent — the server knows nothing about the plugin, and the plugin has no server-side dependencies. You can run the server standalone, or use the plugin with any compatible memory server.

## Quick Start

### 1. Install the Server (Docker)

```bash
curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-server.sh \
  | EMBEDDING_API_URL=https://api.openai.com/v1 \
    EMBEDDING_MODEL=text-embedding-3-small \
    EMBEDDING_API_KEY=sk-... \
    SERVER_API_KEY=my-secret \
    bash
```

### 2. Configure the Client Plugin

```bash
curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-client.sh \
  | OPENCODE_MEM_SERVER_URL=http://localhost:4747 \
    OPENCODE_MEM_API_KEY=my-secret \
    bash
```

Done. Start OpenCode and the plugin will connect automatically.

---

## Server Installation

### Prerequisites

- **Docker** (recommended) or **Bun** >= 1.x
- **PostgreSQL** 16+ with **pgvector** extension (included in Docker setup)
- **Embedding API**: Any OpenAI-compatible endpoint (e.g., text-embedding-3-small, voyage-3, or self-hosted)
- **Chat API**: OpenAI-compatible Chat Completions endpoint (optional, for auto-capture)

### Docker Compose (recommended)

1. **Clone the repository:**

```bash
git clone https://github.com/tickernelz/opencode-mem
cd opencode-memnet
```

2. **Create your `.env` file from the example:**

```bash
cp .env.example .env
```

3. **Edit `.env` and fill in the required values** (at minimum, these must be set):

```bash
# Required — the server will not start without these
SERVER_API_KEY=your-secret-key
EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

4. **Optionally enable auto-capture** (memory extraction from conversations):

```bash
# Required for auto-capture functionality
MEMORY_MODEL=gpt-4o-mini
MEMORY_API_URL=https://api.openai.com/v1
MEMORY_API_KEY=sk-...
```

5. **Start the services:**

```bash
docker compose up -d
```

The `.env.example` file contains **all** configurable environment variables with descriptions, defaults, and examples. Every variable has a sensible default — you only need to set the required ones listed above.

> **Tip:** For a minimal setup, your entire `.env` can be as short as:
>
> ```
> SERVER_API_KEY=my-secret-key
> EMBEDDING_API_URL=https://api.openai.com/v1
> EMBEDDING_MODEL=text-embedding-3-small
> EMBEDDING_API_KEY=sk-...
> POSTGRES_SSL=false
> ```

Server runs on **http://localhost:4747** — open the WebUI and enter your `SERVER_API_KEY` in the settings panel (gear icon).

### Manual (Bun)

```bash
git clone https://github.com/tickernelz/opencode-mem
cd opencode-memnet
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

### Environment Variables

#### Required

| Variable            | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `SERVER_API_KEY`    | API key for authenticating all requests               |
| `POSTGRES_URL`      | PostgreSQL connection string                          |
| `EMBEDDING_API_URL` | OpenAI-compatible embedding API base URL              |
| `EMBEDDING_MODEL`   | Embedding model name (e.g., `text-embedding-3-small`) |
| `EMBEDDING_API_KEY` | API key for the embedding service                     |

#### Optional

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

---

## Client Plugin Installation

### Automatic (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-client.sh \
  | OPENCODE_MEM_SERVER_URL=http://localhost:4747 \
    OPENCODE_MEM_API_KEY=my-secret \
    bash
```

This writes a config file to `~/.config/opencode/opencode-memnet.json`. The plugin will activate on next OpenCode session.

### Manual Configuration

Create `.opencode/opencode-memnet.jsonc` in your project root:

```jsonc
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "my-secret-key",
  "autoCaptureEnabled": true,
}
```

Or configure globally at `~/.config/opencode/opencode-memnet.jsonc`. Project config overrides global config.

### Plugin Configuration Options

| Field                               | Default                 | Description                                    |
| ----------------------------------- | ----------------------- | ---------------------------------------------- |
| `serverUrl`                         | `http://localhost:4747` | Server URL                                     |
| `apiKey`                            | —                       | API key (required)                             |
| `autoCaptureEnabled`                | `true`                  | Enable auto-capture from chat sessions         |
| `showAutoCaptureToasts`             | `true`                  | Show toast on auto-capture                     |
| `showErrorToasts`                   | `true`                  | Show error toasts                              |
| `chatMessage.enabled`               | `true`                  | Inject memory context on chat messages         |
| `chatMessage.maxMemories`           | `3`                     | Max memories in context injection              |
| `chatMessage.excludeCurrentSession` | `true`                  | Exclude current session from context           |
| `chatMessage.maxAgeDays`            | —                       | Max age in days for context memories           |
| `chatMessage.injectOn`              | `"first"`               | When to inject: `"first"` or `"always"`        |
| `memory.defaultScope`               | `"project"`             | Default scope: `"project"` or `"all-projects"` |

### Plugin Features

- **chat.message hook**: Injects relevant `[MEMORY]` context before each chat message
- **tool.memory**: Adds, searches, lists, and deletes memories via the memory tool
- **session.idle**: Fire-and-forget auto-capture to the server
- **session.compacted**: Restores session memory after context compaction
- **User profile**: View learned preferences and patterns

---

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

---

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

---

## User Profiles

Profiles are learned automatically from chat sessions:

- **Preferences**: Coding style, tool choices, architectural preferences (with confidence scores)
- **Patterns**: Repeated behaviors (TDD, commit conventions, review habits) with frequency counts
- **Workflows**: Multi-step processes the user follows
- **Changelog**: Versioned history of profile evolution

User identity is auto-detected from `git config user.email` in the project directory. Profiles are keyed by email — switching git identities switches profiles automatically.

---

## Development

### Prerequisites

- **Bun** >= 1.x

### Setup

```bash
bun install
cd plugin && bun install && cd ..
```

### Build

```bash
bun run build:all        # Build server + plugin
bun run build            # Build server only
bun run build:plugin     # Build plugin only
```

### Develop

```bash
bun run dev:server       # Server with hot reload
bun run typecheck:all    # Type-check everything
bun run typecheck        # Type-check server only
bun run typecheck:plugin # Type-check plugin only
```

### Test

```bash
bun test
```

### Directory Layout

```
opencode-memnet/
├── shared/          # Shared utilities (used by plugin only)
├── plugin/          # Client plugin — compiles independently
│   ├── src/         # Plugin source
│   └── dist/        # Bundled output (single .js file)
├── src/             # Server source
│   ├── services/    # Server services (storage, AI, etc.)
│   └── web/         # WebUI static files
├── scripts/         # Install scripts
├── Dockerfile       # Server Docker build
└── docker-compose.yml
```

### Plugin Bundle

The client plugin compiles to a single JS file (`plugin/dist/opencode-memnet.js`) that can be loaded directly by OpenCode without any server-side dependencies.

---

## Docker Deployment

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env — set SERVER_API_KEY, EMBEDDING_API_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY

# 2. Start all services
docker compose up -d

# 3. View logs
docker compose logs -f

# 4. Stop
docker compose down
```

See `.env.example` for the full list of configuration options with descriptions and defaults.

---

## License

MIT
