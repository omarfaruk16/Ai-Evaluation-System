import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Imported first by the entrypoints so `.env` is in process.env before any module decorator
// reads it. Variables already set in the real environment win over the file.
const file = resolve(process.cwd(), process.env.ENV_FILE ?? '.env');
if (existsSync(file)) process.loadEnvFile(file);
