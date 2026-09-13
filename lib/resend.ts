import { Resend } from "resend";

let client: Resend | null = null;

function getResendClient() {
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY || "re_placeholder_key_not_set");
  }
  return client;
}

// IMPORTANT: the `resend` SDK does NOT throw when the API rejects a send (e.g.
// an unverified sending domain) — it resolves with `{ data: null, error }`
// instead. This was the exact cause of a silent "nothing happened" bug on the
// main UniNexus Connect site (gate pass emails), so this project checks the
// error field explicitly from the start rather than repeating that mistake.
async function sendOrThrow(payload: Parameters<Resend["emails"]["send"]>[0]) {
  const { data, error } = await getResendClient().emails.send(payload);
  if (error) {
    throw new Error(`Resend rejected the email: ${error.message} (${error.name})`);
  }
  return data;
}

export async function sendNewNominationAlertEmail({
  nomineeName, categoryName,
}: { nomineeName: string; categoryName: string }) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) return; // Notifications are optional — skip quietly if not configured.

  return sendOrThrow({
    from: process.env.RESEND_FROM_EMAIL || "UniNexus Connect Gala Awards <notifications@unx-awards.co.ke>",
    to,
    subject: `New nomination: ${nomineeName} (${categoryName})`,
    html: `
      <div style="font-family: Georgia, serif; background:#0A0A0B; color:#FAF7EF; padding:32px; border-radius:12px;">
        <p style="color:#C9A227; letter-spacing:2px; font-size:12px; text-transform:uppercase;">UniNexus Connect Gala Awards</p>
        <h1 style="font-size:20px; margin:8px 0 16px;">New nomination awaiting moderation</h1>
        <p><strong>${nomineeName}</strong> was just nominated in <strong>${categoryName}</strong>.</p>
        <p>Review it in the admin panel under Nominees (filtered to "Pending").</p>
      </div>
    `,
  });
}
