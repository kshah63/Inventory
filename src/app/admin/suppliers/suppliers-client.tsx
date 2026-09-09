"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, Copy, Download, Pencil, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  addSupplier,
  addSupplierAlias,
  addSupplierSubgroup,
  updateSupplier,
} from "@/lib/actions/suppliers";
import { matchesWords, queryWords } from "@/lib/search";
import { cn, friendlyError } from "@/lib/utils";
import type { SupplierGroup, SupplierRow, SupplierSubgroup } from "@/lib/types";

const fullCode = (s: { group_code: number; sub_code: number }) =>
  `${s.group_code}-${s.sub_code}`;

/** The exact string QuickBooks gets: code, group name in brackets, em dash,
 * then the supplier. The bracketed group is a decode of the code prefix, so
 * management reads reports without a separate code-to-group sheet. One format
 * everywhere, so pasting can't reintroduce the inconsistencies this register
 * exists to end. */
const qbName = (
  s: { group_code: number; sub_code: number; name: string },
  groupName: string
) => `${fullCode(s)} [${groupName}] \u2014 ${s.name}`;

function csvEscape(v: string) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function SuppliersClient({
  groups,
  subgroups,
  suppliers,
}: {
  groups: SupplierGroup[];
  subgroups: SupplierSubgroup[];
  suppliers: SupplierRow[];
}) {
  const { toast } = useToast();
  const [search, setSearch] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState("");
  const [showRetired, setShowRetired] = React.useState(true);
  const [addOpen, setAddOpen] = React.useState(false);
  const [subgroupOpen, setSubgroupOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SupplierRow | null>(null);

  const words = queryWords(search);
  const matches = (s: SupplierRow) => {
    if (!showRetired && s.status === "retired") return false;
    if (groupFilter && String(s.group_code) !== groupFilter) return false;
    if (words.length === 0) return true;
    const text = [
      s.name,
      fullCode(s),
      String(s.sub_code),
      s.notes ?? "",
      ...s.supplier_aliases.map((a) => `${a.alias} ${a.old_code ?? ""}`),
    ]
      .join(" ")
      .toLowerCase();
    return matchesWords(text, words);
  };
  const shown = suppliers.filter(matches);
  const shownIds = new Set(shown.map((s) => s.id));

  const groupNames = React.useMemo(
    () => new Map(groups.map((g) => [g.code, g.name])),
    [groups]
  );
  const qb = (s: SupplierRow) => qbName(s, groupNames.get(s.group_code) ?? "");

  async function copyQbName(s: SupplierRow) {
    try {
      await navigator.clipboard.writeText(qb(s));
      toast(`Copied "${qb(s)}" — paste it into QuickBooks as-is.`);
    } catch {
      toast("Couldn't copy to clipboard — check browser permissions.", "error");
    }
  }

  function exportCsv() {
    const header = ["full_code", "quickbooks_display_name", "group", "sub_group", "supplier", "status", "notes", "old_quickbooks_names"];
    const sgName = new Map(subgroups.map((sg) => [sg.id, sg.name]));
    const lines = [header.join(",")];
    for (const s of shown) {
      lines.push(
        [
          fullCode(s),
          qb(s),
          groupNames.get(s.group_code) ?? "",
          sgName.get(s.subgroup_id) ?? "",
          s.name,
          s.status,
          s.notes ?? "",
          s.supplier_aliases.map((a) => a.alias).join("; "),
        ]
          .map((v) => csvEscape(String(v)))
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mathvision-suppliers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${shown.length} supplier${shown.length === 1 ? "" : "s"}.`);
  }

  return (
    <div className="space-y-5">
      {/* One card per group with its live count — the page's table of
          contents. Click focuses the list on that group; click again clears.
          Counts follow the retired toggle but not the search, so the map
          stays steady while somebody types. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {groups.map((g) => {
          const count = suppliers.filter(
            (s) => s.group_code === g.code && (showRetired || s.status === "active")
          ).length;
          const active = groupFilter === String(g.code);
          return (
            <button
              key={g.code}
              type="button"
              onClick={() => setGroupFilter(active ? "" : String(g.code))}
              aria-pressed={active}
              title={`${g.name} — ${count} supplier${count === 1 ? "" : "s"}`}
              className={cn(
                "rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-accent ring-1 ring-primary/30"
                  : "hover:bg-accent"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {g.code}
                </span>
                <span className="text-sm font-semibold tabular-nums">{count}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug">
                {g.name}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, or old QuickBooks name…"
              className="pl-9"
              aria-label="Search suppliers"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="show-retired"
              checked={showRetired}
              onCheckedChange={setShowRetired}
              aria-label="Show retired suppliers"
            />
            <Label htmlFor="show-retired" className="cursor-pointer text-muted-foreground">
              Show retired
            </Label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={shown.length === 0}>
            <Download /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSubgroupOpen(true)}>
            <Plus /> New sub-group
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> Add supplier
          </Button>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No suppliers match"
          description="Try a different search — old QuickBooks spellings are searchable too."
        />
      ) : (
        groups
          .filter((g) => shown.some((s) => s.group_code === g.code))
          .map((g) => (
            <section key={g.code}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {g.code} · {g.name}
              </h2>
              <div className="space-y-3">
                {subgroups
                  .filter(
                    (sg) =>
                      sg.group_code === g.code &&
                      suppliers.some((s) => s.subgroup_id === sg.id && shownIds.has(s.id))
                  )
                  .map((sg) => {
                    const members = suppliers.filter((s) => s.subgroup_id === sg.id);
                    const visible = members.filter((s) => shownIds.has(s.id));
                    const capacity = sg.code_end - sg.code_start;
                    return (
                      <div key={sg.id} className="overflow-hidden rounded-lg border bg-card shadow-sm">
                        <div className="flex flex-wrap items-baseline gap-2 border-b bg-muted/40 px-4 py-2">
                          <span className="font-medium">{sg.name}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {g.code}-{sg.code_start + 1} to {g.code}-{sg.code_end}
                          </span>
                          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                            {members.length} of {capacity} used
                          </span>
                        </div>
                        <ul className="divide-y">
                          {visible.map((s) => (
                            <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                              <span className="w-24 shrink-0 font-mono text-sm font-semibold tabular-nums">
                                {fullCode(s)}
                              </span>
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate text-sm",
                                  s.status === "retired" && "text-muted-foreground line-through"
                                )}
                                title={s.notes ?? undefined}
                              >
                                {s.name}
                              </span>
                              {s.status === "retired" && (
                                <Badge variant="secondary">Retired</Badge>
                              )}
                              {s.supplier_aliases.length > 0 && (
                                <Badge
                                  variant="outline"
                                  title={s.supplier_aliases.map((a) => a.alias).join("\n")}
                                >
                                  {s.supplier_aliases.length} old name
                                  {s.supplier_aliases.length === 1 ? "" : "s"}
                                </Badge>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => copyQbName(s)}
                                aria-label={`Copy QuickBooks name for ${s.name}`}
                                title={`Copy "${qb(s)}"`}
                              >
                                <Copy />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setEditing(s)}
                                aria-label={`Edit ${s.name}`}
                              >
                                <Pencil />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
              </div>
            </section>
          ))
      )}

      <AddSupplierDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        groups={groups}
        subgroups={subgroups}
        suppliers={suppliers}
      />
      <NewSubgroupDialog
        open={subgroupOpen}
        onClose={() => setSubgroupOpen(false)}
        groups={groups}
      />
      <EditSupplierDialog supplier={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** The code is previewed, then assigned by the database — never typed. */
function AddSupplierDialog({
  open,
  onClose,
  groups,
  subgroups,
  suppliers,
}: {
  open: boolean;
  onClose: () => void;
  groups: SupplierGroup[];
  subgroups: SupplierSubgroup[];
  suppliers: SupplierRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [groupCode, setGroupCode] = React.useState("");
  const [subgroupId, setSubgroupId] = React.useState("");
  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setGroupCode("");
    setSubgroupId("");
    setName("");
    setNotes("");
    setSaving(false);
  }, [open]);

  const groupSubgroups = subgroups.filter((sg) => String(sg.group_code) === groupCode);
  const sg = subgroups.find((s) => s.id === subgroupId);
  const nextCode = sg
    ? Math.max(sg.code_start, ...suppliers.filter((s) => s.subgroup_id === sg.id).map((s) => s.sub_code)) + 1
    : null;
  const full = sg && nextCode !== null && nextCode <= sg.code_end;

  async function submit() {
    if (!subgroupId || !name.trim() || saving) return;
    setSaving(true);
    const res = await addSupplier({ subgroupId, name, notes: notes.trim() || undefined });
    setSaving(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    const grpName = groups.find((g) => String(g.code) === groupCode)?.name ?? "";
    const pasteText = `${res.data.full_code} [${grpName}] \u2014 ${name.trim()}`;
    try {
      // Pasting into QuickBooks is the very next step, so save the trip.
      await navigator.clipboard.writeText(pasteText);
      toast(`${res.data.full_code} assigned — "${pasteText}" copied for QuickBooks.`, "success");
    } catch {
      toast(`${res.data.full_code} assigned to ${name.trim()}. Use the copy button to paste it into QuickBooks.`, "success");
    }
    router.refresh();
    onClose();
  }

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} className="max-w-md">
      <DialogTitle>Add a supplier</DialogTitle>
      <DialogDescription>
        Pick where it belongs and the next code is assigned automatically.
      </DialogDescription>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ns-group">Group</Label>
          <Select
            id="ns-group"
            value={groupCode}
            onChange={(e) => {
              setGroupCode(e.target.value);
              setSubgroupId("");
            }}
          >
            <option value="">Select a group…</option>
            {groups.map((g) => (
              <option key={g.code} value={g.code}>
                {g.code} — {g.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ns-subgroup">Sub-group</Label>
          <Select
            id="ns-subgroup"
            value={subgroupId}
            onChange={(e) => setSubgroupId(e.target.value)}
            disabled={!groupCode}
          >
            <option value="">{groupCode ? "Select a sub-group…" : "Pick a group first"}</option>
            {groupSubgroups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code_start + 1}–{s.code_end})
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ns-name">Supplier name</Label>
          <Input
            id="ns-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="As it should appear in QuickBooks"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ns-notes">Notes</Label>
          <Textarea
            id="ns-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional — contact, account number, remarks"
          />
        </div>
        {sg && (
          <p className={cn("rounded-md border px-3 py-2 text-sm", !full && "border-destructive/40 bg-destructive/10 text-destructive")}>
            {full ? (
              <>
                Will be assigned{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {sg.group_code}-{nextCode}
                </span>
              </>
            ) : (
              <>This sub-group is full — add a new sub-group first.</>
            )}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!subgroupId || !name.trim() || !full}>
          Add supplier
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function NewSubgroupDialog({
  open,
  onClose,
  groups,
}: {
  open: boolean;
  onClose: () => void;
  groups: SupplierGroup[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [groupCode, setGroupCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [width, setWidth] = React.useState<"10" | "100">("100");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setGroupCode("");
    setName("");
    setWidth("100");
    setSaving(false);
  }, [open]);

  async function submit() {
    if (!groupCode || !name.trim() || saving) return;
    setSaving(true);
    const res = await addSupplierSubgroup({
      groupCode: Number(groupCode),
      name,
      width: Number(width) as 10 | 100,
    });
    setSaving(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(
      `Sub-group created — codes ${groupCode}-${res.data.code_start + 1} to ${groupCode}-${res.data.code_end}.`,
      "success"
    );
    router.refresh();
    onClose();
  }

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} className="max-w-md">
      <DialogTitle>New sub-group</DialogTitle>
      <DialogDescription>
        Claims the next free block in the group. Blocks of a hundred fit 99
        suppliers; blocks of ten fit 9 — used for per-location groups like rent.
      </DialogDescription>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="nsg-group">Group</Label>
          <Select id="nsg-group" value={groupCode} onChange={(e) => setGroupCode(e.target.value)}>
            <option value="">Select a group…</option>
            {groups.map((g) => (
              <option key={g.code} value={g.code}>
                {g.code} — {g.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nsg-name">Sub-group name</Label>
          <Input id="nsg-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nsg-width">Block size</Label>
          <Select
            id="nsg-width"
            value={width}
            onChange={(e) => setWidth(e.target.value as "10" | "100")}
          >
            <option value="100">Block of 100 (99 suppliers)</option>
            <option value="10">Block of 10 (9 suppliers)</option>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!groupCode || !name.trim()}>
          Create sub-group
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function EditSupplierDialog({
  supplier,
  onClose,
}: {
  supplier: SupplierRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [retired, setRetired] = React.useState(false);
  const [alias, setAlias] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [addingAlias, setAddingAlias] = React.useState(false);

  React.useEffect(() => {
    if (!supplier) return;
    setName(supplier.name);
    setNotes(supplier.notes ?? "");
    setRetired(supplier.status === "retired");
    setAlias("");
    setSaving(false);
    setAddingAlias(false);
  }, [supplier]);

  async function submit() {
    if (!supplier || !name.trim() || saving) return;
    setSaving(true);
    const res = await updateSupplier({
      supplierId: supplier.id,
      name,
      notes: notes.trim() || null,
      status: retired ? "retired" : "active",
    });
    setSaving(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(`${fullCode(supplier)} updated.`);
    router.refresh();
    onClose();
  }

  async function submitAlias() {
    if (!supplier || !alias.trim() || addingAlias) return;
    setAddingAlias(true);
    const res = await addSupplierAlias(supplier.id, alias);
    setAddingAlias(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(`"${alias.trim()}" now finds ${fullCode(supplier)}.`);
    setAlias("");
    router.refresh();
  }

  return (
    <Dialog open={supplier !== null} onClose={saving ? () => {} : onClose} className="max-w-md">
      {supplier && (
        <>
          <DialogTitle>
            <span className="font-mono tabular-nums">{fullCode(supplier)}</span>
          </DialogTitle>
          <DialogDescription>
            The code is permanent. Retire the supplier rather than deleting it —
            the accounts already reference the number.
          </DialogDescription>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="es-name">Supplier name</Label>
              <Input id="es-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-notes">Notes</Label>
              <Textarea
                id="es-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/40 px-3 py-2.5">
              <div>
                <Label htmlFor="es-retired" className="cursor-pointer">
                  Retired
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  No longer used. Keeps its code and history; hidden behind the
                  &ldquo;Show retired&rdquo; toggle.
                </p>
              </div>
              <Switch id="es-retired" checked={retired} onCheckedChange={setRetired} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-alias">Old names</Label>
              {supplier.supplier_aliases.length > 0 && (
                <ul className="max-h-28 overflow-y-auto rounded-md border px-3 py-2 text-xs text-muted-foreground">
                  {supplier.supplier_aliases.map((a) => (
                    <li key={a.id} className="truncate">
                      {a.alias}
                      {a.old_code ? ` (${a.old_code})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  id="es-alias"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  placeholder="Add an old spelling so searches find it"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitAlias();
                  }}
                />
                <Button variant="outline" onClick={submitAlias} loading={addingAlias}>
                  Add
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving} disabled={!name.trim()}>
              Save changes
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
