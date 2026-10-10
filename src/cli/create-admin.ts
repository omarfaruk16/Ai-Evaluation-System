import '../config/load-env';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { generatePassword, hashPassword, passwordProblem } from '../admin/auth/password';

// Creates an operator-console account, or resets one's password with --reset.
//
//   dev:        pnpm admin:create --email you@example.com --name "Your Name"
//   production: docker compose … exec api node dist/cli/create-admin.js --email … --name …
//
// The password is asked for on the terminal (not echoed). --generate prints a random one once;
// --password-file reads it from a file (for automation).

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      if (!prompted) {
        out.output.write(s);
        prompted = true;
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-file': { type: 'string' },
      generate: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
    },
  });
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || (!values.reset && !values.name?.trim())) {
    console.error('Usage: pnpm admin:create --email <email> --name <name> [--generate | --password-file <path>]');
    console.error('       pnpm admin:create --email <email> --reset [--generate | --password-file <path>]');
    process.exit(1);
  }

  let password: string;
  if (values.generate) {
    password = generatePassword();
  } else if (values['password-file']) {
    password = readFileSync(values['password-file'], 'utf8').trim();
  } else if (process.stdin.isTTY) {
    password = await ask('Password: ');
    if ((await ask('Repeat password: ')) !== password) {
      console.error('Passwords do not match');
      process.exit(1);
    }
  } else {
    console.error('No terminal to ask for a password: use --generate or --password-file');
    process.exit(1);
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`Password rejected: ${problem}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password);
    if (values.reset) {
      const admin = await prisma.adminUser.update({ where: { email }, data: { passwordHash, active: true } }).catch(() => null);
      if (!admin) {
        console.error(`No admin with email ${email}`);
        process.exit(1);
      }
      await prisma.adminSession.deleteMany({ where: { adminId: admin.id } });
      console.log(`Password reset for ${email}; all of its sessions were signed out.`);
    } else {
      const exists = await prisma.adminUser.findUnique({ where: { email } });
      if (exists) {
        console.error(`An admin with email ${email} already exists (use --reset to change its password)`);
        process.exit(1);
      }
      await prisma.adminUser.create({ data: { email, name: values.name!.trim(), passwordHash } });
      console.log(`Created console admin ${email}`);
    }
    if (values.generate) console.log(`Password (shown once): ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
