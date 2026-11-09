"use client";

import Link from "next/link";
import {
  Menu,
  Search,
  Bell,
  Sparkles,
  ChevronDown,
  LogOut,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAssistant } from "@/store/assistant-store";
import { InstallPromptButton } from "@/components/pwa/install-prompt";
import { useAuth } from "@/lib/auth/auth-provider";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { hasPermission, ROLE_PERMISSIONS } from "@/lib/auth/types";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface TopNavProps {
  onMenuClick: () => void;
  desktopSidebarVisible?: boolean;
}

export function TopNav({ onMenuClick, desktopSidebarVisible = true }: TopNavProps) {
  const { toggle: toggleAssistant } = useAssistant();
  const { user, signOut } = useAuth();
  const { unreadCount } = useNotifications();
  const t = useTranslations("nav");

  const initials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "U";
  const roleLabel = user ? ROLE_PERMISSIONS[user.role].label : "";

  return (
    <header className={cn(
      "fixed inset-x-0 top-0 z-30 flex h-[72px] items-center justify-between border-b border-border/80 bg-card/95 px-4 shadow-[0_4px_18px_rgba(23,43,77,0.035)] backdrop-blur-xl transition-all duration-300 lg:px-7",
      desktopSidebarVisible ? "lg:pl-64" : "lg:pl-16"
    )}>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="shrink-0"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-1 justify-center max-w-xl mx-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="hidden md:flex shrink-0">
              <span className="text-[15px] font-semibold">{user?.organization || t("organization")}</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{t("organization")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="flex items-center justify-between">
              <span>{user?.organization || "N/A"}</span>
              <Badge variant="secondary" className="text-xs">
                {roleLabel}
              </Badge>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="relative w-full max-w-md hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("search")}
            className="h-11 rounded-xl pl-10 text-sm shadow-none"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <InstallPromptButton />

        <Button
          variant="default"
          size="sm"
          onClick={toggleAssistant}
          className="hidden sm:flex"
          style={{ display: hasPermission(user?.role, "canViewAssistant") ? undefined : "none" }}
        >
          <Sparkles className="h-4 w-4" />
          {t("aiAssistant")}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleAssistant}
          className="sm:hidden"
          style={{ display: hasPermission(user?.role, "canViewAssistant") ? undefined : "none" }}
        >
          <Sparkles className="h-5 w-5" />
        </Button>

        <Link href="/notifications">
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {unreadCount}
              </span>
            )}
          </Button>
        </Link>

        <LanguageToggle />
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-xl p-1.5 transition-colors hover:bg-muted">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-medium">{user?.full_name || "User"}</span>
                <span className="text-xs text-muted-foreground">{roleLabel}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hasPermission(user?.role, "canViewSettings") && (
              <Link href="/settings">
                <DropdownMenuItem>
                  <SettingsIcon className="h-4 w-4" />
                  {t("settings")}
                </DropdownMenuItem>
              </Link>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" />
              {t("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
