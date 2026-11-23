/**
 * TRADECORE AI — Roles & permissions registry (Phase 2A).
 *
 * Single source of truth for the 5 system roles. The database seed
 * (migration 20261122000500) must produce exactly ROLE_PERMISSION_PAIRS;
 * tests/sql/run.sh verifies this against the live schema.
 */
import { MODULE_KEYS } from './modules.js';

export const BASE_PERMISSIONS = Object.freeze([
  'org.manage',
  'billing.manage',
  'members.read',
  'members.manage',
  'audit.read',
  'finance.read',
  'finance.write',
  'data.read',
  'data.write',
  'integrations.manage',
  'ares.use',
]);

export const modulePermission = (moduleKey, action) => `module.${moduleKey}.${action}`;

export const PERMISSIONS = Object.freeze([
  ...BASE_PERMISSIONS,
  ...MODULE_KEYS.flatMap((k) => [modulePermission(k, 'read'), modulePermission(k, 'write')]),
]);

/** Role order = rank (lower index = more authority). */
export const ROLES = Object.freeze([
  { key: 'owner', name: 'Sahib' },
  { key: 'admin', name: 'Admin' },
  { key: 'manager', name: 'Menecer' },
  { key: 'employee', name: 'İşçi' },
  { key: 'viewer', name: 'Müşahidəçi' },
]);

export const ROLE_KEYS = Object.freeze(ROLES.map((r) => r.key));

const ALL_MODULE_READ = MODULE_KEYS.map((k) => modulePermission(k, 'read'));
const ALL_MODULE_WRITE = MODULE_KEYS.map((k) => modulePermission(k, 'write'));

/** Approved matrix (Phase 2A, decision A). */
export const ROLE_MATRIX = Object.freeze({
  owner: [...BASE_PERMISSIONS, ...ALL_MODULE_READ, ...ALL_MODULE_WRITE],
  admin: [
    'org.manage', 'members.read', 'members.manage', 'audit.read', 'finance.read', 'finance.write',
    'data.read', 'data.write', 'integrations.manage', 'ares.use', ...ALL_MODULE_READ, ...ALL_MODULE_WRITE,
  ],
  manager: ['members.read', 'finance.read', 'finance.write', 'data.read', 'data.write', 'ares.use', ...ALL_MODULE_READ, ...ALL_MODULE_WRITE],
  employee: ['members.read', 'data.read', 'data.write', 'ares.use', ...ALL_MODULE_READ, ...ALL_MODULE_WRITE],
  viewer: ['members.read', 'finance.read', 'data.read', 'ares.use', ...ALL_MODULE_READ],
});

/** Sorted "role:permission" pairs — compared with the DB seed in tests. */
export const ROLE_PERMISSION_PAIRS = Object.freeze(
  Object.entries(ROLE_MATRIX).flatMap(([role, perms]) => perms.map((p) => `${role}:${p}`)).sort(),
);

/**
 * Role-assignment rule (mirrors SQL `can_manage_member`):
 *  - nobody changes their own role
 *  - only an owner may grant or touch owner/admin
 *  - an admin may set manager/employee/viewer on members who are not owner/admin
 */
export function canAssignRole({ actorRole, targetCurrentRole, newRole, isSelf }) {
  if (isSelf) return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') {
    return !['owner', 'admin'].includes(targetCurrentRole) && ['manager', 'employee', 'viewer'].includes(newRole);
  }
  return false;
}
