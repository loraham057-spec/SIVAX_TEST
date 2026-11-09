import { APP_NAME, APP_URL, PRIMARY_COLOR, ACCENT_COLOR } from "@/lib/constants";

const FONT_FAMILY = "'Afacad', 'Helvetica Neue', Arial, sans-serif";

interface EmailTemplateData {
  title: string;
  body: string;
  changelog?: string[];
  actionUrl?: string;
  actionLabel?: string;
  recipientName?: string;
}

export function buildEmailHtml(data: EmailTemplateData): string {
  const { title, body, changelog, actionUrl, actionLabel, recipientName } = data;
  const greeting = recipientName ? `Hello ${recipientName},` : "Hello,";

  const changelogHtml = changelog && changelog.length > 0
    ? `
    <tr>
      <td style="padding:0 40px 24px;">
        <h2 style="margin:0 0 12px;font-size:16px;font-weight:600;color:#1e293b;font-family:${FONT_FAMILY};">What's new</h2>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">
          ${changelog.map((item) => `
          <tr>
            <td style="padding:6px 0;font-size:15px;color:#475569;font-family:${FONT_FAMILY};">
              <span style="color:${ACCENT_COLOR};font-weight:bold;margin-right:8px;">&bull;</span>${item}
            </td>
          </tr>`).join("")}
        </table>
      </td>
    </tr>`
    : "";

  const actionHtml = actionUrl && actionLabel
    ? `
    <tr>
      <td style="padding:0 40px 32px;text-align:center;">
        <a href="${actionUrl}" style="display:inline-block;padding:12px 32px;background-color:${PRIMARY_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;font-family:${FONT_FAMILY};">${actionLabel}</a>
      </td>
    </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <link href="https://fonts.cdnfonts.com/css/afacad" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:${FONT_FAMILY};">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${PRIMARY_COLOR} 0%,${ACCENT_COLOR} 100%);padding:32px 40px;text-align:center;">
              <img src="${APP_URL}/logo_diav1.png" alt="${APP_NAME}" style="height:48px;margin:0 auto;display:block;" />
              <p style="margin:12px 0 0;color:#ffffff;font-size:14px;opacity:0.9;font-family:${FONT_FAMILY};letter-spacing:0.5px;">AI-Powered Health Platform</p>
            </td>
          </tr>
          <!-- Greeting -->
          <tr>
            <td style="padding:32px 40px 0;">
              <p style="margin:0 0 16px;font-size:16px;color:#1e293b;font-family:${FONT_FAMILY};">${greeting}</p>
            </td>
          </tr>
          <!-- Title -->
          <tr>
            <td style="padding:0 40px 8px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;font-family:${FONT_FAMILY};">${title}</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:0 40px 24px;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;font-family:${FONT_FAMILY};">${body}</p>
            </td>
          </tr>
          <!-- Changelog -->
          ${changelogHtml}
          <!-- Action button -->
          ${actionHtml}
          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" />
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#94a3b8;font-family:${FONT_FAMILY};">
                ${APP_NAME} &mdash; AI-Powered Health Platform<br/>
                You received this email because you have an account on <a href="${APP_URL}" style="color:${PRIMARY_COLOR};text-decoration:none;">${APP_URL.replace(/^https?:\/\//, "")}</a>
              </p>
              <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;font-family:${FONT_FAMILY};">
                <a href="${APP_URL}/settings" style="color:#94a3b8;text-decoration:underline;">Manage notification preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
