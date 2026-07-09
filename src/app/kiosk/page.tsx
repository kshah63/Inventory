import { AlertTriangle } from "lucide-react";
import { createClient, getProfile } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import type { CatalogItem, Category, Location, StaffDirectoryEntry } from "@/lib/types";
import { KioskApp, type KioskStaff } from "./kiosk-app";

export const dynamic = "force-dynamic";

function KioskMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <AlertTriangle className="h-10 w-10 text-warning" />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="max-w-md text-lg text-muted-foreground">{description}</p>
    </div>
  );
}

export default async function KioskPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: locationsData } = await supabase
    .from("locations")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name");
  const locations = (locationsData ?? []) as unknown as Location[];

  // A kiosk device is pinned to its assigned location; admins previewing the
  // kiosk fall back to the first active location (by name).
  const assigned = locations.find((l) => l.id === profile?.kiosk_location_id);
  const location = assigned ?? (profile?.role === "kiosk" ? undefined : locations[0]);

  if (!location) {
    if (locations.length === 0) {
      return (
        <KioskMessage
          title="No locations yet"
          description="There are no active stock locations. Ask an administrator to create one before using the kiosk."
        />
      );
    }
    return (
      <KioskMessage
        title="No location assigned"
        description="This kiosk has no location assigned. Ask an administrator to set one so checkouts land in the right room."
      />
    );
  }

  const [{ data: categoriesData }, { data: itemsData }] = await Promise.all([
    supabase.from("categories").select("id, name, sort_order").order("sort_order"),
    supabase
      .from("items")
      .select("*, category:categories(name), stock_levels(location_id, qty_on_hand)")
      .eq("is_active", true)
      .order("name"),
  ]);
  const categories = (categoriesData ?? []) as unknown as Category[];
  const items = (itemsData ?? []) as unknown as CatalogItem[];

  // Staff list for the picker. The RPC only works for kiosk/admin roles and
  // may error for admin preview accounts — fall back to the safe directory view.
  let staff: KioskStaff[] = [];
  const { data: staffData, error: staffError } = await supabase.rpc("kiosk_get_staff");
  if (!staffError && staffData) {
    staff = staffData as unknown as KioskStaff[];
  } else {
    const { data: directory } = await supabase
      .from("staff_directory")
      .select("id, full_name, department, role, is_active")
      .eq("is_active", true)
      .neq("role", "kiosk")
      .order("full_name");
    staff = ((directory ?? []) as unknown as StaffDirectoryEntry[]).map((d) => ({
      id: d.id,
      full_name: d.full_name,
      department: d.department,
    }));
  }

  return (
    <KioskApp
      locationId={location.id}
      locationName={location.name}
      locations={locations}
      categories={categories}
      items={items}
      staff={staff}
      preview={profile?.role !== "kiosk"}
    />
  );
}
