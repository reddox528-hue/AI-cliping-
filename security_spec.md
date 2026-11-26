# NEXORATECH Clipora AI — Security Specification & Dirty Dozen Payloads

## Data Invariants
1. **Default Deny**: All unmatched paths are denied (`allow read, write: if false;`).
2. **Registration Integrity**: A newly registered user can only create `/users/{request.auth.uid}` with `role == 'CUSTOMER'`, `accountStatus == 'PENDING'`, and no `permissions` (except the verified bootstrap owner `reddox528@gmail.com`).
3. **Approval Gate**: Only users with `accountStatus == 'APPROVED'` (or verified bootstrap owner) may create or mutate workspace entities (`projects`, `sourceVideos`, `processingJobs`, `clips`, `transcripts`, `exports`, `brandKits`, `usageRecords`).
4. **Ownership Binding**: Every customer-owned record requires `incoming().ownerId == request.auth.uid` on create and `incoming().ownerId == existing().ownerId` on update.
5. **Relational Integrity**: Child records (`sourceVideos`, `processingJobs`, `clips`, `transcripts`) verify parent `projectId` exists and is owned by `request.auth.uid` on create.
6. **Admin & Super Admin Isolation**:
   - Only `SUPER_ADMIN` can assign/revoke `ADMIN` or `SUPER_ADMIN` roles, set `permissions`, modify `systemSettings`, delete users, or read `auditLogs`.
   - `ADMIN` can only approve/reject/suspend/reactivate `CUSTOMER` accounts (`existing().role == 'CUSTOMER'`), cannot modify `ADMIN`/`SUPER_ADMIN` accounts, cannot change their own `role`/`accountStatus`/`permissions`, and cannot escalate anyone's privileges.
7. **Audit Log Immutability & Visibility**: `auditLogs` are append-only (`allow update, delete: if false;`) and readable strictly by `SUPER_ADMIN` (`allow get, list: if isSuperAdmin()`).
8. **Temporal & Schema Integrity**: `createdAt`/`updatedAt` must equal `request.time`; `isValidId` prevents oversized or malformed IDs; `keys().hasAll` + `keys().hasOnly` + `affectedKeys().hasOnly` block shadow fields.

## Dirty Dozen Adversarial Payloads
1. **Self-Admin Escalation on Signup**: `POST /users/{uid}` with `{ role: "SUPER_ADMIN", accountStatus: "APPROVED" }` -> `PERMISSION_DENIED`.
2. **Self-Approval / Permissions Update**: `PATCH /users/{uid}` by customer setting `{ accountStatus: "APPROVED" }` or `{ permissions: ["MANAGE_CUSTOMERS"] }` -> `PERMISSION_DENIED`.
3. **Admin Self-Promotion to Super Admin**: `PATCH /users/{adminUid}` by `ADMIN` setting `{ role: "SUPER_ADMIN" }` -> `PERMISSION_DENIED`.
4. **Shadow Ghost Field Injection**: `POST /projects/{id}` with valid fields plus `{ isAdminOverride: true }` -> `PERMISSION_DENIED`.
5. **Cross-Tenant Project Read**: Customer B reading Customer A's `/projects/{projectId}` -> `PERMISSION_DENIED`.
6. **Cross-Tenant Ownership Spoof**: Customer B creating `/clips/{clipId}` with `ownerId: customerA.uid` -> `PERMISSION_DENIED`.
7. **Orphaned Clip Creation**: Creating `/clips/{clipId}` referencing a non-existent `projectId` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Creating `/projects/invalid$id*with!bad#chars` or 500-char ID -> `PERMISSION_DENIED`.
9. **Unverified Admin Email Spoof**: Request with unverified `email_verified: false` claiming bootstrap admin -> `PERMISSION_DENIED`.
10. **Audit Log Customer/Non-SuperAdmin Read & Tampering**: Customer or `ADMIN` reading `auditLogs`, or anyone updating/deleting `/auditLogs/{logId}` -> `PERMISSION_DENIED`.
11. **Non-SuperAdmin System Settings Write**: Customer or standard `ADMIN` writing to `/systemSettings/limits` -> `PERMISSION_DENIED`.
12. **Blanket List Query Scraping**: Customer listing `/users` without owning/admin scope -> `PERMISSION_DENIED`.
