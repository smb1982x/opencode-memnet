# src/services/user-prompt/

## Responsibility

The `user-prompt` service owns **prompt persistence and the capture queue** — a durable SQLite-backed work queue that records every user chat message and coordinates two downstream consumers that process it.

**Key responsibilities:**

1. **Capture — write path (index.ts:148–160)**  
   Every `chat.message` hook invocation saves the user's text content into the `user_prompts` table alongside session/message IDs and the project path. This is the single entry point into the queue.

2. **Queue management — `UserPromptManager`**  
   Provides an optimistic-claim pattern (`captured` column: `0=queued`, `2=claimed/in-progress`, `1=done`) plus batch operations for marking prompts as consumed. Also supports a parallel `user_learning_captured` flag for the user-profile pipeline.

3. **Search & retrieval — `UserPromptManager`**  
   Exposes `getCapturedPrompts()`, `searchPrompts()`, and `getPromptsByIds()` for the timeline/search API.

## Design Patterns

### Optimistic Claim (locked-free work queue)

The `captured` column in SQLite is a tri-state enum (`0=queued → 2=claimed → 1=done`):

- **`savePrompt()`** inserts with `captured = 0`.
- **`claimPrompt(id)`** atomically sets `captured = 2 WHERE captured = 0` via a single SQL UPDATE. A `changes > 0` check tells the caller whether it won the claim. This avoids a distributed lock — multiple processes or concurrent calls can race safely.
- If the consumer completes successfully, **`markAsCaptured()`** sets `captured = 1`. On failure or skip, **`deletePrompt()`** removes the row entirely.
- **`initDatabase()`** resets any rows left at `captured = 2` back to `0` on startup, cleaning up stale claims from a crash/restart.

### Two independent flag dimensions

Rows carry two orthogonal "processed" booleans:

| Column | Purpose | Consumer |
|---|---|---|
| `captured` | Tri-state: 0=queued, 2=claimed, 1=done | `auto-capture.ts` (memory persistence) |
| `user_learning_captured` | Binary: 0=not analyzed, 1=analyzed | `user-memory-learning.ts` (user profile) |

This allows both consumers to operate independently on the same row — auto-capture may mark `captured=1` while `user_learning_captured` remains `0`, and vice versa.

### Repository-style access

`UserPromptManager` wraps a dedicated SQLite database (`user-prompts.db`) behind method-named operations. It maps between snake_case SQL columns and camelCase TS interfaces (`rowToPrompt()`).

## Data & Control Flow

### Write path (entry)
```
chat.message hook (index.ts:148)
  └─ userPromptManager.savePrompt(sessionId, messageId, projectPath, content)
       └─ INSERT INTO user_prompts (…, captured=0)
```

### Consumer 1: Auto-capture (memory persistence)
```
performAutoCapture() (auto-capture.ts:17)
  ├─ userPromptManager.getLastUncapturedPrompt(sessionID)
  │    └─ SELECT … WHERE session_id=? AND captured=0 ORDER BY created_at DESC LIMIT 1
  ├─ userPromptManager.claimPrompt(prompt.id)
  │    └─ UPDATE user_prompts SET captured=2 WHERE id=? AND captured=0
  │         └─ (returns false if another instance already claimed)
  ├─ [AI summary generation via provider/opencode-provider]
  ├─ if (skip / non-technical):
  │    └─ userPromptManager.deletePrompt(prompt.id)
  ├─ if (success):
  │    ├─ memoryClient.addMemory(…, { promptId: prompt.id, … })
  │    ├─ userPromptManager.linkMemoryToPrompt(prompt.id, result.id)
  │    └─ userPromptManager.markAsCaptured(prompt.id)
  │         └─ UPDATE user_prompts SET captured=1 WHERE id=?
```

### Consumer 2: User-profile learning
```
performUserProfileLearning() (user-memory-learning.ts:12)
  ├─ userPromptManager.countUnanalyzedForUserLearning()
  │    └─ SELECT COUNT(*) … WHERE user_learning_captured=0
  ├─ [if count < threshold → return early]
  ├─ userPromptManager.getPromptsForUserLearning(threshold)
  │    └─ SELECT … WHERE user_learning_captured=0 ORDER BY created_at ASC LIMIT ?
  ├─ [AI profile analysis via provider/opencode-provider]
  ├─ userPromptManager.markMultipleAsUserLearningCaptured(promptIds)
  │    └─ UPDATE user_prompts SET user_learning_captured=1 WHERE id IN (…)
```

### Cleanup / retention
```
CleanupService.runCleanup() (cleanup-service.ts:35)
  └─ userPromptManager.deleteOldPrompts(cutoffTime)
       ├─ SELECT linked_memory_id FROM user_prompts WHERE created_at <? AND linked IS NOT NULL
       ├─ DELETE FROM user_prompts WHERE created_at < ?
       └─ returns { deleted, linkedMemoryIds }
           → linkedMemoryIds are excluded from memory-level deletion
```

### API query paths
```
handleGetTimeline()      → userPromptManager.getCapturedPrompts(projectPath)
handleSearch()           → userPromptManager.searchPrompts(query, projectPath, limit)
handleGetMemory()        → userPromptManager.getPromptsByIds(missingPromptIds)
handleGetPrompt()        → userPromptManager.getPromptById(id)
handleDeletePrompt()     → userPromptManager.deletePrompt(id) [optional cascade to memory]
handleRefreshProfile()   → userPromptManager.countUnanalyzedForUserLearning()
```

### Database indexes

| Name | Column(s) | Supports |
|---|---|---|
| `idx_user_prompts_session` | `session_id` | `getLastUncapturedPrompt` |
| `idx_user_prompts_captured` | `captured` | Queue queries (`captured=0`) |
| `idx_user_prompts_created` | `created_at DESC` | Ordering, cleanup |
| `idx_user_prompts_project` | `project_path` | `getCapturedPrompts(projectPath)` |
| `idx_user_prompts_linked` | `linked_memory_id` | Cleanup join |
| `idx_user_prompts_user_learning` | `user_learning_captured` | User-learning queries |

## Integration Points

| Consumer / Caller | File | What it does |
|---|---|---|
| `index.ts` | `src/index.ts:160` | **Producer** — saves prompts on `chat.message` hook |
| `performAutoCapture()` | `src/services/auto-capture.ts` | Consumer 1 — claims uncaptured prompt, generates memory via AI, marks done |
| `performUserProfileLearning()` | `src/services/user-memory-learning.ts` | Consumer 2 — reads unanalyzed prompts batch, updates user profile via AI |
| `CleanupService` | `src/services/cleanup-service.ts` | Cleanup — deletes old prompts, protects linked memories |
| `api-handlers.ts` | `src/services/api-handlers.ts` | Read/delete API — timeline, search, prompt CRUD, profile status |
| **Database** | `src/services/sqlite/` via `connectionManager` | SQLite persistence in a dedicated `user-prompts.db` file under `CONFIG.storagePath` |
| **Config** | `src/config.ts` | `CONFIG.storagePath` (DB location), `CONFIG.userProfileAnalysisInterval` (learning threshold) |

The module has no internal sub-modules beyond the single `user-prompt-manager.ts` file. It is imported as a singleton (`userPromptManager`) by five consumers.
