import { getApiBaseUrl } from "./api-url.js";

export function runApiUrlTests(assert: (label: string, condition: boolean) => void) {
  console.log("getApiBaseUrl");

  // Development with explicit VITE_API_URL
  const devWithUrl = getApiBaseUrl({ prod: false, viteApiUrl: "http://localhost:3000" });
  assert("dev with viteApiUrl returns viteApiUrl", devWithUrl === "http://localhost:3000");

  // Development without VITE_API_URL falls back to /api
  const devWithoutUrl = getApiBaseUrl({ prod: false, viteApiUrl: undefined });
  assert("dev without viteApiUrl returns /api", devWithoutUrl === "/api");

  // Production with explicit VITE_API_URL
  const prodWithUrl = getApiBaseUrl({ prod: true, viteApiUrl: "https://api.example.com" });
  assert("prod with viteApiUrl returns viteApiUrl", prodWithUrl === "https://api.example.com");

  // Production without VITE_API_URL throws error
  let threw = false;
  try {
    getApiBaseUrl({ prod: true, viteApiUrl: undefined });
  } catch (err: any) {
    if (err instanceof Error && err.message.includes("VITE_API_URL is required")) {
      threw = true;
    }
  }
  assert("prod without viteApiUrl throws clear configuration error", threw);
}
