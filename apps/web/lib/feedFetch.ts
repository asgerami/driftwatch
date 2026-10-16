import { prisma } from "./db";

/**
 * Count a feed request. On Workers every request reaches the site, so this
 * is every fetch (on Netlify its CDN answered repeats within five minutes, so
 * counts before the move are a lower bound). Never fails the feed: a reader
 * must get the feed even if counting breaks.
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
