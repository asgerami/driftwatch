import { MARK_BOTTOM, MARK_INK, MARK_LIME, MARK_TOP } from "../brand";

/**
 * The 1200×630 share image. Rendered by next/og (Satori), which supports a
 * subset of CSS: flexbox only, inline styles, no external fonts here.
 *
 * The site's palette: near-white, near-black type, the brand mark,
 * severity colours as on the site, with the severity's own mark.
 */

const INK = "#0b0b0f";
const QUIET = "#6b6b76";
const GROUND = "#fbfbfc";

const SEVERITY: Record<string, { color: string; label: string }> = {
  BREAKING: { color: "#dc3e42", label: "Breaking" },
  DEPRECATION: { color: "#b26a00", label: "Deprecation" },
  BEHAVIORAL: { color: "#0b75d8", label: "Behavioral" },
  ADDITIVE: { color: "#218358", label: "Additive" },
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
        color: INK,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
        <svg width={40} height={40} viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill={MARK_INK} />
          <path d={MARK_TOP} fill={MARK_LIME} />
          <path d={MARK_BOTTOM} fill={MARK_LIME} />
        </svg>
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
