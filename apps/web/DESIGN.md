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
  - the latest changes
  - a closing call to action

  Each section uses a different layout.

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
steps, white panels with hairline borders and soft neutral shadows. One accent,
amber `#ffb224`, is used for primary actions only.

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

Geist and Geist Mono, self-hosted by `next/font`. Headlines are weight 600 at
-0.05em, two lines at most where the space allows. Buttons and tabs are pills.
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

## Do not

- Add an announcement badge, a label above a heading, or a decorative gradient.
- Animate a keyboard-initiated action.
- Copy or redraw a provider's logo. Use the files and add sources for new ones.
- Use em dashes in visible copy, or show raw backticks: impact text goes
  through `Inline`.
