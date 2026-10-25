/** A variable global setup exports to workers (they inherit its environment). */
export function requiredEnv(name: `PLAYWRIGHT_${string}`): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; did global-setup.ts run?`);
  return value;
}
