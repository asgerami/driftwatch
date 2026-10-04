// A wrapper of the repo's own, as anime.gf calls OpenAI: an Electron bridge
// that is neither fetch, axios nor ky. Found because the URL is OpenAI's,
// and only ever at medium confidence.
declare const window: { api: { xfetch: { post(url: string, body: unknown, headers: object): Promise<any> } } };
declare const logger: { info(...args: unknown[]): void };

const url = "https://api.openai.com/v1/chat/completions";

export async function viaWrapper(body: object) {
  const res = await window.api.xfetch.post(url, body, {}); // driftwatch-expect: http
  if (res.kind === "err") return res;
  return res.value.system_fingerprint; // driftwatch-expect: field
}

// Not requests, or not OpenAI: never reported.
export function trace() {
  console.log(url);
  logger.info(url);
}
export const ours = () => window.api.xfetch.post("https://api.mycompany.com/v1/chat/completions", {}, {});
