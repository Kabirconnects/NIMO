import axios from "axios";

const DEFAULT_API_URL = import.meta.env.PROD
  ? "https://api.yourdomain.com"
  : "/api";

export const API_BASE_URL = import.meta.env.VITE_API_URL || DEFAULT_API_URL;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 180000,
  headers: {
    "Content-Type": "application/json",
  },
});

export default apiClient;
