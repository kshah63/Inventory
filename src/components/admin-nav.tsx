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
  ArrowLeftRight,
  SlidersHorizontal,
  ClipboardCheck,
  Inbox,
  BadgeCheck,
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
}

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/orders", label: "Orders", icon: PackageCheck },
  { href: "/admin/reorder", label: "Reorder", icon: AlertTriangle },
  { href: "/admin/inventory", label: "Inventory", icon: Package },
  { href: "/admin/receive", label: "Receive", icon: Truck },
  { href: "/admin/transfer", label: "Transfer", icon: ArrowLeftRight },
  { href: "/admin/adjust", label: "Adjust", icon: SlidersHorizontal },
  { href: "/admin/stocktake", label: "Stocktake", icon: ClipboardCheck },
  { href: "/admin/requests", label: "Requests", icon: Inbox },
  { href: "/admin/approvals", label: "Approvals", icon: BadgeCheck },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

const SUPER_NAV: NavItem[] = [{ href: "/admin/users", label: "Users", icon: Users }];
const FOOTER_NAV: NavItem[] = [{ href: "/admin/settings", label: "Settings", icon: Settings }];

export function AdminNav({
  userName,
  isSuperAdmin,
}: {
  userName: string;
  isSuperAdmin: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const items = [...NAV, ...(isSuperAdmin ? SUPER_NAV : []), ...FOOTER_NAV];

  const linkClass = (href: string, exact?: boolean) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return cn(
      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={linkClass(item.href, item.exact)}
              onClick={() => setOpen(false)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t p-3">
          <div className="mb-2 truncate px-3 text-sm font-medium">{userName}</div>
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
