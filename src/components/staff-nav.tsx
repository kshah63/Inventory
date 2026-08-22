"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  LayoutDashboard,
  LogOut,
  ShoppingBag,
  UserCircle,
} from "lucide-react";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/browse", label: "Order", icon: Search },
  { href: "/orders", label: "My supplies", icon: ShoppingBag },
  { href: "/profile", label: "Profile", icon: UserCircle },
];

export function StaffNav({
  userName,
  isAdmin,
  unreadOrders = 0,
}: {
  userName: string;
  isAdmin: boolean;
  /** Orders procurement has moved on since this person last looked. */
  unreadOrders?: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active = pathname.startsWith(link.href);
        const unread = link.href === "/orders" ? unreadOrders : 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <link.icon className="h-4 w-4" />
            <span className="hidden sm:inline">{link.label}</span>
            {unread > 0 && (
              <span
                aria-label={`${unread} updated`}
                className={cn(
                  "ml-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
                  // On the active tab the background is already primary, so
                  // the badge inverts to stay visible.
                  active
                    ? "bg-primary-foreground text-primary"
                    : "bg-primary text-primary-foreground"
                )}
              >
                {unread}
              </span>
            )}
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
