import {
  ArrowsLeftRight,
  Code,
  GitPullRequest,
  Scales,
  Broadcast,
  RssSimple,
} from "@phosphor-icons/react/ssr";

/** What Driftwatch does, as a bento grid: two large cells with real material, four small. */
export function Features() {
  return (
    <div className="bento">
      <article className="bento-cell bento-wide">
        <div className="bento-icon">
          <Broadcast size={22} weight="duotone" />
        </div>
        <h3>Continuous API monitoring</h3>
        <p>
          Stripe, OpenAI, GitHub, Cloudflare and more. When a provider changes its
          API, you know about it.
        </p>
        <div className="bento-pings" aria-hidden="true">
          <span data-severity="BREAKING">Stripe · payment_method_types removed</span>
          <span data-severity="BEHAVIORAL">OpenAI · 201 now documented</span>
          <span data-severity="BREAKING">Vercel · abuse removed</span>
        </div>
      </article>
      <article className="bento-cell bento-tall">
        <div className="bento-icon">
          <Code size={22} weight="duotone" />
        </div>
        <h3>The code that breaks</h3>
        <p>Every alert shows the code that fails, so your team knows where to look.</p>
        <pre className="bento-code">{`switch (payment.status) {
  case "succeeded": …
  case "failed": …
  // "requires_review"
  // has no branch
}`}</pre>
      </article>
      <article className="bento-cell">
        <div className="bento-icon">
          <GitPullRequest size={22} weight="duotone" />
        </div>
        <h3>Fixes as pull requests</h3>
        <p>The GitHub App opens a pull request with the fix, ready for your review.</p>
      </article>
      <article className="bento-cell">
        <div className="bento-icon">
          <ArrowsLeftRight size={22} weight="duotone" />
        </div>
        <h3>Read from your side</h3>
        <p>Changes are judged by their effect on your code, not on the provider&rsquo;s.</p>
      </article>
      <article className="bento-cell">
        <div className="bento-icon">
          <Scales size={22} weight="duotone" />
        </div>
        <h3>Consistent and transparent</h3>
        <p>Every change is classified by published rules, so the same change always gets the same verdict.</p>
      </article>
      <article className="bento-cell bento-span">
        <div className="bento-icon">
          <RssSimple size={22} weight="duotone" />
        </div>
        <h3>Wherever you read</h3>
        <p>Follow every API, or only the ones you use, by RSS or JSON feed.</p>
      </article>
    </div>
  );
}
