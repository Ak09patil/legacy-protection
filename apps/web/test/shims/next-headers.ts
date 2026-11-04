/** In-memory stand-ins for next/headers, so server code can be tested without a running Next.js. */
const jar = new Map<string, string>();
export const testCookies = jar;
export async function cookies() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  };
}
export async function headers() {
  return new Map([["user-agent", "vitest"]]);
}
