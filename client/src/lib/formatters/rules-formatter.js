// ── TM1 Rules Formatter Engine ────────────────────────────────────────────────
// Token-aware formatter. Walks tokens left-to-right and applies spacing rules.

import { tokenize } from './tokenizer.js'
import { formatTM1Structured } from './tm1-structured.js'

/**
 * Get indent string based on settings.
 */
function getIndent(level, settings) {
  if (settings.indentStyle === 'tab') return '\t'.repeat(level)
  const size = settings.indentStyle === 'spaces4' ? 4 : 2
  return ' '.repeat(level * size)
}

/**
 * Determine spacing (number of spaces) between two tokens based on settings and context.
 */
function spacingBetween(prev, curr, settings, ctx) {
  if (!prev) return 0

  const p = prev.type
  const c = curr.type

  // Area prefix spacing: N: IF vs N:IF vs N:  IF
  if (p === 'area_prefix') {
    if (settings.areaPrefixSpacing === 'none') return 0
    if (settings.areaPrefixSpacing === 'single') return 1
    if (settings.areaPrefixSpacing === 'double') return 2
    return 1
  }

  // After comment: nothing follows
  if (p === 'comment') return 0

  // Before comment: preserve original spacing or use single
  if (c === 'comment') return 1

  // Comma spacing
  if (p === 'punctuation' && prev.value === ',') {
    return settings.commaSpacing === 'single' ? 1 : 0
  }
  if (c === 'punctuation' && curr.value === ',') {
    return 0
  }

  // Semicolon spacing
  if (p === 'punctuation' && prev.value === ';') {
    return settings.semicolonSpacing === 'single' ? 1 : 0
  }
  if (c === 'punctuation' && curr.value === ';') {
    return 0
  }

  // Punctuation pairs: ( ) [ ] { }
  // Before opening paren/bracket/brace
  if (c === 'punctuation' && (curr.value === '(' || curr.value === '[' || curr.value === '{')) {
    // No space before function call open paren (e.g., DB(...))
    if (curr.value === '(' && p === 'identifier') return 0
    if (curr.value === '(' && p === 'keyword') return 0
    return 0
  }
  // After opening paren/bracket/brace
  if (p === 'punctuation' && (prev.value === '(' || prev.value === '[' || prev.value === '{')) {
    if (settings.functionCallSpacing === 'expanded') return 1
    return 0
  }
  // Before closing paren/bracket/brace
  if (c === 'punctuation' && (curr.value === ')' || curr.value === ']' || curr.value === '}')) {
    if (settings.functionCallSpacing === 'expanded') return 1
    return 0
  }
  // After closing paren/bracket/brace
  if (p === 'punctuation' && (prev.value === ')' || prev.value === ']' || prev.value === '}')) {
    return 0
  }

  // Operator spacing
  if (p === 'operator' || c === 'operator') {
    if (settings.operatorSpacing === 'compact') return 0
    return 1
  }

  // Between identifier and punctuation (not already handled above)
  if (p === 'identifier' && c === 'punctuation') return 0
  if (p === 'punctuation' && c === 'identifier') return 0
  if (p === 'keyword' && c === 'punctuation') return 0
  if (p === 'punctuation' && c === 'keyword') return 0

  // Between two identifiers/keywords (e.g., IF DB) — usually shouldn't happen in valid rules
  if ((p === 'identifier' || p === 'keyword') && (c === 'identifier' || c === 'keyword')) {
    return 1
  }

  // Default: no space
  return 0
}

/**
 * Normalize capitalization of an identifier based on settings and naming dictionary.
 */
function normalizeCapitalization(token, settings, namingMap) {
  if (token.type === 'area_prefix') {
    if (settings.capitalization === 'asIs') return token.value
    // n:, c:, s: → N:, C:, S:
    if (settings.capitalization === 'ibmOfficial') return token.value.toUpperCase()
    if (settings.capitalization === 'lower') return token.value.toLowerCase()
    if (settings.capitalization === 'upper') return token.value.toUpperCase()
    return token.value
  }

  if (token.type !== 'identifier' && token.type !== 'keyword') return token.value
  if (settings.capitalization === 'asIs') return token.value

  const lower = token.value.toLowerCase()

  if (settings.capitalization === 'ibmOfficial') {
    // Check naming map (merged custom + defaults)
    if (namingMap[lower] !== undefined) {
      return namingMap[lower]
    }
    // For keywords, use uppercase
    if (token.type === 'keyword') return token.value.toUpperCase()
    return token.value
  }

  if (settings.capitalization === 'lower') return token.value.toLowerCase()
  if (settings.capitalization === 'upper') return token.value.toUpperCase()

  return token.value
}

/**
 * Format a single line of TM1 rules.
 * @param {string} line — raw line content (no trailing newline)
 * @param {object} settings — formatting options
 * @param {object} namingMap — merged naming dictionary
 * @returns {string} formatted line
 */
function formatLine(line, settings, namingMap) {
  const trimmed = line.trim()
  if (!trimmed) return ''

  const tokens = tokenize(trimmed)

  // Handle pure comments
  if (tokens.length === 1 && tokens[0].type === 'comment') {
    return trimmed
  }

  // Handle directives (#Region, #EndRegion)
  if (tokens.length >= 1 && tokens[0].type === 'directive') {
    // Preserve directive as-is (case might matter for display)
    return trimmed
  }

  // Handle special keywords that stand alone: FEEDERS; SKIPCHECK; STET;
  if (tokens.length >= 1 && tokens[0].type === 'keyword') {
    const kw = tokens[0].value.toLowerCase()
    if ((kw === 'feeders' || kw === 'skipcheck' || kw === 'stet') && tokens.length === 2 && tokens[1].type === 'punctuation' && tokens[1].value === ';') {
      const normalized = settings.capitalization === 'ibmOfficial' ? kw.toUpperCase() : tokens[0].value
      return normalized + ';'
    }
  }

  // Build formatted output token by token
  let out = ''
  let prevToken = null

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]

    if (tok.type === 'whitespace') {
      // Skip original whitespace — we'll add our own
      continue
    }

    // Determine spacing before this token
    if (prevToken) {
      const spaces = spacingBetween(prevToken, tok, settings, {})
      if (spaces > 0) out += ' '.repeat(spaces)
    }

    // Output the token value (with capitalization normalization)
    if (tok.type === 'identifier' || tok.type === 'keyword') {
      out += normalizeCapitalization(tok, settings, namingMap)
    } else {
      out += tok.value
    }

    prevToken = tok
  }

  return out
}

/**
 * Format an entire TM1 Rules document.
 * @param {string} text — full rules text
 * @param {object} settings — formatting options
 * @param {object} namingMap — merged naming dictionary
 * @returns {string} formatted text
 */
export function formatRules(text, settings, namingMap) {
  const { expressionFormatter } = settings
  if (expressionFormatter === 'tm1-verbose' || expressionFormatter === 'tm1-structured') {
    return formatTM1Structured(text, settings, namingMap, expressionFormatter)
  }

  const lines = text.split('\n')
  const formatted = []
  let indentLevel = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      formatted.push('')
      continue
    }

    // Detect #EndRegion, ENDIF, ELSE, ELSEIF for de-indent
    if (/^#EndRegion\b/i.test(trimmed) || /^ENDIF\b/i.test(trimmed) || /^ELSE\b/i.test(trimmed) || /^ELSEIF\b/i.test(trimmed)) {
      indentLevel = Math.max(0, indentLevel - 1)
    }

    const indent = getIndent(indentLevel, settings)
    const formattedLine = formatLine(trimmed, settings, namingMap)
    formatted.push(indent + formattedLine)

    // Detect #Region, IF, ELSEIF, ELSE for indent increase
    if (/^#Region\b/i.test(trimmed) || /^IF\b/i.test(trimmed) || /^ELSEIF\b/i.test(trimmed) || /^ELSE\b/i.test(trimmed)) {
      indentLevel++
    }
  }

  // Optional: align = signs within #Region blocks
  if (settings.alignEquals) {
    return alignEqualsInRegions(formatted, settings)
  }

  return formatted.join('\n')
}

/**
 * Align = signs within #Region blocks.
 * Only aligns consecutive assignment lines (lines with ['...'] = ... or N: ... = ...).
 */
function alignEqualsInRegions(lines, settings) {
  // This is a Phase 1.5 / Phase 2 enhancement.
  // For now, return as-is.
  return lines.join('\n')
}
