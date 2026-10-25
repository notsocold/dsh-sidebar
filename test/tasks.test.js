/**
 * Pure-model tests for the Host-side task projection.
 *
 * The fold is the entire persistence story of the Progress section, so it is
 * tested without a Harness runtime: a fresh projection starts null, every
 * non-empty todo/write replaces the list, and `turn/start` (or a later empty
 * write) never clears the last real checklist.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SIDEBAR_TASKS_KEY,
  SIDEBAR_TASKS_VERSION,
  createSidebarTasksProjection,
  foldSidebarTasks,
  normalizeTodos,
} from '../lib/tasks.js'

const todoWrite = (todos, time = 1000, seq = 1) => ({
  type: 'todo/write',
  time,
  seq,
  data: { todos },
})

const turnStart = (time = 2000, seq = 2) => ({ type: 'turn/start', time, seq, data: { turn: 1 } })

test('normalizeTodos keeps valid rows and drops malformed ones', () => {
  assert.deepEqual(normalizeTodos([
    { content: 'a', status: 'pending' },
    { content: '', status: 'pending' },
    { content: 'b', status: 'unknown' },
    { content: 'c', status: 'completed', extra: true },
    null,
    'nope',
  ]), [
    { content: 'a', status: 'pending' },
    { content: 'c', status: 'completed' },
  ])
  assert.deepEqual(normalizeTodos(undefined), [])
  assert.deepEqual(normalizeTodos(null), [])
})

test('a fresh projection starts without a task list', () => {
  const definition = createSidebarTasksProjection()
  assert.equal(definition.key, SIDEBAR_TASKS_KEY)
  assert.equal(definition.stateVersion, SIDEBAR_TASKS_VERSION)
  assert.deepEqual(definition.init(undefined, 0), { todos: [], time: 0, inherited: 0 })
  assert.deepEqual(definition.init(undefined, 3), { todos: [], time: 0, inherited: 3 })
  assert.equal(definition.wire.summary, false)
  assert.equal(definition.wire.view({ todos: [], time: 0, inherited: 0 }), null)
})

test('todo/write replaces the list and records the event time', () => {
  const next = foldSidebarTasks(null, todoWrite([
    { content: 'one', status: 'in_progress' },
    { content: 'two', status: 'pending' },
  ], 4321))
  assert.deepEqual(next, {
    todos: [
      { content: 'one', status: 'in_progress' },
      { content: 'two', status: 'pending' },
    ],
    time: 4321,
    inherited: 0,
  })
})

test('turn/start keeps the previous checklist', () => {
  const first = foldSidebarTasks(null, todoWrite([
    { content: 'still relevant', status: 'completed' },
  ], 1000))
  const afterTurnStart = foldSidebarTasks(first, turnStart())
  assert.equal(afterTurnStart, first)
})

test('a later empty or malformed write never erases the last checklist', () => {
  const first = foldSidebarTasks(null, todoWrite([
    { content: 'kept', status: 'pending' },
  ], 1000))
  assert.equal(foldSidebarTasks(first, todoWrite([], 2000)), first)
  assert.equal(foldSidebarTasks(first, todoWrite(null, 2000)), first)
  assert.equal(foldSidebarTasks(first, todoWrite([{ content: 'x', status: 'bogus' }], 2000)), first)
  assert.equal(foldSidebarTasks(first, { type: 'assistant/message', time: 3000 }), first)
})

test('a newer non-empty write wins and carries the newer list', () => {
  const first = foldSidebarTasks(null, todoWrite([
    { content: 'old', status: 'completed' },
  ], 1000))
  const second = foldSidebarTasks(first, todoWrite([
    { content: 'new', status: 'in_progress' },
  ], 3000))
  assert.deepEqual(second, {
    todos: [{ content: 'new', status: 'in_progress' }],
    time: 3000,
    inherited: 0,
  })
})

test('a missing event time folds deterministically to zero', () => {
  const next = foldSidebarTasks(null, { type: 'todo/write', data: { todos: [{ content: 'a', status: 'pending' }] } })
  assert.deepEqual(next, {
    todos: [{ content: 'a', status: 'pending' }],
    time: 0,
    inherited: 0,
  })
})

test('a null data payload never throws and leaves the state alone', () => {
  const state = { todos: [{ content: 'kept', status: 'pending' }], time: 1, inherited: 0 }
  assert.equal(foldSidebarTasks(state, { type: 'todo/write', data: null, time: 2 }), state)
})

test('fork-prefix writes are ignored so the child shows its own tasks only', () => {
  const definition = createSidebarTasksProjection()
  const initial = definition.init(undefined, 2)
  const parentWrite = { type: 'todo/write', seq: 1, time: 1000, data: { todos: [{ content: 'parent', status: 'pending' }] } }
  assert.equal(foldSidebarTasks(initial, parentWrite), initial)
  const childWrite = { type: 'todo/write', seq: 5, time: 2000, data: { todos: [{ content: 'child', status: 'in_progress' }] } }
  const after = foldSidebarTasks(initial, childWrite)
  assert.deepEqual(after, {
    todos: [{ content: 'child', status: 'in_progress' }],
    time: 2000,
    inherited: 2,
  })
  assert.equal(definition.wire.view(after).todos[0].content, 'child')
})
