export interface ApiUrlConfigEnv {
  prod: boolean;
  viteApiUrl?: string;
}

export function getApiBaseUrl(env: ApiUrlConfigEnv): string {
  if (env.viteApiUrl && env.viteApiUrl.trim() !== "") {
    return env.viteApiUrl;
  }
  if (env.prod) {
    throw new Error(
      "Configuration error: VITE_API_URL is required in production but was not provided."
    );
  }
  return "/api";
}
