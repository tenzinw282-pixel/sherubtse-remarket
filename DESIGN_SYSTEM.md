# Sherubtse ReMarket visual foundations

Phase 1 establishes a maintainable CSS/Bootstrap system in `public/styles.css`. Classes extend Bootstrap 5; no frontend framework is introduced. Inter is served locally from the installed OFL-licensed `@fontsource-variable/inter` package. The existing text wordmark remains until the separate logo phase; this delivery does not claim logo or PNG exports.

## Palette

| Token | Value | Purpose |
| --- | --- | --- |
| `--rm-navy` | `#10243A` | Primary actions, headings, identity |
| `--rm-gold` | `#D6AA58` | Decorative brand accents on dark surfaces |
| `--rm-background` | `#F6F8FB` | Page canvas |
| `--rm-surface` | `#FFFFFF` | Forms and content surfaces |
| `--rm-text` | `#172334` | Primary text |
| `--rm-secondary` | `#64748B` | Secondary text on white |
| `--rm-secondary-canvas` | `#5E6E84` | Stronger secondary text on the tinted canvas |
| `--rm-success` | `#16845B` | Success indicators |
| `--rm-error` | `#DC3545` | Error indicators |
| `--rm-gold-text` | `#805B1B` | Readable gold-toned text on light backgrounds |
| `--rm-control-border` | `#8593A5` | Visible input/button boundaries |
| `--rm-focus` | `#245DA8` | Keyboard focus ring |

Do not use premium gold as small text on white, or white text on gold. Navy text on gold is permitted. Neutral decorative borders are not input boundaries: controls use the stronger control-border token. Alerts pair explicit text with color; never convey state through color alone.

## Typography and layout

Use Inter, then system sans-serif fallbacks. Body text is 15px with 1.65 line height; form text 14px; labels/buttons 13px; supporting text 12px; display headings fluid between 40px and 68px. Use 500–750 weights for hierarchy, rather than multiple display fonts. Headings wrap responsively and paragraphs cap at 75 characters.

Spacing tokens follow a 4px base: 4, 8, 12, 16, 24, 32, 48, 64 and 96px. Content width caps at 1200px; auth cards at 520px; listing forms at 780px. Radius tokens are 8, 14 and 24px. Use one subtle surface shadow and thin borders. No gradients or unnecessary animation.

## Reusable components

- `.surface`: white bordered card with subtle shadow; pair with a layout class.
- `.auth-card`: centered account form; `.intro`, `.eyebrow`, labels and controls follow a consistent hierarchy.
- `.form-panel`, `.page-heading`: listing form and its introduction.
- `.content-panel`: readable general content; `.error-panel` supplies the error-page variant.
- `.btn-primary`: navy/white main action; `.btn-outline-secondary`: outlined secondary action; `.button-row` wraps actions on small screens.
- `.form-control`, `.form-select`, `.form-label`, `.form-help`, `.terms-check`: visible, labeled form controls and supporting content. Preserve all existing input names and server validators.
- `.alert-info`, `.alert-success`, `.alert-danger`: textual feedback with semantic tones. Existing controller messages retain their current behavior; contextual inline errors come in the form phase.
- `.status-badge`, `.success`, `.error`: compact status text. Always include a descriptive label.
- `.feature-grid`, `.feature-card`: responsive explanatory content without fabricated marketplace records.
- `.site-header`, `.site-nav`, `.nav-links`, `.site-footer`: shared shell; links point to implemented routes only.

## Interaction and accessibility

Primary controls have at least a 44px height (compact mobile navigation buttons 40px); links retain descriptive names and browser keyboard behavior. Every page includes a visible-on-focus skip link targeting the main landmark. Controls use a 3px focus outline with offset; form inputs retain visible boundaries and labels. Keep icons decorative with `aria-hidden` when accompanying text. Announcements use existing status/live regions. Support `prefers-reduced-motion` by removing transitions/animations. Header actions wrap without a JavaScript dependency; no inactive mobile toggle is shown.

Test at 320, 375, 768, 1024 and 1440px. Verify overflow, font loading, labels, focus order, contrast, error states, 200% zoom and long content. Automated axe checks are a useful gate, not a complete WCAG certification. Manual screen-reader and assistive technology testing remains necessary.

## Applying future branding and features

Keep tokens in the root block, component styles below them and responsive/reduced-motion rules last. Bind future marketplace/admin layouts to these primitives. Do not add dashboards with invented statistics, fake product cards, disabled navigation to unfinished features or public admin creation. The gold accent never implies official college endorsement.
