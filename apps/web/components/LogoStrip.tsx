import { ProviderLogo } from "./ProviderLogo";

/**
 * The APIs watched, logo and name, scrolling. The list is doubled so the
 * marquee loops without a seam; the copy is hidden from assistive tech.
 * Under reduced motion it stops and wraps instead.
 */
export function LogoStrip({ providers, label }: { providers: { slug: string; name: string }[]; label: string }) {
  const row = (hidden: boolean) => (
    <ul className="marquee-row" aria-hidden={hidden || undefined}>
      {providers.map((p) => (
        <li key={p.slug}>
          <a href={`/apis/${p.slug}`} tabIndex={hidden ? -1 : undefined} className="logo-chip">
            <ProviderLogo slug={p.slug} name={p.name} size={20} />
            <span>{p.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <section className="logo-strip" aria-label={label}>
      <p className="logo-strip-label">{label}</p>
      <div className="marquee">
        <div className="marquee-track">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </section>
  );
}
