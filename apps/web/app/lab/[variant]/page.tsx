import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Features } from "../../../components/Features";
import { HeroLight, HeroProduct, HeroRadar } from "../../../components/Heroes";
import { LogoStrip } from "../../../components/LogoStrip";
import { windowItems } from "../../../lib/home";
import { listProviders, recentReleases } from "../../../lib/queries";

/**
 * Hero concepts for choosing a direction: /lab/a, /lab/b, /lab/c. Not linked
 * from the site and not indexed; removed once one is chosen.
 */
export const metadata: Metadata = { title: "Hero concepts", robots: { index: false, follow: false } };
export const revalidate = 300;

const VARIANTS = {
  a: { name: "A: Radar", Hero: HeroRadar },
  b: { name: "B: Product", Hero: HeroProduct },
  c: { name: "C: Light", Hero: HeroLight },
} as const;

/** Concept C is a light page: the whole palette flips, masthead included. */
const LIGHT = `:root{color-scheme:light;--bg:#fbfbfc;--bg-2:#f4f4f6;--panel:#fff;--panel-2:#fff;--line:rgb(0 0 0/8%);--line-2:rgb(0 0 0/13%);--text:#0b0b0f;--text-2:#4a4a55;--text-3:#6b6b76;--amber:#ffb224;--amber-2:#ffc53d;--amber-ink:#1d1404;--amber-glow:rgb(255 178 36/22%);--sev-breaking:#dc3e42;--sev-deprecation:#b26a00;--sev-behavioral:#0b75d8;--sev-additive:#218358;--code-bg:#f6f6f8;--code-text:#26262e;--masthead-bg:rgb(251 251 252/80%);--window-bg:#fff;--tint:rgb(0 0 0/3%);--tint-2:rgb(0 0 0/6%);--selection:rgb(255 178 36/35%)}`;

export default async function LabPage({ params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  const chosen = VARIANTS[variant as keyof typeof VARIANTS];
  if (!chosen) notFound();
  const [releases, providers] = await Promise.all([recentReleases(20, undefined, { preferSignal: true }), listProviders()]);
  const items = windowItems(releases);
  const watched = [...providers].sort((a, b) => b.breakingCount - a.breakingCount).map((p) => ({ slug: p.slug, name: p.name }));
  const { Hero } = chosen;

  return (
    <main>
      {variant === "c" ? <style dangerouslySetInnerHTML={{ __html: LIGHT }} /> : null}
      <nav className="lab-switch shell" aria-label="Hero concepts">
        {Object.entries(VARIANTS).map(([key, v]) => (
          <a key={key} href={`/lab/${key}`} aria-current={key === variant ? "page" : undefined}>
            {v.name}
          </a>
        ))}
      </nav>
      <Hero providers={watched} items={items} />
      <div className="shell">
        <LogoStrip providers={watched} label={`Watching ${watched.length} APIs`} />
      </div>
      <section className="section" aria-labelledby="features-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="features-title">Everything a vendor changes, read from your side</h2>
            <p>What Driftwatch catches, how it explains it, and how you get it.</p>
          </div>
          <Features />
        </div>
      </section>
    </main>
  );
}
