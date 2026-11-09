"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SettingsMap {
  [key: string]: string;
}

interface FieldDefinition {
  key: string;
  labelKey: string;
  placeholder?: string;
  secret?: boolean;
}

const POWERBI_FIELDS: FieldDefinition[] = [
  { key: "powerbi_tenant_id", labelKey: "azureTenantId" },
  { key: "powerbi_client_id", labelKey: "azureClientId" },
  { key: "powerbi_client_secret", labelKey: "azureClientSecret", secret: true },
  { key: "powerbi_workspace_id", labelKey: "workspaceId" },
  { key: "powerbi_report_id", labelKey: "reportId" },
];

const INTEGRATION_FIELDS: FieldDefinition[] = [
  { key: "openai_api_key", labelKey: "openaiApiKey", secret: true, placeholder: "sk-..." },
  { key: "openai_model", labelKey: "openaiModel", placeholder: "gpt-6-luna" },
  { key: "anthropic_api_key", labelKey: "anthropicApiKey", secret: true, placeholder: "sk-ant-..." },
  { key: "anthropic_model", labelKey: "anthropicModel", placeholder: "claude-sonnet-4-20250514" },
  { key: "fastapi_url", labelKey: "fastapiUrl", placeholder: "https://api.example.com" },
  { key: "resend_api_key", labelKey: "resendApiKey", secret: true, placeholder: "re_..." },
  { key: "elevenlabs_api_key", labelKey: "elevenlabsApiKey", secret: true },
];

const DHIS2_FIELDS: FieldDefinition[] = [
  { key: "dhis2_base_url", labelKey: "dhis2BaseUrl", placeholder: "https://snisrdc.com" },
  { key: "dhis2_username", labelKey: "dhis2Username" },
  { key: "dhis2_password", labelKey: "dhis2Password", secret: true },
  { key: "dhis2_root_ou", labelKey: "dhis2RootOu", placeholder: "ymGeqzoPhN3" },
];

const ALL_FIELDS = [...POWERBI_FIELDS, ...INTEGRATION_FIELDS, ...DHIS2_FIELDS];

function SettingsFields({
  fields,
  values,
  onChange,
  visibleSecrets,
  toggleSecret,
  revealing,
}: {
  fields: FieldDefinition[];
  values: SettingsMap;
  onChange: (key: string, value: string) => void;
  visibleSecrets: Set<string>;
  toggleSecret: (key: string) => void;
  revealing: Set<string>;
}) {
  const t = useTranslations("settings");
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {fields.map((field) => {
        const isSecret = field.secret;
        const isVisible = visibleSecrets.has(field.key);
        const isMasked = isSecret && values[field.key] === "••••••••";
        const isRevealing = revealing.has(field.key);
        return (
          <div key={field.key} className="space-y-2">
            <label className="text-sm font-medium">{t(field.labelKey)}</label>
            <div className="relative">
              <Input
                type={isSecret && !isVisible ? "password" : "text"}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                autoComplete="off"
                onFocus={(event) => {
                  if (isSecret && isMasked) onChange(field.key, "");
                }}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={isSecret ? "pr-10" : ""}
              />
              {isSecret && (
                <button
                  type="button"
                  onClick={() => void toggleSecret(field.key)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {isRevealing ? <Loader2 className="h-4 w-4 animate-spin" /> : isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
            {isSecret && isMasked && (
              <p className="text-xs text-muted-foreground">{t("encryptedValueConfigured")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ConfigurationSettings() {
  const t = useTranslations("settings");
  const [settings, setSettings] = useState<SettingsMap>({});
  const [initialSettings, setInitialSettings] = useState<SettingsMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Set<string>>(new Set());
  const [revealedValues, setRevealedValues] = useState<SettingsMap>({});
  const [revealing, setRevealing] = useState<Set<string>>(new Set());

  const toggleSecret = async (key: string) => {
    const isCurrentlyVisible = visibleSecrets.has(key);
    if (isCurrentlyVisible) {
      setVisibleSecrets((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setRevealedValues((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }

    setRevealing((current) => new Set(current).add(key));
    try {
      const response = await fetch("/api/settings/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [key] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to reveal value");
      const realValue = data.values?.[key] ?? "";
      setRevealedValues((current) => ({ ...current, [key]: realValue }));
      setSettings((current) => ({ ...current, [key]: realValue }));
      setInitialSettings((current) => ({ ...current, [key]: realValue }));
      setVisibleSecrets((current) => new Set(current).add(key));
    } catch (error) {
      toast.error(t("unableReveal"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setRevealing((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load settings");
      setSettings(data.settings ?? {});
      setInitialSettings(data.settings ?? {});
    } catch (error) {
      toast.error(t("unableLoadConfigs"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const save = async () => {
    const changed = Object.fromEntries(
      ALL_FIELDS.filter(({ key }) => (settings[key] ?? "") !== (initialSettings[key] ?? ""))
        .map(({ key }) => [key, settings[key] ?? ""]),
    );
    if (Object.keys(changed).length === 0) {
      toast.success(t("configsSaved"));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: changed }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save settings");
      toast.success(t("configsSaved"));
      await loadSettings();
    } catch (error) {
      toast.error(t("configsSaveFailed"), {
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
          <CardTitle>{t("powerbiConfig")}</CardTitle>
          <CardDescription>{t("powerbiConfigDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsFields
            fields={POWERBI_FIELDS}
            values={settings}
            onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
            visibleSecrets={visibleSecrets}
            toggleSecret={toggleSecret}
            revealing={revealing}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("backendKeys")}</CardTitle>
          <CardDescription>{t("backendKeysDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsFields
            fields={INTEGRATION_FIELDS}
            values={settings}
            onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
            visibleSecrets={visibleSecrets}
            toggleSecret={toggleSecret}
            revealing={revealing}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dhis2Config")}</CardTitle>
          <CardDescription>{t("dhis2ConfigDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsFields
            fields={DHIS2_FIELDS}
            values={settings}
            onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
            visibleSecrets={visibleSecrets}
            toggleSecret={toggleSecret}
            revealing={revealing}
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={() => void save()} disabled={saving} className="shadow-lg">
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          {t("saveAllConfigs")}
        </Button>
      </div>
    </div>
  );
}
