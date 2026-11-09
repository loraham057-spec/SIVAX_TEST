import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export interface ReportUser {
  id: string;
  name: string;
}

/** Resolve the authenticated user for report attribution and access control. */
export async function getReportUser(): Promise<ReportUser | null> {
  try {
    const supabase = await createSupabaseRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from("users")
      .select("full_name,email")
      .eq("id", user.id)
      .single();
    return { id: user.id, name: profile?.full_name || profile?.email || user.email || "Utilisateur SIVAX" };
  } catch {
    return null;
  }
}
