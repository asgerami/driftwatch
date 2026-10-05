# Driftwatch design

The site's visual system, and why. Read this before changing how anything looks.

## How it was decided

- **Skills.** The design skills used are installed in `~/.claude/skills`:
  - `frontend-design` (Anthropic)
  - `ui-ux-pro-max`: its "Product Demo" landing pattern
  - `design-taste-frontend`: hero and pre-flight rules
  - `emil-design-eng`: a motion review, with its fixes applied
- **References.** Linear, Trigger.dev and Inngest; the hero patterns on 21st.dev.
- **Chosen with Amir.** Three hero concepts were built and compared on live data
  (radar, product, light). He chose the light one, then asked for:
  - no announcement badge
  - accurate provider logos
  - no decorative gradients
  - Emil Kowalski's motion rules applied

  Geist read as generic, so three type and accent pairings were compared on
  the real home page (Bricolage Grotesque with orange, Hubot Sans with cobalt,
  Funnel with lime). Amir chose Funnel with lime.

## The page

- **Hero.** A centred headline with two actions. Logo tiles of the most
  recognisable APIs watched float around it on desktop, and sit in one row on
  phones. Below it is the product: `ProductWindow`, an inbox of the latest
  published changes from real data. Choosing a change shows what it breaks and the
  code that fails.
- **Then:**
  - a scrolling logo strip (grey; each logo takes its colour on hover)
  - a feature grid with Phosphor icons
  - the "their changelog against your code" tabs
  - a real Plaid change from spec diff to fix PR
  - the latest releases, one row each (`ReleaseDigest`): the most serious
    change, how many more there are, and a link to the story. The full cards
    are on each API's page; on the home page they made the section several
    screens long.
  - a closing call to action

  Each section uses a different layout.

## Mark

A solid D cut across its middle, the lower half slid out of line: one
contract, two sides that no longer meet. Lime `#c6f135` on a near-black ink
tile `#0b0f02`, 32 units square with an 8-unit radius. Chosen by Amir from
three concepts (a sheared D, a sheared disc, a slipped D) after a gauge read
as any monitoring tool.

The paths live in `components/brand.ts`. `LogoMark` and the share card use
them. The icon files are drawn from the same paths:
- `app/icon.svg`
- `app/favicon.ico`: 16, 32 and 48px; the 16px frame is redrawn on the pixel
  grid so the cut stays one clean pixel
- `app/apple-icon.png`: full bleed, since iOS rounds it
- `public/icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` with the
  glyph inside the safe circle, all listed in `app/manifest.ts`

Change them together; `rsvg-convert` renders the PNGs.

## Logos

Real files in `public/logos/`, with their sources listed in `SOURCES.md`:

- svgl.app for most of them
- Simple Icons for the rest
- Plaid's and SendGrid's marks, cropped from their logos

`ProviderLogo` renders them and falls back to a lettermark when no file exists.
They appear in the hero, the strip, the APIs table, each API page's title, the
feed and the signup form. The footer states that Driftwatch is not affiliated
with any provider.

## Colour

The site is light only. Near-white ground (`#fbfbfc`), near-black text in three
steps, white panels with hairline borders and soft neutral shadows. One accent, lime
`#c6f135` (`--accent`), fills primary actions, with near-black text on it.
Lime is too light for text or thin lines on white, so links, icons, focus rings
and the wordmark use its dark form, `#4d7c0f` (`--accent-strong`).

Severity colours are reserved for severity, and always come as a drawn mark plus
a word:

| Severity | Colour | Mark |
| --- | --- | --- |
| Breaking | `#dc3e42` | diamond |
| Deprecation | `#b26a00` | triangle |
| Behavioural | `#0b75d8` | half-filled circle |
| Additive | `#218358` | plus |

There are no decorative gradients. The only gradient is the marquee's edge fade.

## Type and shape

Funnel Display for headings and the wordmark (`--f-display`), Funnel Sans for
text, Geist Mono for code, all self-hosted by `next/font`. The hero headline is
weight 700 at -0.04em, other headings 600; two lines at most where the space
allows. Buttons and tabs are pills.
Panels use a 14px radius, tiles 13 to 18px.

## Motion

These are Emil Kowalski's rules, as his skill's review applied them:

- **Press feedback:** `scale(0.97)` on buttons and tabs, `scale(0.985)` on
  full-width inbox rows, at 140ms with a strong ease-out.
- **Hover:** only on devices that can hover.
- **The hero's one moment:** logo tiles scale in 60ms apart, then drift slowly.
  The entrance and the drift animate different properties (`scale`,
  `translate`), so neither overrides the other.
- **The product window:** switches with a 90ms blur bridge on a pointer click,
  and instantly from the keyboard or under reduced motion.
- **Tabs:** switch instantly; only hover colour eases.
- **Reduced motion:** removes movement and keeps fades and colour.

## Copy

Marketing copy states the service: what changed, what it breaks, how to fix
it. It does not explain the machinery (specs, diffs, typechecks, schedules).
That belongs on `/method`, which exists to publish exactly that.

No counts that drift: not how many APIs are watched, not how often they are
checked. Name a few providers and say "and more". Live data, such as the
breaking-change counts in the APIs table, is fine, because it is always
current.

Something clickable looks clickable: a button, or a `.link`, which is
underlined accent text. Never a bare bold word.

## Do not

- Add an announcement badge, a label above a heading, or a decorative gradient.
- Animate a keyboard-initiated action.
- Copy or redraw a provider's logo. Use the files and add sources for new ones.
- Use em dashes in visible copy, or show raw backticks: impact text goes
  through `Inline`.
