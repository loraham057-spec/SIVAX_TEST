import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/lib/auth/types";

export async function requireUser(): Promise<
  | { user: UserProfile; error: null }
  | { user: null; error: { message: string; status: number } }
> {
  const supabase = await createSupabaseRouteHandlerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    return { user: null, error: { message: "Unauthorized", status: 401 } };
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role, organization, country, avatar_url, created_at, updated_at")
    .eq("id", authUser.id)
    .single();

  if (error || !data) {
    return { user: null, error: { message: "User profile not found", status: 403 } };
  }

  return { user: data as UserProfile, error: null };
}

export async function requireAdmin(): Promise<
  | { user: UserProfile; error: null }
  | { user: null; error: { message: string; status: number } }
> {
  const result = await requireUser();
  if (result.error) return result;
  if (result.user.role !== "admin") {
    return { user: null, error: { message: "Forbidden", status: 403 } };
  }
  return result;
}
