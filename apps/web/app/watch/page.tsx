import type { Metadata } from "next";

import { PullIcon } from "../../components/Marks";
import { WatchForm } from "../../components/WatchForm";
import { listProviders } from "../../lib/queries";
import { ERROR_MESSAGES, type WaitlistError } from "../../lib/waitlist";

// Each visit needs its own render timestamp for the bot check, so no caching.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watch my repo",
  description:
    "Get a pull request when a third-party API change breaks code in your repo. Join the waitlist for the Driftwatch GitHub App.",
  alternates: { canonical: "/watch" },
};

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const { joined, error } = await searchParams;
  const providers = await listProviders();
  const knownError = error && error in ERROR_MESSAGES ? (error as WaitlistError) : undefined;

  return (
    <main className="shell">
      <div className="watch">
        <div className="watch-intro">
          <h1>Get a pull request when an API breaks your code</h1>
          <p className="page-lede">
            The feed tells you a vendor changed its API. The GitHub App reads your
            code instead, and opens a pull request when a change breaks one of your
            calls.
          </p>
          <p>
            It finds where your repo calls the APIs you depend on, through their
            official SDKs or plain HTTP, follows the fields you read, and patches
            the mechanical cases: a renamed field, a parameter that is no longer
            accepted, a newly required value. Everything else is listed for a
            person, never guessed.
          </p>
          <p>It is in early access. Tell us which repo and which APIs, and you&rsquo;ll be among the first to try it.</p>

          <figure className="example-pr" aria-label="An example pull request">
            <div className="example-pr-head">
              <PullIcon />
              Rename protect_session_id to device_session_id, after Plaid&rsquo;s API change
            </div>
            <div className="example-pr-body">
              <p>Plaid renamed protect_session_id to device_session_id on POST /protect/event/send.</p>
              <pre className="diff">
                <span className="del">-    protect_session_id: sessionId,</span>
                <span className="add">+    device_session_id: sessionId,</span>
              </pre>
              <p>Typechecked with the repo&rsquo;s tsconfig.json: no new errors (2 before, 0 after).</p>
              <figcaption className="example-label">
                What the fixer wrote for a real Plaid change, in a test repository.
              </figcaption>
            </div>
          </figure>
        </div>
        <WatchForm
          apis={providers.map((provider) => ({ slug: provider.slug, name: provider.name }))}
          renderedAt={Date.now()}
          joined={joined === "1"}
          error={knownError}
        />
      </div>
    </main>
  );
}
