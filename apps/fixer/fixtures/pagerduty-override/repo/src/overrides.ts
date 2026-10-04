import axios from "axios";

const pd = axios.create({
  baseURL: "https://api.pagerduty.com",
  headers: { authorization: `Token token=${process.env["PAGERDUTY_TOKEN"]}` },
});

interface Window {
  start: string;
  end: string;
}

// The update replaces the whole override, and `type` is now required.
export async function reschedule(scheduleId: string, overrideId: string, userId: string, w: Window) {
  return fetch(`https://api.pagerduty.com/v3/schedules/${scheduleId}/overrides/${overrideId}`, { // driftwatch-expect: http
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      override: {
        start_time: w.start,
        end_time: w.end,
        overriding_member: { id: userId, type: "user_reference" },
      },
    }),
  });
}

export async function reassign(scheduleId: string, overrideId: string, userId: string, w: Window) {
  return pd.put(`/v3/schedules/${scheduleId}/overrides/${overrideId}`, { override: { start_time: w.start, end_time: w.end, overriding_member: { id: userId } } }); // driftwatch-expect: http
}

// Already sends it: nothing to patch.
export async function extend(scheduleId: string, overrideId: string, userId: string, w: Window) {
  return pd.put(`/v3/schedules/${scheduleId}/overrides/${overrideId}`, { // driftwatch-expect: http
    override: { type: "override_shift", start_time: w.start, end_time: w.end, overriding_member: { id: userId } },
  });
}

// The body is built by the caller: reported, not patched.
export async function replace(scheduleId: string, overrideId: string, body: object) {
  return pd.put(`/v3/schedules/${scheduleId}/overrides/${overrideId}`, body); // driftwatch-expect: http
}
