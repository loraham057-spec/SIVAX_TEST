import { redirect } from "next/navigation";

/**
 * The Alerts tab was folded into Notifications: data-driven alerts now appear
 * in the unified feed. Keep the old route alive for bookmarks, push
 * notification `action_url`s and agent commands that still target /alerts.
 */
export default function AlertsRedirectPage() {
  redirect("/notifications?category=alerts");
}
