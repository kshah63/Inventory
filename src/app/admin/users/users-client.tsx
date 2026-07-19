"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  Lock,
  MonitorSmartphone,
  Pencil,
  Phone,
  Plus,
  UserPlus,
  Copy,
  Check,
} from "lucide-react";
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
  createKioskDevice,
  createLoginUser,
  createPinOnlyStaff,
  resetUserPassword,
  setUserPin,
  updateUser,
} from "@/lib/actions/users";
import type { Location, Role } from "@/lib/types";

export interface UserListEntry {
  id: string;
  full_name: string;
  role: Role;
  department: string | null;
  phone: string | null;
  has_pin: boolean;
  kiosk_location_id: string | null;
  is_active: boolean;
}

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super admin",
  procurement: "Procurement",
  staff: "Staff",
  kiosk: "Kiosk device",
};

const ROLE_BADGE: Record<Role, "default" | "secondary" | "outline" | "warning"> = {
  super_admin: "default",
  procurement: "warning",
  staff: "secondary",
  kiosk: "outline",
};

type DialogKind =
  | { kind: "none" }
  | { kind: "add-login" }
  | { kind: "add-staff" }
  | { kind: "add-kiosk" }
  | { kind: "edit"; user: UserListEntry }
  | { kind: "pin"; user: UserListEntry }
  | { kind: "temp-password"; label: string; password: string };

export function UsersClient({
  users,
  locations,
  selfId,
}: {
  users: UserListEntry[];
  locations: Location[];
  selfId: string;
}) {
  const [dialog, setDialog] = React.useState<DialogKind>({ kind: "none" });
  const [showInactive, setShowInactive] = React.useState(false);

  const visible = users.filter((u) => showInactive || u.is_active);
  const people = visible.filter((u) => u.role !== "kiosk");
  const kiosks = visible.filter((u) => u.role === "kiosk");
  const locationName = (id: string | null) =>
    locations.find((l) => l.id === id)?.name ?? "—";

  const close = () => setDialog({ kind: "none" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDialog({ kind: "add-login" })}>
          <UserPlus /> Add login user
        </Button>
        <Button variant="outline" onClick={() => setDialog({ kind: "add-staff" })}>
          <Plus /> Add staff member (PIN only)
        </Button>
        <Button variant="outline" onClick={() => setDialog({ kind: "add-kiosk" })}>
          <MonitorSmartphone /> Add kiosk device
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
              <TableHead>Role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>WhatsApp</TableHead>
              <TableHead>Kiosk PIN</TableHead>
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
                </TableCell>
                <TableCell>
                  <Badge variant={ROLE_BADGE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.department ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {u.phone ? (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" /> {u.phone}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {u.has_pin ? (
                    <Badge variant="success">Set</Badge>
                  ) : (
                    <Badge variant="outline">No PIN</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: "pin", user: u })}
                      title="Set kiosk PIN"
                    >
                      <KeyRound /> PIN
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: "edit", user: u })}
                      title="Edit"
                    >
                      <Pencil /> Edit
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {people.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No users yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          Kiosk devices (one per store room)
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Store room</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kiosks.map((u) => (
              <TableRow key={u.id} className={u.is_active ? "" : "opacity-50"}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2">
                    <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
                    {u.full_name}
                  </span>
                </TableCell>
                <TableCell>
                  {u.kiosk_location_id ? (
                    locationName(u.kiosk_location_id)
                  ) : (
                    <Badge variant="destructive">No location!</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ kind: "edit", user: u })}
                  >
                    <Pencil /> Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {kiosks.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  No kiosk devices yet — add one per store room, sign the tablet
                  in with it, and mount it by the door.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <AddLoginDialog
        open={dialog.kind === "add-login"}
        onClose={close}
        onTempPassword={(label, password) =>
          setDialog({ kind: "temp-password", label, password })
        }
      />
      <AddStaffDialog open={dialog.kind === "add-staff"} onClose={close} />
      <AddKioskDialog
        open={dialog.kind === "add-kiosk"}
        onClose={close}
        locations={locations}
        onTempPassword={(label, password) =>
          setDialog({ kind: "temp-password", label, password })
        }
      />
      {dialog.kind === "edit" && (
        <EditUserDialog
          user={dialog.user}
          locations={locations}
          isSelf={dialog.user.id === selfId}
          onClose={close}
          onTempPassword={(label, password) =>
            setDialog({ kind: "temp-password", label, password })
          }
        />
      )}
      {dialog.kind === "pin" && <PinDialog user={dialog.user} onClose={close} />}
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
  onTempPassword,
}: {
  open: boolean;
  onClose: () => void;
  onTempPassword: (label: string, password: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [form, setForm] = React.useState({
    email: "",
    fullName: "",
    role: "staff" as Exclude<Role, "kiosk">,
    department: "",
    phone: "",
    pin: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.pin && !/^[0-9]{4,6}$/.test(form.pin)) {
      toast("PIN must be 4–6 digits.", "error");
      return;
    }
    setLoading(true);
    const result = await createLoginUser({
      email: form.email,
      fullName: form.fullName,
      role: form.role,
      department: form.department || undefined,
      phone: form.phone || undefined,
      pin: form.pin || undefined,
    });
    setLoading(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    onTempPassword(form.email, result.data.tempPassword);
    setForm({ email: "", fullName: "", role: "staff", department: "", phone: "", pin: "" });
    router.refresh();
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Add login user</DialogTitle>
      <DialogDescription>
        Creates an account for the web app. You&apos;ll get a one-time temporary
        password to pass on — they can change it in Settings.
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
        <div className="space-y-1.5">
          <Label htmlFor="nu-email">Email</Label>
          <Input
            id="nu-email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nu-role">Role</Label>
            <Select
              id="nu-role"
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as Exclude<Role, "kiosk"> })
              }
            >
              <option value="staff">Staff</option>
              <option value="procurement">Procurement</option>
              <option value="super_admin">Super admin</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-dept">Department</Label>
            <Input
              id="nu-dept"
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nu-phone">WhatsApp number</Label>
            <Input
              id="nu-phone"
              placeholder="+65…"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nu-pin">Kiosk PIN (optional)</Label>
            <Input
              id="nu-pin"
              inputMode="numeric"
              placeholder="4–6 digits"
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
              maxLength={6}
            />
          </div>
        </div>
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

function AddStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [form, setForm] = React.useState({ fullName: "", phone: "", pin: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[0-9]{4,6}$/.test(form.pin)) {
      toast("PIN must be 4–6 digits.", "error");
      return;
    }
    setLoading(true);
    const result = await createPinOnlyStaff({
      fullName: form.fullName,
      phone: form.phone || undefined,
      pin: form.pin,
    });
    setLoading(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`${form.fullName} added — they can use the kiosk right away.`);
    setForm({ fullName: "", phone: "", pin: "" });
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Add staff member (kiosk only)</DialogTitle>
      <DialogDescription>
        For people who only use the store-room tablets — no email login needed.
      </DialogDescription>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="ns-name">Full name</Label>
          <Input
            id="ns-name"
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ns-phone">WhatsApp number</Label>
          <Input
            id="ns-phone"
            placeholder="+65…"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ns-pin">Kiosk PIN</Label>
          <Input
            id="ns-pin"
            required
            inputMode="numeric"
            placeholder="4–6 digits"
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
            maxLength={6}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Add staff member
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function AddKioskDialog({
  open,
  onClose,
  locations,
  onTempPassword,
}: {
  open: boolean;
  onClose: () => void;
  locations: Location[];
  onTempPassword: (label: string, password: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [locationId, setLocationId] = React.useState(locations[0]?.id ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const location = locations.find((l) => l.id === locationId);
    if (!location) {
      toast("Pick a store room.", "error");
      return;
    }
    setLoading(true);
    const result = await createKioskDevice({
      email,
      locationId,
      locationName: location.name,
    });
    setLoading(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    onTempPassword(email, result.data.tempPassword);
    setEmail("");
    router.refresh();
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Add kiosk device</DialogTitle>
      <DialogDescription>
        One per store room. Sign the wall tablet in with this account — it can
        only browse the catalog and record checkouts, nothing else.
      </DialogDescription>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="nk-email">Device email</Label>
          <Input
            id="nk-email"
            type="email"
            required
            placeholder="kiosk-level8@mathvision.sg"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nk-loc">Store room</Label>
          <Select id="nk-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Create device account
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  locations,
  isSelf,
  onClose,
  onTempPassword,
}: {
  user: UserListEntry;
  locations: Location[];
  isSelf: boolean;
  onClose: () => void;
  onTempPassword: (label: string, password: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [form, setForm] = React.useState({
    fullName: user.full_name,
    department: user.department ?? "",
    phone: user.phone ?? "",
    role: user.role,
    isActive: user.is_active,
    kioskLocationId: user.kiosk_location_id ?? "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const result = await updateUser({
      userId: user.id,
      fullName: form.fullName,
      department: form.department,
      phone: form.phone,
      role: form.role,
      isActive: form.isActive,
      kioskLocationId:
        user.role === "kiosk" && form.kioskLocationId ? form.kioskLocationId : undefined,
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

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Edit {user.full_name}</DialogTitle>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="eu-name">Full name</Label>
          <Input
            id="eu-name"
            required
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </div>
        {user.role !== "kiosk" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="eu-dept">Department</Label>
                <Input
                  id="eu-dept"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eu-phone">WhatsApp number</Label>
                <Input
                  id="eu-phone"
                  placeholder="+65…"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eu-role">Role</Label>
              <Select
                id="eu-role"
                value={form.role}
                disabled={isSelf}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                <option value="staff">Staff</option>
                <option value="procurement">Procurement</option>
                <option value="super_admin">Super admin</option>
              </Select>
              {isSelf && (
                <p className="text-xs text-muted-foreground">
                  You can&apos;t change your own role.
                </p>
              )}
            </div>
          </>
        )}
        {user.role === "kiosk" && (
          <div className="space-y-1.5">
            <Label htmlFor="eu-loc">Store room</Label>
            <Select
              id="eu-loc"
              value={form.kioskLocationId}
              onChange={(e) => setForm({ ...form, kioskLocationId: e.target.value })}
            >
              <option value="">— not set —</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <label className="flex items-center gap-2 pt-1 text-sm">
          <Switch
            checked={form.isActive}
            onCheckedChange={(v) => setForm({ ...form, isActive: v })}
            disabled={isSelf}
          />
          Active {user.role !== "kiosk" && "(deactivated users keep their history)"}
        </label>
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={resetPassword}
            loading={resetting}
            title="Generate a new temporary password"
          >
            <Lock /> Reset password
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function PinDialog({ user, onClose }: { user: UserListEntry; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [pin, setPin] = React.useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[0-9]{4,6}$/.test(pin)) {
      toast("PIN must be 4–6 digits.", "error");
      return;
    }
    setLoading(true);
    const result = await setUserPin(user.id, pin);
    setLoading(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`PIN ${user.has_pin ? "updated" : "set"} for ${user.full_name}.`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onClose={onClose} className="max-w-sm">
      <DialogTitle>
        {user.has_pin ? "Reset" : "Set"} kiosk PIN — {user.full_name}
      </DialogTitle>
      <DialogDescription>
        4–6 digits. They&apos;ll use it with their name on the store-room tablets.
      </DialogDescription>
      <form onSubmit={submit} className="space-y-3">
        <Input
          autoFocus
          inputMode="numeric"
          placeholder="e.g. 4821"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          maxLength={6}
          className="text-center text-lg tracking-[0.4em]"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save PIN
          </Button>
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
        Share this with <strong>{label}</strong> now — it won&apos;t be shown
        again. They should change it after signing in (Settings → Account).
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
