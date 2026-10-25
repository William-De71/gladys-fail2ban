// The manifest against the code: the keys it declares are the ones the code
// handles, the store limits hold, the transport and permissions are right.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import {
  TRIGGERS,
  DOWN_REASONS,
  BAN_OUTPUTS,
  UNBAN_OUTPUTS,
  CHECK_OUTPUTS,
  BAN_SUMMARY_OUTPUTS,
} from '../src/events.js';
import { SCENE_ACTIONS, ACTIONS } from '../src/app.js';
import { WIDGETS, BANS_COUNT } from '../src/widgets.js';
import {
  AUTO_LANGUAGE,
  INTERVALS,
  DEFAULT_INTERVAL,
  INTERNAL_KEYS,
  AUTH_METHODS,
} from '../src/config.js';
import { DEFAULT_COMMAND } from '../src/fail2ban.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'Fail2Ban');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-fail2ban:${pkg.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/William-De71/gladys-fail2ban/main/cover.jpg',
  );
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-fail2ban');
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@gladysassistant/integration-sdk',
    'ssh2',
  ]);
});

test('declares the local transport only: an SSH connection to a server the user names', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL|fetch\(/);
});

test('requires the Gladys of the catalog fields (5.3.0); no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.match(source('../src/widgets.js'), /fields: \[/, 'button forms need 5.2.0');
  assert.deepEqual(manifest.categories, ['servers', 'security']);
  for (const key of ['location', 'network_wake', 'containers', 'network_discovery', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key).sort(),
    Object.values(WIDGETS).sort(),
  );
  const app = source('../src/app.js');
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
    assert.match(app, new RegExp(`onWidgetAction\\(WIDGETS\\.${key}`), key);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(SCENE_ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(ACTIONS\\.${key}`), key);
  }
});

test('the outputs of the scene actions are the ones the code returns', () => {
  const actions = byKey(manifest.scene_actions);
  const outputs = (key) => actions.get(key).outputs.map((output) => output.key);
  assert.deepEqual(outputs(SCENE_ACTIONS.BAN_IP), BAN_OUTPUTS);
  assert.deepEqual(outputs(SCENE_ACTIONS.UNBAN_IP), UNBAN_OUTPUTS);
  assert.deepEqual(outputs(SCENE_ACTIONS.CHECK_IP), CHECK_OUTPUTS);
  assert.deepEqual(outputs(SCENE_ACTIONS.GET_SUMMARY), BAN_SUMMARY_OUTPUTS);
});

test('the configuration of the code: the password as a secret, the defaults of the code', () => {
  const config = byKey(manifest.config_schema);
  assert.equal(config.get('password').type, 'secret');
  assert.equal(config.get('host').required, true);
  assert.equal(config.get('username').required, true);
  assert.deepEqual(values(config.get('auth_method')), Object.values(AUTH_METHODS));
  assert.equal(config.get('auth_method').default, AUTH_METHODS.KEY);
  assert.equal(config.get('command').default, DEFAULT_COMMAND);
  assert.equal(config.get('port').default, 22);
  const interval = config.get('interval');
  assert.deepEqual(values(interval), INTERVALS.map(String));
  assert.equal(interval.default, String(DEFAULT_INTERVAL));
  assert.equal(config.get(INTERNAL_KEYS.language), undefined, 'internal key, never shown');
  for (const field of manifest.config_schema) {
    assert.ok(!['text', 'password'].includes(field.type), `${field.key}: ${field.type}`);
    assert.equal(field.display_if, undefined, field.key);
  }
});

test('the trigger filters are the values the events carry', () => {
  const triggers = byKey(manifest.scene_triggers);
  const reasons = byKey(triggers.get(TRIGGERS.SERVER_DOWN).fields).get('reason');
  assert.deepEqual(
    values(reasons).sort(),
    [...new Set([...Object.values(DOWN_REASONS), 'other'])].sort(),
  );
  for (const key of [TRIGGERS.IP_BANNED, TRIGGERS.IP_UNBANNED]) {
    const fields = byKey(triggers.get(key).fields);
    assert.deepEqual([...fields.keys()], ['jail', 'ip'], key);
    const variables = triggers.get(key).variables.map((variable) => variable.key);
    for (const field of fields.keys()) {
      assert.ok(variables.includes(field), `${key}: ${field} is also a variable`);
    }
  }
  const count = byKey(byKey(manifest.widgets).get(WIDGETS.RECENT_BANS).settings).get('count');
  assert.deepEqual(
    [count.min, count.max, count.default],
    [BANS_COUNT.min, BANS_COUNT.max, BANS_COUNT.default],
  );
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20);
  assert.ok(manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
    assert.ok(trigger.key.length <= 40);
  }
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
    assert.ok(
      (action.fields ?? []).length <= 10 && (action.outputs ?? []).length <= 20,
      action.key,
    );
  }
  for (const widget of manifest.widgets) {
    assert.ok((widget.settings ?? []).length <= 10);
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  for (const field of manifest.config_schema.filter((entry) => entry.type === 'section')) {
    for (const text of Object.values(field.description)) {
      assert.ok(text.length <= 1000, field.key);
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('offers the languages of the code, automatic by default', () => {
  const field = byKey(manifest.config_schema).get('language');
  assert.deepEqual(values(field), [AUTO_LANGUAGE, ...LANGUAGES]);
  assert.equal(field.default, AUTO_LANGUAGE);
});

test('catalog fields of Gladys 5.3: search keywords and countries', () => {
  assert.ok(Array.isArray(manifest.keywords), 'keywords is a list');
  assert.ok(manifest.keywords.length >= 1 && manifest.keywords.length <= 10, '1 to 10 keywords');
  for (const keyword of manifest.keywords) {
    assert.ok(
      keyword.trim().length >= 2 && keyword.trim().length <= 30,
      `"${keyword}": 2 to 30 chars`,
    );
  }
  const normalized = manifest.keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length, 'keywords are unique');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'the name is already searched');
  // Usable anywhere: no country restriction.
  assert.equal(manifest.countries, undefined);
});
