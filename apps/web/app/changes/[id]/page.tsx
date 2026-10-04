import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StoryPage } from "../../../components/StoryPage";
import { getStory } from "../../../lib/queries";

// A published story changes only if a later ruleset reclassifies it.
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const story = await getStory(id);
  if (!story) return { title: "Change not found · Driftwatch" };
  const title = `${story.providerName}: ${story.change.headline}`;
  return {
    title: `${title} · Driftwatch`,
    description: story.change.body.split("\n\n")[0],
  };
}

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await getStory(id);
  if (!story) notFound();
  return <StoryPage story={story} />;
}
