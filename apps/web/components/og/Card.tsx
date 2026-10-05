/**
 * The 1200×630 share image. Rendered by next/og (Satori), which supports a
 * subset of CSS: flexbox only, inline styles, no external fonts here.
 *
 * Drawn in the site's night-chart palette, because a share image sits in
 * timelines that are mostly dark, with the severity as the chart's own mark.
 */

const INK = "#d8e4ea";
const QUIET = "#8599a4";
const GROUND = "#0a1217";
const CONTOUR = "#16303a";
const MAGENTA = "#f26aad";

const SEVERITY: Record<string, { color: string; label: string }> = {
  BREAKING: { color: MAGENTA, label: "Breaking" },
  DEPRECATION: { color: "#e2b25b", label: "Deprecation" },
  BEHAVIORAL: { color: "#7fb7de", label: "Behavioral" },
  ADDITIVE: { color: "#73c49b", label: "Additive" },
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
        backgroundImage: `repeating-linear-gradient(176deg, transparent 0px, transparent 46px, ${CONTOUR} 46px, ${CONTOUR} 48px)`,
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            border: `3px solid ${MAGENTA}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: 4, background: MAGENTA }} />
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
