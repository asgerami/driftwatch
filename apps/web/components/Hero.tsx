import { ProductWindow, type WindowItem } from "./ProductWindow";
import { ProviderLogo, logoSrc } from "./ProviderLogo";

/** The most recognisable of the APIs watched, floating around the headline. */
const FLOATING = ["stripe", "openai", "github", "cloudflare", "twilio", "vercel", "discord", "zoom", "plaid", "clerk"];

const SPOTS = [
  { left: "7%", top: "18%" },
  { left: "15%", top: "50%" },
  { left: "5%", top: "76%" },
  { left: "21%", top: "78%" },
  { left: "86%", top: "16%" },
  { left: "79%", top: "48%" },
  { left: "92%", top: "70%" },
  { left: "74%", top: "78%" },
  { left: "28%", top: "8%" },
  { left: "66%", top: "6%" },
];

export function Hero({ providers, items }: { providers: { slug: string; name: string }[]; items: WindowItem[] }) {
  const floating = FLOATING.map((slug) => providers.find((p) => p.slug === slug))
    .filter((p): p is { slug: string; name: string } => !!p && !!logoSrc(p.slug))
    .slice(0, SPOTS.length);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-stage">
        {floating.map((p, i) => (
          <span
            key={p.slug}
            className="float-tile"
            style={{ ...SPOTS[i], ["--i" as string]: i }}
            title={p.name}
            aria-hidden="true"
          >
            <ProviderLogo slug={p.slug} name={p.name} size={28} />
          </span>
        ))}
        <div className="shell hero-copy">
          <div className="hero-logos" aria-hidden="true">
            {floating.slice(0, 6).map((p, i) => (
              <span key={p.slug} className="mini-tile" style={{ ["--i" as string]: i }}>
                <ProviderLogo slug={p.slug} name={p.name} size={22} />
              </span>
            ))}
          </div>
          <h1 id="hero-title">Know when an API you depend on breaks your code.</h1>
          <p className="hero-sub">
            Driftwatch monitors the third-party APIs your product depends on and alerts
            you to the changes that break your code.
          </p>
          <div className="hero-actions">
            <a className="btn btn-lg" href="/watch">
              Get early access
            </a>
            <a className="btn btn-ghost btn-lg" href="#changes">
              Browse changes
            </a>
          </div>
        </div>
      </div>
      <div className="shell hero-window">{items.length > 0 ? <ProductWindow items={items} /> : null}</div>
    </section>
  );
}
