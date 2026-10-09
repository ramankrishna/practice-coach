// Coach: a learning mode for Claude Code.
//
// While it is on, Claude cannot write the files you named as yours, reads a
// short set of coaching rules beside every prompt, and records the scores it
// gives you. Nothing here asks a model anything of its own or leaves the machine.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Score } from '../types'
import {
  addScore,
  bandLine,
  bashWritesYours,
  briefing,
  clip,
  CONFIG,
  denyText,
  isYours,
  parseConfig,
  relative,
  scoreOf,
  statsOf,
} from './coach'

const PANE = 'coach'
const TOOL = 'mcp__practice-coach__score'

const isOn = atom({ plugin: 'practice-coach', key: 'isOn' } as const, false)
const canReveal = atom({ plugin: 'practice-coach', key: 'canReveal' } as const, false)
const scores = atom({ plugin: 'practice-coach', key: 'scores' } as const, [])
const setup = atom({ plugin: 'practice-coach', key: 'setup' } as const, {
  hasFile: false,
  yours: [],
  rules: [],
  problem: null,
})

// What the guards read without a call on `$`: a `.catch` handler may not make
// one, and a guard that cannot tell must still keep the learner's files.
let root = ''
let guarded: readonly string[] = []
let isGuarding = false

const scoresKey = (): string => `scores:${root}`

const field = (input: unknown, name: string): string => {
  const value = (input as Record<string, unknown> | null)?.[name]

  return typeof value === 'string' ? value : ''
}

async function setOn($: EngineInterface, value: boolean): Promise<void> {
  isGuarding = value
  await update($, isOn, () => value)
}

/**
 * Reads `.coach.json` and the saved scores. With `arm`, coaching starts on
 * wherever the file is in order: a session opens in the mode the project asks for.
 */
async function load($: EngineInterface, arm: boolean): Promise<void> {
  root = await $.session.root()

  const path = `${root}/${CONFIG}`
  const hasFile = await $.fs.exists(path)
  let text = ''

  if (hasFile) {
    try {
      text = await $.fs.read(path)
    } catch {
      text = ''
    }
  }

  const parsed = hasFile ? parseConfig(text) : { yours: [], rules: [] }
  const config = typeof parsed === 'string' ? { yours: [], rules: [] } : parsed

  // The config is the learner's too: Claude may not edit its way out of coaching.
  guarded = hasFile ? [...config.yours, CONFIG] : []
  await update($, setup, () => ({
    hasFile,
    yours: config.yours,
    rules: config.rules,
    problem: typeof parsed === 'string' ? parsed : null,
  }))

  const saved = await $.store.get(scoresKey())

  await update($, scores, () => (Array.isArray(saved) ? (saved as Score[]) : []))

  if (arm) await setOn($, hasFile && typeof parsed !== 'string' && config.yours.length > 0)
}

async function init($: EngineInterface, folders: readonly string[]): Promise<string> {
  root = await $.session.root()

  const path = `${root}/${CONFIG}`

  if (await $.fs.exists(path)) return `${CONFIG} already exists. Edit it, then run /coach on.`
  if (folders.length === 0) {
    return 'Name what is yours to write, for example: /coach init src/ exercises/'
  }

  await $.fs.write(path, `${JSON.stringify({ yours: folders, rules: [] }, null, 2)}\n`)
  await load($, true)

  return `Coach is on. Claude will not write ${folders.join(', ')}. Those files are yours.`
}

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Coach', focus: true, closeOnEscape: true })

const USAGE = 'Usage: /coach, /coach on, /coach off, /coach reveal, /coach init <folders>'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'coach',
      description: 'Learning mode: Claude coaches and scores, and you write the code',
      argumentHint: '[on|off|reveal|init <folders>]',
    })
    await $.tool.register({
      name: 'score',
      description:
        'Record the score you just gave the learner for one problem, in coach mode only. ' +
        'Call it once after you grade their code. It saves the score to their progress; it gives no feedback of its own.',
      inputSchema: {
        type: 'object',
        properties: {
          problem: { type: 'string', description: 'A short name for the problem, such as max_drawdown' },
          score: { type: 'number', description: 'The score out of 10' },
          note: { type: 'string', description: 'One line on what cost points, or what was done well' },
        },
        required: ['problem', 'score'],
      },
      isDeferred: false,
    })
    await load($, true)

    return next(e)
  })

  // /clear, /resume and /branch reset the session's state and raise no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($, true)

    return next(e)
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)

    if (verb === '') {
      await load($, false)
      await openPane($)

      return {}
    }
    if (verb === 'init') return { text: await init($, rest) }

    await load($, false)

    const now = await read($, setup)

    if (verb === 'off') {
      await setOn($, false)

      return { text: 'Coach is off. Claude can write any file again.' }
    }
    if (verb !== 'on' && verb !== 'reveal') return { text: USAGE }
    if (!now.hasFile || now.yours.length === 0) {
      return { text: `Nothing is marked as yours yet. Run /coach init <folders> first.` }
    }
    if (verb === 'on') {
      await setOn($, true)

      return { text: `Coach is on. Claude will not write ${now.yours.join(', ')}.` }
    }

    await update($, canReveal, () => true)

    return { text: 'Unlocked. Ask for the answer in your next message and Claude may show it in chat, once.' }
  })

  // ------------------------------------------------------------- coaching

  on('prompt.submit', async ($, e, next) => {
    if (!(await read($, isOn))) return next(e)

    const now = await read($, setup)
    const text = briefing(now, await read($, canReveal))

    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  // An unlocked answer is good for one reply.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, canReveal))) {
      await update($, canReveal, () => false)
    }

    return next(e)
  })

  on('tool.check', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const decided = await next(e)
    const path = relative(root, field(e.input, 'file_path') || field(e.input, 'notebook_path'))

    return isGuarding && isYours(guarded, path) ? { decision: 'deny', reason: denyText(path) } : decided
  }).catch(($, e, next) => {
    const path = relative(root, field(e.input, 'file_path') || field(e.input, 'notebook_path'))

    return isGuarding && isYours(guarded, path) ? { decision: 'deny', reason: denyText(path) } : next(e)
  })

  on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
    const decided = await next(e)
    const path = isGuarding ? bashWritesYours(guarded, field(e.input, 'command')) : null

    return path === null ? decided : { decision: 'deny', reason: denyText(path) }
  }).catch(($, e, next) => {
    const path = isGuarding ? bashWritesYours(guarded, field(e.input, 'command')) : null

    return path === null ? next(e) : { decision: 'deny', reason: denyText(path) }
  })

  // The score tool: Claude calls it after grading, and the mod keeps the record.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const score = scoreOf(e, await $.clock.now())

    if (typeof score === 'string') return { deny: `Coach did not record that: ${score}.` }

    const all = addScore(await read($, scores), score)

    await update($, scores, () => all)
    await $.store.set(scoresKey(), all)
    $.ui.toast(`${score.score}/10 on ${score.problem}`)

    return { result: `Recorded ${score.score}/10 for ${score.problem}.` }
  })

  // -------------------------------------------------------------- drawing

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isOn))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const stats = statsOf(await read($, scores), await $.clock.now())
    const unlocked = await read($, canReveal)
    const theirs = await next(e)

    return (
      <Box flexDirection="column">
        {theirs}
        <Box flexDirection="row" columnGap={2}>
          <Text inverse> coach </Text>
          <Text color="success">on</Text>
          <Text dimColor>{bandLine(stats)}</Text>
          {unlocked && <Text color="warning">answer unlocked for the next reply</Text>}
          <Button key="open" label="progress" hotkey="p" plain onPress={() => openPane($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const active = await read($, isOn)
    const now = await read($, setup)
    const all = await read($, scores)
    const unlocked = await read($, canReveal)
    const stats = statsOf(all, await $.clock.now())
    const width = Math.max(24, e.props.bodyColumns - 8)
    const isReady = now.hasFile && now.problem === null && now.yours.length > 0

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" columnGap={2}>
          {active ? <Text color="success">Coach is ON</Text> : <Text dimColor>Coach is OFF</Text>}
          {isReady && (
            <Button
              key="toggle"
              label={active ? 't: turn off' : 't: turn on'}
              hotkey="t"
              onPress={() => setOn($, !active)}
            />
          )}
        </Box>
        {now.problem !== null && (
          <Text color="error">
            {CONFIG} is not usable: {now.problem}
          </Text>
        )}
        {isReady ? (
          <Text dimColor>Yours to write: {clip(now.yours.join(', '), width)}</Text>
        ) : (
          <Box flexDirection="column">
            <Text>Nothing is marked as yours yet.</Text>
            <Text dimColor>/coach init src/ exercises/ names the folders Claude must not write.</Text>
          </Box>
        )}
        <Box flexDirection="column">
          <Text>
            {stats.total} scored
            {stats.average !== null ? ` · average ${stats.average.toFixed(1)} over the last ten` : ''}
            {stats.best !== null ? ` · best ${stats.best}` : ''}
          </Text>
          <Text dimColor>
            {stats.today} today{stats.streak > 0 ? ` · ${stats.streak} ${stats.streak === 1 ? 'day' : 'days'} in a row` : ''}
          </Text>
        </Box>
        <Box flexDirection="column">
          {all.length === 0 && <Text dimColor>No scores yet. Submit some code and ask for a grade.</Text>}
          {all
            .slice(-10)
            .reverse()
            .map(score => (
              <Box flexDirection="row" columnGap={2}>
                <Box width={5} flexShrink={0}>
                  <Text color={score.score >= 8 ? 'success' : score.score >= 5 ? 'warning' : 'error'}>
                    {score.score}/10
                  </Text>
                </Box>
                <Text>
                  {clip(score.problem, 28)}
                  {score.note !== '' ? `: ${clip(score.note, Math.max(10, width - 34))}` : ''}
                </Text>
              </Box>
            ))}
        </Box>
        {active && (
          <Box flexDirection="row" columnGap={2}>
            {unlocked ? (
              <Text color="warning">The next reply may show the answer.</Text>
            ) : (
              <Button
                key="reveal"
                label="v: unlock the next answer"
                hotkey="v"
                onPress={() => update($, canReveal, () => true)}
              />
            )}
          </Box>
        )}
      </Box>
    )
  })
}
