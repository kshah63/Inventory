"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Layers, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { assignItemsToGroup, saveItemGroup } from "@/lib/actions/inventory";
import { matchesWords, queryWords, searchableText } from "@/lib/search";
import { friendlyError } from "@/lib/utils";
import type { Category, Item, ItemGroup } from "@/lib/types";

interface Pick {
  checked: boolean;
  a1: string;
  a2: string;
}

/**
 * Fold existing standalone items into a variant group — the catalogue
 * clean-up. Either spin up a new group (name + one or two attributes) or add
 * to one that exists, then tick the items and give each its values.
 */
export function GroupItemsDialog({
  open,
  onClose,
  categories,
  groups,
  items,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  groups: ItemGroup[];
  items: Item[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [mode, setMode] = React.useState<"new" | "existing">("new");
  const [name, setName] = React.useState("");
  const [categoryId, setCategoryId] = React.useState("");
  const [attr1, setAttr1] = React.useState("");
  const [attr2, setAttr2] = React.useState("");
  const [existingId, setExistingId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [picks, setPicks] = React.useState<Record<string, Pick>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setMode(groups.length > 0 ? mode : "new");
    setName("");
    setCategoryId(categories[0]?.id ?? "");
    setAttr1("");
    setAttr2("");
    setExistingId(groups[0]?.id ?? "");
    setSearch("");
    setPicks({});
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const existingGroup = groups.find((g) => g.id === existingId) ?? null;
  const attr1Label = mode === "new" ? attr1.trim() : existingGroup?.attr1_label ?? "";
  const attr2Label =
    mode === "new" ? attr2.trim() : existingGroup?.attr2_label ?? "";
  const hasAttr2 = attr2Label !== "";

  // Only loose, active items can be folded in. Narrow by the search box.
  const words = queryWords(search);
  const candidates = items.filter((i) => {
    if (i.group_id || !i.is_active) return false;
    if (words.length === 0) return true;
    return matchesWords(searchableText(i), words);
  });

  const chosen = Object.entries(picks).filter(([, p]) => p.checked);
  const groupReady =
    mode === "existing" ? existingId !== "" : name.trim() !== "" && categoryId !== "" && attr1.trim() !== "";
  const linesReady =
    chosen.length > 0 &&
    chosen.every(([, p]) => p.a1.trim() !== "" && (!hasAttr2 || p.a2.trim() !== ""));
  const canSave = !saving && groupReady && linesReady;

  function setPick(id: string, patch: Partial<Pick>) {
    setPicks((prev) => {
      const base: Pick = prev[id] ?? { checked: false, a1: "", a2: "" };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);

    let groupId = existingId;
    if (mode === "new") {
      const res = await saveItemGroup({
        name,
        categoryId,
        attr1Label: attr1,
        attr2Label: attr2.trim() || null,
        isActive: true,
      });
      if (!res.ok) {
        setSaving(false);
        toast(friendlyError(res.error), "error");
        return;
      }
      groupId = res.data.id;
    }

    const res = await assignItemsToGroup({
      groupId,
      assignments: chosen.map(([itemId, p]) => ({
        itemId,
        attr1Value: p.a1.trim(),
        attr2Value: hasAttr2 ? p.a2.trim() : null,
      })),
    });
    setSaving(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(
      `${res.data.count} item${res.data.count === 1 ? "" : "s"} grouped under ${
        mode === "new" ? name.trim() : existingGroup?.name
      }.`,
      "success"
    );
    router.refresh();
    onClose();
  }

  return (
    <Dialog open={open} onClose={saving ? () => {} : onClose} className="max-w-2xl">
      <DialogTitle>Group items into variants</DialogTitle>
      <DialogDescription>
        Tie existing items together so the catalogue shows one entry — people
        then pick the variant. Each item stays its own stock line.
      </DialogDescription>

      <div className="space-y-4">
        {/* The group */}
        {groups.length > 0 && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "new" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("new")}
            >
              New group
            </Button>
            <Button
              type="button"
              variant={mode === "existing" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("existing")}
            >
              Add to existing
            </Button>
          </div>
        )}

        {mode === "new" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="g-name">Group name</Label>
              <Input
                id="g-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Highlighter"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-cat">Category</Label>
              <Select id="g-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div />
            <div className="space-y-1.5">
              <Label htmlFor="g-a1">First attribute</Label>
              <Input
                id="g-a1"
                value={attr1}
                onChange={(e) => setAttr1(e.target.value)}
                placeholder="e.g. Colour"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-a2">
                Second attribute{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="g-a2"
                value={attr2}
                onChange={(e) => setAttr2(e.target.value)}
                placeholder="e.g. Size"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="g-existing">Group</Label>
            <Select id="g-existing" value={existingId} onChange={(e) => setExistingId(e.target.value)}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.attr1_label}
                  {g.attr2_label ? ` + ${g.attr2_label}` : ""})
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* The items */}
        <div className="space-y-2">
          <Label>Items to include</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search loose items…"
              className="h-9 pl-9"
            />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1">
            {candidates.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No ungrouped items match.
              </p>
            ) : (
              candidates.map((it) => {
                const p = picks[it.id] ?? { checked: false, a1: "", a2: "" };
                return (
                  <div key={it.id} className="rounded-md px-2 py-1.5 hover:bg-accent/50">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.checked}
                        onChange={(e) => setPick(it.id, { checked: e.target.checked })}
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {it.name}{" "}
                        <span className="text-muted-foreground">({it.sku})</span>
                      </span>
                    </label>
                    {p.checked && (
                      <div className="mt-1.5 flex gap-2 pl-6">
                        <Input
                          value={p.a1}
                          onChange={(e) => setPick(it.id, { a1: e.target.value })}
                          placeholder={attr1Label || "First attribute"}
                          className="h-8"
                          aria-label={`${attr1Label || "First attribute"} for ${it.name}`}
                        />
                        {hasAttr2 && (
                          <Input
                            value={p.a2}
                            onChange={(e) => setPick(it.id, { a2: e.target.value })}
                            placeholder={attr2Label}
                            className="h-8"
                            aria-label={`${attr2Label} for ${it.name}`}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {chosen.length} selected
            {hasAttr2
              ? ` — give each a ${attr1Label.toLowerCase() || "value"} and ${attr2Label.toLowerCase()}`
              : attr1Label
                ? ` — give each a ${attr1Label.toLowerCase()}`
                : ""}
            .
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={!canSave}>
          <Layers /> Group {chosen.length > 0 ? chosen.length : ""} item
          {chosen.length === 1 ? "" : "s"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
