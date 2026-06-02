import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/app-sidebar";
import { AskPanel } from "@/components/ask/ask-panel";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen">
      <AppSidebar email={user?.email ?? ""} />
      <main className="flex-1 overflow-x-hidden p-6 md:p-8">{children}</main>
      <AskPanel />
    </div>
  );
}
