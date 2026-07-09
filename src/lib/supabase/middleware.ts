import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Refresh the Supabase auth session on every request and redirect
 * unauthenticated visitors of protected routes to /login. Role-level checks
 * happen in the route-group layouts (and, authoritatively, in RLS). */
export async function updateSession(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // A hard crash here would 500 the entire site (MIDDLEWARE_INVOCATION_FAILED)
  // with no explanation — surface the real problem instead.
  if (!url || !anonKey) {
    return new NextResponse(
      "Configuration error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "must be set in the deployment's environment variables (Vercel → Project → " +
        "Settings → Environment Variables), then redeploy. See docs/DEPLOYMENT.md §2.",
      { status: 500, headers: { "content-type": "text/plain" } }
    );
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not add logic between client creation and getUser() —
  // the call refreshes expired tokens. A network failure (e.g. wrong
  // Supabase URL) must not crash the middleware; treat it as signed-out.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" ||
    path.startsWith("/auth") ||
    path.startsWith("/api/cron") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
