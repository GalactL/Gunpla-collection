import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostWarning, isLoopbackHost } from '../../src/routes/index.js';

test('isLoopbackHost : boucle locale seulement', () => {
  for (const h of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '::', '192.168.1.20', 'mon-pc.local', '127.0.0.2', '']) assert.equal(isLoopbackHost(h), false, h);
});

test('hostWarning : message français pour un HOST ouvert, rien pour la boucle locale', () => {
  assert.equal(hostWarning('127.0.0.1'), null);
  assert.equal(hostWarning('localhost'), null);
  assert.equal(
    hostWarning('0.0.0.0'),
    "Attention : le site n'a pas de mot de passe ; HOST=0.0.0.0 l'ouvre à tout votre réseau.",
  );
});
