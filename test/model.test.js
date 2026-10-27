/**
 * Pure-model tests for the dsh-sidebar browser half.
 *
 * The browser module is a plain script that calls window.__ModuleLoader__.load()
 * and returns a Cordis plugin object. To test its pure helpers without a browser
 * we capture that definition in a vm sandbox, call the factory with a stub React
 * module, and reach the exported test hooks.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const loaded = []
const sandbox = {
  window: { __ModuleLoader__: { load(definition) { loaded.push(definition) } } },
  console,
  document: undefined,
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

const stubReact = { createElement: () => null, Fragment: 'Fragment', useEffect: () => {} }
const plugin = loaded[0].factory(() => stubReact)
const {
  countTodos,
  unfinishedCount,
  statusLabel,
  format,
  readTaskProjection,
  pickCurrentTaskTurn,
  basenameOf,
  joinPath,
  relativeToRoot,
  fileAddress,
  orderFileEntries,
  fileTone,
  isWideKind,
  nativeCloseOverlayFor,
  narrowWidthFor,
  wideWidthFor,
  normalizeSectionState,
  readSkillUsage,
  readSkillNames,
  mergeSkillUsage,
} = plugin.__test

/** Build one projected task value. */
function projection(todos, time = 1000) {
  return { todos, time }
}

/** Build one client session summary row. */
function row(cwd, value, extra = {}) {
  return {
    displayTitle: 'Conversation',
    cwd,
    projectionValues: value === undefined ? { title: 'Conversation' } : { dshSidebarTasks: value },
    ...extra,
  }
}

test('countTodos separates completed, in-progress and pending rows', () => {
  const counts = countTodos([
    { content: 'a', status: 'pending' },
    { content: 'b', status: 'in_progress' },
    { content: 'c', status: 'completed' },
    { content: 'd', status: 'completed' },
  ])
  assert.equal(counts.total, 4)
  assert.equal(counts.completed, 2)
  assert.equal(counts.inProgress, 1)
  assert.equal(counts.pending, 1)
})

test('unfinishedCount ignores completed rows', () => {
  assert.equal(unfinishedCount([{ content: 'a', status: 'completed' }]), 0)
  assert.equal(unfinishedCount([
    { content: 'a', status: 'pending' },
    { content: 'b', status: 'in_progress' },
    { content: 'c', status: 'completed' },
  ]), 2)
})

test('statusLabel localizes every lifecycle state', () => {
  const t = key => key
  assert.equal(statusLabel('pending', t), 'status.pending')
  assert.equal(statusLabel('in_progress', t), 'status.in_progress')
  assert.equal(statusLabel('completed', t), 'status.completed')
})

test('format interpolates named placeholders and keeps unknown ones', () => {
  assert.equal(format('任务 · {count}', { count: 2 }), '任务 · 2')
  assert.equal(format('{a} {b}', { a: 'x' }), 'x {b}')
  assert.equal(format('plain'), 'plain')
})

test('readTaskProjection accepts the Host shape and drops malformed rows', () => {
  const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(readTaskProjection({
    todos: [
      { content: 'kept', status: 'pending' },
      { content: '', status: 'pending' },
      { content: 'x', status: 'unknown' },
    ],
    time: 42,
  })), {
    todos: [{ content: 'kept', status: 'pending' }],
    time: 42,
  })
  assert.deepEqual(plain(readTaskProjection({ todos: [{ content: 'a', status: 'completed' }] })), {
    todos: [{ content: 'a', status: 'completed' }],
    time: 0,
  })
  assert.equal(readTaskProjection(null), undefined)
  assert.equal(readTaskProjection(undefined), undefined)
  assert.equal(readTaskProjection({ todos: [] }), undefined)
  assert.equal(readTaskProjection({ todos: 'nope' }), undefined)
})

test('pickCurrentTaskTurn prefers the live projection of the mounted session', () => {
  const source = pickCurrentTaskTurn(
    projection([{ content: 'live', status: 'in_progress' }], 9000),
    row('/work', projection([{ content: 'stale row', status: 'completed' }], 8000)),
    's1',
  )
  assert.equal(source.sessionId, 's1')
  assert.equal(source.title, 'Conversation')
  assert.equal(source.cwd, '/work')
  assert.equal(source.time, 9000)
  assert.deepEqual(JSON.parse(JSON.stringify(source.todos)), [{ content: 'live', status: 'in_progress' }])
})

test('pickCurrentTaskTurn falls back to the mounted row before the baseline lands', () => {
  const source = pickCurrentTaskTurn(
    undefined,
    row('/work/project', projection([{ content: 'row', status: 'pending' }], 7000)),
    's1',
  )
  assert.equal(source.sessionId, 's1')
  assert.equal(source.cwd, '/work/project')
  assert.equal(source.time, 7000)
  assert.deepEqual(JSON.parse(JSON.stringify(source.todos)), [{ content: 'row', status: 'pending' }])
})

test('pickCurrentTaskTurn is empty when the mounted conversation has no checklist', () => {
  assert.equal(pickCurrentTaskTurn(null, row('/work', null), 's1'), undefined)
  assert.equal(pickCurrentTaskTurn(undefined, row('/work', undefined), 's1'), undefined)
  assert.equal(pickCurrentTaskTurn(undefined, undefined, 's1'), undefined)
})

test('a live null (baseline loaded, no tasks) never falls back to a stale row', () => {
  const stale = row('/work', projection([{ content: 'old', status: 'completed' }], 1000))
  assert.equal(pickCurrentTaskTurn(null, stale, 's1'), undefined)
})

test('a live empty listing is authoritative too', () => {
  const stale = row('/work', projection([{ content: 'old', status: 'completed' }], 1000))
  assert.equal(pickCurrentTaskTurn({ todos: [], time: 0 }, stale, 's1'), undefined)
})

test('basenameOf extracts the last path segment', () => {
  assert.equal(basenameOf('/home/zhaodan/work/DeepseekChat'), 'DeepseekChat')
  assert.equal(basenameOf('/home/zhaodan/work/DeepseekChat/'), 'DeepseekChat')
  assert.equal(basenameOf('C:\\work\\project'), 'project')
  assert.equal(basenameOf(''), '')
  assert.equal(basenameOf(undefined), '')
})

test('joinPath and relativeToRoot keep workspace paths consistent', () => {
  assert.equal(joinPath('', 'README.md'), 'README.md')
  assert.equal(joinPath('src', 'app.ts'), 'src/app.ts')
  assert.equal(joinPath('src/', 'app.ts'), 'src/app.ts')
  assert.equal(relativeToRoot('/w/proj', '/w/proj/README.md'), 'README.md')
  assert.equal(relativeToRoot('/w/proj/', '/w/proj/src/app.ts'), 'src/app.ts')
  assert.equal(relativeToRoot('/w/proj', '/w/proj'), '')
  assert.equal(relativeToRoot('.', './src/app.ts'), 'src/app.ts')
  assert.equal(relativeToRoot('', './README.md'), 'README.md')
})

test('fileAddress builds the native preview resource address', () => {
  assert.equal(fileAddress('s1', 'README.md'), 'dsh-resource://file/session/s1/README.md')
  assert.equal(fileAddress('s1', 'src/a b.ts'), 'dsh-resource://file/session/s1/src/a%20b.ts')
  assert.equal(fileAddress('s 1', 'C:/x/y#1.txt'), 'dsh-resource://file/session/s%201/C:/x/y%231.txt')
})

test('orderFileEntries puts directories first and sorts names naturally', () => {
  const ordered = orderFileEntries([
    { name: 'file10.txt', type: 'file' },
    { name: 'src', type: 'directory' },
    { name: 'file2.txt', type: 'file' },
    { name: 'lib', type: 'directory' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(ordered.map(entry => entry.name))), ['lib', 'src', 'file2.txt', 'file10.txt'])
})

test('fileTone tints known extensions like the native tree', () => {
  assert.equal(fileTone('a.ts'), 'code')
  assert.equal(fileTone('README.md'), 'doc')
  assert.equal(fileTone('package.json'), 'data')
  assert.equal(fileTone('logo.SVG'), 'image')
  assert.equal(fileTone('clip.mp4'), 'media')
  assert.equal(fileTone('Makefile'), 'other')
  assert.equal(fileTone('a.'), 'other')
})

test('isWideKind widens preview-like native tabs only', () => {
  for (const kind of ['text', 'changes-review', 'files', 'terminal', 'browser', 'plan', 'subagent', 'subagentchat', 'scheduleTask']) {
    assert.equal(isWideKind(kind), true, kind)
  }
  for (const kind of ['tasks', 'guide', 'unknown', '']) {
    assert.equal(isWideKind(kind), false, kind)
  }
})

test('nativeCloseOverlayFor covers native pages that have no visible X', () => {
  // Terminal has no document toolbar: its floating X is the only close route.
  assert.equal(nativeCloseOverlayFor('terminal', false), true)
  // A readable file preview carries the document toolbar X, so the overlay stays away.
  assert.equal(nativeCloseOverlayFor('text', true), false)
  // A preview whose file cannot be read has no toolbar at all: the overlay is the
  // only way to close the tab, which otherwise lingers in the open-tab record.
  assert.equal(nativeCloseOverlayFor('text', false), true)
  // Other native pages are closed by the header X.
  for (const kind of ['files', 'browser', 'plan', 'subagent', 'changes-review', 'tasks', 'guide', 'unknown', '']) {
    assert.equal(nativeCloseOverlayFor(kind, false), false, kind)
  }
  // No tab on screen.
  assert.equal(nativeCloseOverlayFor(undefined, false), false)
})

test('column widths stay in their designed ranges', () => {
  assert.equal(narrowWidthFor(1920), 420)
  assert.equal(narrowWidthFor(1280), 384)
  assert.equal(narrowWidthFor(1024), 320)
  assert.equal(narrowWidthFor(600), 320)
  assert.equal(wideWidthFor(1920), 864)
  assert.equal(wideWidthFor(1280), 576)
})

test('normalizeSectionState keeps the current section defaults and keys', () => {
  const plain = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(normalizeSectionState(undefined)), {
    progress: true, workspace: true, terminal: true, context: true,
  })
  assert.deepEqual(plain(normalizeSectionState({ progress: false, workspace: false, terminal: false, context: false })), {
    progress: false, workspace: false, terminal: false, context: false,
  })
  assert.deepEqual(plain(normalizeSectionState({ progress: 'no', files: 0, scratchpad: true })), {
    progress: true, workspace: true, terminal: true, context: true,
  })
  assert.deepEqual(plain(normalizeSectionState(null)), {
    progress: true, workspace: true, terminal: true, context: true,
  })
})

test('readSkillUsage validates call and gesture count maps', () => {
  const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(readSkillUsage({ calls: { a: 2, bad: 0 }, gestures: { b: 1 } })), {
    calls: { a: 2 }, gestures: { b: 1 },
  })
  assert.deepEqual(plain(readSkillUsage({ calls: { a: 1 }, gestures: {} })), {
    calls: { a: 1 }, gestures: {},
  })
  assert.equal(readSkillUsage(null), undefined)
  assert.equal(readSkillUsage({ calls: {}, gestures: {} }), undefined)
  assert.equal(readSkillUsage({ calls: { 'bad name': 2 } }), undefined)
})

test('readSkillNames reads remote.skills.list values', () => {
  assert.deepEqual([...readSkillNames({ skills: [{ name: 'a' }, { name: 'b' }, { name: '' }] })], ['a', 'b'])
  assert.equal(readSkillNames({ skills: [] })?.size, 0)
  assert.equal(readSkillNames(null), undefined)
  assert.equal(readSkillNames({}), undefined)
})

test('mergeSkillUsage combines tool calls and catalog-filtered gestures', () => {
  const usage = {
    calls: { a: 2, b: 1 },
    gestures: { a: 1, notASkill: 5 },
  }
  const plain = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(mergeSkillUsage(usage, new Set(['a', 'b']))), {
    total: 4,
    skillCount: 2,
    rows: [{ name: 'a', count: 3 }, { name: 'b', count: 1 }],
  })
  assert.deepEqual(plain(mergeSkillUsage(usage, undefined)), {
    total: 3,
    skillCount: 2,
    rows: [{ name: 'a', count: 2 }, { name: 'b', count: 1 }],
  })
})
