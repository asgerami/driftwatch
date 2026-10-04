import { ImageResponse } from "next/og";

import { OG_SIZE, OgCard } from "../components/og/Card";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "Driftwatch: breaking changes in the APIs you depend on";

export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="from the calling end"
        title="Breaking changes in the third-party APIs you depend on"
        footer="Stripe, OpenAI, GitHub, Cloudflare and more · driftwatch.et"
      />
    ),
    size,
  );
}
