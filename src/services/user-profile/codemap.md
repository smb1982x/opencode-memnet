# src/services/user-profile/

## Responsibility

This folder owns **user profile persistence, retrieval, and rendering**. It stores learned preferences, behavioral patterns, and workflows extracted from user interactions (prompts). It is the write/replay side of the user-modeling pipeline:

- **Types** — Schema definitions for profile data and changelog entries.
- **Manager** — SQLite-backed CRUD for profiles, versioning via changelogs, confidence decay, and merge logic.
- **Utils** — Resilient deserialization helpers (`safeArray`, `safeObject`) that guard against malformed input.
- **Context** — Renders a compact Markdown string of the active profile for injection into system prompts.

## Design Patterns

### Active-Profile Singleton (`user-profile-manager.ts:387`)
A single `UserProfileManager` instance is exported as `userProfileManager`. The class is concrete (not interface-based) and owned directly by the module. Callers in the rest of the system import this singleton rather than instantiating their own.

### Row-Mapper Pattern (`user-profile-manager.ts:256–282`)
Private methods `rowToProfile()` and `rowToChangelog()` map raw SQLite rows (typed as `any`) to the public `UserProfile` / `UserProfileChangelog` interfaces. SQL columns use snake_case; the mapped objects use camelCase. This keeps DB schema changes isolated to these two methods.

### Self-Healing Deserialization (`profile-utils.ts`)
`safeArray` and `safeObject` are defensive parsers that accept strings, arrays, objects, or falsy values. They flatten nested arrays and recover from trailing-comma JSON. These are used at every persistence boundary to ensure malformed data never propagates.

### Merge-on-Write (`user-profile-manager.ts:284–371`)
`mergeProfileData()` implements an upsert-by-key strategy:
- **Preferences** — matched on `(category, description)`; existing entries get a confidence boost (`+0.1`, capped at `1.0`), evidence is unioned (max 5 items), and `lastUpdated` is refreshed. New entries are appended.
- **Patterns** — matched on `(category, description)`; existing entries increment `frequency`. New entries start at `frequency=1`.
- **Workflows** — matched on `description`; existing entries increment `frequency`. New entries start at `frequency=1`.

All three arrays are **sorted descending** (by confidence/frequency) and **capped** via `CONFIG.userProfileMax{Preferences,Patterns,Workflows}`.

### Versioned Changelog (`user-profile-manager.ts:161–197`)
Every `createProfile` and `updateProfile` call appends a row to `user_profile_changelogs` with a full `profile_data_snapshot` (JSON). Old entries are pruned after write using `CONFIG.userProfileChangelogRetentionCount` (default: 5), keeping only the most recent N versions.

### Confidence Decay (`user-profile-manager.ts:211–236`)
`applyConfidenceDecay()` ages preference confidence linearly: preferences older than `CONFIG.userProfileConfidenceDecayDays` (default: 30) are decayed by `max(0.5, 1 - (age - threshold) / threshold)`. Preferences falling below `0.3` confidence are removed. Changes trigger an `updateProfile` call.

## Data & Control Flow

### State / Schema

**Table: `user_profiles`**
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Generated `profile_{timestamp}_{random}` |
| `user_id` | TEXT UNIQUE | External user identifier |
| `display_name` / `user_name` / `user_email` | TEXT | Identity fields |
| `profile_data` | TEXT (JSON) | Serialized `UserProfileData` |
| `version` | INTEGER | Starts at 1, incremented on each update |
| `created_at` / `last_analyzed_at` | INTEGER | Unix ms timestamps |
| `total_prompts_analyzed` | INTEGER | Accumulated counter |
| `is_active` | BOOLEAN | Soft-delete flag; default 1 |

**Table: `user_profile_changelogs`**
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Generated `changelog_{timestamp}_{random}` |
| `profile_id` | TEXT FK → `user_profiles.id` CASCADE |
| `version` | INTEGER | Monotonic, matches profile version |
| `change_type` | TEXT | `"create"` or `"update"` |
| `change_summary` | TEXT | Human-readable description of what changed |
| `profile_data_snapshot` | TEXT (JSON) | Full snapshot at that version |
| `created_at` | INTEGER | Unix ms |

**Indexes** (`user-profile-manager.ts:53–62`): `user_id`, `is_active`, `changelogs(profile_id)`, `changelogs(version DESC)`.

### Data Flow

```
External caller
  │
  ├─► createProfile(userId, displayName, ...)
  │     ├─ Generates id, timestamps
  │     ├─ Cleans profileData through safeArray/safeObject
  │     ├─ INSERT INTO user_profiles (version=1)
  │     └─ addChangelog("create")
  │
  ├─► updateProfile(profileId, newData, additionalPrompts, summary)
  │     ├─ Fetches current version, increments
  │     ├─ Cleans profileData
  │     ├─ UPDATE user_profiles (new version, data, timestamp)
  │     ├─ addChangelog("update")
  │     └─ cleanupOldChangelogs (prune beyond retention)
  │
  ├─► mergeProfileData(existing, updates) ← pure data transform
  │     └─ Used by callers *before* updateProfile/createProfile
  │
  ├─► applyConfidenceDecay(profileId)
  │     ├─ Loads profile, parses profileData
  │     ├─ Decays old preference confidences
  │     ├─ Filters below 0.3
  │     └─ Calls updateProfile if any change
  │
  ├─► getActiveProfile(userId) → UserProfile | null
  ├─► getProfileById(profileId) → UserProfile | null
  ├─► getAllActiveProfiles() → UserProfile[]
  ├─► getProfileChangelogs(profileId, limit) → UserProfileChangelog[]
  └─► deleteProfile(profileId) → DELETE cascade
```

### Context Rendering Flow (`profile-context.ts`)

```
getUserProfileContext(userId)
  │
  ├─ getActiveProfile(userId)
  │
  ├─ Parse profileData JSON
  │
  ├─ Build Markdown parts:
  │     User Preferences:   top 5 by confidence
  │     User Patterns:      top 5 by frequency
  │     User Workflows:     top 3 by frequency
  │
  └─ Return joined string or null (if empty profile)
```

Example rendered output:
```
User Preferences:
- [code-style] Prefers semicolons
- [testing] Enjoys TDD

User Patterns:
- [architecture] Often reaches for hexagonal architecture

User Workflows:
- Starts with tests, then implements
```

## Integration Points

### Configuration (`src/config.ts`)
| Key | Default | Used By |
|---|---|---|
| `storagePath` | `~/.opencode-mem/data` | DB file location: `{storagePath}/user-profiles.db` |
| `userProfileAnalysisInterval` | `10` | External — caller in `user-memory-learning.ts` |
| `userProfileMaxPreferences` | `20` | Cap in `mergeProfileData` |
| `userProfileMaxPatterns` | `15` | Cap in `mergeProfileData` |
| `userProfileMaxWorkflows` | `10` | Cap in `mergeProfileData` |
| `userProfileConfidenceDecayDays` | `30` | Threshold in `applyConfidenceDecay` |
| `userProfileChangelogRetentionCount` | `5` | Max changelog entries kept per profile |

### Callers

1. **`src/services/user-memory-learning.ts`** (primary consumer)
   - Checks `CONFIG.userProfileAnalysisInterval` to decide when to analyze.
   - Calls `getActiveProfile(userId)`, `createProfile(...)`, `updateProfile(...)`.
   - Calls `mergeProfileData()` to fold extracted preferences/patterns/workflows into existing data.
   - Provides the analysis logic that *produces* `UserProfileData`.

2. **`src/services/api-handlers.ts`** (REST/HTTP handlers)
   - Dynamic imports `userProfileManager` for API routes:
     - `GET /api/user-profile/:userId` → `getActiveProfile()`
     - `GET /api/user-profile-changelogs/:profileId` → `getProfileChangelogs()`
     - `GET /api/user-profile-changelogs` → `getProfileChangelogs("", 1000)`

3. **`src/index.ts`** (main CLI entry point)
   - On each user interaction, calls `getActiveProfile()`, `mergeProfileData()`, `createProfile()` / `updateProfile()` inline (legacy path, parallels the `user-memory-learning` flow).

4. **`src/services/user-profile/profile-context.ts`** (internal)
   - Exposes `getUserProfileContext(userId)` — called by the system prompt assembler to inject profile context into the LLM query.

### External Dependencies

- **`../sqlite/sqlite-bootstrap`** — provides `getDatabase()` (better-sqlite3 or compatible).
- **`../sqlite/connection-manager`** — manages SQLite connection lifecycle and deduplication.
- **`../../config`** — all `CONFIG.userProfile*` values and `CONFIG.storagePath`.

### Extensibility Notes

- To add a new profile dimension (e.g., "biases"), one would:
  1. Add a new array field to `UserProfileData` in `types.ts`.
  2. Add corresponding cap config in `config.ts`.
  3. Extend `mergeProfileData()` with upsert logic.
  4. Extend `getUserProfileContext()` to render it.
  5. Add analysis logic in `user-memory-learning.ts`.
- The changelog system already snapshots full `profileData`, so any new dimension is automatically versioned.
