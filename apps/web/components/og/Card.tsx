/**
 * The 1200×630 share image. Rendered by next/og (Satori), which supports a
 * subset of CSS: flexbox only, inline styles, no external fonts here.
 */

const SEVERITY_COLOR: Record<string, string> = {
  BREAKING: "#c0392b",
  DEPRECATION: "#b7791f",
  BEHAVIORAL: "#2b6cb0",
  ADDITIVE: "#2f855a",
  COSMETIC: "#718096",
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
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        background: "#faf8f3",
        color: "#1a1a1a",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 30 }}>
        <span style={{ fontWeight: 700 }}>
          drift<span style={{ color: "#c0392b" }}>watch</span>
        </span>
        <span style={{ color: "#6b6b6b" }}>{eyebrow}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {severity ? (
          <div style={{ display: "flex" }}>
            <span
              style={{
                background: SEVERITY_COLOR[severity] ?? "#718096",
                color: "white",
                fontSize: 26,
                fontWeight: 700,
                padding: "6px 16px",
                borderRadius: 6,
                letterSpacing: 1,
              }}
            >
              {severity}
            </span>
          </div>
        ) : null}
        <div style={{ fontSize: clipped.length > 70 ? 52 : 64, fontWeight: 700, lineHeight: 1.15 }}>
          {clipped}
        </div>
      </div>
      <div style={{ fontSize: 26, color: "#6b6b6b" }}>{footer}</div>
    </div>
  );
}
