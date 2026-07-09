import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastToProcurement, composeDigest } from "@/lib/whatsapp";
import type { DigestData } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Daily 8:00am SGT (00:00 UTC) WhatsApp digest — wired up via vercel.json
 * crons. Vercel calls this with `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Service key missing" },
      { status: 500 }
    );
  }

  const { data: digestEnabled } = await admin
    .from("settings")
    .select("value")
    .eq("key", "digest_enabled")
    .single();
  if (digestEnabled?.value === false) {
    return NextResponse.json({ skipped: "digest disabled" });
  }

  const { data, error } = await admin.rpc("get_digest_data");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const digest = data as DigestData;

  // Nothing to say and nothing pending → stay quiet (avoid daily noise).
  if (
    digest.low_stock.length === 0 &&
    digest.open_requests === 0 &&
    digest.pending_approvals === 0
  ) {
    return NextResponse.json({ skipped: "nothing to report" });
  }

  await broadcastToProcurement(composeDigest(digest), "digest");

  return NextResponse.json({
    sent: true,
    low_stock: digest.low_stock.length,
    open_requests: digest.open_requests,
    pending_approvals: digest.pending_approvals,
  });
}
