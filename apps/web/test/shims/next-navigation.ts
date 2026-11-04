export class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
export function redirect(to: string): never {
  throw new RedirectError(to);
}
export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
