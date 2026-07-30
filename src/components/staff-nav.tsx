"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Search,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  ShoppingBag,
  UserCircle,
} from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/browse", label: "Catalogue", icon: Search },
  { href: "/orders", label: "My orders", icon: ShoppingBag },
  { href: "/activity", label: "Activity", icon: History },
  { href: "/requests", label: "Requests", icon: Inbox },
  { href: "/profile", label: "Profile", icon: UserCircle },
];

export function StaffNav({
  userName,
  isAdmin,
  isDeptHead,
}: {
  userName: string;
  isAdmin: boolean;
  isDeptHead?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <link.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{link.label}</span>
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          href="/admin"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LayoutDashboard className="h-4 w-4" />
          <span className="hidden sm:inline">Admin</span>
        </Link>
      )}
      {isDeptHead && (
        <Link
          href="/admin/reports"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <BarChart3 className="h-4 w-4" />
          <span className="hidden sm:inline">Reports</span>
        </Link>
      )}
      <button
        onClick={() => signOut()}
        title={`Sign out ${userName}`}
        className="ml-1 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </nav>
  );
}
