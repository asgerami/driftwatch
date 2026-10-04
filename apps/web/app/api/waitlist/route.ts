import { prisma } from "../../../lib/db";
import { listProviders } from "../../../lib/queries";
import { validateSubmission } from "../../../lib/waitlist";

/**
 * The "Watch my repo" form posts here as plain HTML, so it works without
 * JavaScript. Answers with a 303 back to /watch, carrying either
 * ?joined=1 or ?error=<code>. Relative Location headers: on Netlify the
 * request URL can carry the deploy's internal hostname.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back("error=bot");
  }

  const known = new Set((await listProviders()).map((provider) => provider.slug));
  const result = validateSubmission(form, known);
  if (!result.ok) return back(`error=${result.error}`);

  const { email, repoUrl, apis, otherApis } = result.value;
  await prisma.waitlistEntry.upsert({
    where: { email },
    create: { email, repoUrl, apis, otherApis: otherApis ?? null },
    update: { repoUrl, apis, otherApis: otherApis ?? null },
  });
  return back("joined=1");
}

function back(query: string): Response {
  return new Response(null, { status: 303, headers: { location: `/watch?${query}#form` } });
}
