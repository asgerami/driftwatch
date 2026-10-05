# Driftwatch design

The site's visual system, and why. Read this before changing how anything looks.

## Direction

Driftwatch is the *Notices to Mariners* of the APIs a team builds on. Mariners
navigate by charts, and an official bulletin publishes corrections to those
charts. The site borrows that world: the nautical chart and its notices. It
avoids the terminal and the newspaper, which are where every devtool and every
changelog end up.

- **Mode.** The home page persuades: it says what this is, proves it with a real
  change, and offers one action. Change, API and method pages are for reading: a
  calm column at a readable width, with the chart world kept to the frame.
- **Signature moment.** Depth contours behind the home page's first screen,
  drawn once on load (`Contours` in `components/Marks.tsx`). Nothing else on the
  site performs.

## Colour

The palette is restrained: tinted chart neutrals plus one accent, chart
magenta, the colour charts use for hazards. It marks a breaking change and
nothing else competes with it. Light mode is the day chart; dark mode is the
night palette ship displays use. Both follow the visitor's system setting.

| Token | Day | Night | Use |
| --- | --- | --- | --- |
| `--ground` | `#f3f6f7` | `#0a1217` | page |
| `--band` | `#e7eef1` | `#0e191f` | hero, footer, quiet panels |
| `--surface` | `#fbfcfc` | `#101d24` | raised: notice card, form, facts |
| `--ink` / `--ink-2` / `--ink-3` | `#0e1c25` / `#3c4f5b` / `#576a75` | `#d8e4ea` / `#a3b6c0` / `#8599a4` | text, three steps |
| `--accent` | `#b0146a` | `#f26aad` | breaking, focus, links on hover |

Severity is always a drawn mark plus a word, never colour alone
(`SeverityMark`):

- breaking: the isolated-danger diamond
- deprecation: a caution triangle
- behavioural: a half-lit circle
- additive: a plus

## Type

Schibsted Grotesk sets everything, using its real italics for emphasis.
JetBrains Mono is only for code, paths and field names. `next/font` self-hosts
both. Display tracking sits around -0.035em; body text is 17px at 1.6 line
height, at most 68 characters wide.

## Shape and motion

- One corner radius, 3px, everywhere. Hairline rules, plus a 2px ink rule to
  open a list.
- Motion follows Emil Kowalski's rules:
  - transitions name their properties; never `all`
  - a strong ease-out (`--ease-out`)
  - interface motion under 300ms
  - `scale(0.97)` when pressed
  - hover effects only on devices that can hover
  - everything off under `prefers-reduced-motion`

  The contours (1.6s) and the proof card's rise are the one explanatory moment
  allowed to run longer.

## Rules kept from the design skills

Three design skills shaped this: Impeccable, Taste, and Emil Kowalski's
design-engineering skill. These are the rules that matter day to day:

- No eyebrow labels above headings, no section numbers, no coloured side
  stripes on cards, no gradient text, no em dashes in visible copy.
- No hero-metric blocks, no row of three equal cards, and no two home
  sections in the same layout.
- The impact templates mark identifiers with backticks. Render that text
  through `Inline`; never show the backticks raw.
- Browser surfaces use the palette too: text selection, the text cursor, focus
  rings, scrollbars.
