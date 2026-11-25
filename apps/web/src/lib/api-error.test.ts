import { getApiErrorMessage } from "./api-error.js";

export function runApiErrorTests(assert: (label: string, condition: boolean) => void) {
  console.log("getApiErrorMessage");

  // Plain Error carrying an internal message yields a safe fallback message instead
  const plainError = new Error("Database connection failed: password was incorrect");
  const msg1 = getApiErrorMessage(plainError, "Default safe message");
  assert("plain Error returns safe fallback message instead of raw error message", msg1 === "Default safe message");

  // Default fallback if no fallback is provided
  const msgDefault = getApiErrorMessage(plainError);
  assert("plain Error uses default fallback message when none provided", msgDefault === "Something went wrong. Please try again.");

  // Axios error with server error message still returns the server's own message
  const axiosError = Object.assign(new Error("Network Error"), {
    isAxiosError: true,
    response: {
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config: {} as any,
      data: {
        success: false,
        error: "Invalid email or password",
      },
    },
  });
  const msgAxios = getApiErrorMessage(axiosError);
  assert("axios error path still returns the server's own message", msgAxios === "Invalid email or password");
}
