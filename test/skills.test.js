/**
 * Pure-model tests for the Host-side skill usage projection.
 *
 * Usage comes from two durable Session events: the model's `skill` tool call
 * and the user's explicit first-line `/<name>` gesture. Both are counted per
 * Session; forked prefixes are ignored.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILL_USAGE_KEY,
  SKILL_USAGE_VERSION,
  createSkillUsageProjection,
  foldSkillUsage,
  normalizeSkillName,
  slashTokenOf,
} from '../lib/skills.js'

const skillCall = (name, seq = 10) => ({
  type: 'tool/call',
  seq,
  time: 1000,
  data: { name: 'skill', arguments: JSON.stringify({ name }) },
})

const userMessage = (text, seq = 20, source = { kind: 'user' }) => ({
  type: 'user/message',
  seq,
  time: 2000,
  data: { content: [{ type: 'text', text }], source },
})

test('normalizeSkillName accepts catalog-like names and rejects noise', () => {
  assert.equal(normalizeSkillName('cordis-plugin-development'), 'cordis-plugin-development')
  assert.equal(normalizeSkillName('  skill_1.2  '), 'skill_1.2')
  assert.equal(normalizeSkillName(''), undefined)
  assert.equal(normalizeSkillName('/bad'), undefined)
  assert.equal(normalizeSkillName('bad name'), undefined)
  assert.equal(normalizeSkillName(null), undefined)
})

test('slashTokenOf reads only the first line and only a slash token', () => {
  assert.equal(slashTokenOf([{ type: 'text', text: '/memory hello\nsecond' }]), 'memory')
  assert.equal(slashTokenOf([{ type: 'text', text: 'please use /memory' }]), undefined)
  assert.equal(slashTokenOf([{ type: 'text', text: '/bad/name' }]), undefined)
  assert.equal(slashTokenOf([]), undefined)
  assert.equal(slashTokenOf(undefined), undefined)
})

test('a fresh projection starts empty and ignores an inherited fork prefix', () => {
  const definition = createSkillUsageProjection()
  assert.equal(definition.key, SKILL_USAGE_KEY)
  assert.equal(definition.stateVersion, SKILL_USAGE_VERSION)
  assert.equal(definition.wire.summary, false)
  const initial = definition.init(undefined, 5)
  assert.deepEqual(initial, { calls: {}, gestures: {}, inherited: 5 })
  const parent = skillCall('parent-skill', 2)
  assert.equal(foldSkillUsage(initial, parent), initial)
  const child = skillCall('child-skill', 9)
  assert.deepEqual(foldSkillUsage(initial, child), {
    calls: { 'child-skill': 1 },
    gestures: {},
    inherited: 5,
  })
  assert.equal(definition.wire.view(initial), null)
})

test('skill tool calls count by name and keep the state reference for other tools', () => {
  let state = foldSkillUsage(null, skillCall('a'))
  state = foldSkillUsage(state, skillCall('a'))
  state = foldSkillUsage(state, skillCall('b'))
  assert.deepEqual(state.calls, { a: 2, b: 1 })
  const other = { type: 'tool/call', seq: 11, data: { name: 'bash', arguments: '{}' } }
  assert.equal(foldSkillUsage(state, other), state)
  const malformed = { type: 'tool/call', seq: 12, data: { name: 'skill', arguments: '{' } }
  assert.equal(foldSkillUsage(state, malformed), state)
})

test('explicit user slash gestures are recorded, non-user sources are not', () => {
  let state = foldSkillUsage(null, userMessage('/memory hello'))
  assert.deepEqual(state.gestures, { memory: 1 })
  const runtime = userMessage('/memory hello', 21, { kind: 'runtime-context' })
  assert.equal(foldSkillUsage(state, runtime), state)
  const prose = userMessage('please use /memory', 22)
  assert.equal(foldSkillUsage(state, prose), state)
})

test('the view exposes state only once usage exists', () => {
  const definition = createSkillUsageProjection()
  const empty = definition.init(undefined, 0)
  assert.equal(definition.wire.view(empty), null)
  const used = foldSkillUsage(empty, skillCall('x'))
  assert.equal(definition.wire.view(used), used)
})
