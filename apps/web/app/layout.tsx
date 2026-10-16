import type { Metadata, Viewport } from "next";
import { Funnel_Display, Funnel_Sans, Geist_Mono } from "next/font/google";

import "./globals.css";
import { LogoMark } from "../components/Marks";
import { Nav } from "../components/Nav";
import { SITE_URL } from "../lib/site";

// Self-hosted at build time by next/font: no request to Google from a visitor.
// Funnel Display for headings, Funnel Sans for text, Geist Mono for code.
const display = Funnel_Display({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const sans = Funnel_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

/**
 * Cloudflare Web Analytics for driftwatch.et. The token is public by design:
 * it ships in every page's HTML. Production only: the deploy workflow sets
 * DEPLOY_ENV=production for the build and the Worker, so preview versions and
 * local builds don't count as visits. NEXT_PUBLIC_CF_BEACON_TOKEN overrides
 * it, e.g. for a fork.
 */
const CF_BEACON_TOKEN =
  process.env["NEXT_PUBLIC_CF_BEACON_TOKEN"] ??
  (process.env["DEPLOY_ENV"] === "production" ? "4fc3240a453d4d3698500762795d7216" : undefined);

const DESCRIPTION =
  "Breaking-change alerts for the third-party APIs your code depends on.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Driftwatch: breaking changes in the APIs you depend on", template: "%s · Driftwatch" },
  description: DESCRIPTION,
  openGraph: { siteName: "Driftwatch", type: "website", description: DESCRIPTION },
  twitter: { card: "summary_large_image" },
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": "/rss.xml", "application/feed+json": "/feed.json" },
  },
};

export const viewport: Viewport = {
  themeColor: "#fbfbfc",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="masthead">
          <div className="shell masthead-inner">
            <a className="wordmark" href="/" aria-label="Driftwatch, home">
              <LogoMark />
              Driftwatch
            </a>
            <Nav />
          </div>
        </header>
        <div id="main">{children}</div>
        {CF_BEACON_TOKEN ? (
          // Cloudflare Web Analytics: no cookies, no personal data, free.
          // Off unless the token is set at build time.
          <script
            type="module"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
          />
        ) : null}
        <footer className="footer">
          <div className="shell footer-inner">
            <div>
              <a className="wordmark" href="/">
                <LogoMark size={22} />
                Driftwatch
              </a>
              <p>
                Breaking-change alerts for the APIs you depend on. Not affiliated
                with any provider listed.
              </p>
            </div>
            <div>
              <h2>Read</h2>
              <ul>
                <li><a href="/">Latest changes</a></li>
                <li><a href="/providers">APIs watched</a></li>
                <li><a href="/method">How severity is decided</a></li>
              </ul>
            </div>
            <div>
              <h2>Subscribe</h2>
              <ul>
                <li><a href="/rss.xml">RSS feed</a></li>
                <li><a href="/feed.json">JSON feed</a></li>
                <li><a href="/watch">Get early access</a></li>
              </ul>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
