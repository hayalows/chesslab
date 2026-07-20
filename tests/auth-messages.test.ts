import assert from "node:assert/strict";
import test from "node:test";
import { friendlyAuthError } from "../src/lib/auth-messages";

test("email quota errors are explained without backend wording", () => {
  assert.equal(
    friendlyAuthError({ message: "email rate limit exceeded", code: "over_email_send_rate_limit" }),
    "RivalMind’s email service has reached its temporary sending limit. Please try again later.",
  );
});

test("short resend cooldowns tell the player when to retry", () => {
  assert.equal(
    friendlyAuthError({ message: "For security purposes, you can only request this after 49 seconds." }),
    "Please wait one minute before requesting another email.",
  );
});

test("unknown authentication errors remain available for diagnosis", () => {
  assert.equal(friendlyAuthError({ message: "Network request failed" }), "Network request failed");
});
