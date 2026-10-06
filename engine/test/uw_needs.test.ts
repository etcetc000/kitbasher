import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPack, needLines, type Pack, type PackModel } from '../src/packs.js';

function fixture(install?: unknown): Pack {
  return { format: 'md-pack/1', family: 'TEST', models: [{ name: 'TEST ', needs: [{
    kind: 'uw-sample', name: 'DATA', what: 'matching release asset', without: 'it is silent',
    ...(install !== undefined ? { install } : {}),
  }] } as PackModel] } as Pack;
}

test('needs without an install descriptor stay valid; install descriptors name the file without implying a loaded device', () => {
  const old = fixture();
  checkPack(old);
  const prefix = needLines(old.models[0])[0];
  assert.equal(prefix, 'TEST: it is silent without the DATA sample in a UW slot (matching release asset)');
  const next = fixture({ transport: 'sds-handshake', file: 'test-data.syx' });
  checkPack(next);
  assert.ok(needLines(next.models[0])[0].startsWith(prefix));
  assert.match(needLines(next.models[0])[0], /Load test-data.syx using handshaken SDS/);
  assert.match(needLines(next.models[0])[0], /check the file's destination slot/);
});

test('install descriptors cannot supply paths, URLs, commands or unsupported transfer methods', () => {
  for (const file of ['../test.syx', 'C:\\test.syx', 'https://example.org/test.syx', '<script>.syx', 'test.wav', '']) {
    assert.throws(() => checkPack(fixture({ transport: 'sds-handshake', file })), /invalid UW/);
  }
  for (const install of [null, false, {}, { transport: 'send', file: 'test.syx' },
    { transport: 'sds-handshake', file: 'test.syx', command: 'run' }]) {
    assert.throws(() => checkPack(fixture(install)), /invalid UW/);
  }
});
