// The plaid package's typings after the rename (protect_session_id became
// device_session_id), so the unpatched code is what fails to typecheck.
declare module "plaid" {
  export interface ProtectEvent {
    app_visit?: object;
    user_sign_in?: { user_id?: string };
    user_sign_up?: object;
    device_session_id?: string;
    timestamp?: string;
  }
  export interface ProtectEventSendRequest {
    event: ProtectEvent;
    device_session_id?: string;
    request_trust_index?: boolean;
  }
  export class Configuration {
    constructor(options: { basePath?: string; baseOptions?: object });
  }
  export const PlaidEnvironments: Record<string, string>;
  export class PlaidApi {
    constructor(configuration: Configuration);
    protectEventSend(request: ProtectEventSendRequest): Promise<{ data: { request_id: string } }>;
  }
}
