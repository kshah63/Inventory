"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { importCatalog, type ImportRow } from "@/lib/actions/inventory";
import { friendlyError } from "@/lib/utils";
import type { Location } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* CSV parsing (hand-written — quoted fields, "" escapes, CRLF/CR/LF) */
/* ------------------------------------------------------------------ */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      endField();
    } else if (c === "\r") {
      endRow();
      if (text[i + 1] === "\n") i++;
    } else if (c === "\n") {
      endRow();
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) endRow();

  // Drop rows that are entirely empty (trailing newlines, blank lines).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/* ------------------------------------------------------------------ */
/* Header mapping                                                      */
/* ------------------------------------------------------------------ */

/** "Level 8" / "level_8" / "LEVEL8" all normalize to "level8". */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

const FIXED_KEYS = [
  "sku",
  "name",
  "category",
  "unit",
  "pack_size",
  "reorder_point",
  "par_level",
  "max_per_checkout",
  "requires_approval",
  "notes",
] as const;
type FixedKey = (typeof FIXED_KEYS)[number];

interface LocationColumns {
  /** Canonical location name to send to the server. */
  location: string;
  qty?: number;
  reorder?: number;
  par?: number;
}

interface HeaderMap {
  fixed: Partial<Record<FixedKey, number>>;
  locations: LocationColumns[];
  unmatched: string[];
}

function mapHeaders(headers: string[], locations: Location[]): HeaderMap {
  const fixed: Partial<Record<FixedKey, number>> = {};
  const locCols = new Map<string, LocationColumns>();
  const unmatched: string[] = [];

  const byNormalizedName = new Map(locations.map((l) => [normalizeKey(l.name), l.name]));

  const locColumnFor = (name: string): LocationColumns => {
    let col = locCols.get(name);
    if (!col) {
      col = { location: name };
      locCols.set(name, col);
    }
    return col;
  };

  headers.forEach((raw, idx) => {
    const key = normalizeKey(raw);
    if (key === "") return;

    const fixedKey = FIXED_KEYS.find((f) => normalizeKey(f) === key);
    if (fixedKey) {
      if (fixed[fixedKey] === undefined) fixed[fixedKey] = idx;
      return;
    }

    // "<location>_qty" / "<location> reorder" / "<location> par" columns,
    // matched case-insensitively against active location names ("level 8" ≈ "level8").
    for (const [suffix, prop] of [
      ["qty", "qty"],
      ["reorder", "reorder"],
      ["par", "par"],
    ] as const) {
      if (key.endsWith(suffix) && key.length > suffix.length) {
        const locName = byNormalizedName.get(key.slice(0, -suffix.length));
        if (locName) {
          locColumnFor(locName)[prop] = idx;
          return;
        }
      }
    }

    unmatched.push(raw.trim());
  });

  return { fixed, locations: [...locCols.values()], unmatched };
}

/* ------------------------------------------------------------------ */
/* Row mapping + validation                                            */
/* ------------------------------------------------------------------ */

interface ParseOutcome {
  rows: ImportRow[];
  errors: string[];
  warnings: string[];
  headerMap: HeaderMap;
}

function buildImport(text: string, locations: Location[]): ParseOutcome {
  const table = parseCsv(text);
  if (table.length === 0) {
    return {
      rows: [],
      errors: ["The file is empty."],
      warnings: [],
      headerMap: { fixed: {}, locations: [], unmatched: [] },
    };
  }

  const headerMap = mapHeaders(table[0], locations);
  const { fixed } = headerMap;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const required of ["sku", "name", "category"] as const) {
    if (fixed[required] === undefined) {
      errors.push(`Missing required column "${required}" in the header row.`);
    }
  }
  if (headerMap.locations.length === 0) {
    warnings.push(
      `No stock columns matched an active location (${locations
        .map((l) => l.name)
        .join(", ")}) — items will import without stock changes.`
    );
  }
  for (const h of headerMap.unmatched) {
    warnings.push(`Column "${h}" was not recognised and will be ignored.`);
  }
  if (errors.length > 0) {
    return { rows: [], errors, warnings, headerMap };
  }

  const rows: ImportRow[] = [];
  const isInt = (s: string) => /^\d+$/.test(s);

  table.slice(1).forEach((cells, i) => {
    const line = i + 2; // 1-based file line (after the header)
    const get = (k: FixedKey) =>
      fixed[k] !== undefined ? (cells[fixed[k]!] ?? "").trim() : "";

    const sku = get("sku");
    const name = get("name");
    const category = get("category");
    if (!sku) errors.push(`Row ${line}: missing sku.`);
    if (!name) errors.push(`Row ${line}: missing name.`);
    if (!category) errors.push(`Row ${line}: missing category.`);

    for (const k of ["pack_size", "max_per_checkout", "reorder_point", "par_level"] as const) {
      const v = get(k);
      if (v !== "" && !isInt(v)) errors.push(`Row ${line}: ${k} must be a whole number ("${v}").`);
    }

    // Shared reorder_point / par_level columns apply to every stock location.
    const sharedReorder = get("reorder_point");
    const sharedPar = get("par_level");

    const stock = headerMap.locations.map((lc) => {
      const cellAt = (idx?: number) => (idx !== undefined ? (cells[idx] ?? "").trim() : "");
      const qtyRaw = cellAt(lc.qty);
      if (qtyRaw !== "" && !isInt(qtyRaw)) {
        errors.push(`Row ${line}: ${lc.location} qty must be a whole number ("${qtyRaw}").`);
      }
      const reorder = cellAt(lc.reorder) || sharedReorder;
      const par = cellAt(lc.par) || sharedPar;
      return {
        location: lc.location,
        qty: qtyRaw === "" ? null : qtyRaw,
        ...(reorder !== "" ? { reorder_point: reorder } : {}),
        ...(par !== "" ? { par_level: par } : {}),
      };
    });

    rows.push({
      sku,
      name,
      category,
      unit: get("unit") || undefined,
      pack_size: get("pack_size") || undefined,
      max_per_checkout: get("max_per_checkout") || undefined,
      requires_approval: get("requires_approval") || undefined,
      notes: get("notes") || undefined,
      stock,
    });
  });

  if (rows.length === 0) errors.push("No data rows found below the header.");

  return { rows, errors, warnings, headerMap };
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function ImportDialog({
  open,
  onClose,
  locations,
}: {
  open: boolean;
  onClose: () => void;
  locations: Location[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [parsed, setParsed] = React.useState<ParseOutcome | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFileName(null);
    setParsed(null);
    setSubmitting(false);
    if (fileRef.current) fileRef.current.value = "";
  }, [open]);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      setParsed(null);
      return;
    }
    setFileName(file.name);
    try {
      const text = await file.text();
      setParsed(buildImport(text, locations));
    } catch {
      setParsed({
        rows: [],
        errors: ["Couldn't read the file — is it a plain-text CSV?"],
        warnings: [],
        headerMap: { fixed: {}, locations: [], unmatched: [] },
      });
    }
  }

  async function confirm() {
    if (!parsed || parsed.errors.length > 0 || parsed.rows.length === 0) return;
    setSubmitting(true);
    const res = await importCatalog(parsed.rows);
    setSubmitting(false);
    if (!res.ok) {
      toast(friendlyError(res.error), "error");
      return;
    }
    toast(
      `Import complete — created ${res.data.created}, updated ${res.data.updated}, stock adjusted ${res.data.stock_adjusted}.`
    );
    router.refresh();
    onClose();
  }

  const previewLocations = parsed?.headerMap.locations ?? [];

  return (
    <Dialog open={open} onClose={onClose} className="max-w-3xl">
      <DialogTitle>Import catalog from CSV</DialogTitle>
      <DialogDescription>
        Expected columns: sku, name, category, unit, pack_size, level8_qty, basement_qty,
        reorder_point, par_level, max_per_checkout, requires_approval, notes. Rows are
        matched by SKU, so re-importing is safe — existing items are updated and an empty
        qty cell leaves stock untouched. A ready-made template ships with the app at{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">
          supabase/templates/catalog_template.csv
        </code>
        .
      </DialogDescription>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="import-file">CSV file</Label>
          <Input
            id="import-file"
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFileChange}
          />
        </div>

        {parsed && (
          <>
            {parsed.errors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="mb-1 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Fix these before importing:
                </p>
                <ul className="ml-5 list-disc space-y-0.5">
                  {parsed.errors.slice(0, 8).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {parsed.errors.length > 8 && (
                    <li>…and {parsed.errors.length - 8} more.</li>
                  )}
                </ul>
              </div>
            )}

            {parsed.warnings.length > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                <ul className="ml-5 list-disc space-y-0.5">
                  {parsed.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsed.rows.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                  {fileName} — {parsed.rows.length} row{parsed.rows.length === 1 ? "" : "s"}
                  {parsed.rows.length > 10 ? " (showing first 10)" : ""}
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Unit</TableHead>
                      {previewLocations.map((lc) => (
                        <TableHead key={lc.location}>{lc.location} qty</TableHead>
                      ))}
                      <TableHead>R / P</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsed.rows.slice(0, 10).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {row.sku || "—"}
                        </TableCell>
                        <TableCell>{row.name || "—"}</TableCell>
                        <TableCell>{row.category || "—"}</TableCell>
                        <TableCell>{row.unit ?? ""}</TableCell>
                        {previewLocations.map((lc) => {
                          const s = row.stock.find((x) => x.location === lc.location);
                          return (
                            <TableCell key={lc.location} className="tabular-nums">
                              {s?.qty ?? "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                          {row.stock[0]
                            ? `${row.stock[0].reorder_point ?? "–"} / ${row.stock[0].par_level ?? "–"}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={confirm}
          loading={submitting}
          disabled={!parsed || parsed.errors.length > 0 || parsed.rows.length === 0}
        >
          <Upload /> Import {parsed && parsed.rows.length > 0 ? `${parsed.rows.length} rows` : ""}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
