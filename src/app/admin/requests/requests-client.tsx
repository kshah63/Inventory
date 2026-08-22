"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ExternalLink, Inbox, PackageCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { setRequestProgress } from "@/lib/actions/requests";
import { formatDate, friendlyError, timeAgo, REQUEST_STATUS_LABELS } from "@/lib/utils";
import type { RequestStatus } from "@/lib/types";
import { StockMatchDialog } from "./stock-match-dialog";

export interface AdminRequest {
  id: string;
  qty: number;
  status: RequestStatus;
  note: string | null;
  admin_note: string | null;
  created_at: string;
  free_text_item: string | null;
  description: string | null;
  product_url: string | null;
  photo_url: string | null;
  item_name: string | null;
  unit: string | null;
  requester_name: string;
  zone: string | null;
  expected_date: string | null;
}

const STATUS_ORDER: RequestStatus[] = [
  "open",
  "acknowledged",
  "ordered",
  "received",
  "ready",
  "fulfilled",
  "rejected",
];

const STATUS_BADGE: Record<RequestStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  open: "warning",
  acknowledged: "secondary",
  ordered: "default",
  received: "default",
  ready: "success",
  fulfilled: "secondary",
  rejected: "destructive",
};

/** Sensible default for "what happens next" when the dialog opens. */
const NEXT_STATUS: Record<RequestStatus, RequestStatus> = {
  open: "acknowledged",
  acknowledged: "ordered",
  ordered: "received",
  received: "ready",
  ready: "fulfilled",
  fulfilled: "fulfilled",
  rejected: "rejected",
};

const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  open: {
    title: "No open requests",
    description: "You're all caught up — new item requests will land here first.",
  },
  acknowledged: {
    title: "Nothing acknowledged",
    description: "Requests you've acknowledged but not yet ordered will sit here.",
  },
  ordered: {
    title: "No orders in flight",
    description: "Requests marked as ordered will appear here until fulfilled.",
  },
  received: {
    title: "Nothing waiting to be packed",
    description:
      "Deliveries you've marked received sit here until you set them ready. The requester still sees these as on order.",
  },
  ready: {
    title: "Nothing waiting to be collected",
    description: "Requests you've marked ready — the requester has been told.",
  },
  fulfilled: {
    title: "Nothing collected yet",
    description: "Completed requests will show up here.",
  },
  rejected: {
    title: "No rejected requests",
    description: "Requests you've turned down will appear here.",
  },
  all: {
    title: "No requests yet",
    description:
      "Requests for items the catalogue doesn't carry will appear here as they come in.",
  },
};

function itemLabel(r: AdminRequest): string {
  return r.item_name ?? r.free_text_item ?? "item";
}

export function RequestsClient({ requests }: { requests: AdminRequest[] }) {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = React.useState<string>("open");
  const [active, setActive] = React.useState<AdminRequest | null>(null);
  const [newStatus, setNewStatus] = React.useState<RequestStatus>("acknowledged");
  const [adminNote, setAdminNote] = React.useState("");
  const [expectedDate, setExpectedDate] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [matching, setMatching] = React.useState<AdminRequest | null>(null);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: requests.length };
    for (const s of STATUS_ORDER) c[s] = 0;
    for (const r of requests) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [requests]);

  const visible =
    tab === "all" ? requests : requests.filter((r) => r.status === tab);

  function openDialog(r: AdminRequest) {
    setActive(r);
    setNewStatus(NEXT_STATUS[r.status]);
    setAdminNote(r.admin_note ?? "");
    setExpectedDate(r.expected_date ?? "");
  }

  function closeDialog() {
    if (saving) return;
    setActive(null);
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    const result = await setRequestProgress({
      requestId: active.id,
      status: newStatus,
      // An emptied field clears the date rather than leaving the old one.
      expectedDate: expectedDate || (active.expected_date ? null : undefined),
      adminNote,
    });
    setSaving(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    const tellsThem = newStatus === "ready" || newStatus === "rejected";
    toast(
      `"${itemLabel(active)}" marked ${REQUEST_STATUS_LABELS[newStatus]}${
        tellsThem
          ? " — the requester has been told, and gets a WhatsApp if their number is on file."
          : " — the requester still sees this as on order."
      }`
    );
    setActive(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {[...STATUS_ORDER, "all" as const].map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === "all" ? "All" : REQUEST_STATUS_LABELS[s]}
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {counts[s] ?? 0}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={EMPTY_COPY[tab].title}
          description={EMPTY_COPY[tab].description}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  {r.photo_url && (
                    <a
                      href={r.photo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0"
                      title="Open the full-size photo"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.photo_url}
                        alt={itemLabel(r)}
                        className="h-20 w-20 rounded-md border object-cover"
                      />
                    </a>
                  )}
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {r.qty} × {itemLabel(r)}
                      </span>
                      {r.unit && (
                        <span className="text-sm text-muted-foreground">{r.unit}</span>
                      )}
                      {!r.item_name && r.free_text_item && (
                        <Badge variant="outline">NEW ITEM</Badge>
                      )}
                      <Badge variant={STATUS_BADGE[r.status]}>
                        {REQUEST_STATUS_LABELS[r.status]}
                      </Badge>
                      {r.zone && <Badge variant="outline">Zone {r.zone}</Badge>}
                      {r.expected_date && (
                        <Badge variant="outline">
                          due {formatDate(r.expected_date)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {r.requester_name} · {timeAgo(r.created_at)}
                    </p>
                    {r.description && (
                      <p className="whitespace-pre-line text-sm">{r.description}</p>
                    )}
                    {r.product_url && (
                      <a
                        href={r.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{r.product_url}</span>
                      </a>
                    )}
                    {r.note && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Requester note:</span>{" "}
                        {r.note}
                      </p>
                    )}
                    {r.admin_note && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Admin note:</span>{" "}
                        {r.admin_note}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 self-start">
                  {r.status !== "fulfilled" && r.status !== "rejected" && (
                    <Button size="sm" onClick={() => setMatching(r)}>
                      <PackageCheck /> We stock this
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => openDialog(r)}>
                    Update status <ArrowRight />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {matching && (
        <StockMatchDialog
          request={{
            id: matching.id,
            label: matching.free_text_item ?? matching.item_name ?? "",
            qty: matching.qty,
            requester: matching.requester_name,
          }}
          onClose={() => setMatching(null)}
        />
      )}

      <Dialog open={active !== null} onClose={closeDialog} className="max-w-md">
        {active && (
          <>
            <DialogTitle>
              {active.qty} × {itemLabel(active)}
            </DialogTitle>
            <DialogDescription>
              Requested by {active.requester_name}
              {active.zone ? ` for zone ${active.zone}` : ""}. They get a WhatsApp
              update if their number is on file.
            </DialogDescription>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="request-status">New status</Label>
                <Select
                  id="request-status"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as RequestStatus)}
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {REQUEST_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="request-expected">
                  Expected delivery date{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="request-expected"
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  className="h-11 w-48"
                />
                <p className="text-xs text-muted-foreground">
                  {expectedDate
                    ? `They'll see "expected around ${formatDate(expectedDate)}".`
                    : "They see no date until you set one."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="request-admin-note">Admin note (optional)</Label>
                <Textarea
                  id="request-admin-note"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="e.g. Ordered from Popular, arriving Friday"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving}>
                Save &amp; notify
              </Button>
            </DialogFooter>
          </>
        )}
      </Dialog>
    </div>
  );
}
