// Celcom Africa has no official SDK — it's a plain REST API, called here with
// native fetch rather than a client library. This also means it works
// correctly in both Node and Edge runtimes, unlike the old Africa's Talking
// package, which required Node.
const CELCOM_ENDPOINT = "https://isms.celcomafrica.com/api/services/sendsms/";

// From Celcom's documented return codes — used to turn a bare numeric code
// into something a log line (or a thrown error) actually explains.
const CELCOM_ERROR_MESSAGES: Record<string, string> = {
  "1001": "Invalid sender ID",
  "1002": "Network not allowed",
  "1003": "Invalid mobile number",
  "1004": "Low bulk SMS credits",
  "1005": "Celcom system error",
  "1006": "Invalid Celcom API credentials",
  "1007": "Celcom system error",
  "1008": "No delivery report",
  "1009": "Unsupported data type sent to Celcom",
  "1010": "Unsupported request type sent to Celcom",
  "4090": "Celcom internal error — try again shortly",
  "4091": "No partner ID configured",
  "4092": "No Celcom API key configured",
  "4093": "Details not found",
};

export async function sendOtpSms(phone: string, code: string) {
  const partnerID = process.env.CELCOM_PARTNER_ID;
  const apikey = process.env.CELCOM_API_KEY;
  const shortcode = process.env.CELCOM_SENDER_ID;

  if (!partnerID || !apikey || !shortcode) {
    throw new Error(
      "Celcom Africa SMS is not configured — missing CELCOM_PARTNER_ID, CELCOM_API_KEY, or CELCOM_SENDER_ID."
    );
  }

  // Strip a leading "+" if present — Celcom expects 254XXXXXXXXX, not
  // +254XXXXXXXXX, matching the format shown in their own sample code.
  const mobile = phone.replace(/^\+/, "");

  const res = await fetch(CELCOM_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partnerID,
      apikey,
      mobile,
      message: `Your UniNexus Gala Awards voting code is ${code}. It expires in 5 minutes. Never share this code with anyone.`,
      shortcode,
      pass_type: "plain",
    }),
  });

  let result: any;
  try {
    result = await res.json();
  } catch {
    throw new Error(`Celcom Africa SMS: non-JSON response (HTTP ${res.status}) for ${phone}`);
  }

  // CRITICAL, same class of bug as the Africa's Talking version: Celcom's API
  // resolves at the HTTP level even when the SMS itself failed to send — the
  // real per-recipient outcome is nested inside result.responses[0]. Their
  // own API uses the field name "respose-code" (their typo, confirmed in
  // their own documentation and real responses), not "response-code" — both
  // are checked here in case that ever gets corrected on their end.
  const entry = result?.responses?.[0];
  const statusCode = entry?.["respose-code"] ?? entry?.["response-code"];

  if (!entry || String(statusCode) !== "200") {
    const description =
      entry?.["response-description"] || CELCOM_ERROR_MESSAGES[String(statusCode)] || "Unknown error";
    throw new Error(
      `Celcom Africa SMS failed for ${phone}: code ${statusCode ?? "none"} — ${description} — ${JSON.stringify(result).slice(0, 300)}`
    );
  }
}
