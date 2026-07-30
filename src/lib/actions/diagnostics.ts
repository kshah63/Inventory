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
  /** Result of an authenticated call to the Auth admin API. */
  liveOk: boolean;
  liveStatus: number | null;
  /** Result of the same key against the database API — separates "this key
   * isn't valid for this project" from "Auth won't accept this key kind". */
  restOk: boolean;
  restStatus: number | null;
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

  // Probe 1 — Auth admin API (what password resets and sign-out-all use).
  let liveOk = false;
  let liveStatus: number | null = null;
  // Probe 2 — database API. Any key valid for this project is accepted here,
  // so a 401 means the key doesn't belong to this project at all.
  let restOk = false;
  let restStatus: number | null = null;

  if (url && key) {
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    try {
      const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1`, {
        headers,
        cache: "no-store",
      });
      liveStatus = res.status;
      liveOk = res.ok;
    } catch {
      liveStatus = null;
    }
    try {
      const res = await fetch(`${url}/rest/v1/settings?select=key&limit=1`, {
        headers,
        cache: "no-store",
      });
      restStatus = res.status;
      restOk = res.ok;
    } catch {
      restStatus = null;
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
  } else if ((liveStatus === 401 || liveStatus === 403) && restOk) {
    verdict =
      `The key is valid for project "${projectRef}", but Supabase Auth won't accept this key type for admin calls. Fix: in Supabase → Project Settings → API Keys, open Legacy API keys and copy the service_role key (the long eyJ… one), put that in SUPABASE_SERVICE_ROLE_KEY, and redeploy. If legacy keys are disabled, enable them first.`;
  } else if (liveStatus === 401 || liveStatus === 403) {
    verdict =
      `Supabase rejected this key for project "${projectRef}" everywhere, so it isn't this project's key — most likely it was copied from your other Supabase project, or truncated on paste. Copy the secret key from the ${projectRef} project and redeploy.`;
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
      restOk,
      restStatus,
      verdict,
    },
  };
}
