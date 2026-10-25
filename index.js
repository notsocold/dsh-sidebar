/**
 * dsh-sidebar Host half.
 *
 * The plugin's visible capability lives in the browser half (client.js): a
 * Claude Desktop-style right Sidebar page with same-level Progress, Working
 * directory, Terminal and Context sections, a sidebar toggle in the conversation
 * header, wide-page X controls, and the composer todo bar moved into the sidebar.
 *
 * The Host half contributes two Session projections:
 * - `dshSidebarTasks` keeps the most recent non-empty `todo/write` list per
 *   conversation and never clears it on `turn/start`; this is the Progress
 *   section's data source.
 * - `dshSidebarSkillUsage` counts this conversation's `skill` tool calls and
 *   explicit first-line `/<name>` gestures, so the Context section can show a
 *   derived skill usage summary (DSH has no native usage-stats API).
 *
 * No HTTP route, no storage, and no Harness package import: both projections are
 * registered through the public `ctx.sessionProjections` service.
 *
 * @module @local/dsh-sidebar
 */

import { createSidebarTasksProjection } from './lib/tasks.js'
import { createSkillUsageProjection } from './lib/skills.js'

/** Cordis plugin name. */
export const name = 'dsh-sidebar'

/**
 * Host plugin entry: register the Sidebar's task projection.
 *
 * The service is optional so a profile without session projections leaves the
 * plugin loaded (its Web half simply shows no task history) instead of failing
 * the composition.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host root context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.inject(['sessionProjections'], (scoped) => {
    scoped.effect(async () => {
      for (const definition of [createSidebarTasksProjection(), createSkillUsageProjection()]) {
        try {
          await scoped.sessionProjections.register(definition)
        } catch (error) {
          scoped.logger?.warn?.(`dsh-sidebar: ${definition.key} projection registration failed`, error)
        }
      }
    }, 'dsh-sidebar: session projections')
  })
}
