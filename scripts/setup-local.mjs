import { copyFile, constants } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
try {
  await copyFile(new URL('wrangler.example.jsonc', root), new URL('wrangler.jsonc', root), constants.COPYFILE_EXCL);
  console.log('Created local Wrangler configuration. No cloud resources were created.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Kept existing Wrangler configuration.');
}
console.log('Next: npm run db:migrate:local, then npm run dev.');
