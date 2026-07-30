"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/actions/auth";

/** "Forgot your password?" — files an in-app request that shows up on the
 * procurement dashboard. Always reports success (no account enumeration). */
export function ForgotPassword() {
  const [open, setOpen] = React.useState(false);
  const [identifier, setIdentifier] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  function close() {
    if (sending) return;
    setOpen(false);
    setSent(false);
    setIdentifier("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setSending(true);
    await requestPasswordReset(identifier);
    setSending(false);
    setSent(true);
  }

  return (
    <>
      <p className="mt-8 text-sm text-muted-foreground">
        Forgot your password?{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Request a new one
        </button>{" "}
        — the procurement team will sort you out.
      </p>

      <Dialog open={open} onClose={close} className="max-w-sm">
        {sent ? (
          <div className="flex flex-col items-center py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <DialogTitle className="mt-3">Request sent</DialogTitle>
            <DialogDescription className="mb-0 mt-1">
              The procurement team has been notified — they&apos;ll set a new
              password and pass it to you.
            </DialogDescription>
            <Button className="mt-5 w-full rounded-full" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogTitle>Request a new password</DialogTitle>
            <DialogDescription>
              Tell us who you are and the procurement team will reset it.
            </DialogDescription>
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fp-id">Your User ID or email</Label>
                <Input
                  id="fp-id"
                  autoFocus
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="1042"
                  className="h-11"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close} disabled={sending}>
                  Cancel
                </Button>
                <Button type="submit" loading={sending}>
                  Send request
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </Dialog>
    </>
  );
}
