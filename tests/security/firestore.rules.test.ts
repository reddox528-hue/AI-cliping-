import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Firestore Security Rules & Blueprint Invariants', () => {
  const rootDir = process.cwd();
  const rules = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');
  const draftRules = fs.readFileSync(path.join(rootDir, 'DRAFT_firestore.rules'), 'utf8');
  const blueprint = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'firebase-blueprint.json'), 'utf8')
  ) as {
    entities: Record<string, { properties: Record<string, unknown> }>;
    firestore: Record<string, unknown>;
  };

  it('keeps DRAFT_firestore.rules and deployed firestore.rules synchronized', () => {
    assert.equal(rules, draftRules);
  });

  it('enforces global default-deny catch-all rule', () => {
    assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  });

  it('requires verified email on bootstrap Super Admin reddox528@gmail.com', () => {
    assert.match(
      rules,
      /function isEmailVerified\(\)\s*\{\s*return isSignedIn\(\) && request\.auth\.token\.email_verified == true;/
    );
    assert.match(
      rules,
      /function isBootstrapOwner\(\)\s*\{\s*return isEmailVerified\(\) &&[\s\S]*?request\.auth\.token\.email\.lower\(\) == 'reddox528@gmail\.com';/
    );
  });

  it('forces self-registered non-bootstrap accounts to CUSTOMER + PENDING with no permissions', () => {
    assert.match(
      rules,
      /\(incoming\(\)\.role == 'CUSTOMER' &&\s*incoming\(\)\.accountStatus == 'PENDING' &&\s*\(!\('permissions' in incoming\(\)\) \|\| incoming\(\)\.permissions\.size\(\) == 0\)\)/
    );
  });

  it('prevents privilege escalation and locks role, accountStatus, permissions, approvedBy, approvedAt', () => {
    // Customer self-update only allows non-privileged display fields
    assert.match(
      rules,
      /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\['displayName', 'photoURL', 'themePreference', 'lastLoginAt', 'updatedAt'\]\)/
    );
    // Standard ADMIN cannot modify self, non-customer targets, role, or permissions (unless explicitly granted CREATE_ADMINS)
    assert.match(
      rules,
      /\(hasCreateAdminsPermission\(\) &&\s*request\.auth\.uid != userId &&\s*existing\(\)\.role == 'CUSTOMER' &&\s*incoming\(\)\.role == 'ADMIN'/
    );
    assert.match(
      rules,
      /\(isAdmin\(\) &&\s*request\.auth\.uid != userId &&\s*existing\(\)\.role == 'CUSTOMER' &&\s*incoming\(\)\.role == existing\(\)\.role &&\s*incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\['accountStatus', 'approvedAt', 'approvedBy', 'updatedAt'\]\)\)/
    );
    // SUPER_ADMIN required to manage roles or permissions (and no duplicate SUPER_ADMIN allowed)
    assert.match(
      rules,
      /\(isSuperAdmin\(\) &&\s*request\.auth\.uid != userId &&\s*existing\(\)\.role != 'SUPER_ADMIN' &&\s*incoming\(\)\.role in \['CUSTOMER', 'ADMIN'\] &&\s*incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\['role', 'accountStatus', 'permissions', 'approvedAt', 'approvedBy', 'updatedAt'\]\)\)/
    );
  });

  it('restricts systemSettings mutations and auditLogs reads strictly to SUPER_ADMIN', () => {
    assert.match(
      rules,
      /match \/systemSettings\/\{settingId\}[\s\S]*allow create, update: if isValidId\(settingId\) &&\s*isSuperAdmin\(\)/
    );
    assert.match(
      rules,
      /match \/auditLogs\/\{logId\}[\s\S]*allow get: if isValidId\(logId\) && isSuperAdmin\(\);[\s\S]*allow list:[\s\S]*role == 'SUPER_ADMIN'[\s\S]*allow update, delete: if false;/
    );
    assert.match(rules, /match \/usageRecords\/\{recordId\}[\s\S]*allow update: if false;/);
  });

  it('guards every blueprint collection and includes permissions schema on User', () => {
    assert.ok(blueprint.entities.User.properties.permissions);
    const collectionPaths = Object.keys(blueprint.firestore);
    assert.ok(collectionPaths.length >= 12);
    for (const colPath of collectionPaths) {
      const colName = colPath.split('/')[1];
      assert.ok(rules.includes(`match /${colName}/`), `Rule missing for blueprint path ${colPath}`);
    }
    const idChecks = rules.match(/isValidId\(/g) || [];
    assert.ok(idChecks.length >= 30, 'Expected strict isValidId checks across paths and foreign keys');
  });

  it('evaluates admin list short-circuits before resource.data filters to prevent unfiltered query 403 errors', () => {
    const usersBlock = rules.match(/match \/users\/\{userId\}[\s\S]*?allow create:/);
    assert.ok(usersBlock && usersBlock[0]);
    const adminCheckPos = usersBlock[0].indexOf('isBootstrapOwner()');
    const resourceCheckPos = usersBlock[0].indexOf('resource.data.uid == request.auth.uid');
    assert.ok(adminCheckPos !== -1 && resourceCheckPos !== -1 && adminCheckPos < resourceCheckPos);
  });
});
