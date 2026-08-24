"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, ClaimStatus } from "@/lib/types";

export interface ClaimLineInput {
  description: string;
  /** Whole cents, so the arithmetic can't drift. */
  amount_cents: number;
}

const BUCKET = "claim-receipts";

/** Somebody bought it themselves. Money only — nothing arrived in a store
 * room, so the stock ledger is not involved. */
export async function createClaim(params: {
  zone: string | null;
  reason: string;
  lines: ClaimLineInput[];
}): Promise<ActionResult<{ claim_id: string; total_cents: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_claim", {
    p_zone: params.zone,
    p_reason: params.reason,
    p_lines: params.lines,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders");
  return {
    ok: true,
    data: data as { claim_id: string; total_cents: number },
  };
}

/** Correct it while it's still yours to correct — the same rule an order
 * follows. Once it's been settled the numbers are somebody's accounts. */
export async function editClaim(params: {
  claimId: string;
  zone: string | null;
  reason: string;
  lines: ClaimLineInput[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_claim", {
    p_claim_id: params.claimId,
    p_zone: params.zone,
    p_reason: params.reason,
    p_lines: params.lines,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/orders");
  revalidatePath("/admin/claims");
  return { ok: true, data: undefined };
}

export async function cancelClaim(claimId: string): Promise<ActionResult> {
  const supabase = await createClient();
  // The rows cascade; the files don't, so they go first. A leftover receipt
  // for a claim that no longer exists is somebody's shopping still sitting
  // in storage.
  const { data: receipts } = await supabase
    .from("claim_receipts")
    .select("path")
    .eq("claim_id", claimId);
  const paths = ((receipts ?? []) as { path: string }[]).map((r) => r.path);

  const { error } = await supabase.rpc("cancel_claim", { p_claim_id: claimId });
  if (error) return { ok: false, error: error.message };

  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  revalidatePath("/orders");
  revalidatePath("/admin/claims");
  return { ok: true, data: undefined };
}

/** Procurement settles it: paid, or declined with a reason. */
export async function setClaimStatus(params: {
  claimId: string;
  status: ClaimStatus;
  adminNote?: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_claim_status", {
    p_claim_id: params.claimId,
    p_status: params.status,
    p_admin_note: params.adminNote?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/claims");
  revalidatePath("/orders");
  return { ok: true, data: undefined };
}

/**
 * Receipts go into a private bucket, unlike item and request photos. A
 * receipt carries a name, often an address and sometimes the last four
 * digits of a card, so there is deliberately no public URL to leak.
 */
export async function uploadReceipt(
  claimId: string,
  formData: FormData
): Promise<ActionResult<{ path: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const file = formData.get("receipt") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file selected." };
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: "A receipt must be under 10MB." };
  }
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) {
    return { ok: false, error: "Receipts must be a photo or a PDF." };
  }

  const ext =
    file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    (isPdf ? "pdf" : "jpg");
  // The first path segment is the owner, which is the whole of the storage
  // policy's check.
  const path = `${user.id}/${claimId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error } = await supabase
    .from("claim_receipts")
    .insert({ claim_id: claimId, path, file_name: file.name });
  if (error) {
    // Don't leave the file behind if its row didn't land.
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: error.message };
  }

  revalidatePath("/orders");
  revalidatePath("/admin/claims");
  return { ok: true, data: { path } };
}

export async function removeReceipt(
  receiptId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: receipt } = await supabase
    .from("claim_receipts")
    .select("path")
    .eq("id", receiptId)
    .maybeSingle();

  const { error } = await supabase
    .from("claim_receipts")
    .delete()
    .eq("id", receiptId);
  if (error) return { ok: false, error: error.message };

  const path = (receipt as { path: string } | null)?.path;
  if (path) await supabase.storage.from(BUCKET).remove([path]);

  revalidatePath("/orders");
  revalidatePath("/admin/claims");
  return { ok: true, data: undefined };
}

/**
 * A short-lived link to one receipt, minted only for someone the read policy
 * already lets see the claim. Nothing in the app ever holds a permanent URL.
 */
export async function receiptUrl(path: string): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 5);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { url: data.signedUrl } };
}
