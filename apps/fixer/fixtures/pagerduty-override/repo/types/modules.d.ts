// A minimal stand-in for axios: the fixtures install no dependencies.
declare module "axios" {
  interface AxiosResponse<T = any> {
    data: T;
    status: number;
  }
  interface AxiosInstance {
    put<T = any>(url: string, data?: unknown, config?: object): Promise<AxiosResponse<T>>;
  }
  interface AxiosStatic extends AxiosInstance {
    create(config?: { baseURL?: string; headers?: Record<string, string> }): AxiosInstance;
  }
  const axios: AxiosStatic;
  export default axios;
}
