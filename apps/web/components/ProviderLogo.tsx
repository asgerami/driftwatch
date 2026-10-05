/**
 * Provider logos, shown only to say which APIs are watched. Driftwatch is not
 * affiliated with any of them, as the footer says. The files and where each
 * came from are in public/logos (SOURCES.md).
 */
const LOGOS = new Set([
  "adyen", "asana", "box", "clerk", "cloudflare", "datadog", "discord", "github", "hetzner", "jira", "mux",
  "openai", "pagerduty", "plaid", "resend", "sendgrid", "square", "stripe", "twilio", "vercel", "zoom",
]);

export function logoSrc(slug: string): string | undefined {
  return LOGOS.has(slug) ? `/logos/${slug}.svg` : undefined;
}

/** A provider's logo, or its initial when there is no file for it. */
export function ProviderLogo({ slug, name, size = 20 }: { slug: string; name: string; size?: number }) {
  const src = logoSrc(slug);
  if (!src) {
    return (
      <span className="lettermark" style={{ width: size, height: size, fontSize: size * 0.56 }} aria-hidden="true">
        {name.charAt(0)}
      </span>
    );
  }
  // Decorative next to the provider's name, which is always present as text.
  return <img className="logo" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" />;
}
