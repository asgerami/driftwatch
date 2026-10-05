import { ImageResponse } from "next/og";

import { OG_SIZE, OgCard } from "../components/og/Card";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Driftwatch: breaking changes in the APIs you depend on";

export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="driftwatch.et"
        title="Corrections to the APIs you build on."
        footer="What Stripe, OpenAI, GitHub and more changed, and what it breaks in your calls."
      />
    ),
    size,
  );
}
