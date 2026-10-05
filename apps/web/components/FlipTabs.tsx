"use client";

import { useId, useState } from "react";

export interface Flip {
  tab: string;
  them: string;
  themWhy: string;
  you: string;
  youWhy: string;
  code: string;
}

/** The three changes producer-side tools call safe, from both ends. */
export function FlipTabs({ flips }: { flips: Flip[] }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const flip = flips[active];
  if (!flip) return null;

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = (active + (event.key === "ArrowRight" ? 1 : flips.length - 1)) % flips.length;
    setActive(next);
    document.getElementById(`${base}-tab-${next}`)?.focus();
  };

  return (
    <div className="flip-tabs">
      <div className="tablist" role="tablist" aria-label="Changes other tools call safe" onKeyDown={onKey}>
        {flips.map((f, i) => (
          <button
            key={f.tab}
            id={`${base}-tab-${i}`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
          >
            {f.tab}
          </button>
        ))}
      </div>
      <div className="flip-panel" role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${active}`}>
        <div className="flip-side flip-them">
          <p className="flip-who">What their changelog says</p>
          <h3>{flip.them}</h3>
          <p>{flip.themWhy}</p>
        </div>
        <div className="flip-side flip-you">
          <p className="flip-who">What your code sees</p>
          <h3>{flip.you}</h3>
          <p>{flip.youWhy}</p>
          <pre>{flip.code}</pre>
        </div>
      </div>
    </div>
  );
}
