"use client";

import type { Severity } from "@driftwatch/core";
import { useRef, useState } from "react";

import { Inline } from "./Inline";
import { FlipIcon, LogoMark, SeverityGlyph, SeverityMark } from "./Marks";

/** One published change, as the window shows it. Built on the server from real data. */
export interface WindowItem {
  id: string;
  href: string;
  providerSlug: string;
  providerName: string;
  /** The provider's mark (an SVG path on a 24 grid), when it has one. */
  markPath?: string;
  shippedAt: string;
  severity: Severity;
  headline: string;
  body: string;
  where: string;
  pattern?: string;
  directionFlip: boolean;
}

/** The provider's mark, or its initial. */
export function Mark({ item, size = 14 }: { item: Pick<WindowItem, "markPath" | "providerName">; size?: number }) {
  if (!item.markPath) {
    return (
      <span className="lettermark" style={{ width: size, height: size, fontSize: size * 0.56 }} aria-hidden="true">
        {item.providerName.charAt(0)}
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={item.markPath} />
    </svg>
  );
}

/**
 * The hero's product view: the latest published changes, as an inbox.
 * Choosing one shows what it breaks. Real content from the feed, not a
 * picture of an interface.
 */
export function ProductWindow({ items }: { items: WindowItem[] }) {
  const [selected, setSelected] = useState(0);
  const [switching, setSwitching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const item = items[selected];
  if (!item) return null;

  const choose = (i: number) => {
    if (i === selected) return;
    // A short blur bridges the two states, so the swap reads as one change.
    setSwitching(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSelected(i);
      setSwitching(false);
    }, 90);
  };

  return (
    <div className="window" role="region" aria-label="Latest published changes">
      <div className="window-bar">
        <LogoMark size={16} />
        <strong>Latest changes</strong>
        <span className="updated">Checked every six hours</span>
      </div>
      <div className="window-body">
        <ul className="inbox">
          {items.map((entry, i) => (
            <li key={entry.id}>
              <button
                type="button"
                className="inbox-item"
                aria-pressed={i === selected}
                onClick={() => choose(i)}
                data-severity={entry.severity}
              >
                <span className="sev">
                  <SeverityGlyph severity={entry.severity} size={12} />
                </span>
                <span className="inbox-provider">
                  <Mark item={entry} size={12} /> {entry.providerName}
                </span>
                <time className="inbox-date" dateTime={entry.shippedAt}>
                  {entry.shippedAt.slice(5, 10)}
                </time>
                <span className="inbox-title">{entry.headline}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="detail" data-switching={switching} aria-live="polite">
          <div className="detail-meta">
            <SeverityMark severity={item.severity} pill />
            <span className="detail-provider">
              <Mark item={item} size={14} /> {item.providerName},{" "}
              <time dateTime={item.shippedAt}>{item.shippedAt.slice(0, 10)}</time>
            </span>
            {item.directionFlip ? (
              <span className="flip" title="Producer-side tools classify this as non-breaking.">
                <FlipIcon size={13} />
                Other tools call this safe
              </span>
            ) : null}
          </div>
          <h2>
            <a href={item.href}>{item.headline}</a>
          </h2>
          <p>
            <Inline text={item.body} />
          </p>
          <div className="detail-where">{item.where}</div>
          {item.pattern ? (
            <>
              <p className="detail-label">Code that breaks</p>
              <pre>{item.pattern}</pre>
            </>
          ) : null}
          <div className="detail-foot">
            <a className="btn btn-ghost btn-sm" href={item.href}>
              Read the full change
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
