export type UserRole = "admin" | "analyst" | "viewer";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  organization: string | null;
  country: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  user: UserProfile | null;
  isLoading: boolean;
}

export interface RolePermissions {
  label: string;
  description: string;
  canViewDashboard: boolean;
  canViewAlerts: boolean;
  canViewAssistant: boolean;
  canViewDocumentation: boolean;
  canViewSettings: boolean;
  canManageUsers: boolean;
  canEditSettings: boolean;
  canManageApiKeys: boolean;
  canManagePowerBI: boolean;
  canManageSecurity: boolean;
  canExportData: boolean;
  canTriggerML: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  admin: {
    label: "Administrator",
    description: "Full access to all features and system configuration",
    canViewDashboard: true,
    canViewAlerts: true,
    canViewAssistant: true,
    canViewDocumentation: true,
    canViewSettings: true,
    canManageUsers: true,
    canEditSettings: true,
    canManageApiKeys: true,
    canManagePowerBI: true,
    canManageSecurity: true,
    canExportData: true,
    canTriggerML: true,
  },
  analyst: {
    label: "Analyst",
    description: "Access to analytics, dashboards, and AI assistant",
    canViewDashboard: true,
    canViewAlerts: true,
    canViewAssistant: true,
    canViewDocumentation: true,
    canViewSettings: true,
    canManageUsers: false,
    canEditSettings: false,
    canManageApiKeys: false,
    canManagePowerBI: false,
    canManageSecurity: false,
    canExportData: true,
    canTriggerML: true,
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to dashboards, documentation, and AI assistant",
    canViewDashboard: true,
    canViewAlerts: true,
    canViewAssistant: true,
    canViewDocumentation: true,
    canViewSettings: true,
    canManageUsers: false,
    canEditSettings: false,
    canManageApiKeys: false,
    canManagePowerBI: false,
    canManageSecurity: false,
    canExportData: false,
    canTriggerML: false,
  },
};

export type Permission = Exclude<keyof RolePermissions, "label" | "description">;

export function hasPermission(role: UserRole | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role][permission] ?? false;
}

export function isAdmin(role: UserRole | undefined | null): boolean {
  return role === "admin";
}

export function isAnalyst(role: UserRole | undefined | null): boolean {
  return role === "analyst";
}

export function isViewer(role: UserRole | undefined | null): boolean {
  return role === "viewer";
}

export function canAccessRoute(role: UserRole | undefined | null, pathname: string): boolean {
  if (!role) return false;

  if (pathname.startsWith("/settings") && !hasPermission(role, "canViewSettings")) {
    return false;
  }

  if (pathname.startsWith("/assistant") && !hasPermission(role, "canViewAssistant")) {
    return false;
  }

  return true;
}
