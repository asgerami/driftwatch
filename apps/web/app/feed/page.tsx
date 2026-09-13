import { EmptyFeed, Release } from "../../components/Change";
import { listProviders, recentReleases } from "../../lib/queries";
import { stationId } from "../../lib/stations";
import type { Metadata } from "next";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Feed · Driftwatch",
};

export default async function FeedPage() {
  const [releases, stations] = await Promise.all([
    recentReleases(20, undefined, { preferSignal: true }),
    listProviders(),
  ]);

  return (
    <main className="plot">
      <aside className="rail">
        <h2>Stations</h2>
        <ul className="rail-stations">
          {stations.map((station) => (
            <li key={station.slug}>
              <a href={`/${station.slug}`}>
                <span>{stationId(station.slug)}</span>
                {station.breakingCount > 0 ? (
                  <span className="n">{station.breakingCount}</span>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
        <h2>Scale</h2>
        <p>
          Hook is a break. Cell is a deprecation. Echo is a behavioural shift.
          Clear is additive — collapsed to a line when it repeats.
        </p>
      </aside>
      <div className="returns">
        <p className="tagline">
          Spec-derived returns from the APIs you call. Releases with a break
          lead. A human still has to publish a card before it appears here.
        </p>
        {releases.length === 0 ? (
          <EmptyFeed />
        ) : (
          releases.map((release) => <Release key={release.id} release={release} />)
        )}
      </div>
    </main>
  );
}
