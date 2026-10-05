import type { Metadata } from "next";

import { EmptyFeed, FlipBadge, Release } from "../components/Change";
import { Inline } from "../components/Inline";
import { ArrowRight, BracesIcon, Contours, FeedIcon, PullIcon, SeverityMark } from "../components/Marks";
import { listProviders, recentReleases } from "../lib/queries";
import type { ChangeView, ReleaseView } from "../lib/types";

export const revalidate = 300;

export const metadata: Metadata = { alternates: { canonical: "/" } };

const FEATURED = ["stripe", "openai", "github"];

/** The latest published break, shown as proof beside the claim. */
function latestBreak(releases: ReleaseView[]): { release: ReleaseView; change: ChangeView } | undefined {
  for (const severity of ["BREAKING", "DEPRECATION", "BEHAVIORAL"] as const) {
    for (const release of releases) {
      const change = release.changes.find((c) => c.severity === severity && c.href);
      if (change) return { release, change };
    }
  }
  return undefined;
}

function Proof({ release, change }: { release: ReleaseView; change: ChangeView }) {
  const pattern = change.patterns.ts ?? change.patterns.py ?? change.patterns.go;
  return (
    <article className="notice hero-proof" data-severity={change.severity}>
      <header className="notice-head">
        <span>
          <strong>{release.providerName}</strong> shipped{" "}
          <time dateTime={release.shippedAt}>{release.shippedAt.slice(0, 10)}</time>
        </span>
        <SeverityMark severity={change.severity} />
      </header>
      <div className="notice-body">
        {change.directionFlip ? <FlipBadge /> : null}
        <h2>
          <a href={change.href}>{change.headline}</a>
        </h2>
        <p>
          <Inline text={change.body.split("\n\n")[0] ?? ""} />
        </p>
        {pattern ? <pre>{pattern}</pre> : null}
        <div className="notice-foot">
          <span>Latest from the feed</span>
          <a className="link-arrow" href={change.href}>
            Read the change <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </article>
  );
}

const FLIPS = [
  {
    them: "A response field becomes optional",
    themWhy: "Safe for them: nothing they send is invalid.",
    you: "A null dereference waiting to happen",
    youWhy: "Code that reads the field without a check fails on every response that leaves it out.",
  },
  {
    them: "A response enum gains a value",
    themWhy: "Additive for them: a new option, nothing removed.",
    you: "Exhaustive switches break",
    youWhy: "Strict parsers, generated client enums and switch statements meet a value they have no branch for.",
  },
  {
    them: "A request parameter is removed",
    themWhy: "A cleanup for them: one less thing to document.",
    you: "Results quietly change",
    youWhy: "The provider ignores what you still send. No error, nothing goes red, the answer is just different.",
  },
];

export default async function HomePage() {
  const [releases, providers] = await Promise.all([
    recentReleases(20, undefined, { preferSignal: true }),
    listProviders(),
  ]);
  const proof = latestBreak(releases);
  const shown = releases.slice(0, 8);
  const named = FEATURED.map((slug) => providers.find((p) => p.slug === slug)?.name).filter(Boolean);
  const others = providers.length - named.length;

  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <Contours />
        <div className="shell hero-inner">
          <div>
            <h1 id="hero-title">
              Corrections to the APIs you <em>build on</em>.
            </h1>
            <p className="hero-sub">
              {named.length === FEATURED.length && others > 0
                ? `Driftwatch reads the published specs of ${named.join(", ")} and ${others} more APIs, and tells you what breaks your calls.`
                : "Driftwatch reads the published specs of the APIs you depend on, and tells you what breaks your calls."}
            </p>
            <div className="hero-actions">
              <a className="btn" href="/watch">
                Watch my repo
              </a>
              <a className="link-arrow" href="#subscribe">
                Get the feed <ArrowRight size={14} />
              </a>
            </div>
          </div>
          {proof ? <Proof release={proof.release} change={proof.change} /> : null}
        </div>
      </section>

      <section className="section" aria-labelledby="latest-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="latest-title">Latest changes</h2>
            <a className="link-arrow" href="/rss.xml">
              <FeedIcon size={14} /> RSS
            </a>
          </div>
          {releases.length === 0 ? (
            <EmptyFeed />
          ) : (
            <div className="feed">
              {shown.map((release) => (
                <Release key={release.id} release={release} />
              ))}
            </div>
          )}
          <p className="feed-more">
            <a className="link-arrow" href="/providers">
              Every API, with its full history <ArrowRight size={14} />
            </a>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="flips-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="flips-title">Additive for them. Breaking for you.</h2>
          </div>
          <p className="section-lede">
            Every other diff tool watches your own spec, to protect your customers.
            Driftwatch watches the specs you call, and three rules come out the
            other way.
          </p>
          <div className="ledger" role="table" aria-label="How three changes read from each side">
            <div className="ledger-col-head" role="columnheader">Their changelog says</div>
            <div className="ledger-col-head" role="columnheader">Your code sees</div>
            {FLIPS.map((flip) => (
              <div className="ledger-row" role="row" key={flip.them}>
                <div className="ledger-cell ledger-them" role="cell">
                  <h3>{flip.them}</h3>
                  <p>{flip.themWhy}</p>
                </div>
                <div className="ledger-cell ledger-you" role="cell">
                  <h3>{flip.you}</h3>
                  <p>{flip.youWhy}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="feed-more plain">
            <a className="link-arrow" href="/method">
              How every change is classified <ArrowRight size={14} />
            </a>
          </p>
        </div>
      </section>

      <section className="section" id="subscribe" aria-labelledby="subscribe-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="subscribe-title">Hear about it where you already read</h2>
          </div>
          <div className="channels">
            <div className="channel channel-primary">
              <h3>
                <PullIcon /> A pull request for your repo
              </h3>
              <p>
                A GitHub App that finds where your code calls the APIs you use, and
                opens a fix when a change breaks one of those calls. In early access.
              </p>
              <a className="btn" href="/watch">
                Watch my repo
              </a>
            </div>
            <div className="channel">
              <h3>
                <FeedIcon /> Every API, one feed
              </h3>
              <p>All published changes as they land, every six hours at most.</p>
              <a className="link-arrow" href="/rss.xml">
                RSS <ArrowRight size={14} />
              </a>
              <a className="link-arrow" href="/feed.json">
                JSON Feed <ArrowRight size={14} />
              </a>
            </div>
            <div className="channel">
              <h3>
                <BracesIcon /> Only the APIs you use
              </h3>
              <p>Each API has its own page and its own RSS and JSON feeds.</p>
              <a className="link-arrow" href="/providers">
                Pick your APIs <ArrowRight size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
