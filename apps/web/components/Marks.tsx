import type { Severity } from "@driftwatch/core";

import { SEVERITY_LABEL } from "../lib/types";

/**
 * The drawn marks: one 16px grid, one 1.5 stroke, currentColor throughout.
 *
 * Each severity has its own shape, so the shape carries the meaning as well
 * as the colour: a diamond for a break, a triangle for a deprecation, a
 * half-filled circle for a change in behaviour, a plus for something new.
 */

type IconProps = { size?: number; label?: string };

function Svg({ size = 16, label, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {children}
    </svg>
  );
}

export function SeverityGlyph({ severity, size = 14 }: { severity: Severity; size?: number }) {
  switch (severity) {
    case "BREAKING":
      return (
        <Svg size={size}>
          <path d="M8 1.8 14.2 8 8 14.2 1.8 8Z" fill="currentColor" />
        </Svg>
      );
    case "DEPRECATION":
      return (
        <Svg size={size}>
          <path d="M8 2.2 14 13.2H2Z" />
          <path d="M8 6.6v3" />
        </Svg>
      );
    case "BEHAVIORAL":
      return (
        <Svg size={size}>
          <circle cx="8" cy="8" r="5.6" />
          <path d="M8 2.4a5.6 5.6 0 0 1 0 11.2Z" fill="currentColor" />
        </Svg>
      );
    case "ADDITIVE":
      return (
        <Svg size={size}>
          <path d="M8 2.8v10.4M2.8 8h10.4" strokeWidth={1.9} />
        </Svg>
      );
    default:
      return (
        <Svg size={size}>
          <circle cx="8" cy="8" r="2.6" />
        </Svg>
      );
  }
}

/** A severity, as mark plus word: colour is never the only signal. */
export function SeverityMark({ severity, text, pill = false }: { severity: Severity; text?: string; pill?: boolean }) {
  return (
    <span className={pill ? "sev sev-pill" : "sev"} data-severity={severity}>
      <SeverityGlyph severity={severity} />
      {text ?? SEVERITY_LABEL[severity]}
    </span>
  );
}

/** The wordmark's mark: a gauge whose needle has drifted off true. */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2.75v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
      <path d="M12 12 16.6 5.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" />
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Svg>
  );
}

export function ArrowUpRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 11 11 5M6 5h5v5" />
    </Svg>
  );
}

export function Chevron(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </Svg>
  );
}

export function FeedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3.5a9.5 9.5 0 0 1 9.5 9.5M3 7.5A5.5 5.5 0 0 1 8.5 13" />
      <circle cx="3.75" cy="12.25" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function BracesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 2.5c-1.6 0-2 .8-2 2v1.6c0 .9-.5 1.6-1.5 1.9 1 .3 1.5 1 1.5 1.9v1.6c0 1.2.4 2 2 2M10 2.5c1.6 0 2 .8 2 2v1.6c0 .9.5 1.6 1.5 1.9-1 .3-1.5 1-1.5 1.9v1.6c0 1.2-.4 2-2 2" />
    </Svg>
  );
}

export function PullIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="4" cy="3.5" r="1.6" />
      <circle cx="4" cy="12.5" r="1.6" />
      <circle cx="12" cy="12.5" r="1.6" />
      <path d="M4 5.1v5.8M12 10.9V6.5c0-1.1-.9-2-2-2H7.5M9 3l-1.5 1.5L9 6" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m3 8.5 3 3 7-7" />
    </Svg>
  );
}

export function FlipIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" />
    </Svg>
  );
}
