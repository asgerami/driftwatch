import { prisma } from "./db";

/**
 * Count a feed request that reached the site. A lower bound on real fetches:
 * Netlify's CDN answers repeats within the 5-minute cache without running
 * this. Never fails the feed: a reader must get the feed even if counting
 * breaks.
 */
export async function countFeedFetch(path: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    await prisma.feedFetch.upsert({
      where: { day_path: { day, path } },
      create: { day, path, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch (err) {
    console.error(`feed count: ${(err as Error).message.split("\n")[0]}`);
  }
}
