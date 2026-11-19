/** Public user shape returned by the API (`AuthUser` on the server). */
export interface User {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  isActive: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

/** Success body shared by `POST /users`, `POST /users/login` and `GET /users/me`. */
export interface AuthResponse {
  success: true;
  user: User;
}
