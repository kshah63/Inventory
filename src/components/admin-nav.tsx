"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  AlertTriangle,
  Package,
  PackageCheck,
  Truck,
  ClipboardCheck,
  Inbox,
  BarChart3,
  ScrollText,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { signOut } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  /** Which waiting-on-us count to show, if any. */
  count?: "orders" | "requests";
}

interface NavGroup {
  /** Omitted for the first group, which needs no explaining. */
  heading?: string;
  items: NavItem[];
  superOnly?: boolean;
}

/**
 * Grouped by who is waiting. "To do" is work sitting with procurement:
 * an order to pack, a request to source. The two arrive by different
 * routes and the work differs — one is a trip to the shelf, the other is
 * a purchase and a wait — so they stay two screens, side by side under
 * one heading rather than fused into one queue.
 */
const GROUPS: NavGroup[] = [
  {
    items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true }],
  },
  {
    heading: "To do",
    items: [
      { href: "/admin/orders", label: "Orders", icon: PackageCheck, count: "orders" },
      { href: "/admin/requests", label: "Requests", icon: Inbox, count: "requests" },
    ],
  },
  {
    heading: "Stock",
    items: [
      { href: "/admin/reorder", label: "Reorder", icon: AlertTriangle },
      { href: "/admin/inventory", label: "Inventory", icon: Package },
      { href: "/admin/stock", label: "Update stock", icon: Truck },
      { href: "/admin/stocktake", label: "Stocktake", icon: ClipboardCheck },
    ],
  },
  {
    heading: "Records",
    items: [
      { href: "/admin/reports", label: "Reports", icon: BarChart3 },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText },
    ],
  },
  {
    heading: "Setup",
    items: [{ href: "/admin/users", label: "Users", icon: Users }],
    superOnly: true,
  },
];

const FOOTER_NAV: NavItem[] = [
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminNav({
  userName,
  isSuperAdmin,
  todo = { orders: 0, requests: 0 },
}: {
  userName: string;
  isSuperAdmin: boolean;
  /** What's actually waiting on procurement right now. */
  todo?: { orders: number; requests: number };
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const groups = GROUPS.filter((g) => !g.superOnly || isSuperAdmin);

  const linkClass = (href: string, exact?: boolean) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return cn(
      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    );
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const renderItem = (item: NavItem) => {
    const count = item.count ? todo[item.count] : 0;
    const active = isActive(item.href, item.exact);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={linkClass(item.href, item.exact)}
        onClick={() => setOpen(false)}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {item.label}
        {count > 0 && (
          <span
            aria-label={`${count} waiting`}
            className={cn(
              "ml-auto flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums",
              // The active row is already primary, so the badge inverts.
              active
                ? "bg-primary-foreground text-primary"
                : "bg-primary text-primary-foreground"
            )}
          >
            {count}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile header */}
      <header className="flex items-center justify-between border-b bg-card px-4 py-3 lg:hidden">
        <Link href="/admin">
          <Logo />
        </Link>
        <button
          onClick={() => setOpen(!open)}
          className="rounded-md p-2 hover:bg-accent"
          aria-label="Toggle navigation"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Sidebar (desktop) / dropdown (mobile) */}
      <aside
        className={cn(
          "border-b bg-card lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r",
          open ? "block" : "hidden lg:flex"
        )}
      >
        <div className="hidden p-5 lg:block">
          <Link href="/admin">
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {groups.map((group, i) => (
            <div key={group.heading ?? "top"} className={cn(i > 0 && "mt-4")}>
              {group.heading && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.heading}
                </p>
              )}
              <div className="space-y-0.5">{group.items.map(renderItem)}</div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="space-y-0.5">{FOOTER_NAV.map(renderItem)}</div>
          <div className="mb-2 mt-3 truncate px-3 text-sm font-medium">{userName}</div>
          <button
            onClick={() => signOut()}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
