import { ERROR_MESSAGES, HONEYPOT_FIELD, RENDERED_AT_FIELD, type WaitlistError } from "../lib/waitlist";

/**
 * "Watch my repo". Plain HTML posting to /api/waitlist: no JavaScript needed,
 * and nothing here is trusted; lib/waitlist.ts validates every field.
 */
export function WatchForm({
  apis,
  renderedAt,
  joined,
  error,
}: {
  apis: { slug: string; name: string }[];
  renderedAt: number;
  joined?: boolean;
  error?: WaitlistError;
}) {
  if (joined) {
    return (
      <div className="empty" id="form">
        <p style={{ margin: 0 }}>
          You&rsquo;re on the list. When the GitHub App can open a pull request
          for your repo, you&rsquo;ll be among the first to hear. Nothing else
          will be sent to that address.
        </p>
      </div>
    );
  }

  return (
    <form className="watch-form" id="form" method="post" action="/api/waitlist">
      {error ? (
        <p className="watch-error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}

      <label>
        Email
        <input type="email" name="email" required maxLength={254} autoComplete="email" />
      </label>

      <label>
        GitHub repository
        <input
          type="url"
          name="repo"
          required
          maxLength={200}
          placeholder="https://github.com/owner/repo"
        />
      </label>

      <fieldset>
        <legend>APIs it calls</legend>
        <div className="watch-apis">
          {apis.map((api) => (
            <label key={api.slug} className="watch-api">
              <input type="checkbox" name="apis" value={api.slug} /> {api.name}
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        Others we don&rsquo;t watch yet <span className="watch-optional">(optional)</span>
        <input type="text" name="other" maxLength={200} />
      </label>

      {/* Bots fill every field; people never see this one. */}
      <div className="watch-trap" aria-hidden="true">
        <label>
          Website
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <input type="hidden" name={RENDERED_AT_FIELD} value={renderedAt} />

      <button type="submit">Watch my repo</button>
      <p className="watch-note">
        Stored only to tell you when the GitHub App is ready. No newsletter, no
        sharing.
      </p>
    </form>
  );
}
