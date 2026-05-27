Below is an implementation-level design guide for recreating the style in both screenshots as closely as possible in normal website/CSS terms.

# Sera / Oxanium Dark Dashboard Design Guide

## 1. Overall Visual Identity

This theme is a **dark, dense, futuristic dashboard UI**. It feels like a mix of:

- developer tooling
- observability dashboards
- fintech admin panels
- cyberpunk control rooms
- command-line / terminal-inspired SaaS UI

The design is **not soft, friendly, or rounded**. It is angular, compact, technical, and controlled.

The visual language is built from:

- very dark backgrounds
- charcoal cards
- thin muted borders
- bright cyan/teal as the only major accent
- small uppercase typography
- tight spacing
- compact forms
- restrained charts
- no heavy shadows
- almost no border radius
- minimal decoration

The UI should feel like a **professional internal tool for power users**, not a consumer app.

---

# 2. Page / Canvas Layout

## Global Background

The entire page uses a near-black background.

```css
body {
  background: #09090b;
  color: #fafafa;
}
```

The page background is not pure black. It is a very dark neutral black with a tiny blue/purple undertone.

Use:

```css
--background: #09090b;
```

## Grid System

The screenshots use a **masonry-style card grid**.

Approximate layout:

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 250px);
  gap: 28px 31px;
  align-items: start;
}
```

The cards are mostly around **247–254px wide**.

Some large cards span two columns, especially in the second screenshot.

```css
.card-wide {
  grid-column: span 2;
}
```

Approximate values:

| Property                      |     Value |
| ----------------------------- | --------: |
| Outer page left/right padding |      64px |
| Card width                    | 248–254px |
| Column gap                    |   28–32px |
| Row gap                       |   24–28px |
| Card padding                  |   20–24px |
| Nested section padding        |   12–16px |
| Button height                 |   30–36px |
| Input height                  |   32–38px |

The screenshots feel like they are arranged on a **strict vertical column rhythm**. Cards do not float randomly. Their left edges line up cleanly.

---

# 3. Core Color Palette

The design is almost monochrome, with cyan/teal as the active color.

## Primary Palette

| Token            |       Hex | Usage                             |
| ---------------- | --------: | --------------------------------- |
| Background       | `#09090b` | Full page background              |
| Card             | `#18181b` | Main card background              |
| Card Alt         | `#161619` | Slightly darker nested surfaces   |
| Card Elevated    | `#1f1f22` | Inner panels, selected tabs       |
| Border           | `#27272a` | Default 1px borders               |
| Border Strong    | `#333337` | Emphasized borders                |
| Input Border     | `#2f2f33` | Inputs, dividers                  |
| Foreground       | `#fafafa` | Main heading text                 |
| Muted Foreground | `#8a8d96` | Paragraph text                    |
| Faint Text       | `#5f626a` | Hints, captions                   |
| Primary Cyan     | `#007f97` | Buttons, primary fills            |
| Bright Cyan      | `#00b8db` | Charts, highlights                |
| Glow Cyan        | `#53eafd` | Strong chart highlight            |
| Deep Cyan        | `#0b3c48` | Area chart fills                  |
| Cyan Surface     | `#12323a` | Selected cards, chart backgrounds |

## Recommended CSS Variables

```css
:root {
  --background: #09090b;

  --card: #18181b;
  --card-alt: #161619;
  --card-raised: #1f1f22;

  --foreground: #fafafa;
  --foreground-soft: #d6d9df;
  --muted-foreground: #8a8d96;
  --faint-foreground: #5f626a;

  --border: #27272a;
  --border-soft: #222225;
  --border-strong: #333337;

  --primary: #007f97;
  --primary-hover: #0098b4;
  --primary-bright: #00b8db;
  --primary-glow: #53eafd;
  --primary-dark: #0b3c48;
  --primary-surface: #12323a;

  --success: #35e49d;
  --warning: #e0b84d;
  --danger: #d84a5b;

  --black: #000000;
  --white: #ffffff;
}
```

## Color Behavior

The theme should not use many colors. Most UI states are expressed through:

- brightness changes
- border changes
- cyan fills
- muted text
- thin dividers

Avoid using blue, purple, orange, or green heavily. Green appears only for positive financial numbers. Red appears only for danger states. Yellow appears only for pending/warning states.

---

# 4. Typography

## Font Style

The typography is one of the most important parts of the look.

Use a square, technical, slightly futuristic font. The screenshots strongly resemble **Oxanium**.

Recommended stack:

```css
font-family: "Oxanium", "Saira Semi Condensed", "Inter", system-ui, sans-serif;
```

Use **Oxanium** for headings, labels, buttons, numbers, and navigation.

For body copy, either use Oxanium everywhere or pair it with a cleaner small sans-serif. To match the screenshots closely, keep Oxanium across the interface.

## Typography Characteristics

The text is:

- mostly uppercase
- small
- letter-spaced
- compact
- technical
- high contrast for headings
- low contrast for body text

## Type Scale

```css
--text-micro: 9px;
--text-xs: 10px;
--text-sm: 11px;
--text-base: 12px;
--text-md: 14px;
--text-lg: 18px;
--text-xl: 24px;
--text-2xl: 30px;
```

## Headings

Card headings are small but bold.

```css
.card-title {
  font-size: 14px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fafafa;
}
```

Large metric numbers:

```css
.metric-large {
  font-size: 28px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fafafa;
}
```

Small labels:

```css
.label {
  font-size: 9px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #d6d9df;
}
```

Body text:

```css
.body-copy {
  font-size: 11px;
  line-height: 1.55;
  font-weight: 400;
  color: #8a8d96;
}
```

Buttons:

```css
.button {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

## Important Typography Rule

Do **not** use large, airy SaaS typography. This UI is dense. Even headings are small. The futuristic feel comes from the font, letter spacing, and capitalization rather than huge text.

---

# 5. Cards / Surfaces

## Main Card

Cards are rectangular charcoal blocks on a black background.

```css
.card {
  background: #18181b;
  border: 1px solid #202024;
  border-radius: 0;
  padding: 22px;
  color: #fafafa;
}
```

Most cards have no visible shadow. Use borders and contrast instead of elevation.

```css
box-shadow: none;
```

A very subtle shadow is acceptable but should barely show:

```css
box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.015);
```

## Card Corners

Use square corners or nearly square corners.

```css
border-radius: 0px;
```

Maximum acceptable:

```css
border-radius: 2px;
```

Do not use modern rounded card styles like `12px`, `16px`, or `24px`.

## Card Header

Typical header structure:

```html
<div class="card-header">
  <h3>Weekly Fitness Summary</h3>
  <p>Calories and workout load by day</p>
</div>
```

```css
.card-header {
  margin-bottom: 18px;
}

.card-header h3 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.card-header p {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: #7c8088;
}
```

## Nested Panels

Some cards contain inner panels with slightly darker or lighter backgrounds.

```css
.inner-panel {
  background: #1f1f22;
  border: 1px solid #2a2a2e;
  padding: 14px;
}
```

Selected panels sometimes have a cyan-tinted dark background:

```css
.selected-panel {
  background: #122a31;
  border-color: #183c45;
}
```

---

# 6. Borders, Dividers, and Lines

Lines are extremely important.

The design uses:

- 1px solid borders
- thin horizontal dividers
- dashed upload zones
- underline-style form fields
- subtle chart gridlines

## Default Divider

```css
.divider {
  height: 1px;
  background: #27272a;
}
```

## Muted Divider

```css
.divider-muted {
  height: 1px;
  background: #202024;
}
```

## Dashed Border

Used for upload zones and empty states.

```css
.dropzone,
.empty-state-box {
  border: 1px dashed #303036;
  background: transparent;
}
```

## Form Underline

Many inputs are not boxed. They are just text over a bottom border.

```css
.input-underline {
  background: transparent;
  border: 0;
  border-bottom: 1px solid #34343a;
  border-radius: 0;
  height: 36px;
  color: #fafafa;
}
```

---

# 7. Buttons

Buttons are compact, rectangular, and technical.

## Primary Button

Primary buttons are cyan/teal rectangles.

```css
.button-primary {
  height: 34px;
  padding: 0 18px;
  background: #007f97;
  border: 1px solid #007f97;
  color: #f4fbff;

  border-radius: 0;

  font-family: "Oxanium", sans-serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

Hover:

```css
.button-primary:hover {
  background: #0098b4;
  border-color: #0098b4;
}
```

Active:

```css
.button-primary:active {
  background: #006d83;
  border-color: #006d83;
}
```

## Secondary Button

Secondary buttons use dark fill with border.

```css
.button-secondary {
  height: 34px;
  padding: 0 18px;
  background: #1f1f22;
  border: 1px solid #2f2f33;
  color: #d6d9df;

  border-radius: 0;

  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
```

## Outline Button

```css
.button-outline {
  background: transparent;
  border: 1px solid #2f2f33;
  color: #d6d9df;
}
```

## Ghost Button

Ghost buttons are barely visible.

```css
.button-ghost {
  background: transparent;
  border: 1px solid transparent;
  color: #8a8d96;
}
```

## Full-Width CTA

Many cards use full-width CTAs near the bottom.

```css
.card .button-full {
  width: 100%;
  margin-top: 18px;
}
```

## Button Details

Buttons should not look pill-shaped. They should feel like industrial control buttons.

Avoid:

```css
border-radius: 999px;
box-shadow: large;
font-size: 14px;
```

Use:

```css
border-radius: 0;
height: 32px;
font-size: 9px;
letter-spacing: 0.12em;
```

---

# 8. Inputs, Selects, and Forms

Forms are compact and low contrast.

## Text Input

```css
.input {
  width: 100%;
  height: 36px;

  background: transparent;
  border: 0;
  border-bottom: 1px solid #34343a;

  color: #fafafa;
  font-size: 11px;
  font-family: "Oxanium", sans-serif;

  outline: none;
}
```

Placeholder:

```css
.input::placeholder {
  color: #5f626a;
}
```

Focus:

```css
.input:focus {
  border-bottom-color: #007f97;
}
```

## Boxed Input

Some settings panels use boxed rows.

```css
.input-box {
  height: 34px;
  background: #161619;
  border: 1px solid #2a2a2e;
  padding: 0 10px;
  color: #fafafa;
  font-size: 11px;
}
```

## Textarea

```css
.textarea {
  min-height: 84px;
  resize: vertical;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #34343a;
  color: #fafafa;
  font-size: 11px;
  line-height: 1.5;
}
```

## Labels

Labels are uppercase and very small.

```css
.form-label {
  display: block;
  margin-bottom: 8px;

  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #d6d9df;
}
```

## Selects

Selects look like underlined inputs with a tiny chevron.

```css
.select {
  appearance: none;
  height: 36px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #34343a;
  color: #fafafa;
  font-size: 11px;
  padding-right: 24px;
}
```

---

# 9. Tabs

Tabs are rectangular, not rounded.

Example from the Codespaces panel:

```css
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: #1f1f22;
  border: 1px solid #2a2a2e;
  height: 28px;
}

.tab {
  display: flex;
  align-items: center;
  justify-content: center;

  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;

  color: #8a8d96;
  background: transparent;
}

.tab-active {
  background: #2a2a2e;
  color: #fafafa;
  box-shadow: inset 0 0 0 1px #34343a;
}
```

Tabs should feel like hardware toggles or segmented command controls.

---

# 10. Icons

Icons are small, thin, and monochrome.

Use icon libraries like:

- Lucide
- Tabler Icons
- Phosphor Icons
- Remix Icons

Settings:

```css
.icon {
  width: 13px;
  height: 13px;
  stroke-width: 1.5;
  color: #aeb3bd;
}
```

Icon buttons:

```css
.icon-button {
  width: 26px;
  height: 26px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  background: #18181b;
  border: 1px solid #2a2a2e;
  color: #aeb3bd;
  border-radius: 0;
}
```

Hover:

```css
.icon-button:hover {
  border-color: #3a3a40;
  color: #fafafa;
  background: #1f1f22;
}
```

Selected icon buttons may use cyan border or cyan icon color.

---

# 11. Checkboxes, Radios, Toggles

## Checkbox

Checkboxes are tiny square outlines.

```css
.checkbox {
  width: 13px;
  height: 13px;
  border: 1px solid #3a3a40;
  background: transparent;
  border-radius: 0;
}

.checkbox.checked {
  background: #12323a;
  border-color: #007f97;
}
```

Checkmark:

```css
.checkbox.checked::after {
  color: #00b8db;
}
```

## Radio

Radio buttons are small circles with a cyan dot/ring when active.

```css
.radio {
  width: 12px;
  height: 12px;
  border: 1px solid #3a3a40;
  border-radius: 999px;
  background: transparent;
}

.radio.checked {
  border-color: #d6d9df;
  box-shadow: inset 0 0 0 3px #18181b;
  background: #fafafa;
}
```

## Toggle

Toggles are small rectangular/capsule controls, but not overly rounded.

```css
.toggle {
  width: 24px;
  height: 12px;
  background: #2a2a2e;
  border: 1px solid #3a3a40;
  border-radius: 2px;
}

.toggle.on {
  background: #12323a;
  border-color: #007f97;
}
```

The screenshots show small switches with cyan active states.

---

# 12. Sliders and Progress Bars

## Slider

```css
.slider-track {
  height: 2px;
  background: #2a2a2e;
}

.slider-fill {
  height: 2px;
  background: #007f97;
}

.slider-thumb {
  width: 8px;
  height: 8px;
  background: #007f97;
  border-radius: 0;
}
```

The slider should look thin and mechanical.

## Progress Bar

```css
.progress {
  height: 2px;
  background: #2a2a2e;
}

.progress-fill {
  height: 100%;
  background: #007f97;
}
```

Some progress bars are cyan lines under large numbers, especially in savings-target cards.

---

# 13. Charts

Charts are a huge part of this theme. They should be clean, simplified, and low-detail.

## Chart Colors

Use a tight cyan range:

```css
--chart-1: #00b8db;
--chart-2: #007f97;
--chart-3: #0b6276;
--chart-4: #123c46;
--chart-5: #1f6072;
```

## Chart Rules

- Use no heavy axes.
- Use tiny labels.
- Use faint grid lines or none.
- Use cyan bars/lines/fills.
- Use muted labels.
- Avoid rainbow charts.
- Do not use thick gradients except for area charts.
- Charts should look like embedded monitoring widgets.

## Bar Charts

Bars are narrow, rectangular, and cyan.

```css
.chart-bar {
  width: 12px;
  background: #00b8db;
}
```

Secondary bars:

```css
.chart-bar-secondary {
  background: #007f97;
}
```

Use groups of 2 bars for desktop/mobile comparisons.

Spacing between bars should be tight.

## Area Charts

The visitor and analytics charts use cyan strokes with dark teal filled areas.

```css
.area-chart-fill {
  fill: rgba(0, 184, 219, 0.22);
}

.area-chart-line {
  stroke: #53eafd;
  stroke-width: 1.5;
}
```

The area fill should be dark and subtle, not glowing.

## Donut Chart

The browser-share card uses a circular donut.

- Thick cyan ring
- Dark track ring
- Center number
- Small subtitle

```css
.donut-track {
  stroke: #1f1f22;
}

.donut-value {
  stroke: #00b8db;
  stroke-width: 10;
  stroke-linecap: butt;
}
```

Center number:

```css
.donut-number {
  font-size: 22px;
  font-weight: 700;
  color: #fafafa;
}
```

## Waveform

The live audio waveform uses many thin vertical bars centered on a horizontal axis.

- faint gray baseline
- cyan/gray amplitude bars
- symmetrical vertically
- compact width

```css
.wave-bar {
  width: 2px;
  background: #5f626a;
}

.wave-bar.active {
  background: #8a8d96;
}
```

---

# 14. Data Tables and Lists

Rows are compact and separated by thin lines.

```css
.data-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;

  min-height: 42px;
  border-bottom: 1px solid #27272a;
}
```

Icons sit inside tiny square dark boxes.

```css
.row-icon {
  width: 26px;
  height: 26px;
  background: #1f1f22;
  border: 1px solid #2a2a2e;
}
```

Main row text:

```css
.row-title {
  font-size: 11px;
  font-weight: 700;
  color: #fafafa;
}
```

Secondary row text:

```css
.row-subtitle {
  font-size: 10px;
  color: #7c8088;
}
```

Amounts:

```css
.row-amount {
  font-size: 11px;
  font-weight: 700;
  color: #fafafa;
}
```

Positive amount:

```css
.row-amount.positive {
  color: #35e49d;
}
```

---

# 15. Empty States

The screenshots contain several empty-state cards.

Common structure:

- centered small icon
- uppercase title
- muted explanation text
- cyan CTA button
- sometimes a dashed border container

```css
.empty-state {
  text-align: center;
  padding: 34px 18px;
}

.empty-state-icon {
  width: 28px;
  height: 28px;
  margin: 0 auto 18px;

  display: flex;
  align-items: center;
  justify-content: center;

  background: #1f1f22;
  border: 1px solid #2a2a2e;
  color: #d6d9df;
}

.empty-state-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.empty-state-copy {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  color: #8a8d96;
}
```

---

# 16. Component-by-Component Breakdown

## Image 1: General SaaS / Monitoring / Productivity Dashboard

### 1. Color Palette Card

Top-left card shows the theme palette.

Visual traits:

- title in uppercase
- muted paragraph
- color swatches in a tight grid
- labels are tiny and clipped-looking
- swatches are square rectangles
- no rounded corners

Swatch style:

```css
.swatch {
  width: 28px;
  height: 28px;
  border: 1px solid #2a2a2e;
  border-radius: 0;
}
```

Use this kind of palette:

```css
--swatch-background: #09090b;
--swatch-foreground: #fafafa;
--swatch-primary: #007f97;
--swatch-secondary: #27272a;
--swatch-muted: #252528;
--swatch-accent: #2a2a2e;
--swatch-border: #333337;
--chart-1: #53eafd;
--chart-2: #00b8db;
--chart-3: #007f97;
--chart-4: #0b6276;
--chart-5: #123c46;
```

---

### 2. Article / Text Card

The article card has:

- small eyebrow label
- large uppercase heading
- two short paragraphs
- outline button at bottom

Text should be narrow and dense.

```css
.eyebrow {
  font-size: 9px;
  text-transform: uppercase;
  color: #5f626a;
  letter-spacing: 0.08em;
}
```

The button is outline-only, full width, around 30px tall.

---

### 3. Codespaces Empty State Card

This card includes:

- two rectangular tabs at top
- a small section header
- plus and overflow icons
- horizontal divider
- centered empty-state icon
- uppercase “NO CODESPACES”
- muted explanatory text
- cyan CTA button
- footer note separated by a divider

The top tabs look like command-panel tabs.

The empty-state icon is a tiny square container with a simple database/server icon.

---

### 4. Control Sampler Card

This card demonstrates the UI control vocabulary.

It contains:

- small square icon buttons in a grid
- button variants
- a two-factor authentication nested panel
- slider
- underlined inputs
- badges / pill-like labels
- checkboxes
- segmented/group buttons
- tiny toggle

Important: even where something resembles a pill, it remains mostly rectangular.

Icon buttons are about 24–26px square.

---

### 5. Observability Announcement Card

This card has a large abstract media block at top.

The image area:

- dark teal blurred gradient
- no border radius
- fills card width
- height around 135px

Gradient recipe:

```css
.abstract-media {
  height: 138px;
  background:
    radial-gradient(circle at 25% 30%, rgba(83, 234, 253, 0.18), transparent 35%),
    radial-gradient(circle at 80% 10%, rgba(83, 234, 253, 0.22), transparent 40%),
    linear-gradient(135deg, #12323a, #1a1a1d 70%);
}
```

Below it:

- uppercase title
- muted paragraph
- cyan button
- tiny warning label aligned right

---

### 6. Environment Variables Card

This card is a compact settings form.

Traits:

- card title
- subtitle “Production · 8 variables”
- rows that look like terminal variables
- labels left, values right
- dark input boxes with borders
- masked secrets with bullets
- two buttons at bottom: outline edit, cyan deploy

Variable row:

```css
.env-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;

  height: 30px;
  padding: 0 10px;

  background: #161619;
  border: 1px solid #2a2a2e;

  font-size: 10px;
}
```

---

### 7. Traffic Channels Card

This card contains a compact bar chart.

Traits:

- title and muted paragraph
- grouped bars by month
- cyan bars on dark background
- tiny month labels
- legend for Desktop/Mobile
- metric row underneath
- full-width cyan CTA

Chart bars are rectangular, no rounding.

---

### 8. Invite Team Card

Traits:

- title and short description
- email rows with role dropdowns
- rows separated by thin borders
- “Add another” outline row
- invite-link field
- copy icon on right
- cyan invite button at bottom

Use compact row height around 36px.

---

### 9. Skeleton / Placeholder Card

This card shows a dashboard loading skeleton.

Traits:

- circular avatar placeholder
- multiple horizontal bars
- two rectangular buttons/blocks
- all placeholders are dark gray
- no shimmer required

Skeleton colors:

```css
.skeleton {
  background: #27272a;
}
```

---

### 10. Browser Share Donut Card

Traits:

- top heading and date range
- small browser label at top right
- centered donut chart
- center number and label
- tiny legend with browser names
- bottom progress indicator line
- percentage aligned right

The donut uses a bright cyan ring and a dark background ring.

---

### 11. No Team Members Card

Traits:

- dashed border container inside card
- overlapping circular avatars at top
- uppercase empty-state title
- muted copy
- cyan button

Avatar style:

```css
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 2px solid #18181b;
}
```

Even though most UI is square, avatars remain circular.

---

### 12. Report Bug Form

Traits:

- title
- muted description
- underlined title field
- severity/component selectors
- compact form layout
- likely textarea lower down

This should look like a developer console form.

---

### 13. Topic / Feedback Card

Traits:

- uppercase field labels
- select input
- textarea
- full-width cyan submit button
- lots of vertical breathing room compared with other cards, but still compact

The select chevron should be tiny and muted.

---

### 14. Book Appointment Card

Traits:

- title
- doctor subtitle
- date label
- row of time buttons
- selected time button has darker filled panel
- note box
- full-width CTA

Time buttons are text-only or dark mini buttons.

Selected note box:

```css
.appointment-note {
  background: #18181b;
  border: 1px solid #2a2a2e;
  padding: 12px;
}
```

---

### 15. Weekly Fitness Summary Card

Traits:

- title and subtitle
- seven vertical mini bars labeled M T W T F S S
- dark tracks with cyan fills
- full-width CTA

The chart is like a compact vertical progress display.

Track style:

```css
.day-track {
  width: 24px;
  height: 62px;
  border: 1px solid #2a2a2e;
  background: #161619;
  display: flex;
  align-items: end;
}
```

Fill:

```css
.day-fill {
  width: 100%;
  background: #00b8db;
}
```

---

### 16. File Upload Card

Traits:

- title and muted subtitle
- large dashed dropzone
- centered upload icon
- uppercase “UPLOAD FILES”
- muted file type text
- cyan browse button

The dropzone is one of the largest inner bordered elements.

```css
.dropzone {
  height: 180px;
  border: 1px dashed #303036;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
```

---

### 17. Analytics Card

Traits:

- title
- metric text like “418.2K Visitors +10%”
- small outline “View Analytics” button top right
- large dark teal area chart
- cyan line
- no visible y-axis

This chart should feel like a monitoring widget, not a marketing graph.

---

### 18. Cycle / Billing Usage Card

Traits:

- title “5 Days Remaining in Cycle”
- list of usage items
- each row has small cyan ring icon
- label left
- dollar amount right
- compact spacing

Small ring bullet:

```css
.ring-dot {
  width: 9px;
  height: 9px;
  border: 1px solid #007f97;
  border-radius: 999px;
}
```

---

### 19. Alert / Upgrade Card

Traits:

- centered text
- uppercase title
- muted body
- full-width or centered cyan button
- no chart
- high negative space compared with other cards

This card feels like an upgrade prompt.

---

### 20. Live Audio Waveform Card

Traits:

- title and muted copy
- centered waveform
- two buttons below
- primary/secondary action pair

The “Stop Processing” button is cyan; “Start Listening” is dark outline.

---

### 21. Visitors Card

Traits:

- title and small comparison stat
- subtitle
- large area chart
- cyan line
- dark teal fill
- no visible card footer

Line should be smooth, but not overly rounded.

---

### 22. Contributions & Activity Card

Traits:

- title
- muted explanation
- boxed setting panel
- checkbox
- explanatory text
- full-width cyan save button

This card uses privacy/settings form language.

---

# 17. Image 2: Finance / Account / Payments Dashboard

The second screenshot uses the same visual system but applies it to fintech, payments, banking, investment, and account settings.

## 1. Contribution History Card

Traits:

- title and subtitle
- vertical bar chart
- monthly labels
- two small bottom info panels
- full-width CTA

Bottom panels:

```css
.info-tile {
  background: #1f1f22;
  border: 1px solid #202024;
  padding: 12px;
}
```

The bars use bright cyan and should have no rounded caps.

---

## 2. Distribute Track Card

Traits:

- centered plus icon
- uppercase title
- muted explanation
- cyan CTA

This is an empty-state/action card.

The plus icon sits in a small dark square.

---

## 3. QR Code Card

Traits:

- large white QR code centered
- title underneath
- black/card background
- QR code is the only pure white-heavy area in the theme

Use a white square with black QR pattern. Do not tint it cyan.

---

## 4. Payout Threshold Card

Traits:

- title and description
- close button top right
- currency select
- large minimum payout amount aligned right
- slider
- min/max labels
- notes textarea
- divider
- full-width cyan save button

Close button:

```css
.close-button {
  width: 24px;
  height: 24px;
  background: #27272a;
  border: 1px solid #333337;
  color: #8a8d96;
}
```

---

## 5. Claimable Balance Card

Traits:

- large `$0.00`
- yellow pending dot
- small status label
- inner breakdown panel
- three financial rows
- explanatory paragraph

Use yellow sparingly:

```css
--warning: #e0b84d;
```

---

## 6. Preferences Card

Traits:

- title
- close icon
- muted description
- form sections
- compact settings layout

This card reinforces the modal/settings-panel style.

---

## 7. Savings Targets Card

Traits:

- title
- “New Goal” outline button
- stacked goal cards
- each goal has:
  - small category label
  - large money value
  - thin cyan progress bar
  - percentage achieved left
  - target amount right

Goal item:

```css
.goal-card {
  background: #1f1f22;
  border: 1px solid #202024;
  padding: 16px;
}
```

Progress bars are very thin, around 2px.

---

## 8. Buy Investment Card

Traits:

- title
- amount input
- order type select
- explanatory text
- calculated rows
- large total buying power
- full-width cyan review button
- muted disclaimer text

This component should feel transactional and serious.

Numbers align right. Labels align left.

---

## 9. Recent Transactions Wide Card

This is one of the largest components.

Traits:

- spans two columns
- title/subtitle left
- outline “View All” button right
- transaction list
- each row has:
  - square icon container
  - merchant name
  - category
  - date
  - amount
  - overflow menu

Row structure:

```css
.transaction-row {
  display: grid;
  grid-template-columns: 32px 1fr auto auto 16px;
  gap: 12px;
  align-items: center;

  min-height: 50px;
  border-bottom: 1px solid #27272a;
}
```

Positive transaction amounts are green. Negative amounts remain off-white.

```css
.amount-positive {
  color: #35e49d;
}
```

---

## 10. Account Access Card

Traits:

- title and description
- email field
- password field
- small “forgot?” text on right
- cyan “Update Security” button with lock icon
- danger zone row below

Danger row:

```css
.danger-zone {
  background: #1f1f22;
  border: 1px solid #27272a;
  color: #d84a5b;
}
```

Use red only for tiny labels/icons, not large backgrounds.

---

## 11. Mini Balance Cards

Small cards show:

- card balance
- amount
- currency/availability
- payment due
- date
- CTA

These are very dense metric widgets.

Use large number text, but still in compact card dimensions.

---

## 12. Yearly Activity Mini Chart

Traits:

- small title
- tiny positive stat
- monthly bar chart
- all bars cyan/teal
- chart sits in a compact strip

---

## 13. Transfer Funds Card

Traits:

- modal-like card
- close button
- amount field
- account select
- compact form rows
- dark understated design

Looks like a banking form inside the same system.

---

## 14. Payout Preferences / Receiving Method Card

Traits:

- title area with close button
- account holder name field
- receiving method options as selectable cards
- active card has cyan-tinted background
- radio button left
- title and subtitle in each option
- IBAN/account number field
- full-width cyan save button, possibly disabled/dimmed

Selectable option:

```css
.payment-option {
  display: grid;
  grid-template-columns: 18px 1fr;
  gap: 10px;
  align-items: center;

  padding: 14px;
  border: 1px solid #2a2a2e;
  background: transparent;
}

.payment-option.selected {
  background: #122a31;
  border-color: #183c45;
}
```

---

## 15. Power Usage Card

Traits:

- title/subtitle
- hourly bar chart
- labels like 6a, 8a, 10a
- divider
- two-column metric row
- battery level progress bar

Power chart bars are cyan and vary in height.

Battery progress:

```css
.battery-track {
  height: 2px;
  background: #2a2a2e;
}

.battery-fill {
  height: 100%;
  background: #007f97;
}
```

---

## 16. Stock Performance Card

Traits:

- title/subtitle
- ticker select
- dark chart box
- cyan line chart
- subtle grid/dotted lines
- no big axes

The chart stroke is thin and smooth.

---

## 17. Explore Catalog Card

Traits:

- centered icon
- uppercase title
- muted copy
- cyan button

Another empty-state/promo card.

---

## 18. Set a New Milestone Card

Traits:

- title and description
- goal name field
- target amount and target date two-column row
- full-width cyan create button
- outline cancel button underneath

Two-column inputs should be tight:

```css
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
```

---

# 18. Spacing System

Use a compact 4px-based spacing scale.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-7: 28px;
--space-8: 32px;
```

Recommended component spacing:

| Element                 | Spacing |
| ----------------------- | ------: |
| Card padding            | 20–24px |
| Header to content       | 16–20px |
| Label to input          |   6–8px |
| Form field vertical gap | 18–22px |
| Button group gap        |     8px |
| Data row gap            | 10–12px |
| Chart top margin        | 18–24px |
| Divider margin          | 18–24px |

The screenshots are dense but not cramped. The trick is small typography with consistent spacing.

---

# 19. Interaction States

## Hover

Hover should be subtle.

```css
.interactive:hover {
  background: #1f1f22;
  border-color: #3a3a40;
}
```

## Focus

Focus should use cyan, not default browser blue.

```css
:focus-visible {
  outline: 1px solid #00b8db;
  outline-offset: 2px;
}
```

## Disabled

```css
.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

## Selected

Selected states use a dark cyan surface.

```css
.selected {
  background: #122a31;
  border-color: #183c45;
  color: #fafafa;
}
```

---

# 20. Regular CSS Starter Theme

Here is a compact base CSS version that captures the screenshots’ style.

```css
@import url("https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;600;700&display=swap");

:root {
  --background: #09090b;

  --card: #18181b;
  --card-alt: #161619;
  --card-raised: #1f1f22;

  --foreground: #fafafa;
  --foreground-soft: #d6d9df;
  --muted-foreground: #8a8d96;
  --faint-foreground: #5f626a;

  --border: #27272a;
  --border-soft: #222225;
  --border-strong: #333337;

  --primary: #007f97;
  --primary-hover: #0098b4;
  --primary-bright: #00b8db;
  --primary-glow: #53eafd;
  --primary-dark: #0b3c48;
  --primary-surface: #12323a;

  --success: #35e49d;
  --warning: #e0b84d;
  --danger: #d84a5b;

  --font-main: "Oxanium", "Saira Semi Condensed", "Inter", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-main);
  font-size: 12px;
  line-height: 1.5;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 248px));
  gap: 28px 31px;
  align-items: start;
  padding: 22px 66px;
}

.card {
  background: var(--card);
  border: 1px solid #202024;
  border-radius: 0;
  padding: 22px;
  box-shadow: none;
}

.card-wide {
  grid-column: span 2;
}

.card-title {
  margin: 0 0 6px;
  color: var(--foreground);
  font-size: 14px;
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.card-subtitle {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 11px;
  line-height: 1.45;
}

.label {
  display: block;
  margin-bottom: 8px;
  color: var(--foreground-soft);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.input,
.select,
.textarea {
  width: 100%;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #34343a;
  border-radius: 0;
  color: var(--foreground);
  font-family: var(--font-main);
  font-size: 11px;
  outline: none;
}

.input,
.select {
  height: 36px;
}

.textarea {
  min-height: 82px;
  padding-top: 8px;
  resize: vertical;
}

.input::placeholder,
.textarea::placeholder {
  color: var(--faint-foreground);
}

.input:focus,
.select:focus,
.textarea:focus {
  border-bottom-color: var(--primary);
}

.button {
  height: 34px;
  padding: 0 18px;
  border-radius: 0;
  font-family: var(--font-main);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
}

.button-primary {
  background: var(--primary);
  border: 1px solid var(--primary);
  color: #f4fbff;
}

.button-primary:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

.button-secondary {
  background: var(--card-raised);
  border: 1px solid #2f2f33;
  color: var(--foreground-soft);
}

.button-outline {
  background: transparent;
  border: 1px solid #2f2f33;
  color: var(--foreground-soft);
}

.button-full {
  width: 100%;
}

.icon-button {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--card);
  border: 1px solid #2a2a2e;
  border-radius: 0;
  color: #aeb3bd;
}

.icon-button:hover {
  background: var(--card-raised);
  border-color: #3a3a40;
  color: var(--foreground);
}

.divider {
  height: 1px;
  background: var(--border);
  margin: 18px 0;
}

.inner-panel {
  background: var(--card-raised);
  border: 1px solid #2a2a2e;
  padding: 14px;
}

.selected-panel {
  background: var(--primary-surface);
  border-color: #183c45;
}

.metric-large {
  color: var(--foreground);
  font-size: 28px;
  line-height: 1;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.muted {
  color: var(--muted-foreground);
}

.faint {
  color: var(--faint-foreground);
}

.positive {
  color: var(--success);
}

.warning {
  color: var(--warning);
}

.danger {
  color: var(--danger);
}

.progress {
  height: 2px;
  background: #2a2a2e;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
}

.dropzone {
  border: 1px dashed #303036;
  background: transparent;
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}
```

---

# 21. Key “Do This / Don’t Do This” Rules

## Do This

- Use `#09090b` for the page.
- Use `#18181b` for cards.
- Use thin 1px borders.
- Use Oxanium or a similar techno font.
- Use uppercase labels.
- Use tiny text with letter spacing.
- Use cyan as the primary accent.
- Use square buttons and cards.
- Use dense layouts.
- Use subtle dividers everywhere.
- Use simple charts with cyan bars/lines.
- Use muted gray text for descriptions.
- Use full-width CTAs inside narrow cards.

## Don’t Do This

- Do not use big rounded corners.
- Do not use soft pastel colors.
- Do not use heavy shadows.
- Do not use gradients everywhere.
- Do not use large marketing typography.
- Do not use bright white backgrounds except QR codes.
- Do not use colorful charts.
- Do not make buttons pill-shaped.
- Do not overuse glow effects.
- Do not make the interface spacious like a modern landing page.

---

# 22. One-Sentence Prompt for an LLM Without Vision

Create a dense futuristic dark-mode dashboard theme using a near-black page background, charcoal rectangular cards, square corners, thin gray borders, compact uppercase Oxanium typography, bright cyan/teal primary actions, muted gray body text, underlined form fields, tiny icon buttons, cyan-only charts, dashed upload zones, compact financial/admin widgets, and a strict masonry grid of narrow cards with almost no shadows or rounded corners.
