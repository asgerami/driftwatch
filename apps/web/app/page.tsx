import type { Metadata } from "next";

import { EmptyFeed } from "../components/Change";
import { FlipTabs, type Flip } from "../components/FlipTabs";
import { Features } from "../components/Features";
import { Hero } from "../components/Hero";
import { LogoStrip } from "../components/LogoStrip";
import { ReleaseDigest } from "../components/ReleaseDigest";
import { ArrowRight, FeedIcon, PullIcon, SeverityMark } from "../components/Marks";
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
        <LogoStrip providers={watched} label="APIs Driftwatch watches" />
      </div>

      <section className="section" aria-labelledby="features-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="features-title">Stay ahead of the APIs you depend on</h2>
            <p>Know what changed, what it breaks, and how to fix it.</p>
          </div>
          <Features />
        </div>
      </section>

      <section className="section" aria-labelledby="flips-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="flips-title">Other tools check your API. Driftwatch checks theirs.</h2>
            <p>
              Some changes a provider considers safe are exactly the ones that break the
              code calling it. Driftwatch catches them.
            </p>
          </div>
          <FlipTabs flips={FLIPS} />
        </div>
      </section>

      <section className="section" aria-labelledby="steps-title">
        <div className="shell">
          <div className="section-head">
            <h2 id="steps-title">From an API change to a pull request</h2>
            <p>A real Plaid change, end to end.</p>
          </div>
          <ol className="steps">
            <li className="step">
              <h3 className="step-head">The API changes</h3>
              <p>Plaid renames a field in its API.</p>
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
              <p>You get an alert with what breaks and the code that fails.</p>
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
              <p>The GitHub App opens a pull request with the fix, ready for review.</p>
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
                  An example pull request, from a test repository.
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
              <h2 id="latest-title">Latest changes</h2>
              <p>The most important changes across the APIs we watch, as they ship.</p>
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
            <a className="btn btn-ghost" href="/providers">
              Browse every API and its full history <ArrowRight size={14} />
            </a>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="cta-title">
        <div className="shell">
          <div className="cta-band">
            <h2 id="cta-title">Fix the break before your users find it.</h2>
            <p>
              Join early access to the GitHub App, and get a pull request when an API
              change breaks your code.
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
