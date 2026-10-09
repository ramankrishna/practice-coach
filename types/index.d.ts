/** One graded attempt, as the coach recorded it. */
export type Score = {
  /** When it was recorded, in milliseconds. */
  at: number
  problem: string
  /** Out of 10. */
  score: number
  note: string
}

export type Stats = {
  total: number
  today: number
  /** The mean of the last ten scores, or null with none. */
  average: number | null
  best: number | null
  /** Days in a row with at least one score, counted back from today. */
  streak: number
}

/** What `.coach.json` says, as the session last read it. */
export type Setup = {
  hasFile: boolean
  yours: string[]
  rules: string[]
  /** What is wrong with the file, or null. */
  problem: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'practice-coach': {
      isOn: boolean
      canReveal: boolean
      scores: Score[]
      setup: Setup
    }
  }
}
