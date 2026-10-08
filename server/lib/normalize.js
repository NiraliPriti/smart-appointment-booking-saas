export const normEmail = (e) => (e ? e.trim().toLowerCase() : null);

/** Keep digits and a single leading "+", so "+91 98765-43210" and "+919876543210" dedupe together. */
export function normPhone(p) {
  if (!p) return null;
  const t = p.trim();
  const digits = t.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (t.startsWith('+') ? '+' : '') + digits;
}
