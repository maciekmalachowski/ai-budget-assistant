import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The authenticated user for the current request, or null. Route handlers use
 * this for defense-in-depth (the middleware already gates /api, but each route
 * also confirms a session before doing any work). Uses getUser(), which
 * revalidates the token with the auth server.
 */
export async function getAuthedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
