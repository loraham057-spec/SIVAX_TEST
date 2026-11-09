"use client";

import { useAgent } from "@/lib/agent/agent-provider";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

export function ApprovalModal() {
  const { pendingApproval, resolveApproval } = useAgent();
  const t = useTranslations("approval");
  const tc = useTranslations("common");

  const hasHighRisk = pendingApproval?.results.some((r) => r.risk === "high");

  return (
    <AlertDialog
      open={pendingApproval !== null}
      onOpenChange={(open: boolean) => {
        if (!open) resolveApproval(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {hasHighRisk ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-warning" />
            )}
            {hasHighRisk ? t("approvalRequired") : t("confirmationRequired")}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {hasHighRisk
                  ? t("highRiskDesc")
                  : t("lowRiskDesc")}
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {pendingApproval?.results.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={
                        r.risk === "high"
                          ? "text-destructive font-medium"
                          : "text-warning font-medium"
                      }
                    >
                      [{r.risk.toUpperCase()}]
                    </span>
                    <span>{r.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolveApproval(false)}>
            {tc("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => resolveApproval(true)}
            className={hasHighRisk ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {hasHighRisk ? t("approveAndExecute") : t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
