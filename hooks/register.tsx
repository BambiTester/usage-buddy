import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Window } from '../types'
import { CLAWD_H, CLAWD_W, clawdSvg } from './clawd'

// A one-row band above the prompt: Claude (aging with the 7-day window, tiring
// with the 5-hour one, a backpack as big as the cache, cooling as the cache
// heads for cold), the usage left in each window, and the prompt cache: warm or
// cold, its size, and idle time. Data handling adapted from ribbon (MIT,
// robonuggets). Zero token cost.

const BG = '#24221c'
const TEXT = '#e8e2d2'
const MUTED = '#8d8775'
const ORANGE = '#ff6b1a'
const YELLOW = '#f5a623'
const HUE = { warm: '#cc6363', cold: '#6aaabd' } as const
const LAVENDER = '#b9a3f5'
const MINT = '#86d0a8'

const LOW_AT = 15
/** How often the band redraws, so the countdowns and the warm-to-cold flip stay current. */
const TICK_MS = 30_000
const TTL_MIN = 60
const TTL_MS = TTL_MIN * 60_000
/** How long after a cold cache breaks Claude is drawn thawing; the animation itself takes 3s and ends warm. */
const THAW_MS = 20_000

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }
const COLORS: Record<string, string> = { seven_day: ORANGE, five_hour: YELLOW }

const windows = atom({ plugin: 'usage-buddy', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'usage-buddy', key: 'cache' } as const, null as CacheFacts | null)
const thawAt = atom({ plugin: 'usage-buddy', key: 'thawAt' } as const, 0)

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const span = (mins: number): string => {
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  return ms <= 0 ? 'resetting' : span(Math.round(ms / 60000))
}

const tok = (n: number): string => (n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : `${Math.round(n / 1000)}k`)
/** 0..10: one step per 10% used. */
const level = (used: number): number => Math.max(0, Math.min(10, Math.floor(used / 10)))
/** 0..4: a step every 15 minutes idle, 4 once the hour-long cache is cold. */
const chillOf = (idleMs: number): number => Math.min(4, Math.floor(idleMs / (TTL_MS / 4)))

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await pull($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await update($, cache, () => ({ lastAt, tokens, window, model }))
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the
  // hour; one that finds the cache cold breaks it, and Claude thaws.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      const was = await read($, cache)
      if (was && was.lastAt > 0 && now - was.lastAt >= TTL_MS) await update($, thawAt, () => now)
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets a text mark.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const list = await read($, windows)
    const now = await $.clock.now()
    const c = await read($, cache)

    const used = (kind: string) => list.find(w => w.kind === kind)?.percentUsed ?? 0
    const age = level(used('seven_day'))
    const tired = level(used('five_hour'))

    // The cache, once a request and its context size are known.
    const known = c && c.lastAt > 0 && c.tokens > 0 ? c : null
    const idleMs = known ? Math.max(0, now - known.lastAt) : 0
    const mode = idleMs >= TTL_MS ? 'cold' : 'warm'
    const thawing = now - (await read($, thawAt)) < THAW_MS
    const look = {
      age,
      tired,
      pack: known && known.window > 0 ? level((known.tokens / known.window) * 100) : 0,
      chill: thawing ? 0 : chillOf(idleMs),
      thaw: thawing,
    }

    const claude = Svg ? (
      <Svg
        key="claude"
        source={clawdSvg(look)}
        alt={`Claude: ${age * 10}% of the week used, ${tired * 10}% of 5 hours used, cache ${look.pack * 10}% full, ${mode}`}
        width={CLAWD_W}
        height={CLAWD_H}
      />
    ) : (
      <Text key="claude" color={HUE[mode]} bold>✻</Text>
    )

    const usage = list.length
      ? list.map(w => {
          const left = Math.max(0, Math.round(100 - w.percentUsed))
          const reset = fmtReset(w.resetsAt, now)
          return (
            <Box key={w.kind} flexDirection="row" flexShrink={0} marginRight={2}>
              <Text color={MUTED} bold>{`${NAMES[w.kind] ?? w.kind.toUpperCase()} `}</Text>
              <Text color={COLORS[w.kind] ?? TEXT} bold>{`${left}%`}</Text>
              {left < LOW_AT ? <Text color={TEXT} bold> LOW</Text> : null}
              {reset ? <Text color={MUTED}>{` · ${reset}`}</Text> : null}
            </Box>
          )
        })
      : [<Text key="wait" color={MUTED}>waiting for the first reply</Text>]

    let cacheParts = null
    if (known) {
      const idleMin = Math.floor(idleMs / 60000)
      cacheParts = [
        <Box key="state" flexDirection="row" flexShrink={0} marginRight={2}>
          <Text color={HUE[mode]} bold>{mode === 'cold' ? 'COLD' : 'WARM'}</Text>
          {mode === 'warm' ? <Text color={MUTED}>{` · ${Math.max(0, TTL_MIN - idleMin)}m left`}</Text> : null}
        </Box>,
        <Box key="cache" flexDirection="row" flexShrink={0} marginRight={2}>
          <Text color={MUTED} bold>{'CACHE '}</Text>
          <Text color={LAVENDER} bold>{tok(known.tokens)}</Text>
          {known.window > 0 ? (
            <Text color={MUTED}>
              {' · '}
              <Text color={LAVENDER} bold>{`${Math.round((known.tokens / known.window) * 100)}%`}</Text>
              {` of ${tok(known.window)}`}
            </Text>
          ) : null}
        </Box>,
        <Box key="idle" flexDirection="row" flexShrink={0}>
          <Text color={MUTED} bold>{'IDLE '}</Text>
          <Text color={mode === 'cold' ? HUE.cold : MINT} bold>{span(idleMin)}</Text>
        </Box>,
      ]
    }

    return (
      <Box flexDirection="row" backgroundColor={BG} paddingX={1} alignItems="center">
        {claude}
        <Box flexDirection="row" flexWrap="wrap" marginLeft={1} flexGrow={1}>
          {usage}
          {cacheParts}
        </Box>
      </Box>
    )
  })
}
