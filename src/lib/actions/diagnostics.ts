"use server";

import { getProfile } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

export interface ConfigCheck {
  /** Supabase project ref parsed out of NEXT_PUBLIC_SUPABASE_URL. */
  projectRef: string | null;
  keyConfigured: boolean;
  /** What kind of key was pasted, judged by its shape. */
  keyKind: "service_role" | "anon" | "new_secret" | "new_publishable" | "unknown";
  /** Project the key itself claims to belong to (legacy JWT keys only). */
  keyRef: string | null;
  /** Whether the key's project matches the URL's project (null = can't tell). */
  refMatch: boolean | null;
  /** Result of an actual authenticated call to Supabase. */
  liveOk: boolean;
  liveStatus: number | null;
  /** Plain-English verdict with the fix. */
  verdict: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Diagnose the Supabase service-role configuration. Reports the shape of the
 * key and whether Supabase accepts it — never the key itself. */
export async function checkSupabaseConfig(): Promise<ActionResult<ConfigCheck>> {
  const profile = await getProfile();
  if (!profile || profile.role !== "super_admin") {
    return { ok: false, error: "You don't have permission to run this check." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  const projectRef = /^https:\/\/([a-z0-9]+)\.supabase\./i.exec(url)?.[1] ?? null;

  let keyKind: ConfigCheck["keyKind"] = "unknown";
  let keyRef: string | null = null;

  if (key.startsWith("sb_secret_")) {
    keyKind = "new_secret";
  } else if (key.startsWith("sb_publishable_")) {
    keyKind = "new_publishable";
  } else if (key.startsWith("eyJ")) {
    const payload = decodeJwtPayload(key);
    const role = typeof payload?.role === "string" ? payload.role : null;
    keyRef = typeof payload?.ref === "string" ? payload.ref : null;
    if (role === "service_role") keyKind = "service_role";
    else if (role === "anon") keyKind = "anon";
  }

  const refMatch =
    projectRef && keyRef ? projectRef.toLowerCase() === keyRef.toLowerCase() : null;

  // Live check: this endpoint only answers to a service-role credential.
  let liveOk = false;
  let liveStatus: number | null = null;
  if (url && key) {
    try {
      const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      liveStatus = res.status;
      liveOk = res.ok;
    } catch {
      liveStatus = null;
    }
  }

  let verdict: string;
  if (!url) {
    verdict = "NEXT_PUBLIC_SUPABASE_URL is not set in this deployment.";
  } else if (!key) {
    verdict =
      "SUPABASE_SERVICE_ROLE_KEY is not set in this deployment. Add it in Vercel → Settings → Environment Variables (Production), then redeploy.";
  } else if (keyKind === "anon" || keyKind === "new_publishable") {
    verdict =
      "That's the public key, not the secret one. In Supabase → Project Settings → API keys, copy the service_role (or sb_secret_…) key instead, then redeploy.";
  } else if (refMatch === false) {
    verdict = `This key belongs to Supabase project "${keyRef}", but the app points at "${projectRef}" — it's the other project's key. Copy the key from the ${projectRef} project, then redeploy.`;
  } else if (liveOk) {
    verdict = "All good — Supabase accepts this key. Password resets and sign-out-all will work.";
  } else if (liveStatus === 401 || liveStatus === 403) {
    verdict =
      "Supabase rejected this key. If your project has migrated to the new API keys, legacy keys may be disabled — use the sb_secret_… key. Otherwise re-copy the service_role key (no spaces or line breaks) and redeploy.";
  } else if (liveStatus === null) {
    verdict = "Couldn't reach Supabase at all — check NEXT_PUBLIC_SUPABASE_URL and that the project isn't paused.";
  } else {
    verdict = `Supabase replied with HTTP ${liveStatus}. Re-copy the service_role key and redeploy.`;
  }

  return {
    ok: true,
    data: {
      projectRef,
      keyConfigured: key.length > 0,
      keyKind,
      keyRef,
      refMatch,
      liveOk,
      liveStatus,
      verdict,
    },
  };
}
