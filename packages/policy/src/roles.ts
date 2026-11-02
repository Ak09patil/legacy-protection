/**
 * Who can do what. A static table, not per-user data, so no role can grant
 * itself more access. INV-08, INV-17.
 */

export type Role = "OWNER" | "TRUSTED_CONTACT" | "EXECUTOR" | "SYSTEM_EXECUTOR";

export type Permission =
  | "PLAN_EDIT"
  | "PLAN_CONFIRM"
  | "PAYEE_REGISTER"
  | "HOLD_RELEASE"
  | "CHECKIN"
  | "TRIGGER_CONFIRM"
  | "VIEW_CATALOGUE"
  | "VIEW_CONTENT"
  | "VIEW_EXECUTOR_PACKAGE"
  | "RECEIVE_PLAN_FUNDS"
  | "EXECUTE_PLAN_STEP";

const MATRIX: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: new Set<Permission>([
    "PLAN_EDIT",
    "PLAN_CONFIRM",
    "PAYEE_REGISTER",
    "HOLD_RELEASE",
    "CHECKIN",
    "VIEW_CATALOGUE",
    "VIEW_CONTENT",
  ]),
  TRUSTED_CONTACT: new Set<Permission>(["TRIGGER_CONFIRM", "VIEW_CATALOGUE"]),
  EXECUTOR: new Set<Permission>(["VIEW_CATALOGUE", "VIEW_EXECUTOR_PACKAGE"]),
  SYSTEM_EXECUTOR: new Set<Permission>(["EXECUTE_PLAN_STEP"]),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

/** Content access for non-owners only when the owner opted in for that role. */
export function canViewContent(role: Role, ownerAllowedContentFor: readonly Role[]): boolean {
  if (role === "OWNER") return true;
  if (role === "SYSTEM_EXECUTOR") return false;
  return ownerAllowedContentFor.includes(role);
}

export const ROLES: readonly Role[] = Object.keys(MATRIX) as Role[];
