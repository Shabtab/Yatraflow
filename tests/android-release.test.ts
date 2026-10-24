// v0.79.0 and v0.79.1 both shipped with no APK on the release page. The tag
// run was green: it built the APK and stopped at the workflow artifact, which
// expires after 14 days and is invisible to anyone who downloads a release.
// The version drift hid the second half — build.gradle said 0.14-native and
// versionCode 14 while package.json said 0.79.1, so the in-app update check
// (#809) could never see a newer build.
//
// This pin holds both halves: a tag run must attach the file to the release,
// and the Android version must come from package.json rather than a literal.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

// Comments explain the workflow, so a guard that reads them can be satisfied
// by prose alone. Strip them before asserting anything about behaviour.
const withoutComments = (yaml: string) =>
  yaml
    .split(/\r?\n/)
    .filter(line => !/^\s*#/.test(line))
    .join('\n')

describe('Android release workflow', () => {
  const workflow = withoutComments(read('../.github/workflows/yatraflow-apk.yml'))
  const gradle = read('../android/app/build.gradle')
  const pkg = JSON.parse(read('../package.json'))

  it('attaches the APK to the release on a tag run', () => {
    expect(workflow).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(workflow).toContain('gh release upload "$GITHUB_REF_NAME"')
    expect(workflow).toContain('YatraFlow-*.apk')
  })

  it('runs every action on a runtime the runners still provide', () => {
    expect(workflow).not.toMatch(/uses:\s+actions\/[a-z-]+@v4\b/)
    // v5 of upload-artifact still defaults to Node 20; v6 is the first that
    // runs on Node 24 by default.
    expect(workflow).not.toMatch(/actions\/upload-artifact@v5\b/)
  })

  it('takes the Android version from package.json', () => {
    expect(gradle).toContain("file(\"${project.rootDir}/../package.json\")")
    expect(gradle).toMatch(/versionCode versionParts\[0\] \* 10000 \+ versionParts\[1\] \* 100 \+ versionParts\[2\]/)
    expect(gradle).toMatch(/versionName "\$\{packageVersion\}-native"/)
    expect(gradle).not.toMatch(/versionCode\s+\d+/)
    expect(gradle).not.toMatch(/versionName\s+"\d/)
  })

  it('derives a version code above the last native build', () => {
    const [major, minor, patch] = pkg.version.split('.').map(Number)
    expect(major * 10000 + minor * 100 + patch).toBeGreaterThan(14)
  })
})
