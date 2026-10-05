/**
 * The 1200×630 share image. Rendered by next/og (Satori), which supports a
 * subset of CSS: flexbox only, inline styles, no external fonts here.
 *
 * The site's palette: zinc dark, amber for the brand, severity colours as on
 * the site, with the severity's own mark.
 */

const INK = "#ededef";
const QUIET = "#8a8a95";
const GROUND = "#09090b";
const AMBER = "#ffb224";

const SEVERITY: Record<string, { color: string; label: string }> = {
  BREAKING: { color: "#ff6b6b", label: "Breaking" },
  DEPRECATION: { color: AMBER, label: "Deprecation" },
  BEHAVIORAL: { color: "#74b8ff", label: "Behavioral" },
  ADDITIVE: { color: "#45d18f", label: "Additive" },
  COSMETIC: { color: QUIET, label: "Cosmetic" },
};

export const OG_SIZE = { width: 1200, height: 630 };

export function OgCard({
  eyebrow,
  title,
  severity,
  footer,
}: {
  eyebrow: string;
  title: string;
  severity?: string;
  footer: string;
}) {
  const clipped = title.length > 140 ? `${title.slice(0, 137)}…` : title;
  const sev = severity ? SEVERITY[severity] : undefined;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "60px 72px",
        background: GROUND,
        backgroundImage: "radial-gradient(70% 60% at 85% 110%, rgba(255,178,36,0.22), rgba(9,9,11,0) 70%)",
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            border: `3px solid ${AMBER}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: 4, background: AMBER }} />
        </div>
        <span style={{ fontWeight: 700, letterSpacing: -1 }}>Driftwatch</span>
        <span style={{ color: QUIET }}>{eyebrow}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        {sev ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700, color: sev.color }}>
            <div style={{ width: 22, height: 22, background: sev.color, transform: "rotate(45deg)" }} />
            {sev.label}
          </div>
        ) : null}
        <div
          style={{
            fontSize: clipped.length > 70 ? 54 : 68,
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: -2,
            maxWidth: 1000,
          }}
        >
          {clipped}
        </div>
      </div>
      <div style={{ fontSize: 24, color: QUIET }}>{footer}</div>
    </div>
  );
}
