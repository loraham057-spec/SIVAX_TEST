"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  Sparkles,
  FileText,
  Settings,
  HelpCircle,
  X,
} from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-provider";
import { hasPermission, type Permission } from "@/lib/auth/types";
import { useTranslations } from "next-intl";

const NAV_ITEMS = [
  { labelKey: "home", href: "/dashboard", icon: Home, permission: undefined as Permission | undefined },
  { labelKey: "assistant", href: "/assistant", icon: Sparkles, permission: "canViewAssistant" as Permission },
  { labelKey: "reports", href: "/reports", icon: FileText, permission: undefined as Permission | undefined },
  { labelKey: "settings", href: "/settings", icon: Settings, permission: "canViewSettings" as Permission },
  { labelKey: "help", href: "/help", icon: HelpCircle, permission: undefined as Permission | undefined },
] as const;

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
  desktopVisible: boolean;
}

export function Sidebar({ mobileOpen, onClose, desktopVisible }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const t = useTranslations("sidebar");

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || hasPermission(user?.role, item.permission)
  );

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full flex-col border-r bg-card/95 shadow-[8px_0_28px_rgba(23,43,77,0.035)] backdrop-blur-xl transition-all duration-300",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          desktopVisible ? "lg:translate-x-0 lg:w-64" : "lg:translate-x-0 lg:w-16"
        )}
      >
        <div className={cn(
          "flex h-[72px] items-center justify-between border-b",
          desktopVisible ? "px-6" : "lg:justify-center lg:px-0 px-6"
        )}>
          <Link href="/dashboard" className="flex items-center gap-2">
            <Image
              src="/logo_diav1.png"
              alt="SIVAX"
              width={32}
              height={32}
              className="rounded-lg shrink-0"
            />
            {desktopVisible && <span className="text-lg font-bold">{APP_NAME}</span>}
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onClose()}
                className={cn(
                  "relative flex min-h-11 items-center gap-3 rounded-xl text-[15px] font-semibold transition-all duration-200",
                  desktopVisible ? "px-3 py-2.5" : "lg:justify-center lg:px-0 lg:py-2.5 px-3",
                  isActive
                    ? "bg-[#EAF2FC] text-[#174A8B] shadow-sm dark:bg-primary/15 dark:text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title={!desktopVisible ? t(item.labelKey) : undefined}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {desktopVisible && t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-4">
          <div className={cn(
            "rounded-xl border border-border/70 bg-muted/60 p-3 text-sm text-muted-foreground",
            !desktopVisible && "lg:hidden"
          )}>
            <p className="font-medium text-foreground">{t("documentation")}</p>
            <p className="mt-1">{t("docsDesc")}</p>
            <a href="/documentation" onClick={() => onClose()}>
              <Button variant="outline" size="sm" className="mt-2 w-full">
                <HelpCircle className="h-3 w-3" />
                {t("viewDocs")}
              </Button>
            </a>
          </div>
          {!desktopVisible && (
            <a href="/documentation" onClick={() => onClose()} className="hidden lg:block">
              <Button variant="ghost" size="icon" className="w-full" title={t("documentation")}>
                <HelpCircle className="h-4 w-4" />
              </Button>
            </a>
          )}
        </div>
      </aside>
    </>
  );
}
