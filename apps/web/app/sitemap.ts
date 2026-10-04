import type { MetadataRoute } from "next";

import { listProviders, listPublishedStories } from "../lib/queries";
import { absolute } from "../lib/site";

export const revalidate = 3600;

/** Every API page and every published change page. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [providers, stories] = await Promise.all([listProviders(), listPublishedStories()]);
  return [
    { url: absolute("/"), changeFrequency: "hourly", priority: 1 },
    { url: absolute("/providers"), changeFrequency: "daily", priority: 0.6 },
    { url: absolute("/method"), changeFrequency: "monthly", priority: 0.5 },
    ...providers.map((provider) => ({
      url: absolute(`/apis/${provider.slug}`),
      lastModified: provider.latest,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...stories.map((story) => ({
      url: absolute(`/changes/${story.id}`),
      lastModified: story.publishedAt,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
