// A vitest reporter for scripts/mutation-check.mjs. Vitest's JSON reporter does
// not receive unhandled errors, so a run with one looks clean in the JSON. This
// reporter writes the first line of each message to the file named in
// YF_UNHANDLED_FILE. The runner reads that file and treats any message as a suite error.
import { writeFileSync } from 'node:fs'

export default class MutationErrorReporter {
  onTestRunEnd(_testModules, unhandledErrors) {
    const messages = unhandledErrors.map(error => String(error?.message ?? error).split('\n')[0])
    writeFileSync(process.env.YF_UNHANDLED_FILE, JSON.stringify({ messages }))
  }
}
