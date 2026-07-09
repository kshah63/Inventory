"use client";

import * as React from "react";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import type { KioskStaff } from "./kiosk-app";

/** "Mei Lin Tan" → "MT" — initials for the avatar circles. */
export function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function UserPicker({
  staff,
  onPick,
}: {
  staff: KioskStaff[];
  onPick: (staff: KioskStaff) => void;
}) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? staff.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          (s.department ?? "").toLowerCase().includes(q)
      )
    : staff;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
        Tap your name to start
      </h1>

      <div className="relative mx-auto mt-6 max-w-md">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search names…"
          aria-label="Search names"
          className="h-14 pl-12 text-lg"
        />
      </div>

      {staff.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No staff yet"
          description="No one has a kiosk PIN set up. Ask an administrator to add staff PINs in Settings."
          className="mt-8"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No one found"
          description={`No names match “${query.trim()}”.`}
          className="mt-8"
        />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              className="flex min-h-[5.5rem] items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition-transform hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                {initialsOf(s.full_name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold leading-tight">
                  {s.full_name}
                </span>
                {s.department && (
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {s.department}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
