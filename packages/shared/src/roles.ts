export const roleHierarchy = {
  student: 10,
  teacher: 20,
  admin: 30,
  superadmin: 40
} as const;

export type Role = keyof typeof roleHierarchy;

export const hasRoleAtLeast = (role: Role, minimumRole: Role): boolean =>
  roleHierarchy[role] >= roleHierarchy[minimumRole];

export const hostControlRoles = ["teacher", "admin", "superadmin"] as const;
export type HostControlRole = (typeof hostControlRoles)[number];

export const canUseHostControls = (role: Role): role is HostControlRole =>
  hostControlRoles.includes(role as HostControlRole);
