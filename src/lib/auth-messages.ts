type AuthFailure = { message: string; code?: string };

export function friendlyAuthError(error: AuthFailure) {
  const message = error.message.toLowerCase();

  if (error.code === "over_email_send_rate_limit" || message.includes("email rate limit")) {
    return "RivalMind’s email service has reached its temporary sending limit. Please try again later.";
  }
  if (message.includes("for security purposes") || message.includes("request this after")) {
    return "Please wait one minute before requesting another email.";
  }
  if (message.includes("invalid login credentials")) {
    return "That email or password is not correct.";
  }
  if (message.includes("user already registered")) {
    return "An account already exists for this email. Choose Sign in or reset your password.";
  }

  return error.message;
}
