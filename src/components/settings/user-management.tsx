"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Users as UsersIcon,
  Plus,
  Trash2,
  Edit,
  Loader2,
  ShieldCheck,
  Eye,
  EyeOff,
  Search,
  Check,
  X,
  Mail,
  Calendar,
  Clock,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ROLE_PERMISSIONS, type UserRole, type UserProfile, type Permission } from "@/lib/auth/types";

type UserWithSignIn = UserProfile & { last_sign_in_at: string | null };

interface UserManagementProps {
  currentUserId: string;
  currentUserRole?: UserRole;
}

const PERMISSION_KEYS: { key: Permission; labelKey: string }[] = [
  { key: "canViewDashboard", labelKey: "canViewDashboard" },
  { key: "canViewAlerts", labelKey: "canViewAlerts" },
  { key: "canViewAssistant", labelKey: "canViewAssistant" },
  { key: "canViewDocumentation", labelKey: "canViewDocumentation" },
  { key: "canManageUsers", labelKey: "canManageUsers" },
  { key: "canEditSettings", labelKey: "canEditSettings" },
  { key: "canManageApiKeys", labelKey: "canManageApiKeys" },
  { key: "canManagePowerBI", labelKey: "canManagePowerBI" },
  { key: "canManageSecurity", labelKey: "canManageSecurity" },
  { key: "canExportData", labelKey: "canExportData" },
  { key: "canTriggerML", labelKey: "canTriggerML" },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Build a compact page-number list with ellipses (e.g. 1 … 4 5 6 … 20). */
function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "...")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("...");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push("...");
  pages.push(total);
  return pages;
}

export function UserManagement({ currentUserId, currentUserRole }: UserManagementProps) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [users, setUsers] = useState<UserWithSignIn[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [detailUser, setDetailUser] = useState<UserWithSignIn | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState<UserWithSignIn | null>(null);
  const [editForm, setEditForm] = useState({ full_name: "", organization: "", role: "viewer" as UserRole });
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = currentUserRole === "admin";
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "viewer" as UserRole,
    organization: "",
  });
  const [isCreating, setIsCreating] = useState(false);

  // ─── Pagination state ───────────────────────────────────
  const PAGE_SIZE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Debounce search to avoid hammering the API on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchUsers = useCallback(async (page: number, search: string) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set("search", search);
      const res = await fetch(`/api/users?${params}`);
      if (!res.ok) throw new Error(t("failedLoadUsers"));
      const data = await res.json();
      setUsers(data.users);
      setTotalCount(data.pagination?.total ?? 0);
      setTotalPages(data.pagination?.totalPages ?? 1);
    } catch {
      setError(t("failedLoadUsers"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchUsers(currentPage, debouncedSearch);
  }, [fetchUsers, currentPage, debouncedSearch]);

  const handleAddUser = async () => {
    setError("");
    if (!newUser.email || !newUser.password) {
      setError(t("emailPasswordRequired"));
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newUser, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("failedCreateUser"));
        return;
      }

      setShowAddDialog(false);
      setNewUser({ email: "", password: "", full_name: "", role: "viewer", organization: "" });
      void fetchUsers(currentPage, debouncedSearch);
    } catch {
      setError(t("failedCreateUser"));
    } finally {
      setIsCreating(false);
    }
  };

  const openDetailModal = (user: UserWithSignIn) => {
    setDetailUser(user);
    setEditForm({
      full_name: user.full_name || "",
      organization: user.organization || "",
      role: user.role,
    });
  };

  const handleSaveEdit = async () => {
    if (!detailUser) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/users/${detailUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("userSaveFailed"));
        return;
      }
      setDetailUser(null);
      void fetchUsers(currentPage, debouncedSearch);
    } catch {
      setError(t("userSaveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!showDeleteDialog) return;
    const userId = showDeleteDialog.id;
    setShowDeleteDialog(null);

    const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("failedDeleteUser"));
      return;
    }

    void fetchUsers(currentPage, debouncedSearch);
  };

  const roleBadgeVariant = (role: UserRole) => {
    if (role === "admin") return "destructive" as const;
    if (role === "analyst") return "default" as const;
    return "secondary" as const;
  };

  const getUserStatus = (user: UserWithSignIn): { label: string; variant: "default" | "secondary" | "outline" } => {
    if (!user.last_sign_in_at) return { label: t("statusNever"), variant: "outline" };
    return { label: t("statusActive"), variant: "default" };
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4">
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="h-8 w-8 shrink-0 rounded-full bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                  <div className="h-2 w-1/4 rounded bg-muted animate-pulse" />
                </div>
                <div className="h-6 w-16 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("userManagement")}</CardTitle>
            <CardDescription>{t("userManagementDesc")}</CardDescription>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4" />
              {t("addUser")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-4 text-sm text-destructive">{error}</p>
        )}

        {/* Search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchUsers")}
            className="pl-9"
          />
        </div>

        {/* Table */}
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <UsersIcon className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">{t("noUsers")}</p>
            <p className="text-xs text-muted-foreground">{t("noUsersDesc")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium text-muted-foreground">{t("tableName")}</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">{t("tableEmail")}</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">{t("tableOrganization")}</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">{t("tableRole")}</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">{t("tableCreatedAt")}</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">{t("tableLastSignIn")}</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">{t("tableStatus")}</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t("tableActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((user) => {
                  const status = getUserStatus(user);
                  return (
                    <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {getInitials(user.full_name || user.email)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {user.full_name || "—"}
                              {user.id === currentUserId && (
                                <span className="ml-2 text-xs text-muted-foreground">{t("you")}</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      {/* Email */}
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground">{user.email}</span>
                      </td>
                      {/* Organization */}
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground">{user.organization || "—"}</span>
                      </td>
                      {/* Role */}
                      <td className="px-4 py-3">
                        <Badge variant={roleBadgeVariant(user.role)} className="text-xs">
                          {t(user.role === "admin" ? "administrator" : user.role)}
                        </Badge>
                      </td>
                      {/* Created at */}
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground">{formatDate(user.created_at)}</span>
                      </td>
                      {/* Last sign-in */}
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground">{formatDate(user.last_sign_in_at)}</span>
                      </td>
                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge variant={status.variant} className="text-xs">
                          {status.label}
                        </Badge>
                      </td>
                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openDetailModal(user)}
                            title={t("viewDetails")}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          {isAdmin && user.id !== currentUserId && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setShowDeleteDialog(user)}
                              title={t("deleteUser")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {totalCount > 0 && (
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              {t("paginationShowing", {
                from: (currentPage - 1) * PAGE_SIZE + 1,
                to: Math.min(currentPage * PAGE_SIZE, totalCount),
                total: totalCount,
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1 || isLoading}
                title={t("paginationFirst")}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1 || isLoading}
                title={t("paginationPrev")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1">
                {getPageNumbers(currentPage, totalPages).map((p, idx) =>
                  p === "..." ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-sm text-muted-foreground">
                      …
                    </span>
                  ) : (
                    <Button
                      key={p}
                      variant={p === currentPage ? "default" : "outline"}
                      size="sm"
                      className="h-8 min-w-8 px-2"
                      onClick={() => setCurrentPage(p as number)}
                      disabled={isLoading}
                    >
                      {p}
                    </Button>
                  )
                )}
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages || isLoading}
                title={t("paginationNext")}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages || isLoading}
                title={t("paginationLast")}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Add User Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("addNewUser")}</DialogTitle>
              <DialogDescription>
                {t("addNewUserDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("fullName")}</label>
                <Input
                  value={newUser.full_name}
                  onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("email")}</label>
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="user@organization.gov"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t("password")}</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("role")}</label>
                  <select
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="admin">{t("administrator")}</option>
                    <option value="analyst">{t("analyst")}</option>
                    <option value="viewer">{t("viewer")}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t("organization")}</label>
                  <Input
                    value={newUser.organization}
                    onChange={(e) => setNewUser({ ...newUser, organization: e.target.value })}
                    placeholder="Ministry of Health"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                {tc("cancel")}
              </Button>
              <Button onClick={handleAddUser} disabled={isCreating}>
                {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                {isCreating ? t("creating") : t("createUser")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* User Detail / Edit Dialog */}
        <Dialog open={detailUser !== null} onOpenChange={(open) => { if (!open) setDetailUser(null); }}>
          <DialogContent className="max-w-2xl">
            {detailUser && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {getInitials(detailUser.full_name || detailUser.email)}
                    </div>
                    <div>
                      <span>{detailUser.full_name || detailUser.email}</span>
                      {detailUser.id === currentUserId && (
                        <span className="ml-2 text-xs text-muted-foreground">{t("you")}</span>
                      )}
                    </div>
                  </DialogTitle>
                  <DialogDescription>{t("userDetailsDesc")}</DialogDescription>
                </DialogHeader>

                <div className="max-h-[60vh] overflow-y-auto py-2">
                  {/* Profile Information */}
                  <div className="mb-6">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <UsersIcon className="h-4 w-4 text-primary" />
                      {t("profileInfo")}
                    </h4>
                    <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("fullName")}</label>
                        <Input
                          value={editForm.full_name}
                          onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("email")}</label>
                        <Input value={detailUser.email} disabled />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("organization")}</label>
                        <Input
                          value={editForm.organization}
                          onChange={(e) => setEditForm({ ...editForm, organization: e.target.value })}
                          disabled={!isAdmin}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">{t("role")}</label>
                        <select
                          value={editForm.role}
                          onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                          disabled={!isAdmin}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="admin">{t("administrator")}</option>
                          <option value="analyst">{t("analyst")}</option>
                          <option value="viewer">{t("viewer")}</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Account Information */}
                  <div className="mb-6">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <Calendar className="h-4 w-4 text-primary" />
                      {t("accountInfo")}
                    </h4>
                    <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
                      <div>
                        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" /> {t("createdAt")}
                        </p>
                        <p className="mt-1 text-sm">{formatDateTime(detailUser.created_at)}</p>
                      </div>
                      <div>
                        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" /> {t("updatedAt")}
                        </p>
                        <p className="mt-1 text-sm">{formatDateTime(detailUser.updated_at)}</p>
                      </div>
                      <div>
                        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" /> {t("lastSignIn")}
                        </p>
                        <p className="mt-1 text-sm">
                          {detailUser.last_sign_in_at ? formatDateTime(detailUser.last_sign_in_at) : t("neverConnected")}
                        </p>
                      </div>
                      <div>
                        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Shield className="h-3.5 w-3.5" /> {t("userId")}
                        </p>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{detailUser.id}</p>
                      </div>
                    </div>
                  </div>

                  {/* Access & Permissions */}
                  <div>
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      {t("accessInfo")}
                    </h4>
                    <div className="grid grid-cols-2 gap-2 rounded-lg border p-4 sm:grid-cols-3">
                      {PERMISSION_KEYS.map(({ key, labelKey }) => {
                        const has = ROLE_PERMISSIONS[editForm.role][key];
                        return (
                          <div
                            key={key}
                            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                              has ? "bg-primary/5 text-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {has ? (
                              <Check className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <X className="h-3.5 w-3.5 text-muted-foreground/40" />
                            )}
                            <span>{t(labelKey)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  {isAdmin && (
                    <Button onClick={handleSaveEdit} disabled={isSaving}>
                      {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                      {t("userSaveChanges")}
                    </Button>
                  )}
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog !== null} onOpenChange={(open) => { if (!open) setShowDeleteDialog(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="h-5 w-5 text-destructive" />
                {t("deleteUser")}
              </DialogTitle>
              <DialogDescription>
                {showDeleteDialog && (
                  <span>
                    {t("confirmDeleteUser")}{" "}
                    <strong className="text-foreground">
                      {showDeleteDialog.full_name || showDeleteDialog.email}
                    </strong>
                    <br />
                    <span className="mt-2 block text-xs text-destructive/80">{t("deleteWarning")}</span>
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteDialog(null)}>
                {tc("cancel")}
              </Button>
              <Button variant="destructive" onClick={() => void handleDeleteUser()}>
                <Trash2 className="h-4 w-4" />
                {t("confirmDelete")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
