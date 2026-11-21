import { expect, it } from 'vitest'
import { emDashLabels, sourceFiles } from './uiSourceScan'

it('rejects em dashes and their HTML entity in source literals and JSX with file and line', () => {
  const bad = 'const label = "Trip ' + String.fromCodePoint(0x2014) + ' Goa"\r\nconst view = <p>Time &mdash; Unknown</p>'
  expect(emDashLabels('example.tsx', bad)).toEqual([
    expect.stringMatching(/^example\.tsx:1:/), expect.stringMatching(/^example\.tsx:2:/),
  ])
  expect(emDashLabels('example.tsx', '// ' + String.fromCodePoint(0x2014) + '\n/* &mdash; */\n// \\u2014\nconst label = "08:00 – 09:30"')).toEqual([])
  expect(emDashLabels('example.tsx', 'const escaped = "Trip \\u2014 Goa"')).toEqual([expect.stringMatching(/^example\.tsx:1:/)])
  // Every other spelling of the dash, in a template literal and a JSX attribute.
  const spellings = [
    'const a = `Trip ${"x"} \\u{2014} Goa`',
    'const b = <p title="Trip &#8212; Goa">x</p>',
    'const c = <p aria-label="Trip &#x2014; Goa">x</p>',
    'const d = <p aria-label={"Trip ' + String.fromCodePoint(0x2014) + ' Goa"}>x</p>',
  ].join('\n')
  expect(emDashLabels('example.tsx', spellings)).toEqual([
    expect.stringMatching(/^example\.tsx:1:/),
    expect.stringMatching(/^example\.tsx:2:/),
    expect.stringMatching(/^example\.tsx:3:/),
    expect.stringMatching(/^example\.tsx:4:/),
  ])
})

it('keeps every UI source literal and JSX text free of em dashes', () => {
  expect(sourceFiles('src').flatMap(file => emDashLabels(file))).toEqual([])
  // It parses every src file. 5 s is too short under full-suite load (#1002).
}, 30000)
