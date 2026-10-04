import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const plaid = new PlaidApi(new Configuration({ basePath: PlaidEnvironments["production"] }));

export async function reportLogin(userId: string, sessionId: string) {
  return plaid.protectEventSend({ // driftwatch-expect: sdk
    event: { user_sign_in: { user_id: userId } },
    protect_session_id: sessionId, // driftwatch-expect: field
  });
}

export async function reportSignup(protect_session_id: string) {
  return plaid.protectEventSend({ event: { user_sign_up: {} }, protect_session_id }); // driftwatch-expect: sdk, field
}

// Raw HTTP, with the session ID inside the event: renamed there too.
export async function reportRaw(sessionId: string) {
  const res = await fetch("https://production.plaid.com/protect/event/send", { // driftwatch-expect: http
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event: { "protect_session_id": sessionId, user_sign_in: {} }, // driftwatch-expect: field
    }),
  });
  return res.json();
}

// Not affected: a field that kept its name.
export async function trusted(sessionId: string) {
  void sessionId;
  return plaid.protectEventSend({ event: { app_visit: {} }, request_trust_index: true }); // driftwatch-expect: sdk
}
