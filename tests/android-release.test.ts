// v0.79.0 and v0.79.1 both shipped with no APK on the release page. The tag
// run was green: it built the APK and stopped at the workflow artifact, which
// expires after 14 days and is invisible to anyone who downloads a release.
// The version drift hid the second half — build.gradle said 0.14-native and
// versionCode 14 while package.json said 0.79.1, so the in-app update check
// (#809) could never see a newer build.
//
// This pin holds both halves: every push must end with the file on a release
// (the run creates the release when none exists), and the Android version must come from package.json rather than a literal.
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

  it('runs the release step on main pushes as well as tag pushes', () => {
    const step = workflow.slice(workflow.indexOf('name: Attach APK to the release'))
    expect(step).toContain("if: github.event_name == 'push'")
    // A tag-only guard would skip the main promotion that has no tag yet.
    expect(step).not.toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(workflow).toMatch(/branches: \['main'\]/)
    expect(workflow).toMatch(/tags: \['v\*'\]/)
  })

  it('creates a missing release with notes taken from CHANGELOG.md', () => {
    expect(workflow).toContain('gh release create "$TAG"')
    expect(workflow).toContain('--title "YatraFlow ${TAG}"')
    expect(workflow).toContain('--notes-file release-notes.md')
    expect(workflow).toContain('--latest')
    expect(workflow).toContain('CHANGELOG.md')
    expect(workflow).toContain('"## [${VERSION}]"')
    // A main run creates the tag at the pushed commit. A tag run reuses its tag.
    expect(workflow).toContain('--target "$GITHUB_SHA"')
    expect(workflow).toContain('--verify-tag')
    // A promotion without a changelog section is a defect, not a quiet skip.
    expect(workflow).toMatch(/::error::CHANGELOG\.md has no section/)
  })

  it('names the tag from the ref on a tag run and from package.json on a main run', () => {
    expect(workflow).toContain('TAG="$GITHUB_REF_NAME"')
    expect(workflow).toContain("TAG=\"v$(node -p \"require('./package.json').version\")\"")
  })

  it('leaves a release alone when main moved without a version bump', () => {
    expect(workflow).toContain('::warning::')
    expect(workflow).toContain('Main moved without a version bump')
    expect(workflow).toMatch(/"\$EXISTING" != "\$GITHUB_SHA"/)
  })

  it('attaches the APK to the release with a clobbering upload', () => {
    expect(workflow).toContain(
      'gh release upload "$TAG" android/app/build/outputs/apk/debug/YatraFlow-*.apk --clobber',
    )
    expect(workflow).toContain('YatraFlow-*.apk')
  })

  it('runs a main push and a tag push for one commit one after the other', () => {
    expect(workflow).toMatch(/concurrency:\s+group: apk-\$\{\{ github\.sha \}\}/)
    expect(workflow).toContain('cancel-in-progress: false')
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

  // Profile said "Update checks are not configured in this build" on every CI
  // APK. The bundle is built here, and this step wrote four keys, but not the
  // two the update feed reads. A Vercel variable cannot reach this build.
  it('forwards the APK update feed settings into the web build', () => {
    expect(workflow).toContain("printf 'VITE_APK_UPDATE_FEED_URL=%s\\n'")
    expect(workflow).toContain("printf 'VITE_APK_UPDATE_HOSTS=%s\\n'")
    expect(workflow).toMatch(/VITE_APK_UPDATE_FEED_URL: \$\{\{ vars\.VITE_APK_UPDATE_FEED_URL \}\}/)
    expect(workflow).toMatch(/VITE_APK_UPDATE_HOSTS: \$\{\{ vars\.VITE_APK_UPDATE_HOSTS \}\}/)
    // A host spelled out here would bake a feed that nobody approved.
    expect(workflow).not.toMatch(/yatraflow\.in/)
  })
})
