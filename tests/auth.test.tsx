import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { authOptions } from '../src/lib/auth';
import { middleware } from '../src/middleware';

test('Google sign-in keeps the verified corporate domain restriction', async () => {
  const signIn = authOptions.callbacks!.signIn!;
  const check = (email: string, hd = 'feedmob.com', verified = true) => signIn({
    user: { id: 'auth-test', email }, account: null,
    profile: { email, hd, email_verified: verified },
  } as any);
  assert.equal(await check('person@feedmob.com'), true);
  assert.equal(await check('person@feedmob.com', 'feedmob.com', false), false);
  assert.equal(await check('person@gmail.com'), false);
  assert.equal(await check('person@evilfeedmob.com'), false);
  assert.equal(await check('person@feedmob.com', 'external.example'), false);
});

test('OAuth redirects retain internal destinations and reject external callbacks', async () => {
  const redirect = authOptions.callbacks!.redirect!;
  const baseUrl = 'https://minework.techmob.net';
  assert.equal(await redirect({ url: '/calendar?date=2026-10-13', baseUrl }), baseUrl + '/calendar?date=2026-10-13');
  assert.equal(await redirect({ url: baseUrl + '/stream', baseUrl }), baseUrl + '/stream');
  assert.equal(await redirect({ url: 'https://external.example/', baseUrl }), baseUrl);
});

test('middleware protects pages and APIs while keeping login and OAuth routes available', async () => {
  const base = 'https://minework.techmob.net';
  const page = await middleware(new NextRequest(base + '/calendar?date=2026-10-13'));
  assert.equal(page.status, 307);
  const location = new URL(page.headers.get('location')!);
  assert.equal(location.pathname, '/login');
  assert.equal(location.searchParams.get('callbackUrl'), '/calendar?date=2026-10-13');
  assert.equal((await middleware(new NextRequest(base + '/api/logs'))).status, 401);
  assert.equal((await middleware(new NextRequest(base + '/api/logs', { headers: { authorization: 'Bearer %' } }))).status, 401);
  assert.equal((await middleware(new NextRequest(base + '/login'))).status, 200);
  assert.equal((await middleware(new NextRequest(base + '/api/auth/providers'))).status, 200);
});
