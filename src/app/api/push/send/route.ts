import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { sendBulkNotificationEmails } from "@/lib/email/send";

/**
 * Configures web-push on first use rather than at module load.
 *
 * At module scope, `setVapidDetails` runs during `next build` — page-data
 * collection imports the module — and throws when the private key is absent.
 * That made a RUNTIME secret a BUILD-TIME requirement: the image could not be
 * built without it, so the key had to be handed to the build environment and
 * baked into a layer. Deferring it means the CI builds with no secret at all.
 */
let vapidConfigured = false;

function configureWebPush(): boolean {
  if (vapidConfigured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails("mailto:notification@sivax.health", publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    // No fallback: the previous default was a literal published in this
    // repository (SEC-02). Without the variable set, no caller is internal.
    const expectedToken = process.env.PUSH_INTERNAL_TOKEN;
    const isInternal = Boolean(expectedToken) && authHeader === `Bearer ${expectedToken}`;

    if (!isInternal) {
      const supabaseAuth = await createSupabaseRouteHandlerClient();
      const { data: { user } } = await supabaseAuth.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { title, body, url, buildId, changelog, sendEmail } = await request.json();

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // Fetch all users for email notifications
    const { data: users } = await supabase
      .from("users")
      .select("id, email, full_name");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "/dashboard";
    const finalBuildId = buildId || Date.now().toString();
    const finalTitle = title || "SIVAX — New Version Deployed";
    const finalBody = body || "A new version of SIVAX is now live. Tap to open the updated app.";

    // Send email notifications to all users
    let emailResult = { succeeded: 0, failed: 0, total: 0 };
    if (sendEmail !== false && users && users.length > 0) {
      emailResult = await sendBulkNotificationEmails({
        recipients: users.map((u) => ({ email: u.email, name: u.full_name || undefined })),
        subject: finalTitle,
        title: "New Version Deployed",
        body: finalBody,
        changelog: changelog || [],
        actionUrl: appUrl,
        actionLabel: "Open SIVAX",
      });
    }

    // Fetch push subscriptions
    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key, user_id");

    if (error) {
      return NextResponse.json({ error: error.message, emailResult }, { status: 500 });
    }

    if (!subscriptions || subscriptions.length === 0) {
      // Still insert notifications for all users even without push subscriptions
      const allUserIds = users ? users.map((u) => u.id) : [];
      if (allUserIds.length > 0) {
        const notifications = allUserIds.map((userId) => ({
          user_id: userId,
          type: "system" as const,
          priority: "low" as const,
          title: "New version deployed",
          body: finalBody,
          summary: "SIVAX has been updated to the latest version.",
          icon: "Sparkles",
          color: "info",
          action_url: "/dashboard",
          action_label: "Go to dashboard",
          source: "system",
          metadata: { update_build_id: finalBuildId, changelog: changelog || [] },
          push_status: "not_subscribed" as const,
          push_sent_at: new Date().toISOString(),
        }));

        for (let i = 0; i < notifications.length; i += 50) {
          await supabase.from("notifications").insert(notifications.slice(i, i + 50));
        }
      }

      return NextResponse.json({ success: true, sent: 0, emailResult, message: "No push subscriptions" });
    }

    const payload = JSON.stringify({
      title: finalTitle,
      body: finalBody,
      url: url || appUrl,
      tag: `deploy-${finalBuildId}`,
      buildId: finalBuildId,
    });

    // Configured on first send, not at import. Missing keys are a
    // configuration problem, not a request problem.
    if (!configureWebPush()) {
      return NextResponse.json(
        { error: "Web push is not configured (VAPID keys missing)" },
        { status: 503 },
      );
    }

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth_key },
          },
          payload
        )
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // Insert notification into Supabase for all users (push subscribers + email-only users)
    const subscriberUserIds = new Set(subscriptions.map((s) => s.user_id));
    const allUserIds = users ? users.map((u) => u.id) : [];
    const allNotificationUserIds = new Set([...subscriberUserIds, ...allUserIds]);

    const notifications = Array.from(allNotificationUserIds).map((userId) => ({
      user_id: userId,
      type: "system" as const,
      priority: "low" as const,
      title: "New version deployed",
      body: finalBody,
      summary: "SIVAX has been updated to the latest version.",
      icon: "Sparkles",
      color: "info",
      action_url: "/dashboard",
      action_label: "Go to dashboard",
      source: "system",
      metadata: { update_build_id: finalBuildId, changelog: changelog || [] },
      push_status: subscriberUserIds.has(userId) ? (succeeded > 0 ? "sent" : "failed") : "not_subscribed",
      push_sent_at: new Date().toISOString(),
    }));

    for (let i = 0; i < notifications.length; i += 50) {
      await supabase.from("notifications").insert(notifications.slice(i, i + 50));
    }

    // Clean up expired subscriptions
    const expiredEndpoints = results
      .map((r, i) => {
        if (r.status === "rejected" && (r.reason as { statusCode?: number })?.statusCode === 410) {
          return subscriptions[i].endpoint;
        }
        return null;
      })
      .filter(Boolean);

    if (expiredEndpoints.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", expiredEndpoints);
    }

    return NextResponse.json({ success: true, sent: succeeded, failed, emailResult });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
