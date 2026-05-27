<p align="center">
  <img src="docs/logo/logo-banner.svg" alt="opencode MEMnet">
</p>

[![MIT License](https://img.shields.io/badge/license-MIT-blue)](https://git.phrk.org/pub/opencode-memnet) [![Version](https://img.shields.io/badge/version-3.0.0-green)](package.json)

Persistent memory for AI coding agents. AI assistants forget everything between sessions -- preferences, patterns, past decisions, project context. opencode-memnet gives them a long-term memory layer backed by semantic search, so every conversation picks up where the last one left off.

This project builds upon and would not exist without the original [OpenCode Memory](https://github.com/tickernelz/opencode-mem) by **tickernelz**. Thank you for creating and sharing this excellent work.

---

## Table of Contents

- [Quick Start](#quick-start)
- [What is opencode-memnet?](#what-is-opencode-memnet)
- [Architecture](#architecture)
- [Server Installation](#server-installation)
  - [Prerequisites](#prerequisites)
  - [Option 1: Docker Compose (Bundled Database)](#option-1-docker-compose-bundled-database)
  - [Option 2: Docker Compose (External Database)](#option-2-docker-compose-external-database)
  - [Option 3: Manual (Bun)](#option-3-manual-bun)
  - [Production Considerations](#production-considerations)
- [Client Plugin Installation](#client-plugin-installation)
  - [Option 1: Bun (Recommended)](#option-1-bun-recommended)
  - [Option 2: Manual Configuration](#option-2-manual-configuration)
- [Configuration Reference](#configuration-reference)
  - [Server Environment Variables](#server-environment-variables)
  - [Secret Management](#secret-management)
  - [Client Configuration File](#client-configuration-file)
- [API Reference](#api-reference)
- [WebUI](#webui)
- [User Profiles](#user-profiles)
- [Development](#development)
  - [Setup and Build](#setup-and-build)
  - [Project Structure](#project-structure)
  - [Testing and Linting](#testing-and-linting)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Quick Start

Get a working memory server and client plugin in a few minutes.

**1. Clone and start the server (Docker, bundled database):**

```bash
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet
cp .env.example .env
```

Edit `.env` — set at minimum:

```bash
SERVER_API_KEY=my-secret
EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

```bash
docker compose up -d
```

**2. Configure the client plugin:**

```bash
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode-memnet.jsonc << 'EOF'
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "my-secret",
}
EOF
```

**3. Verify it is running:**

```bash
curl http://localhost:4747/api/health
```

Done. Start OpenCode and the plugin will connect automatically.

---

## What is opencode-memnet?

**Problem:** AI coding agents have no memory across sessions. Every time you start a new conversation, the agent starts from scratch -- it does not know your coding style, past decisions, project conventions, or previous fixes.

**Solution:** opencode-memnet is a standalone memory server with a thin client plugin. It stores memories as vector embeddings in PostgreSQL with pgvector, enabling semantic search so the agent retrieves relevant context without exact keyword matches.

**Key features:**

- **Semantic memory storage** -- memories are embedded and searchable by meaning, not just keywords
- **Auto-capture** -- automatically extracts memories from conversation sessions using an LLM
- **Context injection** -- injects relevant memories into chat messages before the agent processes them
- **User profiles** -- learns coding preferences, patterns, and workflows over time
- **WebUI** -- browse, search, edit, and manage memories and profiles in a browser
- **Server + plugin architecture** -- server is independent of any specific AI tool; plugin is a thin client

---

## Architecture

![opencode-memnet Architecture](docs/diagrams/diagram-03.svg)

| Component         | Directory | Description                                                                     |
| ----------------- | --------- | ------------------------------------------------------------------------------- |
| **Server**        | `src/`    | Standalone Bun process serving REST API + WebUI, connected to Postgres/pgvector |
| **Client Plugin** | `plugin/` | Thin OpenCode plugin compiled to a single JS file, communicates via HTTP        |
| **Shared**        | `shared/` | Utilities used by the plugin (client config, tags, logging)                     |
| **Storage**       | Postgres  | pgvector extension for vector embeddings with HNSW indexing                     |
| **Embeddings**    | External  | Remote OpenAI-compatible API (configurable model and dimensions)                |
| **AI**            | External  | OpenAI Chat Completions API for memory extraction and profile learning          |

The server and client plugin are fully independent -- the server knows nothing about the plugin, and the plugin has no server-side dependencies. You can run the server standalone, or use the plugin with any compatible memory server.

---

## Server Installation

### Prerequisites

- **Docker** (recommended) or **Bun** >= 1.x
- **PostgreSQL** 16+ with **pgvector** extension (included in Docker bundled setup)
- **Embedding API**: Any OpenAI-compatible endpoint (e.g., OpenAI, Voyage, Ollama)
- **Chat API**: OpenAI-compatible Chat Completions endpoint (optional, for auto-capture)

### Option 1: Docker Compose (Bundled Database)

Spins up both the server and a pgvector Postgres container. Good for testing, local development, and simple deployments.

```bash
# 1. Clone the repository
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet

# 2. Create your .env file
cp .env.example .env

# 3. Edit .env — set at minimum the required variables:
#    SERVER_API_KEY, EMBEDDING_API_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY
```

Minimal `.env` for bundled Docker:

```bash
SERVER_API_KEY=my-secret-key
EMBEDDING_API_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
POSTGRES_SSL=false
```

Optionally enable auto-capture (memory extraction from conversations):

```bash
MEMORY_MODEL=gpt-4o-mini
MEMORY_API_URL=https://api.openai.com/v1
MEMORY_API_KEY=sk-...
```

```bash
# 4. Start all services
docker compose up -d

# 5. Verify
curl http://localhost:4747/api/health

# 6. View logs
docker compose logs -f

# 7. Stop
docker compose down
```

> **Note:** The bundled `docker-compose.yml` includes a `db` service running `pgvector/pgvector:pg16`. Data is stored in a Docker volume named `pgdata`. The bundled compose defaults `POSTGRES_SSL` to `false` since the database is local to the Docker network.

> **Warning:** `docker compose down -v` deletes the `pgdata` volume and all stored memories. Use `docker compose down` (without `-v`) to preserve data.

### Option 2: Docker Compose (External Database)

Uses an existing Postgres instance you manage separately (e.g., AWS RDS, Supabase, Neon, self-hosted). Better for production where you already have a managed database.

**Prerequisites:**

- Postgres 16+ with `pgvector` extension installed
- Database and user created; user is the database owner
- Run `CREATE EXTENSION IF NOT EXISTS vector` on the target database

```bash
# 1. Clone the repository
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet

# 2. Create your .env file
cp .env.example .env

# 3. Edit .env — set at minimum:
#    POSTGRES_URL=postgresql://user:password@your-db-host:5432/opencode_mem
#    POSTGRES_SSL=require
#    SERVER_API_KEY, EMBEDDING_API_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY
```

```bash
# 4. Start the server (no database container)
docker compose -f docker-compose.external-db.yml up -d

# 5. Verify
curl http://localhost:4747/api/health

# 6. View logs
docker compose -f docker-compose.external-db.yml logs -f

# 7. Stop
docker compose -f docker-compose.external-db.yml down
```

> **Tip:** With an external database, `POSTGRES_SSL` defaults to `require`. For local dev or non-TLS connections, set it to `false`.

### Option 3: Manual (Bun)

For non-Docker installations, or when running directly on the host.

```bash
# 1. Clone and install
git clone https://git.phrk.org/pub/opencode-memnet.git
cd opencode-memnet
bun install

# 2. Start PostgreSQL with pgvector
docker run -d --name pgvector \
  -e POSTGRES_USER=opencode \
  -e POSTGRES_PASSWORD=opencode \
  -e POSTGRES_DB=opencode_mem \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# 3. Start the server
SERVER_API_KEY=my-secret-key \
POSTGRES_URL=postgresql://opencode:opencode@localhost:5432/opencode_mem \
POSTGRES_SSL=false \
EMBEDDING_API_URL="https://api.openai.com/v1" \
EMBEDDING_MODEL="text-embedding-3-small" \
EMBEDDING_API_KEY="sk-..." \
bun run src/server.ts
```

### Production Considerations

**Reverse proxy and TLS:**

Place the server behind a reverse proxy (nginx, Caddy, Traefik) with TLS termination. Example Caddy configuration:

```
mem.example.com {
    reverse_proxy localhost:4747
}
```

**Restricting access to localhost:**

By default, the server binds to all interfaces. To restrict to localhost only, set `EXTERNAL_HOST`:

```bash
EXTERNAL_HOST=127.0.0.1
```

`HOST_PORT` is always just a port number (e.g., `4747`). The docker-compose port mapping uses `${EXTERNAL_HOST:-localhost}:${HOST_PORT:-4747}:${SERVER_PORT:-4747}`, so setting `EXTERNAL_HOST=127.0.0.1` binds the host-side port to localhost only. Set `EXTERNAL_HOST=0.0.0.0` to bind to all interfaces.

**Backups:**

Back up the PostgreSQL database regularly. With the bundled Docker setup:

```bash
docker compose exec db pg_dump -U opencode opencode_mem > backup.sql
```

For external databases, use your provider's backup tooling.

**Upgrade procedure:**

```bash
cd opencode-memnet
git pull --ff-only
docker compose up -d --build
```

The server runs database migrations automatically on startup.

> **Warning:** Never run `docker compose down -v` in production. The `-v` flag deletes the `pgdata` volume and all stored memories permanently.

**CORS:**

Set `WEB_SERVER_ALLOWED_ORIGIN` to your actual domain in production:

```bash
WEB_SERVER_ALLOWED_ORIGIN=https://mem.example.com
```

---

## Client Plugin Installation

The client plugin is distributed as a Bun package and compiles to a single JS file loaded by OpenCode.

### Option 1: Bun (Recommended)

Install the plugin globally so it is available in all projects:

```bash
bun add -g opencode-memnet-plugin
```

Then create the configuration file (see [Client Configuration File](#client-configuration-file) for all options):

```bash
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode-memnet.jsonc << 'EOF'
{
  "serverUrl": "http://localhost:4747",
  "apiKey": "my-secret-key",
}
EOF
```

### Option 2: Manual Configuration

Create the config file by hand. The recommended format is `.jsonc` (JSON with comments), but plain `.json` also works.

**Project-level** (takes precedence): `.opencode/opencode-memnet.jsonc` in your project root.

**Global:** `~/.config/opencode/opencode-memnet.jsonc`

Project config overrides global config. See [Client Configuration File](#client-configuration-file) for all fields.

---

## Configuration Reference

### Server Environment Variables

This section covers the most commonly used variables. The complete reference with all 38 variables, full descriptions, defaults, and examples is in [.env.example](.env.example).

#### Required Variables

These must be set before the server will start.

| Variable            | Description                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER_API_KEY`    | API key for authenticating all `/api/*` requests (Bearer token). Optional if both `DISABLE_WEBUI_AUTH` and `DISABLE_CLIENT_AUTH` are `true` |
| `POSTGRES_URL`      | PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/db`)                                                                  |
| `EMBEDDING_API_URL` | OpenAI-compatible embedding API base URL                                                                                                    |
| `EMBEDDING_MODEL`   | Embedding model name (e.g., `text-embedding-3-small`)                                                                                       |
| `EMBEDDING_API_KEY` | API key for the embedding service (falls back to `OPENAI_API_KEY`)                                                                          |

#### Optional Variables

| Variable                    | Default     | Description                                                                                                   |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `EXTERNAL_HOST`             | `localhost` | IP/hostname the Docker port binds to. Set to `127.0.0.1` for localhost-only, `0.0.0.0` for all interfaces     |
| `HOST_PORT`                 | `4747`      | Host-side port number for Docker. Ignored when running outside Docker                                         |
| `SERVER_PORT`               | `4747`      | Port the server listens on inside the container                                                               |
| `SERVER_HOST`               | `0.0.0.0`   | Network interface the server binds to inside the container                                                    |
| `POSTGRES_SSL`              | `require`   | SSL mode. Bundled Docker defaults to `false`; external DB defaults to `require`                               |
| `POSTGRES_MAX_CONNECTIONS`  | `10`        | Connection pool size                                                                                          |
| `POSTGRES_VECTOR_TYPE`      | `vector`    | pgvector column type: `vector` or `halfvec`                                                                   |
| `SIMILARITY_THRESHOLD`      | `0.6`       | Minimum cosine similarity for search results (0.0--1.0)                                                       |
| `MAX_MEMORIES`              | `10`        | Max memories returned in context injection                                                                    |
| `INJECT_PROFILE`            | `true`      | Include learned user profile in context injection                                                             |
| `MEMORY_MODEL`              | --          | Chat model for memory extraction (required for auto-capture)                                                  |
| `MEMORY_API_URL`            | --          | Chat completions API URL (required for auto-capture)                                                          |
| `MEMORY_API_KEY`            | --          | API key for chat completions (required for auto-capture)                                                      |
| `MEMORY_TEMPERATURE`        | `0.3`       | Temperature for memory generation (set to `false` to disable)                                                 |
| `WEB_SERVER_ALLOWED_ORIGIN` | `*`         | CORS allowed origin                                                                                           |
| `DISABLE_WEBUI_AUTH`        | `false`     | Disable API key auth for WebUI. **WARNING:** Secure the server by other means (reverse proxy, firewall, etc.) |
| `DISABLE_CLIENT_AUTH`       | `false`     | Disable API key auth for client plugin. **WARNING:** Secure the server by other means                         |
| `LOG_LEVEL`                 | `info`      | Console log level: `debug`, `info`, `warn`, `error`. File logs are always verbose                             |
| `DEBUG`                     | `false`     | Shortcut for `LOG_LEVEL=debug`. Set to `true` or `1` for verbose console output                               |

#### Advanced Variables

| Variable                             | Default       | Description                                                            |
| ------------------------------------ | ------------- | ---------------------------------------------------------------------- |
| `POSTGRES_IDLE_TIMEOUT_SECONDS`      | `30`          | Idle connection timeout                                                |
| `POSTGRES_CONNECT_TIMEOUT_SECONDS`   | `10`          | Connection establishment timeout                                       |
| `POSTGRES_HNSW_EF_SEARCH`            | `128`         | HNSW index search parameter (higher = better recall, slower)           |
| `POSTGRES_HNSW_EF_CONSTRUCTION`      | `256`         | HNSW index build parameter (higher = better quality, slower build)     |
| `EMBEDDING_DIMENSIONS`               | auto          | Override embedding vector dimensions (0 = auto-detect from model name) |
| `EMBEDDING_MAX_TOKENS_CONTENT`       | `2048`        | Max tokens for content text before embedding                           |
| `EMBEDDING_MAX_TOKENS_TAGS`          | `256`         | Max tokens for tag text before embedding                               |
| `EMBEDDING_MAX_TOKENS_QUERY`         | `512`         | Max tokens for search queries before embedding                         |
| `EMBEDDING_MAX_TOKENS_MIGRATION`     | `512`         | Max tokens for tag migration embeddings                                |
| `EMBEDDING_TRUNCATION_CONTENT`       | `throw_error` | Truncation strategy for content (`throw_error` or `truncate`)          |
| `EMBEDDING_TRUNCATION_TAGS`          | `throw_error` | Truncation strategy for tags (`throw_error` or `truncate`)             |
| `EMBEDDING_TRUNCATION_QUERY`         | `throw_error` | Truncation strategy for queries (`throw_error` or `truncate`)          |
| `EMBEDDING_TRUNCATION_MIGRATION`     | `throw_error` | Truncation strategy for tag migration (`throw_error` or `truncate`)    |
| `OPENCODE_PROVIDER`                  | --            | LLM provider for OpenCode integration                                  |
| `OPENCODE_MODEL`                     | --            | LLM model for OpenCode integration                                     |
| `AUTO_CAPTURE_MAX_ITERATIONS`        | `5`           | Max auto-capture iterations per session                                |
| `AUTO_CAPTURE_ITERATION_TIMEOUT`     | `30000`       | Auto-capture timeout in milliseconds                                   |
| `AUTO_CAPTURE_LANGUAGE`              | `auto`        | Language for generated memories (e.g., `en`, `zh`, `auto`)             |
| `AI_SESSION_RETENTION_DAYS`          | `7`           | Days to retain AI session data                                         |
| `AUTO_CLEANUP_RETENTION_DAYS`        | `90`          | Days to retain memories (0 = disable auto-cleanup)                     |
| `USER_PROFILE_ANALYSIS_INTERVAL`     | `10`          | Sessions between automatic profile analysis                            |
| `USER_PROFILE_MAX_PREFERENCES`       | `20`          | Max learned preferences per profile                                    |
| `USER_PROFILE_MAX_PATTERNS`          | `15`          | Max detected patterns per profile                                      |
| `USER_PROFILE_MAX_WORKFLOWS`         | `10`          | Max identified workflows per profile                                   |
| `USER_PROFILE_CONFIDENCE_DECAY_DAYS` | `30`          | Days over which confidence scores decay                                |
| `USER_PROFILE_CHANGELOG_RETENTION`   | `5`           | Profile changelog versions to retain                                   |

> **Tip:** Docker Compose database variables (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`) configure the bundled `db` service only and are not read by the server itself. See [.env.example](.env.example) for details.

### Secret Management

API key variables (`EMBEDDING_API_KEY`, `MEMORY_API_KEY`) support special prefixes for secure secret handling:

| Prefix          | Example                             | Behavior                                        |
| --------------- | ----------------------------------- | ----------------------------------------------- |
| _(plain value)_ | `sk-abc123...`                      | Used directly                                   |
| `file://`       | `file:///run/secrets/embedding_key` | Reads the contents of the file                  |
| `env://`        | `env://MY_EMBEDDING_KEY`            | Reads the value of another environment variable |

This is useful with Docker Secrets, Kubernetes Secrets, or any external secret management system.

```bash
# Docker Secrets example
EMBEDDING_API_KEY=file:///run/secrets/embedding_api_key
MEMORY_API_KEY=file:///run/secrets/memory_api_key
```

### Client Configuration File

The client plugin reads from `.jsonc` (recommended) or `.json` files. It checks two locations in order -- project config overrides global config.

**Global:** `~/.config/opencode/opencode-memnet.jsonc`
**Project:** `.opencode/opencode-memnet.jsonc` (in the project root)

Full configuration with defaults:

```jsonc
{
  // Server connection (required)
  "serverUrl": "http://localhost:4747",
  "apiKey": "my-secret-key",

  // Auto-capture
  "autoCaptureEnabled": true,
  "showAutoCaptureToasts": true,
  "showErrorToasts": true,

  // Chat message context injection
  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "maxAgeDays": null,
    "injectOn": "first", // "first" = first message only, "always" = every message
  },

  // Default memory scope
  "memory": {
    "defaultScope": "project", // "project" or "all-projects"
  },

  // Logging (optional)
  "logLevel": "info", // "debug", "info", "warn", "error"
}
```

| Field                               | Default                 | Description                                    |
| ----------------------------------- | ----------------------- | ---------------------------------------------- |
| `serverUrl`                         | `http://localhost:4747` | Server URL                                     |
| `apiKey`                            | --                      | API key (required)                             |
| `autoCaptureEnabled`                | `true`                  | Enable auto-capture from chat sessions         |
| `showAutoCaptureToasts`             | `true`                  | Show toast on auto-capture                     |
| `showErrorToasts`                   | `true`                  | Show error toasts                              |
| `chatMessage.enabled`               | `true`                  | Inject memory context on chat messages         |
| `chatMessage.maxMemories`           | `3`                     | Max memories in context injection              |
| `chatMessage.excludeCurrentSession` | `true`                  | Exclude current session from context           |
| `chatMessage.maxAgeDays`            | --                      | Max age in days for context memories           |
| `chatMessage.injectOn`              | `"first"`               | When to inject: `"first"` or `"always"`        |
| `memory.defaultScope`               | `"project"`             | Default scope: `"project"` or `"all-projects"` |
| `logLevel`                          | `info`                  | Log level: `debug`, `info`, `warn`, `error`    |

---

## API Reference

All `/api/*` endpoints (except health) require authentication via the `Authorization` header, unless authentication is disabled via `DISABLE_WEBUI_AUTH` and/or `DISABLE_CLIENT_AUTH`:

```
Authorization: Bearer <SERVER_API_KEY>
```

When `DISABLE_WEBUI_AUTH=true` and `DISABLE_CLIENT_AUTH=true`, no API key is needed and all endpoints are accessible without authentication. **Only use this when the server is secured by other means** (reverse proxy, firewall, VPN, network isolation).

### Health

| Method | Path          | Auth | Description                                                  |
| ------ | ------------- | ---- | ------------------------------------------------------------ |
| `GET`  | `/api/health` | No   | Server health check (db status, embedding readiness, uptime) |

```bash
curl http://localhost:4747/api/health
```

### Memories

| Method   | Path                        | Description                                                                               |
| -------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| `GET`    | `/api/memories`             | List memories (query: `?tag=`, `?page=`, `?pageSize=`, `?userEmail=`, `?includePrompts=`) |
| `POST`   | `/api/memories`             | Add a memory                                                                              |
| `PUT`    | `/api/memories/:id`         | Update a memory                                                                           |
| `DELETE` | `/api/memories/:id`         | Delete a memory                                                                           |
| `POST`   | `/api/memories/bulk-delete` | Bulk delete memories                                                                      |
| `POST`   | `/api/memories/:id/pin`     | Pin a memory                                                                              |
| `POST`   | `/api/memories/:id/unpin`   | Unpin a memory                                                                            |

### Search and Context

| Method | Path                  | Description                                                          |
| ------ | --------------------- | -------------------------------------------------------------------- |
| `GET`  | `/api/search`         | Semantic search (query: `?q=`, `?tag=`, `?pageSize=`, `?userEmail=`) |
| `POST` | `/api/context/inject` | Context injection for chat messages                                  |
| `POST` | `/api/auto-capture`   | Server-side auto-capture from conversation data                      |

### User Profiles

| Method | Path                          | Description                            |
| ------ | ----------------------------- | -------------------------------------- |
| `GET`  | `/api/user-profile`           | Get active profile (query: `?userId=`) |
| `GET`  | `/api/user-profiles`          | List all active profiles               |
| `POST` | `/api/user-profile/learn`     | Trigger profile learning               |
| `POST` | `/api/user-profile/refresh`   | Refresh profile data                   |
| `GET`  | `/api/user-profile/changelog` | Profile version history                |
| `GET`  | `/api/user-profile/snapshot`  | Profile snapshot at a specific version |

### Tags and Stats

| Method | Path         | Description                                  |
| ------ | ------------ | -------------------------------------------- |
| `GET`  | `/api/tags`  | List distinct project tags                   |
| `GET`  | `/api/stats` | Memory statistics (total, by scope, by type) |

---

## WebUI

A management interface served at `/` with:

- **Memory list** -- view, search, edit, delete, and bulk-delete memories
- **Add memory form** -- create new memories with tags and type classification
- **User profile viewer** -- preferences, patterns, workflows, and changelog history
- **Profile switcher** -- dropdown to manage multiple user profiles from one UI
- **Settings panel** -- gear icon for API key and profile selection
- **Tag filtering** -- filter memories by project tag
- **Pagination** -- browse large memory sets
- **i18n** -- English and Chinese language support
- **Migration tools** -- tag migration and dimension migration workflows

Open `http://localhost:4747` in your browser. If authentication is enabled (default), enter your `SERVER_API_KEY` in the settings panel (gear icon). If `DISABLE_WEBUI_AUTH=true`, the WebUI loads automatically without requiring an API key.

---

## User Profiles

Profiles are learned automatically from chat sessions over time:

- **Preferences** -- coding style, tool choices, architectural preferences (with confidence scores)
- **Patterns** -- repeated behaviors such as TDD, commit conventions, review habits (with frequency counts)
- **Workflows** -- multi-step processes the user follows
- **Changelog** -- versioned history of profile evolution

User identity is auto-detected from `git config user.email` in the project directory. Profiles are keyed by email -- switching git identities switches profiles automatically.

---

## Development

### Setup and Build

```bash
# Install dependencies (server + plugin)
bun install
cd plugin && bun install && cd ..

# Build everything
bun run build:all

# Build server only
bun run build

# Build plugin only
bun run build:plugin
```

### Project Structure

```
opencode-memnet/
├── shared/                    # Shared utilities (used by plugin only)
│   └── client-config.ts       # Client config loading and types
├── plugin/                    # Client plugin -- compiles independently
│   ├── src/                   # Plugin source
│   └── dist/                  # Bundled output (single .js file)
├── src/                       # Server source
│   ├── server.ts              # Server entry point
│   ├── server-config.ts       # Server config validation
│   ├── services/              # Server services (storage, AI, etc.)
│   │   └── storage/
│   │       └── postgres/
│   │           └── migrations.ts  # Database schema migrations
│   └── web/                   # WebUI static files
├── scripts/                   # Install scripts
│   ├── install-server.sh      # Server installer (curl | bash)
│   └── install-client.sh      # Client config installer
├── Dockerfile                 # Server Docker build (oven/bun)
├── docker-compose.yml         # Bundled server + database
├── docker-compose.external-db.yml  # Server with external database
└── package.json
```

### Testing and Linting

```bash
# Run tests
bun test

# Type-check everything
bun run typecheck:all
bun run typecheck            # Server only
bun run typecheck:plugin     # Plugin only

# Format code
bun run format               # Auto-format with Prettier
bun run format:check         # Check formatting without writing

# Development server with hot reload
bun run dev:server
```

### Plugin Bundle

The client plugin compiles to a single JS file (`plugin/dist/opencode-memnet.js`) that can be loaded directly by OpenCode without any server-side dependencies.

---

## Troubleshooting

### Server will not start -- "POSTGRES_URL is required"

The `POSTGRES_URL` environment variable is empty or not set. For the bundled Docker setup, the compose file provides a default. For external databases, you must set it explicitly:

```bash
POSTGRES_URL=postgresql://user:password@your-host:5432/opencode_mem
```

### Server will not start -- "EMBEDDING_API_KEY is required"

Set `EMBEDDING_API_KEY` to your API key, or set `OPENAI_API_KEY` as a fallback. The server will not start without at least one of these.

### "SSL required" or "SSL error" connecting to Postgres

The default `POSTGRES_SSL` value is `require`. For local Docker development (bundled database), set it to `false`:

```bash
POSTGRES_SSL=false
```

The bundled `docker-compose.yml` handles this automatically. If you see this error with an external database, verify your database supports SSL or set the value accordingly.

### Health check returns an error

```bash
curl http://localhost:4747/api/health
```

If this fails:

1. Check the container is running: `docker compose ps`
2. Check logs: `docker compose logs -f`
3. Verify the port is not in use: `ss -tlnp | grep 4747`
4. If using `EXTERNAL_HOST=127.0.0.1`, ensure you are curling from the same machine

### Client plugin does not activate

1. Verify the config file exists at `~/.config/opencode/opencode-memnet.jsonc` (global) or `.opencode/opencode-memnet.jsonc` (project)
2. Verify `apiKey` and `serverUrl` are set and correct
3. Verify the server is reachable from the client machine: `curl http://your-server:4747/api/health`
4. Check that the plugin is installed: `bun pm ls -g` or `npm ls -g opencode-memnet-plugin`

### "Cannot connect to server" from the plugin

1. Check that the server is running: `curl http://your-server:4747/api/health`
2. If the server is on a remote machine, ensure the port is open and `EXTERNAL_HOST` allows external access (use `EXTERNAL_HOST=0.0.0.0` or a specific IP, not `127.0.0.1`)
3. Verify `OPENCODE_MEM_SERVER_URL` or `serverUrl` in the config matches the actual server address

### Docker compose build fails

Ensure you are using Docker with BuildKit support. The Dockerfile uses multi-stage builds:

```bash
docker compose build --no-cache
```

If Bun install fails, check your network connection and any proxy settings.

### Enable debug logging

For more visibility into server or plugin operations:

**Server** — set in `.env` or Docker environment:

```bash
LOG_LEVEL=debug
# or shorthand:
DEBUG=true
```

**Plugin** — add to `opencode-memnet.jsonc`:

```jsonc
{
  "logLevel": "debug",
}
```

Debug output includes hook invocations, tool calls, context injection details, and error stack traces. File logs (`~/.opencode-memnet/opencode-memnet.log`) always capture all levels regardless of the console setting.

### Memories are not being created

1. Verify auto-capture is enabled: `MEMORY_MODEL`, `MEMORY_API_URL`, and `MEMORY_API_KEY` must all be set
2. Check the server logs for errors from the memory extraction LLM calls
3. Verify the embedding API is reachable and the API key is valid
4. Check that the client plugin has `autoCaptureEnabled: true` in its config

---

## License

MIT
