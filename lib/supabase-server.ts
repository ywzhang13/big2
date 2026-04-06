import { createClient, SupabaseClient } from "@supabase/supabase-js";

let serverClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client singleton.
 * Uses the same NEXT_PUBLIC_ env vars (no service role key needed for now).
 */
export function getSupabaseServer(): SupabaseClient {
  if (serverClient) return serverClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  serverClient = createClient(url, key);
  return serverClient;
}
