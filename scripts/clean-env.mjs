#!/usr/bin/env node
// Clears the NODE_ENV=production trap before an npm operation.
//
// This machine's shell inherits NODE_ENV=production. npm reads it as
// `--omit=dev`, so `npm install` reports success while installing only
// production dependencies — no typescript, no vitest. The failure then lands
// one command later as `'tsc' is not recognized`, which reads like a broken
// repo rather than a broken install (AGENTS.md §2 rule 15).
//
// This is not a persistent User or Machine variable, so it returns in every
// new shell. Clearing it per-command is the only reliable fix; a wrapper
// script is what keeps each agent from rediscovering it.
//
// Usage:
//   npm run clean:env            report the state, change nothing
//   npm run clean:env -- --apply clear it in this shell (bash/zsh)
//   npm run clean:env -- --exec <cmd> [args...]   run <cmd> with it cleared
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const isWin = process.platform === 'win32'

function current() {
  return process.env.NODE_ENV ?? ''
}

/** Report the state without changing anything. */
if (!args.includes('--apply') && !args.includes('--exec')) {
  const v = current()
  if (v === 'production') {
    console.log('NODE_ENV=production is set.')
    console.log('npm reads this as --omit=dev, so `npm install` skips devDependencies.')
    console.log('Fix it for one command with:')
    console.log(isWin
      ? '  Remove-Item Env:\\NODE_ENV -ErrorAction SilentlyContinue; npm install'
      : '  NODE_ENV= npm install')
    process.exit(0)
  }
  console.log(`NODE_ENV is ${v ? v : '(unset)'}. No trap.`)
  process.exit(0)
}

/** Run a command with NODE_ENV cleared. */
const execAt = args.indexOf('--exec')
if (execAt >= 0) {
  const cmd = args.slice(execAt + 1)
  if (!cmd.length) {
    console.error('--exec needs a command. Example: --exec npm install')
    process.exit(2)
  }
  const env = { ...process.env }
  delete env.NODE_ENV
  // No `shell`: on Windows it re-splits the command and mangles args that
  // carry their own quotes (e.g. `node -e "..."`).
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env })
  process.exit(r.status ?? 1)
}

/** Print the line a human or agent pastes into their shell. */
if (isWin) {
  console.log('Remove-Item Env:\\NODE_ENV -ErrorAction SilentlyContinue')
} else {
  console.log('unset NODE_ENV')
}
console.log('Then run your npm command in the same shell.')
