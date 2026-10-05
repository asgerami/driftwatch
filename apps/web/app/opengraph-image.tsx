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
        title="Know when an API you depend on breaks your code."
        footer="Breaking changes in Stripe, OpenAI, GitHub and 18 more APIs, read from their specs."
      />
    ),
    size,
  );
}
