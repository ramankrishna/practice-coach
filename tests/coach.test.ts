import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { bashWritesYours, briefing, isYours, parseConfig, scoreOf, statsOf } from '../hooks/coach'

const ROOT = '/repo'
const CONFIG = JSON.stringify({ yours: ['llm/', 'prep', '*.ipynb'], rules: ['Keep answers under ten lines.'] })
const NOON = new Date(2026, 9, 9, 12).getTime()
const DAY = 86_400_000

describe('whose file it is', () => {
  const yours = ['llm/', 'prep', '*.ipynb', 'notes.py']

  test('the named folders, files and kinds are the learner\'s', () => {
    expect(isYours(yours, 'llm/attention.py')).toBe(true)
    expect(isYours(yours, 'llm/blocks/mlp.py')).toBe(true)
    expect(isYours(yours, 'prep/sorting.py')).toBe(true)
    expect(isYours(yours, 'notes.py')).toBe(true)
    expect(isYours(yours, 'scratch/drill.ipynb')).toBe(true)
  })

  test('everything else is not', () => {
    expect(isYours(yours, 'tests/test_attention.py')).toBe(false)
    expect(isYours(yours, 'llm_utils.py')).toBe(false)
    expect(isYours(yours, 'prepare/x.py')).toBe(false)
    expect(isYours(yours, 'README.md')).toBe(false)
    expect(isYours(yours, '/etc/hosts')).toBe(false)
  })

  test('a dot marks the whole project', () => {
    expect(isYours(['.'], 'anything/at/all.py')).toBe(true)
  })

  test('a shell command that writes one is caught, a read is not', () => {
    expect(bashWritesYours(yours, 'echo "def f(): pass" > llm/attention.py')).toBe('llm/attention.py')
    expect(bashWritesYours(yours, 'cat <<EOF >> prep/sorting.py')).toBe('prep/sorting.py')
    expect(bashWritesYours(yours, 'sed -i s/a/b/ llm/attention.py')).toBe('llm/attention.py')
    expect(bashWritesYours(yours, 'cp reference/attention.py llm/attention.py')).toBe('llm/attention.py')
    expect(bashWritesYours(yours, 'cat llm/attention.py')).toBe(null)
    expect(bashWritesYours(yours, 'python llm/attention.py')).toBe(null)
    expect(bashWritesYours(yours, 'pytest tests/ > out.txt')).toBe(null)
  })
})

describe('the briefing and the scores', () => {
  test('the briefing names the folders, the extra rules and the way to the answer', () => {
    const config = parseConfig(CONFIG)

    if (typeof config === 'string') throw new Error(config)

    const text = briefing(config, false)

    expect(text).toMatch(/llm\/, prep, \*\.ipynb/)
    expect(text).toMatch(/Keep answers under ten lines\./)
    expect(text).toMatch(/run \/coach reveal first/)
    expect(briefing(config, true)).toMatch(/in this one reply you may show/)
  })

  test('a score is checked before it is kept', () => {
    expect(scoreOf({ problem: 'max_drawdown', score: 7 }, 5)).toEqual({
      at: 5,
      problem: 'max_drawdown',
      score: 7,
      note: '',
    })
    expect(scoreOf({ problem: '', score: 7 }, 5)).toBe('a "problem" name is needed')
    expect(scoreOf({ problem: 'x', score: 11 }, 5)).toBe('"score" must be a number from 0 to 10')
    expect(scoreOf({ problem: 'x', score: '7' }, 5)).toBe('"score" must be a number from 0 to 10')
  })

  test('the stats count today, the last ten, and days in a row', () => {
    const at = (daysAgo: number, score: number) => ({ at: NOON - daysAgo * DAY, problem: 'p', score, note: '' })
    const stats = statsOf([at(4, 2), at(2, 6), at(1, 8), at(0, 9), at(0, 7)], NOON)

    expect(stats).toEqual({ total: 5, today: 2, average: 6.4, best: 9, streak: 3 })
  })

  test('a streak survives until today is over, and ends after a missed day', () => {
    const at = (daysAgo: number) => ({ at: NOON - daysAgo * DAY, problem: 'p', score: 5, note: '' })

    expect(statsOf([at(2), at(1)], NOON).streak).toBe(2)
    expect(statsOf([at(3), at(2)], NOON).streak).toBe(0)
    expect(statsOf([], NOON)).toEqual({ total: 0, today: 0, average: null, best: null, streak: 0 })
  })

  test('a config that is wrong says how', () => {
    expect(parseConfig('{')).toBe('not valid JSON')
    expect(parseConfig('{"yours":"llm"}')).toBe('"yours" must be a list of folders or files')
  })
})

// --------------------------------------------------------- through the engine

type World = { written: Record<string, string>; toasts: string[]; contexts: string[][] }

function world(on: On, config: string | null = CONFIG): World {
  const state: World = { written: {}, toasts: [], contexts: [] }
  const file = `${ROOT}/.coach.json`

  mock.store(on)
  mock.clock(on, { now: NOON })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__practice-coach__${e.name}` } }))
  on('fs.exists', ($, e) => ({ value: e.path === file && (config !== null || file in state.written) }))
  on('fs.read', () => ({ value: state.written[file] ?? config ?? '' }))
  on('fs.write', ($, e) => {
    state.written[e.path] = e.text

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    state.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('prompt.submit', ($, e) => {
    state.contexts.push([...(e.context ?? [])])

    return { text: e.text, context: e.context }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: {} }))

  return state
}

const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
const PROMPT = { text: 'next problem please', wait: false, origin: { kind: 'composer' } } as const
const DONE = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
const run = (args: string) =>
  ({ command: 'coach', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }) as const

const check = (path: string) => ({ tool: 'Edit', input: { file_path: `${ROOT}/${path}`, old_string: 'a', new_string: 'b' } })

describe('the guard', () => {
  test('Claude cannot write the learner\'s files, and is told to hint instead', async ($, on) => {
    world(on)
    await $.session.start(START)

    const refused = await $.tool.check(check('llm/attention.py'))

    expect(refused.decision).toBe('deny')
    expect(refused.reason).toMatch(/llm\/attention\.py is the learner's to write/)
    expect(refused.reason).toMatch(/Give a hint instead/)
    expect((await $.tool.check(check('tests/test_attention.py'))).decision).toBe('allow')
  })

  test('a notebook cell and a shell redirect are covered too', async ($, on) => {
    world(on)
    await $.session.start(START)

    const cell = await $.tool.check({
      tool: 'NotebookEdit',
      input: { notebook_path: `${ROOT}/scratch/drill.ipynb`, new_source: 'x = 1' },
    })
    const shell = await $.tool.check({ tool: 'Bash', input: { command: 'echo x > prep/sorting.py' } })

    expect(cell.decision).toBe('deny')
    expect(shell.decision).toBe('deny')
    expect((await $.tool.check({ tool: 'Bash', input: { command: 'pytest -q' } })).decision).toBe('allow')
  })

  test('Claude cannot edit its way out through the config', async ($, on) => {
    world(on)
    await $.session.start(START)

    expect((await $.tool.check(check('.coach.json'))).decision).toBe('deny')
  })

  test('turning coach off lifts the guard, and on puts it back', async ($, on) => {
    world(on)
    await $.session.start(START)
    await $.command.run(run('off'))
    expect((await $.tool.check(check('llm/attention.py'))).decision).toBe('allow')

    await $.command.run(run('on'))
    expect((await $.tool.check(check('llm/attention.py'))).decision).toBe('deny')
  })

  test('with no config nothing is guarded and nothing is added', async ($, on) => {
    const state = world(on, null)

    await $.session.start(START)
    await $.prompt.submit(PROMPT)

    expect((await $.tool.check(check('llm/attention.py'))).decision).toBe('allow')
    expect(state.contexts).toEqual([[]])
  })

  test('init names the folders and turns coaching on', async ($, on) => {
    const state = world(on, null)

    await $.session.start(START)

    const out = await $.command.run(run('init src/ drills/'))

    expect(out.text).toMatch(/Claude will not write src\/, drills\//)
    expect(JSON.parse(state.written[`${ROOT}/.coach.json`] ?? '{}')).toEqual({ yours: ['src/', 'drills/'], rules: [] })
    expect((await $.tool.check(check('src/app.py'))).decision).toBe('deny')
  })
})

describe('the coaching', () => {
  test('every prompt carries the rules while coach is on', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.prompt.submit(PROMPT)

    expect(state.contexts[0]?.[0]).toMatch(/Coach mode is on/)
    expect(state.contexts[0]?.[0]).toMatch(/run \/coach reveal first/)
  })

  test('reveal unlocks the answer for one reply only', async ($, on) => {
    const state = world(on)

    await $.session.start(START)
    await $.command.run(run('reveal'))
    await $.prompt.submit(PROMPT)
    await $.turn.complete(DONE)
    await $.prompt.submit(PROMPT)

    expect(state.contexts[0]?.[0]).toMatch(/in this one reply you may show/)
    expect(state.contexts[1]?.[0]).toMatch(/run \/coach reveal first/)
    // Unlocked or not, the files stay the learner's.
    expect((await $.tool.check(check('llm/attention.py'))).decision).toBe('deny')
  })

  test('a score Claude records is kept, shown and counted', async ($, on) => {
    const state = world(on)

    await $.session.start(START)

    const ok = await $.tool.call({
      tool: 'mcp__practice-coach__score',
      tool_use_id: 's1',
      problem: 'max_drawdown',
      score: 7,
      note: 'missed the empty list',
    })
    const bad = await $.tool.call({ tool: 'mcp__practice-coach__score', tool_use_id: 's2', problem: 'x', score: 40 })

    expect(ok.result).toBe('Recorded 7/10 for max_drawdown.')
    expect(bad.deny).toMatch(/must be a number from 0 to 10/)
    expect(state.toasts).toEqual(['7/10 on max_drawdown'])

    for (const surface of ['terminal', 'desktop'] as const) {
      const band = await $.ui.mount({
        plugin: 'practice-coach',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
      })

      expect(await band.find({ type: 'Text', text: '1 scored today · average 7.0' })).toBeDefined()
      await band.unmount()

      const pane = await $.ui.mount({
        plugin: 'practice-coach',
        surface,
        component: 'Pane',
        requestId: 'coach',
        props: { title: 'Coach', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
      })

      expect(await pane.find({ type: 'Text', text: 'Coach is ON' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /max_drawdown: missed the empty list/ })).toBeDefined()
      await pane.unmount()
    }
  })

  test('the pane turns coaching off and the guard goes with it', async ($, on) => {
    world(on)
    await $.session.start(START)

    const pane = await $.ui.mount({
      plugin: 'practice-coach',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'coach',
      props: { title: 'Coach', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })

    await pane.press({ key: 'toggle' })
    expect(await pane.find({ type: 'Text', text: 'Coach is OFF' })).toBeDefined()
    expect((await $.tool.check(check('llm/attention.py'))).decision).toBe('allow')
    await pane.unmount()
  })
})
