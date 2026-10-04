const API = "https://api.cloudflare.com/client/v4";
const headers = { authorization: `Bearer ${process.env["CF_API_TOKEN"]}` };

export async function integrationOf(accountId: string, id: string): Promise<string | undefined> {
  const res = await fetch(`${API}/accounts/${accountId}/hyperdrive/configs/${id}`, { headers }); // driftwatch-expect: http
  const body = await res.json();
  return body.result.integration?.integration; // driftwatch-expect: field
}

export async function integrations(accountId: string): Promise<string[]> {
  const res = await fetch(`${API}/accounts/${accountId}/hyperdrive/configs`, { headers }); // driftwatch-expect: http
  const { result } = await res.json();
  return result.map((config: any) => config.integration?.["integration"]); // driftwatch-expect: field
}

// Typed by the repo itself: renaming the read alone would not typecheck,
// so the patch is dropped and the finding listed for a person.
interface HyperdriveConfig {
  id: string;
  name: string;
  integration?: { integration: string };
}

export async function typed(accountId: string, id: string): Promise<string | undefined> {
  const res = await fetch(`${API}/accounts/${accountId}/hyperdrive/configs/${id}`, { headers }); // driftwatch-expect: http
  const body = (await res.json()) as { result: HyperdriveConfig };
  return body.result.integration?.integration; // driftwatch-expect: field
}

// Not affected: fields that did not change.
export async function nameOf(accountId: string, id: string): Promise<string> {
  const res = await fetch(`${API}/accounts/${accountId}/hyperdrive/configs/${id}`, { headers }); // driftwatch-expect: http
  const body = await res.json();
  return body.result.name;
}
