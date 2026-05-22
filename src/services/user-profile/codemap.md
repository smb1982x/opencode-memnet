# src/services/user-profile/

## Responsibility

Defines the data types and utility functions for user profile management — modeling stored preferences, behavioral patterns, and workflow data, plus safe parsing helpers for coercing untrusted/serialized values into well-typed structures.

## Design

- **Typed data model** (`types.ts`): Five interfaces form a layered profile schema:
  - `UserProfile` — top-level persisted entity (metadata + raw `profileData` JSON string).
  - `UserProfileData` — structured payload inside `profileData`, grouping preferences, patterns, and workflows.
  - `UserProfilePreference`, `UserProfilePattern`, `UserProfileWorkflow` — atomic profile traits.
  - `UserProfileChangelog` — versioned audit trail for profile mutations.
- **Defensive parsing utilities** (`profile-utils.ts`): Generic `safeArray` and `safeObject` coerce `any` values (often JSON strings from storage) into typed arrays/objects with fallback defaults. Handles nested arrays, malformed JSON, and edge cases without throwing.

## Flow

1. Raw profile data is loaded from storage as `UserProfile` (with `profileData` as an opaque string).
2. `safeObject` / `safeArray` parse and validate the string into typed `UserProfileData` structures.
3. Callers consume typed arrays of preferences, patterns, and workflows.
4. Mutations produce `UserProfileChangelog` entries to track versioned changes.

## Integration

- Consumed by higher-level services that persist, analyze, and serve user profiles.
- `profile-utils` re-usable anywhere untrusted/serialized data must be safely coerced (no profile-specific dependency).
- `UserProfile` and `UserProfileChangelog` imply integration with a database or ORM layer for persistence.
