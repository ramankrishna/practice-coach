// Coach's rules, with no engine in them: every function here is pure, so the
// tests and the hooks read the same judgement.

import type { Score, Stats } from '../types'

export const CONFIG = '.coach.json'

export type Config = {
  /** Folders, files or `*.ext` patterns the learner writes and Claude may not. */
  yours: string[]
  /** Extra coaching rules, one sentence each, added to the built-in ones. */
  rules: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(one => typeof one === 'string')

/** Reads `.coach.json`; answers the config, or one line saying what is wrong. */
export function parseConfig(text: string): Config | string {
  let data: unknown

  try {
    data = JSON.parse(text)
  } catch {
    return 'not valid JSON'
  }

  if (!isRecord(data)) return 'expected an object with "yours"'

  const yours = data.yours ?? []
  const rules = data.rules ?? []

  if (!isStrings(yours)) return '"yours" must be a list of folders or files'
  if (!isStrings(rules)) return '"rules" must be a list of sentences'

  return {
    yours: yours.map(one => one.replace(/^\.\//, '').trim()).filter(one => one !== ''),
    rules: rules.map(one => one.trim()).filter(one => one !== ''),
  }
}

// ------------------------------------------------------------------ paths

export function relative(root: string, path: string): string {
  const base = root.endsWith('/') ? root : `${root}/`

  return root !== '' && path.startsWith(base) ? path.slice(base.length) : path
}

/**
 * Whether a path, relative to the project, is the learner's to write.
 *
 * `llm/` and `llm` name a folder and everything under it, `notes.py` one
 * file, `*.ipynb` every file of that kind, and `.` the whole project.
 */
export function isYours(yours: readonly string[], path: string): boolean {
  const clean = path.replace(/^\.\//, '')

  if (clean.startsWith('/') || clean.startsWith('../')) return false

  const base = clean.split('/').pop() ?? clean

  return yours.some(pattern => {
    if (pattern === '.' || pattern === './') return true
    if (pattern.startsWith('*.')) return base.endsWith(pattern.slice(1))

    const folder = pattern.endsWith('/') ? pattern : `${pattern}/`

    return clean === pattern.replace(/\/$/, '') || clean.startsWith(folder)
  })
}

const WRITES = /^(sed\s+[^|;&]*-i|tee\b|mv\b|cp\b|truncate\b|patch\b|git\s+(checkout|restore|apply)\b)/

/** The learner's file a shell command looks set to write, or null. */
export function bashWritesYours(yours: readonly string[], command: string): string | null {
  for (const part of command.split(/&&|\|\||[;|\n]/)) {
    const segment = part.replace(/\s+/g, ' ').trim()
    const tokens = (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(token =>
      token.replace(/^(["'])(.*)\1$/, '$2'),
    )

    for (let at = 1; at < tokens.length; at += 1) {
      const token = tokens[at] ?? ''
      const isRedirect = /^\d?>{1,2}/.test(token) || /^\d?>{1,2}$/.test(tokens[at - 1] ?? '')
      const path = token.replace(/^\d?>{1,2}/, '')

      if (path === '' || path.startsWith('-') || !isYours(yours, path)) continue
      if (isRedirect || WRITES.test(segment)) return path
    }
  }

  return null
}

export const denyText = (path: string): string =>
  `Coach: ${path} is the learner's to write, so this edit was not made. ` +
  'Do not write it for them, in the file or in chat. Give a hint instead: a question first, ' +
  'then the concept, then the line to look at. If they ask for the answer, tell them to run /coach reveal.'

// --------------------------------------------------------------- briefing

/** What Claude reads beside each prompt while coaching is on. */
export function briefing(config: Config, canReveal: boolean): string {
  const where = config.yours.length > 0 ? config.yours.join(', ') : 'the practice files'
  const lines = [
    'Coach mode is on. The person is learning by writing the code themselves, and you are their coach.',
    `- The files under ${where} are theirs to write. You cannot edit them, and you do not paste finished solutions for them into chat either.`,
    '- Give one small problem at a time, small enough to finish in one sitting.',
    '- Before they write code, have them restate the problem in a sentence: what goes in, what comes out, and whether the size changes.',
    '- Before they run anything, have them predict the result: a value, a shape, or an error.',
    '- When they submit code, score it out of 10, say exactly what cost points, and ask one question about their reasoning. Then call the mcp__practice-coach__score tool with the problem name and the score.',
    '- Hints go from small to large: a question first, then the concept, then the line to look at. Never the finished code.',
    '- Ask why before you explain why.',
    ...config.rules.map(rule => `- ${rule}`),
  ]

  lines.push(
    canReveal
      ? '- The person ran /coach reveal: in this one reply you may show and explain the full solution in chat. You still may not write it into their files.'
      : '- If they ask to see the answer, tell them to run /coach reveal first.',
  )

  return lines.join('\n')
}

// ----------------------------------------------------------------- scores

/** Reads the score tool's arguments; answers the score, or what is wrong. */
export function scoreOf(input: Record<string, unknown>, at: number): Score | string {
  const problem = typeof input.problem === 'string' ? input.problem.replace(/\s+/g, ' ').trim() : ''
  const score = typeof input.score === 'number' ? input.score : Number.NaN
  const note = typeof input.note === 'string' ? input.note.replace(/\s+/g, ' ').trim() : ''

  if (problem === '') return 'a "problem" name is needed'
  if (!Number.isFinite(score) || score < 0 || score > 10) return '"score" must be a number from 0 to 10'

  return { at, problem: problem.slice(0, 80), score: Math.round(score * 10) / 10, note: note.slice(0, 160) }
}

export const addScore = (scores: readonly Score[], score: Score): Score[] =>
  [...scores, score].slice(-500)

/** The day a moment falls on where the person is, as a count of days. */
function dayOf(at: number): number {
  return Math.floor((at - new Date(at).getTimezoneOffset() * 60_000) / 86_400_000)
}

/** What the scores add up to as of `now`. */
export function statsOf(scores: readonly Score[], now: number): Stats {
  const today = dayOf(now)
  const days = new Set(scores.map(score => dayOf(score.at)))
  const recent = scores.slice(-10)

  // A streak counts back from today, or from yesterday while today is still open.
  let streak = 0
  let day = days.has(today) ? today : today - 1

  while (days.has(day)) {
    streak += 1
    day -= 1
  }

  return {
    total: scores.length,
    today: scores.filter(score => dayOf(score.at) === today).length,
    average:
      recent.length === 0
        ? null
        : Math.round((recent.reduce((sum, score) => sum + score.score, 0) / recent.length) * 10) / 10,
    best: scores.reduce<number | null>(
      (best, score) => (best === null || score.score > best ? score.score : best),
      null,
    ),
    streak,
  }
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** The band's line while coaching is on. */
export function bandLine(stats: Stats): string {
  const parts = [`${stats.today} scored today`]

  if (stats.average !== null) parts.push(`average ${stats.average.toFixed(1)}`)
  if (stats.streak > 1) parts.push(`${plural(stats.streak, 'day')} in a row`)

  return parts.join(' · ')
}

export const clip = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, Math.max(1, width - 3))}...` : text
