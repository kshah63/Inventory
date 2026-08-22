"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock, LogOut, Pencil, Phone, UserPlus, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import {
  createLoginForExistingUser,
  createLoginUser,
  resetUserPassword,
  signOutUserEverywhere,
  updateUser,
} from "@/lib/actions/users";
import type { Role } from "@/lib/types";

export interface UserListEntry {
  id: string;
  full_name: string;
  role: Role;
  user_no: number | null;
  phone: string | null;
  is_active: boolean;
  /** False when the profile has no account in Supabase Auth — they can't
   * sign in yet and have no password to reset. */
  has_login: boolean;
  /** The ID they actually type at sign-in, read off their login address.
   * Normally the same as user_no; when it isn't, user_no is only a label and
   * this is the number that works. */
  signs_in_as: number | null;
}

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  procurement: "Procurement",
  staff: "Department Admin",
  dept_head: "Department Head",
  kiosk: "Kiosk device",
};

const ROLE_BADGE: Record<Role, "default" | "secondary" | "outline" | "warning"> = {
  super_admin: "default",
  procurement: "warning",
  staff: "secondary",
  dept_head: "warning",
  kiosk: "outline",
};

type DialogKind =
  | { kind: "none" }
  | { kind: "add-login" }
  | { kind: "edit"; user: UserListEntry }
  | { kind: "temp-password"; label: string; password: string };

export function UsersClient({
  users,
  selfId,
  nextUserNo,
}: {
  users: UserListEntry[];
  selfId: string;
  nextUserNo: number;
}) {
  const [dialog, setDialog] = React.useState<DialogKind>({ kind: "none" });
  const [showInactive, setShowInactive] = React.useState(false);

  const visible = users.filter((u) => showInactive || u.is_active);
  // Retired kiosk devices (kept only for their ledger history) stay hidden.
  const people = visible.filter((u) => u.role !== "kiosk");

  const close = () => setDialog({ kind: "none" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDialog({ kind: "add-login" })}>
          <UserPlus /> Add user
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show deactivated
        </label>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">People</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((u) => (
              <TableRow key={u.id} className={u.is_active ? "" : "opacity-50"}>
                <TableCell className="font-medium">
                  {u.full_name}
                  {u.id === selfId && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                  )}
                  {!u.is_active && (
                    <Badge variant="secondary" className="ml-2">
                      Deactivated
                    </Badge>
                  )}
                  {u.is_active && !u.has_login && (
                    <Badge variant="outline" className="ml-2">
                      No login
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {u.user_no ?? "—"}
                  {u.signs_in_as !== null && u.signs_in_as !== u.user_no && (
                    <Badge variant="warning" className="ml-2 font-sans">
                      signs in as {u.signs_in_as}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={ROLE_BADGE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {u.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" /> {u.phone}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ kind: "edit", user: u })}
                    title="Edit"
                  >
                    <Pencil /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {people.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>


      <AddLoginDialog
        open={dialog.kind === "add-login"}
        onClose={close}
        nextUserNo={nextUserNo}
        onTempPassword={(label, password) =>
          setDialog({ kind: "temp-password", label, password })
        }
      />
      {dialog.kind === "edit" && (
        <EditUserDialog
          user={dialog.user}
          isSelf={dialog.user.id === selfId}
          onClose={close}
          onTempPassword={(label, password) =>
            setDialog({ kind: "temp-password", label, password })
          }
        />
      )}
      {dialog.kind === "temp-password" && (
        <TempPasswordDialog label={dialog.label} password={dialog.password} onClose={close} />
      )}
    </div>
  );
}

// ── Dialogs ────────────────────────────────────────────────────────────────

function AddLoginDialog({
  open,
  onClose,
  nextUserNo,
  onTempPassword,
}: {
  open: boolean;
  onClose: () => void;
  nextUserNo: number;
  onTempPassword: (label: string, password: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [form, setForm] = React.useState({
    fullName: "",
    role: "staff" as "staff" | "dept_head",
    userNo: String(nextUserNo),
    phone: "",
  });

  React.useEffect(() => {
    if (open) setForm((f) => ({ ...f, userNo: String(nextUserNo) }));
  }, [open, nextUserNo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[1-9][0-9]{3}$/.test(form.userNo)) {
      toast("User ID must be a four-digit number.", "error");
      return;
    }
    setLoading(true);
    const result = await createLoginUser({
      fullName: form.fullName,
      role: form.role,
      userNo: Number(form.userNo),
      phone: form.phone || undefined,
    });
    setLoading(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    onTempPassword(
      `${form.fullName.trim()} — User ID ${form.userNo}`,
      result.data.tempPassword
    );
    setForm({ fullName: "", role: "staff", userNo: String(nextUserNo), phone: "" });
    router.refresh();
  }
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Add user</DialogTitle>
      <DialogDescription>
        They sign in with their four-digit User ID. You&apos;ll get a one-time
        temporary password to pass on — they can change it in Settings.
      </DialogDescription>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="nu-name">Full name</Label>
          <Input
            id="nu-name"
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nu-role">Role</Label>
            <Select
              id="nu-role"
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as "staff" | "dept_head" })
              }
            >
              <option value="staff">Department Admin</option>
              <option value="dept_head">Department Head</option>
            </Select>
            <p className="text-xs text-muted-foreground">
              Both order the same way. Department Head is held for reporting
              access, which is switched off for now.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-userno">User ID</Label>
            <Input
              id="nu-userno"
              inputMode="numeric"
              maxLength={4}
              value={form.userNo}
              onChange={(e) =>
                setForm({ ...form, userNo: e.target.value.replace(/\D/g, "") })
              }
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nu-phone">Phone number</Label>
          <Input
            id="nu-phone"
            placeholder="+65…"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          The User ID is how they sign in, and it stays with them even when
          they change departments.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Create account
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
function EditUserDialog({
  user,
  isSelf,
  onClose,
  onTempPassword,
}: {
  user: UserListEntry;
  isSelf: boolean;
  onClose: () => void;
  onTempPassword: (label: string, password: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const [creatingLogin, setCreatingLogin] = React.useState(false);
  const backendRole = user.role === "super_admin" || user.role === "procurement";
  // Super admins are protected from each other — only the owner may edit.
  const locked = user.role === "super_admin" && !isSelf;
  const [form, setForm] = React.useState({
    fullName: user.full_name,
    userNo: user.user_no ? String(user.user_no) : "",
    phone: user.phone ?? "",
    role: user.role,
    isActive: user.is_active,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.userNo && !/^[1-9][0-9]{3}$/.test(form.userNo)) {
      toast("User ID must be a four-digit number.", "error");
      return;
    }
    setLoading(true);
    const result = await updateUser({
      userId: user.id,
      fullName: form.fullName,
      phone: form.phone,
      // Back-end-managed roles (procurement / super admin) are never sent —
      // the picker only offers the two department roles.
      role: backendRole ? undefined : (form.role as Role),
      userNo: form.userNo ? Number(form.userNo) : undefined,
      isActive: form.isActive,
    });
    setLoading(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Saved.");
    onClose();
    router.refresh();
  }

  async function createLogin() {
    setCreatingLogin(true);
    const result = await createLoginForExistingUser(user.id);
    setCreatingLogin(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    onTempPassword(result.data.label, result.data.tempPassword);
    router.refresh();
  }

  async function resetPassword() {
    setResetting(true);
    const result = await resetUserPassword(user.id);
    setResetting(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    onTempPassword(user.full_name, result.data.tempPassword);
  }

  async function signOutEverywhere() {
    setRevoking(true);
    const result = await signOutUserEverywhere(user.id);
    setRevoking(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(
      `Sessions revoked — ${user.full_name}'s open tabs lose access when their current token expires. Deactivate for an instant lockout.`
    );
  }

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Edit {user.full_name}</DialogTitle>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="eu-name">Full name</Label>
          <Input
            id="eu-name"
            required
            disabled={locked}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="eu-userno">User ID</Label>
            <Input
              id="eu-userno"
              inputMode="numeric"
              maxLength={4}
              disabled={locked}
              value={form.userNo}
              onChange={(e) =>
                setForm({ ...form, userNo: e.target.value.replace(/\D/g, "") })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eu-phone">Phone number</Label>
            <Input
              id="eu-phone"
              placeholder="+65…"
              disabled={locked}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eu-role">Role</Label>
          {backendRole ? (
            <>
              <Input
                value={user.role === "super_admin" ? "Super admin" : "Procurement"}
                disabled
              />
              <p className="text-xs text-muted-foreground">
                {locked
                  ? "Super admin accounts can only be changed by their owner."
                  : "This role can't be changed here."}
              </p>
            </>
          ) : (
            <Select
              id="eu-role"
              value={form.role}
              disabled={isSelf}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              <option value="staff">Department Admin</option>
              <option value="dept_head">Department Head</option>
            </Select>
          )}
          {!backendRole && (
            <p className="text-xs text-muted-foreground">
              Both order the same way. Department Head is held for reporting
              access, which is switched off for now.
            </p>
          )}
          {isSelf && !backendRole && (
            <p className="text-xs text-muted-foreground">
              You can&apos;t change your own role.
            </p>
          )}
        </div>
        {!user.has_login && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            This person has no login yet, so they can&apos;t sign in and have no
            password to reset. Use <strong>Create login</strong> below — their
            history stays attached.
          </p>
        )}
        <label className="flex items-center gap-2 pt-1 text-sm">
          <Switch
            checked={form.isActive}
            onCheckedChange={(v) => setForm({ ...form, isActive: v })}
            disabled={isSelf || locked}
          />
          Active (deactivated users keep their history)
        </label>
        <DialogFooter className="sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {!locked && !user.has_login && (
              <Button
                type="button"
                variant="ghost"
                onClick={createLogin}
                loading={creatingLogin}
                title="Create a login so this person can sign in"
              >
                <KeyRound /> Create login
              </Button>
            )}
            {!locked && user.has_login && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetPassword}
                  loading={resetting}
                  title="Generate a new temporary password"
                >
                  <Lock /> Reset password
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={signOutEverywhere}
                  loading={revoking}
                  title="Revoke every active session for this user"
                >
                  <LogOut /> Sign out all
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {locked ? "Close" : "Cancel"}
            </Button>
            {!locked && (
              <Button type="submit" loading={loading}>
                Save
              </Button>
            )}
          </div>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
function TempPasswordDialog({
  label,
  password,
  onClose,
}: {
  label: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogTitle>Temporary password</DialogTitle>
      <DialogDescription>
        Give these sign-in details to <strong>{label}</strong> now — the
        password won&apos;t be shown again. They should change it after signing
        in (Settings → Account).
      </DialogDescription>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border bg-muted px-3 py-2.5 font-mono text-base">
          {password}
        </code>
        <Button
          variant="outline"
          size="icon"
          onClick={async () => {
            await navigator.clipboard.writeText(password);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          aria-label="Copy password"
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </Dialog>
  );
}
