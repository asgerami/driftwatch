import type { Metadata } from "next";
import { Bricolage_Grotesque, Funnel_Display, Funnel_Sans, Hubot_Sans, Mona_Sans } from "next/font/google";
import { notFound } from "next/navigation";

import HomePage from "../../../page";

/**
 * Type and accent pairings for choosing between, on the real home page:
 * /lab/type/1, /2, /3. Not linked or indexed; removed once one is chosen.
 */
export const metadata: Metadata = { title: "Type pairings", robots: { index: false, follow: false } };
export const revalidate = 300;

const bricolage = Bricolage_Grotesque({ subsets: ["latin"], display: "swap" });
const hubot = Hubot_Sans({ subsets: ["latin"], display: "swap", axes: ["wdth"] });
const mona = Mona_Sans({ subsets: ["latin"], display: "swap" });
const funnelDisplay = Funnel_Display({ subsets: ["latin"], display: "swap" });
const funnelSans = Funnel_Sans({ subsets: ["latin"], display: "swap" });

const PAIRINGS = {
  "1": {
    name: "Bricolage Grotesque, signal orange",
    fonts: [bricolage.className],
    css: `--f-display:${bricolage.style.fontFamily};--f-sans:${bricolage.style.fontFamily};--amber:#ff5c1f;--amber-2:#ff7a45;--amber-ink:#160600;--amber-soft:rgb(255 92 31/12%);--accent-strong:#c2410c;`,
    extra: `h1,h2,h3,.wordmark{font-variation-settings:"opsz" 96;letter-spacing:-0.035em}.hero h1{font-weight:800}`,
  },
  "2": {
    name: "Hubot Sans with Mona Sans, cobalt",
    fonts: [hubot.className, mona.className],
    css: `--f-display:${hubot.style.fontFamily};--f-sans:${mona.style.fontFamily};--amber:#2f4bff;--amber-2:#4a62ff;--amber-ink:#ffffff;--amber-soft:rgb(47 75 255/10%);--accent-strong:#2f4bff;`,
    extra: `h1,h2,h3,.wordmark{font-stretch:125%;letter-spacing:-0.02em}.hero h1{font-weight:800;letter-spacing:-0.025em}`,
  },
  "3": {
    name: "Funnel Display with Funnel Sans, electric lime",
    fonts: [funnelDisplay.className, funnelSans.className],
    css: `--f-display:${funnelDisplay.style.fontFamily};--f-sans:${funnelSans.style.fontFamily};--amber:#c6f135;--amber-2:#d4f75f;--amber-ink:#0b0f02;--amber-soft:rgb(140 190 20/16%);--accent-strong:#4d7c0f;`,
    extra: `.hero h1{font-weight:700;letter-spacing:-0.04em}`,
  },
} as const;

export default async function TypeLab({ params }: { params: Promise<{ v: string }> }) {
  const { v } = await params;
  const pairing = PAIRINGS[v as keyof typeof PAIRINGS];
  if (!pairing) notFound();
  return (
    <div className={pairing.fonts.join(" ")}>
      <style dangerouslySetInnerHTML={{ __html: `:root{${pairing.css}}${pairing.extra}` }} />
      <nav className="lab-switch shell" aria-label="Type pairings">
        {Object.entries(PAIRINGS).map(([key, p]) => (
          <a key={key} href={`/lab/type/${key}`} aria-current={key === v ? "page" : undefined}>
            {key}. {p.name}
          </a>
        ))}
      </nav>
      <HomePage />
    </div>
  );
}
