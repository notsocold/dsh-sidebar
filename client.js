/**
 * dsh-sidebar browser half: a Claude Desktop-style right Sidebar page.
 *
 * v9 behaviour:
 * 1. One page, no tabs. The native dockkit tab strip is hidden entirely (no
 *    chip row, no fullscreen, no collapse control). The conversation header
 *    keeps only the sidebar toggle (plus an X for other wide native pages);
 *    terminal now lives in its own Sidebar section.
 * 2. Sections: Progress (latest task-writing turn with a progress bar), Working
 *    directory (native-style lazy tree; files open the native text preview),
 *    Terminal (one "new terminal" action) and Context (skill usage and memory).
 *    All four are same-level collapsible sections; working directory and
 *    terminal default to open.
 * 3. The narrow session column has a fixed width: the outer resize handle is
 *    hidden while this page is active, and overflow text in task/skill/memory/
 *    file rows is ellipsized with the full value available on hover.
 * 4. Wide pages close with an X that never collapses the Sidebar: file previews
 *    put it at the far right of the reload row, the terminal gets a floating X
 *    at the page's top-right, and other native pages use the header X. The
 *    Sidebar itself is opened/closed only by the sidebar toggle.
 * 5. The Sidebar starts closed on load. Its open/closed state is preserved
 *    across Session switches: closed stays closed, open stays open. Opening on
 *    a switch activates this plugin's session page. Nothing auto-opens the
 *    Sidebar, so the default and the user's explicit choice stay authoritative.
 *    Persisted per-Session layouts (`dsh.sidebar-right.v1.*`) are sanitized to
 *    `expanded: false` on startup and synced on every switch; a 1.5s guard after
 *    a switch corrects a stale layout that tries to reopen the column.
 * 6. "Most recent turn with tasks" is read from the Host `dshSidebarTasks`
 *    projection, not the shipped `todos` projection. `todos` is deliberately a
 *    standing plan whose `turn/start` clears it; `dshSidebarTasks` keeps the
 *    mounted conversation's last non-empty `todo/write` list. The page is scoped
 *    to the conversation on screen and never shows another conversation's tasks.
 * 7. Actions that open a native page widen the column synchronously before
 *    opening, so a preview never appears at the narrow width first.
 *
 * Everything here is registration-only: no Harness package import, no Host
 * route, no Host storage. Task and skill-usage data arrive through Session
 * projections; the working-directory tree uses `remote.workspaceFiles` and
 * opens native previews; memory topics use the installed dsh-memory plugin's
 * same-origin route; the skill catalog arrives through `remote.skills.list`.
 */


window.__ModuleLoader__.load({
  id: '@local/dsh-sidebar',
  factory(require) {
    'use strict'

    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'dsh-sidebar'
    const TASKS_ID = '@local/dsh-sidebar/session'
    const PAGE_KIND = 'tasks'
    const GUIDE_KIND = 'guide'
    const STYLE_ID = 'dsh-sidebar-styles'
    const TASK_PROJECTION_KEY = 'dshSidebarTasks'
    const SKILL_USAGE_PROJECTION_KEY = 'dshSidebarSkillUsage'
    const WIDTH_POLL_MS = 300
    const NARROW_WIDTH_MIN = 320
    const NARROW_WIDTH_MAX = 420
    const NARROW_WIDTH_RATIO = 0.3
    const WIDE_WIDTH_RATIO = 0.45
    const MEMORY_LIMIT = 4
    const SKILL_USAGE_LIMIT = 3
    const FILE_ENTRY_LIMIT = 200
    const SECTION_STORAGE_PREFIX = 'dsh-sidebar:sections:'
    const SIDEBAR_LAYOUT_PREFIX = 'dsh.sidebar-right.v1.'

    /** Native tab kinds that need the recommended wide column (preview-like content). */
    const WIDE_KINDS = new Set([
      'text',
      'changes-review',
      'files',
      'terminal',
      'browser',
      'plan',
      'subagent',
      'subagentchat',
      'scheduleTask',
    ])

    /* ------------------------------ copy ------------------------------ */

    const zh = {
      'type.title': '会话',
      'guide.title': '会话',
      'guide.description': '当前对话的进度、文件与上下文',
      'section.progress': '进度',
      'section.terminal': '终端',
      'workspace.title': '工作目录',
      'workspace.loading': '载入中…',
      'workspace.error': '无法读取目录',
      'workspace.empty': '目录为空',
      'workspace.truncated': '仅显示部分条目',
      'workspace.other': '无法预览此条目',
      'section.context': '上下文',
      'tasks.empty': '暂无任务',
      'tasks.emptyHint': '这个对话还没有产生待办清单',
      'tasks.latestTurn': '最近有任务轮次',
      'tasks.completed': '已完成 {done}/{total}',
      'status.pending': '待处理',
      'status.in_progress': '进行中',
      'status.completed': '已完成',
      'context.memory': '记忆',
      'context.skills': '技能',
      'skills.empty': '本会话尚未使用技能',
      'terminal.new': '新建终端',
      'sidebar.toggle': '切换侧栏',
      'sidebar.close': '关闭选项卡',
      'section.collapse': '收起此分区',
      'section.expand': '展开此分区',
    }

    const en = {
      'type.title': 'Session',
      'guide.title': 'Session',
      'guide.description': 'Progress, files and context for this conversation',
      'section.progress': 'Progress',
      'section.terminal': 'Terminal',
      'workspace.title': 'Working directory',
      'workspace.loading': 'Loading…',
      'workspace.error': 'Could not read this directory',
      'workspace.empty': 'Empty directory',
      'workspace.truncated': 'Some entries are hidden',
      'workspace.other': 'This entry cannot be previewed',
      'section.context': 'Context',
      'tasks.empty': 'No tasks yet',
      'tasks.emptyHint': 'This conversation has not planned any tasks',
      'tasks.latestTurn': 'Latest task turn',
      'tasks.completed': '{done}/{total} done',
      'status.pending': 'Pending',
      'status.in_progress': 'In progress',
      'status.completed': 'Completed',
      'context.memory': 'Memory',
      'context.skills': 'Skills',
      'skills.empty': 'No skills used in this conversation',
      'terminal.new': 'New terminal',
      'sidebar.toggle': 'Toggle sidebar',
      'sidebar.close': 'Close tab',
      'section.collapse': 'Collapse this section',
      'section.expand': 'Expand this section',
    }

    /**
     * Replace `{name}` placeholders in one localized template.
     * @param {string} text - template text.
     * @param {Record<string, unknown>} [params] - replacement values.
     * @returns {string} interpolated text.
     */
    function format(text, params) {
      if (params === undefined || params === null) return text
      return text.replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      ))
    }

    /* ------------------------------ model ------------------------------ */

    /**
     * Count one todo list by lifecycle state.
     * @param {{ content: string, status: string }[]} items - todo list.
     * @returns {{ total: number, completed: number, inProgress: number, pending: number }}
     */
    function countTodos(items) {
      let completed = 0
      let inProgress = 0
      for (const item of items) {
        if (item.status === 'completed') completed += 1
        else if (item.status === 'in_progress') inProgress += 1
      }
      const total = items.length
      return { total, completed, inProgress, pending: total - completed - inProgress }
    }

    /**
     * Count the entries still needing work (pending + in progress).
     * @param {{ content: string, status: string }[]} items - todo list.
     * @returns {number} unfinished count.
     */
    function unfinishedCount(items) {
      const counts = countTodos(items)
      return counts.total - counts.completed
    }

    /**
     * Localize one todo status for its row chip.
     * @param {string} status - todo lifecycle state.
     * @param {Function} t - locale translate function.
     * @returns {string} localized status label.
     */
    function statusLabel(status, t) {
      if (status === 'completed') return t('status.completed')
      if (status === 'in_progress') return t('status.in_progress')
      return t('status.pending')
    }

    /**
     * Validate the Host `dshSidebarTasks` value.
     *
     * The projection may be absent while the Host half reloads or for a
     * conversation that never wrote a task, so every browser read goes through
     * this guard rather than trusting the projection map.
     * @param {unknown} value - projection value.
     * @returns {{ todos: { content: string, status: string }[], time: number } | undefined} usable value.
     */
    function readTaskProjection(value) {
      if (value === null || typeof value !== 'object') return undefined
      const source = value
      const raw = Array.isArray(source.todos) ? source.todos : undefined
      if (raw === undefined) return undefined
      const todos = []
      for (const item of raw) {
        if (item === null || typeof item !== 'object') continue
        if (typeof item.content !== 'string' || item.content === '') continue
        if (item.status !== 'pending' && item.status !== 'in_progress' && item.status !== 'completed') continue
        todos.push({ content: item.content, status: item.status })
      }
      if (todos.length === 0) return undefined
      const time = typeof source.time === 'number' && Number.isFinite(source.time) ? source.time : 0
      return { todos, time }
    }

    /**
     * The mounted conversation's most recent task list.
     *
     * The live projection wins over the list row because the list hint can
     * trail by one frame; the row is only a fallback for the moment before the
     * live control baseline lands. The panel is intentionally scoped to the
     * conversation on screen: no other conversation's checklist is ever shown.
     * @param {unknown} liveValue - mounted session's live projection value.
     * @param {any} row - mounted session's list row.
     * @param {string} currentSessionId - mounted session id.
     * @returns {{ sessionId: string, title: string, cwd?: string, time: number, todos: any[] } | undefined}
     */
    function pickCurrentTaskTurn(liveValue, row, currentSessionId) {
      const fromRow = row === undefined || row === null || row.projectionValues === undefined
        ? undefined
        : row.projectionValues[TASK_PROJECTION_KEY]
      const live = readTaskProjection(liveValue)
      // Any defined live value is authoritative, including `null` (loaded, no
      // checklist) and an empty list; only an undefined live value (baseline
      // not landed yet) may use the row hint.
      const value = live !== undefined
        ? live
        : liveValue === undefined ? readTaskProjection(fromRow) : undefined
      if (value === undefined) return undefined
      return {
        sessionId: currentSessionId,
        title: row === undefined || row === null ? '' : row.displayTitle,
        cwd: row === undefined || row === null ? undefined : row.cwd,
        time: value.time,
        todos: value.todos,
      }
    }

    /**
     * Validate the Host `dshSidebarSkillUsage` value.
     * @param {unknown} value - projection value.
     * @returns {{ calls: Record<string, number>, gestures: Record<string, number> } | undefined} usable usage.
     */
    function readSkillUsage(value) {
      if (value === null || typeof value !== 'object') return undefined
      const accepted = name => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
      const collect = source => {
        const result = {}
        if (source === null || typeof source !== 'object') return result
        for (const [name, count] of Object.entries(source)) {
          if (!accepted(name)) continue
          if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue
          result[name] = Math.round(count)
        }
        return result
      }
      const calls = collect(value.calls)
      const gestures = collect(value.gestures)
      if (Object.keys(calls).length === 0 && Object.keys(gestures).length === 0) return undefined
      return { calls, gestures }
    }

    /**
     * Read the user-invocable skill names from a `remote.skills.list` result.
     * @param {unknown} value - `{ skills: [{ name }] }` value.
     * @returns {Set<string> | undefined} names, or undefined when the payload is unusable.
     */
    function readSkillNames(value) {
      if (value === null || typeof value !== 'object' || !Array.isArray(value.skills)) return undefined
      const names = new Set()
      for (const skill of value.skills) {
        if (skill !== null && typeof skill === 'object' && typeof skill.name === 'string' && skill.name !== '') {
          names.add(skill.name)
        }
      }
      return names
    }

    /**
     * Merge tool-call counts with explicit slash gestures, filtering gestures
     * through the Session's user-invocable catalog when it is available.
     * @param {{ calls: Record<string, number>, gestures: Record<string, number> }} usage - validated usage.
     * @param {Set<string> | undefined} catalogNames - user-invocable skill names, or undefined.
     * @returns {{ total: number, skillCount: number, rows: { name: string, count: number }[] }} merged usage.
     */
    function mergeSkillUsage(usage, catalogNames) {
      const counts = new Map()
      const add = (name, count) => {
        counts.set(name, (counts.get(name) || 0) + count)
      }
      for (const [name, count] of Object.entries(usage.calls)) add(name, count)
      // Slash gestures include slash commands that are not skills, so they are
      // only trustworthy once the Session's user-invocable catalog is known.
      if (catalogNames !== undefined) {
        for (const [name, count] of Object.entries(usage.gestures)) {
          if (!catalogNames.has(name)) continue
          add(name, count)
        }
      }
      let total = 0
      for (const count of counts.values()) total += count
      const rows = [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      return { total, skillCount: rows.length, rows: rows.slice(0, SKILL_USAGE_LIMIT) }
    }

    /**
     * Last path segment of a project path, for the panel's meta line.
     * @param {unknown} path - absolute directory path.
     * @returns {string} basename, or an empty string.
     */
    function basenameOf(path) {
      if (typeof path !== 'string') return ''
      const trimmed = path.replace(/[\\/]+$/, '')
      const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
      return index === -1 ? trimmed : trimmed.slice(index + 1)
    }

    /**
     * Join one workspace-relative path with a child name.
     * @param {string} parent - parent workspace path, empty for the root.
     * @param {string} name - child basename.
     * @returns {string} child path with `/` separators.
     */
    function joinPath(parent, name) {
      if (parent === '') return name
      return parent.replace(/\/+$/, '') + '/' + name
    }

    /**
     * Turn one tree path (absolute when the Session reports a cwd) into the
     * workspace-relative path the native file preview address expects.
     * @param {string | undefined} root - Session workspace root; `.` for a root-relative tree.
     * @param {string} path - absolute or root-joined path.
     * @returns {string} workspace-relative path, empty for the root itself.
     */
    function relativeToRoot(root, path) {
      const normalizedRoot = String(root === undefined ? '' : root).replace(/\\/g, '/').replace(/\/+$/, '')
      const normalizedPath = String(path === undefined ? '' : path).replace(/\\/g, '/')
      if (normalizedRoot === '' || normalizedRoot === '.') {
        return normalizedPath.replace(/^(?:\.\/)+/, '')
      }
      if (normalizedPath === normalizedRoot) return ''
      if (normalizedPath.startsWith(normalizedRoot + '/')) {
        return normalizedPath.slice(normalizedRoot.length + 1)
      }
      return normalizedPath.replace(/^(?:\.\/)+/, '')
    }

    /**
     * Encode one path segment, keeping a Windows drive colon literal.
     * @param {string} segment - one `/`-separated path segment.
     * @returns {string} URI component.
     */
    function encodeFileSegment(segment) {
      return encodeURIComponent(segment).replace(/%3A/gi, ':')
    }

    /**
     * Build the `dsh-resource://file/session/...` address the native text
     * preview claims.
     * @param {string} sessionId - Session that owns the workspace root.
     * @param {string} path - workspace-relative `/`-separated path.
     * @returns {string} resource address.
     */
    function fileAddress(sessionId, path) {
      const normalized = String(path).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      const encoded = normalized.split('/').map(encodeFileSegment).join('/')
      return 'dsh-resource://file/session/' + encodeURIComponent(sessionId) + '/' + encoded
    }

    /**
     * Whether a native tab kind needs the recommended wide column.
     * @param {string} kind - tab kind.
     * @returns {boolean} true for preview-like content tabs.
     */
    function isWideKind(kind) {
      return WIDE_KINDS.has(kind)
    }

    /**
     * Narrow column width for the context panel.
     * @param {number} viewport - frame width in px.
     * @returns {number} width in px.
     */
    function narrowWidthFor(viewport) {
      const scaled = Math.round(viewport * NARROW_WIDTH_RATIO)
      return Math.min(NARROW_WIDTH_MAX, Math.max(NARROW_WIDTH_MIN, scaled))
    }

    /**
     * Recommended width for preview-like native tabs (the shipped 45% default).
     * @param {number} viewport - frame width in px.
     * @returns {number} width in px.
     */
    function wideWidthFor(viewport) {
      return Math.round(viewport * WIDE_WIDTH_RATIO)
    }

    /**
     * Normalize the persisted per-session section state.
     * @param {unknown} value - parsed local storage value.
     * @returns {{ progress: boolean, workspace: boolean, terminal: boolean, context: boolean }} state.
     */
    function normalizeSectionState(value) {
      const source = value !== null && typeof value === 'object' ? value : {}
      return {
        progress: source.progress !== false,
        workspace: source.workspace !== false,
        terminal: source.terminal !== false,
        context: source.context !== false,
      }
    }

    /**
     * Read the persisted per-session section state, falling back to defaults.
     * @param {string} sessionId - owning session id.
     * @returns {{ progress: boolean, workspace: boolean, terminal: boolean, context: boolean }} state.
     */
    function readSectionState(sessionId) {
      try {
        const raw = window.localStorage.getItem(SECTION_STORAGE_PREFIX + sessionId)
        return normalizeSectionState(raw === null ? undefined : JSON.parse(raw))
      } catch {
        return normalizeSectionState(undefined)
      }
    }

    /* ------------------------------ artwork ------------------------------ */

    /**
     * Checklist artwork used by the empty state and the guide card.
     * @param {{ size?: number, className?: string }} props - artwork props.
     * @returns {import('react').ReactElement} inline SVG.
     */
    function ChecklistArtwork({ size = 16, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', className, 'aria-hidden': 'true',
      },
      h('rect', {
        x: 3.2, y: 4.2, width: 17.6, height: 15.6, rx: 3.6,
        stroke: 'currentColor', strokeWidth: 1.6,
      }),
      h('path', {
        d: 'M7.4 9.4l1.5 1.5 2.7-2.9',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M13.6 9.6h3.4M7.4 15.2h9.6',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round',
      }))
    }

    /**
     * Status glyph for one todo row.
     * @param {string} status - todo lifecycle state.
     * @returns {import('react').ReactElement} inline SVG.
     */
    function statusGlyph(status) {
      if (status === 'completed') {
        return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
          h('circle', { cx: 8, cy: 8, r: 8, fill: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, var(--dsw-alias-brand-primary))' }),
          h('path', {
            d: 'M4.7 8.2l2.1 2.1 4.5-4.7',
            fill: 'none', stroke: '#fff', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
          }))
      }
      if (status === 'in_progress') {
        return h('svg', {
          className: 'dsh-sidebar-spinner', width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true',
        },
        h('circle', {
          cx: 8, cy: 8, r: 6.4, fill: 'none',
          stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M8 1.6a6.4 6.4 0 0 1 6.4 6.4',
          fill: 'none', stroke: 'var(--dsw-alias-state-warn-primary)',
          strokeWidth: 1.6, strokeLinecap: 'round',
        }))
      }
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        h('circle', {
          cx: 8, cy: 8, r: 6.4, fill: 'none',
          stroke: 'var(--dsw-alias-label-secondary)', strokeWidth: 1.4,
        }))
    }

    /**
     * Small chevron for section and directory rows.
     * @param {{ open?: boolean, size?: number, className?: string }} props - open state.
     * @returns {import('react').ReactElement} inline SVG.
     */
    function Chevron({ open, size = 14, className }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        className: 'dsh-sidebar-chevron' + (open === false ? ' dsh-sidebar-chevron-collapsed' : '') + (className === undefined ? '' : ' ' + className),
        'aria-hidden': 'true',
      },
      h('path', {
        d: 'M4 6l4 4 4-4', stroke: 'currentColor', strokeWidth: 1.6,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /** @returns {import('react').ReactElement} a 16px document glyph. */
    function FileIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M4.2 2.2h4.4l3.2 3.2v8.2c0 .5-.4.9-.9.9H4.2a.9.9 0 0 1-.9-.9V3.1c0-.5.4-.9.9-.9Z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }),
        h('path', { d: 'M8.4 2.4v3.2h3.2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }))
    }

    /**
     * X at the far right of the document preview's reload row. It closes the
     * wide preview tab and returns to the remembered parent page.
     * @param {{ t: Function, closeTab: Function }} props - locale and action.
     * @returns {import('react').ReactElement} document toolbar button.
     */
    function DocumentCloseButton(props) {
      const t = props.t
      return h('button', {
        type: 'button',
        className: 'dsh-sidebar-document-close',
        title: t('sidebar.close'),
        'aria-label': t('sidebar.close'),
        onClick: () => {
          try {
            props.closeTab()
          } catch {
            // The preview tab may already be gone.
          }
        },
      }, h(CloseGlyph))
    }

    /**
     * Floating X over a native wide page that has no document toolbar row
     * (terminal and other non-document pages). It is portaled into the right
     * panel so it sits at the page's right edge; it closes only that wide tab.
     * @param {{ t: Function, readActive: Function, closeTab: Function }} props - locale and faces.
     * @returns {import('react').ReactNode} portal or null.
     */
    function NativePageCloseOverlay(props) {
      const t = props.t
      const [state, setState] = React.useState({ target: null, show: false })
      const latest = React.useRef(props)
      latest.current = props

      React.useEffect(() => {
        const update = () => {
          const target = document.querySelector('[data-sidebar-right-session][data-sidebar-right-open]')
          const active = latest.current.readActive()
          const show = target !== null && active !== undefined && active.kind === 'terminal'
          setState(previous => (
            previous.target === target && previous.show === show
              ? previous
              : { target, show }
          ))
        }
        update()
        const timer = setInterval(update, 250)
        return () => clearInterval(timer)
      }, [])

      if (!state.show || state.target === null) return null
      return ReactDOM.createPortal(
        h('button', {
          type: 'button',
          className: 'dsh-sidebar-native-close',
          title: t('sidebar.close'),
          'aria-label': t('sidebar.close'),
          onClick: () => {
            try {
              latest.current.closeTab()
            } catch {
              // The terminal tab may already be gone.
            }
          },
        }, h(CloseGlyph)),
        state.target,
      )
    }

    /** @returns {import('react').ReactElement} a 16px sidebar/panel glyph. */
    function SidebarGlyph() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', {
          x: 2.2, y: 3, width: 11.6, height: 10, rx: 2,
          stroke: 'currentColor', strokeWidth: 1.3,
        }),
        h('path', { d: 'M6.3 3v10', stroke: 'currentColor', strokeWidth: 1.3 }))
    }

    /** @returns {import('react').ReactElement} a 16px close glyph. */
    function CloseGlyph() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        }))
    }

    /**
     * Toggle the right Sidebar from the conversation header. This replaces the
     * native corner expand control that now lives in the same utilities row.
     * @param {{ t: Function, toggleSidebar: Function }} props - locale and action.
     * @returns {import('react').ReactElement} header button.
     */
    function SidebarToggleButton(props) {
      const t = props.t
      return h('button', {
        type: 'button',
        className: 'dsh-sidebar-header-button',
        title: t('sidebar.toggle'),
        'aria-label': t('sidebar.toggle'),
        onClick: () => {
          try {
            props.toggleSidebar()
          } catch {
            // No sidebar surface yet; the next click retries.
          }
        },
      }, h(SidebarGlyph))
    }

    /**
     * Header X for wide native pages that have no in-page toolbar X (Files,
     * browser, etc.). Terminal uses the floating overlay and document previews
     * use the reload-row X, so this button stays hidden for those kinds.
     * @param {{ t: Function, closePage: Function, readActive: Function, isOpen: Function }} props - faces.
     * @returns {import('react').ReactNode} header button or null.
     */
    function SidebarCloseButton(props) {
      const t = props.t
      const [show, setShow] = React.useState(false)
      const latest = React.useRef(props)
      latest.current = props

      React.useEffect(() => {
        const update = () => {
          const active = latest.current.readActive()
          const visible = latest.current.isOpen() === true
            && active !== undefined
            && active.kind !== PAGE_KIND
            && active.kind !== 'text'
            && active.kind !== 'terminal'
          setShow(previous => previous === visible ? previous : visible)
        }
        update()
        const timer = setInterval(update, 250)
        return () => clearInterval(timer)
      }, [])

      if (!show) return null
      return h('button', {
        type: 'button',
        className: 'dsh-sidebar-header-button dsh-sidebar-header-button-close',
        title: t('sidebar.close'),
        'aria-label': t('sidebar.close'),
        onClick: () => {
          try {
            latest.current.closePage()
          } catch {
            // Closing is best-effort; no surface means there is nothing to close.
          }
        },
      }, h(CloseGlyph))
    }

    /** @returns {import('react').ReactElement} a 16px folder glyph. */
    function FolderIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.2 4.1c0-.5.4-.9.9-.9h3l1.3 1.4h4.5c.5 0 .9.4.9.9v6.2c0 .5-.4.9-.9.9H3.1a.9.9 0 0 1-.9-.9V4.1Z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }))
    }

    /** @returns {import('react').ReactElement} an opened 16px folder glyph. */
    function FolderOpenIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M2.2 4.1c0-.5.4-.9.9-.9h3l1.3 1.4h4.5c.5 0 .9.4.9.9v1.1H2.2V4.1Z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M2.2 6.6h11.2l-1.2 5.4c-.1.5-.6.9-1.1.9H3.3c-.6 0-1-.4-1.1-.9L2.2 6.6Z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }))
    }

    /** @returns {import('react').ReactElement} a 16px terminal glyph. */
    function TerminalIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', {
          x: 1.8, y: 2.6, width: 12.4, height: 10.8, rx: 1.8,
          stroke: 'currentColor', strokeWidth: 1.3,
        }),
        h('path', {
          d: 'M4.4 5.7l2.2 2.2-2.2 2.2M8.4 10.3h3.1',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    /* ------------------------------ styles ------------------------------ */

    const CSS = `
.dsh-sidebar-page {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  font-size: 13px;
  line-height: 1.5;
  background: var(--dsw-alias-bg-base);
  overflow-y: auto;
  padding-bottom: 14px;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.dsh-sidebar-section {
  flex: none;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}

.dsh-sidebar-section:last-child {
  border-bottom: 0;
}

.dsh-sidebar-section-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 14px 12px 8px 16px;
}

.dsh-sidebar-section-toggle {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  color: inherit;
  cursor: pointer;
}

.dsh-sidebar-section-toggle:hover .dsh-sidebar-section-title {
  color: var(--dsw-alias-brand-primary);
}

.dsh-sidebar-section-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.35;
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-section-subtitle {
  flex: none;
  font-size: 11px;
  font-weight: 400;
  color: var(--dsw-alias-label-secondary);
}

.dsh-sidebar-section-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}

.dsh-sidebar-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-sidebar-icon-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-chevron-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-sidebar-chevron-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1));
}

.dsh-sidebar-chevron {
  transition: transform 150ms ease;
}

.dsh-sidebar-chevron-collapsed {
  transform: rotate(-90deg);
}

.dsh-sidebar-section-body {
  padding: 0 10px 12px;
}

.dsh-sidebar-section-body[hidden] {
  display: none !important;
}

.dsh-sidebar-group {
  margin: 2px 0 8px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-sidebar-group-label {
  margin: 5px 6px 3px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}

.dsh-sidebar-task-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-sidebar-task {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 5px 8px;
  border-radius: var(--dsw-radius-sm);
}

.dsh-sidebar-task:hover {
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-sidebar-task-glyph {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  min-height: 20px;
}

.dsh-sidebar-task-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 1.55;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-task[data-status='completed'] .dsh-sidebar-task-text {
  color: var(--dsw-alias-label-secondary);
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}

.dsh-sidebar-task[data-status='completed'] .dsh-sidebar-task-glyph {
  opacity: 0.9;
}

.dsh-sidebar-task[data-status='in_progress'] {
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-sidebar-spinner {
  animation: dsh-sidebar-spin 1s linear infinite;
}

@keyframes dsh-sidebar-spin {
  to { transform: rotate(360deg); }
}

.dsh-sidebar-task-count {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}

.dsh-sidebar-progress {
  height: 3px;
  margin: 2px 8px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
}

.dsh-sidebar-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-brand-primary-new-colorprimary-new-color, var(--dsw-alias-brand-primary));
  transition: width 160ms ease;
}

.dsh-sidebar-skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--dsw-radius-sm);
}

.dsh-sidebar-skill-row {
  transition: background-color 120ms ease;
}

.dsh-sidebar-skill-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 78%, black);
}

.dsh-sidebar-skill-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-skill-count {
  flex: none;
  padding: 0 7px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.dsh-sidebar-skill-empty {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-sidebar-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.dsh-sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 18px 16px 16px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
}

.dsh-sidebar-empty-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  margin-bottom: 4px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}

.dsh-sidebar-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-empty-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
}

.dsh-sidebar-memory-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--dsw-radius-sm);
}

.dsh-sidebar-memory-row {
  transition: background-color 120ms ease;
}

.dsh-sidebar-memory-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 78%, black);
}

.dsh-sidebar-memory-scope {
  flex: none;
  margin-top: 1px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
}

.dsh-sidebar-memory-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-workspace-root {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px 6px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}

.dsh-sidebar-workspace-root svg {
  flex: none;
}

.dsh-sidebar-workspace-root-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-sidebar-file-level {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-sidebar-file-level .dsh-sidebar-file-level {
  padding-left: 18px;
}

.dsh-sidebar-file-item {
  margin: 0;
  padding: 0;
}

.dsh-sidebar-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 5px 10px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}

@media (hover: hover) {
  .dsh-sidebar-file-row:hover {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  }
}

.dsh-sidebar-file-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}

.dsh-sidebar-file-icon[data-tone='code'] {
  color: var(--dsw-alias-brand-primary-new-colorprimary-new-color, var(--dsw-alias-brand-primary));
}

.dsh-sidebar-file-icon[data-tone='data'] {
  color: var(--dsw-alias-state-warn-primary);
}

.dsh-sidebar-file-icon[data-tone='doc'] {
  color: var(--dsw-alias-state-success-primary);
}

.dsh-sidebar-file-icon[data-tone='image'] {
  color: var(--dsw-alias-state-warn-primary);
}

.dsh-sidebar-file-icon[data-tone='media'] {
  color: var(--dsw-alias-label-secondary);
}

.dsh-sidebar-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-sidebar-file-other {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  cursor: default;
}

@media (hover: hover) {
  .dsh-sidebar-file-other:hover {
    background: transparent;
  }
}

.dsh-sidebar-file-note {
  margin: 0;
  padding: 3px 10px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font-size: 12px;
}

.dsh-sidebar-terminal-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.dsh-sidebar-terminal-row:hover {
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 78%, black);
  border-color: var(--dsw-alias-border-l2);
}

.dsh-sidebar-terminal-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-sidebar-terminal-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 500;
}

.dsh-sidebar-terminal-arrow {
  flex: none;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-secondary);
}

.dsh-sidebar-terminal-arrow .dsh-sidebar-chevron {
  transform: rotate(-90deg);
}

.dsh-sidebar-header-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-sidebar-header-button:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-header-button svg {
  width: 15px;
  height: 15px;
}

.dsh-sidebar-native-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-sm);
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 88%, transparent);
  color: var(--dsw-alias-label-secondary);
  pointer-events: auto;
  cursor: pointer;
  backdrop-filter: blur(2px);
}

.dsh-sidebar-native-close:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
}

.dsh-sidebar-native-close svg {
  width: 15px;
  height: 15px;
}

.dsh-sidebar-document-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-sidebar-document-close:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-primary);
}

.dsh-sidebar-document-close svg {
  width: 15px;
  height: 15px;
}

/* ---------------------------------------------------------------- */
/* No native tab row, fullscreen or collapse control.               */
/* The outer header buttons replace the sidebar toggle, and X closes */
/* the current page back to its parent. Native tab records still     */
/* exist underneath, but the user sees one page at a time.           */
/* ---------------------------------------------------------------- */

[data-sidebar-right-session] [data-dockkit-strip] {
  display: none !important;
}

[data-sidebar-right-expand] {
  display: none !important;
}

[data-conversation-header-corner]:has([data-sidebar-right-expand]) {
  display: none !important;
}

/* The narrow session page has a fixed width: no outer resize handle. */
body:has([data-sidebar-right-session] [data-dockkit-tab][aria-selected='true'] .dsh-sidebar-chip-title) [data-side='rightbar'] {
  display: none !important;
  pointer-events: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-sidebar-spinner { animation: none; }
  .dsh-sidebar-chevron { transition: none; }
  .dsh-sidebar-progress-fill { transition: none; }
}
`

    /**
     * Install the plugin stylesheet once, returning its cleanup.
     * @returns {() => void} disposer removing the stylesheet.
     */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      if (document.getElementById(STYLE_ID) !== null) return () => {}
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = CSS
      document.head.appendChild(element)
      return () => { element.remove() }
    }

    /* ------------------------------ projection fallback ------------------------------ */

    /** Session ids whose projection refresh was already requested this page life. */
    const refreshedCurrentProjections = new Set()

    /**
     * Ask the Host for the mounted session's projections once, for the case
     * where this plugin loaded after the session's control baseline was sent
     * (a plugin reload while the page stays open). A normal startup receives
     * the value in the baseline and never calls this.
     * @param {string} sessionId - mounted session id.
     * @param {(sessionId: string) => Promise<void> | undefined} refresh - refresh face.
     */
    function refreshCurrentProjection(sessionId, refresh) {
      if (typeof sessionId !== 'string' || sessionId === '') return
      if (refreshedCurrentProjections.has(sessionId)) return
      refreshedCurrentProjections.add(sessionId)
      try {
        const pending = refresh(sessionId)
        if (pending !== undefined && pending !== null && typeof pending.then === 'function') {
          pending.then(() => {}, () => {})
        }
      } catch {
        // Projection refresh is best-effort; the panel keeps its empty state.
      }
    }

    /* ------------------------------ shared components ------------------------------ */

    /**
     * One collapsible section in the Claude Desktop-style column.
     * @param {object} props - section props.
     * @returns {import('react').ReactNode} section.
     */
    function Section(props) {
      const t = props.t
      const toggle = props.onToggle
      return h('section', {
        className: 'dsh-sidebar-section' + (props.className === undefined ? '' : ' ' + props.className),
        'data-open': props.open ? 'true' : 'false',
      },
      h('div', { className: 'dsh-sidebar-section-head' },
        h('button', {
          type: 'button',
          className: 'dsh-sidebar-section-toggle',
          'aria-expanded': props.open,
          title: props.open ? t('section.collapse') : t('section.expand'),
          onClick: toggle,
        },
        h('span', { className: 'dsh-sidebar-section-title' }, props.title),
        props.subtitle === undefined ? null : h('span', { className: 'dsh-sidebar-section-subtitle' }, props.subtitle)),
        props.actions === undefined ? null : h('div', { className: 'dsh-sidebar-section-actions' }, props.actions),
        h('button', {
          type: 'button',
          className: 'dsh-sidebar-chevron-button',
          'aria-expanded': props.open,
          'aria-label': props.open ? t('section.collapse') : t('section.expand'),
          onClick: toggle,
        }, h(Chevron, { open: props.open }))),
      h('div', { className: 'dsh-sidebar-section-body', hidden: !props.open }, props.children))
    }

    /**
     * One todo row.
     * @param {{ item: { content: string, status: string }, t: Function }} props - row props.
     * @returns {import('react').ReactElement} list item.
     */
    function TaskRow({ item, t }) {
      return h('li', {
        className: 'dsh-sidebar-task',
        'data-status': item.status,
        title: item.content,
      },
      h('span', { className: 'dsh-sidebar-task-glyph', 'aria-hidden': 'true' }, statusGlyph(item.status)),
      h('span', { className: 'dsh-sidebar-task-text' }, item.content),
      h('span', { className: 'dsh-sidebar-sr-only' }, statusLabel(item.status, t)))
    }

    /* ------------------------------ tasks section ------------------------------ */

    /**
     * Progress section: the checklist of the most recent task-writing turn.
     * @param {object} props - section props plus task data.
     * @returns {import('react').ReactNode} section.
     */
    function ProgressSection(props) {
      const t = props.t
      const source = props.source
      const open = props.open
      const items = source === undefined ? [] : source.todos
      const counts = countTodos(items)
      const donePercent = counts.total === 0 ? 0 : Math.round((counts.completed / counts.total) * 100)
      const actions = source === undefined || counts.total === 0
        ? null
        : h('span', { className: 'dsh-sidebar-task-count' }, t('tasks.completed', { done: counts.completed, total: counts.total }))
      let body
      if (items.length === 0) {
        body = h('div', { className: 'dsh-sidebar-empty' },
          h('span', { className: 'dsh-sidebar-empty-icon', 'aria-hidden': 'true' }, h(ChecklistArtwork, { size: 18 })),
          h('p', { className: 'dsh-sidebar-empty-title' }, t('tasks.empty')),
          h('p', { className: 'dsh-sidebar-empty-hint' }, t('tasks.emptyHint')))
      } else {
        body = [
          h('div', {
            key: 'progress',
            className: 'dsh-sidebar-progress',
            role: 'progressbar',
            'aria-label': t('section.progress'),
            'aria-valuenow': donePercent,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
          }, h('div', { className: 'dsh-sidebar-progress-fill', style: { width: donePercent + '%' } })),
          h('ul', { key: 'list', className: 'dsh-sidebar-task-list', 'aria-label': t('section.progress') },
            items.map((item, index) => h(TaskRow, { key: index, item, t }))),
        ]
      }
      return h(Section, {
        t,
        title: t('section.progress'),
        subtitle: source === undefined ? undefined : t('tasks.latestTurn'),
        open,
        onToggle: props.onToggle,
        actions,
      }, body)
    }

    /* ------------------------------ workspace section ------------------------------ */

    /** Natural, case-insensitive name order for one directory level. */
    const FILE_NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

    /**
     * Order one level like the native file tree: directories first, then files,
     * each group by natural name order.
     * @param {readonly any[]} entries - directory entries.
     * @returns {any[]} ordered entries.
     */
    function orderFileEntries(entries) {
      return [...entries].sort((left, right) => {
        const group = Number(right.type === 'directory') - Number(left.type === 'directory')
        return group !== 0 ? group : FILE_NAME_COLLATOR.compare(left.name, right.name)
      })
    }

    /** File-name extension groups used to tint the sheet glyph like the native tree. */
    const FILE_TONES = new Map([
      ...['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'sh', 'bash', 'zsh', 'ps1']
        .map(extension => [extension, 'code']),
      ...['json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'env', 'lock']
        .map(extension => [extension, 'data']),
      ...['md', 'mdx', 'txt', 'rst', 'pdf', 'doc', 'docx']
        .map(extension => [extension, 'doc']),
      ...['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico']
        .map(extension => [extension, 'image']),
      ...['mp4', 'mp3', 'wav', 'mov']
        .map(extension => [extension, 'media']),
    ])

    /**
     * Pick the sheet tint group for one file name.
     * @param {string} name - file basename.
     * @returns {'code'|'data'|'doc'|'image'|'media'|'other'} tone.
     */
    function fileTone(name) {
      const dot = name.lastIndexOf('.')
      if (dot <= 0 || dot === name.length - 1) return 'other'
      return FILE_TONES.get(name.slice(dot + 1).toLowerCase()) || 'other'
    }

    /**
     * One directory level of the working-directory tree. The markup mirrors the
     * native Files body: nested 18px levels, 5×10px rows, folder/file glyphs and
     * an ellipsized name; a click on a file opens the native preview.
     * @param {{ path: string, tree: any }} props - level props.
     * @returns {import('react').ReactNode} level list.
     */
    function FileTreeLevel(props) {
      const path = props.path
      const tree = props.tree
      const t = tree.t
      const level = tree.levels[path]
      if (level === undefined || level.state === 'loading') {
        return h('div', { className: 'dsh-sidebar-file-note' }, t('workspace.loading'))
      }
      if (level.state === 'error') {
        return h('div', { className: 'dsh-sidebar-file-note' }, t('workspace.error'))
      }
      const entries = orderFileEntries(level.entries)
      if (entries.length === 0) {
        return h('div', { className: 'dsh-sidebar-file-note' }, t('workspace.empty'))
      }
      const items = []
      for (const entry of entries) {
        const childPath = joinPath(path, entry.name)
        if (entry.type === 'directory') {
          const expanded = tree.expanded.has(childPath)
          items.push(h('li', { key: 'd:' + childPath, className: 'dsh-sidebar-file-item' },
            h('button', {
              type: 'button',
              className: 'dsh-sidebar-file-row',
              title: entry.name,
              'aria-expanded': expanded,
              onClick: () => tree.toggle(childPath),
            },
            h('span', { className: 'dsh-sidebar-file-icon', 'aria-hidden': 'true' },
              expanded ? h(FolderOpenIcon) : h(FolderIcon)),
            h('span', { className: 'dsh-sidebar-file-name' }, entry.name)),
            expanded ? h(FileTreeLevel, { path: childPath, tree }) : null))
        } else if (entry.type === 'file') {
          items.push(h('li', { key: 'f:' + childPath, className: 'dsh-sidebar-file-item' },
            h('button', {
              type: 'button',
              className: 'dsh-sidebar-file-row',
              title: entry.name,
              onClick: () => tree.open(childPath),
            },
            h('span', {
              className: 'dsh-sidebar-file-icon',
              'data-tone': fileTone(entry.name),
              'aria-hidden': 'true',
            }, h(FileIcon)),
            h('span', { className: 'dsh-sidebar-file-name' }, entry.name))))
        } else {
          items.push(h('li', { key: 'o:' + childPath, className: 'dsh-sidebar-file-item' },
            h('span', {
              className: 'dsh-sidebar-file-row dsh-sidebar-file-other',
              'aria-disabled': 'true',
              title: t('workspace.other'),
            }, h('span', { className: 'dsh-sidebar-file-name' }, entry.name))))
        }
      }
      if (level.truncated) {
        items.push(h('li', { key: 'truncated', className: 'dsh-sidebar-file-note' }, t('workspace.truncated')))
      }
      return h('ul', { className: 'dsh-sidebar-file-level' }, items)
    }

    /**
     * Working-directory section: a native-style tree over the Session workspace.
     * It is a normal same-level section as Progress, default open, and has no
     * separate "open file tree" button. Files open the native text preview.
     * @param {object} props - section props plus the listing face.
     * @returns {import('react').ReactNode} section.
     */
    function WorkspaceSection(props) {
      const t = props.t
      const rootPath = typeof props.rootPath === 'string' && props.rootPath !== '' ? props.rootPath : '.'
      const [levels, setLevels] = React.useState({})
      const [expanded, setExpanded] = React.useState(() => new Set())
      const requested = React.useRef(new Set())
      const controllers = React.useRef(new Map())
      const alive = React.useRef(true)

      React.useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
          for (const controller of controllers.current.values()) controller.abort()
          controllers.current.clear()
        }
      }, [])

      const load = React.useCallback((path) => {
        if (requested.current.has(path)) return
        requested.current.add(path)
        const controller = new AbortController()
        controllers.current.set(path, controller)
        setLevels(previous => ({ ...previous, [path]: { state: 'loading' } }))
        let pending
        try {
          pending = props.listFiles(path, controller.signal)
        } catch {
          pending = Promise.resolve({ ok: false })
        }
        Promise.resolve(pending).then(result => {
          if (!alive.current || controller.signal.aborted) return
          controllers.current.delete(path)
          if (result !== null && result !== undefined && result.ok === true
            && result.value !== undefined && result.value !== null) {
            const entries = Array.isArray(result.value.entries) ? result.value.entries : []
            setLevels(previous => ({
              ...previous,
              [path]: {
                state: 'ready',
                entries: entries.slice(0, FILE_ENTRY_LIMIT),
                truncated: result.value.truncated === true || entries.length > FILE_ENTRY_LIMIT,
              },
            }))
          } else {
            requested.current.delete(path)
            controllers.current.delete(path)
            if (path !== rootPath) {
              setExpanded(previous => {
                const next = new Set(previous)
                next.delete(path)
                return next
              })
            }
            setLevels(previous => ({ ...previous, [path]: { state: 'error' } }))
          }
        }, () => {
          if (!alive.current || controller.signal.aborted) return
          controllers.current.delete(path)
          requested.current.delete(path)
          setLevels(previous => ({ ...previous, [path]: { state: 'error' } }))
        })
      }, [props.listFiles, rootPath])

      React.useEffect(() => {
        for (const controller of controllers.current.values()) controller.abort()
        controllers.current.clear()
        requested.current.clear()
        setLevels({})
        setExpanded(new Set())
      }, [props.sessionId, rootPath])

      React.useEffect(() => {
        if (props.open) load(rootPath)
      }, [props.open, load, props.sessionId, rootPath])

      const toggle = (path) => {
        if (expanded.has(path)) {
          setExpanded(previous => {
            const next = new Set(previous)
            next.delete(path)
            return next
          })
          return
        }
        load(path)
        setExpanded(previous => {
          const next = new Set(previous)
          next.add(path)
          return next
        })
      }

      const tree = {
        levels,
        expanded,
        toggle,
        open: path => {
          const relative = relativeToRoot(rootPath, path)
          if (relative === '') return
          try {
            props.openFile(relative)
          } catch {
            // The native preview refuses the path: the tree stays unchanged.
          }
        },
        t,
      }

      return h(Section, {
        t,
        title: t('workspace.title'),
        open: props.open,
        onToggle: props.onToggle,
      },
      h('div', { className: 'dsh-sidebar-workspace-root', title: rootPath },
        h(FolderIcon),
        h('span', { className: 'dsh-sidebar-workspace-root-path' }, rootPath)),
      h(FileTreeLevel, { path: rootPath, tree }))
    }

    /* ------------------------------ terminal section ------------------------------ */

    /**
     * Terminal section: one action row that opens a native terminal tab. The
     * section sits beside Progress and Working directory; the terminal itself is
     * a wide native page with a floating right-side X.
     * @param {object} props - section props plus the opener.
     * @returns {import('react').ReactNode} section.
     */
    function TerminalSection(props) {
      const t = props.t
      return h(Section, {
        t,
        title: t('section.terminal'),
        open: props.open,
        onToggle: props.onToggle,
      },
      h('button', {
        type: 'button',
        className: 'dsh-sidebar-terminal-row',
        title: t('terminal.new'),
        onClick: () => {
          try {
            props.openTerminal()
          } catch {
            // Terminal page may be absent in a minimal profile.
          }
        },
      },
      h('span', { className: 'dsh-sidebar-terminal-icon', 'aria-hidden': 'true' }, h(TerminalIcon)),
      h('span', { className: 'dsh-sidebar-terminal-label' }, t('terminal.new')),
      h('span', { className: 'dsh-sidebar-terminal-arrow', 'aria-hidden': 'true' }, h(Chevron, { open: true }))))
    }

    /* ------------------------------ context section ------------------------------ */

    /**
     * Read the memory topics the installed dsh-memory plugin exposes.
     *
     * This plugin is optional: a 404/failed request resolves to the empty list
     * and the Context section simply omits the Memory group.
     * @param {string} sessionId - mounted session id.
     * @param {AbortSignal} signal - request lifetime.
     * @returns {Promise<{ memories: any[], projectKey: string } | undefined>} normalized payload.
     */
    async function fetchMemories(sessionId, signal) {
      try {
        const response = await fetch(
          '/api/dsh-memory/state?sessionId=' + encodeURIComponent(sessionId),
          { credentials: 'same-origin', cache: 'no-store', signal },
        )
        if (!response.ok) return undefined
        const payload = await response.json()
        if (payload === null || typeof payload !== 'object' || payload.ok !== true) return undefined
        const value = payload.value
        if (value === null || typeof value !== 'object') return undefined
        const memories = Array.isArray(value.memories) ? value.memories : []
        const projectKey = value.session !== null && typeof value.session === 'object'
          && value.session.project !== null && typeof value.session.project === 'object'
          && typeof value.session.project.key === 'string'
          ? value.session.project.key
          : ''
        return { memories, projectKey }
      } catch {
        return undefined
      }
    }

    /**
     * Pick at most a few memories relevant to this conversation's project.
     * @param {{ memories: any[], projectKey: string } | undefined} payload - normalized memory payload.
     * @returns {any[]} pinned first, then freshest.
     */
    function pickMemories(payload) {
      if (payload === undefined) return []
      const projectKey = payload.projectKey
      const rows = payload.memories.filter(memory => {
        if (memory === null || typeof memory !== 'object') return false
        if (memory.status === 'archived') return false
        if (memory.scope === 'project' && (projectKey === '' || memory.projectKey !== projectKey)) return false
        return true
      })
      const stamp = value => {
        if (typeof value === 'number') return value
        const parsed = typeof value === 'string' ? Date.parse(value) : NaN
        return Number.isFinite(parsed) ? parsed : 0
      }
      rows.sort((left, right) => {
        if (left.pinned !== right.pinned) return left.pinned === true ? -1 : 1
        return stamp(right.updatedAt) - stamp(left.updatedAt)
      })
      return rows.slice(0, MEMORY_LIMIT)
    }

    /**
     * Context section: this conversation's skill usage, relevant memory topics
     * and the workspace path. Native panel shortcuts live elsewhere now (the
     * terminal button sits in the conversation header, the file tree has its
     * own folder action), so this section stays informational.
     * @param {object} props - section props plus memory/skill faces.
     * @returns {import('react').ReactNode} section.
     */
    function ContextSection(props) {
      const t = props.t
      const [payload, setPayload] = React.useState(undefined)
      const [skillCatalog, setSkillCatalog] = React.useState(undefined)

      React.useEffect(() => {
        const controller = new AbortController()
        let alive = true
        setPayload(undefined)
        fetchMemories(props.sessionId, controller.signal).then(value => {
          if (alive) setPayload(value)
        })
        return () => {
          alive = false
          controller.abort()
        }
      }, [props.sessionId])

      React.useEffect(() => {
        const controller = new AbortController()
        let alive = true
        setSkillCatalog(undefined)
        let pending
        try {
          pending = props.listSkills(controller.signal)
        } catch {
          pending = Promise.resolve({ ok: false })
        }
        Promise.resolve(pending).then(result => {
          if (!alive) return
          if (result !== null && result !== undefined && result.ok === true) {
            const names = readSkillNames(result.value)
            setSkillCatalog(names === undefined ? null : names)
          } else {
            setSkillCatalog(null)
          }
        }, () => {
          if (alive) setSkillCatalog(null)
        })
        return () => {
          alive = false
          controller.abort()
        }
      }, [props.sessionId])

      const memories = pickMemories(payload)
      const usage = readSkillUsage(props.skillUsage)
      const merged = usage === undefined
        ? undefined
        : mergeSkillUsage(usage, skillCatalog instanceof Set ? skillCatalog : undefined)
      const children = []

      if (props.skillUsage !== undefined || usage !== undefined) {
        const skillChildren = [
          h('div', { key: 'label', className: 'dsh-sidebar-group-label' }, t('context.skills')),
        ]
        if (merged !== undefined && merged.total > 0) {
          for (const row of merged.rows) {
            skillChildren.push(h('div', { key: 'skill:' + row.name, className: 'dsh-sidebar-skill-row' },
              h('span', { className: 'dsh-sidebar-skill-name', title: row.name }, row.name),
              h('span', { className: 'dsh-sidebar-skill-count' }, String(row.count))))
          }
        } else {
          skillChildren.push(h('div', { key: 'empty', className: 'dsh-sidebar-skill-empty' }, t('skills.empty')))
        }
        children.push(h('div', { key: 'skills', className: 'dsh-sidebar-group' }, skillChildren))
      }

      if (memories.length > 0) {
        const rows = memories.map((memory, index) => {
          const scope = typeof memory.scopeLabel === 'string' ? memory.scopeLabel : String(memory.scope || '')
          const title = (memory.pinned === true ? '★ ' : '') + (typeof memory.title === 'string' ? memory.title : '')
          return h('div', {
            key: typeof memory.id === 'string' ? memory.id : 'memory-' + index,
            className: 'dsh-sidebar-memory-row',
          },
          scope === '' ? null : h('span', { className: 'dsh-sidebar-memory-scope' }, scope),
          h('span', { className: 'dsh-sidebar-memory-title', title }, title))
        })
        children.push(h('div', { key: 'memory', className: 'dsh-sidebar-group' },
          h('div', { className: 'dsh-sidebar-group-label' }, t('context.memory')),
          rows))
      }
      return h(Section, {
        t,
        title: t('section.context'),
        open: props.open,
        onToggle: props.onToggle,
      }, children)
    }

    /* ------------------------------ page ------------------------------ */

    /**
     * The single right-Sidebar page. It owns the section open/closed state and
     * reads the mounted conversation's projection; every section is scoped to
     * the Session on screen.
     * @param {object} props - slot props and the injected faces.
     * @returns {import('react').ReactNode} page.
     */
    function SessionPage(props) {
      const t = props.t
      const sessionId = props.sessionId
      const liveValue = props.useProjection(TASK_PROJECTION_KEY)
      const skillUsage = props.useProjection(SKILL_USAGE_PROJECTION_KEY)
      const currentRow = props.useSessions(snapshot => (
        snapshot === undefined || snapshot === null || snapshot.byId === undefined
          ? undefined
          : snapshot.byId[sessionId]
      ))
      const source = pickCurrentTaskTurn(liveValue, currentRow, sessionId)
      const [sections, setSections] = React.useState(() => readSectionState(sessionId))
      const [hydratedSession, setHydratedSession] = React.useState(sessionId)

      React.useEffect(() => {
        setSections(readSectionState(sessionId))
        setHydratedSession(sessionId)
      }, [sessionId])

      React.useEffect(() => {
        // Wait until the sections belong to this Session: the previous state is
        // still in place for the commit that changes `sessionId`.
        if (hydratedSession !== sessionId) return
        try {
          window.localStorage.setItem(SECTION_STORAGE_PREFIX + sessionId, JSON.stringify(sections))
        } catch {
          // Section persistence is best-effort.
        }
      }, [sections, sessionId, hydratedSession])

      React.useEffect(() => {
        if (liveValue === undefined || skillUsage === undefined) {
          refreshCurrentProjection(sessionId, props.refreshProjections)
        }
      }, [liveValue, skillUsage, sessionId])

      const toggle = (key) => {
        setSections(previous => ({ ...previous, [key]: !previous[key] }))
      }

      return h('div', { className: 'dsh-sidebar-page' },
        h(ProgressSection, {
          t,
          source,
          open: sections.progress,
          onToggle: () => toggle('progress'),
        }),
        h(WorkspaceSection, {
          t,
          sessionId,
          rootPath: currentRow === undefined || currentRow.cwd === undefined ? '.' : currentRow.cwd,
          open: sections.workspace,
          onToggle: () => toggle('workspace'),
          listFiles: props.listFiles,
          openFile: props.openFile,
        }),
        h(TerminalSection, {
          t,
          open: sections.terminal,
          onToggle: () => toggle('terminal'),
          openTerminal: props.openTerminal,
        }),
        h(ContextSection, {
          t,
          sessionId,
          open: sections.context,
          onToggle: () => toggle('context'),
          skillUsage,
          listSkills: props.listSkills,
        }))
    }

    /**
     * Live tab chip title. The chip is normally hidden while this page is
     * active; it only appears beside a native preview page, so it stays a
     * stable label rather than a counter.
     * @param {object} props - slot props (t).
     * @returns {import('react').ReactNode} chip text.
     */
    function SessionTitle(props) {
      return h('span', { className: 'dsh-sidebar-chip-title' }, props.t('type.title'))
    }

    /**
     * Empty occupant that hides the composer TodoPanel at a lower priority.
     * @returns {null} nothing to render.
     */
    function HideComposerTodo() {
      return null
    }

    /* ------------------------------ page navigation ------------------------------ */

    /** Parent tab per Session for pages this plugin opened (file preview, terminal). */
    const parentTabs = new Map()

    /** Last observed open/closed intent per Session, shared by the toggle and switch policy. */
    const openBySession = new Map()
    let sidebarOpenIntent = false
    let sidebarSwitching = false
    let sidebarGuardUntil = 0
    let pendingSession
    let pendingOpen = false

    /**
     * Record one Session's Sidebar open state and the global intent mirror.
     * @param {string | undefined} sessionId - owning Session.
     * @param {boolean} open - whether the Sidebar is expanded.
     */
    function recordSidebarOpen(sessionId, open) {
      if (sessionId !== undefined) openBySession.set(sessionId, open)
      sidebarOpenIntent = open
    }

    /**
     * Find the actual right-panel element for one Session (the session wrappers
     * also carry data-sidebar-right-session but not the panel marker).
     * @param {string} sessionId - Session owning the panel.
     * @returns {HTMLElement | undefined} mounted panel element.
     */
    function sidebarPanelFor(sessionId) {
      const panels = document.querySelectorAll('[data-sidebar-right-session][data-sidebar-right-panel]')
      for (const panel of panels) {
        if (panel.getAttribute('data-sidebar-right-session') === sessionId) return panel
      }
      return undefined
    }

    /**
     * Align one Session's persisted Sidebar layout with the desired open state.
     * DSH stores `expanded` under `dsh.sidebar-right.v1.<sessionId>`; writing it
     * before a switch prevents a stale "open" layout from flashing the panel.
     * @param {string} sessionId - owning Session.
     * @param {boolean} expanded - desired expanded state.
     */
    function writeSidebarExpanded(sessionId, expanded) {
      if (typeof localStorage === 'undefined') return
      try {
        const key = SIDEBAR_LAYOUT_PREFIX + sessionId
        const raw = localStorage.getItem(key)
        if (raw === null) return
        const parsed = JSON.parse(raw)
        const entry = parsed !== null && typeof parsed === 'object' && parsed.bySession !== null
          && typeof parsed.bySession === 'object'
          ? parsed.bySession[sessionId]
          : undefined
        if (entry === undefined || entry === null || entry.layout === undefined) return
        if (entry.layout.expanded === expanded) return
        entry.layout.expanded = expanded
        localStorage.setItem(key, JSON.stringify(parsed))
      } catch {
        // Invalid or unavailable storage is ignored; the controller still closes.
      }
    }

    /** Force every persisted Session Sidebar layout closed (the default). */
    function closeAllPersistedSidebars() {
      if (typeof localStorage === 'undefined') return
      try {
        const keys = []
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index)
          if (key !== null && key.startsWith(SIDEBAR_LAYOUT_PREFIX)) keys.push(key)
        }
        for (const key of keys) {
          writeSidebarExpanded(key.slice(SIDEBAR_LAYOUT_PREFIX.length), false)
        }
      } catch {
        // Storage cleanup is best-effort.
      }
    }

    /**
     * Remember the page a plugin-initiated open leaves behind, so X can return
     * to it explicitly instead of relying on dockkit's neighbour choice.
     * @param {string} sessionId - owning Session.
     */
    function rememberParentTab(sessionId) {
      try {
        const active = ctxActiveTab()
        if (active === undefined) return
        const list = parentTabs.get(sessionId) || []
        if (list[list.length - 1] !== active.id) list.push(active.id)
        parentTabs.set(sessionId, list)
      } catch {
        // Navigation memory is best-effort.
      }
    }

    /**
     * The active tab id, or undefined when no surface is mounted.
     * @returns {string | undefined} tab id.
     */
    function ctxActiveTab() {
      const active = sidebarActiveTab()
      return active === undefined ? undefined : active.id
    }

    // Bound by apply(): lets the helpers above stay free of a module-level ctx.
    let sidebarActiveTab = () => undefined
    let sidebarFocusTab = () => {}

    /**
     * Pop the remembered parent and focus it after its child closes.
     * @param {string} sessionId - owning Session.
     */
    function restoreParentTab(sessionId) {
      const list = parentTabs.get(sessionId)
      if (list === undefined || list.length === 0) return
      const parent = list.pop()
      if (list.length === 0) parentTabs.delete(sessionId)
      try {
        sidebarFocusTab(parent)
      } catch {
        // The parent may already be gone; the host's neighbour stays active.
      }
    }

    /* ------------------------------ width policy ------------------------------ */

    /**
     * The private but stable right-column width action face. Kept in one place
     * so both the width policy and the click handlers that open a native page
     * can widen the column before the tab mounts.
     * @param {import('@deepseek-ai/cordis').Context} ctx - Client root context.
     * @returns {{ set: (width: number) => void } | undefined} width face.
     */
    function rightbarWidthFace(ctx) {
      try {
        const layout = ctx.get('layout')
        const panels = layout === undefined || layout === null ? undefined : layout.panels
        if (panels === undefined || panels === null || typeof panels.setRightbar !== 'function') return undefined
        return {
          set(width) {
            try {
              if (Number.isFinite(width) && width > 0) panels.setRightbar(width)
            } catch {
              // The private action face changed shape; keep the shipped width.
            }
          },
        }
      } catch {
        return undefined
      }
    }

    /**
     * Keep the column narrow for this page and wide for preview-like native
     * tabs. It also owns the one-time "open the session page instead of the
     * guide" default and follows tab/resize changes. The layout controller's
     * public face has no width setter, so it reads the bound panel actions and
     * degrades silently when that private face is absent.
     * @param {import('@deepseek-ai/cordis').Context} ctx - Client root context.
     * @returns {() => void} disposer.
     */
    function installWidthPolicy(ctx) {
      const widthFace = rightbarWidthFace(ctx)
      let lastKind = ''
      let initialized = false
      const switchedForSession = new Set()

      const requestWidth = (width) => {
        if (widthFace !== undefined) widthFace.set(width)
      }

      const tabSnapshot = () => {
        try {
          const openTabs = ctx.sidebarRight.openTabs
          if (openTabs === undefined || openTabs === null || typeof openTabs.getSnapshot !== 'function') return []
          const snapshot = openTabs.getSnapshot()
          if (Array.isArray(snapshot)) return snapshot
          if (snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.tabs)) return snapshot.tabs
          return []
        } catch {
          return []
        }
      }

      const openPageOnce = () => {
        const mounted = ctx.sidebarRight.mounted.getSnapshot()
        if (mounted === undefined || switchedForSession.has(mounted)) return
        const tabs = tabSnapshot()
        const ours = tabs.find(tab => tab !== null && tab !== undefined
          && tab.sessionId === mounted && tab.kind === PAGE_KIND)
        try {
          ctx.sidebarRight.openTab(PAGE_KIND)
        } catch {
          return
        }
        switchedForSession.add(mounted)
        if (ours !== undefined) return
        const guide = tabs.find(tab => tab !== null && tab !== undefined
          && tab.sessionId === mounted && tab.kind === GUIDE_KIND)
        if (guide !== undefined && guide.tabId !== undefined) {
          try {
            ctx.sidebarRight.close(guide.tabId)
          } catch {
            // A sole guide tab cannot close; it stays hidden behind our page.
          }
        }
      }

      const applyForKind = (kind) => {
        if (kind === lastKind) return
        lastKind = kind
        const viewport = window.innerWidth
        requestWidth(isWideKind(kind) ? wideWidthFor(viewport) : narrowWidthFor(viewport))
      }

      const evaluate = () => {
        const expanded = ctx.sidebarRight.isExpanded()
        if (!expanded) {
          if (lastKind !== '' || !initialized) {
            const width = isWideKind(lastKind) ? wideWidthFor(window.innerWidth) : narrowWidthFor(window.innerWidth)
            initialized = true
            lastKind = ''
            requestWidth(width)
          }
          return
        }
        const active = ctx.sidebarRight.active()
        const kind = active === undefined ? '' : active.kind
        if (kind === '' || kind === GUIDE_KIND) {
          openPageOnce()
          return
        }
        applyForKind(kind)
      }

      const onResize = () => {
        if (lastKind === '') return
        const viewport = window.innerWidth
        requestWidth(isWideKind(lastKind) ? wideWidthFor(viewport) : narrowWidthFor(viewport))
      }

      const timer = setInterval(evaluate, WIDTH_POLL_MS)
      const offTabs = ctx.sidebarRight.openTabs.subscribe(evaluate)
      const offMounted = ctx.sidebarRight.mounted.subscribe(evaluate)
      window.addEventListener('resize', onResize)
      evaluate()
      return () => {
        clearInterval(timer)
        offTabs()
        offMounted()
        window.removeEventListener('resize', onResize)
      }
    }

    /* ------------------------------ sidebar visibility policy ------------------------------ */

    /**
     * Keep the Sidebar's open/closed state stable across Session switches and
     * start closed by default.
     *
     * - The first mounted Session is forced closed.
     * - A user open/close is recorded per Session; switching applies the last
     *   observed state (closed stays closed, open stays open).
     * - Opening on a switch also activates this plugin's session page, so a
     *   manually opened Sidebar lands on Progress/Working directory/Context
     *   instead of a stale native page.
     *
     * @param {import('@deepseek-ai/cordis').Context} ctx - Client root context.
     * @returns {() => void} disposer.
     */
    function installSidebarVisibilityPolicy(ctx) {
      closeAllPersistedSidebars()
      let previous = ctx.sidebarRight.mounted.getSnapshot()
      let initialized = previous !== undefined

      const desiredFor = (sessionId) => {
        if (sessionId !== undefined && openBySession.has(sessionId)) return openBySession.get(sessionId)
        return sidebarOpenIntent
      }

      const finish = (mounted, wantOpen, guard) => {
        recordSidebarOpen(mounted, wantOpen)
        writeSidebarExpanded(mounted, wantOpen)
        if (guard) sidebarGuardUntil = Date.now() + 1500
        sidebarSwitching = false
      }

      const apply = (wantOpen, attempt = 0, guard = false) => {
        const mounted = ctx.sidebarRight.mounted.getSnapshot()
        if (mounted === undefined) {
          sidebarSwitching = false
          return
        }
        sidebarSwitching = true
        let done = false
        try {
          if (wantOpen) {
            // openTab both activates this page and expands the column.
            ctx.sidebarRight.openTab(PAGE_KIND)
            done = true
          } else if (ctx.sidebarRight.isExpanded()) {
            ctx.sidebarRight.toggleExpanded()
            done = true
          } else {
            done = true
          }
        } catch {
          done = false
        }
        if (done || attempt >= 8) {
          finish(mounted, wantOpen, guard)
          return
        }
        setTimeout(() => {
          if (ctx.sidebarRight.mounted.getSnapshot() !== mounted) {
            sidebarSwitching = false
            return
          }
          apply(wantOpen, attempt + 1, guard)
        }, 50)
      }

      if (initialized) {
        recordSidebarOpen(previous, false)
        writeSidebarExpanded(previous, false)
        pendingSession = previous
        pendingOpen = false
        apply(false, 0, true)
      }

      const off = ctx.sidebarRight.mounted.subscribe(() => {
        const next = ctx.sidebarRight.mounted.getSnapshot()
        if (next === previous) return
        const old = previous
        previous = next
        if (!initialized) {
          initialized = true
          recordSidebarOpen(next, false)
          writeSidebarExpanded(next, false)
          pendingSession = next
          pendingOpen = false
          apply(false, 0, true)
          return
        }
        const wantOpen = old === undefined ? false : desiredFor(old)
        if (next !== undefined) {
          openBySession.set(next, wantOpen)
          writeSidebarExpanded(next, wantOpen)
        }
        pendingSession = next
        pendingOpen = wantOpen
        apply(wantOpen, 0, true)
        if (old !== undefined) parentTabs.delete(old)
      })

      const readCurrent = () => {
        if (sidebarSwitching) return
        const mounted = ctx.sidebarRight.mounted.getSnapshot()
        if (mounted === undefined) return
        const actual = ctx.sidebarRight.isExpanded()
        if (pendingSession === mounted) {
          // Do not trust the panel until the new Session's real surface exists.
          if (sidebarPanelFor(mounted) === undefined) return
          if (actual !== pendingOpen) {
            apply(pendingOpen, 0, false)
            return
          }
          pendingSession = undefined
        }
        if (Date.now() < sidebarGuardUntil && actual !== sidebarOpenIntent) {
          // A stale persisted layout appeared after a switch/default close.
          apply(sidebarOpenIntent, 0, false)
          return
        }
        recordSidebarOpen(mounted, actual)
      }
      const observer = new MutationObserver(readCurrent)
      observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-sidebar-right-open'] })
      const timer = setInterval(readCurrent, 300)
      readCurrent()

      return () => {
        off()
        observer.disconnect()
        clearInterval(timer)
        sidebarGuardUntil = 0
        sidebarSwitching = false
        pendingSession = undefined
        pendingOpen = false
      }
    }

    /* ------------------------------ plugin body ------------------------------ */

    /**
     * Register the session page type, its body/title, the guide card, the
     * composer todo-bar move, the width policy and the open/closed policy.
     * @param {import('@deepseek-ai/cordis').Context} ctx - Client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-sidebar: dictionaries')
      const t = ctx.locale.bind(NS)
      const widthFace = rightbarWidthFace(ctx)
      sidebarActiveTab = () => ctx.sidebarRight.active()
      sidebarFocusTab = (tabId) => { ctx.sidebarRight.focus(tabId) }
      const closeActiveNativeTab = (sessionId) => {
        const active = ctx.sidebarRight.active()
        if (active === undefined || active.kind === PAGE_KIND) return false
        try {
          ctx.sidebarRight.close(active.id)
          const owner = sessionId ?? ctx.sidebarRight.mounted.getSnapshot()
          if (owner !== undefined) restoreParentTab(owner)
          return true
        } catch {
          return false
        }
      }

      ctx.effect(() => installStyles(), 'dsh-sidebar: styles')

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TASKS_ID,
        kind: PAGE_KIND,
        keepMounted: true,
        title: () => t('type.title'),
        guide: [{
          id: 'session',
          order: 5,
          title: () => t('guide.title'),
          description: () => t('guide.description'),
          icon: ChecklistArtwork,
        }],
      }), 'dsh-sidebar: session page type')

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TASKS_ID,
        locale: NS,
        inject: (sessionId) => ({
          refreshProjections: (id) => ctx.sessions.refreshProjections(id),
          listFiles: (path, signal) => ctx.remote.workspaceFiles.list(sessionId, path, signal),
          openFile: (path) => {
            rememberParentTab(sessionId)
            widthFace?.set(wideWidthFor(window.innerWidth))
            ctx.sidebarRight.openResource(fileAddress(sessionId, path))
          },
          openTerminal: () => {
            rememberParentTab(sessionId)
            widthFace?.set(wideWidthFor(window.innerWidth))
            ctx.sidebarRight.openTab('terminal')
          },
          listSkills: (signal) => {
            try {
              const skills = ctx.remote === undefined ? undefined : ctx.remote.skills
              if (skills === undefined || typeof skills.list !== 'function') {
                return Promise.resolve({ ok: false })
              }
              return skills.list({ sessionId }, signal)
            } catch {
              return Promise.resolve({ ok: false })
            }
          },
        }),
      }, SessionPage)), 'dsh-sidebar: session page body')

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab.title',
        key: TASKS_ID,
        locale: NS,
      }, SessionTitle)), 'dsh-sidebar: session page title')

      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: '@local/dsh-sidebar/sidebar-toggle',
        order: 110,
        locale: NS,
        inject: (sessionId) => ({
          toggleSidebar: () => {
            const setOpen = (open) => {
              sidebarGuardUntil = 0
              pendingSession = undefined
              recordSidebarOpen(sessionId, open)
              writeSidebarExpanded(sessionId, open)
            }
            const open = ctx.sidebarRight.isExpanded()
            if (open) {
              try {
                ctx.sidebarRight.toggleExpanded()
                setOpen(false)
              } catch {
                // No surface to close; the observer will catch the next state.
              }
              return
            }
            try {
              ctx.sidebarRight.openTab(PAGE_KIND)
              setOpen(true)
            } catch {
              try {
                ctx.sidebarRight.toggleExpanded()
                setOpen(ctx.sidebarRight.isExpanded())
              } catch {
                // No surface yet; the next click retries.
              }
            }
          },
        }),
      }, SidebarToggleButton)), 'dsh-sidebar: outer sidebar toggle')

      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: '@local/dsh-sidebar/native-close-overlay',
        order: 130,
        locale: NS,
        inject: (sessionId) => ({
          readActive: () => ctx.sidebarRight.active(),
          closeTab: () => { closeActiveNativeTab(sessionId) },
        }),
      }, NativePageCloseOverlay)), 'dsh-sidebar: native page close overlay')

      ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: '@local/dsh-sidebar/sidebar-close',
        order: 120,
        locale: NS,
        inject: (sessionId) => ({
          closePage: () => { closeActiveNativeTab(sessionId) },
          readActive: () => ctx.sidebarRight.active(),
          isOpen: () => ctx.sidebarRight.isExpanded(),
        }),
      }, SidebarCloseButton)), 'dsh-sidebar: close/back header button')

      ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
        name: 'sidebar.right.tab.document.actions',
        id: '@local/dsh-sidebar/close',
        order: 100,
        locale: NS,
        inject: (sessionId) => ({
          closeTab: () => { closeActiveNativeTab(sessionId) },
        }),
      }, DocumentCloseButton)), 'dsh-sidebar: document close action')

      ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'todo',
        order: 0,
        priority: -1,
      }, HideComposerTodo)), 'dsh-sidebar: move composer todo bar')

      ctx.effect(() => installWidthPolicy(ctx), 'dsh-sidebar: right column width policy')

      ctx.effect(() => installSidebarVisibilityPolicy(ctx), 'dsh-sidebar: sidebar open/closed policy')
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'layout', 'sidebarRight', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'],
      apply,
      /** Pure helpers exposed for the Node test lane (never used at runtime). */
      __test: {
        countTodos,
        unfinishedCount,
        statusLabel,
        format,
        readTaskProjection,
        pickCurrentTaskTurn,
        readSkillUsage,
        readSkillNames,
        mergeSkillUsage,
        basenameOf,
        joinPath,
        relativeToRoot,
        fileAddress,
        orderFileEntries,
        fileTone,
        isWideKind,
        narrowWidthFor,
        wideWidthFor,
        normalizeSectionState,
      },
    }
  },
})
