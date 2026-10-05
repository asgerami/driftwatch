import type { Metadata } from "next";

import { EmptyFeed } from "../components/Change";
import { FlipTabs, type Flip } from "../components/FlipTabs";
import { Features } from "../components/Features";
import { Hero } from "../components/Hero";
import { LogoStrip } from "../components/LogoStrip";
import { ReleaseDigest } from "../components/ReleaseDigest";
import { FeedIcon, PullIcon, SeverityMark } from "../components/Marks";
import { windowItems } from "../lib/home";
import { listProviders, recentReleases } from "../lib/queries";

export const revalidate = 300;

export const metadata: Metadata = { alternates: { canonical: "/" } };

const FEATURED = ["stripe", "openai", "github"];
const FLIPS: Flip[] = [
  {
    tab: "A field becomes optional",
    them: "A response field becomes optional",
    themWhy: "Safe for them: every response they send is still valid.",
    you: "A null dereference waiting to happen",
    youWhy: "Code that reads the field without a check throws on every response that leaves it out.",
    code: `const { city } = customer.address;
// TypeError: Cannot destructure property 'city'
// of 'customer.address' as it is undefined.`,
  },
  {
    tab: "An enum gains a value",
    them: "A response enum gains a value",
    themWhy: "Additive for them: a new option, nothing removed.",
    you: "Exhaustive switches stop being exhaustive",
    youWhy: "Strict parsers, generated client enums and switch statements meet a value they have no branch for.",
    code: `switch (payment.status) {
  case "succeeded": return settle(payment);
  case "failed":    return retry(payment);
  // "requires_review" arrives: no branch for it
  default: throw new Error(\`unexpected \${payment.status}\`);
}`,
  },
  {
    tab: "A parameter is removed",
    them: "A request parameter is removed",
    themWhy: "A cleanup for them: one less thing to document.",
    you: "Results quietly change",
    youWhy: "The provider ignores what you still send. No error, nothing goes red, the answer is just different.",
    code: `await api.invoices.list({ customer, status: "open" });
// "status" is ignored now: this returns every
// invoice, the paid ones included.`,
  },
];

export default async function HomePage() {
  const [releases, providers] = await Promise.all([
    recentReleases(20, undefined, { preferSignal: true }),
    listProviders(),
  ]);
  const items = windowItems(releases);
  const watched = [...providers]
    .sort((a, b) => b.breakingCount - a.breakingCount)
    .map((p) => ({ slug: p.slug, name: p.name }));
  const shown = releases.slice(0, 6);

  return (
    <main>
      <Hero providers={watched} items={items} />

      <div className="shell">
        <LogoStrip providers={watched} label={`The ${watched.length} APIs Driftwatch watches`} />
      </div>

      <section className="section" aria-labelledby="features-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="features-title">Everything a vendor changes, read from your side</h2>
            <p>What Driftwatch catches, how it explains it, and how it reaches you.</p>
          </div>
          <Features />
        </div>
      </section>

      <section className="section" aria-labelledby="flips-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="flips-title">Other tools diff your spec. Driftwatch diffs theirs.</h2>
            <p>
              Diff tools protect a provider&rsquo;s customers from the provider. From
              the calling side, three of their &ldquo;safe&rdquo; changes are the ones
              that break you.
            </p>
          </div>
          <FlipTabs flips={FLIPS} />
        </div>
      </section>

      <section className="section" aria-labelledby="steps-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="steps-title">From a spec change to a pull request</h2>
            <p>A real Plaid change from September 2026, end to end.</p>
          </div>
          <ol className="steps">
            <li className="step">
              <h3 className="step-head">The spec changes</h3>
              <p>Plaid renames a field in its published OpenAPI spec. Nobody sends an email.</p>
              <div className="step-artifact">
                <div className="step-artifact-bar">plaid/plaid-openapi, 2020-09-14.yml</div>
                <pre>
                  {"ProtectEventSendRequest:\n  properties:\n"}
                  <span className="del">{"-   protect_session_id:"}</span>
                  <span className="add">{"+   device_session_id:"}</span>
                  {"      type: string"}
                </pre>
              </div>
            </li>
            <li className="step">
              <h3 className="step-head">Driftwatch flags it</h3>
              <p>It is published with what breaks, who is affected, and the code that fails.</p>
              <div className="step-artifact">
                <div className="step-artifact-bar">driftwatch.et/changes</div>
                <div className="step-artifact-body" data-severity="BREAKING">
                  <SeverityMark severity="BREAKING" pill />
                  <strong>protect_session_id is no longer accepted</strong>
                  Code that sends it to POST /protect/event/send.
                  <p className="step-note step-link">
                    <a className="link" href="/changes/plaid-2026-09-01-31912bc8">
                      Read the full change
                    </a>
                  </p>
                </div>
              </div>
            </li>
            <li className="step">
              <h3 className="step-head">A pull request fixes it</h3>
              <p>The GitHub App finds the call in your repo, renames the field and checks the types.</p>
              <div className="step-artifact">
                <div className="step-artifact-bar">
                  <PullIcon size={14} />
                  Rename protect_session_id to device_session_id
                </div>
                <pre>
                  <span className="del">{"-  protect_session_id: sessionId,"}</span>
                  <span className="add">{"+  device_session_id: sessionId,"}</span>
                </pre>
                <div className="step-artifact-body step-note">
                  Typechecked with the repo&rsquo;s tsconfig.json: no new errors. Written by the
                  fixer in a test repository.
                </div>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="changes" aria-labelledby="latest-title">
        <div className="shell">
          <div className="section-head-row">
            <div className="section-head">
              <h2 id="latest-title">Every breaking change, as it ships</h2>
              <p>Published from the specs themselves, with the code each one breaks.</p>
            </div>
            <div className="hero-actions">
              <a className="btn btn-ghost btn-sm" href="/rss.xml">
                <FeedIcon size={14} /> RSS
              </a>
              <a className="btn btn-ghost btn-sm" href="/feed.json">
                JSON Feed
              </a>
            </div>
          </div>
          {shown.length === 0 ? (
            <EmptyFeed />
          ) : (
            <ReleaseDigest releases={shown} />
          )}
          <p className="feed-more">
            <a className="link" href="/providers">
              Browse every API and its full history
            </a>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="cta-title">
        <div className="shell">
          <div className="cta-band">
            <h2 id="cta-title">Fix the break before your users find it.</h2>
            <p>
              Tell us your repo and the APIs it calls. You&rsquo;ll be among the first to
              get a pull request when one of them breaks it.
            </p>
            <div className="hero-actions">
              <a className="btn btn-lg" href="/watch">
                Get early access
              </a>
              <a className="btn btn-ghost btn-lg" href="/rss.xml">
                Follow the feed
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
