import { Release } from "../components/Change";
import { Scope } from "../components/Scope";
import { listProviders, recentReleases } from "../lib/queries";

export const revalidate = 300;

export default async function LandingPage() {
  const [releases, stations] = await Promise.all([
    recentReleases(5, undefined, { preferSignal: true }),
    listProviders(),
  ]);

  return (
    <main>
      <section className="landing-hero">
        <div>
          <h1>Every other tool watches your spec. This watches theirs.</h1>
          <p className="lede">
            Producer-side diffs exist so you do not break your customers.
            Driftwatch sits on the calling end and reports what a vendor broke
            in the OpenAPI you already depend on. Severity is a fixed ruleset,
            not a model.
          </p>
          <div className="cta-row">
            <a className="cta" href="/feed">
              Open the feed
            </a>
            <a className="cta cta-quiet" href="/method">
              How severity is decided
            </a>
          </div>
        </div>
        <Scope stations={stations} />
      </section>

      <p className="band-label">The three flips</p>
      <ul className="flips">
        <li>
          <p className="kicker">Optional → null</p>
          <p>
            A response field becoming optional is safe for a producer. For you
            it is a null dereference waiting in production.
          </p>
        </li>
        <li>
          <p className="kicker">New response enum</p>
          <p>
            A new value on a response is additive for them. It breaks exhaustive
            switches, strict parsers, and generated client enums.
          </p>
        </li>
        <li>
          <p className="kicker">Silent drop</p>
          <p>
            A removed request parameter raises no error. The vendor ignores it,
            your results change, and nothing goes red.
          </p>
        </li>
      </ul>

      <p className="band-label">Live returns</p>
      {releases.length === 0 ? (
        <p className="tagline">
          Nothing published yet. The scope is up; the review gate has not
          opened.
        </p>
      ) : (
        <div className="returns">
          {releases.map((release) => (
            <Release key={release.id} release={release} compact />
          ))}
        </div>
      )}
      <a className="more-feed" href="/feed">
        Full feed →
      </a>

      <p className="band-label" style={{ marginTop: 36 }}>
        Tune in
      </p>
      <div className="tune">
        <a href="/feed">
          <span className="kicker">Feed</span>
          <p>The plot. Breaks lead. Additive noise is collapsed.</p>
        </a>
        <a href="/api/feed.json">
          <span className="kicker">JSON / RSS</span>
          <p>
            Machine feed at /api/feed.json. Per-station RSS at /{"{slug}"}
            /rss.xml. MCP is <code>node apps/mcp/dist/index.js</code>.
          </p>
        </a>
        <a href="/method">
          <span className="kicker">Method</span>
          <p>The live ruleset. A model never assigns severity.</p>
        </a>
      </div>
    </main>
  );
}
