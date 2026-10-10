import '../config/load-env';
import { PrismaClient } from '@prisma/client';
import { parseArgs } from 'node:util';
import { generateApiKey, generateWebhookSecret, sealApiKey } from '../auth/api-key';

// Registers a project that will call this service and prints its API key and webhook secret.
// The key is also stored encrypted when SECRETS_ENCRYPTION_KEY is set, so the console can show it again.
//
//   dev:        pnpm client:create --name exam-system --webhook-url https://… --budget 50
//   production: docker compose … exec api node dist/cli/create-client.js --name exam-system …

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      'webhook-url': { type: 'string' },
      budget: { type: 'string' },
    },
  });
  const name = values.name?.trim();
  if (!name) {
    console.error('Usage: pnpm client:create --name <project> [--webhook-url <https url>] [--budget <usd per month>]');
    process.exit(1);
  }
  const budget = values.budget === undefined ? null : Number(values.budget);
  if (budget !== null && !(budget >= 0)) {
    console.error('--budget must be a non-negative number of US dollars');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const { key, hash, prefix } = generateApiKey();
    const webhookSecret = generateWebhookSecret();
    const client = await prisma.client.create({
      data: {
        name,
        apiKeyHash: hash,
        apiKeyPrefix: prefix,
        apiKeyEncrypted: sealApiKey(key, process.env.SECRETS_ENCRYPTION_KEY),
        webhookUrl: values['webhook-url'] ?? null,
        webhookSecret,
        monthlyBudgetUsd: budget,
      },
    });
    console.log(`Client created: ${client.name} (${client.id})`);
    console.log('');
    console.log('Store these in the client project now. They are not shown again.');
    console.log(`  AI_MARKING_API_KEY=${key}`);
    console.log(`  AI_MARKING_WEBHOOK_SECRET=${webhookSecret}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  const msg = (e as { code?: string }).code === 'P2002' ? 'A client with that name already exists' : String(e);
  console.error(msg);
  process.exit(1);
});
