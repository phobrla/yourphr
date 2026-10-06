import {randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect, it} from 'vitest';
import {openStores, type Stores} from '../app.js';
import {ApiContext} from '../framework/ApiContext.js';

it('a configured signing key preserves sessions across restart; rotation and the default random key do not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yourphr-session-test-'));
  let stores: Stores | undefined;
  try {
    const key = randomBytes(32).toString('hex');
    const env = {YOURPHR_AUTH_SESSION_KEY: key};
    stores = await openStores(dir, env);
    await stores.users.createUser(ApiContext.system('test', 'admin', stores.engine), 'alice', 'synthetic-long-password', 'user');
    const signedIn = await stores.sessions.signIn('alice', {password: 'synthetic-long-password'}, {remoteAddr: '127.0.0.1'}, 1000);
    if (!signedIn.ok) throw new Error('Synthetic account could not sign in');
    const token = signedIn.token;
    await stores.close();
    stores = undefined;
    stores = await openStores(dir, env);
    expect((await stores.sessions.verify(token, 1001)).ok).toBe(true);
    await stores.close();
    stores = undefined;
    stores = await openStores(dir, {YOURPHR_AUTH_SESSION_KEY: randomBytes(32).toString('hex')});
    expect((await stores.sessions.verify(token, 1001)).ok).toBe(false);
    await stores.close();
    stores = undefined;
    stores = await openStores(dir, {});
    const ephemeral = await stores.sessions.signIn('alice', {password: 'synthetic-long-password'}, {remoteAddr: '127.0.0.1'}, 1000);
    if (!ephemeral.ok) throw new Error('Synthetic account could not sign in');
    await stores.close();
    stores = undefined;
    stores = await openStores(dir, {});
    expect((await stores.sessions.verify(ephemeral.token, 1001)).ok).toBe(false);
  } finally {
    await stores?.close();
    rmSync(dir, {recursive: true, force: true});
  }
}, 30_000);
