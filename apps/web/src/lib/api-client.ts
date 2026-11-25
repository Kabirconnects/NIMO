import axios from "axios";
import { getApiBaseUrl } from "./api-url.js";

export const API_BASE_URL = getApiBaseUrl({
  prod: import.meta.env.PROD,
  viteApiUrl: import.meta.env.VITE_API_URL,
});

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 180000,
  headers: {
    "Content-Type": "application/json",
  },
});

export default apiClient;
