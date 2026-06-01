"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ListChecks, Sparkles, Upload, Settings } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ListChecks },
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/30 p-4">
      <div className="px-2 pb-4 text-lg font-semibold">Budget</div>
      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t pt-3">
        <p className="truncate px-3 pb-2 text-xs text-muted-foreground">{email}</p>
        <form action={signOut}>
          <button type="submit" className="w-full rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
