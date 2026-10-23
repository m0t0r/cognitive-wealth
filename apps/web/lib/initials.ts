/** Up to two letters for an avatar fallback: from the name, else the email. */
export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`
      : (words[0] ?? email).slice(0, 2);
  return letters.toUpperCase();
}
