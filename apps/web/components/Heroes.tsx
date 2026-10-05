import { Broadcast } from "@phosphor-icons/react/ssr";

import { Inline } from "./Inline";
import { SeverityMark } from "./Marks";
import { Mark, ProductWindow, type WindowItem } from "./ProductWindow";
import { ProviderLogo, providerMark } from "./ProviderLogo";

/**
 * Three hero concepts, shown side by side at /lab so the direction is chosen
 * from rendered pages rather than descriptions. All three use live data.
 */

export interface HeroProps {
  providers: { slug: string; name: string }[];
  items: WindowItem[];
}

const HEADLINE = "Know when an API you depend on breaks your code.";

function sub(providers: HeroProps["providers"]): string {
  const featured = ["stripe", "openai", "github"]
    .map((slug) => providers.find((p) => p.slug === slug)?.name)
    .filter(Boolean);
  const others = providers.length - featured.length;
  return featured.length === 3 && others > 0
    ? `Driftwatch reads the specs of ${featured.join(", ")} and ${others} more APIs, and tells you which calls a change breaks.`
    : "Driftwatch reads the specs of the APIs you depend on, and tells you which calls a change breaks.";
}

function Pill({ count }: { count: number }) {
  return (
    <a className="announce" href="/providers">
      <span className="announce-dot" aria-hidden="true" />
      Watching {count} APIs, checked every six hours
    </a>
  );
}

function Actions() {
  return (
    <div className="hero-actions">
      <a className="btn btn-lg" href="/watch">
        Get early access
      </a>
      <a className="btn btn-ghost btn-lg" href="/#changes">
        Browse changes
      </a>
    </div>
  );
}

function Toast({ item, className = "" }: { item: WindowItem; className?: string }) {
  return (
    <a className={`toast ${className}`} href={item.href} data-severity={item.severity}>
      <span className="toast-logo">
        <Mark item={item} size={18} />
      </span>
      <span className="toast-text">
        <span className="toast-meta">
          {item.providerName} <SeverityMark severity={item.severity} />
        </span>
        <span className="toast-title">
          <Inline text={item.headline} />
        </span>
      </span>
    </a>
  );
}

/* ── A: radar ──────────────────────────────────────────────────────── */

const RINGS = [170, 300, 430, 560];

export function HeroRadar({ providers, items }: HeroProps) {
  const shown = providers.slice(0, 12);
  const nodes = shown.map((p, i) => {
    const ring = RINGS[1 + (i % 3)]!;
    // Spread across the upper arc, 200° to 340°, alternating rings.
    const angle = (200 + (i * 140) / Math.max(1, shown.length - 1)) * (Math.PI / 180);
    return { ...p, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring };
  });
  const lead = items[0];
  const pinged = lead ? nodes.find((n) => n.slug === lead.providerSlug) : undefined;

  return (
    <section className="hero-a" aria-labelledby="hero-a-title">
      <div className="shell hero-a-copy">
        <Pill count={providers.length} />
        <h1 id="hero-a-title">{HEADLINE}</h1>
        <p className="hero-sub">{sub(providers)}</p>
        <Actions />
      </div>
      <div className="radar" aria-hidden="true">
        {RINGS.map((r) => (
          <span key={r} className="radar-ring" style={{ width: r * 2, height: r * 2 }} />
        ))}
        <span className="radar-sweep" />
        <span className="radar-core">
          <Broadcast size={26} weight="duotone" />
        </span>
        {nodes.map((n) => (
          <span
            key={n.slug}
            className={`radar-node${n === pinged ? " is-pinged" : ""}`}
            style={{ transform: `translate(calc(-50% + ${n.x.toFixed(0)}px), calc(-50% + ${n.y.toFixed(0)}px))` }}
            title={n.name}
          >
            <ProviderLogo slug={n.slug} name={n.name} size={20} />
          </span>
        ))}
      </div>
      {lead ? (
        <div className="shell radar-toast-wrap">
          <Toast item={lead} className="radar-toast" />
        </div>
      ) : null}
    </section>
  );
}

/* ── B: product ────────────────────────────────────────────────────── */

export function HeroProduct({ providers, items }: HeroProps) {
  return (
    <section className="hero-b" aria-labelledby="hero-b-title">
      <div className="aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="grid-fade" aria-hidden="true" />
      <div className="shell hero-b-top">
        <div>
          <Pill count={providers.length} />
          <h1 id="hero-b-title">{HEADLINE}</h1>
          <p className="hero-sub">{sub(providers)}</p>
          <Actions />
        </div>
        <div className="toast-stack" aria-label="Latest breaking changes">
          {items.slice(0, 3).map((item, i) => (
            <Toast key={item.id} item={item} className={`toast-${i}`} />
          ))}
        </div>
      </div>
      <div className="shell">
        <div className="tilt">{items.length > 0 ? <ProductWindow items={items} /> : null}</div>
      </div>
    </section>
  );
}

/* ── C: light, floating logos ──────────────────────────────────────── */

const SPOTS = [
  { left: "6%", top: "14%" },
  { left: "14%", top: "52%" },
  { left: "4%", top: "80%" },
  { left: "22%", top: "88%" },
  { left: "88%", top: "12%" },
  { left: "80%", top: "46%" },
  { left: "92%", top: "70%" },
  { left: "74%", top: "86%" },
  { left: "28%", top: "6%" },
  { left: "66%", top: "4%" },
];

export function HeroLight({ providers, items }: HeroProps) {
  const floating = providers.filter((p) => providerMark(p.slug)).slice(0, SPOTS.length);
  return (
    <section className="hero-c" aria-labelledby="hero-c-title">
      <div className="hero-c-stage">
        {floating.map((p, i) => {
          const mark = providerMark(p.slug)!;
          return (
            <span
              key={p.slug}
              className="float-tile"
              style={{ ...SPOTS[i], color: `#${mark.hex}`, animationDelay: `${i * -0.7}s` }}
              title={p.name}
              aria-hidden="true"
            >
              <ProviderLogo slug={p.slug} name={p.name} size={26} />
            </span>
          );
        })}
        <div className="shell hero-c-copy">
          <Pill count={providers.length} />
          <h1 id="hero-c-title">{HEADLINE}</h1>
          <p className="hero-sub">{sub(providers)}</p>
          <Actions />
        </div>
      </div>
      <div className="shell hero-c-window">{items.length > 0 ? <ProductWindow items={items} /> : null}</div>
    </section>
  );
}
