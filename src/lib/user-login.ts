/**
 * Department teams sign in with their four-digit User ID. Supabase Auth needs
 * an email address internally, so each ID maps to a deterministic address on
 * a non-routable subdomain — it is never shown to anyone and never receives
 * mail. Super admins and procurement keep real email logins.
 */
export const ID_LOGIN_DOMAIN = "ids.mathvision.com.sg";

export function isUserId(input: string): boolean {
  return /^[0-9]{4}$/.test(input.trim());
}

export function idToLoginEmail(userNo: number | string): string {
  return `${String(userNo).trim()}@${ID_LOGIN_DOMAIN}`;
}

export function isIdLoginEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().endsWith(`@${ID_LOGIN_DOMAIN}`));
}
