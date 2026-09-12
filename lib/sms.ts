import AfricasTalking from "africastalking";

let atClient: ReturnType<typeof AfricasTalking> | null = null;

function getSmsClient() {
  if (!atClient) {
    // Lazily created — avoids crashing `next build` if AFRICASTALKING_* env vars
    // aren't set yet (same pattern as lib/resend.ts and lib/web-push.ts).
    atClient = AfricasTalking({
      apiKey: process.env.AFRICASTALKING_API_KEY || "placeholder",
      username: process.env.AFRICASTALKING_USERNAME || "sandbox",
    });
  }
  return atClient;
}

export async function sendOtpSms(phone: string, code: string) {
  const client = getSmsClient();
  const result: any = await client.SMS.send({
    to: [phone],
    message: `Your UniNexus Gala Awards voting code is ${code}. It expires in 5 minutes. Never share this code with anyone.`,
    from: process.env.AFRICASTALKING_SENDER_ID || undefined,
  });

  // CRITICAL: Africa's Talking's API resolves successfully at the HTTP level even
  // when the SMS itself failed to reach the recipient — the real outcome is buried
  // in result.SMSMessageData.Recipients[].status ("Success" vs "InsufficientBalance",
  // "InvalidPhoneNumber", "UserInBlackList", etc.), and the client library does NOT
  // throw for that. This code used to just `await` the call and return {ok: true}
  // to the voter regardless — meaning "verification code sent" could show on
  // screen while nothing was ever delivered, identical to the Resend email bug
  // found earlier. With a public rollout expecting real vote volume, an
  // insufficient AT account balance or an unapproved sender ID would otherwise
  // fail completely silently. Now it throws so the OTP request route's existing
  // try/catch (Sentry + a proper error to the voter) actually catches it.
  const recipient = result?.SMSMessageData?.Recipients?.[0];
  if (!recipient || recipient.status !== "Success") {
    throw new Error(
      `Africa's Talking SMS failed for ${phone}: ${recipient?.status || "no recipient in response"} — ${JSON.stringify(result).slice(0, 300)}`
    );
  }
}
