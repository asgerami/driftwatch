/**
 * Station IDs.
 *
 * Official provider marks would imply affiliation. These read like NEXRAD
 * site codes: short, ours, and stable even if a vendor restyles their logo.
 */

export const STATION_ID: Record<string, string> = {
  stripe: "STRP",
  github: "GHUB",
  openai: "OAI",
  twilio: "TWLO",
  hetzner: "HTZR",
};

export function stationId(slug: string): string {
  return STATION_ID[slug] ?? slug.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase();
}

/** Polar placement on the landing scope. Angle in degrees, radius 0–1. */
export const STATION_FIX: Record<string, { angle: number; radius: number }> = {
  stripe: { angle: -28, radius: 0.68 },
  github: { angle: 42, radius: 0.52 },
  openai: { angle: 118, radius: 0.74 },
  twilio: { angle: 188, radius: 0.58 },
  hetzner: { angle: 255, radius: 0.64 },
};
