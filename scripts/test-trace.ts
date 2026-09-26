import { getDb } from '../lib/db';
import { AccessRequestRepository } from '../lib/db/repositories/access-request-repo';

const db = getDb();
console.log('=== TEST RESOLVE APPROVERS ===');
const approvers = AccessRequestRepository.resolveAccessRequestApprovers(db);
console.log(JSON.stringify(approvers, null, 2));
