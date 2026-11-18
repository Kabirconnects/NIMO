export { AuthPage, type AuthMode } from "./components/auth-page"
export { LoginForm } from "./components/login-form"
export { RegisterForm } from "./components/register-form"
export { ProtectedRoute } from "./components/protected-route"

export { useSession, sessionQueryKey } from "./hooks/use-session"
export { useLogin } from "./hooks/use-login"
export { useRegister } from "./hooks/use-register"
export { useLogout } from "./hooks/use-logout"

export type { AuthResponse, LoginInput, RegisterInput, User } from "./types"
