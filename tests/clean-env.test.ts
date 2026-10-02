// The NODE_ENV trap (AGENTS.md §2 rule 15) has cost every agent a confusing
// failure: `npm install` reports success, skips every devDependency, and the
// error lands one command later as `'tsc' is not recognized` — which reads
// like a broken repo rather than a broken install.
//
// scripts/clean-env.mjs is the fix, so this pins that it still clears the
// variable rather than merely reporting it.
import { spawnSync } from 'node:child_process'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'clean-env.mjs')
const PROBE = path.join(ROOT, 'scripts', '__env_probe_tmp.mjs')

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  })
}

function withoutNodeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.NODE_ENV
  return env
}

afterEach(() => {
  if (existsSync(PROBE)) unlinkSync(PROBE)
})

describe('clean-env (scripts/clean-env.mjs)', () => {
  it('reports the trap when NODE_ENV=production', () => {
    const r = run([], { ...process.env, NODE_ENV: 'production' })
    expect(r.stdout).toContain('NODE_ENV=production is set')
    expect(r.stdout).toContain('--omit=dev')
    expect(r.status).toBe(0)
  })

  it('reports no trap when the variable is unset', () => {
    const r = run([], withoutNodeEnv())
    expect(r.stdout).toContain('No trap')
    expect(r.status).toBe(0)
  })

  it('--exec runs the command with NODE_ENV removed', () => {
    writeFileSync(
      PROBE,
      'console.log("SEEN=" + JSON.stringify(process.env.NODE_ENV ?? null))\n',
      'utf8',
    )
    const r = run(['--exec', process.execPath, PROBE], { ...process.env, NODE_ENV: 'production' })
    expect(r.stdout).toContain('SEEN=null')
    expect(r.status).toBe(0)
  })

  it('--exec without a command exits non-zero', () => {
    const r = run(['--exec'], { ...process.env, NODE_ENV: 'production' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('needs a command')
  })
})
