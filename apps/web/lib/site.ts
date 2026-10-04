/**
 * The site's canonical origin.
 *
 * Feeds, canonical URLs and the sitemap must name the public domain, never
 * the host a request happened to arrive on: on Netlify that is often the
 * deploy's internal hostname, which a redirect once sent feed readers to.
 */
export const SITE_URL = (process.env["SITE_URL"] ?? "https://driftwatch.et").replace(/\/+$/, "");

export function absolute(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
