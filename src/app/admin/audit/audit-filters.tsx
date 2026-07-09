"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FilterX, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TRANSACTION_TYPE_LABELS } from "@/lib/utils";

export interface AuditFilterValues {
  type: string;
  location: string;
  user: string;
  q: string;
  from: string;
  to: string;
}

/** Filter bar for the audit ledger. Every change writes to the URL (resetting
 * the page) so the server component re-queries with the new filters. */
export function AuditFilters({
  filters,
  locations,
  staff,
}: {
  filters: AuditFilterValues;
  locations: { id: string; name: string }[];
  staff: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [search, setSearch] = React.useState(filters.q);

  // Keep the search box in sync when the URL changes (e.g. Clear, back button).
  React.useEffect(() => {
    setSearch(filters.q);
  }, [filters.q]);

  function push(next: Partial<AuditFilterValues>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    (["type", "location", "user", "q", "from", "to"] as const).forEach((key) => {
      if (merged[key]) params.set(key, merged[key]);
    });
    const qs = params.toString();
    router.push(qs ? `/admin/audit?${qs}` : "/admin/audit");
  }

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-3 xl:grid-cols-7">
      <div className="col-span-2 sm:col-span-3 xl:col-span-2">
        <Label htmlFor="audit-q" className="mb-1.5 block text-xs text-muted-foreground">
          Item
        </Label>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            push({ q: search.trim() });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="audit-q"
            className="pl-9"
            placeholder="Search items… (Enter)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </form>
      </div>

      <div>
        <Label htmlFor="audit-type" className="mb-1.5 block text-xs text-muted-foreground">
          Type
        </Label>
        <Select
          id="audit-type"
          value={filters.type}
          onChange={(e) => push({ type: e.target.value })}
        >
          <option value="">All types</option>
          {Object.entries(TRANSACTION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="audit-location" className="mb-1.5 block text-xs text-muted-foreground">
          Location
        </Label>
        <Select
          id="audit-location"
          value={filters.location}
          onChange={(e) => push({ location: e.target.value })}
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="audit-user" className="mb-1.5 block text-xs text-muted-foreground">
          User
        </Label>
        <Select
          id="audit-user"
          value={filters.user}
          onChange={(e) => push({ user: e.target.value })}
        >
          <option value="">All users</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="audit-from" className="mb-1.5 block text-xs text-muted-foreground">
          From
        </Label>
        <Input
          id="audit-from"
          type="date"
          value={filters.from}
          max={filters.to || undefined}
          onChange={(e) => push({ from: e.target.value })}
        />
      </div>

      <div>
        <Label htmlFor="audit-to" className="mb-1.5 block text-xs text-muted-foreground">
          To
        </Label>
        <Input
          id="audit-to"
          type="date"
          value={filters.to}
          min={filters.from || undefined}
          onChange={(e) => push({ to: e.target.value })}
        />
      </div>

      <div className="flex items-end">
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground"
          disabled={!hasFilters}
          onClick={() => {
            setSearch("");
            router.push("/admin/audit");
          }}
        >
          <FilterX /> Clear
        </Button>
      </div>
    </div>
  );
}
