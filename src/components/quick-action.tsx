"use client";

import { Sparkles, FileText, Activity, AlertTriangle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/store/assistant-store";

const ICON_MAP: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  file: FileText,
  activity: Activity,
  alert: AlertTriangle,
};

export function QuickAction({
  icon,
  label,
  description,
}: {
  icon: string;
  label: string;
  description: string;
}) {
  const { open: openAssistant } = useAssistant();
  const Icon = ICON_MAP[icon] ?? Sparkles;
  return (
    <Button
      variant="outline"
      className="flex h-auto flex-col items-start gap-1 p-3 text-left"
      onClick={openAssistant}
    >
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </Button>
  );
}
