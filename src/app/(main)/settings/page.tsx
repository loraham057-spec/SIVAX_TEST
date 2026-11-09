"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { User, Shield, Users, Settings2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth/auth-provider";
import { hasPermission, ROLE_PERMISSIONS } from "@/lib/auth/types";
import { ChangePassword } from "@/components/settings/change-password";
import { CountrySelect } from "@/components/ui/country-select";
import { useAgent } from "@/lib/agent/agent-provider";
import { SETTINGS_TABS } from "@/lib/agent/commands";
import { useTranslations } from "next-intl";

// Lazy-load heavy tab components so they don't bloat the initial page bundle.
// Each component is only loaded when its tab is activated.
const UserManagement = dynamic(
  () => import("@/components/settings/user-management").then((m) => m.UserManagement),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ) }
);

const ConfigurationSettings = dynamic(
  () => import("@/components/settings/configuration-settings").then((m) => m.ConfigurationSettings),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ) }
);

const SecuritySettings = dynamic(
  () => import("@/components/settings/security-settings").then((m) => m.SecuritySettings),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  ) }
);

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const canManageUsers = hasPermission(user?.role, "canManageUsers");
  const canManageApiKeys = hasPermission(user?.role, "canManageApiKeys");
  const canManagePowerBI = hasPermission(user?.role, "canManagePowerBI");
  const canManageSecurity = hasPermission(user?.role, "canManageSecurity");
  const t = useTranslations("settings");

  const [activeTab, setActiveTab] = useState<string>("profile");
  const [fullName, setFullName] = useState(user?.full_name || "");
  const [organization, setOrganization] = useState(user?.organization || "");
  const [country, setCountry] = useState(user?.country || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, organization, country }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("saveFailed"));
      toast.success(t("savedSuccess"));
      await refreshUser();
    } catch (error) {
      toast.error(t("saveFailed"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSaving(false);
    }
  }, [user, fullName, organization, country, refreshUser, t]);

  // Register agent command handlers for settings page.
  const { register } = useAgent();

  useEffect(() => {
    const unregs: Array<() => void> = [];

    unregs.push(
      register("switch_settings_tab", (args) => {
        const tab = args.tab as string;
        if (SETTINGS_TABS.includes(tab as typeof SETTINGS_TABS[number])) {
          setActiveTab(tab);
        }
      })
    );

    unregs.push(
      register("set_profile_field", (args) => {
        const field = args.field as string;
        const value = args.value as string;
        if (field === "full_name") setFullName(value);
        else if (field === "organization") setOrganization(value);
        else if (field === "country") setCountry(value);
      })
    );

    unregs.push(
      register("save_profile", async () => {
        await handleSave();
      })
    );

    unregs.push(
      register("toggle_security", async (args) => {
        const setting = args.setting as string;
        const value = args.value as boolean;
        const key = setting === "session_timeout"
          ? "security_session_timeout"
          : setting === "audit_log"
            ? "security_audit_log"
            : null;
        if (!key) return;
        const response = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: { [key]: String(value) } }),
        });
        if (!response.ok) throw new Error("Unable to update security setting");
      })
    );

    return () => unregs.forEach((fn) => fn());
  }, [register, handleSave]);

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex h-auto w-full max-w-full items-center rounded-full bg-muted p-2.5 overflow-hidden">
          <div className="flex items-center gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] snap-x snap-mandatory w-full">
            <TabsTrigger value="profile" className="gap-1.5 rounded-full py-2 shrink-0 snap-center">
              <User className="h-3.5 w-3.5" />
              {t("profile")}
            </TabsTrigger>
            {(canManagePowerBI || canManageApiKeys) && (
              <TabsTrigger value="configurations" className="gap-1.5 rounded-full py-2 shrink-0 snap-center">
                <Settings2 className="h-3.5 w-3.5" />
                {t("configurations")}
              </TabsTrigger>
            )}
            {canManageSecurity && (
              <TabsTrigger value="security" className="gap-1.5 rounded-full py-2 shrink-0 snap-center">
                <Shield className="h-3.5 w-3.5" />
                {t("security")}
              </TabsTrigger>
            )}
            {canManageUsers && (
              <TabsTrigger value="users" className="gap-1.5 rounded-full py-2 shrink-0 snap-center">
                <Users className="h-3.5 w-3.5" />
                {t("users")}
              </TabsTrigger>
            )}
          </div>
        </TabsList>

        <TabsContent value="profile" className="mt-4 space-y-6">
          <ChangePassword />
          <Card>
            <CardHeader>
              <CardTitle>{t("profileOrg")}</CardTitle>
              <CardDescription>{t("profileOrgDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("fullName")}</label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("email")}</label>
                  <Input type="email" defaultValue={user?.email || ""} disabled />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("role")}</label>
                  <div className="flex items-center gap-2">
                    <Input defaultValue={user ? ROLE_PERMISSIONS[user.role].label : ""} disabled />
                    {user && (
                      <Badge variant={user.role === "admin" ? "destructive" : user.role === "analyst" ? "default" : "secondary"}>
                        {user.role}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("organization")}</label>
                  <Input value={organization} onChange={(e) => setOrganization(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("country")}</label>
                  <CountrySelect value={country} onChange={setCountry} />
                </div>
              </div>
              <Separator />
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("saving")}
                    </>
                  ) : (
                    t("saveChanges")
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {(canManagePowerBI || canManageApiKeys) && (
          <TabsContent value="configurations" className="mt-4">
            <ConfigurationSettings />
          </TabsContent>
        )}

        {canManageSecurity && (
          <TabsContent value="security" className="mt-4">
            <SecuritySettings />
          </TabsContent>
        )}

        {canManageUsers && user && (
          <TabsContent value="users" className="mt-4">
            <UserManagement currentUserId={user.id} currentUserRole={user.role} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
