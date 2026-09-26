import { getDb } from '../lib/db';
import { canAccess } from '../lib/permissions/evaluator';

const db = getDb();
const abadmin = db.prepare("SELECT * FROM users WHERE username = 'abadmin'").get() as any;
const iamadmin = db.prepare("SELECT * FROM users WHERE username = 'Iamadmin'").get() as any;
const starscrew = db.prepare("SELECT * FROM users WHERE username = 'STAR-SCREW'").get() as any;

console.log('--- canAccess for Iamadmin ---');
console.log(canAccess({
  session: {
    userId: iamadmin.id,
    role: iamadmin.role,
    authorityTier: iamadmin.authority_tier,
    isActive: true,
  },
  page: 'PAGE_ACCESS_REQUESTS',
  action: 'ACCESS_REQUEST_REVIEW',
}));

console.log('--- canAccess for abadmin ---');
console.log(canAccess({
  session: {
    userId: abadmin.id,
    role: abadmin.role,
    authorityTier: abadmin.authority_tier,
    isActive: true,
  },
  page: 'PAGE_ACCESS_REQUESTS',
  action: 'ACCESS_REQUEST_REVIEW',
}));

console.log('--- canAccess for STAR-SCREW ---');
console.log(canAccess({
  session: {
    userId: starscrew.id,
    role: starscrew.role,
    authorityTier: starscrew.authority_tier,
    isActive: true,
  },
  page: 'PAGE_ACCESS_REQUESTS',
  action: 'ACCESS_REQUEST_REVIEW',
}));
