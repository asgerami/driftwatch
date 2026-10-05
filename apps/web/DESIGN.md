# Driftwatch design

The site's visual system, and why. Read this before changing how anything looks.

## How it was decided

The direction came from research first, not taste. The second redesign
replaced a first attempt that had no basis in how developer-tool startups
present themselves.

- **Skills.** The design skills used are installed in `~/.claude/skills`:
  - `frontend-design` (Anthropic): the plan-then-review process, and avoiding generic patterns
  - `ui-ux-pro-max`: the "Product Demo" and "Real-Time / Operations" landing patterns, and the dark developer-tool styling
  - `design-taste-frontend`: hero discipline, one label per action, the pre-flight checks
  - `emil-design-eng`: motion
- **References.** The opening screens of Linear, Trigger.dev and Inngest share one
  pattern: dark-first, one confident headline, two actions, and the product itself
  shown large right below.
- **Chosen with Amir.** Dark, with an amber accent.

## The page's one idea

The hero shows the product, not a picture of it. `ProductWindow` is an inbox of
the latest published changes, built on the server from real data. Choosing one
shows what it breaks and the code that fails. Everything around it stays quiet.

## Colour

The site is dark only. Zinc neutrals, plus one accent: amber, the colour of a
warning light, which is what Driftwatch is. No large developer tool uses amber,
so it stands out. Amber marks actions (buttons, focus, the soft glow behind the
window). Severity colours are reserved for severity.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` / `--bg-2` | `#09090b` / `#0e0e11` | page, sunken panels |
| `--panel` / `--panel-2` | `#121215` / `#18181c` | raised surfaces, menus |
| `--line` / `--line-2` | white at 8% / 13% | borders |
| `--text` / `--text-2` / `--text-3` | `#ededef` / `#a8a8b3` / `#7a7a85` | text, three steps |
| `--amber` | `#ffb224` | actions, focus, glow |
| severities | `#ff6b6b` breaking, amber deprecation, `#74b8ff` behavioural, `#45d18f` additive | marks only |

Severity is always a drawn mark plus a word, never colour alone (`SeverityMark`):

- breaking: a diamond
- deprecation: a triangle
- behavioural: a half-filled circle
- additive: a plus

## Type

Geist for everything, Geist Mono for code, paths and field names, both
self-hosted by `next/font`. Headlines are weight 600 at -0.045em, two lines at
most. Body text is 16px at 1.6 line height.

## Shape and motion

- Buttons and tabs are pills. Panels use a 14px radius, inner elements 10px or
  6px. Borders are white hairlines; there are no grey drop shadows on cards.
- One label per action: "Get early access" everywhere it appears.
- Motion follows Emil Kowalski's rules:
  - transitions name their properties
  - a strong ease-out (`--ease-out`)
  - interface motion under 300ms
  - `scale(0.97)` when pressed
  - hover effects only on devices that can hover
  - a 2px blur bridging the product window's crossfade
  - everything off under `prefers-reduced-motion`

  The window's entrance is the one orchestrated moment.

## Do not

- Put labels above headings, number things that are not a sequence, highlight a
  single word in a headline, or append arrows to button text.
- Make rows of identical cards, or reuse a layout between two home sections.
- Use em dashes in visible copy.
- Show raw backticks: impact text goes through `Inline`.
