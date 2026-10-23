import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { escapeHtml, escapeXml } from '../api/_escape.js'

const HTML_ENTITIES: [string, string][] = [
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]

const XML_ENTITIES: [string, string][] = [
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&apos;'],
]

const UNICODE = 'नमस्ते · ₹18,500/person · Leh → Khardung La — 🏔'

// The four handlers that used to carry a local escape function.
const SITES = ['../api/c.js', '../api/i.js', '../api/_publicBody.js', '../api/sitemap.js']

// Matches a declaration such as `function escapeHtml(` or `const escapeXml =`.
// An import or a call does not match.
const LOCAL_DECLARATION = /\b(?:function\s+escape(?:Html|Xml)?\s*\(|(?:const|let|var)\s+escape(?:Html|Xml)?\s*=)/
const SHARED_IMPORT = /import\s*\{[^}]*\bescape(?:Html|Xml)\b[^}]*\}\s*from\s*'\.\/_escape\.js'/

// The source with whole comment lines removed, so a commented-out copy does not count.
function codeOf(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n')
}

describe('escapeHtml', () => {
  it.each(HTML_ENTITIES)('maps %j to %j', (character, entity) => {
    expect(escapeHtml(character)).toBe(entity)
  })

  it('escapes every special character in mixed text', () => {
    expect(escapeHtml(`Tom & Jerry's "Monsoon" <b>1 > 0</b>`)).toBe(
      'Tom &amp; Jerry&#39;s &quot;Monsoon&quot; &lt;b&gt;1 &gt; 0&lt;/b&gt;',
    )
  })

  it('coerces non-string input the way String() does', () => {
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(null)).toBe('null')
    expect(escapeHtml(undefined)).toBe('undefined')
  })

  it('escapes an already escaped string again', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;')
    expect(escapeHtml('&#39;')).toBe('&amp;#39;')
  })

  it('passes unicode text through unchanged', () => {
    expect(escapeHtml(UNICODE)).toBe(UNICODE)
  })
})

describe('escapeXml', () => {
  it.each(XML_ENTITIES)('maps %j to %j', (character, entity) => {
    expect(escapeXml(character)).toBe(entity)
  })

  it('escapes every special character in mixed text', () => {
    expect(escapeXml(`Tom & Jerry's "Monsoon" <b>1 > 0</b>`)).toBe(
      'Tom &amp; Jerry&apos;s &quot;Monsoon&quot; &lt;b&gt;1 &gt; 0&lt;/b&gt;',
    )
  })

  it('coerces non-string input the way String() does', () => {
    expect(escapeXml(42)).toBe('42')
    expect(escapeXml(null)).toBe('null')
    expect(escapeXml(undefined)).toBe('undefined')
  })

  it('escapes an already escaped string again', () => {
    expect(escapeXml('&amp;')).toBe('&amp;amp;')
    expect(escapeXml('&apos;')).toBe('&amp;apos;')
  })

  it('passes unicode text through unchanged', () => {
    expect(escapeXml(UNICODE)).toBe(UNICODE)
  })
})

describe('the two escape functions', () => {
  it('differ only in the apostrophe entity', () => {
    const all = `&<>"'`
    expect(escapeXml(all)).toBe(escapeHtml(all).replace('&#39;', '&apos;'))
  })
})

describe('api handlers', () => {
  it('import the shared helper and define no escape function of their own', () => {
    // Positive control: the guard must fire on a known-bad declaration.
    expect(LOCAL_DECLARATION.test('function escapeHtml(value) {')).toBe(true)
    expect(LOCAL_DECLARATION.test("import { escapeHtml } from './_escape.js'")).toBe(false)

    const localCopies = SITES.filter(path => LOCAL_DECLARATION.test(codeOf(path)))
    const missingImport = SITES.filter(path => !SHARED_IMPORT.test(codeOf(path)))
    expect(localCopies).toEqual([])
    expect(missingImport).toEqual([])
  })
})
