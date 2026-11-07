import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = file => readFileSync(new URL('../' + file, import.meta.url));
const hosting = JSON.parse(read('wrangler.example.jsonc'));
assert.equal(hosting.d1_databases.length, 1);
assert.equal(hosting.d1_databases[0].binding, 'DB', 'Persistence uses the standard D1 binding');
assert.equal(hosting.d1_databases[0].database_id, '00000000-0000-4000-8000-000000000000', 'The template must not target a real database');
assert.equal(hosting.d1_databases[0].migrations_dir, 'drizzle');
assert.equal(hosting.vars.LOCAL_DEV, 'false', 'The checked-in deployment configuration fails closed');
for (const name of ['APP_ORIGIN', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUDIENCE', 'OWNER_EMAIL']) assert.equal(hosting.vars[name], '');
assert.equal(hosting.assets.run_worker_first, true);
assert.equal(hosting.workers_dev, false);
assert.equal(hosting.preview_urls, false);
const vite = read('vite.config.ts').toString();
assert.doesNotMatch(vite, /hosting\.json|sites-vite-plugin/);
assert.match(vite, /LOCAL_DEV: command === "serve" \? "true" : "false"/);

// Applied migration content is immutable. New migrations may be appended, but
// rewriting these baseline files would undermine replay and rollback safety.
for (const [file, sha] of Object.entries({
  'drizzle/0000_powerful_mojo.sql': '7b069391a7f1f2f43a79f69ab1596b3ed8bc224f3956429b38e5b95727b18cc0',
  'drizzle/meta/0000_snapshot.json': '122c9665a5e2f80128a094fbe61cc76bc4d3cba78333e1d10bc7318c1848dd02',
})) assert.equal(createHash('sha256').update(read(file)).digest('hex'), sha, `${file} was already applied and must not be rewritten`);
const journal = JSON.parse(read('drizzle/meta/_journal.json'));
assert.equal(journal.entries[0].tag, '0000_powerful_mojo');
assert.equal(journal.entries[0].idx, 0);
console.log('Standalone deployment defaults fail closed, storage binding/migration history preserved, and no original hosting identity remains.');
