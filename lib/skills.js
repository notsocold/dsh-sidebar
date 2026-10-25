/**
 * Host-side projection for this conversation's skill usage.
 *
 * DSH has no built-in skill usage counter. Both ways a skill is actually loaded
 * are visible in the Session log, however:
 *
 * - the model calls the built-in `skill` tool (`tool/call` with
 *   `name: 'skill'`), whose JSON arguments carry the skill name;
 * - the user types an explicit `/<skill-name>` gesture on the first line of a
 *   user message. The Host cannot know every skill name while folding (the
 *   catalog is async and layered), so it records the slash token; the Client
 *   intersects those tokens with the Session's user-invocable skill catalog
 *   (`remote.skills.list`) before displaying them.
 *
 * Everything is per Session and ignores a fork's inherited prefix, matching the
 * task projection's "this conversation only" scope.
 *
 * @module @local/dsh-sidebar/lib/skills
 */

/** Projection key visible to the browser half. */
export const SKILL_USAGE_KEY = 'dshSidebarSkillUsage'

/** Bump when the fold or the state shape changes. */
export const SKILL_USAGE_VERSION = 1

/** A conservative skill-name shape; the real catalog applies the final filter. */
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Permissive stand-in for the registry's Zod schemas (only `.parse` is called). */
const identitySchema = Object.freeze({
  parse: value => value,
  safeParse: value => ({ success: true, data: value }),
})

/**
 * Read one skill name from a slash token or a tool argument.
 * @param {unknown} value - candidate name.
 * @returns {string | undefined} normalized name.
 */
export function normalizeSkillName(value) {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  if (name === '' || name.length > 128) return undefined
  return SKILL_NAME_PATTERN.test(name) ? name : undefined
}

/**
 * Extract the first-line slash token from one user message event.
 * @param {unknown} content - `event.data.content` array.
 * @returns {string | undefined} skill name candidate.
 */
export function slashTokenOf(content) {
  if (!Array.isArray(content)) return undefined
  let text = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text
    }
  }
  if (text === '') return undefined
  const firstLine = text.split(/\r?\n/, 1)[0]
  const match = /^\s*\/([^\s/]+)(?:\s|$)/.exec(firstLine)
  return match === null ? undefined : normalizeSkillName(match[1])
}

/**
 * Copy one count map, adding one to one name.
 * @param {Record<string, number>} source - prior counts.
 * @param {string} name - skill name.
 * @returns {Record<string, number>} a fresh count map.
 */
function increment(source, name) {
  const next = { ...source }
  next[name] = (next[name] || 0) + 1
  return next
}

/**
 * Fold one committed Session event into this conversation's skill usage.
 *
 * Ignored events return the original state reference so the projection registry
 * publishes nothing.
 * @param {{ calls: Record<string, number>, gestures: Record<string, number>, inherited: number } | null} state - current state.
 * @param {{ type?: string, seq?: number, data?: Record<string, any> | null }} event - committed Session event.
 * @returns {typeof state} next state, or the same reference.
 */
export function foldSkillUsage(state, event) {
  if (event === null || typeof event !== 'object') return state
  const current = state === null || state === undefined
    ? { calls: {}, gestures: {}, inherited: 0 }
    : state
  const inherited = typeof current.inherited === 'number' && current.inherited > 0 ? current.inherited : 0
  if (inherited > 0 && typeof event.seq === 'number' && event.seq < inherited) return state
  const data = event.data
  if (data === null || typeof data !== 'object') return state

  if (event.type === 'tool/call') {
    if (data.name !== 'skill') return state
    let args
    try {
      args = typeof data.arguments === 'string' ? JSON.parse(data.arguments) : data.arguments
    } catch {
      return state
    }
    const name = normalizeSkillName(args === null || typeof args !== 'object' ? undefined : args.name)
    if (name === undefined) return state
    return { ...current, calls: increment(current.calls, name) }
  }

  if (event.type === 'user/message') {
    const source = data.source
    if (source === null || typeof source !== 'object' || source.kind !== 'user') return state
    const name = slashTokenOf(data.content)
    if (name === undefined) return state
    return { ...current, gestures: increment(current.gestures, name) }
  }

  return state
}

/**
 * Build the projection definition registered on `ctx.sessionProjections`.
 *
 * The view is `null` until the first usage event, and the same state reference
 * otherwise so the registry's `Object.is` change detection stays effective.
 * @returns {object} projection definition accepted by the registry.
 */
export function createSkillUsageProjection() {
  return {
    key: SKILL_USAGE_KEY,
    stateSchema: identitySchema,
    init: (_header, inheritedEventCount) => ({
      calls: {},
      gestures: {},
      inherited: typeof inheritedEventCount === 'number' ? inheritedEventCount : 0,
    }),
    apply: foldSkillUsage,
    wire: {
      viewSchema: identitySchema,
      view: state => {
        if (state === null || state === undefined) return null
        const calls = Object.keys(state.calls || {}).length
        const gestures = Object.keys(state.gestures || {}).length
        return calls === 0 && gestures === 0 ? null : state
      },
      summary: false,
    },
    stateVersion: SKILL_USAGE_VERSION,
  }
}
