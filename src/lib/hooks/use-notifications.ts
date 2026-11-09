"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useAuth } from "@/lib/auth/auth-provider";
import { alertsService } from "@/services";
import type { AlertItem, AlertSeverity, FeedItem, NotificationItem, NotificationPriority } from "@/types";

interface UseNotificationsReturn {
  notifications: FeedItem[];
  unreadCount: number;
  isLoading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  clickNotification: (id: string) => Promise<void>;
}

/** Feed ids of alerts are namespaced so they never collide with notification UUIDs. */
const ALERT_ID_PREFIX = "alert:";
const ALERTS_FETCH_LIMIT = 50;

export function isAlertFeedId(id: string): boolean {
  return id.startsWith(ALERT_ID_PREFIX);
}

function alertId(feedId: string): string {
  return feedId.slice(ALERT_ID_PREFIX.length);
}

const SEVERITY_TO_PRIORITY: Record<AlertSeverity, NotificationPriority> = {
  critical: "critical",
  warning: "high",
  info: "medium",
};

/** Project a data-driven alert onto the notification shape used by the feed. */
export function alertToFeedItem(alert: AlertItem): FeedItem {
  const createdAt = alert.createdAt ?? new Date().toISOString();
  return {
    id: `${ALERT_ID_PREFIX}${alert.id}`,
    user_id: null,
    type: "alert",
    priority: SEVERITY_TO_PRIORITY[alert.severity] ?? "medium",
    title: alert.title,
    body: alert.message,
    summary: null,
    icon: null,
    color: null,
    action_url: alert.actionUrl ?? null,
    action_label: null,
    metadata: { alertType: alert.type, region: alert.region ?? null, deadline: alert.deadline ?? null },
    read_at: alert.read ? createdAt : null,
    dismissed_at: null,
    clicked_at: null,
    push_sent_at: null,
    push_status: "n/a",
    push_error: null,
    expires_at: null,
    created_by: null,
    source: alert.source,
    created_at: createdAt,
    updated_at: createdAt,
    alert,
  };
}

function updateAppBadge(count: number) {
  if ("setAppBadge" in navigator) {
    if (count > 0) {
      (navigator as Navigator & { setAppBadge: (n: number) => Promise<void> })
        .setAppBadge(count)
        .catch(() => {});
    } else {
      (navigator as Navigator & { clearAppBadge: () => Promise<void> })
        .clearAppBadge()
        .catch(() => {});
    }
  }
}

function byNewest(a: FeedItem, b: FeedItem): number {
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

/**
 * Unified notification feed: rows of the `notifications` table plus the
 * data-driven alerts (coverage gaps, dropout, deadlines) computed from DHIS2.
 * Alerts used to have their own page; they now surface here so a single bell,
 * a single unread count and a single list cover everything the user must see.
 */
export function useNotifications(): UseNotificationsReturn {
  const supabase = createSupabaseBrowserClient();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [alerts, setAlerts] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const channelIdRef = useRef(Math.random().toString(36).slice(2));

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error fetching notifications:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        });
        setNotifications([]);
      } else {
        setNotifications(data as NotificationItem[]);
      }
    } catch (err) {
      console.error("Unexpected error fetching notifications:", err);
      setNotifications([]);
    }
  }, [user, supabase]);

  const fetchAlerts = useCallback(async () => {
    if (!user) {
      setAlerts([]);
      return;
    }
    try {
      const data = await alertsService.getAll({ limit: ALERTS_FETCH_LIMIT });
      setAlerts(data.map(alertToFeedItem));
    } catch (err) {
      console.error("Error fetching alerts:", err);
      setAlerts([]);
    }
  }, [user]);

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchNotifications(), fetchAlerts()]);
    setIsLoading(false);
  }, [fetchNotifications, fetchAlerts]);

  useEffect(() => {
    if (mounted) fetchAll();
  }, [fetchAll, mounted]);

  // Real-time subscription on both tables
  useEffect(() => {
    if (!user || !mounted) return;

    const channelName = `notifications-${channelIdRef.current}-${Date.now()}`;
    const channel = supabase.channel(channelName);

    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          fetchNotifications();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => {
          fetchAlerts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, supabase, fetchNotifications, fetchAlerts, mounted]);

  const feed: FeedItem[] = mounted ? [...notifications, ...alerts].sort(byNewest) : [];

  // Update PWA badge when unread count changes (client only)
  const unreadCount = feed.filter((n) => !n.read_at).length;
  useEffect(() => {
    if (mounted) updateAppBadge(unreadCount);
  }, [unreadCount, mounted]);

  const markAlertRead = useCallback(async (feedId: string) => {
    const now = new Date().toISOString();
    setAlerts((prev) =>
      prev.map((a) => (a.id === feedId ? { ...a, read_at: now, alert: a.alert && { ...a.alert, read: true } } : a))
    );
    try {
      await alertsService.markRead(alertId(feedId));
    } catch (err) {
      console.error("Error marking alert as read:", err);
    }
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    if (isAlertFeedId(id)) return markAlertRead(id);

    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Error marking notification as read:", error);
      return;
    }

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
    fetchNotifications();
  }, [supabase, fetchNotifications, markAlertRead]);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;

    const now = new Date().toISOString();
    const unreadIds = notifications.filter((n) => !n.read_at).map((n) => n.id);
    const hasUnreadAlerts = alerts.some((a) => !a.read_at);

    const tasks: Promise<unknown>[] = [];
    if (unreadIds.length > 0) {
      tasks.push(
        (async () => {
          const { error } = await supabase.from("notifications").update({ read_at: now }).in("id", unreadIds);
          if (error) console.error("Error marking all notifications as read:", error);
        })()
      );
    }
    if (hasUnreadAlerts) {
      setAlerts((prev) =>
        prev.map((a) => (a.read_at ? a : { ...a, read_at: now, alert: a.alert && { ...a.alert, read: true } }))
      );
      tasks.push(alertsService.markAllRead().catch((err) => console.error("Error marking all alerts as read:", err)));
    }
    if (tasks.length === 0) return;

    await Promise.all(tasks);
    setNotifications((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    fetchNotifications();
  }, [supabase, user, notifications, alerts, fetchNotifications]);

  const dismiss = useCallback(async (id: string) => {
    // Alerts are computed from data and cannot be deleted; dismissing hides
    // them from the unread set, which is what the user means by "dismiss".
    if (isAlertFeedId(id)) return markAlertRead(id);

    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting notification:", error);
      return;
    }

    setNotifications((prev) => prev.filter((n) => n.id !== id));
    fetchNotifications();
  }, [supabase, fetchNotifications, markAlertRead]);

  const clickNotification = useCallback(async (id: string) => {
    if (isAlertFeedId(id)) return markAlertRead(id);

    const { error } = await supabase
      .from("notifications")
      .update({ clicked_at: new Date().toISOString(), read_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Error updating notification click:", error);
      return;
    }

    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, clicked_at: new Date().toISOString(), read_at: new Date().toISOString() }
          : n
      )
    );
    fetchNotifications();
  }, [supabase, fetchNotifications, markAlertRead]);

  return {
    notifications: feed,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    dismiss,
    clickNotification,
  };
}
