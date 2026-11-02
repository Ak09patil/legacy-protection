/**
 * Who can do what. A static table, not per-user data, so no role can grant
 * itself more access. INV-08, INV-17.
 */
export type Role = "OWNER" | "TRUSTED_CONTACT" | "EXECUTOR" | "SYSTEM_EXECUTOR";
export type Permission = "PLAN_EDIT" | "PLAN_CONFIRM" | "PAYEE_REGISTER" | "HOLD_RELEASE" | "CHECKIN" | "TRIGGER_CONFIRM" | "VIEW_CATALOGUE" | "VIEW_CONTENT" | "VIEW_EXECUTOR_PACKAGE" | "RECEIVE_PLAN_FUNDS" | "EXECUTE_PLAN_STEP";
export declare function can(role: Role, permission: Permission): boolean;
/** Content access for non-owners only when the owner opted in for that role. */
export declare function canViewContent(role: Role, ownerAllowedContentFor: readonly Role[]): boolean;
export declare const ROLES: readonly Role[];
