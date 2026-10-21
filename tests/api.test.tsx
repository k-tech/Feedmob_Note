import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';

test('API saves tags atomically, deduplicates names and rolls back a failed association', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'feedmob-block-test-'));
  const client = new PrismaClient({ datasourceUrl: 'file:' + join(directory, 'test.db').replaceAll('\\', '/') });
  // Route identity is now session-bound; keep authentication outside this
  // transaction test while using the isolated user's real database record.
  const nextAuth = createRequire(import.meta.url)('next-auth/next');
  const session = mock.method(nextAuth, 'getServerSession', async () => ({ user: { email: 'test@example.invalid' } }));
  let failAssociation = false;
  const isolated = client.$extends({ query: { tagOnLog: { async create({ args, query }) {
    if (failAssociation) throw new Error('Simulated tag failure');
    return query(args);
  } } } });
  // The route imports this isolated client. Never connects to prisma/dev.db.
  (globalThis as any).prisma = isolated;
  try {
    const sql = execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], { encoding: 'utf8' });
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await client.$executeRawUnsafe(statement);
    await client.user.create({ data: { id: 'test-user', email: 'test@example.invalid', name: 'Test' } });
    const { POST } = await import('../src/app/api/logs/route');
    const request = (data: any) => new Request('http://localhost/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'test-user', date: '2099-01-01', contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, ...data }) });
    const first = await POST(request({ title: 'original', tagNames: ['project', ' project ', '#project', ' ', 123] }));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).tags.length, 1);
    failAssociation = true;
    const originalError = console.error;
    let failed;
    try {
      console.error = () => {};
      failed = await POST(request({ title: 'must rollback', tagNames: ['new-tag'] }));
    } finally { console.error = originalError; }
    assert.equal(failed.status, 500);
    const stored = await client.workLog.findFirst({ include: { tags: { include: { tag: true } } } });
    assert.equal(stored?.title, 'original');
    assert.deepEqual(stored?.tags.map(value => value.tag.name), ['project']);
    assert.equal(await client.tag.count({ where: { name: 'new-tag' } }), 0);
    failAssociation = false;
    const richDocument = { type: 'doc', content: [
      { type: 'image', attrs: { src: 'data:image/png;base64,aGVsbG8=', caption: '截图', blockWidth: 65 } },
      { type: 'htmlPreview', attrs: { code: '<h1>结果</h1>', blockHeight: 480 } },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '42' }] }] }] }] },
    ] };
    assert.equal((await POST(request({ contentJson: richDocument }))).status, 200);
    const rich = await client.workLog.findFirst();
    assert.deepEqual(JSON.parse(rich!.contentJson!), richDocument);
    // The single-log reader returns the stored document with its relations.
    const { GET: getLog } = await import('../src/app/api/logs/[id]/route');
    const read = (id: string) => getLog(new Request('http://localhost/api/logs/' + id), { params: Promise.resolve({ id }) });
    const found = await read(rich!.id);
    assert.equal(found.status, 200);
    const body = await found.json();
    assert.deepEqual(JSON.parse(body.contentJson), richDocument);
    assert.equal(body.user.id, 'test-user');
    assert.ok(Array.isArray(body.comments) && Array.isArray(body.reactions));
    assert.equal((await read('missing-log')).status, 404);
    session.mock.mockImplementation(async () => null);
    assert.equal((await read(rich!.id)).status, 401);
    session.mock.mockImplementation(async () => ({ user: { email: 'test@example.invalid' } }));
    const invalid = await POST(request({ contentJson: '{invalid json' }));
    assert.equal(invalid.status, 400);
  } finally {
    session.mock.restore();
    await client.$disconnect();
    delete (globalThis as any).prisma;
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
