/**
 * Normalise a user-supplied site ("https://www.GitHub.com/login",
 * "github.com", "GitHub.com:443") to a bare lowercase host ("github.com").
 */
export function normalizeHost(site: string): string {
  let s = site.trim().toLowerCase();
  if (!s) throw new Error("site must not be empty");
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname;
  } catch {
    // Not URL-shaped (e.g. "My Bank App"): use the label itself.
    return site.trim().toLowerCase().replace(/\s+/g, " ");
  }
  host = host.replace(/\.$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

/**
 * True if `requested` is `stored` or a subdomain of it (dot-boundary match,
 * so "evilgithub.com" never matches "github.com").
 */
export function hostMatches(stored: string, requested: string): boolean {
  return requested === stored || requested.endsWith(`.${stored}`);
}

/** Profile site scoping: "*" allows everything, otherwise host allowlist. */
export function siteAllowed(allow: readonly string[], host: string): boolean {
  return allow.some((a) => a === "*" || hostMatches(normalizeHost(a), host));
}
