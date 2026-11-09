"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

export function SecuritySettings() {
  const t = useTranslations("settings");
  const [sessionTimeout, setSessionTimeout] = useState(true);
  const [timeoutMinutes, setTimeoutMinutes] = useState("30");
  const [auditLog, setAuditLog] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t("unableLoadSecurity"));
        setSessionTimeout(data.settings.security_session_timeout === "true");
        setTimeoutMinutes(data.settings.security_session_timeout_minutes || "30");
        setAuditLog(data.settings.security_audit_log === "true");
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : t("unableLoadSecurity")))
      .finally(() => setLoading(false));
  }, []);

  const saveSecurity = async () => {
    const minutes = Number(timeoutMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      toast.error(t("timeoutError"));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            security_session_timeout: String(sessionTimeout),
            security_session_timeout_minutes: String(minutes),
            security_audit_log: String(auditLog),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("securityUpdateFailed"));
      toast.success(t("securityUpdated"));
    } catch (error) {
      toast.error(t("securityUpdateFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("securityPolicy")}</CardTitle>
          <CardDescription>{t("securityPolicyDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t("sessionTimeout")}</p>
              <p className="text-xs text-muted-foreground">{t("sessionTimeoutDesc")}</p>
            </div>
            <Switch checked={sessionTimeout} onCheckedChange={setSessionTimeout} />
          </div>
          {sessionTimeout && (
            <div className="max-w-xs space-y-2">
              <label className="text-sm font-medium">{t("timeoutMinutes")}</label>
              <Input
                type="number"
                min={5}
                max={1440}
                value={timeoutMinutes}
                onChange={(event) => setTimeoutMinutes(event.target.value)}
              />
            </div>
          )}
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{t("exportAuditLog")}</p>
              <p className="text-xs text-muted-foreground">{t("exportAuditLogDesc")}</p>
            </div>
            <Switch checked={auditLog} onCheckedChange={setAuditLog} />
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button onClick={() => void saveSecurity()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {t("updateSecurity")}
            </Button>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
