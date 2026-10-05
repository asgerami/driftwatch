import type { Metadata } from "next";

/**
 * Logo concepts, compared where the mark will live: the masthead, a browser
 * tab, a home-screen icon. Not linked or indexed; removed once one is chosen.
 */
export const metadata: Metadata = { title: "Logo concepts", robots: { index: false, follow: false } };

const INK = "#0b0f02";
const LIME = "#c6f135";

/** A solid D, cut across its middle, the lower half slid right. */
function shearedD(x: number, y: number, w: number, h: number, gap: number, shift: number) {
  const r = h / 2;
  const straight = w - r;
  const mid = y + h / 2;
  return [
    `M${x} ${y}H${x + straight}A${r} ${r} 0 0 1 ${x + w} ${mid - gap / 2}H${x}Z`,
    `M${x + shift} ${mid + gap / 2}H${x + w + shift}A${r} ${r} 0 0 1 ${x + straight + shift} ${y + h}H${x + shift}Z`,
  ];
}

const CONCEPTS = [
  {
    key: "sheared-d",
    name: "1. Sheared D",
    why: "The initial, cut across and slid out of line: one contract, two sides that no longer meet.",
    glyph: shearedD(6.5, 7, 17, 18, 1.8, 3).map((d) => <path key={d} d={d} fill={LIME} />),
  },
  {
    key: "sheared-disc",
    name: "2. Sheared disc",
    why: "The same break on a circle: the most abstract, the calmest at small sizes.",
    glyph: [
      <path key="t" d="M7 15.2a8 8 0 0 1 16 0Z" fill={LIME} />,
      <path key="b" d="M9.6 16.8a8 8 0 0 0 16 0Z" fill={LIME} />,
    ],
  },
  {
    key: "slipped-d",
    name: "3. Slipped D",
    why: "Stem and bowl of a D, the bowl slipped down a step: the most letter-like.",
    glyph: [
      <rect key="s" x="7" y="6.75" width="4.4" height="15" rx="1.2" fill={LIME} />,
      <path key="b" d="M13.6 11.45h2.4a7.4 7.4 0 0 1 0 14.8h-2.4" stroke={LIME} strokeWidth="4.4" fill="none" />,
    ],
  },
];

function Mark({ glyph, size, radius = 8 }: { glyph: React.ReactNode; size: number; radius?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx={radius} fill={INK} />
      {glyph}
    </svg>
  );
}

const CSS = `
.logo-lab{padding:56px 0 96px;display:grid;gap:28px}
.logo-lab h1{font-size:2rem;letter-spacing:-0.03em}
.concept{border:1px solid var(--line);border-radius:var(--r-lg);background:var(--panel);padding:28px;display:grid;gap:22px}
.concept h2{font-size:1.25rem}
.concept p{margin:4px 0 0;color:var(--text-2)}
.concept-row{display:flex;flex-wrap:wrap;align-items:center;gap:28px}
.lab-mast{display:flex;align-items:center;gap:10px;font-family:var(--f-display);font-weight:600;font-size:1.15rem;letter-spacing:-0.02em;padding:14px 18px;border:1px solid var(--line);border-radius:12px;background:var(--bg)}
.lab-tab{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:10px 10px 0 0;background:#dfe1e5;font:13px system-ui;color:#202124;min-width:200px}
.lab-tab.dark{background:#35363a;color:#e8eaed}
.lab-sizes{display:flex;align-items:end;gap:18px}
.lab-dark{display:flex;align-items:center;gap:18px;padding:16px 20px;border-radius:12px;background:#111}
.lab-dark .lab-word{color:#f5f5f5;font-family:var(--f-display);font-weight:600;font-size:1.15rem;letter-spacing:-0.02em}
.lab-phone{width:180px;height:180px;border-radius:40px;overflow:hidden;box-shadow:var(--shadow-md)}
`;

export default function LogoLab() {
  return (
    <main className="shell logo-lab">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <h1>Logo concepts</h1>
      {CONCEPTS.map((c) => (
        <section key={c.key} className="concept" aria-labelledby={`${c.key}-title`}>
          <div>
            <h2 id={`${c.key}-title`}>{c.name}</h2>
            <p>{c.why}</p>
          </div>
          <div className="concept-row">
            <div className="lab-mast">
              <Mark glyph={c.glyph} size={26} radius={7.5} />
              Driftwatch
            </div>
            <div className="lab-tab">
              <Mark glyph={c.glyph} size={16} radius={7} />
              Driftwatch: breaking changes…
            </div>
            <div className="lab-tab dark">
              <Mark glyph={c.glyph} size={16} radius={7} />
              Driftwatch: breaking changes…
            </div>
          </div>
          <div className="concept-row">
            <div className="lab-sizes">
              {[16, 24, 32, 48, 64].map((s) => (
                <Mark key={s} glyph={c.glyph} size={s} />
              ))}
            </div>
            <div className="lab-dark">
              <Mark glyph={c.glyph} size={26} radius={7.5} />
              <span className="lab-word">Driftwatch</span>
            </div>
            <div className="lab-phone">
              <Mark glyph={c.glyph} size={180} radius={0} />
            </div>
          </div>
        </section>
      ))}
    </main>
  );
}
