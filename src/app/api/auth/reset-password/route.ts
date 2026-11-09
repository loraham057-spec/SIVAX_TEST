import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email/send";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const adminClient = createSupabaseAdminClient();

    // Generate a recovery link WITHOUT sending Supabase's default email.
    // We'll send our own branded email via Resend instead.
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email,
    });

    if (error) {
      console.error("[reset-password] generateLink error:", error.message);
      // Don't leak whether the email exists
      return NextResponse.json({ sent: true });
    }

    // Build the recovery URL with the token, pointing to our update-password page
    // The properties.action_link is a Supabase verification URL like:
    // https://<project>.supabase.co/auth/v1/verify?token=xxx&type=recovery&redirect_to=...
    // We must KEEP the Supabase host intact (that's where token verification happens)
    // and only update the redirect_to param to point to our production URL.
    const actionLink = data.properties?.action_link;
    if (!actionLink) {
      console.error("[reset-password] No action_link in response");
      return NextResponse.json({ sent: true });
    }

    const recoveryUrl = new URL(actionLink);
    // Point redirect_to to our client-side auth callback page.
    // Supabase will verify the token and redirect here with the hash fragment:
    // /auth/callback#access_token=...&refresh_token=...&type=recovery
    // The callback page extracts the tokens, sets the session, and redirects to /update-password
    recoveryUrl.searchParams.set("redirect_to", `${APP_URL}/auth/callback`);

    // Send our branded email via Resend
    await sendNotificationEmail({
      to: email,
      subject: "SIVAX — Password Reset Request",
      title: "Password Reset",
      body: `You requested a password reset for your SIVAX account.<br/><br/>Click the button below to set a new password. This link will expire in 1 hour for security reasons.<br/><br/>If you did not request this change, you can safely ignore this email.`,
      actionUrl: recoveryUrl.toString(),
      actionLabel: "Reset my password",
    });

    return NextResponse.json({ sent: true });
  } catch (err) {
    console.error("[reset-password] Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
