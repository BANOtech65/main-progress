import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Flow } from '../types'

const flow = atom({ plugin: 'main-progress', key: 'flow' } as const, null)
const working = atom({ plugin: 'main-progress', key: 'isWorking' } as const, false)

const TOOL = 'mcp__main-progress__progress'
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'
const CLAY = '#D97757'
const INK = '#1F1E1D'
const MAX_TITLE = 120
const MAX_STEPS = 50

type Status = 'pending' | 'in_progress' | 'completed'

const blank = (): Flow => ({ title: 'Progression', total: 0, done: 0, note: '', isFinished: false, steps: [], labels: [] })

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s)

const ratio = (f: Flow): number => (f.isFinished ? 1 : f.total ? f.done / f.total : 0)

const label = (f: Flow): string => (f.isFinished ? 'Terminé' : f.total ? `${f.done}/${f.total}` : 'En cours')

// A task list gives the counters: done = completed steps, the title = the step in progress.
const fromSteps = (f: Flow, steps: Status[], labels: string[]): Flow => {
  const total = steps.length
  const done = steps.filter(s => s === 'completed').length
  const current = steps.findIndex(s => s === 'in_progress')
  return {
    ...f,
    steps,
    labels,
    total,
    done,
    note: current >= 0 ? clip(labels[current] ?? '', MAX_TITLE) : f.note,
    isFinished: total > 0 && done === total,
  }
}

// ---------------------------------------------------------------------------
// Drawing: copied from savvy-progress (dithered bar, pill, percent, crab).

const H = 22
const BAR_H = 16
const CRAB_W = 26
const CRAB_BOX = 30
const CELL = 3
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"

const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏！-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
const charEm = (ch: string): number =>
  WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZА-ЯЁmwшщжюМШЩЖЮ@%]/.test(ch) ? 0.72 : 0.56
const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const crabBody = (f: Fill): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14, 4, 4, CLAY)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const crab = (x: number, y: number, isWalking: boolean, scale: number): string => {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  crabBody(f)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" shape-rendering="crispEdges"><g class="c-other${isWalking ? ' run' : ''}"><g class="bd">${(groups.get('bd') ?? []).join('')}</g>${group('la')}${group('lb')}</g></g>`
}

const rowSvg = (f: Flow, W: number, isWorking: boolean): string => {
  const title = fitText(f.isFinished ? f.title : f.note || f.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const color = f.isFinished ? DONE : ACCENT
  const y0 = (H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio(f))
  const dots: string[] = []
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  const ticks: string[] = []
  for (let i = 1; i < f.total; i++) {
    const x = Math.round((BAR_W * i) / f.total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }
  const text = label(f)
  const pillW = Math.round(18 + text.length * 6.6)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  const percent = `${Math.round(ratio(f) * 100)}%`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
.t0,.t1,.t2,.t3{animation:tw ${f.isFinished ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${f.isFinished ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${f.isFinished ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${f.isFinished ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${f.isFinished ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(text)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${percent}</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, 0, isWorking, 0.8)}
</svg>`
}

const barText = (f: Flow, width: number): string => {
  const filled = Math.round(width * ratio(f))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const PROMPT =
  'Progress bar: the person sees a progress bar above the prompt showing how far along your work is. ' +
  'When you keep a task list with mcp__ccd_turn__update_plan it follows that list by itself. ' +
  'Otherwise, for any task of several steps, call mcp__main-progress__progress right when you start ' +
  '(total = number of steps, done: 0, note = the step you are starting) and again each time a step finishes (done, note). ' +
  'Fields left out keep their value. Call it with finished: true at the very end.'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'progress',
      description:
        "Report the main agent's progress to the progress bar above the prompt. Call it at the start of a multi-step task (total, done: 0, note), after each step (done, note), and once with finished: true at the end. Fields left out keep their previous value. Ignored when called from a subagent.",
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the whole task, a few words.' },
          total: { type: 'integer', minimum: 0, description: 'Number of planned steps.' },
          done: { type: 'integer', minimum: 0, description: 'Steps finished so far.' },
          note: { type: 'string', description: 'The step in progress, a few words.' },
          finished: { type: 'boolean', description: 'True once the work is complete.' },
        },
      },
      isDeferred: false,
    })
    return started
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return { ...r, sections: [...r.sections, { id: 'main-progress:usage', text: PROMPT, scope: 'session' as const }] }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await update($, working, () => true)
      // A new request starts a clean bar once the previous work was finished.
      await update($, flow, f => (f?.isFinished ? null : f))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await update($, working, () => false)
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId) return { result: 'ignored: only the main agent reports progress' }
    const input = e as unknown as { title?: string; total?: number; done?: number; note?: string; finished?: boolean }
    const next = await update($, flow, prev => {
      const base = prev && !prev.isFinished ? prev : blank()
      const total = Math.min(MAX_STEPS, Math.max(0, Math.round(input.total ?? base.total)))
      const done = Math.min(total || Infinity, Math.max(0, Math.round(input.done ?? base.done)))
      return {
        ...base,
        title: clip(input.title?.trim() || base.title, MAX_TITLE),
        total,
        done: input.finished ? total : done,
        note: input.note !== undefined ? clip(input.note.trim(), MAX_TITLE) : base.note,
        isFinished: input.finished === true,
      }
    })
    return { result: `ok: ${label(next ?? blank())}` }
  })

  // Follows the app's task list with no effort from the model.
  on('tool.call', { tool: PLAN_TOOL }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const input = e as unknown as {
      items?: { content?: string; status?: Status }[]
      advance?: boolean
      done?: number[]
      start?: number
    }
    await update($, flow, prev => {
      const base = prev && !prev.isFinished ? prev : blank()
      const steps = [...base.steps]
      let labels = [...base.labels]
      if (input.items?.length) {
        const items = input.items.slice(0, MAX_STEPS)
        steps.splice(0, steps.length, ...items.map((i): Status => (i.status === 'completed' || i.status === 'in_progress' ? i.status : 'pending')))
        labels = items.map(i => (i.content ?? '').trim())
      } else {
        if (input.advance) {
          const cur = steps.findIndex(s => s === 'in_progress')
          if (cur >= 0) steps[cur] = 'completed'
          const nxt = steps.findIndex(s => s === 'pending')
          if (nxt >= 0) steps[nxt] = 'in_progress'
        }
        for (const n of input.done ?? []) if (steps[n - 1]) steps[n - 1] = 'completed'
        if (input.start && steps[input.start - 1]) steps[input.start - 1] = 'in_progress'
      }
      return steps.length ? fromSteps(base, steps, labels) : base
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, flow)
    if (f === null || e.props.hasSurvey) return next(e)
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const isWorking = await read($, working)
    const percent = `${Math.round(ratio(f) * 100)}%`
    const dismiss = <Button key="main-dismiss" label="✕" plain role="dismiss" onPress={() => update($, flow, () => null)} />

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8 - 64))
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Svg source={rowSvg(f, width, isWorking && !f.isFinished)} alt={`${f.title}: ${label(f)}, ${percent}`} width={width} height={H} />
            {dismiss}
          </Box>
          {below}
        </Box>
      )
    }

    const cols = e.props.bodyColumns
    const shown = f.isFinished ? f.title : f.note || f.title
    const titleW = Math.max(8, Math.min(30, shown.length + 2, Math.floor(cols / 3)))
    const width = Math.max(6, Math.min(40, cols - titleW - 24))
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box width={titleW} flexShrink={0}>
            <Text color={f.isFinished ? DONE : ACCENT}>● </Text>
            <Text wrap="truncate-end">{shown}</Text>
          </Box>
          <Text color={f.isFinished ? DONE : ACCENT}>{barText(f, width)}</Text>
          <Text bold>{label(f)}</Text>
          <Text dimColor>{percent}</Text>
          <Text color={CLAY}>▣</Text>
          {dismiss}
        </Box>
        {below}
      </Box>
    )
  })
}
