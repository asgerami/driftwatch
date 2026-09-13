import type { Metadata } from "next";
import { Scale } from "../components/Scale";
import "./globals.css";

export const metadata: Metadata = {
  title: "Driftwatch",
  description:
    "What your API vendors changed, from the calling end. Spec-derived, severity assigned deterministically.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Overpass:wght@400;600&family=Chivo+Mono:wght@400;700&display=swap"
        />
      </head>
      <body>
        <div className="shell">
          <header className="masthead">
            <a className="wordmark" href="/">
              drift<span>watch</span>
            </a>
            <Scale />
            <nav className="nav">
              <a href="/">Watch</a>
              <a href="/feed">Feed</a>
              <a href="/providers">Stations</a>
              <a href="/method">Method</a>
              <a href="/api/feed.json">JSON</a>
            </nav>
          </header>
          {children}
          <footer className="footer">
            <span>Spec-derived. Severity is a reflectivity scale, not a model.</span>
            <span>Not affiliated with any provider listed.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
