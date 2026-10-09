# Coach

A learning mode for Claude Code. Claude coaches, hints and scores. You write the code.

If you are using Claude Code to learn something, the hard part is that it is always ready to write the answer for you, and you are always one tired evening away from letting it. Coach removes the option. You name the folders that are yours, and while Coach is on, Claude cannot write a single line in them.

## What changes while it is on

- **Claude cannot write your files.** Edits, new files, notebook cells and shell commands that write into the folders you named are refused. Claude is told to give a hint instead.
- **Claude coaches by a fixed set of rules.** One small problem at a time. You restate the problem before you code. You predict the result before you run. Submitted code gets a score out of 10 and a question about your reasoning. Hints go from a question, to the concept, to the line, and never to the finished code.
- **Your scores are kept.** When Claude grades you, it records the score. A line above the prompt shows how many you have done today and your recent average, and `/coach` shows your history and your streak.
- **Seeing the answer is a deliberate act.** `/coach reveal` lets Claude show the full solution in chat, for one reply. Even then it cannot write it into your files.

Claude can still read your code, run your tests, and write anything outside your folders, so it can build the scaffolding and tests you practise against.

## Install

```
/plugin install practice-coach --marketplace ramankrishna/practice-coach
```

Answer `y` to add the marketplace, then pick a scope. Needs Claude Code v2.1.287 or later.

## Start

In the project you practise in, name what is yours:

```
/coach init src/ exercises/
```

That writes `.coach.json` and turns Coach on. From then on it starts on by itself in that project.

| Command | What it does |
| :- | :- |
| `/coach` | Opens your progress |
| `/coach on`, `/coach off` | Turns coaching and the guard on or off for this session |
| `/coach reveal` | Unlocks the full answer, in chat, for the next reply only |
| `/coach init <folders>` | Writes `.coach.json` naming your folders |

## The config

```json
{
  "yours": ["llm/", "prep/", "*.ipynb"],
  "rules": ["Use PyTorch only, never NumPy.", "Ask me for tensor shapes before every run."]
}
```

- `yours` takes folders, single files, `*.ext` patterns, or `.` for the whole project.
- `rules` adds your own coaching rules to the built-in ones, one sentence each.
- Claude cannot edit `.coach.json` while Coach is on, so it cannot quietly remove a folder from the list.

## What it runs, reads and stores

- **Reads** `.coach.json` at the project root.
- **Writes** `.coach.json` once, only when you run `/coach init` and the file does not exist.
- **Adds text to your prompts.** While Coach is on, each prompt you send carries the coaching rules to Claude as hidden context. That uses a few hundred tokens per turn.
- **Adds one tool** that Claude calls to record a score. The tool only saves the score.
- **Stores** your scores on your machine, in Claude Code's plugin store, keyed by the project's path.
- **Sends nothing.** No network calls, no model calls of its own, no telemetry.

Like every mod, it runs with the same access to your machine as Claude Code itself. The full statement is in [PRIVACY.md](PRIVACY.md).

## Limits

- **The guard is certain; the coaching is not.** Blocking writes to your folders is enforced by code. The coaching rules are instructions to a model, which follows them well but not perfectly. If Claude pastes a solution into chat anyway, that is a miss this mod cannot prevent.
- **Scores are Claude's opinion.** They are useful for seeing your own trend, not as a measure against anyone else.
- **The shell guard reads commands, it does not run them.** It catches redirects, `sed -i`, `cp`, `mv` and `tee` into your folders. A script that writes your files from inside will get past it.
- **You can always turn it off.** `/coach off` is one command away. Coach makes the shortcut a deliberate choice; it cannot make the choice for you.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
