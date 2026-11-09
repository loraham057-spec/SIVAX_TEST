"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Info,
  AlertTriangle,
  AlertCircle,
  Check,
  Sparkles,
  BarChart3,
  Shield,
  Database,
  User as UserIcon,
  Loader2,
  Trash2,
  Activity,
  TrendingUp,
  ShieldAlert,
  CalendarClock,
  Zap,
  MapPin,
  ArrowRight,
  Eye,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useNotifications, isAlertFeedId } from "@/lib/hooks/use-notifications";
import { useAgent } from "@/lib/agent/agent-provider";
import type { AlertItem, AlertSeverity, AlertType, FeedItem, NotificationPriority, NotificationType } from "@/types";
import { useTranslations } from "next-intl";

const TYPE_CONFIG: Record<NotificationType, { icon: typeof Info; color: string; labelKey: string }> = {
  system: { icon: Info, color: "text-blue-500", labelKey: "system" },
  alert: { icon: AlertTriangle, color: "text-amber-500", labelKey: "alert" },
  ml_insight: { icon: Sparkles, color: "text-purple-500", labelKey: "mlInsight" },
  data_quality: { icon: Database, color: "text-orange-500", labelKey: "dataQuality" },
  user: { icon: UserIcon, color: "text-green-500", labelKey: "user" },
  powerbi: { icon: BarChart3, color: "text-yellow-500", labelKey: "powerbi" },
  security: { icon: Shield, color: "text-red-500", labelKey: "security" },
};

/** Alert categories keep the visual identity they had on the former Alerts page. */
const ALERT_TYPE_CONFIG: Record<AlertType, { icon: typeof Activity; color: string; labelKey: string }> = {
  analysis: { icon: Activity, color: "text-blue-500", labelKey: "alertAnalysis" },
  prediction: { icon: TrendingUp, color: "text-purple-500", labelKey: "alertPrediction" },
  danger: { icon: ShieldAlert, color: "text-red-600", labelKey: "alertDanger" },
  deadline: { icon: CalendarClock, color: "text-amber-500", labelKey: "alertDeadline" },
  imminent: { icon: Zap, color: "text-orange-500", labelKey: "alertImminent" },
};

const SEVERITY_CONFIG: Record<AlertSeverity, { icon: typeof Info; color: string; labelKey: string }> = {
  info: { icon: Info, color: "text-blue-500", labelKey: "severityInfo" },
  warning: { icon: AlertTriangle, color: "text-amber-500", labelKey: "severityWarning" },
  critical: { icon: AlertCircle, color: "text-red-600", labelKey: "severityCritical" },
};

const PRIORITY_VARIANT: Record<NotificationPriority, "default" | "secondary" | "destructive"> = {
  low: "secondary",
  medium: "default",
  high: "default",
  critical: "destructive",
};

type StatusFilter = "all" | "unread" | "read";

function timeAgo(dateStr: string, t: ReturnType<typeof useTranslations>): string {
  const date = new Date(dateStr);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t("justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("mAgo", { min: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hAgo", { hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("dAgo", { days });
  return date.toLocaleDateString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function deadlineText(alert: AlertItem, t: ReturnType<typeof useTranslations>): string | null {
  if (!alert.deadline) return null;
  const days = Math.ceil((new Date(alert.deadline).getTime() - Date.now()) / 86_400_000);
  const date = formatDate(alert.deadline);
  if (days > 0) return t("dueIn", { days, date });
  if (days === 0) return t("dueToday", { date });
  return t("overdueBy", { days: Math.abs(days), date });
}

/** Zone/province from the alert's region, else parsed from "…: Name (xx%), Name (yy%)". */
function alertZone(alert: AlertItem): string | null {
  if (alert.region) return alert.region;
  const match = alert.message.match(/:\s*(.+)$/);
  if (!match) return null;
  const names = match[1]
    .split(",")
    .map((s) => s.replace(/\s*\([\d.]+%\)\s*/g, "").trim())
    .filter(Boolean);
  if (names.length === 0) return null;
  return names.length === 1 ? names[0] : `${names.length} provinces`;
}

export default function NotificationsPage() {
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead, dismiss } = useNotifications();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<FeedItem | null>(null);
  const t = useTranslations("notifications");

  const criticalAlertCount = notifications.filter((n) => n.alert?.severity === "critical" && !n.read_at).length;

  const filtered = useMemo(
    () =>
      notifications.filter((n) => {
        if (status === "unread" && n.read_at) return false;
        if (status === "read" && !n.read_at) return false;
        return true;
      }),
    [notifications, status],
  );

  // Agent command handlers — these used to live on the Alerts page.
  const { register } = useAgent();
  useEffect(() => {
    const unregs = [
      register("filter_alerts", (args) => {
        if (args.status) setStatus(args.status as StatusFilter);
      }),
      register("mark_all_alerts_read", () => {
        void markAllAsRead();
      }),
      register("mark_alert_read", (args) => {
        const id = args.id as string | undefined;
        if (id) void markAsRead(isAlertFeedId(id) ? id : `alert:${id}`);
      }),
    ];
    return () => unregs.forEach((fn) => fn());
  }, [register, markAllAsRead, markAsRead]);

  const statusFilters: { label: string; value: StatusFilter }[] = [
    { label: t("all"), value: "all" },
    { label: t("unread"), value: "unread" },
    { label: t("read"), value: "read" },
  ];

  const chip = (active: boolean) =>
    cn(
      "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent/10",
    );

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0 ? t("unreadCount", { count: unreadCount }) : t("allCaughtUp")}
            {criticalAlertCount > 0 && (
              <span className="ml-2 font-medium text-red-600">
                · {t("criticalAlertsUnread", { count: criticalAlertCount })}
              </span>
            )}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllAsRead}>
            <Check className="h-3.5 w-3.5" />
            {t("markAllRead")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {statusFilters.map((f) => (
          <button key={f.value} onClick={() => setStatus(f.value)} className={chip(status === f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-10 w-10 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t("noNotifications")}</p>
              <p className="text-xs text-muted-foreground">{t("noNotificationsDesc")}</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((notif) => {
            const alert = notif.alert;
            const config = alert ? ALERT_TYPE_CONFIG[alert.type] : TYPE_CONFIG[notif.type];
            const Icon = config.icon;
            const isUnread = !notif.read_at;
            const zone = alert ? alertZone(alert) : null;
            const deadline = alert ? deadlineText(alert, t) : null;
            const sev = alert ? SEVERITY_CONFIG[alert.severity] : null;
            return (
              <Card
                key={notif.id}
                className={cn(
                  "transition-colors",
                  isUnread && "border-primary/30 bg-primary/5",
                  alert?.severity === "critical" && isUnread && "border-red-600/40 bg-red-600/5",
                )}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <div className={cn("mt-0.5", config.color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{notif.title}</p>
                      {isUnread && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{notif.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {sev ? (
                        <Badge variant={PRIORITY_VARIANT[notif.priority]} className="gap-1 text-xs">
                          <sev.icon className="h-3 w-3" />
                          {t(sev.labelKey)}
                        </Badge>
                      ) : (
                        <Badge variant={PRIORITY_VARIANT[notif.priority]} className="text-xs">
                          {notif.priority}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {t(config.labelKey)}
                      </Badge>
                      {zone && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {zone}
                        </span>
                      )}
                      {deadline && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                          <CalendarClock className="h-3 w-3" />
                          {deadline}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">{timeAgo(notif.created_at, t)}</span>
                    </div>
                    {notif.action_url && (
                      <Link
                        href={notif.action_url}
                        onClick={() => isUnread && void markAsRead(notif.id)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        {notif.action_label ?? (alert ? t("investigate") : t("open"))}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {alert && (
                      <Button variant="ghost" size="sm" onClick={() => setSelected(notif)} title={t("details")}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    )}
                    {isUnread && (
                      <Button variant="ghost" size="sm" onClick={() => markAsRead(notif.id)} title={t("markAsRead")}>
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    {!alert && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismiss(notif.id)}
                        title={t("delete")}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <AlertDetailsDialog
        item={selected}
        onClose={() => setSelected(null)}
        onMarkRead={(id) => {
          void markAsRead(id);
          setSelected((cur) => (cur && cur.id === id ? { ...cur, read_at: new Date().toISOString() } : cur));
        }}
      />
    </div>
  );
}

function AlertDetailsDialog({
  item,
  onClose,
  onMarkRead,
}: {
  item: FeedItem | null;
  onClose: () => void;
  onMarkRead: (id: string) => void;
}) {
  const t = useTranslations("notifications");
  const alert = item?.alert;
  if (!item || !alert) return <Dialog open={false} />;

  const typeConfig = ALERT_TYPE_CONFIG[alert.type];
  const sev = SEVERITY_CONFIG[alert.severity];
  const TypeIcon = typeConfig.icon;
  const SevIcon = sev.icon;
  const zone = alertZone(alert);
  const deadline = deadlineText(alert, t);
  const isUnread = !item.read_at;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t("fieldMessage"), value: alert.message },
    { label: t("fieldCategory"), value: t(typeConfig.labelKey) },
    {
      label: t("fieldSeverity"),
      value: (
        <span className={cn("inline-flex items-center gap-1", sev.color)}>
          <SevIcon className="h-3.5 w-3.5" />
          {t(sev.labelKey)}
        </span>
      ),
    },
    ...(zone ? [{ label: t("fieldZone"), value: zone }] : []),
    { label: t("fieldSource"), value: alert.source },
    { label: t("fieldDetected"), value: new Date(alert.createdAt).toLocaleString() },
    ...(deadline ? [{ label: t("fieldDeadline"), value: deadline }] : []),
    { label: t("fieldStatus"), value: isUnread ? t("unread") : t("read") },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TypeIcon className={cn("h-5 w-5", typeConfig.color)} />
            {alert.title}
          </DialogTitle>
          <DialogDescription>{t("detailsTitle")}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-3 gap-2">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="col-span-2">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2 flex flex-col gap-2">
          {alert.actionUrl && (
            <Link
              href={alert.actionUrl}
              onClick={() => isUnread && onMarkRead(item.id)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("investigate")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {isUnread && (
            <Button variant="outline" size="sm" className="w-full" onClick={() => onMarkRead(item.id)}>
              <Check className="h-3.5 w-3.5" />
              {t("markAsRead")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
