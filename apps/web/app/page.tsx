import type { Metadata } from "next";
import { EmptyFeed, Release } from "../components/Change";
import { recentReleases } from "../lib/queries";

export const revalidate = 300;

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function HomePage() {
  const releases = await recentReleases(20, undefined, { preferSignal: true });

  return (
    <main>
      <p className="tagline">
        What your API vendors changed, read from the calling end. Every diff
        tool on the market watches your own spec to protect your customers.
        This one watches theirs.
      </p>
      {releases.length === 0 ? (
        <EmptyFeed />
      ) : (
        releases.map((release) => <Release key={release.id} release={release} />)
      )}
    </main>
  );
}
