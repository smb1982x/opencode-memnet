# src/services/ai/validators/

## Responsibility

Validates structured data extracted from AI provider responses before it flows into downstream services. The module is the **integrity gate** between raw LLM output and system-consumable data.

Currently scoped to **user-profile validation**: the `UserProfileValidator` class ensures that parsed JSON from AI providers conforms to the `UserProfileData` schema (preferences, patterns, workflows). Additional validators can be added here as new structured extraction use-cases arise.

## Design Patterns

| Pattern | Usage |
|---|---|
| **Static Factory Method** | `UserProfileValidator.validate(data)` — no instance needed; single entry point |
| **Recursive Composite Validation** | Top-level `validate()` delegates to `validatePreferences()`, `validatePatterns()`, `validateWorkflows()` for nested sub-structures |
| **Result Object** | Returns a `ValidationResult` union: `{ valid: true, errors: [], data }` or `{ valid: false, errors: string[] }` — callers switch on `result.valid` |
| **Pure Functions** | All methods are stateless and side-effect-free; output depends solely on input |

Validation is **defensive** — null/undefined checks, type assertions, structural invariants (e.g. non-empty arrays) are checked before type-level fields.

## Data & Control Flow

```
AI Provider (OpenAI/Gemini/Anthropic)
  │
  ▼
raw text response from LLM
  │
  ├──► JSON.parse()
  │      │
  │      ▼
  │   parsed object (unknown shape)
  │      │
  │      ▼
  │   UserProfileValidator.validate(parsed)
  │      │
  │      ├──► Top-level: is object? not empty? no null fields?
  │      ├──► validatePreferences(parsed.preferences)
  │      │     ├── each: object? category? description? confidence? evidence[]?
  │      │     └── errors collected per index
  │      ├──► validatePatterns(parsed.patterns)
  │      │     ├── each: object? category? description?
  │      │     └── errors collected per index
  │      ├──► validateWorkflows(parsed.workflows)
  │      │     ├── each: object? description? steps[]?
  │      │     └── errors collected per index
  │      │
  │      ▼
  │   ValidationResult
  │      │
  │      ├── valid: true  → data: UserProfileData  → proceed with extraction
  │      └── valid: false → errors: string[]       → handle/report
```

The sub-validators are **permissive**: they continue checking remaining items after a failure and collect all errors, rather than failing fast. This gives callers a complete picture of what's wrong.

## Integration Points

| Direction | File | How |
|---|---|---|
| **Importing** | `src/services/ai/providers/openai-chat-completion.ts` (line 11, 351) | `UserProfileValidator.validate(parsed)` |
| **Importing** | `src/services/ai/providers/google-gemini.ts` (line 5, 237) | `UserProfileValidator.validate(parsed)` |
| **Importing** | `src/services/ai/providers/anthropic-messages.ts` (line 5, 162) | `UserProfileValidator.validate(toolUse)` |
| **Depends on** | `src/services/user-profile/types.ts` | `UserProfileData`, `UserProfilePreference`, `UserProfilePattern`, `UserProfileWorkflow` |

All three AI providers invoke the same static method, ensuring consistent validation regardless of the upstream LLM. The validator consumes `UserProfileData` types but does **not** import any database, repository, or service layers — it is a pure schema-level guard.

### Extension points

- To add a new validator, create a `<name>-validator.ts` with a static `validate(input: any): ValidationResult` method following the same pattern.
- `ValidationResult` can be shared across all validators (prefer importing from this module's interface).
- Consider extracting `ValidationResult` into a shared types file if the pattern is used by multiple validator files.
