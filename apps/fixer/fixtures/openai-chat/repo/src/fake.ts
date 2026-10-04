// Same function name as the real client, no API call.
export async function complete(body: string) {
  return { body, system_fingerprint: "offline" };
}
