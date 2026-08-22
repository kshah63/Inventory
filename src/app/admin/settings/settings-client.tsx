"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { updateSetting } from "@/lib/actions/settings";
import { changeOwnPassword } from "@/lib/actions/auth";
import { friendlyError } from "@/lib/utils";

export function SettingsClient({ initialZones }: { initialZones: string[] }) {
  const router = useRouter();
  const { toast } = useToast();

  // Zones (asked on orders and requests)
  const [zones, setZones] = React.useState(initialZones);
  const [zoneDraft, setZoneDraft] = React.useState("");
  const [savingZones, setSavingZones] = React.useState(false);

  // Password
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [savingPassword, setSavingPassword] = React.useState(false);

  async function saveZones(next: string[], successMessage: string) {
    setSavingZones(true);
    const result = await updateSetting("zones", next);
    setSavingZones(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return false;
    }
    setZones(next);
    toast(successMessage);
    router.refresh();
    return true;
  }

  async function addZone(e: React.FormEvent) {
    e.preventDefault();
    const value = zoneDraft.trim();
    if (!value) return;
    if (zones.some((z) => z.toLowerCase() === value.toLowerCase())) {
      toast("That zone is already in the list.", "error");
      return;
    }
    if (await saveZones([...zones, value], `${value} added.`)) {
      setZoneDraft("");
    }
  }

  async function removeZone(zone: string) {
    await saveZones(
      zones.filter((z) => z !== zone),
      `${zone} removed.`
    );
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast("Password must be at least 8 characters.", "error");
      return;
    }
    if (password !== confirm) {
      toast("Passwords don't match.", "error");
      return;
    }
    setSavingPassword(true);
    const result = await changeOwnPassword(password);
    setSavingPassword(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Password changed.");
    setPassword("");
    setConfirm("");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Zones
          </CardTitle>
          <CardDescription>
            Orders and requests ask &ldquo;which zone is this for?&rdquo; —
            these are the choices, and consumption reports group by them.
            Remove all entries to skip the question.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {zones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No zones configured — orders and requests won&apos;t ask.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {zones.map((zone) => (
                <span
                  key={zone}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-muted py-1 pl-3 pr-1 text-sm"
                >
                  {zone}
                  <button
                    type="button"
                    onClick={() => removeZone(zone)}
                    disabled={savingZones}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Remove ${zone}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form onSubmit={addZone} className="flex gap-2">
            <Input
              placeholder="e.g. 23"
              value={zoneDraft}
              onChange={(e) => setZoneDraft(e.target.value)}
              className="max-w-xs"
              aria-label="New zone"
            />
            <Button type="submit" variant="outline" loading={savingZones}>
              <Plus /> Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Account
          </CardTitle>
          <CardDescription>Change the password you sign in with.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitPassword} className="max-w-sm space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" loading={savingPassword}>
              Change password
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
