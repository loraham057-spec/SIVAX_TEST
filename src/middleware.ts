import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/middleware";

const PUBLIC_ROUTES = ["/login", "/offline"];

// Admin-only page prefixes. Kept empty on purpose: every admin surface is
// currently guarded server-side in its own route handler. As long as this is
// empty the middleware must NOT query the users table — that lookup ran on
// every navigation, on the critical path of the first render, to decide
// nothing. Re-add the role fetch below if this list ever gains an entry.
const ADMIN_ROUTES: string[] = [];

// ─── JWT local validation (avoids network round-trip on every navigation) ───
//
// supabase.auth.getUser() makes an HTTP call to the Supabase Auth server on
// every middleware invocation — adding 200ms–5s of latency to each page
// navigation. Instead, we decode the JWT from the cookie and check its
// expiry locally. We only call getUser() when:
//   1. No valid JWT is found, OR
//   2. The JWT hasn't been server-validated in the last 5 minutes (stale check)
//
// The stale-check timestamp is stored in a short-lived cookie so it survives
// navigations within the same browser session.

const AUTH_VERIFIED_COOKIE = "diav1_auth_verified_at";
const AUTH_VERIFIED_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Extract and locally validate the JWT from Supabase SSR cookies.
 * Returns true if the JWT exists and has not expired.
 */
function hasValidJwtLocally(request: NextRequest): boolean {
  // Supabase SSR stores the session in a cookie named sb-<ref>-auth-token.
  // The cookie value is a URL-encoded JSON string containing access_token.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const projectRef = supabaseUrl.replace("https://", "").split(".")[0];
  const authCookieName = `sb-${projectRef}-auth-token`;

  const cookieValue = request.cookies.get(authCookieName)?.value;
  if (!cookieValue) return false;

  try {
    // The cookie value is URL-encoded JSON: {"access_token":"eyJ...","refresh_token":"...","..."}
    const decoded = decodeURIComponent(cookieValue);
    const parsed = JSON.parse(decoded);
    const accessToken = parsed?.access_token;
    if (!accessToken) return false;

    // Decode the JWT payload (no signature verification — that's the server's job
    // during the periodic stale check). We only check expiry here.
    const parts = accessToken.split(".");
    if (parts.length !== 3) return false;

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8")
    );

    // Check exp claim (Unix timestamp in seconds)
    const exp = payload?.exp;
    if (!exp) return false;

    const now = Math.floor(Date.now() / 1000);
    // Add 30s clock skew tolerance
    return exp > now + 30;
  } catch {
    return false;
  }
}

/**
 * Check if the session was recently server-validated (within TTL).
 */
function wasRecentlyVerified(request: NextRequest): boolean {
  const verifiedAt = request.cookies.get(AUTH_VERIFIED_COOKIE)?.value;
  if (!verifiedAt) return false;
  const timestamp = parseInt(verifiedAt, 10);
  if (isNaN(timestamp)) return false;
  return Date.now() - timestamp < AUTH_VERIFIED_TTL_MS;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(route + "/")) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    // Actifs statiques publics de public/. Sans cette sortie, une requete
    // de fond de carte ou du service worker traverse l authentification :
    // elle paie un aller-retour supabase.auth.getUser(), et si la session
    // n est pas valide a cet instant elle part sur /login. Le fetch recoit
    // alors du HTML, res.json() echoue, et la carte reste vide sans que
    // rien d autre ne casse.
    pathname.startsWith("/geo/") ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json"
  ) {
    return NextResponse.next();
  }

  // ─── Fast path: JWT is locally valid AND was recently server-verified ───
  // Skip the network call entirely. The response still carries cookies so
  // Supabase's refresh logic continues to work on the client.
  if (hasValidJwtLocally(request) && wasRecentlyVerified(request)) {
    const response = NextResponse.next({ request });
    // Preserve existing cookies
    request.cookies.getAll().forEach((c) => response.cookies.set(c));
    return response;
  }

  // ─── Slow path: need server validation ────────────────────────────────
  const { supabase, getResponse } = createSupabaseMiddlewareClient(request);

  // Use getUser() instead of getSession() for secure JWT validation.
  // getUser() verifies the JWT with the Supabase server and returns null
  // if the token is expired, revoked, or malformed.
  const { data: { user }, error } = await supabase.auth.getUser();

  if (!user || error) {
    const redirectUrl = request.nextUrl.clone();
    const authUnavailable = error?.name === "AuthRetryableFetchError";
    redirectUrl.pathname = authUnavailable ? "/offline" : "/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("redirect", pathname);
    if (!authUnavailable && error) {
      redirectUrl.searchParams.set("reason", "session-timeout");
    }
    const redirectResponse = NextResponse.redirect(redirectUrl);
    getResponse().cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    // Clear the verified cookie on auth failure
    redirectResponse.cookies.delete(AUTH_VERIFIED_COOKIE);
    return redirectResponse;
  }

  if (ADMIN_ROUTES.some((route) => pathname.startsWith(route))) {
    const { data: userProfile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    if (userProfile?.role !== "admin") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      return NextResponse.redirect(redirectUrl);
    }
  }

  // ─── Mark session as server-verified ──────────────────────────────────
  const response = getResponse();
  response.cookies.set(AUTH_VERIFIED_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: AUTH_VERIFIED_TTL_MS / 1000,
    path: "/",
  });
  return response;
}

export const config = {
  // `geojson` et `js` ne sont PAS couverts par `json` : l ancre du point exige
  // un point juste avant, donc "rdc_provinces.geojson" et "sw.js" traversaient
  // le middleware. C etaient les deux seuls fichiers de public/ dans ce cas.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|geojson|js)$).*)"],
};
