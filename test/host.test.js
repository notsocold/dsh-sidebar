/**
 * Host-entry wiring tests for dsh-sidebar.
 *
 * The projection fold itself is covered by tasks.test.js; this file checks the
 * plugin entry's public-service wiring without booting a Harness: the optional
 * `sessionProjections` injection must receive both definitions, and a
 * profile without that service must leave the plugin loaded.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name } from '../index.js'
import { SIDEBAR_TASKS_KEY } from '../lib/tasks.js'
import { SKILL_USAGE_KEY } from '../lib/skills.js'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('the plugin name stays stable for the loader row', () => {
  assert.equal(name, 'dsh-sidebar')
})

test('apply registers the task projection through the optional service', async () => {
  const registered = []
  const effects = []
  const ctx = {
    inject(services, callback) {
      assert.deepEqual(services, ['sessionProjections'])
      callback({
        effect(factory, label) {
          effects.push(label)
          return factory()
        },
        sessionProjections: {
          register(definition) {
            registered.push(definition)
            return Promise.resolve({ dispose() {} })
          },
        },
      })
    },
  }
  apply(ctx)
  await flush()
  assert.equal(registered.length, 2)
  assert.deepEqual(registered.map(definition => definition.key).sort(), [SIDEBAR_TASKS_KEY, SKILL_USAGE_KEY].sort())
  assert.ok(registered.every(definition => definition.wire.summary === false))
  assert.equal(effects.length, 1)
})

test('apply stays loaded when the projection service is absent', () => {
  let injected = false
  const ctx = {
    inject(services, callback) {
      injected = true
      assert.deepEqual(services, ['sessionProjections'])
      void callback
    },
  }
  assert.doesNotThrow(() => { apply(ctx) })
  assert.equal(injected, true)
})

test('apply never registers a route or storage of its own', () => {
  let injected = false
  const ctx = {
    inject(_services, callback) {
      injected = true
      callback({
        effect() {},
        sessionProjections: { register: () => Promise.resolve({ dispose() {} }) },
      })
    },
  }
  apply(ctx)
  assert.equal(injected, true)
})
