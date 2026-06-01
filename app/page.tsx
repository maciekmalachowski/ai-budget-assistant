import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">AI Budget Assistant</h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {user?.email ?? "unknown"}.
      </p>
      <form action={signOut}>
        <button type="submit" className="rounded-md border px-3 py-2 text-sm">
          Sign out
        </button>
      </form>
    </main>
  );
}
