"use client";

import type { Severity } from "@driftwatch/core";
import { useEffect, useRef, useState } from "react";

import { Inline } from "./Inline";
import { FlipIcon, LogoMark, SeverityGlyph, SeverityMark } from "./Marks";

/** One published change, as the window shows it. Built on the server from real data. */
export interface WindowItem {
  id: string;
  href: string;
  providerSlug: string;
  providerName: string;
  /** The provider's logo file, when there is one. */
  logo?: string;
  shippedAt: string;
  severity: Severity;
  headline: string;
  body: string;
  where: string;
  pattern?: string;
  directionFlip: boolean;
}

/** The provider's logo, or its initial. */
export function Mark({ item, size = 14 }: { item: Pick<WindowItem, "logo" | "providerName">; size?: number }) {
  if (!item.logo) {
    return (
      <span className="lettermark" style={{ width: size, height: size, fontSize: size * 0.56 }} aria-hidden="true">
        {item.providerName.charAt(0)}
      </span>
    );
  }
  return <img className="logo" src={item.logo} alt="" width={size} height={size} decoding="async" />;
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
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const item = items[selected];
  if (!item) return null;

  const choose = (i: number, event: React.MouseEvent) => {
    if (i === selected) return;
    // Keyboard activation (detail 0) and reduced motion switch instantly:
    // a keyboard action should never wait on an animation.
    const instant =
      event.detail === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (timer.current) clearTimeout(timer.current);
    if (instant) {
      setSwitching(false);
      setSelected(i);
      return;
    }
    // A short blur bridges the two states, so the swap reads as one change.
    setSwitching(true);
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
      </div>
      <div className="window-body">
        <ul className="inbox">
          {items.map((entry, i) => (
            <li key={entry.id}>
              <button
                type="button"
                className="inbox-item"
                aria-pressed={i === selected}
                onClick={(event) => choose(i, event)}
                data-severity={entry.severity}
              >
                <span className="sev">
                  <SeverityGlyph severity={entry.severity} size={12} />
                </span>
                <span className="inbox-provider">
                  <Mark item={entry} size={14} /> {entry.providerName}
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
              <Mark item={item} size={16} /> {item.providerName},{" "}
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
