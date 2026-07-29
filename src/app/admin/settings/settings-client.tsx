"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Info, KeyRound, MapPin, MessageCircle, Phone, Plus, Send, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { sendTestWhatsApp, updateSetting } from "@/lib/actions/settings";
import { changeOwnPassword } from "@/lib/actions/auth";
import { friendlyError } from "@/lib/utils";

const E164 = /^\+[1-9][0-9]{7,14}$/;

export function SettingsClient({
  initialRecipients,
  initialDigestEnabled,
  initialAlertsEnabled,
  initialZones,
}: {
  initialRecipients: string[];
  initialDigestEnabled: boolean;
  initialAlertsEnabled: boolean;
  initialZones: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  // WhatsApp recipients
  const [recipients, setRecipients] = React.useState(initialRecipients);
  const [draft, setDraft] = React.useState("");
  const [savingRecipients, setSavingRecipients] = React.useState(false);

  // Departments (asked on orders and requests)
  const [zones, setZones] = React.useState(initialZones);
  const [zoneDraft, setZoneDraft] = React.useState("");
  const [savingZones, setSavingZones] = React.useState(false);

  // Toggles
  const [digestEnabled, setDigestEnabled] = React.useState(initialDigestEnabled);
  const [alertsEnabled, setAlertsEnabled] = React.useState(initialAlertsEnabled);

  // Test message
  const [sendingTest, setSendingTest] = React.useState(false);

  // Password
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [savingPassword, setSavingPassword] = React.useState(false);

  async function saveRecipients(next: string[], successMessage: string) {
    setSavingRecipients(true);
    const result = await updateSetting("whatsapp_recipients", next);
    setSavingRecipients(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return false;
    }
    setRecipients(next);
    toast(successMessage);
    router.refresh();
    return true;
  }

  async function addRecipient(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim().replace(/[\s-]/g, "");
    if (!E164.test(value)) {
      toast("Enter a full international number, e.g. +6591234567.", "error");
      return;
    }
    if (recipients.includes(value)) {
      toast("That number is already in the list.", "error");
      return;
    }
    if (await saveRecipients([...recipients, value], `${value} added.`)) {
      setDraft("");
    }
  }

  async function removeRecipient(number: string) {
    await saveRecipients(
      recipients.filter((n) => n !== number),
      `${number} removed.`
    );
  }

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

  async function toggleSetting(
    key: "digest_enabled" | "alerts_enabled",
    value: boolean
  ) {
    const setter = key === "digest_enabled" ? setDigestEnabled : setAlertsEnabled;
    setter(value); // optimistic
    const result = await updateSetting(key, value);
    if (!result.ok) {
      setter(!value); // revert
      toast(friendlyError(result.error), "error");
      return;
    }
    const label = key === "digest_enabled" ? "Daily digest" : "Immediate alerts";
    toast(`${label} ${value ? "enabled" : "disabled"}.`);
    router.refresh();
  }

  async function sendTest() {
    setSendingTest(true);
    const result = await sendTestWhatsApp();
    setSendingTest(false);
    if (!result.ok) {
      toast(friendlyError(result.error), "error");
      return;
    }
    toast("Test message sent — check your WhatsApp.");
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
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
            WhatsApp alerts
          </CardTitle>
          <CardDescription>
            Who hears about low stock, out-of-stock hits, and approvals — straight
            to their WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Recipients</Label>
            {recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recipients yet — add a number below.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {recipients.map((number) => (
                  <li
                    key={number}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="inline-flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      {number}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={savingRecipients}
                      onClick={() => removeRecipient(number)}
                      aria-label={`Remove ${number}`}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addRecipient} className="flex gap-2">
              <Input
                type="tel"
                placeholder="+6591234567"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="max-w-xs"
                aria-label="New recipient number"
              />
              <Button type="submit" variant="outline" loading={savingRecipients}>
                <Plus /> Add
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              International format with country code, e.g. +65 for Singapore.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Daily 8:00 SGT digest</p>
                <p className="text-xs text-muted-foreground">
                  One morning message with everything below reorder point.
                </p>
              </div>
              <Switch
                checked={digestEnabled}
                onCheckedChange={(v) => toggleSetting("digest_enabled", v)}
                aria-label="Daily digest"
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">
                  Immediate alerts: out-of-stock &amp; approvals
                </p>
                <p className="text-xs text-muted-foreground">
                  Pinged the moment an item hits zero or a checkout needs approval.
                </p>
              </div>
              <Switch
                checked={alertsEnabled}
                onCheckedChange={(v) => toggleSetting("alerts_enabled", v)}
                aria-label="Immediate alerts"
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={sendTest}
              loading={sendingTest}
            >
              <Send /> Send test message
            </Button>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              No Twilio configured yet? Alerts are skipped silently; use
              Copy-as-WhatsApp on the Reorder page.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            Departments
          </CardTitle>
          <CardDescription>
            Orders and requests ask &ldquo;which department is this for?&rdquo; —
            these are the choices, and consumption reports group by them.
            Remove all entries to skip the question.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {zones.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No departments configured — orders and requests won&apos;t ask.
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
              aria-label="New department"
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
