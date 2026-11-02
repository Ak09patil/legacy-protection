/**
 * Who can do what. A static table, not per-user data, so no role can grant
 * itself more access. INV-08, INV-17.
 */
const MATRIX = {
    OWNER: new Set([
        "PLAN_EDIT",
        "PLAN_CONFIRM",
        "PAYEE_REGISTER",
        "HOLD_RELEASE",
        "CHECKIN",
        "VIEW_CATALOGUE",
        "VIEW_CONTENT",
    ]),
    TRUSTED_CONTACT: new Set(["TRIGGER_CONFIRM", "VIEW_CATALOGUE"]),
    EXECUTOR: new Set(["VIEW_CATALOGUE", "VIEW_EXECUTOR_PACKAGE"]),
    SYSTEM_EXECUTOR: new Set(["EXECUTE_PLAN_STEP"]),
};
export function can(role, permission) {
    return MATRIX[role].has(permission);
}
/** Content access for non-owners only when the owner opted in for that role. */
export function canViewContent(role, ownerAllowedContentFor) {
    if (role === "OWNER")
        return true;
    if (role === "SYSTEM_EXECUTOR")
        return false;
    return ownerAllowedContentFor.includes(role);
}
export const ROLES = Object.keys(MATRIX);
