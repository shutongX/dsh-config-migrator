import test from 'node:test';
import assert from 'node:assert/strict';

import * as plugin from '../lib/index.js';
import { isSecretKeyName } from '../lib/host/export.js';
import { isForbiddenWriteRelPath, isSecretRelPath, normalizeRelPath } from '../lib/host/secret-files.js';
import { maskHomePath } from '../lib/host/paths.js';

test('plugin entry exposes a bundle host shape', () => {
  assert.equal(plugin.name, 'dsh-config-migrator');
  assert.ok(Array.isArray(plugin.inject));
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(typeof plugin.Config, 'object');
});

test('credential key redaction covers values but not env names', () => {
  assert.equal(isSecretKeyName('apiKey'), true);
  assert.equal(isSecretKeyName('token'), true);
  assert.equal(isSecretKeyName('authorization'), true);
  assert.equal(isSecretKeyName('apiKeyEnv'), false);
  assert.equal(isSecretKeyName('displayName'), false);
});

test('plaintext secret files are excluded from exports and imports', () => {
  assert.equal(normalizeRelPath('Dsh-Pocket\\Token'), 'dsh-pocket/token');
  assert.equal(isSecretRelPath('dsh-pocket/token'), true);
  assert.equal(isSecretRelPath('dsh-pocket/token-lan'), true);
  assert.equal(isSecretRelPath('dsh-pocket/config.json'), false);
  assert.equal(isForbiddenWriteRelPath('profiles/desktop/.credentials.yaml'), true);
  assert.equal(isForbiddenWriteRelPath('storages/schedule.json'), false);
});

test('home paths are masked in exported manifests', () => {
  const masked = maskHomePath('C:/Users/alice/.dsh');
  assert.notEqual(masked, 'C:/Users/alice/.dsh');
  assert.match(masked, /<user>/);
});
