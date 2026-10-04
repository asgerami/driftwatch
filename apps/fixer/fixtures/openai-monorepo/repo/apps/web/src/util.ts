// The web app's own `relay`, which the root config's "~/*" would get wrong.
export async function relay(body: string) {
  return { body, system_fingerprint: "cached" };
}
