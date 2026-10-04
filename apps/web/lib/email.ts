/**
 * Transactional email through Resend's HTTP API (free: 3,000 a month, 100 a
 * day). A plain fetch, no SDK: one endpoint, one call site.
 *
 * Off unless RESEND_API_KEY and EMAIL_FROM are set, so the site behaves
 * exactly as before until the account and the driftwatch.et sending domain
 * exist. A failed send never fails the request that triggered it.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export function emailConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env["RESEND_API_KEY"] && env["EMAIL_FROM"]);
}

/** The one email a waitlist signup gets now. Plain text, no tracking. */
export function waitlistConfirmation(entry: {
  email: string;
  repoUrl: string;
  apis: string[];
}): Email {
  return {
    to: entry.email,
    subject: "You're on the Driftwatch waitlist",
    text: [
      "Thanks for signing up to watch your repo.",
      "",
      `Repo: ${entry.repoUrl}`,
      `APIs: ${entry.apis.join(", ")}`,
      "",
      "The GitHub App that opens a pull request when one of these APIs breaks your code",
      "isn't built yet. You'll hear from us once more, when it is. Nothing in between.",
      "",
      "Until then, every change is at https://driftwatch.et, with an RSS feed per API.",
      "",
      "If this wasn't you, ignore this email and nothing else will be sent.",
    ].join("\n"),
  };
}

export async function sendEmail(email: Email, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!emailConfigured(env)) return false;
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${env["RESEND_API_KEY"]}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: env["EMAIL_FROM"], to: [email.to], subject: email.subject, text: email.text }),
    });
    if (!response.ok) {
      console.error(`email: Resend answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`email: ${(err as Error).message}`);
    return false;
  }
}
