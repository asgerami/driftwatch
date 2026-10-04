import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL } from "../lib/site";

const DESCRIPTION =
  "What your API vendors changed, from the calling end. Spec-derived, severity assigned deterministically.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Driftwatch — breaking changes in the APIs you depend on", template: "%s · Driftwatch" },
  description: DESCRIPTION,
  openGraph: { siteName: "Driftwatch", type: "website", description: DESCRIPTION },
  twitter: { card: "summary_large_image" },
  alternates: {
    canonical: "/",
    types: { "application/rss+xml": "/rss.xml", "application/feed+json": "/feed.json" },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;700&display=swap"
        />
      </head>
      <body>
        <div className="shell">
          <header className="masthead">
            <a className="wordmark" href="/">
              drift<span>watch</span>
            </a>
            <nav className="nav">
              <a href="/">Feed</a>
              <a href="/providers">Providers</a>
              <a href="/method">Method</a>
              <a href="/watch">Watch my repo</a>
              <a href="/api/feed.json">JSON</a>
            </nav>
          </header>
          {children}
          <footer className="footer">
            <span>Spec-derived. Severity is deterministic.</span>
            <span>Not affiliated with any provider listed.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
