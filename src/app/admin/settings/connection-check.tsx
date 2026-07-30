"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { checkSupabaseConfig, type ConfigCheck } from "@/lib/actions/diagnostics";

const KEY_KIND_LABEL: Record<ConfigCheck["keyKind"], string> = {
  service_role: "service_role (correct)",
  new_secret: "sb_secret_… (correct)",
  anon: "anon — this is the public key",
  new_publishable: "sb_publishable_… — this is the public key",
  unknown: "unrecognised format",
};

/** Explains why password resets / sign-out-all fail, without ever showing
 * the key. Super admin only. */
export function ConnectionCheck() {
  const [result, setResult] = React.useState<ConfigCheck | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    const res = await checkSupabaseConfig();
    setRunning(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Stethoscope className="h-4 w-4 text-muted-foreground" />
          Connection check
        </CardTitle>
        <CardDescription>
          Password resets and &ldquo;sign out all&rdquo; need the Supabase
          secret key. Run this if they fail — it says exactly what&apos;s wrong
          without revealing the key.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" onClick={run} loading={running}>
          Run check
        </Button>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {result && (
          <div className="space-y-3">
            <div
              className={
                "flex items-start gap-2 rounded-md border p-3 text-sm " +
                (result.liveOk
                  ? "border-success/40 bg-success/10"
                  : "border-destructive/40 bg-destructive/10")
              }
            >
              {result.liveOk ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              )}
              <span>{result.verdict}</span>
            </div>

            <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[11rem_1fr]">
              <dt className="text-muted-foreground">Supabase project</dt>
              <dd className="font-mono">{result.projectRef ?? "— not set —"}</dd>

              <dt className="text-muted-foreground">Secret key</dt>
              <dd>
                {result.keyConfigured ? KEY_KIND_LABEL[result.keyKind] : "not set"}
              </dd>

              {result.keyRef && (
                <>
                  <dt className="text-muted-foreground">Key belongs to</dt>
                  <dd className="font-mono">
                    {result.keyRef}
                    {result.refMatch === false && (
                      <span className="ml-2 font-sans text-destructive">
                        ≠ this app&apos;s project
                      </span>
                    )}
                  </dd>
                </>
              )}

              <dt className="text-muted-foreground">Auth admin API</dt>
              <dd>
                {result.liveStatus === null
                  ? "no response"
                  : `HTTP ${result.liveStatus}${result.liveOk ? " — accepted" : " — rejected"}`}
              </dd>

              <dt className="text-muted-foreground">Database API</dt>
              <dd>
                {result.restStatus === null
                  ? "no response"
                  : `HTTP ${result.restStatus}${
                      result.restOk ? " — accepted (key is valid for this project)" : " — rejected"
                    }`}
              </dd>
            </dl>

            <p className="text-xs text-muted-foreground">
              After changing a variable in Vercel you must redeploy — env
              changes only apply to new builds.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
