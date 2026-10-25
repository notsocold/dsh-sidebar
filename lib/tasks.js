/**
 * Host-side projection for the sidebar's "latest task turn".
 *
 * The shipped `todos` projection is a standing plan: `turn/start` clears it to
 * null, so the right Sidebar loses the last checklist as soon as the model
 * begins another turn. The Sidebar instead needs the checklist of the most
 * recent turn that actually wrote tasks, even after later turns began. This
 * unit keeps every whole `todo/write` list whose array is non-empty and never
 * clears on `turn/start` or on a later empty write.
 *
 * The state is deliberately tiny and plain JSON:
 *   { todos: [{ content, status }], time: number, inherited: number }
 * `time` is the source event's wall-clock time, kept for display/debugging and
 * for ordering if a later version needs it. `inherited` is the fork/seed prefix
 * length: events before it belong to the parent Session, so a fork does not
 * inherit the parent's checklist into what the Client shows as the current
 * Session's tasks.
 *
 * @module @local/dsh-sidebar/lib/tasks
 */

/** Projection key visible to the browser half. */
export const SIDEBAR_TASKS_KEY = 'dshSidebarTasks'

/** Bump when the fold or the state shape changes; the projection cache keys on it. */
export const SIDEBAR_TASKS_VERSION = 1

/** Todo lifecycle states accepted from the log. */
const STATUSES = new Set(['pending', 'in_progress', 'completed'])

/**
 * A permissive stand-in for the Zod schemas the projection registry expects.
 *
 * The registry only calls `.parse(value)` on `stateSchema` / `viewSchema` (both
 * for live snapshots and the persisted projection cache); it does not require a
 * Zod instance at runtime. A pure-JS plugin cannot import the Harness' Zod, so
 * this identity parser keeps the boundary honest without a dependency.
 */
const identitySchema = Object.freeze({
  parse: value => value,
  // Some Zod call sites use safeParse; provide the same permissive behavior so
  // a future registry change does not turn this into a hard failure.
  safeParse: value => ({ success: true, data: value }),
})

/**
 * Copy the todo array out of one `todo/write` event, dropping malformed rows.
 * @param {unknown} value - the event's `data.todos` value.
 * @returns {{ content: string, status: string }[]} normalized tasks, possibly empty.
 */
export function normalizeTodos(value) {
  if (!Array.isArray(value)) return []
  const todos = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    if (typeof item.content !== 'string' || item.content === '') continue
    if (!STATUSES.has(item.status)) continue
    todos.push({ content: item.content, status: item.status })
  }
  return todos
}

/**
 * Fold one committed Session event into the last non-empty task list.
 *
 * Every other event returns the original state reference so the projection
 * registry publishes nothing and a long conversation costs one comparison.
 * A forked or seeded Session carries the parent's events before its own; those
 * prefix events are ignored, so the panel describes this Session only.
 * @param {{ todos: { content: string, status: string }[], time: number, inherited: number } | null} state - current state.
 * @param {{ type?: string, seq?: number, time?: number, data?: { todos?: unknown } | null }} event - committed Session event.
 * @returns {typeof state} next state, or the same reference when nothing changed.
 */
export function foldSidebarTasks(state, event) {
  if (event === null || typeof event !== 'object' || event.type !== 'todo/write') return state
  const current = state === null || state === undefined
    ? { todos: [], time: 0, inherited: 0 }
    : state
  const inherited = typeof current.inherited === 'number' && current.inherited > 0 ? current.inherited : 0
  if (inherited > 0 && typeof event.seq === 'number' && event.seq < inherited) return state
  const todos = normalizeTodos(event.data === null || event.data === undefined ? undefined : event.data.todos)
  if (todos.length === 0) return state
  const time = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0
  return { todos, time, inherited }
}

/**
 * Build the projection definition registered on `ctx.sessionProjections`.
 *
 * The unit is deliberately `summary: false`: the page is scoped to the
 * conversation on screen, so the value only needs the opened Session's control
 * baseline/frames, never every list row.
 * @returns {object} projection definition accepted by the registry.
 */
export function createSidebarTasksProjection() {
  return {
    key: SIDEBAR_TASKS_KEY,
    stateSchema: identitySchema,
    init: (_header, inheritedEventCount) => ({
      todos: [],
      time: 0,
      inherited: typeof inheritedEventCount === 'number' ? inheritedEventCount : 0,
    }),
    apply: foldSidebarTasks,
    wire: {
      viewSchema: identitySchema,
      // Keep the same state reference when it has tasks (change detection is
      // Object.is), and publish `null` rather than an empty object otherwise.
      view: state => state !== null && state !== undefined && Array.isArray(state.todos) && state.todos.length > 0
        ? state
        : null,
      summary: false,
    },
    stateVersion: SIDEBAR_TASKS_VERSION,
  }
}
