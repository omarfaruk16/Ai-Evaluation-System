import '../config/load-env';
import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { generateApiKey, generateWebhookSecret } from '../auth/api-key';

// Replaces a client's API key (and optionally its webhook secret). The old key stops working
// within a minute, once the API's key cache expires.
//
//   dev:        pnpm client:rotate-key --name exam-system [--webhook-secret]
//   production: docker compose … exec api node dist/cli/rotate-key.js --name exam-system

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { name: { type: 'string' }, 'webhook-secret': { type: 'boolean' } },
  });
  if (!values.name) {
    console.error('Usage: pnpm client:rotate-key --name <project> [--webhook-secret]');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const { key, hash, prefix } = generateApiKey();
    const webhookSecret = values['webhook-secret'] ? generateWebhookSecret() : undefined;
    await prisma.client.update({
      where: { name: values.name },
      data: { apiKeyHash: hash, apiKeyPrefix: prefix, ...(webhookSecret ? { webhookSecret } : {}) },
    });
    console.log(`New credentials for ${values.name}. Shown once:`);
    console.log(`  AI_MARKING_API_KEY=${key}`);
    if (webhookSecret) console.log(`  AI_MARKING_WEBHOOK_SECRET=${webhookSecret}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  const msg = (e as { code?: string }).code === 'P2025' ? 'No client with that name' : String(e);
  console.error(msg);
  process.exit(1);
});
