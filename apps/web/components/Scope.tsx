import type { ProviderView } from "../lib/types";
import { STATION_FIX, stationId } from "../lib/stations";

function polar(angleDeg: number, radius: number, cx = 50, cy = 50): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
}

/**
 * Landing signature: stations as contacts on a scope, not a logo row.
 */
export function Scope({ stations }: { stations: ProviderView[] }) {
  const plotted = stations.map((station, index) => {
    const fix = STATION_FIX[station.slug] ?? {
      angle: index * 72 - 20,
      radius: 0.55 + (index % 3) * 0.08,
    };
    const pt = polar(fix.angle, fix.radius * 38);
    return { station, ...pt, id: stationId(station.slug) };
  });

  return (
    <figure className="scope">
      <svg viewBox="0 0 100 100" role="img" aria-label="Watched stations on the scope">
        <defs>
          <radialGradient id="scope-wash" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1a3a4a" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0c141c" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="scope-disk" cx="50" cy="50" r="46" fill="url(#scope-wash)" />
        {[15, 28, 38, 46].map((r) => (
          <circle key={r} className="scope-ring" cx="50" cy="50" r={r} />
        ))}
        <line className="scope-cross" x1="50" y1="4" x2="50" y2="96" />
        <line className="scope-cross" x1="4" y1="50" x2="96" y2="50" />
        <g className="scope-sweep">
          <path d="M50 50 L50 4 A46 46 0 0 1 88 28 Z" />
        </g>
        {plotted.map((blip) => (
          <g key={blip.station.slug} className="scope-contact">
            <a href={`/${blip.station.slug}`}>
              <circle
                cx={blip.x}
                cy={blip.y}
                r={blip.station.breakingCount > 0 ? 2.1 : 1.5}
                className={blip.station.breakingCount > 0 ? "is-hook" : "is-echo"}
              />
              <text x={blip.x + 3.2} y={blip.y + 1.2}>
                {blip.id}
              </text>
            </a>
          </g>
        ))}
      </svg>
      <figcaption>
        Station IDs, not vendor marks. Magenta is a published break.
      </figcaption>
    </figure>
  );
}
