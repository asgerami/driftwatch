import { ImageResponse } from "next/og";

import { OG_SIZE, OgCard } from "../../../components/og/Card";
import { getStory } from "../../../lib/queries";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A breaking change in a third-party API, as reported by Driftwatch";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await getStory(id);
  const card = story ? (
    <OgCard
      eyebrow={`${story.providerName} · ${story.shippedAt.slice(0, 10)}`}
      title={story.change.headline}
      severity={story.change.severity}
      footer={`${story.change.ruleId} · driftwatch.et`}
    />
  ) : (
    <OgCard eyebrow="Change not found" title="Breaking changes in the APIs you depend on" footer="driftwatch.et" />
  );
  return new ImageResponse(card, size);
}
