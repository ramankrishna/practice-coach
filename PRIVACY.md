# Privacy

Last updated: October 9, 2026

Coach is a mod that runs inside Claude Code on your own machine. It has no server and no account.

## What it collects

Nothing. Coach does not collect, transmit or share any data. It makes no network requests, makes no model calls of its own, and sends no telemetry or analytics. The author receives no information about you or your use of it.

## What it handles on your machine

To do its job, Coach works with the following, all of which stay on your computer:

- **During a session, in memory:** whether coaching is on, and the file paths and shell commands Claude asks to use, read at the moment Claude Code decides whether each may run.
- **Between sessions, on disk:** the scores Claude records for you. Each one holds the time, the problem's name, the score, and a one-line note. They are kept in Claude Code's own plugin store on your machine, keyed by your project's path.
- **In your project:** it reads `.coach.json`, and writes that file once if you run `/coach init` and it does not exist yet.

## What it adds to your conversation

While Coach is on, it adds a short set of coaching rules to each prompt you send, as context Claude reads. That text goes to the model along with the rest of your conversation, under the same terms as everything else you send through Claude Code. It contains the names of the folders you marked as yours and any rules you wrote in `.coach.json`.

## Removing its data

Uninstalling the plugin stops all of the above. The saved scores live in Claude Code's plugin store under `~/.claude/plugins/store/` and can be deleted there. `.coach.json` is a file in your project and is yours to keep or delete.

## What Coach does not cover

Coach runs inside Claude Code. How Claude Code and Anthropic handle your prompts, code and usage is governed by Anthropic's own policies, not this one.

## Changes

Any change to this policy will be made in this file, and the history is visible in the repository.

## Contact

Questions or concerns: open an issue at https://github.com/ramankrishna/practice-coach/issues
