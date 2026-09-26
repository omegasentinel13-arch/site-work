import { createSessionCookie } from '../lib/auth/session';

async function testRscBody() {
  const token = await createSessionCookie({
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Head Administrator',
    role: 'ADMIN',
    assignedSiteIds: [],
    tokenVersion: 1,
  });

  const prodUrl = 'https://site-work-app-production.up.railway.app';

  const res = await fetch(`${prodUrl}/`, {
    headers: {
      'RSC': '1',
      'Cookie': `site_work_session=${token}`,
    },
    redirect: 'manual',
  });

  console.log('Status /:', res.status);
  const text = await res.text();
  console.log('Length:', text.length);
  console.log('Preview:', text.slice(0, 500));
}

testRscBody().catch(console.error);
