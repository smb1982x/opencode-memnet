# WebUI Style Guide

**Project**: opencode-memnet  
**Scope**: The browser-based admin UI served from `src/web/`  
**Last updated**: 2026-05-27

---

## 1. Overview

The WebUI is a **vanilla JavaScript SPA** with **no build step, no bundler, and no framework**. All rendering is imperative DOM manipulation via `innerHTML` with template literals. The codebase consists of four key files:

| File                 | Lines | Role                                                |
| -------------------- | ----- | --------------------------------------------------- |
| `src/web/index.html` | 294   | Page structure, CDN includes, all static DOM shells |
| `src/web/app.js`     | 1,330 | All application logic, state, API calls, rendering  |
| `src/web/styles.css` | 1,734 | Complete stylesheet                                 |
| `src/web/i18n.js`    | 279   | EN/ZH translations + `t()` helper                   |

**External CDN dependencies** (loaded in `index.html` `<head>`):

- **Lucide** (`unpkg.com/lucide@latest`) — icon library
- **marked@17.0.1** (`cdn.jsdelivr.net`) — Markdown-to-HTML
- **DOMPurify@3.2.2** — HTML sanitization
- **jsonrepair** (`cdn.jsdelivr.net`) — lenient JSON parsing for profile data

**Core design philosophy**: Terminal-inspired dark aesthetic with monospace typography, high-contrast accent colors, and minimal decoration. The UI feels like a developer tool — no rounded corners, no shadows, no gradient backgrounds on primary surfaces.

---

## 2. Color Palette

### 2.1 Background Colors

| Token                   | Hex       | CSS Variable Equivalent | Usage                                                                                                                                                                      |
| ----------------------- | --------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background (deepest)    | `#0a0a0a` | —                       | `body` background, input/select/textarea background, memory cards, settings inputs                                                                                         |
| Surface (elevated)      | `#111`    | —                       | `.header`, `.controls`, `.memories-section`, `.add-section`, `.modal-content`, `.settings-panel`, `.profile-section`, `.migration-section`, `.scope-tabs` border container |
| Surface (subtle accent) | `#1a1a1a` | —                       | `.markdown-content code`/`pre`, `<th>` backgrounds in tables                                                                                                               |
| Surface (alternative)   | `#161616` | —                       | `.category-tag` background in profile cards                                                                                                                                |
| Card background         | `#0a0a0a` | —                       | `.compact-card`, `.workflow-row`                                                                                                                                           |

### 2.2 Border & Divider Colors

| Token                  | Hex                      | Usage                                                                                         |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| Border (default)       | `#333`                   | All borders — cards, sections, inputs, buttons, badges, modals, tabs                          |
| Border (subtle)        | `#222`                   | `.memory-footer` top border, `.dashboard-section h4` bottom border, `.card-footer` top border |
| Border (subtle alt)    | `#2a2a2a`                | `.compact-card` default border, `.workflow-row` border                                        |
| Divider (dashed)       | `#333`                   | `.combined-divider` borders, `.link-indicator`                                                |
| Divider (dashed, cyan) | `rgba(0, 204, 255, 0.2)` | `.prompt-header` bottom border                                                                |

### 2.3 Accent Colors (Semantic)

| Token                             | Hex       | CSS Variable Equivalent | Semantic Meaning                                                                                                                    |
| --------------------------------- | --------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Primary Green**                 | `#00ff00` | —                       | Primary actions, titles, section headers, active tab, focus rings, success toasts, memory badge, active selection, similarity score |
| **Primary Green (hover/pressed)** | `#00cc00` | —                       | `.btn-primary:hover`, settings save button hover                                                                                    |
| **Cyan**                          | `#00ccff` | —                       | Prompt badge, profile section accent, link color in markdown, edit button, confidence/version badges, prompt card border-left       |
| **Magenta**                       | `#ff00ff` | —                       | Pinned badge, pin button, linked badge, `.link-indicator`, pinned card left border                                                  |
| **Warning Orange**                | `#ffaa00` | —                       | Maintenance buttons (cleanup, dedup), `.badge-project`, markdown `<em>` color, `.pattern-card` top border                           |
| **Danger Red**                    | `#ff4444` | —                       | Delete buttons, bulk actions border, error toasts, migration section, modal close button, cancel button hover                       |
| **Neutral Gray**                  | `#888`    | —                       | Labels, secondary text, `.badge-type`, `.filter-group label`, form labels                                                           |
| **Dim Gray**                      | `#666`    | —                       | Footer text, pagination text, dates, `.evidence-toggle`, settings note                                                              |
| **Light Gray**                    | `#ccc`    | —                       | Prompt content, profile stats value, `.card-text`, `.workflow-steps-horizontal .step-content` equivalent color `#bbb`               |
| **Text Primary**                  | `#e0e0e0` | —                       | Body text, memory content, input text, markdown content                                                                             |
| **White**                         | `#fff`    | —                       | Modal close button on hover only                                                                                                    |

### 2.4 Semantic Background Accents

| Token                        | Color                     | Usage                                 |
| ---------------------------- | ------------------------- | ------------------------------------- |
| Memory section background    | `rgba(0, 255, 0, 0.02)`   | `.combined-memory-section`            |
| Prompt section background    | `rgba(0, 204, 255, 0.05)` | `.combined-prompt-section`            |
| Prompt card background       | `rgba(0, 204, 255, 0.03)` | `.prompt-card`                        |
| Prompt card hover            | `rgba(0, 204, 255, 0.08)` | `.prompt-card:hover`                  |
| Prompt card selected         | `rgba(0, 204, 255, 0.1)`  | `.prompt-card.selected`               |
| Memory card selected         | `rgba(0, 255, 0, 0.05)`   | `.memory-card.selected`               |
| Tag badge background         | `rgba(0, 255, 0, 0.1)`    | `.tag-badge`                          |
| Tag badge border             | `rgba(0, 255, 0, 0.3)`    | `.tag-badge` border                   |
| Bulk actions background      | `rgba(255, 68, 68, 0.1)`  | `.bulk-actions`                       |
| Migration section background | `rgba(255, 68, 68, 0.05)` | `.migration-section`                  |
| Modal overlay                | `rgba(0, 0, 0, 0.9)`      | `.modal` backdrop                     |
| Settings panel backdrop      | `rgba(0, 0, 0, 0.6)`      | Spread via `box-shadow: 0 0 0 9999px` |
| Settings panel glow          | `rgba(0, 255, 0, 0.1)`    | `.settings-panel` `box-shadow`        |

### 2.5 Color Rules

1. **Never mix accent colors on a single card** — memory cards use green left border, prompt cards use cyan, pinned cards get magenta left border.
2. **Hover states invert**: default buttons have colored text on `#0a0a0a`; on hover they become solid background with `#0a0a0a` text.
3. **Green is the universal "active/selected/primary" color** — if something is interactive and selected, it's green.
4. **Red means destructive** — delete buttons, migration warnings, error toasts.
5. **The background palette is a ladder**: `#0a0a0a` → `#111` → `#1a1a1a` (never go lighter than `#1a1a1a` for backgrounds).

---

## 3. Typography

### 3.1 Font Stack

```css
font-family: "JetBrains Mono", "Fira Code", "Consolas", monospace;
```

Applied globally on `body` and inherited. Form elements explicitly set `font-family: inherit`.

### 3.2 Size Scale

| Size     | Value    | Usage                                                                                                                                                               |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xs`     | 9px      | `.stat-pill .label`, `.count` badge, `.category-tag`, confidence ring                                                                                               |
| `xs-alt` | 10px     | `.badge`, `.badge-prompt`, `.badge-pinned`, `.evidence-toggle`, `.settings-note`                                                                                    |
| `sm`     | 11px     | `.filter-group label`, `.tag-badge`, `.memory-subtitle`, `.memory-footer`, `.prompt-date`, `.memory-actions button`, `.changelog-*`, `.link-indicator`, form labels |
| `sm-alt` | 12px     | `.stats-bar`, `.pagination span`, `.migration-actions button`, `.changelog-summary`, `.stat-pill .value`, auto-refresh text                                         |
| **base** | **13px** | Buttons, inputs, selects, textarea, modal content, `.memory-display-name`, `.markdown-content` base, `.prompt-content`, `.toast`                                    |
| `md`     | 14px     | `body` default, `.section-header h2`, `.migration-warning`, headings                                                                                                |
| `lg`     | 16px     | `.modal-header h3`, `.profile-info h3`, `.markdown-content h2`                                                                                                      |
| `xl`     | 18px     | `.title` (header), `.markdown-content h1`, Lucide icon references                                                                                                   |

### 3.3 Font Weights & Styles

| Style                               | Usage                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`font-weight: normal`** (default) | Headings (`.title`, `.section-header h2`, `.modal-header h3`) — intentionally not bold                                                                                        |
| **`font-weight: bold`**             | `.memory-display-name`, `.badge-pinned`, `.badge-memory`, `.badge-prompt`, `.badge-linked`, `.similarity-score`, `.migration-warning`, `.markdown-content strong`, `.tab-btn` |
| **`font-style: italic`**            | `.prompt-content`, `.settings-note`, `.markdown-content em`, `.markdown-content blockquote`                                                                                   |
| **`text-transform: uppercase`**     | `.filter-group label`, form labels (`.form-group label`), `.badge`, `.category-tag`, `.settings-panel h3`, `.settings-field label`, `.changelog-type`                         |
| **`letter-spacing: 1px`**           | `.title`, `.link-indicator`                                                                                                                                                   |
| **`letter-spacing: 0.5px`**         | `.badge`, `.profile-info h3`, `.migration-status-bar`                                                                                                                         |

### 3.4 Line Height

- Base line-height: `1.6` (`body`, `.changelog-summary`, `.prompt-content`)
- Markdown content: `1.8`
- Compact text: `1.4` (`.card-text`)
- No line-height override on most elements (inherit from parent)

### 3.5 Markdown Typography

Markdown content rendered with `.markdown-content` class follows a distinct sub-theme:

- Headings (h1-h3): green `#00ff00`, bold, bottom border `#333`
- `code` (inline): `#1a1a1a` background, 1px solid `#333` border, cyan text `#00ccff`, 12px font
- `pre > code`: no background/border override, `#e0e0e0` text
- `blockquote`: 3px green left border, italic, gray `#888`
- `a`: cyan `#00ccff` with dotted bottom border; hover → green
- `strong`: green `#00ff00`
- `em`: orange `#ffaa00`
- `del`: gray `#666`, strikethrough
- `th`: `#1a1a1a` background, green text
- All table cells: `#333` border

---

## 4. Layout

### 4.1 Container

```css
.container {
  max-width: 1400px;
  margin: 0 auto;
}
```

All page content is wrapped in `.container`. No padding on the container itself — padding lives on `body` (20px).

### 4.2 Spacing Conventions

| Context                                                                                           | Value                            |
| ------------------------------------------------------------------------------------------------- | -------------------------------- |
| Body padding                                                                                      | 20px (reduced to 10px on mobile) |
| Section padding (`.header`, `.controls`, `.memories-section`, `.add-section`, `.profile-section`) | 20px                             |
| Card padding (`.memory-card`, `.prompt-card`)                                                     | 15px                             |
| Combined section padding                                                                          | 15px                             |
| Section margin-bottom                                                                             | 20px                             |
| Form gap (`.form-row`)                                                                            | 15px                             |
| Control bar gap (`.controls`)                                                                     | 15px                             |
| Tags list gap                                                                                     | 6px                              |
| Memory actions gap                                                                                | 5px                              |
| Button gap (`.bulk-actions`, `.modal-actions`, settings)                                          | 8-10px                           |
| Modal form padding                                                                                | 20px                             |
| Settings panel content padding                                                                    | 16px                             |
| Stats bar gap                                                                                     | 20px                             |

### 4.3 Grid Pattern

The primary grid pattern is for dashboard card layouts:

```css
.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
```

Used for preference cards and pattern cards in the profile tab.

### 4.4 Flex Patterns

| Pattern                                   | Where                                                                | Details                                |
| ----------------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| `flex` + `gap` + `flex-wrap`              | `.controls`                                                          | Filter/search/maintenance controls row |
| `flex` + `justify-content: space-between` | `.header-top`, `.memory-header`, `.memory-footer`, `.section-header` | Header and footer rows                 |
| `flex` + `flex-direction: column`         | Cards (`.compact-card`), `.filter-group`, `.form-group`              | Vertical stacking                      |
| `flex` + `align-items: center`            | `.badge` containers, `.scope-tabs .tab-btn`                          | Icon + text alignment                  |
| `flex: 1` + `min-width`                   | `.search-group`, `.form-group`                                       | Flexible form elements                 |

### 4.5 Scrollable Regions

- **`.memories-list`**: max-height 600px, `overflow-y: auto`, custom webkit scrollbar
- **`.modal-content`**: max-height 80vh, `overflow-y: auto`
- **`.changelog-list`**: max-height 500px, `overflow-y: auto`

### 4.6 Custom Scrollbar

Applied only to `.memories-list`:

```css
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: #0a0a0a;
}
::-webkit-scrollbar-thumb {
  background: #333;
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: #444;
}
```

---

## 5. Components

### 5.1 Cards

#### Memory Card (`.memory-card`)

- Border: 1px solid `#333`
- Left accent: 3px solid `#00ff00`
- Background: `#0a0a0a`
- Padding: 15px
- Hover effect: border → `#00ff00` + shimmer pseudo-element sweep
- Selected state: border → `#00ff00`, background → `rgba(0, 255, 0, 0.05)`
- Pinned modifier (`.memory-card.pinned`): left border → 3px solid `#ff00ff`
- Structure:
  ```
  .memory-header (.meta + .memory-actions)
  .tags-list (optional)
  .memory-content (markdown)
  .link-indicator (optional)
  .memory-footer (dates + ID)
  ```

#### Prompt Card (`.prompt-card`)

- Border: 1px solid `#333`
- Left accent: 3px solid `#00ccff`
- Background: `rgba(0, 204, 255, 0.03)`
- Padding: 15px
- Hover: border → `#00ccff`, background → `rgba(0, 204, 255, 0.08)`
- Selected: border `#00ccff` + background `rgba(0, 204, 255, 0.1)`
- Structure:
  ```
  .prompt-header (.meta + .prompt-actions)
  .prompt-content (italic)
  .link-indicator (optional)
  ```

#### Combined Card (`.combined-card`)

- Groups a linked prompt+memory pair into one compound card
- Border: 1px solid `#333`, background `#0a0a0a`
- Structure:
  ```
  .combined-prompt-section (prompt content, cyan-tinted background)
  .combined-divider (arrow icon centered on thin bar)
  .combined-memory-section (memory content, green-tinted background)
  ```
- Selected state: border → `#00ff00`

#### Compact Card (`.compact-card`)

- Used in profile tab for preferences/patterns
- Border: 1px solid `#2a2a2a`
- Background: `#0a0a0a`
- Padding: 10px
- Hover: border → `#444` + `transform: translateY(-1px)`
- Flex column layout with `.card-top`, `.card-body`, `.card-footer`
- Preference variant: `.preference-card` — 2px solid `#00ccff` top border
- Pattern variant: `.pattern-card` — 2px solid `#ffaa00` top border
- Internal elements:
  - `.category-tag`: 9px uppercase, dark background `#161616`
  - `.confidence-ring`: 9px cyan text
  - `.card-text`: 12px `#d0d0d0`
  - `.evidence-toggle`: 10px, cursor `help`, hover reveals count

### 5.2 Badges

All badges share a base class `.badge` (10px, `text-transform: uppercase`, `letter-spacing: 0.5px`, 1px solid `#333` border). Extensions:

| Class            | Text Color | Border Color           | Purpose                                          |
| ---------------- | ---------- | ---------------------- | ------------------------------------------------ |
| `.badge-user`    | `#00ccff`  | `#00ccff`              | User-scope indicator                             |
| `.badge-project` | `#ffaa00`  | `#ffaa00`              | Project-scope indicator                          |
| `.badge-type`    | `#888`     | `#333`                 | Memory type label                                |
| `.badge-memory`  | `#00ff00`  | `#00ff00`              | "MEMORY" label on combined cards                 |
| `.badge-prompt`  | `#00ccff`  | `#00ccff`              | "USER PROMPT" label, bold                        |
| `.badge-pinned`  | `#ff00ff`  | `#ff00ff`              | "PINNED" label, bold                             |
| `.badge-linked`  | `#ff00ff`  | `#ff00ff`              | "LINKED" label, bold, `pulse` animation          |
| `.tag-badge`     | `#00ff00`  | `rgba(0, 255, 0, 0.3)` | Memory tags (not `.badge` subclass, independent) |

**Tag badge** (`.tag-badge`) is a standalone component, not a `.badge` subclass:

- Background: `rgba(0, 255, 0, 0.1)`, text: `#00ff00`
- 2px 8px padding, 11px font, `border-radius: 12px` (pill shape)
- This is the only element with rounded corners in the UI

### 5.3 Buttons

#### Base Button

```css
button {
  background: #0a0a0a;
  border: 1px solid #333;
  color: #00ff00;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
/* Hover: inverts — green background, dark text */
button:hover:not(:disabled) {
  background: #00ff00;
  color: #0a0a0a;
  border-color: #00ff00;
}
/* Disabled: 30% opacity, no cursor */
button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
```

#### Button Variants

| Class                          | Background | Border                      | Text      | Hover Invert?                                 |
| ------------------------------ | ---------- | --------------------------- | --------- | --------------------------------------------- |
| `.btn-primary`                 | `#00ff00`  | `#00ff00`                   | `#0a0a0a` | Yes (→ `#00cc00`)                             |
| `.btn-secondary`               | `#333`     | (none override)             | `#e0e0e0` | Partial (→ `#444`)                            |
| `.btn-maintenance`             | `#0a0a0a`  | `#ffaa00`                   | `#ffaa00` | Yes (→ `#ffaa00` bg)                          |
| `.btn-migration`               | `#0a0a0a`  | `#ff4444`                   | `#ff4444` | Yes (→ `#ff4444` bg)                          |
| `.btn-edit`                    | (base)     | `#00ccff`                   | `#00ccff` | Yes (→ `#00ccff` bg)                          |
| `.btn-delete`                  | (base)     | `#ff4444`                   | `#ff4444` | Yes (→ `#ff4444` bg)                          |
| `.btn-pin`                     | (base)     | `#ff00ff`                   | `#ff00ff` | Yes (→ `#ff00ff` bg)                          |
| `.btn-pin.pinned`              | `#ff00ff`  | —                           | `#0a0a0a` | Already filled                                |
| `.settings-toggle`             | `#0a0a0a`  | `#333`                      | `#00ff00` | Yes                                           |
| `.settings-panel .btn-primary` | `#00ff00`  | `#00ff00`                   | `#0a0a0a` | Yes                                           |
| `.settings-panel .btn-cancel`  | `#0a0a0a`  | `#333`                      | `#e0e0e0` | Partial (→ `#ff4444` border)                  |
| `.tab-btn`                     | `#0a0a0a`  | none (border-right: `#333`) | `#666`    | No! Special: `.tab-btn.active` is solid green |

#### Button Size Modifiers

- Standard: 8px 16px padding, 13px font
- Compact (card actions): 4px 10px padding, 11px font
- Icon-only (`.btn-pin`, `.btn-edit`, `.btn-delete`, `.modal-close`): `min-width: 32px`, flex-centered
- Full-width (settings save): `flex: 1`

#### Button Icons

- Buttons with both icon and text: the icon gets `margin-right: 4px`
- Icon-only buttons (`.btn-pin`, `.btn-edit`, `.btn-delete`, `.modal-close`, pagination, search): `margin-right: 0`

### 5.4 Tabs

`.scope-tabs` is a horizontal button group:

```css
.scope-tabs {
  display: flex;
  gap: 0; /* no gap — borders touch */
  border: 1px solid #333;
  background: #111;
  margin-bottom: 20px;
}
```

Each `.tab-btn`:

- `flex: 1` for equal width
- 15px 20px padding, 13px bold font
- Default: `#0a0a0a` bg, `#666` text, right border separator
- Hover: `#111` bg, `#888` text
- **Active**: `#00ff00` solid background, `#0a0a0a` text, no right border visible (overwrites)
- Icons: 18px inside tabs
- Last child: no right border

**Important**: Tab active state is the only place in the UI where a button shows a solid green background **without needing hover** — it indicates the current view.

### 5.5 Modals

```css
.modal {
  position: fixed; /* covers viewport */
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9); /* near-opaque overlay */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-content {
  background: #111;
  border: 1px solid #00ff00;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}
```

**Modal structure:**

```
.modal (hidden by default, toggle via .hidden class)
  └── .modal-content
       ├── .modal-header (20px padding, border-bottom)
       │    ├── h3 (16px, green, font-weight: normal)
       │    └── .modal-close (30×30px button, red border, X icon)
       ├── form (20px padding)
       │    ├── .form-group (content)
       │    └── .modal-actions (flex-end, gap 10px)
```

**Closing behavior:**

- Close button (`.modal-close`) dispatches `closeModal()`
- Clicking the overlay (`.modal` background) also closes — delegated via `e.target.id === 'edit-modal'`
- Cancel button calls `closeModal()`
- Escape key closes the **settings panel** only (not modals)

**Modals in use:**

- `#edit-modal` — edit memory content
- `#changelog-modal` — profile version history

Be aware: the settings panel (`#settings-panel`) is **not a modal** — it uses `position: fixed` + centered transform + a backdrop via `box-shadow: 0 0 0 9999px rgba(0,0,0,0.6)`. It has its own `z-index: 100`.

### 5.6 Forms & Inputs

#### Form Inputs (unified)

```css
select,
input[type="text"],
textarea {
  background: #0a0a0a;
  border: 1px solid #333;
  color: #e0e0e0;
  padding: 8px 12px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}
/* Focus: green border */
select:focus,
input[type="text"]:focus,
textarea:focus {
  border-color: #00ff00;
}
```

- `textarea`: `resize: vertical`, `min-height: 80px`
- `select`: `cursor: pointer`, `min-width: 150px`
- `select option`: `background: #111`, `color: #e0e0e0`
- `select:disabled`: 50% opacity, `cursor: not-allowed`, `#666` text

#### Checkboxes

```css
.memory-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #00ff00;
}
.migration-info input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: #ff4444;
}
```

#### Focus-Visible (Accessibility)

```css
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid #00ff00;
  outline-offset: 2px;
}
```

#### Form Layout

- `.form-row`: `display: flex; gap: 15px; flex-wrap: wrap;`
- `.form-group`: `flex: 1; min-width: 200px; flex-direction: column; gap: 5px;`
- Labels: 11px, uppercase, `#888`

#### Search Group

A specialized form pattern with merged input + button:

```css
.search-group {
  flex-direction: row; /* override default column */
  align-items: stretch;
  flex: 1;
  min-width: 300px;
}
.search-group input {
  flex: 1;
  border-right: none; /* merges with adjacent button */
}
```

The search button sits directly adjacent, visually connected.

### 5.7 Toasts

```css
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #111;
  border: 1px solid #00ff00;
  color: #e0e0e0;
  padding: 15px 20px;
  font-size: 13px;
  z-index: 2000;
  max-width: 400px;
}
.toast.error {
  border-color: #ff4444;
}
.toast.success {
  border-color: #00ff00;
}
```

**Animation**: `slideInBounce` — 0.5s cubic-bezier with overshoot effect (slides from right with bounce).

**Behavior**: Single-instance pattern — `showToast()` clears any existing timer before creating a new one. Auto-hides after 3 seconds.

**Usage**: Call `showToast(message, type)` where type is `"success"` or `"error"`. An `"info"` type exists in the code but has no CSS distinction (uses default green border).

### 5.8 Profile Components

#### Profile Header (`.profile-header`)

- Border: 1px solid `#333`, background: `#111`
- Left accent: 3px solid `#00ccff`
- Contains: `.profile-info` (name + stats pills) + refresh/action button

#### Stat Pills (`.stat-pill`)

- Vertical flex: `.label` (9px, uppercase, `#666`) + `.value` (12px, monospace, `#ccc`)

#### Dashboard Sections (`.dashboard-section`)

- Background: `#111`, border: `#333`, padding: 15px
- h4: 11px, `#888`, uppercase, letter-spacing 1px, bottom border, flex with icon
- `.count` badge in h4: `#222` bg, `#ccc` text, 9px, `border-radius: 10px`, `margin-left: auto`

#### Workflow Rows (`.workflow-row`)

- Background: `#0a0a0a`, border: `#2a2a2a`, padding: 12px
- Title: 12px, bold, `#ffcc00`
- Steps: horizontal flex, `.step-node` boxes (background `#111`, border `#333`, `border-radius: 4px`, 4px 8px padding)
- Step indices: circular, 16×16px, `#222` bg, `#888` text, `border-radius: 50%`
- Arrows between steps: Lucide `arrow-right` icon, 12×12px, `#444`

#### Changelog Items (`.changelog-item`)

- Border: `#333`, background: `#0a0a0a`, padding: 15px, margin-bottom: 10px
- Hover: border → `#00ccff`
- Header: `.changelog-version` (cyan bg `#00ccff`, dark text `#0a0a0a`, 4px 10px, `border-radius: 3px`) + `.changelog-type` (11px uppercase, `#888`) + `.changelog-date` (11px, `#666`, `margin-left: auto`)

### 5.9 Settings Panel

```css
.settings-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 100;
  border: 1px solid #00ff00;
  background: #111;
  min-width: 320px;
  box-shadow:
    0 4px 24px rgba(0, 255, 0, 0.1),
    /* green glow */ 0 0 0 9999px rgba(0, 0, 0, 0.6); /* backdrop */
}
```

Not a true modal — uses `position: fixed` + transform centering. The backdrop is a `box-shadow` trick.

- h3: 13px, uppercase, `#00ff00`, letter-spacing 1px, bottom border
- Fields: margin-bottom 12px, label 11px uppercase `#888`
- Inputs: full width, same style as form inputs
- Select: same styling, with disabled state
- Actions: flex row, gap 8px, margin-top 16px
- Cancel button: hover gets red border/text

### 5.10 Migration Section (`.migration-section`)

- Border: **2px** solid `#ff4444` (thicker than normal — indicates urgency)
- Background: `rgba(255, 68, 68, 0.05)`
- `border-radius: 4px` (one of the few rounded elements)
- Warning header: flex row with Lucide `alert-triangle` icon, `#ff4444`, bold, 14px
- Info section: semi-transparent black background, 1px `#333` border
- Migration buttons: `flex: 1`, left/right pair

### 5.11 Migration Status Bar

```css
.migration-status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 28px;
  background: #111;
  border-top: 1px solid #333;
  color: #00ff00;
  font-size: 12px;
  padding: 0 16px;
  z-index: 200;
  letter-spacing: 0.5px;
}
```

Fixed at page bottom. Polled every 2 seconds for migration progress.

### 5.12 Bulk Actions Bar (`.bulk-actions`)

- Red-bordered (`#ff4444`), red-tinted background
- Contains: selected count span + Select Page / Delete Selected / Deselect All buttons
- All buttons styled with red borders/text, red solid bg on hover
- Hidden by default (`.hidden`), shown when `state.selectedMemories.size > 0`

---

## 6. Animations

### 6.1 Keyframes

| Animation       | Duration          | Timing                                   | Trigger                                                                 | Where                              |
| --------------- | ----------------- | ---------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `slideInBounce` | 0.5s              | `cubic-bezier(0.68, -0.55, 0.265, 1.55)` | Toast appears                                                           | `.toast` (overrides `slideIn`)     |
| `spin`          | 1s                | `linear`, infinite                       | Any element with `.icon-spin` (refresh indicator, loading states)       | `#refresh-indicator`, `.icon-spin` |
| `pulse`         | 2s                | infinite, opacity 1↔0.6                  | `.badge-linked`                                                         | Linked memory/prompt badges        |
| shimmer sweep   | 0.5s (left→right) | linear                                   | Card hover (`.memory-card:hover::before`, `.prompt-card:hover::before`) | Pseudo-element `::before` on cards |

### 6.2 Transition Properties

| Element                 | Property       | Duration | Timing         |
| ----------------------- | -------------- | -------- | -------------- |
| All buttons             | `all`          | 0.2s     | ease (default) |
| Inputs/selects/textarea | `border-color` | 0.2s     | ease           |
| Memory cards            | `border-color` | 0.2s     | ease           |
| Prompt cards            | `all`          | 0.2s     | ease           |
| Compact cards           | `all`          | 0.2s     | ease           |
| Migration buttons       | `all`          | 0.2s     | ease           |
| Tabs (`.tab-btn`)       | `all`          | 0.2s     | ease           |
| Changelog items         | `border-color` | 0.2s     | ease           |
| Settings inputs         | `border-color` | 0.2s     | ease           |

### 6.3 Transition Conventions

1. **Buttons always transition `all`** — this covers background, border, and color changes simultaneously.
2. **Inputs only transition `border-color`** — background and text changes are instantaneous.
3. **Cards transition `border-color`** (memory) or `all` (prompt) — the shimmer effect uses the `::before` pseudo-element with `left` property, not a CSS transition.
4. **Timer functions**: almost everything uses the default `ease` timing.
5. **No prefers-reduced-motion media query** is implemented.

---

## 7. Responsive Design

### 7.1 Breakpoint

```css
@media (max-width: 768px) { ... }
```

Single breakpoint strategy. Everything below 768px width gets the mobile treatment.

### 7.2 Mobile Adaptations

| Change                           | Full                            | Mobile                             |
| -------------------------------- | ------------------------------- | ---------------------------------- |
| Body padding                     | 20px                            | 10px                               |
| Body font-size                   | 14px                            | 12px                               |
| `.title` font-size               | 18px                            | 14px                               |
| `.controls` layout               | flex row wrap                   | flex column stretch                |
| `.filter-group`, `.search-group` | flexible widths                 | `width: 100%`                      |
| `.section-header`                | flex row, space-between         | flex column, align-start, gap 10px |
| `.pagination`                    | default                         | `width: 100%`, centered            |
| `.form-row`                      | flex row wrap                   | flex column                        |
| `.memory-header`                 | flex row wrap                   | flex column, gap 10px              |
| `.memory-footer`                 | flex row, space-between         | flex column, gap 10px, align-start |
| `.profile-header`                | flex row, space-between         | flex column, gap 15px              |
| `.skill-level`                   | grid (referenced but undefined) | `1fr`                              |
| `.workflow-step`                 | default                         | column, align-start                |

### 7.3 Header Top

Header top is special — even on mobile it keeps `flex-direction: row` with `justify-content: space-between` to keep the title and settings gear on the same row.

---

## 8. i18n (Internationalization)

### 8.1 Architecture

Translations are defined in `src/web/i18n.js` as a single `translations` object with `en` and `zh` keys. No locale files, no dynamic loading.

**Structure:**

```javascript
const translations = {
  en: { key: "English text..." },
  zh: { key: "中文文本..." },
};
```

### 8.2 Translation Keys

Keys use **flat kebab-case identifiers** grouped by semantic category:

| Prefix          | Examples                                          | Meaning                     |
| --------------- | ------------------------------------------------- | --------------------------- |
| `tab-*`         | `tab-project`, `tab-profile`                      | Tab labels                  |
| `label-*`       | `label-tag`, `label-content`                      | Form field labels           |
| `btn-*`         | `btn-cleanup`, `btn-add-memory`                   | Button text                 |
| `opt-*`         | `opt-all-tags`, `opt-feature`                     | Select option text          |
| `section-*`     | `section-project`, `section-add`                  | Section titles              |
| `modal-*`       | `modal-edit-title`, `modal-changelog-title`       | Modal headers               |
| `toast-*`       | `toast-add-success`, `toast-delete-failed`        | Toast messages              |
| `confirm-*`     | `confirm-delete`, `confirm-cleanup`               | Confirmation dialog text    |
| `text-*`        | `text-selected`, `text-page`, `text-total`        | UI text fragments           |
| `empty-*`       | `empty-memories`, `empty-preferences`             | Empty state messages        |
| `profile-*`     | `profile-preferences`, `profile-patterns`         | Profile section labels      |
| `badge-*`       | `badge-prompt`, `badge-memory`                    | Badge text                  |
| `date-*`        | `date-created`, `date-updated`                    | Date labels                 |
| `migration-*`   | `migration-mismatch`, `migration-shards-mismatch` | Migration UI text           |
| `settings-*`    | `settings-title`, `settings-save`                 | Settings panel text         |
| `placeholder-*` | `placeholder-search`, `placeholder-content`       | Input placeholders          |
| `loading-*`     | `loading-init`, `loading-profile`                 | Loading states              |
| `status-*`      | `status-cleanup`, `status-dedup`                  | In-progress status messages |

### 8.3 The `t()` Function

```javascript
function t(key, params = {}) {
  const lang = getLanguage();
  let text = translations[lang][key] || translations["en"][key] || key;
  text = text.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`);
  return text;
}
```

**Behavior:**

- Reads language from `localStorage["opencode-memnet-lang"]` (defaults to `"en"`)
- Falls back to English if key missing in current language
- Falls back to the raw key string if missing in both
- Supports `{placeholder}` interpolation: `t("text-selected", { count: 5 })` → `"5 selected"`

### 8.4 Static Element Translation

Two HTML attribute conventions:

1. **`data-i18n`** — translates the element's text content:

   ```html
   <span data-i18n="text-selected">0 selected</span>
   ```

   `applyLanguage()` replaces `textContent` (respecting child nodes like icons).

2. **`data-i18n-placeholder`** — translates the `placeholder` attribute:
   ```html
   <input data-i18n-placeholder="placeholder-search" placeholder="Search memories..." />
   ```

### 8.5 Dynamic Content Translation

For content generated at render time (cards, toasts, modals), call `t()` directly in JavaScript:

```javascript
container.innerHTML = `<div class="empty-state">${t("empty-memories")}</div>`;
```

### 8.6 Language Detection

```javascript
function getLanguage() {
  return localStorage.getItem("opencode-memnet-lang") || "en";
}
```

Language is stored in `localStorage`. There is currently **no UI toggle** for switching languages — the code notes: "Language is auto-detected from localStorage or browser; no manual toggle button." The `setLanguage()` function exists but is not bound to any UI element.

### 8.7 Adding a New Translation String

1. Add a new key to both `translations.en` and `translations.zh` in `i18n.js`
2. For static HTML: add `data-i18n="your-key"` to the element
3. For dynamic JS: call `t("your-key")` or `t("your-key", { param: value })`
4. Make sure the key follows the prefix convention
5. **Do not add new translation files** — keep everything in the single `translations` object

---

## 9. Icons (Lucide)

### 9.1 Usage Pattern

Icons use the **Lucide web component pattern** via CDN:

1. Include the script: `<script src="https://unpkg.com/lucide@latest"></script>`
2. Add icon elements with `data-lucide` attribute:
   ```html
   <i data-lucide="search" class="icon"></i>
   ```
3. Call `lucide.createIcons()` after DOM mutations to render new icons

### 9.2 Icon CSS Classes

| Class          | Size                                               | Usage                                                         |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `.icon`        | 16×16px                                            | Default icon size, applied to virtually all icons             |
| `.icon-xs`     | 10×10px                                            | Evidence toggle in profile cards                              |
| `.icon-sm`     | 14×14px (declared), 12-14px (contextual overrides) | Inline with badges, `.link-indicator`                         |
| `.icon-md`     | 16×16px                                            | Explicit medium (rarely used — `.icon` covers this)           |
| `.icon-lg`     | 20×20px                                            | Settings toggle gear, migration warning                       |
| `.icon-large`  | 48×48px                                            | Empty state illustrations (`.icon-large`)                     |
| `.icon-spin`   | (inherits size)                                    | Loading/refresh indicators — applies `spin` animation         |
| `.icon-filled` | (inherits size)                                    | Fills the SVG with `currentColor` — used on `.btn-pin.pinned` |

### 9.3 Base Icon Styles

```css
.icon {
  width: 16px;
  height: 16px;
  stroke: currentColor; /* inherits text color */
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none;
  vertical-align: middle;
  display: inline-block;
}
```

### 9.4 Icon + Button Margins

- Buttons with text: `.icon` gets `margin-right: 4px`
- Icon-only buttons (pin, edit, delete, modal close, pagination, search): `margin-right: 0` via explicit selector override

### 9.5 Key Icon Mappings

| Lucide Icon                     | Used For                                      |
| ------------------------------- | --------------------------------------------- |
| `folder`                        | Project tab                                   |
| `user`                          | Profile tab                                   |
| `settings`                      | Settings gear toggle                          |
| `rotate-cw`                     | Refresh indicator (spinning)                  |
| `search`                        | Search button                                 |
| `x`                             | Clear search, close modal, deselect all       |
| `trash`                         | Cleanup button                                |
| `trash-2`                       | Delete individual memory, bulk delete         |
| `refresh-cw`                    | Deduplicate, refresh profile                  |
| `plus`                          | Add memory button                             |
| `edit-3`                        | Edit memory                                   |
| `pin`                           | Pin/unpin memory (filled variant when pinned) |
| `link`                          | Linked badge                                  |
| `arrow-down`, `arrow-up`        | Link direction indicators                     |
| `arrow-right`                   | Workflow step arrows                          |
| `chevron-left`, `chevron-right` | Pagination                                    |
| `check`                         | Save button                                   |
| `check-square`                  | Select all                                    |
| `alert-triangle`                | Migration warning                             |
| `message-circle`                | Prompt badge icon                             |
| `history`                       | View changelog                                |
| `info`                          | Evidence toggle                               |
| `heart`                         | Preferences section                           |
| `activity`                      | Patterns section                              |
| `workflow`                      | Workflows section                             |
| `user-x`                        | No profile found                              |

### 9.6 Icon Rendering Pattern

Always call `lucide.createIcons()` after any DOM mutation that adds new icon elements:

```javascript
renderMemories(); // adds new HTML with data-lucide attrs
lucide.createIcons(); // must follow immediately
```

This is done in `renderMemories()`, `renderUserProfile()`, `showMigrationWarning()`, and `DOMContentLoaded` init.

---

## 10. State Management

### 10.1 Global State Object

All application state lives in a single mutable `state` object in `app.js`:

```javascript
const state = {
  tags: { project: [] },
  memories: [],
  currentPage: 1,
  pageSize: 20,
  totalPages: 1,
  totalItems: 0,
  selectedTag: "",
  currentView: "project", // "project" | "profile"
  searchQuery: "",
  isSearching: false,
  selectedMemories: new Set(), // Set of memory/prompt IDs
  autoRefreshInterval: null, // setInterval ID
  userProfile: null,
  authKey: localStorage.getItem("opencode-memnet-apikey") || "",
  activeProfileId: localStorage.getItem("opencode-memnet-active-profile") || "",
  authDisabled: false,
};
```

### 10.2 State Update Pattern

There is no reactivity system. State mutations are imperative and explicit:

1. **Modify `state` directly** (no setter, no immutability):
   ```javascript
   state.selectedTag = document.getElementById("tag-filter").value;
   state.currentPage = 1;
   ```
2. **Call a render function** after mutation:
   ```javascript
   loadMemories(); // updates state.memories, then calls renderMemories()
   ```
3. **renderMemories() rebuilds the DOM** — full `innerHTML` replacement:
   ```javascript
   container.innerHTML = groupMemories(state.memories).map(...).join("");
   ```

### 10.3 localStorage Persistence

Three keys in `localStorage`:

| Key                              | Purpose                                | File      |
| -------------------------------- | -------------------------------------- | --------- |
| `opencode-memnet-apikey`         | Bearer token for API auth              | `app.js`  |
| `opencode-memnet-active-profile` | Selected user profile ID               | `app.js`  |
| `opencode-memnet-lang`           | Language preference (`"en"` or `"zh"`) | `i18n.js` |

### 10.4 Data Flow

```
User Action → Event Handler → Mutate state → API call → Update state.memories → renderMemories() → innerHTML
```

Key observation: **the DOM is always fully rebuilt from state**. There are no incremental updates. This is a deliberate simplicity choice that works well for the current scale (pagination at 20 items/page).

### 10.5 Request Deduplication

`loadMemories()` uses an incrementing `loadRequestId` to discard stale responses from superseded requests — prevents race conditions when users rapidly change filters or pages.

---

## 11. Adding New Features

### 11.1 Step-by-Step Guide

Follow this order when adding a new view, component, or feature:

#### Step 1: Add Static HTML Shell

In `src/web/index.html`, add the static container elements. Use existing patterns:

- Wrap in a section with `#your-section-id` and appropriate structural class (`.memories-section`, `.profile-section`, `.add-section`, or create a new one)
- Add `data-i18n` attributes to translatable elements
- Use `.hidden` class for initially hidden containers (shown via JS logic)
- Follow existing ID naming convention: `kebab-case` with semantic prefix

#### Step 2: Add Translation Strings

In `src/web/i18n.js`, add all new keys to both `en` and `zh` objects. Follow the prefix conventions:

- UI labels → `label-*`
- Buttons → `btn-*`
- Messages → `toast-*`, `confirm-*`, `status-*`
- Section titles → `section-*`

#### Step 3: Add CSS

In `src/web/styles.css`:

- Add styles at the bottom of the file (after all existing rules)
- Add a separator comment: `/* ── Your Feature Name ── */`
- Reuse existing color variables, spacing conventions, and component patterns
- Match the existing selectors' specificity (mostly single-class selectors)
- Add mobile adaptations in the existing `@media (max-width: 768px)` block

#### Step 4: Add JavaScript Logic

In `src/web/app.js`:

1. **If it needs new state**: add fields to the global `state` object
2. **Create render function(s)**: follow the pattern — build HTML string with template literals, inject via `innerHTML`, bind event listeners, call `lucide.createIcons()`
3. **Add event handlers**: register in the `DOMContentLoaded` init block near the bottom of `app.js` (lines ~1113-1329)
4. **Wire up API calls**: use `fetchAPI(endpoint, options)` — it handles 60s timeout, Bearer auth, and error normalization
5. **Call `t()` for dynamic text**: never hardcode English strings in JS

#### Step 5: Handle View Switching

If the feature lives behind a tab or toggle:

- Add appropriate visibility logic (adding/removing `.hidden` class)
- In `switchView()`, add the new view case
- Remember to re-render and re-initialize Lucide icons after showing

### 11.2 Code Patterns to Follow

**Rendering:**

```javascript
function renderMyFeature() {
  const container = document.getElementById("my-feature");
  const data = state.someData;

  if (!data.length) {
    container.innerHTML = `<div class="empty-state">${t("empty-my-feature")}</div>`;
    return;
  }

  container.innerHTML = data
    .map(
      (item) => `
    <div class="my-card ${item.active ? "active" : ""}">
      <div class="my-card-header">${escapeHtml(item.name)}</div>
      <div class="my-card-body markdown-content">${renderMarkdown(item.content)}</div>
      <div class="my-card-footer">
        <button onclick="myAction('${escapeAttr(item.id)}')">${t("btn-my-action")}</button>
      </div>
    </div>
  `
    )
    .join("");

  document.querySelectorAll(".my-card button").forEach((btn) => {
    // rebind events as needed
  });

  lucide.createIcons();
}
```

**Escaping:** Always use `escapeHtml()` for user-generated content and `escapeAttr()` for values in HTML attributes:

```javascript
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function escapeAttr(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

**Incremental request IDs** (if doing async loads):

```javascript
let myLoadRequestId = 0;
async function loadMyFeature() {
  const requestId = ++myLoadRequestId;
  const result = await fetchAPI("/api/my-endpoint");
  if (requestId !== myLoadRequestId) return; // discard stale
  // ... render ...
}
```

### 11.3 What NOT to Do

- **Do not add a build step** — the project is intentionally zero-config
- **Do not install npm packages or use import/export** — all deps are CDN `<script>` tags
- **Do not add a framework** — keep vanilla JS
- **Do not change the `innerHTML` pattern** for partial updates — full rebuilds are the convention
- **Do not add new locale files** — all translations go in the single `translations` object in `i18n.js`
- **Do not introduce CSS variables** — the codebase uses raw hex values everywhere; stay consistent
- **Do not add gradients, rounded corners, or drop shadows** to primary surfaces — the aesthetic is flat and sharp-edged (exception: tag badges use `border-radius: 12px`, and a few elements use `border-radius: 3-4px`)

### 11.4 File Checklist

When adding a new feature, you should touch:

- [ ] `src/web/index.html` — HTML shell
- [ ] `src/web/i18n.js` — EN + ZH translation strings
- [ ] `src/web/styles.css` — component styles + mobile adaptations
- [ ] `src/web/app.js` — state, render functions, event handlers, api calls

**Do not** create new `.js` or `.css` files. The four-file structure is intentional.
