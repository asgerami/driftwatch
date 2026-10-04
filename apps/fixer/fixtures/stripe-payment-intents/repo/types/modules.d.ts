// Minimal stand-ins for the packages this fixture imports, as their typings
// were before the change: enough for the typecheck `fix` runs to be real.

declare module "axios" {
  interface AxiosResponse<T = any> {
    data: T;
    status: number;
  }
  interface AxiosInstance {
    <T = any>(config: object): Promise<AxiosResponse<T>>;
    get<T = any>(url: string, config?: object): Promise<AxiosResponse<T>>;
    post<T = any>(url: string, data?: unknown, config?: object): Promise<AxiosResponse<T>>;
    put<T = any>(url: string, data?: unknown, config?: object): Promise<AxiosResponse<T>>;
    request<T = any>(config: object): Promise<AxiosResponse<T>>;
  }
  interface AxiosStatic extends AxiosInstance {
    create(config?: { baseURL?: string; headers?: Record<string, string> }): AxiosInstance;
  }
  const axios: AxiosStatic;
  export default axios;
}

declare module "ky" {
  interface ResponsePromise extends Promise<Response> {
    json<T = any>(): Promise<T>;
  }
  interface KyInstance {
    (url: string, options?: object): ResponsePromise;
    get(url: string, options?: object): ResponsePromise;
    post(url: string, options?: object): ResponsePromise;
    create(options?: object): KyInstance;
    extend(options?: object): KyInstance;
  }
  const ky: KyInstance;
  export default ky;
}

declare module "stripe" {
  interface PaymentIntentParams {
    amount?: number;
    currency?: string;
    payment_method_types?: string[];
  }
  interface SessionParams {
    mode: "payment" | "setup" | "subscription";
    line_items?: { price: string; quantity: number }[];
    payment_method_types?: string[];
  }
  class Stripe {
    constructor(key: string, config?: { apiVersion?: string });
    paymentIntents: {
      create(params: PaymentIntentParams & { amount: number; currency: string }): Promise<{ id: string }>;
      update(id: string, params?: PaymentIntentParams): Promise<{ id: string }>;
      confirm(id: string, params?: PaymentIntentParams): Promise<{ id: string }>;
      retrieve(id: string): Promise<{ id: string }>;
      list(params?: { limit?: number }): Promise<{ data: { id: string }[] }>;
    };
    customers: { create(params: { email?: string }): Promise<{ id: string }> };
    checkout: { sessions: { create(params: SessionParams): Promise<{ id: string; url: string | null }> } };
  }
  export default Stripe;
}
