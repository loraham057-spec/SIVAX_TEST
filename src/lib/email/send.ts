import { Resend } from "resend";
import { buildEmailHtml } from "./templates";
import { getSetting } from "@/lib/settings";

const FROM_EMAIL = "notification@sivax.health";
const FROM_NAME = "SIVAX Notifications";

interface SendEmailParams {
  to: string;
  bcc?: string;
  subject: string;
  title: string;
  body: string;
  changelog?: string[];
  actionUrl?: string;
  actionLabel?: string;
  recipientName?: string;
}

export async function sendNotificationEmail(params: SendEmailParams) {
  const apiKey = await getSetting("resend_api_key");
  if (!apiKey) return { success: false, error: "RESEND_API_KEY is not configured" };
  const resend = new Resend(apiKey);
  const html = buildEmailHtml({
    title: params.title,
    body: params.body,
    changelog: params.changelog,
    actionUrl: params.actionUrl,
    actionLabel: params.actionLabel,
    recipientName: params.recipientName,
  });

  const { data, error } = await resend.emails.send({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: params.to,
    bcc: params.bcc,
    replyTo: FROM_EMAIL,
    subject: params.subject,
    html,
  });

  if (error) {
    console.error("[email] Failed to send:", error);
    return { success: false, error };
  }

  return { success: true, id: data?.id };
}

interface BulkEmailParams {
  recipients: { email: string; name?: string }[];
  subject: string;
  title: string;
  body: string;
  changelog?: string[];
  actionUrl?: string;
  actionLabel?: string;
}

export async function sendBulkNotificationEmails(params: BulkEmailParams) {
  const results = await Promise.allSettled(
    params.recipients.map((recipient) =>
      sendNotificationEmail({
        to: recipient.email,
        subject: params.subject,
        title: params.title,
        body: params.body,
        changelog: params.changelog,
        actionUrl: params.actionUrl,
        actionLabel: params.actionLabel,
        recipientName: recipient.name,
      })
    )
  );

  let succeeded = 0;
  let failed = 0;

  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.success) {
      succeeded++;
    } else {
      failed++;
      const email = params.recipients[i].email;
      if (r.status === "fulfilled") {
        console.error(`[email] Failed for ${email}:`, r.value.error);
      } else {
        console.error(`[email] Rejected for ${email}:`, r.reason);
      }
    }
  });

  return { succeeded, failed, total: params.recipients.length };
}
