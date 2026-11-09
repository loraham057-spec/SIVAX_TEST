import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The admin client carries no per-request state (no session, no cookies), so a
 * single instance is reused for the lifetime of the server process. Building a
 * new one per call re-created the internal fetch/auth stack on every request.
 */
let adminClient: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
  return adminClient;
}
