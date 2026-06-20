import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useCubes, useCubeDimensions, useDims, useDimAttributes, useAttributeValues, useElements, useSubsets } from '@/hooks/useApi'
import { useStore } from '@/store'
import { registerTM1Theme } from '@/lib/tm1-functions'
import { subsetApplyCallbacks } from '@/lib/subsetCallbacks'
import { ArrowLeft, ArrowRight, Play, Loader2, Copy, X, Check, Code2, ExternalLink, HelpCircle, Save, Clock, Plus, Pencil, Trash2, ChevronDown, ChevronRight, GripHorizontal, WrapText } from 'lucide-react'
import MonacoEditor from '@monaco-editor/react'
import { cn } from '@/lib/utils'
import { validateMDX } from '@/lib/mdx-validator'
import ResultGrid from '@/components/mdx/ResultGrid'

const RECENT_KEY  = 'tm1-mdx-recent'
const PERSIST_KEY = (tabId) => `tm1-mdx-state-${tabId || 'default'}`

function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
function saveRecent(entry) {
  const recent = loadRecent().filter(r => r.mdx !== entry.mdx)
  recent.unshift({ ...entry, time: Date.now() })
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 30)))
}
function loadPersistedState(tabId) { try { return JSON.parse(localStorage.getItem(PERSIST_KEY(tabId)) || 'null') } catch { return null } }
function savePersistedState(tabId, state) { try { localStorage.setItem(PERSIST_KEY(tabId), JSON.stringify(state)) } catch {} }

function formatMDX(mdx) {
  if (!mdx?.trim()) return mdx
  let s = mdx.replace(/\s+/g, ' ').trim()
  s = s
    .replace(/\bSELECT\b\s*/gi,               'SELECT\n  ')
    .replace(/\s*\bNON EMPTY\b\s*/gi,          ' NON EMPTY ')
    .replace(/\s*\bON COLUMNS\s*,\s*/gi,       ' ON COLUMNS,\n  ')
    .replace(/\s*\bON COLUMNS\b/gi,            ' ON COLUMNS')
    .replace(/\s*\bON ROWS\s*,\s*/gi,          ' ON ROWS,\n  ')
    .replace(/\s*\bON ROWS\b/gi,               ' ON ROWS')
    .replace(/\s*\bON 0\s*,\s*/gi,             ' ON COLUMNS,\n  ')
    .replace(/\s*\bON 0\b/gi,                  ' ON COLUMNS')
    .replace(/\s*\bON 1\s*,\s*/gi,             ' ON ROWS,\n  ')
    .replace(/\s*\bON 1\b/gi,                  ' ON ROWS')
    .replace(/\s*\bFROM\b\s*/gi,               '\nFROM ')
    .replace(/\s*\bWHERE\b\s*/gi,              '\nWHERE ')
    .trim()
  return s.split('\n').map(line => {
    const lead = line.match(/^(\s*)/)[1]
    const body = line.trimStart()
    if (!body.includes('{')) return line
    let out = '', depth = 0
    for (let i = 0; i < body.length; i++) {
      const ch = body[i]
      if      (ch === '{') { out += '{\n' + lead + '  '.repeat(depth + 1); depth++ }
      else if (ch === '}') { depth = Math.max(0, depth - 1); out = out.trimEnd() + '\n' + lead + '  '.repeat(depth) + '}' }
      else if (ch === ',' && depth > 0) { out += ',\n' + lead + '  '.repeat(depth) }
      else { out += ch }
    }
    return lead + out.trim()
  }).join('\n').trim()
}

const WRAPPERS = {
  'all':         (dim, inner) => `{TM1SUBSETALL([${dim}].[${dim}])}`,
  'leaf':        (dim, inner) => `{TM1FILTERBYLEVEL(${inner}, 0)}`,
  'consol':      (dim, inner) => `{TM1FILTERBYLEVEL(${inner}, 1)}`,
  'sort-asc':    (dim, inner) => `{TM1SORT(${inner}, ASC)}`,
  'sort-desc':   (dim, inner) => `{TM1SORT(${inner}, DESC)}`,
  'sort-index-a':(dim, inner) => `{TM1SORTBYINDEX(${inner}, ASC)}`,
  'sort-index-d':(dim, inner) => `{TM1SORTBYINDEX(${inner}, DESC)}`,
  'top10':       (dim, inner) => `{TOPCOUNT(${inner}, 10)}`,
  'top5':        (dim, inner) => `{TOPCOUNT(${inner}, 5)}`,
  'bottom10':    (dim, inner) => `{BOTTOMCOUNT(${inner}, 10)}`,
  'head5':       (dim, inner) => `{HEAD(${inner}, 5)}`,
  'tail5':       (dim, inner) => `{TAIL(${inner}, 5)}`,
  'attr':        (dim, inner) => `{FILTER(${inner}, [${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") = "Val")}`,
  'pattern':     (dim, inner) => `{TM1FILTERBYPATTERN(${inner}, "*Pat*")}`,
  'cubeval':     (dim, inner) => `{FILTER(${inner}, [Cube].([Measure]) > 0)}`,
  'cube-compare':(dim, inner) => `{FILTER(${inner}, [Cube].([${dim}].CURRENTMEMBER, [Measure]) > [Cube].([${dim}].[Member], [Measure]))}`,
  'order-num':   (dim, inner) => `{ORDER(${inner}, [Cube].([${dim}].CURRENTMEMBER, [Measure]), BDESC)}`,
  'cm-filter':   (dim, inner) => `{FILTER(${inner}, [Cube].([${dim}].CURRENTMEMBER, [Measure]) > 0)}`,
  'strtomember': (dim, inner) => `{FILTER(${inner}, [${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") = STRTTOMEMBER("[${dim}].[" + [Cube].([Measure]) + "]"))}`,
  'boolean':     (dim, inner) => `{FILTER(${inner}, [Cube].([Measure]) > 0 AND [${dim}].[Attr] = "Yes")}`,
  'numeric-attr':(dim, inner) => `{FILTER(${inner}, VAL([${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") + "0") = 42)}`,
  'val-filter':  (dim, inner) => `{FILTER(${inner}, VAL([${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("Attr") + "0") = 42)}`,
  'except-attr': (dim, inner) => `{EXCEPT(${inner}, {FILTER(${inner}, [${dim}].[Attr] = "Skip")})}`,
  'children':    (dim, inner) => `{[${dim}].[Member].CHILDREN}`,
  'descendants': (dim, inner) => `{TM1DRILLDOWNMEMBER({[${dim}].[Member]}, ALL, RECURSIVE)}`,
  'filter-desc': (dim, inner) => `{DESCENDANTS(${inner})}`,
  'ancestors':   (dim, inner) => `{[${dim}].[Member].ANCESTORS}`,
  'parent':      (dim, inner) => `{[${dim}].[Member].PARENT}`,
  'range':       (dim, inner) => `{[${dim}].[Start]:[${dim}].[End]}`,
  'last12':      (dim, inner) => `{LASTPERIODS(12, [${dim}].[CURRENTMEMBER])}`,
  'next':        (dim, inner) => `{[${dim}].[Member].NEXTMEMBER}`,
  'union':       (dim, inner) => `{UNION(${inner}, {[${dim}].[Member]})}`,
  'intersect':   (dim, inner) => `{INTERSECT(${inner}, {[${dim}].[Member]})}`,
  'except':      (dim, inner) => `{EXCEPT(${inner}, {[${dim}].[Member]})}`,
}

const QUERY_CLAUSES = [
  { id: 'qc-select',      label: 'SELECT',              cat: 'Query Clauses', mdx: () => `SELECT\n  NON EMPTY {set} ON COLUMNS,\n  NON EMPTY {set} ON ROWS\nFROM [CubeName]`,
    desc: 'Required opening clause. Lists axis expressions followed by ON COLUMNS / ON ROWS, separated by commas.' },
  { id: 'qc-from',        label: 'FROM',                cat: 'Query Clauses', mdx: () => `FROM [CubeName]`,
    desc: 'Specifies the cube to query. Must match the cube name exactly as registered in TM1.' },
  { id: 'qc-where',       label: 'WHERE',               cat: 'Query Clauses', mdx: () => `WHERE ([Dim1].[Dim1].[Member1], [Dim2].[Dim2].[Member2])`,
    desc: 'Slicer / context clause. Each dimension contributes one member (or set) as context for the cell values. Does not filter rows — it restricts the cube calculation space.' },
  { id: 'qc-nonempty',    label: 'NON EMPTY',           cat: 'Query Clauses', mdx: () => `NON EMPTY {TM1SUBSETALL([Dim].[Dim])} ON COLUMNS`,
    desc: 'Suppresses axis members that have no data (all cells empty/zero) in the result. Applied per axis, before the WHERE slicer.' },
  { id: 'qc-on-cols',     label: 'ON COLUMNS (axis 0)', cat: 'Query Clauses', mdx: () => `{set} ON COLUMNS`,
    desc: 'Places a set expression on the column axis (axis 0). Required in every TM1 MDX query.' },
  { id: 'qc-on-rows',     label: 'ON ROWS (axis 1)',    cat: 'Query Clauses', mdx: () => `{set} ON ROWS`,
    desc: 'Places a set expression on the row axis (axis 1). Optional — omit for a single-axis (columns-only) query.' },
  { id: 'qc-with-member', label: 'WITH MEMBER',         cat: 'Query Clauses', mdx: () => `WITH MEMBER [Dim].[Dim].[CalcName] AS\n  [Dim].[Dim].[A] + [Dim].[Dim].[B]\nSELECT ...`,
    desc: 'Defines a calculated member inline before the SELECT. The member exists only for this query — it does not create a persistent element in TM1.' },
  { id: 'qc-with-set',    label: 'WITH SET',            cat: 'Query Clauses', mdx: () => `WITH SET [MySet] AS\n  {TM1SUBSETALL([Dim].[Dim])}\nSELECT {[MySet]} ON COLUMNS ...`,
    desc: 'Defines a named set inline before the SELECT. Useful for reusing a complex set expression in multiple axes.' },
  { id: 'qc-crossjoin',   label: 'CrossJoin / *',       cat: 'Query Clauses', mdx: () => `{TM1SUBSETALL([Dim1].[Dim1])} * {TM1SUBSETALL([Dim2].[Dim2])} ON ROWS`,
    desc: 'Creates the Cartesian product of two sets. Both [Set1] * [Set2] and CrossJoin([Set1], [Set2]) are valid in TM1. Nests multiple dimensions on one axis.' },
  { id: 'qc-having',      label: 'HAVING',              cat: 'Query Clauses', mdx: () => `NON EMPTY {set} ON ROWS\nHAVING [Cube].([Measure]) > 0`,
    desc: 'Post-aggregation filter on axis members (MDX 2.0). Supported in some TM1/PA versions — filters after values are resolved, unlike NON EMPTY which suppresses before.' },
  { id: 'qc-order',       label: 'ORDER (axis)',         cat: 'Query Clauses', mdx: () => `ORDER({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]), BDESC) ON ROWS`,
    desc: 'Sorts an axis set by a cube value or member property. BASC/BDESC break hierarchy; ASC/DESC preserve it.' },
]

const FUNCTIONS = [
  { id: 'fn-username',      label: 'USERNAME',                   cat: 'TM1 Specific', mdx: () => `USERNAME`,
    desc: 'Returns the login name of the current user as a string. Used in dynamic member resolution, personalised filters, and security-aware MDX via STRTOMEMBER.' },
  { id: 'fn-crosscube',    label: '[Cube].(tuple)',             cat: 'TM1 Specific', mdx: () => `[CubeName].([Dim1].[Dim1].CURRENTMEMBER, [Dim2].[Dim2].[Member])`,
    desc: 'Reads a cell value from any cube using member references in a tuple. This is the correct TM1 MDX cross-cube syntax. CUBEVALUE is a Rules/Excel function and is not valid in TM1 MDX.' },
  { id: 'fn-elemcomp',     label: 'ELEMENTCOMPONENTOF()',       cat: 'TM1 Specific', mdx: () => `ELEMENTCOMPONENTOF("}GroupName", USERNAME, 1)`,
    desc: 'Returns 1 if the element is a component of the parent. Commonly used to test group membership: ELEMENTCOMPONENTOF("}GroupName", USERNAME, 1) = 1.' },
  { id: 'fn-val',           label: 'VAL(attr + "0")',           cat: 'Type Conversion', mdx: () => `VAL([Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr") + "0")`,
    desc: 'Converts a string property to a number by appending "0". Required for numeric comparisons in TM1 because PROPERTIES always returns strings.' },
  { id: 'fn-strtovalue',    label: 'STRTOVALUE(attr)',          cat: 'Type Conversion', mdx: () => `STRTOVALUE([Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr"))`,
    desc: 'Explicitly converts a string property to a numeric value.' },
  { id: 'fn-strtomember',   label: 'STRTOMEMBER(expr)',         cat: 'Member Resolution', mdx: () => `STRTOMEMBER("[Dim].[" + [Cube].([Measure]) + "]")`,
    desc: 'Converts a string expression to a member reference. Useful for dynamic member selection based on cube data or attributes.' },
  { id: 'fn-tm1member',     label: 'TM1MEMBER(name)',           cat: 'Member Resolution', mdx: () => `TM1MEMBER("[Dim].[Name]")`,
    desc: 'Creates a member reference from a string. Validates that the member exists.' },
  { id: 'fn-iif',           label: 'IIF(cond, t, f)',           cat: 'Logic', mdx: () => `IIF([Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr") = "Val", 1, 0)`,
    desc: 'Inline conditional. Returns the second argument if true, third if false.' },
  { id: 'fn-currentmember', label: 'CURRENTMEMBER',             cat: 'Navigation', mdx: () => `[Dim].[Dim].CURRENTMEMBER`,
    desc: 'References the current member in the iteration context. Used inside FILTER, GENERATE, and other set-iterating functions.' },
  { id: 'fn-properties',    label: '.PROPERTIES("Attr")',        cat: 'Navigation', mdx: () => `[Dim].[Dim].CURRENTMEMBER.PROPERTIES("Attr")`,
    desc: 'Accesses an element attribute value. Always returns a string — use VAL() or STRTOVALUE() for numeric attributes.' },
  { id: 'fn-parent',        label: '.PARENT',                    cat: 'Navigation', mdx: () => `[Dim].[Dim].[Member].PARENT`,
    desc: 'Returns the parent member of the given member. If the member has no parent (is a root), returns the member itself.' },
  { id: 'fn-firstchild',    label: '.FIRSTCHILD',                cat: 'Navigation', mdx: () => `[Dim].[Dim].[Consolidation].FIRSTCHILD`,
    desc: 'Returns the first child of a consolidated member. Useful for navigating to the start of a group (e.g., first month in a quarter).' },
  { id: 'fn-lastchild',     label: '.LASTCHILD',                 cat: 'Navigation', mdx: () => `[Dim].[Dim].[Consolidation].LASTCHILD`,
    desc: 'Returns the last child of a consolidated member. Useful for navigating to the end of a group (e.g., last month in a quarter).' },
  { id: 'fn-firstsibling',  label: '.FIRSTSIBLING',              cat: 'Navigation', mdx: () => `[Dim].[Dim].CURRENTMEMBER.FIRSTSIBLING`,
    desc: 'Returns the first member that shares the same parent as the given member (first sibling in the group).' },
  { id: 'fn-lastsibling',   label: '.LASTSIBLING',               cat: 'Navigation', mdx: () => `[Dim].[Dim].CURRENTMEMBER.LASTSIBLING`,
    desc: 'Returns the last member that shares the same parent as the given member (last sibling in the group).' },
  { id: 'fn-nextmember',    label: '.NEXTMEMBER',                cat: 'Navigation', mdx: () => `[Dim].[Dim].CURRENTMEMBER.NEXTMEMBER`,
    desc: 'Returns the next member in the dimension order. Equivalent to .LEAD(1). Returns NULL at the last member.' },
  { id: 'fn-prevmember',    label: '.PREVMEMBER',                cat: 'Navigation', mdx: () => `[Dim].[Dim].CURRENTMEMBER.PREVMEMBER`,
    desc: 'Returns the previous member in the dimension order. Equivalent to .LAG(1). Returns NULL at the first member.' },
  { id: 'fn-members',       label: '<dimension>.MEMBERS',        cat: 'Navigation', mdx: () => `[Dim].[Dim].MEMBERS`,
    desc: 'Returns all members of a dimension or hierarchy as a set, ordered by dimension index. Similar to TM1SUBSETALL but follows MDX hierarchy ordering.' },
  { id: 'fn-level-members', label: '<level>.MEMBERS',            cat: 'Navigation', mdx: () => `[Dim].[Dim].Levels(0).MEMBERS`,
    desc: 'Returns all members at a specific hierarchy level. Levels(0) = leaf, Levels(1) = first consolidation. Alternative to TM1FILTERBYLEVEL.' },
  { id: 'fn-children',      label: '.CHILDREN',                  cat: 'Navigation', mdx: () => `[Dim].[Dim].[ConsolidationMember].CHILDREN`,
    desc: 'Returns the direct children of a consolidated member as a set. Only returns immediate children, not all descendants.' },
  { id: 'fn-siblings',      label: '.SIBLINGS',                  cat: 'Navigation', mdx: () => `[Dim].[Dim].CURRENTMEMBER.SIBLINGS`,
    desc: 'Returns all members that share the same parent as the given member, including the member itself.' },
  { id: 'fn-isancestor',    label: 'ISANCESTOR(a, b)',           cat: 'Hierarchy', mdx: () => `ISANCESTOR([Dim].[Member], [Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns TRUE if the first member is an ancestor of the second in the hierarchy.' },
  { id: 'fn-cousin',        label: 'COUSIN(m1, m2)',             cat: 'Hierarchy', mdx: () => `[Dim].[Member].COUSIN([Dim].[Other])`,
    desc: 'Returns the member at the same relative position under a different parent.' },
  { id: 'fn-lag',           label: 'LAG(member, N)',             cat: 'Time / Range', mdx: () => `[Dim].[Dim].CURRENTMEMBER.LAG(1)`,
    desc: 'Returns the member N positions before the given member in the dimension order.' },
  { id: 'fn-lead',          label: 'LEAD(member, N)',            cat: 'Time / Range', mdx: () => `[Dim].[Dim].CURRENTMEMBER.LEAD(1)`,
    desc: 'Returns the member N positions after the given member in the dimension order.' },
  { id: 'fn-periodstodate', label: 'PERIODSTODATE(member)',      cat: 'Time / Range', mdx: () => `{PERIODSTODATE([Dim].[Dim].[FY],[Dim].[Dim].CURRENTMEMBER)}`,
    desc: 'Returns all members from the start of the period up to the given member (YTD-style).' },
  { id: 'fn-closingperiod', label: 'CLOSINGPERIOD(member)',      cat: 'Time / Range', mdx: () => `CLOSINGPERIOD([Dim].[Dim].[FY],[Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns the last sibling in the same level under the given ancestor (e.g., last month in the FY).' },
  { id: 'fn-openingperiod', label: 'OPENINGPERIOD(member)',      cat: 'Time / Range', mdx: () => `OPENINGPERIOD([Dim].[Dim].[FY],[Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns the first sibling in the same level under the given ancestor (e.g., first month in the FY).' },
  { id: 'fn-parallelperiod',label: 'PARALLELPERIOD(mem, N)',     cat: 'Time / Range', mdx: () => `PARALLELPERIOD([Dim].[Dim].[FY], 1, [Dim].[Dim].CURRENTMEMBER)`,
    desc: 'Returns the member N periods prior at the same relative position (e.g., same month last year).' },
  { id: 'fn-generate',      label: 'GENERATE(set, expr)',        cat: 'Set Construction', mdx: () => `{GENERATE({TM1SUBSETALL([Dim].[Dim])}, {[Dim].[Dim].CURRENTMEMBER})}`,
    desc: 'Iterates over a set and evaluates an expression for each member. Most powerful set-construction function in MDX.' },
  { id: 'fn-extract',       label: 'EXTRACT(set, dim)',          cat: 'Set Construction', mdx: () => `{EXTRACT({set}, [Dim])}`,
    desc: 'Extracts members of a specific dimension from tuples in a set.' },
  { id: 'fn-head',          label: 'HEAD(set, N)',               cat: 'Set Ops', mdx: () => `{HEAD({TM1SUBSETALL([Dim].[Dim])}, 10)}`,
    desc: 'Returns the first N members of a set. Unlike TOPCOUNT, does not sort.' },
  { id: 'fn-tail',          label: 'TAIL(set, N)',               cat: 'Set Ops', mdx: () => `{TAIL({TM1SUBSETALL([Dim].[Dim])}, 10)}`,
    desc: 'Returns the last N members of a set.' },
  { id: 'fn-item',          label: 'ITEM(set, N)',               cat: 'Set Ops', mdx: () => `{TM1SUBSETALL([Dim].[Dim])}.ITEM(0)`,
    desc: 'Returns the Nth member of a set (0-indexed).' },
  { id: 'fn-count',         label: 'COUNT(set)',                 cat: 'Aggregation', mdx: () => `COUNT({TM1SUBSETALL([Dim].[Dim])} INCLUDEEMPTY)`,
    desc: 'Returns the number of members in a set. INCLUDEEMPTY or EXCLUDEEMPTY.' },
  { id: 'fn-sum',           label: 'SUM(set, cube)',             cat: 'Aggregation', mdx: () => `SUM({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Sums a cube value across all members in a set.' },
  { id: 'fn-avg',           label: 'AVG(set, cube)',             cat: 'Aggregation', mdx: () => `AVG({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Averages a cube value across all members in a set.' },
  { id: 'fn-min-max',       label: 'MIN / MAX(set, cube)',       cat: 'Aggregation', mdx: () => `MIN({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Returns the minimum or maximum cube value across a set. Use MAX() for maximum.' },
  { id: 'fn-rank',          label: 'RANK(member, set)',          cat: 'Aggregation', mdx: () => `RANK([Dim].[Dim].CURRENTMEMBER, {TM1SUBSETALL([Dim].[Dim])})`,
    desc: 'Returns the rank position of a member within a sorted set.' },
  { id: 'fn-aggregate',    label: 'AGGREGATE(set)',             cat: 'Aggregation', mdx: () => `AGGREGATE({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Aggregates a set using the default aggregation function defined for the measure. Adapts to SUM, COUNT, MIN, MAX etc. based on measure definition.' },
  { id: 'fn-median',       label: 'MEDIAN(set, cube)',          cat: 'Aggregation', mdx: () => `MEDIAN({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Returns the median (middle) value across a set. For an even-count set, returns the average of the two middle values.' },
  { id: 'fn-stddev',       label: 'STDDEV(set, cube)',          cat: 'Aggregation', mdx: () => `STDDEV({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Returns the sample standard deviation of a numeric expression evaluated over a set. Also written as STDEV in some MDX dialects.' },
  { id: 'fn-var',          label: 'VAR(set, cube)',             cat: 'Aggregation', mdx: () => `VAR({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Measure]))`,
    desc: 'Returns the sample variance of a numeric expression evaluated over a set. Square root of VAR gives STDDEV. Also written as VARIANCE.' },
  { id: 'fn-correlation',  label: 'CORRELATION(set, y, x)',     cat: 'Aggregation', mdx: () => `CORRELATION({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Y Measure]), [Cube].([X Measure]))`,
    desc: 'Returns the Pearson correlation coefficient between two numeric expressions evaluated over a set. Result is between -1 and 1.' },
  { id: 'fn-covariance',   label: 'COVARIANCE(set, y, x)',      cat: 'Aggregation', mdx: () => `COVARIANCE({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Y Measure]), [Cube].([X Measure]))`,
    desc: 'Returns the population covariance of two numeric expressions over a set. Use COVARIANCEN for sample covariance.' },
  { id: 'fn-linregslope',  label: 'LINREGSLOPE(set, y, x)',     cat: 'Aggregation', mdx: () => `LINREGSLOPE({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Y Measure]), [Cube].([X Measure]))`,
    desc: 'Returns the slope (m) of the linear regression line y = mx + b fitted to the set. Measures rate of change of Y per unit X.' },
  { id: 'fn-linregintercept',label:'LINREGINTERCEPT(set,y,x)',  cat: 'Aggregation', mdx: () => `LINREGINTERCEPT({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Y Measure]), [Cube].([X Measure]))`,
    desc: 'Returns the Y-intercept (b) of the linear regression line y = mx + b. The predicted Y value when X equals zero.' },
  { id: 'fn-linregr2',     label: 'LINREGR2(set, y, x)',        cat: 'Aggregation', mdx: () => `LINREGR2({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Y Measure]), [Cube].([X Measure]))`,
    desc: 'Returns the R-squared (coefficient of determination) of the regression. Value 0-1: 1 means perfect linear fit.' },
  { id: 'fn-linregpoint',  label: 'LINREGPOINT(x, set, y, x2)', cat: 'Aggregation', mdx: () => `LINREGPOINT([Dim].[Dim].CURRENTMEMBER, {TM1SUBSETALL([Dim].[Dim])}, [Cube].([Y Measure]), [Cube].([X Measure]))`,
    desc: 'Returns the predicted Y value at a given X point on the regression line. Used to forecast or interpolate values.' },
  { id: 'fn-linregvar',    label: 'LINREGVARIANCE(set, y, x)',  cat: 'Aggregation', mdx: () => `LINREGVARIANCE({TM1SUBSETALL([Dim].[Dim])}, [Cube].([Y Measure]), [Cube].([X Measure]))`,
    desc: 'Returns the error variance of the linear regression — how much actual values deviate from the regression line.' },
  // ── Ranking ───────────────────────────────────────────────────────────────
  { id: 'fn-toppercent',   label: 'TOPPERCENT(set, %, cube)',  cat: 'Ranking', mdx: () => `TOPPERCENT({TM1SUBSETALL([Dim].[Dim])}, 10, [Cube].([Measure]))`,
    desc: 'Returns the smallest set of top members whose cumulative value equals at least N% of the total. Useful for Pareto / 80-20 analysis.' },
  { id: 'fn-topsum',       label: 'TOPSUM(set, value, cube)',  cat: 'Ranking', mdx: () => `TOPSUM({TM1SUBSETALL([Dim].[Dim])}, 1000000, [Cube].([Measure]))`,
    desc: 'Returns the smallest set of top members whose cumulative value meets or exceeds a target sum.' },
  { id: 'fn-bottompercent',label: 'BOTTOMPERCENT(set,%,cube)', cat: 'Ranking', mdx: () => `BOTTOMPERCENT({TM1SUBSETALL([Dim].[Dim])}, 10, [Cube].([Measure]))`,
    desc: 'Returns the smallest set of bottom members whose cumulative value equals at least N% of the total.' },
  { id: 'fn-bottomsum',    label: 'BOTTOMSUM(set, value, cube)',cat: 'Ranking', mdx: () => `BOTTOMSUM({TM1SUBSETALL([Dim].[Dim])}, 1000000, [Cube].([Measure]))`,
    desc: 'Returns the smallest set of bottom members whose cumulative value meets or exceeds a target sum.' },
  // ── Set Ops additions ─────────────────────────────────────────────────────
  { id: 'fn-distinct',     label: 'DISTINCT(set)',              cat: 'Set Ops', mdx: () => `DISTINCT({TM1SUBSETALL([Dim].[Dim])})`,
    desc: 'Removes duplicate tuples from a set. Useful after UNION or GENERATE operations that may produce repeated members.' },
  { id: 'fn-hierarchize',  label: 'HIERARCHIZE(set)',           cat: 'Set Ops', mdx: () => `HIERARCHIZE({TM1SUBSETALL([Dim].[Dim])})`,
    desc: 'Reorders a set back into natural hierarchy order (parents before children, depth-first). Use after operations that break the natural order.' },
  { id: 'fn-subset',       label: 'SUBSET(set, start, count)',  cat: 'Set Ops', mdx: () => `SUBSET({TM1SUBSETALL([Dim].[Dim])}, 0, 10)`,
    desc: 'Returns a slice of a set by start position (0-based) and count. More flexible than HEAD/TAIL for mid-set paging.' },
  { id: 'fn-addcalc',      label: 'ADDCALCULATEDMEMBERS(set)', cat: 'Set Ops', mdx: () => `ADDCALCULATEDMEMBERS({TM1SUBSETALL([Dim].[Dim])})`,
    desc: 'Adds any WITH MEMBER calculated members defined in the query to the given set. Ensures calculated members appear alongside stored members.' },
  // ── Hierarchy drill functions ─────────────────────────────────────────────
  { id: 'fn-drilldownmember',   label: 'DRILLDOWNMEMBER(set,members)', cat: 'Hierarchy', mdx: () => `DRILLDOWNMEMBER({TM1SUBSETALL([Dim].[Dim])}, {[Dim].[Dim].[Parent]})`,
    desc: 'Reorders Set1 so children of Set2 members appear directly after their parent — the drill-expand effect. Does not add new members; Set1 is the pool. Use ALL to expand every consolidation, RECURSIVE for full descendants.' },
  { id: 'fn-drilldownlevel',    label: 'DRILLDOWNLEVEL(set, level)',   cat: 'Hierarchy', mdx: () => `DRILLDOWNLEVEL({TM1SUBSETALL([Dim].[Dim])}, [Dim].[Dim].Levels(1))`,
    desc: 'Expands all members at the specified level in a set by inserting their children. Drills down one level at a time.' },
  { id: 'fn-drilldownleveltop', label: 'DRILLDOWNLEVELTOP(set,N,lvl,cube)', cat: 'Hierarchy', mdx: () => `DRILLDOWNLEVELTOP({TM1SUBSETALL([Dim].[Dim])}, 5, [Dim].[Dim].Levels(1), [Cube].([Measure]))`,
    desc: 'Drills down at a level but only includes the top N children by a numeric measure. Combines drilling with ranking.' },
  { id: 'fn-drilldownlevelbottom',label:'DRILLDOWNLEVELBOTTOM(...)',   cat: 'Hierarchy', mdx: () => `DRILLDOWNLEVELBOTTOM({TM1SUBSETALL([Dim].[Dim])}, 5, [Dim].[Dim].Levels(1), [Cube].([Measure]))`,
    desc: 'Drills down at a level but only includes the bottom N children by a numeric measure.' },
  { id: 'fn-drilldownmembertop', label: 'DRILLDOWNMEMBERTOP(set,N,members,cube)', cat: 'Hierarchy', mdx: () => `DRILLDOWNMEMBERTOP({TM1SUBSETALL([Dim].[Dim])}, 5, {[Dim].[Dim].[Parent]}, [Cube].([Measure]))`,
    desc: 'Drills down on specified members but only includes top N children by a numeric measure.' },
  { id: 'fn-drilldownmemberbottom',label:'DRILLDOWNMEMBERBOTTOM(...)',cat: 'Hierarchy', mdx: () => `DRILLDOWNMEMBERBOTTOM({TM1SUBSETALL([Dim].[Dim])}, 5, {[Dim].[Dim].[Parent]}, [Cube].([Measure]))`,
    desc: 'Drills down on specified members but only includes bottom N children by a numeric measure.' },
  { id: 'fn-drillupmember',  label: 'DRILLUPMEMBER(set, members)',  cat: 'Hierarchy', mdx: () => `DRILLUPMEMBER({TM1SUBSETALL([Dim].[Dim])}, {[Dim].[Dim].[Member]})`,
    desc: 'Removes children of specified members from a set, collapsing them back to the parent level.' },
  { id: 'fn-drilluplevel',   label: 'DRILLUPLEVEL(set, level)',     cat: 'Hierarchy', mdx: () => `DRILLUPLEVEL({TM1SUBSETALL([Dim].[Dim])}, [Dim].[Dim].Levels(0))`,
    desc: 'Removes all members below the specified level from a set. Collapses the set to a given depth.' },
  { id: 'fn-toggledrill',    label: 'TOGGLEDRILLSTATE(set,members)',cat: 'Hierarchy', mdx: () => `TOGGLEDRILLSTATE({TM1SUBSETALL([Dim].[Dim])}, {[Dim].[Dim].[Member]})`,
    desc: 'Toggles the drill state of specified members: expands collapsed members and collapses expanded ones.' },
  // ── TM1-specific syntax additions ─────────────────────────────────────────
  { id: 'fn-dim-subset',     label: '[Dim].[SubsetName]',           cat: 'TM1 Specific', mdx: () => `[Dim].[SubsetName]`,
    desc: 'TM1 shorthand to reference a named subset without TM1SubsetToSet. [Periods].[Monthly] returns members of the Monthly subset in the Periods dimension.' },
  { id: 'fn-ancestors',      label: '.ANCESTORS',                   cat: 'TM1 Specific', mdx: () => `[Dim].[Dim].[Member].ANCESTORS`,
    desc: 'TM1-specific property returning all ancestors of a member as a set (parent, grandparent, etc. up to root). Not available in all MDX dialects.' },
  { id: 'fn-weight',         label: '.WEIGHT',                      cat: 'TM1 Specific', mdx: () => `[Dim].[Dim].CURRENTMEMBER.WEIGHT`,
    desc: 'TM1-specific property returning the weight (contribution factor) of a child member within its parent consolidation. Used in weighted rollup rules.' },
  { id: 'fn-tm1subsetall',   label: 'TM1SUBSETALL(dim)',          cat: 'TM1 Specific', mdx: () => `{TM1SUBSETALL([Dim].[Dim])}`,
    desc: 'Returns all members of a dimension as a set. Equivalent to [Dim].Members but TM1-optimised — does not expand consolidations hierarchically.' },
  { id: 'fn-tm1filterlevel', label: 'TM1FILTERBYLEVEL(set, N)',  cat: 'TM1 Specific', mdx: () => `{TM1FILTERBYLEVEL({TM1SUBSETALL([Dim].[Dim])}, 0)}`,
    desc: 'Returns members at hierarchy level N. Level 0 = leaf (no children). Level 1 = first consolidation level. Use to exclude consolidations from a set.' },
  { id: 'fn-tm1filterpattern',label:'TM1FILTERBYPATTERN(set,pat)',cat: 'TM1 Specific', mdx: () => `{TM1FILTERBYPATTERN({TM1SUBSETALL([Dim].[Dim])}, "*text*")}`,
    desc: 'Filters a set to members whose names match a wildcard pattern. * matches any sequence of characters. Case-insensitive.' },
  { id: 'fn-tm1sort',        label: 'TM1SORT(set, dir)',          cat: 'TM1 Specific', mdx: () => `{TM1SORT({TM1SUBSETALL([Dim].[Dim])}, ASC)}`,
    desc: 'Sorts a set alphabetically by member name. ASC or DESC. Breaks hierarchy order — use TM1SORTBYINDEX to preserve it.' },
  { id: 'fn-tm1sortindex',   label: 'TM1SORTBYINDEX(set, dir)',   cat: 'TM1 Specific', mdx: () => `{TM1SORTBYINDEX({TM1SUBSETALL([Dim].[Dim])}, ASC)}`,
    desc: 'Sorts a set by the element\'s ordinal index position in the dimension. Preserves relative dimension order rather than alphabetical.' },
  { id: 'fn-tm1ignore',      label: 'TM1IGNORE_BADTUPLES(set)',   cat: 'TM1 Specific', mdx: () => `{TM1IGNORE_BADTUPLES({set})}`,
    desc: 'Wraps a set and silently drops any tuple combinations that don\'t exist in the cube or are otherwise invalid. Useful when CrossJoin produces tuples with no data.' },
  { id: 'fn-tm1rulederived', label: 'TM1RULEDERIVED()',           cat: 'TM1 Specific', mdx: () => `FILTER({TM1SUBSETALL([Dim].[Dim])}, TM1RULEDERIVED([Dim].[Dim].CURRENTMEMBER))`,
    desc: 'Returns TRUE (1) if the cell value at the current intersection is calculated by a TM1 rule rather than stored data. Useful for filtering out rule-derived cells.' },
  { id: 'fn-tm1updateable',  label: 'TM1UPDATEABLE()',            cat: 'TM1 Specific', mdx: () => `FILTER({TM1SUBSETALL([Dim].[Dim])}, TM1UPDATEABLE([Dim].[Dim].CURRENTMEMBER))`,
    desc: 'Returns TRUE (1) if the cell at the current intersection can be written to (is a leaf numeric cell with no read-only rule). Use to identify input-ready cells.' },
  { id: 'fn-tm1subsettoset',label: 'TM1SubsetToSet(dim, sub)',   cat: 'TM1 Specific', mdx: () => `TM1SubsetToSet([Dim], "MySubset")`,
    desc: 'Converts a named public subset into an MDX set expression.' },
  { id: 'fn-tm1settosubset',label: 'TM1SetToSubset(...)',        cat: 'TM1 Specific', mdx: () => `TM1SetToSubset([Dim], {set}, "SubsetName", 0)`,
    desc: 'Creates a named public subset from an MDX set. 0=static, 1=dynamic.' },
  { id: 'fn-tm1tuplesize',  label: 'TM1TUPLESIZE(tuple)',        cat: 'TM1 Specific', mdx: () => `TM1TUPLESIZE()`,
    desc: 'Returns the number of elements in a tuple.' },
  { id: 'fn-dimname',       label: 'DIMNAME(dim)',               cat: 'Metadata', mdx: () => `DIMNAME([Dim])`,
    desc: 'Returns the dimension name of a member.' },
  { id: 'fn-dimix',         label: 'DIMIX(dim, member)',         cat: 'Metadata', mdx: () => `DIMIX([Dim], [Dim].[Member])`,
    desc: 'Returns the index of a member in the dimension. Returns 0 if not found.' },
]

const PATTERNS = [
  { id: 'all',         label: 'All members',               cat: 'Basic',       unwrapped: true },
  { id: 'leaf',        label: 'Leaf only (level 0)',       cat: 'Basic' },
  { id: 'consol',      label: 'Consolidated only',         cat: 'Basic' },
  { id: 'children',    label: 'Children of member',        cat: 'Hierarchy' },
  { id: 'descendants', label: 'Drill down from member',    cat: 'Hierarchy' },
  { id: 'filter-desc', label: 'Get descendants of result', cat: 'Hierarchy' },
  { id: 'ancestors',   label: 'Ancestors of member',       cat: 'Hierarchy' },
  { id: 'parent',      label: 'Parent of member',          cat: 'Hierarchy' },
  { id: 'range',       label: 'Range between members',     cat: 'Time / Range' },
  { id: 'last12',      label: 'Last 12 periods',           cat: 'Time / Range' },
  { id: 'next',        label: 'Next member',               cat: 'Time / Range' },
  { id: 'top10',       label: 'Top 10',                    cat: 'Ranking' },
  { id: 'top5',        label: 'Top 5',                     cat: 'Ranking' },
  { id: 'bottom10',    label: 'Bottom 10',                 cat: 'Ranking' },
  { id: 'head5',       label: 'First 5 (Head)',            cat: 'Ranking' },
  { id: 'tail5',       label: 'Last 5 (Tail)',             cat: 'Ranking' },
  { id: 'sort-asc',    label: 'Sort A–Z',                  cat: 'Sorting' },
  { id: 'sort-desc',   label: 'Sort Z–A',                  cat: 'Sorting' },
  { id: 'sort-index-a',label: 'Sort by index (Asc)',       cat: 'Sorting' },
  { id: 'sort-index-d',label: 'Sort by index (Desc)',      cat: 'Sorting' },
  { id: 'attr',        label: 'Filter by attribute',       cat: 'Filtering' },
  { id: 'pattern',     label: 'Filter by name pattern',    cat: 'Filtering' },
  { id: 'cubeval',     label: 'Filter by cube value > 0',  cat: 'Filtering' },
  { id: 'cube-compare',label: 'Filter vs another member',  cat: 'Filtering' },
  { id: 'order-num',   label: 'Order by cube value',       cat: 'Filtering' },
  { id: 'cm-filter',   label: 'Filter CurrentMember value',cat: 'Filtering' },
  { id: 'union',       label: 'Union of two sets',         cat: 'Set Ops' },
  { id: 'intersect',   label: 'Intersect of two sets',     cat: 'Set Ops' },
  { id: 'except',      label: 'Except (set minus)',        cat: 'Set Ops' },
  { id: 'except-attr', label: 'Except by attribute',       cat: 'Set Ops' },
  { id: 'boolean',     label: 'NOT / AND / OR logic',      cat: 'Advanced' },
  { id: 'numeric-attr',label: 'Filter by numeric attr',    cat: 'Advanced' },
  { id: 'val-filter',  label: 'Filter by attr (VAL)',      cat: 'Advanced' },
  { id: 'strtomember', label: 'Using STRTOMEMBER',         cat: 'Advanced' },
]

const CUSTOM_PATTERNS_KEY = 'tm1ide-custom-patterns'
const loadCustomPatterns = () => { try { return JSON.parse(localStorage.getItem(CUSTOM_PATTERNS_KEY) || '[]') } catch { return [] } }
const saveCustomPatterns = (list) => localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(list))

const CAT_ORDER = ['Query Clauses','Basic','Hierarchy','Time / Range','Ranking','Sorting','Filtering','Set Ops','Set Construction','Aggregation','Type Conversion','Member Resolution','Logic','Navigation','TM1 Specific','Metadata','Advanced','Custom']
const ALL_ITEMS = [...QUERY_CLAUSES, ...PATTERNS, ...FUNCTIONS.map(f => ({ ...f, isFn: true }))]
const CATEGORIES = CAT_ORDER.filter(c => ALL_ITEMS.some(i => i.cat === c))

// ── Axis Set Builder (Rows / Cols) ───────────────────────────────────────────

function buildAxisExpr(dim, mode, fc = {}, measuresDim = null) {
  if (mode === 'all')  return `{TM1SUBSETALL([${dim}].[${dim}])}`
  if (mode === 'leaf') return `{TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}`
  if (mode === 'member') {
    const ms = fc.selectedMembers || []
    if (!ms.length) return ''
    return ms.length === 1
      ? `{[${dim}].[${dim}].[${ms[0]}]}`
      : `{${ms.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
  }
  if (mode === 'range' && fc.rangeFrom && fc.rangeTo)
    return `{[${dim}].[${dim}].[${fc.rangeFrom}]:[${dim}].[${dim}].[${fc.rangeTo}]}`
  if (mode === 'subset' && fc.subsetName)
    return `TM1SubsetToSet([${dim}].[${dim}], "${fc.subsetName}")`
  if (mode === 'condition') {
    const t    = fc.condType || 'value'
    const base = fc.condLeafOnly
      ? `{TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}`
      : `{TM1SUBSETALL([${dim}].[${dim}])}`
    const op   = fc.condOp || '>'
    const raw  = String(fc.condValue ?? '0').trim()
    // Quote string values; leave numerics bare
    const val  = raw !== '' && isNaN(Number(raw)) ? `"${raw}"` : raw
    // Full 3-part measure reference: [MeasuresDim].[MeasuresDim].[MeasureName]
    const mRef = (m) => measuresDim ? `[${measuresDim}].[${measuresDim}].[${m}]` : `[${m}]`
    if (t === 'value' && fc.condMeasure)
      return `{FILTER(${base}, ([${dim}].[${dim}].CURRENTMEMBER, ${mRef(fc.condMeasure)}) ${op} ${val})}`
    if (t === 'attr' && fc.condAttr)
      return `{FILTER(${base}, [${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("${fc.condAttr}") = "${fc.condAttrValue || ''}")}`
    if (t === 'ranking' && fc.condMeasure) {
      const fn = fc.condRankDir === 'bottom' ? 'BOTTOMCOUNT' : 'TOPCOUNT'
      return `{${fn}(${base}, ${fc.condN || 10}, ([${dim}].[${dim}].CURRENTMEMBER, ${mRef(fc.condMeasure)}))}`
    }
    return ''
  }
  if (mode === 'expression') return fc.customExpr || ''
  return ''
}

function AxisMemberPicker({ dim, server, fc, setFc }) {
  const [search, setSearch] = useState('')
  const { data: elements = [] } = useElements(server, dim)
  const selected = useMemo(() => new Set(fc.selectedMembers || []), [fc.selectedMembers])
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return q ? elements.filter(e => e.Name.toLowerCase().includes(q)) : elements
  }, [elements, search])
  const toggle = (name) => {
    const next = new Set(selected)
    next.has(name) ? next.delete(name) : next.add(name)
    setFc({ ...fc, selectedMembers: [...next] })
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 text-[10px] px-1.5 py-0.5 border rounded bg-background" />
        {selected.size > 0 && <span className="text-[9px] text-muted-foreground shrink-0">{selected.size} selected</span>}
      </div>
      <div className="max-h-[120px] overflow-auto rounded border border-border/40 bg-background/50">
        {filtered.length === 0 && <div className="text-[10px] text-muted-foreground p-2 italic">{elements.length ? 'No match' : 'Loading…'}</div>}
        {filtered.slice(0, 200).map(el => (
          <button key={el.Name} onClick={() => toggle(el.Name)}
            className={cn('w-full text-left text-[10px] px-2 py-0.5 hover:bg-muted/60 truncate flex items-center gap-1.5',
              selected.has(el.Name) && 'bg-primary/10 text-primary')}>
            <span className={cn('w-2.5 h-2.5 rounded-sm border shrink-0 transition-colors',
              selected.has(el.Name) ? 'bg-primary border-primary' : 'border-muted-foreground/40')} />
            {el.Name}
          </button>
        ))}
      </div>
      {selected.size > 0 && (
        <button onClick={() => setFc({ ...fc, selectedMembers: [] })} className="text-[9px] text-muted-foreground hover:text-foreground">
          × Clear all
        </button>
      )}
    </div>
  )
}


function AxisSetBuilder({ dim, server, measuresDim, config, onChange, returnTabId }) {
  const { openTab } = useStore()
  const hasCustomExpr = config?.subsetExpression && !config?.axisMode
  const axisMode   = config?.axisMode   || (hasCustomExpr ? 'expression' : 'all')
  const axisConfig = config?.axisConfig || (hasCustomExpr ? { customExpr: config.subsetExpression } : {})
  const { data: subsets = [] } = useSubsets(axisMode === 'subset' ? server : null, dim)

  const setMode = (m) => {
    const fc = {}
    onChange({ axisMode: m, axisConfig: fc, subsetExpression: buildAxisExpr(dim, m, fc, measuresDim) })
  }
  const setFc = (patch) => {
    const newFc = { ...axisConfig, ...patch }
    onChange({ axisMode, axisConfig: newFc, subsetExpression: buildAxisExpr(dim, axisMode, newFc, measuresDim) })
  }

  return (
    <div className="mt-1 border-t border-border/30 pt-1.5 space-y-1.5">
      <div className="flex gap-0.5 flex-wrap">
        {[['all','All'],['leaf','Leaf'],['member','Member(s)'],['range','Range'],['subset','Subset'],['condition','Filter'],['expression','Expression']].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)}
            className={cn('px-1.5 py-0.5 text-[9px] rounded border transition-colors',
              axisMode === id ? 'bg-primary/20 border-primary/40 text-primary' : 'border-border hover:bg-muted')}>
            {label}
          </button>
        ))}
      </div>

      {axisMode === 'all'  && <div className="text-[9px] text-muted-foreground italic">All members via TM1SUBSETALL.</div>}
      {axisMode === 'leaf' && <div className="text-[9px] text-muted-foreground italic">Leaf (level-0) members only — consolidations excluded.</div>}
      {axisMode === 'member'    && <AxisMemberPicker dim={dim} server={server} fc={axisConfig} setFc={setFc} />}
      {axisMode === 'range'     && (
        <div className="grid grid-cols-2 gap-1">
          <input placeholder="From…" value={axisConfig.rangeFrom || ''} onChange={e => setFc({ ...axisConfig, rangeFrom: e.target.value })}
            className="text-[10px] px-1.5 py-0.5 border rounded bg-background" />
          <input placeholder="To…"   value={axisConfig.rangeTo   || ''} onChange={e => setFc({ ...axisConfig, rangeTo:   e.target.value })}
            className="text-[10px] px-1.5 py-0.5 border rounded bg-background" />
        </div>
      )}
      {axisMode === 'subset' && (
        <select value={axisConfig.subsetName || ''} onChange={e => setFc({ ...axisConfig, subsetName: e.target.value })}
          className="w-full text-[10px] px-1.5 py-0.5 border rounded bg-background">
          <option value="">Pick named subset…</option>
          {subsets.map(s => <option key={s.Name} value={s.Name}>{s.Name}</option>)}
        </select>
      )}
      {axisMode === 'condition' && (
        <div className="space-y-1">
          <button
            onClick={() => {
              const tabId = `subset-filter:${server}:${dim}:${Date.now()}`
              subsetApplyCallbacks.set(tabId, (mdx) => onChange({ axisMode: 'condition', axisConfig: { customExpr: mdx }, subsetExpression: mdx }))
              openTab({ id: tabId, type: 'subset', label: `Filter: ${dim}`, server, dimension: dim, subsetName: null, mdx: axisConfig.customExpr || '', returnTabId })
            }}
            className="px-2 py-1 text-[10px] border rounded hover:bg-muted transition-colors w-full text-left">
            {axisConfig.customExpr ? 'Edit filter…' : 'Build filter…'}
          </button>
          {axisConfig.customExpr && (
            <div className="font-mono text-[9px] text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded truncate" title={axisConfig.customExpr}>
              {axisConfig.customExpr}
            </div>
          )}
        </div>
      )}
      {axisMode === 'expression' && (
        <textarea value={axisConfig.customExpr || ''} onChange={e => setFc({ ...axisConfig, customExpr: e.target.value })}
          rows={2} placeholder={`{TM1SUBSETALL([${dim}].[${dim}])}`}
          className="w-full font-mono text-[10px] px-1.5 py-1 border rounded bg-background resize-none" />
      )}

      {config?.subsetExpression && (
        <div className="font-mono text-[9px] text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded truncate" title={config.subsetExpression}>
          → {config.subsetExpression}
        </div>
      )}
    </div>
  )
}

// ── Filter Builder ────────────────────────────────────────────────────────────

function buildFilterExpr(dim, mode, fc = {}) {
  if (mode === 'static') {
    const t = fc.staticType || 'member'
    if (t === 'all')    return `TM1SUBSETALL([${dim}].[${dim}])`
    if (t === 'leaf')   return `{TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}`
    if (t === 'member' && fc.selectedMember) return fc.selectedMember
    if (t === 'range'  && fc.rangeFrom && fc.rangeTo)
      return `{[${dim}].[${dim}].[${fc.rangeFrom}]:[${dim}].[${dim}].[${fc.rangeTo}]}`
    if (t === 'subset' && fc.subsetName)
      return `TM1SubsetToSet([${dim}].[${dim}], "${fc.subsetName}")`
    return ''
  }
  if (mode === 'rule') {
    const t   = fc.ruleType || 'value'
    const base = `{TM1SUBSETALL([${dim}].[${dim}])}`
    const op   = fc.ruleOp || '>'
    const val  = fc.ruleValue ?? '0'
    if (t === 'value' && fc.ruleMeasure)
      return `{FILTER(${base}, ([${dim}].[${dim}].CURRENTMEMBER, [${fc.ruleMeasure}]) ${op} ${val})}`
    if (t === 'attr' && fc.ruleAttr)
      return `{FILTER(${base}, [${dim}].[${dim}].CURRENTMEMBER.PROPERTIES("${fc.ruleAttr}") = "${fc.ruleAttrValue || ''}")}`
    if (t === 'ranking' && fc.ruleMeasure) {
      const fn = fc.ruleRankDir === 'bottom' ? 'BOTTOMCOUNT' : 'TOPCOUNT'
      return `{${fn}(${base}, ${fc.ruleN || 10}, ([${dim}].[${dim}].CURRENTMEMBER, [${fc.ruleMeasure}]))}`
    }
    if (t === 'crosscube' && fc.ruleCube && fc.ruleMeasure)
      return `{FILTER(${base}, [${fc.ruleCube}].([${dim}].[${dim}].CURRENTMEMBER, [${fc.ruleMeasure}]) ${op} ${val})}`
    return ''
  }
  if (mode === 'dynamic' || mode === 'expression') return fc.dynamicExpr || ''
  return ''
}

// WHERE slicer = one member per dimension. Simple searchable picker only.
function WhereMemberPicker({ dim, server, fc, setFc }) {
  const [search, setSearch] = useState('')
  const { data: elements = [] } = useElements(server, dim)
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return q ? elements.filter(e => e.Name.toLowerCase().includes(q)) : elements
  }, [elements, search])

  return (
    <div className="space-y-1">
      <input placeholder="Search members…" value={search} onChange={e => setSearch(e.target.value)}
        className="w-full text-[10px] px-1.5 py-0.5 border rounded bg-background" />
      <div className="max-h-[120px] overflow-auto rounded border border-border/40 bg-background/50">
        {filtered.length === 0 && (
          <div className="text-[10px] text-muted-foreground p-2 italic">
            {elements.length ? 'No match' : 'Loading…'}
          </div>
        )}
        {filtered.slice(0, 200).map(el => (
          <button key={el.Name}
            onClick={() => setFc({ selectedMember: el.Name })}
            className={cn('w-full text-left text-[10px] px-2 py-0.5 hover:bg-muted/60 truncate',
              fc.selectedMember === el.Name && 'bg-primary/10 text-primary font-medium')}>
            {el.Name}
          </button>
        ))}
      </div>
      {fc.selectedMember && (
        <button onClick={() => setFc({ selectedMember: null })}
          className="text-[9px] text-muted-foreground hover:text-foreground">
          × Clear
        </button>
      )}
    </div>
  )
}

function DynamicFilter({ dim, fc, setFc }) {
  const snippets = [
    ['USERNAME',             'USERNAME'],
    ['[Cube].(tuple)',       `[CubeName].([${dim}].[${dim}].CURRENTMEMBER, [Measures].[Measures].[Value])`],
    ['ELEMENTCOMPONENTOF()', `ELEMENTCOMPONENTOF("}GroupName", USERNAME, 1)`],
  ]
  const expr = fc.dynamicExpr ?? `STRTOMEMBER("[${dim}].[${dim}].[" + USERNAME + "]")`

  return (
    <div className="space-y-1.5">
      <div className="text-[9px] text-amber-400/80 flex items-center gap-1">
        ⚡ Resolved at runtime — preview unavailable
      </div>
      <textarea value={expr}
        onChange={e => setFc({ ...fc, dynamicExpr: e.target.value })}
        rows={3}
        className="w-full font-mono text-[10px] px-1.5 py-1 border rounded bg-background resize-none" />
      <div className="flex flex-wrap gap-1">
        {snippets.map(([label, val]) => (
          <button key={label} onClick={() => setFc({ ...fc, dynamicExpr: expr + ' + ' + val })}
            className="text-[9px] px-1.5 py-0.5 rounded border border-border hover:bg-muted font-mono">
            + {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function FilterBuilder({ dim, server, config, onChange, returnTabId }) {
  const { openTab } = useStore()
  const [advanced, setAdvanced] = useState(false)
  const filterMode   = config?.filterMode   || 'static'
  const filterConfig = config?.filterConfig || {}

  // Picking a member always resets to static mode
  const pickMember = (patch) => {
    const fc = { selectedMember: patch.selectedMember }
    onChange({ filterMode: 'static', filterConfig: fc, subsetExpression: buildFilterExpr(dim, 'static', fc) })
  }
  const setMode = (m) => {
    onChange({ filterMode: m, filterConfig: {}, subsetExpression: buildFilterExpr(dim, m, {}) })
  }
  const setExprFc = (patch) => {
    const newFc = { ...filterConfig, ...patch }
    onChange({ filterMode: 'expression', filterConfig: newFc, subsetExpression: buildFilterExpr(dim, 'expression', newFc) })
  }

  return (
    <div className="mt-1 border-t border-border/30 pt-1.5 space-y-1.5">
      {/* Primary: always show element picker */}
      <WhereMemberPicker dim={dim} server={server} fc={filterMode === 'static' ? filterConfig : {}} setFc={pickMember} />

      {/* Show active expression as a badge when in expression mode */}
      {filterMode === 'expression' && filterConfig.dynamicExpr && (
        <div className="flex items-center gap-1">
          <div className="font-mono text-[9px] text-violet-400 bg-violet-400/10 border border-violet-400/20 px-1.5 py-0.5 rounded truncate flex-1" title={filterConfig.dynamicExpr}>
            {filterConfig.dynamicExpr}
          </div>
          <button onClick={() => setMode('static')} className="text-[9px] text-muted-foreground hover:text-foreground shrink-0" title="Clear expression">×</button>
        </div>
      )}

      {/* Advanced toggle */}
      <button onClick={() => setAdvanced(a => !a)}
        className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors">
        <ChevronRight size={9} className={cn('transition-transform', advanced && 'rotate-90')} />
        Advanced
      </button>

      {advanced && (
        <div className="space-y-1.5 pl-2 border-l border-border/40">
          <div className="flex gap-0.5 bg-muted/30 rounded p-0.5">
            {[['static','Member'],['expression','Expression']].map(([id, label]) => (
              <button key={id} onClick={() => setMode(id)}
                className={cn('flex-1 py-0.5 text-[9px] rounded transition-colors',
                  filterMode === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {label}
              </button>
            ))}
          </div>
          {filterMode === 'expression' && (
            <div className="space-y-1">
              <button
                onClick={() => {
                  const tabId = `subset-filter:${server}:${dim}:${Date.now()}`
                  subsetApplyCallbacks.set(tabId, (mdx) => {
                    setExprFc({ dynamicExpr: mdx })
                  })
                  openTab({ id: tabId, type: 'subset', label: `Filter: ${dim}`, server, dimension: dim, subsetName: null, mdx: filterConfig.dynamicExpr || '', returnTabId })
                }}
                className="px-2 py-1 text-[10px] border rounded hover:bg-muted transition-colors w-full text-left">
                {filterConfig.dynamicExpr ? 'Edit expression…' : 'Build expression…'}
              </button>
              {filterConfig.dynamicExpr && (
                <div className="font-mono text-[9px] text-muted-foreground bg-muted/20 px-1.5 py-0.5 rounded truncate" title={filterConfig.dynamicExpr}>
                  {filterConfig.dynamicExpr}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function GuidedMDXBuilder({ tab, server: serverProp, onSwitchToRaw }) {
  const server = serverProp || tab?.server
  const mode = tab?.type === 'guidedmdxsubset' ? 'subset' : 'view'
  const isSubsetMode = mode === 'subset'

  const init = useMemo(() => loadPersistedState(tab?.id) ?? tab?.initialState ?? {}, [])
  const [step, setStep] = useState(init.step ?? 0)
  const [selectedCube, setSelectedCube] = useState(init.selectedCube ?? null)
  const [selectedDim, setSelectedDim] = useState('')
  const [dimConfig, setDimConfig] = useState(init.dimConfig ?? {})
  const [filterText, setFilterText] = useState('')
  const [currentMDX, setCurrentMDX] = useState('')
  const [buildHistory, setBuildHistory] = useState([])
  const [expandedCat, setExpandedCat] = useState(null)
  const [hoveredPattern, setHoveredPattern] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpSearch, setHelpSearch] = useState('')
  const [helpDetail, setHelpDetail] = useState(null)
  const [collapsedCats, setCollapsedCats] = useState(() => Object.fromEntries(CAT_ORDER.map(c => [c, true])))
  const [customPatterns, setCustomPatterns] = useState(loadCustomPatterns)
  const [customForm, setCustomForm] = useState(null) // null | { id?, label, cat, desc, mdxTemplate }
  const [expandedBuilders, setExpandedBuilders] = useState(new Set())
  const toggleBuilderCollapse = (dim) => setExpandedBuilders(prev => {
    const next = new Set(prev)
    next.has(dim) ? next.delete(dim) : next.add(dim)
    return next
  })

  const saveCustom = (list) => { setCustomPatterns(list); saveCustomPatterns(list) }
  const deleteCustom = (id) => saveCustom(customPatterns.filter(p => p.id !== id))
  const upsertCustom = (entry) => {
    const list = entry.id
      ? customPatterns.map(p => p.id === entry.id ? entry : p)
      : [...customPatterns, { ...entry, id: `custom-${Date.now()}`, cat: entry.cat || 'Custom', isCustom: true }]
    saveCustom(list)
    setCustomForm(null)
  }
  const [recent, setRecent] = useState(loadRecent())
  const [showRecent, setShowRecent] = useState(false)
  const sessionNameRef = useRef(null)

  const saveSession = (name) => {
    const mdx = activeMDX || viewMDX || currentMDX
    if (!mdx) return
    const label = name?.trim() || selectedCube || selectedDim || 'Session'
    const entry = { mdx, cube: selectedCube, dimension: selectedDim, name: label, time: Date.now() }
    saveRecent(entry)
    setRecent(loadRecent())
  }

  const loadSession = (entry) => {
    setSelectedDim(entry.dimension)
    setCurrentMDX(entry.mdx)
    if (entry.patterns?.length) {
      setBuildHistory(entry.patterns.map(id => {
        const p = PATTERNS.find(p => p.id === id) || FUNCTIONS.find(f => f.id === id)
        return { id, label: p?.label || id }
      }))
    }
    setStep(1)
    setShowRecent(false)
  }
  const [selectedAttr, setSelectedAttr] = useState('')
  const [previewMembers, setPreviewMembers] = useState(null)
  const [previewResult, setPreviewResult] = useState(init.previewResult ?? null)
  const [previewError, setPreviewError] = useState(init.previewError ?? null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [resultsHeight, setResultsHeight] = useState(240)
  const startResultsResize = useCallback((e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = resultsHeight
    const onMove = (mv) => setResultsHeight(Math.max(80, Math.min(startH + (startY - mv.clientY), 700)))
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [resultsHeight])
  const [viewMDX, setViewMDX] = useState(init.viewMDX ?? '')
  const [userEditedMDX, setUserEditedMDX] = useState(init.userEditedMDX ?? false)
  const prevGeneratedRef = useRef('')
  const [isFormatted, setIsFormatted] = useState(false)
  const [selectedMeasures, setSelectedMeasures] = useState(init.selectedMeasures ?? [])
  const [measuresMode, setMeasuresMode]         = useState(init.measuresMode ?? 'select')
  const [measuresSubset, setMeasuresSubset]     = useState(init.measuresSubset ?? '')
  const [intent, setIntent] = useState('Freeform')
  const [secondCube, setSecondCube] = useState(null)
  const [timeDim, setTimeDim] = useState(null)
  const [timeDim2, setTimeDim2] = useState(null)
  const [timeExpr1, setTimeExpr1] = useState('')
  const [timeExpr2, setTimeExpr2] = useState('')
  const [timeShowPatterns, setTimeShowPatterns] = useState(false)

  // Helper: pick a cube button click also runs intent-specific setup
  const handleCubePick = (cube) => {
    setSelectedCube(cube)
    if (intent === 'Measures by Dimension') {
      // Auto:  measures dim -> columns, leave rest for user
      setTimeout(() => {
        if (cubeDims.length > 0) {
          const c = {}
          cubeDims.forEach((d, i) => { c[d] = { axis: i < cubeDims.length - 1 ? 'rows' : 'columns' } })
          setDimConfig(c)
        }
        setStep(1)
      }, 150)
    } else if (intent === 'Cross-tab') {
      setTimeout(() => {
        if (cubeDims.length >= 3) {
          const c = {}
          c[cubeDims[0]] = { axis: 'rows' }
          c[cubeDims[1]] = { axis: 'columns' }
          c[cubeDims[cubeDims.length - 1]] = { axis: 'columns' }
          setDimConfig(c)
        }
        setStep(1)
      }, 150)
    } else if (intent === 'Time Series') {
      setTimeout(() => {
        if (cubeDims.length > 0) {
          const c = {}
          c[cubeDims[cubeDims.length - 1]] = { axis: 'columns' }
          cubeDims.forEach((d, i) => { if (i < cubeDims.length - 1) c[d] = { axis: 'rows' } })
          setDimConfig(c)
        }
        setStep(1)
      }, 150)
    } else if (intent === 'Filtered by another cube') {
      // Stay in step 0, show second cube picker
      // Will be handled below
    } else {
      setTimeout(() => setStep(1), 100)
    }
  }

  const { data: cubes = [] } = useCubes(server)
  const { data: cubeDims = [] } = useCubeDimensions(server, selectedCube)
  const measuresDim = cubeDims?.length ? cubeDims[cubeDims.length - 1] : null
  const { data: measureElements = [] } = useElements(server, measuresDim)
  const { data: measureSubsets  = [] } = useSubsets(server, measuresDim)
  const { data: dims = [] } = useDims(server)
  const { data: dimAttrs = [] } = useDimAttributes(server, selectedDim)
  const { data: attrValues = { values: [] } } = useAttributeValues(server, selectedDim, selectedAttr)
  const { openTab, dark } = useStore()
  const editorRef = useRef(null)
  const monacoRef = useRef(null)

  useEffect(() => {
    savePersistedState(tab?.id, { step, selectedCube, dimConfig, viewMDX, userEditedMDX, selectedMeasures, measuresMode, measuresSubset, intent, previewResult, previewError })
  }, [step, selectedCube, dimConfig, viewMDX, userEditedMDX, selectedMeasures, measuresMode, measuresSubset, intent, previewResult, previewError])

  // Auto-assign measures dim to columns when entering step 1 if not yet assigned
  useEffect(() => {
    if (!isSubsetMode && step === 1 && measuresDim && !dimConfig[measuresDim]?.axis) {
      setDimConfig(prev => ({ ...prev, [measuresDim]: { ...(prev[measuresDim] || {}), axis: 'columns' } }))
    }
  }, [measuresDim, step, isSubsetMode])

  const insertAtCursor = (text) => {
    const editor = editorRef.current
    if (!editor) { setCurrentMDX(prev => prev + text); return }
    const pos = editor.getPosition()
    editor.executeEdits('insert', [{ range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text }])
    editor.focus()
  }

  // View mode axes + MDX
  const { axes, dimExpressions } = useMemo(() => {
    const cols = [], rows = [], filt = [], exprs = {}
    Object.entries(dimConfig).forEach(([dim, cfg]) => {
      if (!cfg?.axis) return
      if (cfg.axis === 'columns') cols.push(dim)
      else if (cfg.axis === 'rows') rows.push(dim)
      else if (cfg.axis === 'filter') filt.push(dim)
      exprs[dim] = cfg.subsetExpression || `TM1SUBSETALL([${dim}].[${dim}])`
      if (dim === measuresDim) {
        if (measuresMode === 'subset' && measuresSubset)
          exprs[dim] = `TM1SubsetToSet([${dim}].[${dim}], "${measuresSubset}")`
        else if (selectedMeasures.length > 0)
          exprs[dim] = `{${selectedMeasures.map(m => `[${dim}].[${dim}].[${m}]`).join(', ')}}`
      }
    })
    return { axes: { columns: cols, rows: rows, filter: filt }, dimExpressions: exprs }
  }, [dimConfig, measuresDim, measuresMode, measuresSubset, selectedMeasures])

  const generatedMDX = useMemo(() => {
    if (isSubsetMode) return currentMDX || (selectedDim ? `{TM1SUBSETALL([${selectedDim}].[${selectedDim}])}` : '')
    if (!selectedCube) return ''
    const wrap  = s => (s?.trimStart().startsWith('{') ? s : `{${s}}`)
    const build = (dims, axis) => {
      if (!dims.length) return ''
      const sets   = dims.map(d => wrap(dimExpressions[d]))
      const joined = sets.length === 1 ? sets[0] : sets.join(' *\n        ')
      return `NON EMPTY\n    ${joined} ON ${axis}`
    }
    let mdx = 'SELECT'
    const colPart = build(axes.columns, 'COLUMNS')
    const rowPart = build(axes.rows, 'ROWS')
    if (colPart) mdx += `\n  ${colPart}`
    if (rowPart) mdx += `${colPart ? ',' : ''}\n  ${rowPart}`
    if (!colPart && !rowPart) mdx += '\n  NON EMPTY {TM1SubsetAll([Dim])} ON COLUMNS'
    mdx += `\nFROM [${selectedCube}]`
    if (axes.filter.length) {
      const slicers = axes.filter.flatMap(d => {
        const expr = (dimExpressions[d] || dimConfig[d]?.subsetExpression)?.trim()
        if (!expr) return []
        // Set expressions that return multiple members are invalid as WHERE tuple members — skip them
        if (/TM1SUBSETALL|TM1SubsetToSet|TM1FILTERBYLEVEL|TOPCOUNT|BOTTOMCOUNT|FILTER\s*\(|HEAD\s*\(|TAIL\s*\(/i.test(expr)) return []
        // Plain member name → 3-part reference
        if (!/[{}()[\]]/.test(expr)) return [`[${d}].[${d}].[${expr}]`]
        // Brace expression — strip braces. If the result contains commas (multiple members), skip.
        const stripped = expr.replace(/^\{([\s\S]*)\}$/, '$1').trim()
        if (stripped.includes(',')) return []
        return [stripped]
      })
      if (slicers.length) mdx += `\nWHERE (${slicers.join(', ')})`
    }
    return mdx
  }, [isSubsetMode, currentMDX, selectedDim, selectedCube, axes, dimExpressions])

  // Intent auto-config: when cubeDims load, apply intent axis setup
  useEffect(() => {
    if (!isSubsetMode && selectedCube && cubeDims.length > 0 && intent && step === 0) {
      let c = {}
      if (intent === 'Measures by Dimension') {
        cubeDims.forEach((d, i) => { c[d] = { axis: i < cubeDims.length - 1 ? 'rows' : 'columns' } })
      } else if (intent === 'Cross-tab') {
        if (cubeDims.length >= 2) {
          c[cubeDims[0]] = { axis: 'rows' }
          c[cubeDims[1]] = { axis: 'columns' }
        }
      } else if (intent === 'Time Series') {
        const lastI = cubeDims.length - 1
        cubeDims.forEach((d, i) => {
          const isTime = d === timeDim || d === timeDim2
          c[d] = { axis: isTime || i === lastI ? 'columns' : 'rows' }
          if (d === timeDim && timeExpr1) c[d].subsetExpression = timeExpr1
          if (d === timeDim2 && timeExpr2) c[d].subsetExpression = timeExpr2
        })
      } else if (intent === 'Filtered by another cube' || intent === 'Cross-cube reference') {
        if (secondCube) {
          cubeDims.forEach((d) => { c[d] = { axis: 'rows' } })
        } else {
          return // wait for second cube pick
        }
      }
      if (Object.keys(c).length > 0) {
        setDimConfig(c)
        setTimeout(() => setStep(1), 200)
      }
    }
  }, [cubeDims, intent, step, secondCube, isSubsetMode, selectedCube])

  // Sync generatedMDX → Monaco editor
  useEffect(() => {
    if (!generatedMDX) return
    setViewMDX(generatedMDX)
    prevGeneratedRef.current = generatedMDX
  }, [generatedMDX])

  // Auto-preview for subset mode
  useEffect(() => {
    if (!isSubsetMode || !currentMDX || !selectedDim || step < 1) return
    if (currentMDX.includes('"Attr"') || currentMDX.includes('"Val"') || currentMDX.includes('[Start]') || currentMDX.includes('[Cube]')) return
    const timer = setTimeout(async () => {
      if (!currentMDX.trim()) return
      setPreviewLoading(true)
      try {
        const res = await fetch(`/api/subset/preview?server=${encodeURIComponent(server)}&dimension=${encodeURIComponent(selectedDim)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mdx: currentMDX }),
        })
        const d = await res.json()
        if (res.ok) setPreviewMembers(d.members || [])
        else setPreviewMembers(null)
      } catch { setPreviewMembers(null) }
      finally { setPreviewLoading(false) }
    }, 600)
    return () => clearTimeout(timer)
  }, [currentMDX, selectedDim, isSubsetMode, step, server])

  // Client-side MDX validation (function names, arg counts)
  const mdxValidateTimer = useRef(null)
  useEffect(() => {
    const content = isSubsetMode ? currentMDX : (viewMDX || generatedMDX)
    if (!content?.trim() || !editorRef.current || !monacoRef.current) return
    clearTimeout(mdxValidateTimer.current)
    mdxValidateTimer.current = setTimeout(() => {
      const editor = editorRef.current
      const monaco = monacoRef.current
      const model = editor.getModel()
      if (!model) return
      const results = validateMDX(content)
      const markers = results.map(r => ({
        severity: monaco.MarkerSeverity.Warning,
        message: r.message,
        startLineNumber: r.line, startColumn: 1,
        endLineNumber: r.line, endColumn: model.getLineMaxColumn(r.line),
      }))
      monaco.editor.setModelMarkers(model, 'mdx-validate', markers)
    }, 700)
    return () => clearTimeout(mdxValidateTimer.current)
  }, [currentMDX, viewMDX, generatedMDX, isSubsetMode])

  const activeMDX = viewMDX || generatedMDX

  const runViewPreview = async () => {
    if (isSubsetMode) return
    setPreviewLoading(true); setPreviewError(null)
    try {
      const res = await fetch(`/api/mdx/execute?server=${encodeURIComponent(server)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ide-token': localStorage.getItem('tm1-token') ?? '' }, body: JSON.stringify({ mdx: activeMDX }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Preview failed')
      setPreviewResult(d)
    } catch (e) { setPreviewError(e.message) }
    finally { setPreviewLoading(false) }
  }

  const applyPattern = (p) => {
    try {
      const inner = currentMDX || `{TM1SUBSETALL([${selectedDim}].[${selectedDim}])}`
      let result
      if (p.unwrapped) result = WRAPPERS[p.id](selectedDim, inner)
      else { const st = inner.replace(/^\{(.+)\}$/s, '$1'); result = WRAPPERS[p.id](selectedDim, st) }
      setCurrentMDX(result)
      setBuildHistory(prev => [...prev, { id: p.id, label: p.label }])
    } catch (e) { setCurrentMDX(`# ERROR: ${e.message}`) }
  }

  const copyMDX = async () => { if (generatedMDX) try { await navigator.clipboard.writeText(generatedMDX) } catch {} }

  const toggleFormat = () => {
    let mdx = currentMDX
    if (isFormatted) {
      mdx = mdx.replace(/\s+/g, ' ').replace(/\s*(\{)\s*/g, '$1').replace(/\s*(\})\s*/g, '$1').replace(/\s*,\s*/g, ', ').trim()
      setIsFormatted(false)
    } else {
      mdx = mdx.replace(/\s+/g, ' ').trim()
      mdx = mdx.replace(/\{FILTER\(([^,]+),\s*([^}]+)\)\}/g, (_, inner, cond) =>
        `{\n  FILTER(\n    ${inner.trim()},\n    ${cond.trim()}\n  )\n}`)
      mdx = mdx.replace(/\,\s*\)\}$/g, '\n  )\n}')
      setIsFormatted(true)
    }
    setCurrentMDX(mdx)
  }

  // tm1mdx language registered globally by registerTM1Languages in tm1-functions.js
  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
  }

  // Table interactive: column header click
  const colClick = (attrKey) => {
    const attrDef = dimAttrs.find(a => (a.Name || a.name) === attrKey)
    const isNumeric = (attrDef?.Type || attrDef?.type) === 'Numeric'
    const newExpr = isNumeric
      ? `VAL([${selectedDim}].[${selectedDim}].CURRENTMEMBER.PROPERTIES("${attrKey}") + "0") = 0`
      : `[${selectedDim}].[${selectedDim}].CURRENTMEMBER.PROPERTIES("${attrKey}") = "Val"`
    if (/FILTER\(/.test(currentMDX)) {
      setCurrentMDX(prev => prev.replace(/,\s*[^\}]+(?=\)\s*\}$)/s, `, ${newExpr}`))
    } else {
      setCurrentMDX(prev => `{FILTER(${prev.replace(/^\{(.+)\}$/s, '$1')}, ${newExpr})}`)
    }
    setBuildHistory(prev => [...prev, { id: 'attr', label: `Filter: ${attrKey}` }])
  }

  // Table interactive: cell value click
  const cellClick = (attrKey, val) => {
    const attrDef = dimAttrs.find(a => (a.Name || a.name) === attrKey)
    const isNumeric = (attrDef?.Type || attrDef?.type) === 'Numeric'
    if (isNumeric) setCurrentMDX(prev => prev.replace(/= 0\)$/, `= ${val})`))
    else setCurrentMDX(prev => prev.replace(/"Val"/, `"${val}"`))
  }

  const steps = isSubsetMode
    ? [{ num: 0, title: 'Pick Dimension' }, { num: 1, title: 'Build Set' }]
    : [{ num: 0, title: 'Choose Cube' }, { num: 1, title: 'Assign Axes' }]

  const dimsList = isSubsetMode ? dims : cubeDims
  const filteredDims = useMemo(() => {
    const q = filterText.trim().toLowerCase()
    return q ? dimsList.filter(d => d.toLowerCase().includes(q)) : dimsList
  }, [dimsList, filterText])

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <div className="font-semibold text-sm">{isSubsetMode ? 'Guided Subset Builder' : 'Guided View Builder'}</div>
          <div className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary">{isSubsetMode ? 'MDX Subset' : 'MDX View'}</div>
          <button onClick={() => setHelpOpen(!helpOpen)}
            className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted flex items-center gap-1">
            <HelpCircle size={12} /> Help
          </button>
          <div className="relative">
            <button onClick={() => setShowRecent(!showRecent)}
              className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted flex items-center gap-1">
              <Clock size={12} /> Sessions
            </button>
            {showRecent && (
              <div className="absolute top-full right-0 mt-1 bg-popover border border-border rounded shadow-lg z-50 py-1 min-w-[280px] max-h-[200px] overflow-auto">
                <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border">
                  <input ref={sessionNameRef} placeholder="Session name…"
                    className="flex-1 px-1.5 py-0.5 text-[10px] border rounded bg-background"
                    onKeyDown={e => { if (e.key === 'Enter') { saveSession(e.target.value); e.target.value = '' } }} />
                  <button onClick={() => { saveSession(sessionNameRef.current?.value ?? ''); if (sessionNameRef.current) sessionNameRef.current.value = '' }}
                    disabled={!activeMDX && !viewMDX && !currentMDX}
                    className="px-2 py-0.5 text-[10px] border rounded hover:bg-muted flex items-center gap-1 disabled:opacity-40">
                    <Save size={11} /> Save
                  </button>
                </div>
                {recent.length === 0 && <div className="px-3 py-2 text-[10px] text-muted-foreground">No saved sessions</div>}
                {recent.map((r, i) => (
                  <button key={i} onClick={() => loadSession(r)}
                    className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-muted flex items-center justify-between gap-2">
                    <span className="font-mono truncate flex-1">{r.name || r.cube || r.dimension}</span>
                    <span className="text-muted-foreground shrink-0">{new Date(r.time).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground">Server: <span className="font-mono">{server || '—'}</span></div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 bg-muted/10">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium border',
              step === s.num ? 'bg-primary text-primary-foreground border-primary' : step > s.num ? 'bg-green-500 text-white border-green-600' : 'bg-muted text-muted-foreground border-border')}>
              {step > s.num ? <Check size={10} /> : i + 1}
            </div>
            <span className={step === s.num ? 'font-medium' : 'text-muted-foreground'}>{s.title}</span>
            {i < steps.length - 1 && <div className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {helpOpen && (() => {
        const allItems = [...ALL_ITEMS, ...customPatterns.map(p => ({ ...p, isCustom: true }))]
        const getItemMdx = (item) => item.isCustom ? item.mdxTemplate : (item.isFn || item.cat === 'Query Clauses') ? item.mdx() : (WRAPPERS[item.id] ? WRAPPERS[item.id](selectedDim||'Dim', '{...}') : '')
        const searchResults = helpSearch
          ? allItems.filter(item => {
              const mdx = getItemMdx(item)
              const q = helpSearch.toLowerCase()
              return item.label.toLowerCase().includes(q) || (item.desc||'').toLowerCase().includes(q) || mdx.toLowerCase().includes(q)
            })
          : null

        return (
        <div className="px-4 py-2.5 border-b border-border bg-muted/10 shrink-0 max-h-[380px] overflow-auto">

          {/* Header */}
          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-muted/10 py-0.5 z-10">
            {helpDetail && (
              <button onClick={() => setHelpDetail(null)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                <ArrowLeft size={11} /> Back
              </button>
            )}
            {!helpDetail && <div className="text-xs font-semibold flex-1">MDX Reference</div>}
            {helpDetail && <div className="text-xs font-semibold flex-1 truncate">{helpDetail.label}</div>}
            {!helpDetail && (
              <input type="text" placeholder="Search…" value={helpSearch}
                onChange={e => setHelpSearch(e.target.value)}
                className="text-[10px] px-2 py-1 border rounded bg-background w-44" />
            )}
            <button onClick={() => setCustomForm({ label:'', cat:'Custom', desc:'', mdxTemplate:'' })}
              title="Add custom pattern"
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"><Plus size={12} /></button>
            <button onClick={() => { setHelpOpen(false); setHelpSearch(''); setHelpDetail(null) }}
              className="p-0.5 rounded hover:bg-muted"><X size={12} /></button>
          </div>

          {/* Detail view */}
          {helpDetail && (() => {
            const mdx = getItemMdx(helpDetail)
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide">{helpDetail.cat}</span>
                  {helpDetail.isFn && <span className="text-[9px] text-sky-400">function</span>}
                  {helpDetail.isCustom && <span className="text-[9px] text-amber-400">custom</span>}
                </div>
                {helpDetail.desc && <div className="text-[10px] text-muted-foreground">{helpDetail.desc}</div>}
                <div className="relative">
                  <div className="font-mono text-[9px] bg-muted/40 p-2 rounded whitespace-pre-wrap break-all">{mdx}</div>
                  <button onClick={() => navigator.clipboard.writeText(mdx)}
                    className="absolute top-1 right-1 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Copy size={10} />
                  </button>
                </div>
                {helpDetail.isCustom && (
                  <div className="flex gap-2">
                    <button onClick={() => setCustomForm({ ...helpDetail })}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground">
                      <Pencil size={10} /> Edit
                    </button>
                    <button onClick={() => { deleteCustom(helpDetail.id); setHelpDetail(null) }}
                      className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300">
                      <Trash2 size={10} /> Delete
                    </button>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Search results */}
          {!helpDetail && searchResults && (
            <div className="space-y-0.5">
              {searchResults.length === 0 && <div className="text-[10px] text-muted-foreground">No matches for "{helpSearch}"</div>}
              {[...new Set(searchResults.map(i => i.cat))].map(cat => (
                <div key={cat}>
                  <div className="text-[9px] uppercase text-muted-foreground font-semibold mt-2 mb-1">{cat}</div>
                  {searchResults.filter(i => i.cat === cat).map(item => (
                    <button key={item.id} onClick={() => setHelpDetail(item)}
                      className="w-full text-left text-[10px] flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 group">
                      <span className="font-mono text-sky-400 font-medium">{item.label}</span>
                      {item.desc && <span className="text-muted-foreground truncate">{item.desc}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Browse by category */}
          {!helpDetail && !searchResults && (
            <div className="space-y-1">
              {[...CAT_ORDER.filter(c => allItems.some(i => i.cat === c))].map(cat => {
                const items = allItems.filter(i => i.cat === cat)
                const collapsed = collapsedCats[cat]
                return (
                  <div key={cat}>
                    <button onClick={() => setCollapsedCats(prev => ({ ...prev, [cat]: !prev[cat] }))}
                      className="flex items-center gap-1.5 w-full text-left text-[9px] uppercase font-semibold text-muted-foreground hover:text-foreground py-1">
                      {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                      {cat}
                      <span className="font-normal normal-case ml-1 opacity-60">{items.length}</span>
                    </button>
                    {!collapsed && (
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-4 pb-1">
                        {items.map(item => (
                          <button key={item.id} onClick={() => setHelpDetail(item)}
                            className="text-left text-[10px] flex items-center gap-1 py-0.5 rounded hover:text-sky-400 group truncate">
                            <span className="font-mono text-sky-400 group-hover:text-sky-300 truncate">{item.label}</span>
                            {item.isCustom && <span className="shrink-0 text-[8px] text-amber-400/70">★</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Add / edit custom pattern form */}
          {customForm && (
            <div className="mt-3 border border-border rounded p-3 space-y-2 bg-muted/20">
              <div className="text-[10px] font-semibold">{customForm.id ? 'Edit Pattern' : 'Add Custom Pattern'}</div>
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Label" value={customForm.label} onChange={e => setCustomForm(f => ({ ...f, label: e.target.value }))}
                  className="text-[10px] px-2 py-1 border rounded bg-background col-span-1" />
                <input placeholder="Category" value={customForm.cat} onChange={e => setCustomForm(f => ({ ...f, cat: e.target.value }))}
                  className="text-[10px] px-2 py-1 border rounded bg-background col-span-1" />
              </div>
              <input placeholder="Description (optional)" value={customForm.desc} onChange={e => setCustomForm(f => ({ ...f, desc: e.target.value }))}
                className="text-[10px] px-2 py-1 border rounded bg-background w-full" />
              <textarea placeholder="MDX template" value={customForm.mdxTemplate} onChange={e => setCustomForm(f => ({ ...f, mdxTemplate: e.target.value }))}
                rows={3} className="text-[10px] font-mono px-2 py-1 border rounded bg-background w-full resize-none" />
              <div className="flex gap-2">
                <button onClick={() => upsertCustom(customForm)} disabled={!customForm.label || !customForm.mdxTemplate}
                  className="px-3 py-1 text-[10px] rounded bg-primary text-primary-foreground disabled:opacity-40">Save</button>
                <button onClick={() => setCustomForm(null)} className="px-3 py-1 text-[10px] rounded hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}
        </div>
        )
      })()}

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left panel */}
        <div className="flex-1 min-w-[300px] max-w-[500px] border-r border-border overflow-hidden flex flex-col">
          <div className="p-4 overflow-auto flex-1 flex flex-col">

          {!server && <div className="text-xs text-muted-foreground border border-dashed rounded p-3 mb-3">No server connected.</div>}

          {isSubsetMode ? (
            step === 0 ? (
              <div>
                <div className="font-medium text-sm mb-1">Pick a Dimension</div>
                <div className="text-[11px] text-muted-foreground mb-3">Select the dimension to build an MDX subset for.</div>
                <input type="text" placeholder="Filter dimensions…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                  value={filterText} onChange={e => setFilterText(e.target.value)} />
                <div className="space-y-0.5 max-h-[420px] overflow-auto">
                  {filteredDims.map(d => (
                    <button key={d} onClick={() => { setSelectedDim(d); setCurrentMDX(`{TM1SUBSETALL([${d}].[${d}])}`); setTimeout(() => setStep(1), 100) }}
                      className={cn('w-full text-left px-3 py-2 rounded border text-xs font-mono',
                        selectedDim === d ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>{d}</button>
                  ))}
                </div>
              </div>
            ) : step === 1 && selectedDim ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <div className="text-sm font-medium flex-1">Build Set: [{selectedDim}]</div>
                  <button onClick={() => { setCurrentMDX(`{TM1SUBSETALL([${selectedDim}].[${selectedDim}])}`); setBuildHistory([]) }}
                    className="text-[10px] px-2 py-0.5 border rounded hover:bg-muted">Reset</button>
                </div>

                <div className="text-[10px] text-muted-foreground mb-1 shrink-0">
                  Layers: <span className="font-mono text-foreground">{buildHistory.length}</span>
                  {buildHistory.length > 0 && (
                    <span className="ml-2 inline-flex flex-wrap gap-1">
                      {buildHistory.map((h, i) => <span key={i} className="px-1 bg-primary/10 text-primary rounded font-mono">{h.label}</span>)}
                    </span>
                  )}
                </div>

                <div className="overflow-auto shrink-0 max-h-[280px]">
                  {CATEGORIES.map(cat => (
                    <div key={cat} className="mb-1">
                      <button onClick={() => setExpandedCat(expandedCat === cat ? null : cat)}
                        className="w-full flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold py-1 hover:text-foreground">
                        {expandedCat === cat ? '▾' : '▸'} {cat}
                      </button>
                      {expandedCat === cat && (
                        <div className="grid grid-cols-2 gap-0.5 pl-3">
                          {PATTERNS.filter(p => p.cat === cat).map(p => (
                            <button key={p.id} onClick={() => applyPattern(p)}
                              className="text-left px-2 py-1 rounded border border-border hover:bg-muted text-[10px] font-mono leading-tight">{p.label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="mb-1">
                    <button onClick={() => setExpandedCat(expandedCat === 'functions' ? null : 'functions')}
                      className="w-full flex items-center gap-1 text-[10px] uppercase tracking-wider text-amber-400 font-semibold py-1 hover:text-foreground">
                      {expandedCat === 'functions' ? '▾' : '▸'} Functions
                    </button>
                    {expandedCat === 'functions' && (
                      <div className="grid grid-cols-2 gap-0.5 pl-3">
                        {FUNCTIONS.map(fn => (
                          <button key={fn.id} onClick={() => insertAtCursor(fn.mdx())}
                            className="text-left px-2 py-1 rounded border border-border hover:bg-muted text-[10px] font-mono leading-tight">{fn.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2 mb-1">
                  <span className="text-[10px] text-muted-foreground">MDX Editor</span>
                  <div className="flex gap-1">
                    <button onClick={toggleFormat} className="text-[9px] px-1.5 py-0.5 border rounded hover:bg-muted">{isFormatted ? 'Inline' : 'Format'}</button>
                    <button onClick={copyMDX} className="text-[9px] px-1.5 py-0.5 border rounded hover:bg-muted">Copy</button>
                  </div>
                </div>
                <div className="flex-1 min-h-[180px] border rounded overflow-hidden">
                  <MonacoEditor
                    height="100%" language="tm1mdx"
                    value={currentMDX}
                    onChange={v => setCurrentMDX(v)}
                    beforeMount={monaco => registerTM1Theme(monaco, dark)}
                    onMount={handleEditorMount}
                    options={{ fontSize: 11, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, lineNumbers: 'off', folding: false, renderLineHighlight: 'none', overviewRulerLanes: 0 }}
                    theme="tm1-custom"
                  />
                </div>
                <button onClick={() => openTab({ id: `subsetmdx:${selectedDim}:${Date.now()}`, type: 'subset', label: `MDX: ${selectedDim}`, server, dimension: selectedDim, mdx: currentMDX })}
                  className="w-full mt-2 px-3 py-2 rounded bg-primary text-primary-foreground text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                  <ExternalLink size={13} /> Open in Subset Editor
                </button>
              </div>
            ) : null
          ) : (
            step === 0 ? (
              <div>
                <div className="font-medium text-sm mb-1">Choose a Cube</div>
                <div className="text-[11px] text-muted-foreground mb-3">Pick the cube to query.</div>
                <input type="text" placeholder="Filter cubes…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                  value={filterText} onChange={e => setFilterText(e.target.value)} />
                <div className="space-y-0.5 max-h-[360px] overflow-auto">
                  {cubes.filter(c => !filterText || c.toLowerCase().includes(filterText.toLowerCase())).map(cube => (
                    <button key={cube} onClick={() => handleCubePick(cube)}
                      className={cn('w-full text-left px-3 py-2 rounded border text-xs font-mono',
                        selectedCube === cube ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted')}>{cube}</button>
                  ))}
                </div>
              </div>
            ) : step === 1 && selectedCube ? (
              <div>
                <div className="font-medium text-sm mb-1">Assign Dimensions</div>
                {userEditedMDX && (
                  <div className="mb-2 px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400 flex items-center gap-1.5">
                    ⚠ MDX edited manually — config no longer reflects the running query. Reset to re-sync.
                  </div>
                )}
                {measuresDim && measureElements.length > 0 && (
                  <div className="mb-3 p-2 border rounded bg-muted/20">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[10px] text-muted-foreground font-medium">Measures ({measuresDim})</div>
                      <div className="flex gap-0.5 bg-muted/40 rounded p-0.5">
                        {[['select','Select'],['subset','Subset']].map(([id, label]) => (
                          <button key={id} onClick={() => { setMeasuresMode(id); setSelectedMeasures([]); setMeasuresSubset('') }}
                            className={cn('px-1.5 py-0.5 text-[9px] rounded transition-colors',
                              measuresMode === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {measuresMode === 'select' ? (
                      <>
                        <div className="grid grid-cols-3 gap-1 max-h-[120px] overflow-auto">
                          {measureElements.filter(el => el.Type === 'N').slice(0, 60).map(el => {
                            const name = el.Name || el.name || el
                            const checked = selectedMeasures.includes(name)
                            return (
                              <label key={name} className="flex items-center gap-1 text-[10px] cursor-pointer">
                                <input type="checkbox" checked={checked}
                                  onChange={() => setSelectedMeasures(prev => checked ? prev.filter(m => m !== name) : [...prev, name])}
                                  className="accent-primary" />
                                <span className="font-mono truncate">{name}</span>
                              </label>
                            )
                          })}
                        </div>
                        {selectedMeasures.length > 0 && (
                          <button onClick={() => setSelectedMeasures([])}
                            className="text-[9px] px-2 py-0.5 border rounded hover:bg-muted mt-1">Clear</button>
                        )}
                      </>
                    ) : (
                      <select value={measuresSubset} onChange={e => setMeasuresSubset(e.target.value)}
                        className="w-full text-[10px] px-1.5 py-0.5 border rounded bg-background">
                        <option value="">Pick named subset…</option>
                        {measureSubsets.map(s => <option key={s.Name} value={s.Name}>{s.Name}</option>)}
                      </select>
                    )}
                  </div>
                )}
                <input type="text" placeholder="Filter dims…" className="w-full mb-2 px-2 py-1.5 text-xs border rounded bg-background"
                  value={filterText} onChange={e => setFilterText(e.target.value)} />
                <div className="space-y-1.5">
                  {filteredDims.map(dim => {
                    const cur       = dimConfig[dim]?.axis || null
                    const collapsed = !expandedBuilders.has(dim)
                    const cfg       = dimConfig[dim] || {}

                    // Compact summary shown when builder is collapsed
                    const summary = (() => {
                      if (!cur) return null
                      if (cur === 'filter') {
                        const fm = cfg.filterMode || 'static'
                        if (fm === 'dynamic') return 'Dynamic'
                        return cfg.filterConfig?.selectedMember || null
                      }
                      const mode = cfg.axisMode
                      if (!mode || mode === 'all') return 'All'
                      if (mode === 'leaf') return 'Leaf'
                      if (mode === 'member') {
                        const ms = cfg.axisConfig?.selectedMembers || []
                        return ms.length ? `${ms.length} member${ms.length > 1 ? 's' : ''}` : null
                      }
                      if (mode === 'range') {
                        const { rangeFrom, rangeTo } = cfg.axisConfig || {}
                        return rangeFrom && rangeTo ? `${rangeFrom} → ${rangeTo}` : 'Range'
                      }
                      if (mode === 'subset')    return cfg.axisConfig?.subsetName || 'Subset'
                      if (mode === 'condition') return cfg.axisConfig?.condType || 'Condition'
                      if (mode === 'expression') return 'Expression'
                      return null
                    })()

                    return (
                      <div key={dim} className="border rounded px-2 py-1.5 bg-background space-y-1">
                        <div className="flex items-center gap-1">
                          <div className="font-mono text-[11px] flex-1 truncate">{dim}</div>
                          {cur && collapsed && summary && (
                            <span className="text-[9px] text-muted-foreground truncate max-w-[80px]">{summary}</span>
                          )}
                          <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'columns' ? null : 'columns', subsetExpression: p[dim]?.subsetExpression || '' } }))}
                            className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'columns' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Cols</button>
                          <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'rows' ? null : 'rows', subsetExpression: p[dim]?.subsetExpression || '' } }))}
                            className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'rows' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Rows</button>
                          <button onClick={() => setDimConfig(p => ({ ...p, [dim]: { axis: p[dim]?.axis === 'filter' ? null : 'filter', subsetExpression: p[dim]?.subsetExpression || '' } }))}
                            className={cn('px-1.5 py-0.5 text-[10px] rounded border', cur === 'filter' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>Filt</button>
                          {cur && dim !== measuresDim && (
                            <button onClick={() => toggleBuilderCollapse(dim)}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground ml-0.5">
                              {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                            </button>
                          )}
                        </div>
                        {cur && !collapsed && dim !== measuresDim && (cur === 'columns' || cur === 'rows') && (
                          <AxisSetBuilder
                            dim={dim}
                            server={server}
                            measuresDim={measuresDim}
                            config={dimConfig[dim]}
                            onChange={cfg => setDimConfig(p => ({ ...p, [dim]: { ...p[dim], ...cfg } }))}
                            returnTabId={tab?.id}
                          />
                        )}
                        {cur && !collapsed && dim !== measuresDim && cur === 'filter' && (
                          <FilterBuilder
                            dim={dim}
                            server={server}
                            cube={selectedCube}
                            config={dimConfig[dim]}
                            onChange={cfg => setDimConfig(p => ({ ...p, [dim]: { ...p[dim], ...cfg } }))}
                            returnTabId={tab?.id}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={copyMDX} disabled={!generatedMDX}
                    className="flex-1 px-3 py-2 rounded border text-xs flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-muted">
                    <Copy size={13} /> Copy MDX
                  </button>
                  <button onClick={() => {
                      if (!selectedCube) return
                      const toEntry = (dim) => {
                          const expr = dimConfig[dim]?.subsetExpression?.trim()
                          const entry = { dimension: dim, subset: null, member: null, members: null, memberSet: null }
                          if (!expr) return entry
                          const subsetMatch = expr.match(/TM1SubsetToSet\([^,]+,\s*"([^"]+)"/)
                          if (subsetMatch) { entry.subset = subsetMatch[1]; return entry }
                          if (expr.includes('FILTERBYLEVEL') && expr.includes(', 0)')) { entry.memberSet = 'leaf'; return entry }
                          if (expr.includes('DefaultMember')) { entry.memberSet = 'root'; return entry }
                          if (expr.includes('SUBSETALL')) { return entry }
                          if (!/[{}()[\]]/.test(expr)) { entry.member = expr; return entry }
                          return entry
                      }
                      const initialAxes = {
                          rows:    axes.rows.map(toEntry),
                          columns: axes.columns.map(toEntry),
                          pages:   axes.filter.map(toEntry),
                      }
                      openTab({
                          id:          `view:${server}:${selectedCube}:guided-${Date.now()}`,
                          type:        'view',
                          label:       selectedCube,
                          server,
                          cube:        selectedCube,
                          initialMdx:  activeMDX,
                          initialAxes,
                      })
                  }} disabled={!activeMDX}
                    className="flex-1 px-3 py-2 rounded bg-primary text-primary-foreground text-xs flex items-center justify-center gap-2 disabled:opacity-40">
                    <ExternalLink size={13} /> Open in View Editor
                  </button>
                </div>
              </div>
            ) : null
          )}

          </div>
        </div>

        {/* Right: Results */}
        <div className="flex-1 flex flex-col min-h-0 p-4 overflow-hidden">


          {!isSubsetMode && (
            <>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium">Generated MDX</div>
                <div className="flex gap-1 items-center">
                  {userEditedMDX && (
                    <button onClick={() => { setViewMDX(generatedMDX); setUserEditedMDX(false) }}
                      className="px-2 py-0.5 text-[9px] rounded border hover:bg-muted text-muted-foreground" title="Reset to generated MDX">↺ Reset</button>
                  )}
                  <button
                    onClick={() => { const f = formatMDX(viewMDX); setViewMDX(f); setUserEditedMDX(true) }}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                    title="Format MDX">
                    <WrapText size={10} /> Format
                  </button>
                  <button onClick={runViewPreview} disabled={!activeMDX || previewLoading}
                    className="px-3 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600 flex items-center gap-1 disabled:opacity-40 transition-colors">
                    {previewLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Execute
                  </button>
                </div>
              </div>
              <div className="rounded overflow-hidden mb-3 flex-1 min-h-0">
                <MonacoEditor
                  height="100%" language="tm1mdx"
                  value={viewMDX}
                  onChange={v => { setViewMDX(v); setUserEditedMDX(true) }}
                  beforeMount={monaco => registerTM1Theme(monaco, dark)}
                  onMount={handleEditorMount}
                  options={{ fontSize: 11, minimap: { enabled: false }, wordWrap: 'on', scrollBeyondLastLine: false, folding: false, renderLineHighlight: 'none', overviewRulerLanes: 0, lineNumbers: 'on' }}
                  theme="tm1-custom"
                />
              </div>
            </>
          )}
          {/* Stats bar */}
          {!isSubsetMode && (() => {
            const mdxLen   = (activeMDX || '').length
            const mdxKB    = (mdxLen / 1024).toFixed(1)
            const rows     = previewResult?.Axes?.[1]?.Tuples?.length ?? null
            const cols     = previewResult?.Axes?.[0]?.Tuples?.length ?? null
            const cells    = previewResult?.Cells?.length ?? null
            const LIMIT    = 262144  // 256 KB
            const lenColor = mdxLen > LIMIT ? 'text-red-400' : mdxLen > LIMIT * 0.85 ? 'text-amber-400' : 'text-muted-foreground'
            return (
              <div className="flex items-center gap-3 mb-1.5 text-[10px]">
                <span className={cn('font-mono', lenColor)}
                  title={`${mdxLen.toLocaleString()} chars — limit is 256 KB (262,144 chars)`}>
                  {mdxKB} KB{mdxLen > LIMIT ? ' ⚠ >256KB' : ''}
                </span>
                {rows !== null && <span className="text-muted-foreground">{rows.toLocaleString()} rows</span>}
                {cols !== null && <span className="text-muted-foreground">{cols.toLocaleString()} cols</span>}
                {cells !== null && <span className="text-muted-foreground">{cells.toLocaleString()} cells</span>}
              </div>
            )
          })()}
          {!isSubsetMode && (
            <div onMouseDown={startResultsResize}
              className="shrink-0 h-1.5 cursor-row-resize flex items-center justify-center hover:bg-primary/20 transition-colors group"
              title="Drag to resize results">
              <GripHorizontal size={12} className="text-muted-foreground/40 group-hover:text-primary/60" />
            </div>
          )}
          <div className="text-xs font-medium text-muted-foreground shrink-0">Results</div>
          <div className={cn('rounded overflow-auto bg-background p-2', isSubsetMode ? 'flex-1 min-h-0' : 'shrink-0')}
            style={!isSubsetMode ? { height: resultsHeight } : undefined}>
            {isSubsetMode ? (
              previewLoading ? <div className="h-full flex items-center justify-center"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div> :
              previewMembers && previewMembers.length > 0 && previewMembers[0]?.attributes ? (
                (() => {
                  const attrKeys = [...new Set(previewMembers.flatMap(m => Object.keys(m.attributes)))]
                  return (
                    <div className="overflow-auto max-h-full">
                      <table className="w-full text-[10px] border-collapse">
                        <thead className="sticky top-0 bg-card z-10">
                          <tr className="border-b">
                            <th className="text-left px-2 py-1 font-medium text-muted-foreground">Name</th>
                            {attrKeys.map(k => (
                              <th key={k} className="text-left px-2 py-1 font-medium text-muted-foreground whitespace-nowrap cursor-pointer hover:text-sky-400 hover:underline"
                                onClick={() => colClick(k)} title="Filter by this attribute">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewMembers.map((m, i) => (
                            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                              <td className="px-2 py-0.5 font-mono whitespace-nowrap">{m.Name || m.name}</td>
                              {attrKeys.map(k => (
                                <td key={k} className="px-2 py-0.5 font-mono whitespace-nowrap cursor-pointer hover:bg-sky-400/10 hover:text-sky-400"
                                  onClick={() => { const v = m.attributes?.[k] ?? ''; if (v) cellClick(k, v) }}>
                                  {m.attributes?.[k] ?? ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()
              ) : previewMembers && previewMembers.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {previewMembers.slice(0, 300).map((m, i) => <span key={i} className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">{m.Name || m.name || m}</span>)}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                  {currentMDX ? (currentMDX.includes('"Attr"') ? 'Edit placeholders to preview' : 'Members will appear here') : 'Pick a dimension to start'}
                </div>
              )
            ) : (
              previewResult ? <ResultGrid
                axes={previewResult.Axes} cells={previewResult.Cells} truncated={previewResult.truncated}
                server={server} cube={selectedCube} writable={!!selectedCube}
                dimOrder={cubeDims}
                slicerCoords={axes?.filter?.flatMap(d => {
                  const expr = dimConfig[d]?.subsetExpression?.trim()
                  if (!expr) return []
                  // Plain name — no brackets at all
                  if (!/[{}()[\]]/.test(expr)) return [{ dim: d, name: expr }]
                  // 3-part member ref [Dim].[Dim].[Member] — extract last bracket segment
                  if (!/[{}()]/.test(expr)) {
                    const parts = expr.match(/\[([^\]]+)\]/g)
                    if (parts?.length) return [{ dim: d, name: parts[parts.length - 1].slice(1, -1) }]
                  }
                  return []
                })}
              /> :
              previewError ? <div className="text-xs text-red-400 p-2">{previewError}</div> :
              <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">Run preview to see results</div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
