/**
 * Paths reachable WITHOUT an authenticated session. Everything else is gated by
 * the middleware (redirected to /login). Kept pure so it is unit-testable apart
 * from the Next.js middleware runtime. Static assets are excluded by the
 * middleware `matcher`, not here.
 *
 * `/auth` is reserved (and kept public) for future email-confirm / password-reset
 * / magic-link callback flows even though no such route exists yet.
 */
const PUBLIC_PREFIXES = ["/login", "/auth"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
