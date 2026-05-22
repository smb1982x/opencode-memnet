# src/services/ai/validators/

## Responsibility

Validates AI-generated structured data before it is accepted into the domain. Ensures raw AI output conforms to the expected shape and constraints of domain types, preventing malformed data from propagating through the system.

## Design

- **Static validator classes** — stateless, no instantiation needed. Each class exposes a `static validate(data: any): ValidationResult` entry point.
- **`ValidationResult`** — shared return type: `{ valid: boolean; errors: string[]; data?: T }`. On success `data` is narrowed to the typed domain interface; on failure `errors` lists every problem found.
- **Two-phase validation** — structural checks first (object, not array/empty/null fields), then semantic field checks delegated to private helpers per sub-section (e.g. `preferences`, `patterns`, `workflows`).
- **Accumulating errors** — all issues are collected rather than failing fast, giving callers a complete picture of what's wrong.

## Flow

1. Caller passes raw `any` (typically parsed JSON from an AI response) to `UserProfileValidator.validate()`.
2. Top-level structural checks reject non-objects, arrays, empty objects, and null/undefined fields.
3. If present, sub-sections are validated in order: `preferences` → `patterns` → `workflows`.
4. Each sub-validator checks array-ness then iterates entries, validating required fields and types.
5. On zero errors: returns `{ valid: true, data }` cast to `UserProfileData`.
6. On any errors: returns `{ valid: false, errors }`.

## Integration

- **Depends on**: `UserProfileData` type from `src/services/user-profile/types.js`.
- **Consumed by**: the AI/user-profile pipeline — callers that receive AI-generated user profiles and need to guard against malformed output before persisting or using the data.
