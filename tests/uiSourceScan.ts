import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

export function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const file = join(root, entry.name)
    return entry.isDirectory() ? sourceFiles(file) : /\.tsx?$/.test(file) ? [file] : []
  })
}

/** Parsing excludes comments without changing source offsets used by diagnostics. */
export function sourceTree(file: string, input = readFileSync(file, 'utf8'), setParents = true) {
  const source = input.replace(/\r\n/g, '\n')
  return { source, tree: ts.createSourceFile(file, source, ts.ScriptTarget.Latest, setParents) }
}

// The dash character, its HTML entity, and the escape text a source file can carry.
const BANNED_DASH = /—|&mdash;|&#8212;|&#x2014;|\\u2014|\\u\{2014\}/i
// The owner locked the main product line word for word, with its em dash (2026-11-20).
// Only this exact single-quoted literal is exempt. Any other spelling or wording still fails.
const LOCKED_BRAND_LINES = new Set(["'Plan Indian trips together — not in a chaotic group chat.'"])

export function emDashLabels(file: string, input?: string): string[] {
  const normalized = (input ?? readFileSync(file, 'utf8')).replace(/\r\n/g, '\n')
  if (!BANNED_DASH.test(normalized)) return []
  // The scan reads no parent links, so it skips building them.
  const { source, tree } = sourceTree(file, normalized, false)
  const failures: string[] = []
  function visit(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      // Check the literal source text, so an escape cannot hide a dash the emitted text would show.
      const raw = source.slice(node.getStart(tree), node.end)
      if (BANNED_DASH.test(raw) && !LOCKED_BRAND_LINES.has(raw)) failures.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${raw.trim()}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return failures
}

const MID_PHRASE_CAPITAL = /[a-z0-9] (?:Along|In|Added|By|On|At|For|With|Of|To|From|The|And|Or|Is|Are) [a-z]/
const visibleProps = /^(?:aria-label|aria-description|title|placeholder|alt|label|caption|subtitle|hint|message|emptyText|loadingText|errorText|description|text)$/
// A value that shows an example, never a word, in the context it is written in.
//  - A URL or an e-mail address is an example anywhere.
//  - "e.g." starts an example in a placeholder, a title or an aria-* value, nowhere else.
//  - A model or key id ("gpt-4o-mini", "sk-…") is an example only in a known example prop.
// A bare id such as "day-1" in a button is a label, so it is never exempt on its own.
const EXAMPLE_ATTR = /^(?:placeholder|example|sample|exampleValue)$/
const EXAMPLE_HINT_ATTR = /^(?:placeholder|title|aria-[a-z]+)$/
export function isExampleValue(value: string, context = ''): boolean {
  if (/^(?:https?:\/\/|www\.)/i.test(value)) return true
  if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(value)) return true
  if (/^e\.g\./.test(value)) return EXAMPLE_HINT_ATTR.test(context)
  return EXAMPLE_ATTR.test(context) && /^[a-z0-9][a-z0-9.\-…]*$/.test(value) && /[\d…]/.test(value)
}

/** The Map gate: strict. Every text run that starts a label must start with a capital or a number. */
export function lowercaseMapLabels(file: string, input?: string): string[] {
  return scanLabels(file, input, false)
}

/**
 * The whole-app gate. It adds two proven safe cases the Map gate does not allow:
 *  - UNIT: text right after a count on the same text run, such as "{n} places" (see followsCount).
 *  - EXAMPLE: a value in a verified example context (see isExampleValue), or text inside <code>.
 * Text after a decorative element (a self-closing tag, an empty tag, an aria-hidden tag) is checked in both gates.
 */
export function lowercaseUiLabels(file: string, input?: string): string[] {
  return scanLabels(file, input, true)
}

const isBlankText = (node: ts.Node) => ts.isJsxText(node) && node.text.trim() === ''
const isSpaceExpression = (node: ts.Node) => ts.isJsxExpression(node) && !!node.expression && ts.isStringLiteralLike(node.expression) && node.expression.text.trim() === ''

// A source expression that gives a number: a literal, a length, rounding, a formatter, or a count-style name.
const COUNT_NAME = /^(?:n|k|count|total|num|number|len|length|size|qty|days|nights|stops|places|hours|minutes|mins|km|distance\w*|duration\w*|\w*(?:Count|Total|Num|Km|Days|Nights|Minutes|Hours|Length|Size|Qty|Cost|Price|Inr|Pct|Score|Amount|PerHead|Total))$/
const COUNT_CALL = /^(?:Math\.(?:round|floor|ceil|max|min|abs)|formatInr|formatKm|minutesToHM|pct|\w+(?:\.\w+)*\.(?:toLocaleString|toFixed))$/
function isNumericExpression(node: ts.Node): boolean {
  if (ts.isNumericLiteral(node)) return true
  if (ts.isParenthesizedExpression(node)) return isNumericExpression(node.expression)
  if (ts.isIdentifier(node)) return COUNT_NAME.test(node.text)
  if (ts.isPropertyAccessExpression(node)) return COUNT_NAME.test(node.name.text)
  if (ts.isCallExpression(node)) return COUNT_CALL.test(node.expression.getText()) || (ts.isPropertyAccessExpression(node.expression) && /^(?:toLocaleString|toFixed)$/.test(node.expression.name.text))
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind
    if ([ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.PercentToken].includes(kind)) return true
    return kind === ts.SyntaxKind.PlusToken && isNumericExpression(node.left) && isNumericExpression(node.right)
  }
  if (ts.isConditionalExpression(node)) return isNumericExpression(node.whenTrue) && isNumericExpression(node.whenFalse)
  return false
}

/** A count is `{n}`, a number in text, or an element that wraps one (`<b>{n}</b>`). */
function isCount(child: ts.Node): boolean {
  if (ts.isJsxExpression(child)) return !!child.expression && isNumericExpression(child.expression)
  if (ts.isJsxText(child)) return /[0-9][%]?\s*$/.test(child.text)
  if (ts.isJsxElement(child)) {
    const content = child.children.filter(item => !isBlankText(item))
    return content.length === 1 && isCount(content[0])
  }
  return false
}

/**
 * The count a singular or plural switch tests: `{n === 1 ? 'fork' : 'forks'}` tests "n".
 * The switch proves "n" is a count. A sibling that shows "n" just before it proves the unit.
 */
function pluralOperand(child: ts.Node): string | null {
  if (!ts.isJsxExpression(child) || !child.expression) return null
  const expression = ts.isParenthesizedExpression(child.expression) ? child.expression.expression : child.expression
  if (!ts.isConditionalExpression(expression)) return null
  const test = expression.condition
  if (!ts.isBinaryExpression(test) || !ts.isNumericLiteral(test.right) || test.right.text !== '1') return null
  return [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(test.operatorToken.kind) ? test.left.getText() : null
}

/**
 * True when a JSX child follows a proven count on the same text run. Then a lowercase start is a unit
 * ("{n} places", "<b>{n}</b> places", "\u20b9{x} <span>per person</span>").
 * A newline between the two ends the run, because React drops it.
 * Source whitespace alone proves nothing: "<h3>Title</h3> <p>lowercase</p>" is two blocks.
 * It climbs the first-child chain of nested elements.
 */
function followsCount(child: ts.Node): boolean {
  let cur: ts.Node = child
  while (cur.parent && (ts.isJsxElement(cur.parent) || ts.isJsxFragment(cur.parent))) {
    const siblings = cur.parent.children
    let i = siblings.indexOf(cur as ts.JsxChild) - 1
    let gap = ''
    while (i >= 0 && (isBlankText(siblings[i]) || isSpaceExpression(siblings[i]))) {
      gap += ts.isJsxText(siblings[i]) ? (siblings[i] as ts.JsxText).text : ' '
      i -= 1
    }
    if (i >= 0) {
      const previous = siblings[i]
      const tail = ts.isJsxText(previous) ? previous.text.match(/\s*$/)?.[0] ?? '' : ''
      const operand = cur === child ? pluralOperand(child) : null
      const proven = isCount(previous) || (operand !== null && previous.getText().includes(operand))
      return proven && !/\n/.test(gap + tail)
    }
    cur = cur.parent
  }
  return false
}

/** An element that carries no words: a self-closing tag, an empty tag, or an aria-hidden tag. */
function isDecorative(node: ts.Node): boolean {
  if (ts.isJsxSelfClosingElement(node)) return true
  if (!ts.isJsxElement(node)) return false
  const hidden = node.openingElement.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.getText() === 'aria-hidden')
  return hidden || node.children.every(isBlankText)
}

const insideCode = (node: ts.Node) => {
  for (let cur: ts.Node | undefined = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxElement(cur) && cur.openingElement.tagName.getText() === 'code') return true
  }
  return false
}

function scanLabels(file: string, input: string | undefined, relaxed: boolean): string[] {
  const { tree } = sourceTree(file, input)
  let continuesRun = false
  const failures = new Set<string>()
  function at(node: ts.Node, value: string) {
    failures.add(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${value}`)
  }
  // Only the first letter is a capital. A capital inside a phrase ("3 picks Along the drive") is a sweep defect.
  function midPhrase(node: ts.Node, text: string) {
    if (MID_PHRASE_CAPITAL.test(text)) at(node, text.trim())
  }
  function check(node: ts.Node, text: string, context = '') {
    const value = text.trim()
    if (/^[a-z]/.test(value) && !/^(?:min|km|m|h|s|k|px|am|pm)(?:\b|$)/.test(value) && !(relaxed && (continuesRun || isExampleValue(value, context) || insideCode(node)))) at(node, value)
    midPhrase(node, text)
  }
  function rendered(node: ts.Node, context = '') {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) check(node, node.text, context)
    else if (ts.isTemplateExpression(node)) {
      check(node.head, node.head.text, context)
      for (const span of node.templateSpans) midPhrase(span.literal, span.literal.text)
    }
    else if (ts.isConditionalExpression(node)) { rendered(node.whenTrue, context); rendered(node.whenFalse, context) }
    else if (ts.isParenthesizedExpression(node)) rendered(node.expression, context)
    else if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) rendered(node.right, context)
      else if ([ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) { rendered(node.left, context); rendered(node.right, context) }
    }
  }
  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const siblings = node.parent.children
      // Text after a decorative element (a dot, an icon, an aria-hidden glyph) starts its own run.
      const earlier = siblings.slice(0, siblings.indexOf(node)).some(child => (!ts.isJsxText(child) || child.text.trim() !== '') && !isDecorative(child))
      if (!earlier) {
        continuesRun = relaxed && followsCount(node)
        check(node, node.text)
        continuesRun = false
      }
    }
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      continuesRun = relaxed && followsCount(node)
      rendered(node.expression)
      continuesRun = false
    }
    if (ts.isJsxAttribute(node) && visibleProps.test(node.name.getText(tree)) && node.initializer) {
      const prop = node.name.getText(tree)
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) rendered(node.initializer.expression, prop)
      else rendered(node.initializer, prop)
    }
    if (ts.isPropertyAssignment(node) && visibleProps.test(node.name.getText(tree).replace(/['"]/g, ''))) rendered(node.initializer, node.name.getText(tree).replace(/['"]/g, ''))
    if (ts.isReturnStatement(node) && node.expression) {
      let owner: ts.Node | undefined = node.parent
      while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent
      if (owner && ts.isFunctionDeclaration(owner) && /(?:Text|Label|Bits|Kicker|Title|Meta)$/.test(owner.name?.text ?? '')) rendered(node.expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return [...failures]
}
