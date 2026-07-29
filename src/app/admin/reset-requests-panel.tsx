"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { dismissResetRequest, fulfillPasswordReset } from "@/lib/actions/users";
import { timeAgo } from "@/lib/utils";

export interface ResetRequest {
  id: string;
  identifier: string;
  created_at: string;
  matched: { full_name: string; user_no: number | null; role: string } | null;
}

export function ResetRequestsPanel({ requests }: { requests: ResetRequest[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ label: string; password: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function fulfill(request: ResetRequest) {
    setBusyId(request.id);
    const result = await fulfillPasswordReset(request.id);
    setBusyId(null);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setIssued({ label: result.data.label, password: result.data.tempPassword });
    router.refresh();
  }

  async function dismiss(request: ResetRequest) {
    setBusyId(request.id);
    const result = await dismissResetRequest(request.id);
    setBusyId(null);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Request dismissed.");
    router.refresh();
  }

  if (requests.length === 0) return null;

  return (
    <>
      <Card className="mb-6 border-warning/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-warning" />
            Password reset requests
          </CardTitle>
          <CardDescription>
            From the sign-in page. Generating a new password shows it once —
            pass it on, and they can change it after signing in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  {request.matched ? (
                    <p className="truncate text-sm font-medium">
                      {request.matched.full_name}
                      {request.matched.user_no != null && (
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                          ID {request.matched.user_no}
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="truncate text-sm font-medium">
                      {request.identifier}{" "}
                      <Badge variant="outline" className="ml-1">
                        no matching account
                      </Badge>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    asked {timeAgo(request.created_at)}
                    {request.matched ? ` · entered "${request.identifier}"` : ""}
                  </p>
                </div>
                {request.matched && (
                  <Button
                    size="sm"
                    loading={busyId === request.id}
                    onClick={() => fulfill(request)}
                  >
                    <KeyRound /> New password
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId === request.id}
                  onClick={() => dismiss(request)}
                  aria-label="Dismiss request"
                >
                  <X /> Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {issued && (
        <Dialog open onClose={() => setIssued(null)} className="max-w-md">
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with <strong>{issued.label}</strong> now — it won&apos;t be
            shown again. They can change it in Settings after signing in.
          </DialogDescription>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted px-3 py-2.5 font-mono text-base">
              {issued.password}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={async () => {
                await navigator.clipboard.writeText(issued.password);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              aria-label="Copy password"
            >
              {copied ? <Check className="text-success" /> : <Copy />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}
