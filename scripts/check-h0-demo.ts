/**
 * check-h0-demo.ts — verifies the JackOps H0 demo is wired to Aurora and seeded.
 *
 * Run:  pnpm h0:check   (or)   tsx scripts/check-h0-demo.ts
 *
 * Checks:
 *   - DATABASE_URL exists
 *   - Prisma can connect to Aurora
 *   - demo tenant exists
 *   - demo user exists
 *   - demo workflows exist
 *   - agent traces exist
 *   - audit logs exist
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_ID = 'h0-demo-tenant';
const USER_EMAIL = 'judge@jackops.demo';

async function main() {
  let ok = true;
  const check = (name: string, cond: boolean, detail?: string) => {
    const mark = cond ? '✓' : '✗';
    console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!cond) ok = false;
  };

  check('DATABASE_URL set', Boolean(process.env['DATABASE_URL']));

  let connected = false;
  try {
    await prisma.$connect();
    // A trivial query to confirm the connection is live.
    await prisma.workflow.count({ where: { tenantId: TENANT_ID } });
    connected = true;
  } catch (e) {
    check('Prisma can connect to Aurora', false, e instanceof Error ? e.message : String(e));
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }
  check('Prisma can connect to Aurora', connected);

  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } }).catch(() => null);
  check('demo tenant exists', Boolean(tenant), tenant ? tenant.slug : 'missing');

  const user = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: TENANT_ID, email: USER_EMAIL } },
  }).catch(() => null);
  check('demo user exists', Boolean(user), user ? user.email : 'missing');

  const workflowCount = await prisma.workflow.count({ where: { tenantId: TENANT_ID } });
  check('demo workflows exist', workflowCount > 0, `${workflowCount} workflows`);

  const traceCount = await prisma.agentTrace.count({ where: { tenantId: TENANT_ID } });
  check('agent traces exist', traceCount > 0, `${traceCount} traces`);

  const auditCount = await prisma.auditLog.count({ where: { tenantId: TENANT_ID } });
  check('audit logs exist', auditCount > 0, `${auditCount} audit logs`);

  const approvalCount = await prisma.approvalRequest.count({ where: { tenantId: TENANT_ID } });
  check('approval requests exist', approvalCount > 0, `${approvalCount} approvals`);

  await prisma.$disconnect();

  console.log(ok ? '\n✓ H0 demo check passed.' : '\n✗ H0 demo check failed — see above.');
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Check failed:', e);
  process.exitCode = 1;
});