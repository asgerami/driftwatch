import {
  siAdyen,
  siAsana,
  siBox,
  siClerk,
  siCloudflare,
  siDatadog,
  siDiscord,
  siGithub,
  siHetzner,
  siJira,
  siPagerduty,
  siResend,
  siSquare,
  siStripe,
  siVercel,
  siZoom,
} from "simple-icons";

/**
 * Provider marks from Simple Icons (CC0), shown only to say which APIs are
 * watched; Driftwatch is not affiliated with any of them, as the footer says.
 * Brands that asked Simple Icons to remove their mark (OpenAI, Twilio, Plaid,
 * Mux, SendGrid) get a lettermark instead of an imitation.
 */
const MARKS: Record<string, { path: string; hex: string }> = {
  adyen: siAdyen,
  asana: siAsana,
  box: siBox,
  clerk: siClerk,
  cloudflare: siCloudflare,
  datadog: siDatadog,
  discord: siDiscord,
  github: siGithub,
  hetzner: siHetzner,
  jira: siJira,
  pagerduty: siPagerduty,
  resend: siResend,
  square: siSquare,
  stripe: siStripe,
  vercel: siVercel,
  zoom: siZoom,
};

export function providerMark(slug: string): { path: string; hex: string } | undefined {
  return MARKS[slug];
}

/** A provider's mark in currentColor, or its initial when it has none. */
export function ProviderLogo({ slug, name, size = 20 }: { slug: string; name: string; size?: number }) {
  const mark = MARKS[slug];
  if (!mark) {
    return (
      <span className="lettermark" style={{ width: size, height: size, fontSize: size * 0.56 }} aria-hidden="true">
        {name.charAt(0)}
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={mark.path} />
    </svg>
  );
}
