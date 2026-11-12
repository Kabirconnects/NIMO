import axios from "axios";

const DEFAULT_API_URL = import.meta.env.PROD
  ? "https://api.yourdomain.com"
  : "/api";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || DEFAULT_API_URL,
  withCredentials: true,
  timeout: 180000,
  headers: {
    "Content-Type": "application/json",
  },
});

export default apiClient;
