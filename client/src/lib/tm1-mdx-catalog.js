// TM1 MDX function catalog — signatures, descriptions, templates
// Examples provided by domain expert

export const MDX_CATALOG = [
  {
    category: 'Members & Sets',
    fns: [
      {
        name: 'TM1SUBSETALL',
        signature: 'TM1SUBSETALL([Dim])',
        params: ['Dim — dimension name'],
        description: 'Returns all members of a dimension. Preferred over .Members for TM1 subsets as it includes all element types.',
        template: 'TM1SUBSETALL([${1:Dim}])',
        example: '',
      },
      {
        name: 'Members',
        signature: '{[Dim].[Dim].Members}',
        params: [],
        description: 'All members of the hierarchy.',
        template: '{[${1:Dim}].[${1:Dim}].Members}',
        example: '',
      },
      {
        name: 'Children',
        signature: '{[Dim].[Dim].[Parent].Children}',
        params: [],
        description: 'Direct children of a consolidated member.',
        template: '{[${1:Dim}].[${1:Dim}].[${2:Parent}].Children}',
        example: '',
      },
      {
        name: 'Descendants',
        signature: 'Descendants(member)',
        params: ['member — the root member', 'level — optional depth or level name; omit for all descendants'],
        description: 'All descendants of a member. Omit the level argument to get all descendants to the leaves.',
        template: '{DESCENDANTS([${1:Dim}].[${1:Dim}].[${2:Parent}])}',
        example: '',
      },
      {
        name: 'Ancestors',
        signature: 'Ancestors(member, distance)',
        params: ['member', 'distance — levels above (1 = parent)'],
        description: 'All ancestors of a member at a given distance.',
        template: '{Ancestors([${1:Dim}].[${1:Dim}].[${2:Member}], ${3:1})}',
        example: '',
      },
      {
        name: 'Siblings',
        signature: '{[Dim].[Dim].[Member].Siblings}',
        params: [],
        description: 'All members that share the same parent.',
        template: '{[${1:Dim}].[${1:Dim}].[${2:Member}].Siblings}',
        example: '',
      },
    ],
  },
  {
    category: 'Filter',
    fns: [
      {
        name: 'TM1FILTERBYLEVEL',
        signature: 'TM1FILTERBYLEVEL(set, level)',
        params: ['set — input set', 'level — 0 = leaf, 1 = first consolidation, etc.'],
        description: 'Filter members by hierarchy level. Level 0 = leaf (numeric) members.',
        template: '{TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, ${2:0})}',
        example: '',
      },
      {
        name: 'TM1FILTERBYPATTERN',
        signature: 'TM1FILTERBYPATTERN(set, pattern)',
        params: ['set', 'pattern — wildcard string, * matches any sequence'],
        description: 'Filter members whose names match a wildcard pattern.',
        template: '{TM1FILTERBYPATTERN({TM1SUBSETALL([${1:Dim}])}, "${2:A*}")}',
        example: '',
      },
      {
        name: 'FILTER',
        signature: 'FILTER(set, condition)',
        params: ['set', 'condition — MDX boolean expression'],
        description: 'Filter members using an arbitrary boolean condition — cube values, properties, CurrentMember context, or combined AND/OR logic.',
        template: '{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  ${2:condition}\n)}',
        example: '',
      },
      {
        name: 'NOT ISEMPTY',
        signature: 'NOT ISEMPTY([Cube].(tuple))',
        params: ['Cube — cube name', 'tuple — dimension members for all other dimensions'],
        description: 'True when a cube cell is non-empty. Use inside FILTER to keep only members that have data.',
        template: 'NOT ISEMPTY([${1:CubeName}].([${2:Dim2}].[${2:Dim2}].[${3:Member}], [${4:Measures}].[${5:Value}]))',
        example: '',
      },
    ],
  },
  {
    category: 'Sort & Rank',
    fns: [
      {
        name: 'TM1SORT',
        signature: 'TM1SORT(set, order)',
        params: ['set', 'order — ASC or DESC'],
        description: 'Sort members alphabetically by name.',
        template: '{TM1SORT({TM1SUBSETALL([${1:Dim}])}, ${2:ASC})}',
        example: '',
      },
      {
        name: 'ORDER',
        signature: 'ORDER(set, expression, order)',
        params: ['set', 'expression — numeric MDX expression to sort by', 'order — ASC, DESC, BASC, BDESC'],
        description: 'Sort members by the value of an expression (e.g. a cube cell value). BDESC breaks hierarchy order for a true value-based ranking.',
        template: '{ORDER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  [${2:CubeName}].([${3:Dim2}].[${3:Dim2}].[${4:Member}], [Measures].[${5:Amount}]),\n  ${6:BDESC}\n)}',
        example: '',
      },
      {
        name: 'TOPCOUNT',
        signature: 'TOPCOUNT(set, n, expression)',
        params: ['set', 'n — number of members to return', 'expression — optional value expression to rank by'],
        description: 'Return the top N members, optionally ranked by a cube value.',
        template: '{TOPCOUNT(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  ${2:20},\n  [${3:CubeName}].([${4:Dim2}].[${4:Dim2}].[${5:Member}], [Measures].[${6:Amount}])\n)}',
        example: '',
      },
      {
        name: 'BOTTOMCOUNT',
        signature: 'BOTTOMCOUNT(set, n, expression)',
        params: ['set', 'n', 'expression — optional value expression'],
        description: 'Return the bottom N members, optionally ranked by a cube value.',
        template: '{BOTTOMCOUNT(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  ${2:20},\n  [${3:CubeName}].([${4:Dim2}].[${4:Dim2}].[${5:Member}], [Measures].[${6:Amount}])\n)}',
        example: '',
      },
      {
        name: 'HIERARCHIZE',
        signature: 'HIERARCHIZE(set)',
        params: ['set'],
        description: 'Re-order a set into natural hierarchy order (parents before children).',
        template: '{HIERARCHIZE({${1:set}})}',
        example: '',
      },
    ],
  },
  {
    category: 'Set Operations',
    fns: [
      {
        name: 'UNION',
        signature: 'UNION(set1, set2)',
        params: ['set1', 'set2'],
        description: 'Combine two sets, removing duplicates.',
        template: '{UNION({${1:set1}}, {${2:set2}})}',
        example: '',
      },
      {
        name: 'INTERSECT',
        signature: 'INTERSECT(set1, set2)',
        params: ['set1', 'set2'],
        description: 'Members present in both sets.',
        template: '{INTERSECT({${1:set1}}, {${2:set2}})}',
        example: '',
      },
      {
        name: 'EXCEPT',
        signature: 'EXCEPT(set1, set2)',
        params: ['set1 — base set', 'set2 — members to exclude'],
        description: 'Members in set1 that are not in set2.',
        template: '{EXCEPT(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  {TM1FILTERBYPATTERN({TM1SUBSETALL([${1:Dim}])}, "${2:}*")}\n)}',
        example: '',
      },
      {
        name: 'CROSSJOIN',
        signature: 'CROSSJOIN(set1, set2)',
        params: ['set1', 'set2'],
        description: 'Cartesian product of two sets — all combinations.',
        template: '{CROSSJOIN({TM1SUBSETALL([${1:Dim1}])}, {TM1SUBSETALL([${2:Dim2}])})}',
        example: '',
      },
    ],
  },
  {
    category: 'Period & Time',
    fns: [
      {
        name: 'PeriodsToDate',
        signature: 'PeriodsToDate(level, member)',
        params: ['level — e.g. [Period].[Period].[Year]', 'member — current period member'],
        description: 'All periods from the start of a higher level to the given member. Use for YTD, QTD, MTD.',
        template: '{PeriodsToDate([${1:Period}].[${1:Period}].[${2:Year}], [${1:Period}].[${1:Period}].[${3:CurrentMonth}])}',
        example: '',
      },
      {
        name: 'ParallelPeriod',
        signature: 'ParallelPeriod(level, n, member)',
        params: ['level', 'n — periods back (positive) or forward (negative)', 'member'],
        description: 'The equivalent period N intervals ago at the same level. Use for prior year comparisons.',
        template: '{ParallelPeriod([${1:Period}].[${1:Period}].[${2:Year}], ${3:1}, [${1:Period}].[${1:Period}].[${4:CurrentMonth}])}',
        example: '',
      },
      {
        name: 'LastPeriods',
        signature: 'LastPeriods(n, member)',
        params: ['n — number of periods', 'member — end period'],
        description: 'The last N periods ending at the given member (rolling window).',
        template: '{LastPeriods(${1:12}, [${2:Period}].[${2:Period}].[${3:CurrentMonth}])}',
        example: '',
      },
      {
        name: 'Lag',
        signature: 'member.Lag(n)',
        params: ['n — number of positions back'],
        description: 'The member N positions before the given member in the set.',
        template: '[${1:Period}].[${1:Period}].[${2:Member}].Lag(${3:1})',
        example: '',
      },
    ],
  },
  {
    category: 'Cross-Cube Filtering',
    fns: [
      {
        name: 'Filter by cube value',
        signature: 'FILTER(set, [Cube].(tuple) > threshold)',
        params: [
          'set — members to filter (usually leaf members)',
          'Cube — cube name that shares this dimension',
          'tuple — members for every other dimension in that cube',
          'threshold — numeric comparison, e.g. > 0, <> 0, >= 1000',
        ],
        description: 'Keep only members where a value in another cube meets a condition. TM1 implicitly uses CurrentMember for the filtered dimension.',
        template: '{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  [${2:CubeName}].([${3:Dim2}].[${3:Dim2}].[${4:Member}], [Measures].[${5:Amount}]) > ${6:0}\n)}',
        example: '',
      },
      {
        name: 'Cross-cube variance filter',
        signature: 'FILTER(set, [Cube1].(tuple) > [Cube2].(tuple) * factor)',
        params: [
          'set — members to filter',
          'Cube1 — actual/result cube',
          'Cube2 — budget/target cube',
          'factor — multiplier, e.g. 1.1 = exceeding budget by 10%',
        ],
        description: 'Filter members where a value in one cube exceeds a value in another cube by a factor — e.g. actuals beating budget by 10%.',
        template: '{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  [${2:ActualCube}].([${3:Dim2}].[${3:Dim2}].[${4:Actual}], [Measures].[${5:Amount}]) >\n  [${6:BudgetCube}].([${3:Dim2}].[${3:Dim2}].[${7:Budget}], [Measures].[${5:Amount}]) * ${8:1.1}\n)}',
        example: '',
      },
      {
        name: 'Dynamic threshold from lookup cube',
        signature: 'FILTER(set, [Cube].(tuple) > [LookupCube].(param))',
        params: [
          'set — members to filter',
          'Cube — data cube',
          'LookupCube — parameter/lookup cube holding the threshold value',
        ],
        description: 'Filter members using a threshold value stored in a parameter or lookup cube — keeps the threshold configurable without changing the subset.',
        template: '{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  [${2:DataCube}].([${3:Scenario}].CurrentMember, [Measures].[${4:Amount}]) >\n  [${5:LookupCube}].([${6:Param}].[${7:Threshold}], [Measures].[Value])\n)}',
        example: '',
      },
      {
        name: 'CurrentMember context filter',
        signature: 'FILTER(set, [Cube].([Dim].CurrentMember, ...) <> 0)',
        params: [
          'set — members to filter',
          'Cube — cube to evaluate',
          'CurrentMember dims — dimensions that use context from the active view/form',
        ],
        description: 'Filter using CurrentMember on other dimensions — the subset responds to the current context in a view or Active Form without hardcoding members.',
        template: '{FILTER(\n  {TM1SUBSETALL([${1:Account}])},\n  [${2:FinanceCube}].([${3:Company}].CurrentMember, [${4:Department}].CurrentMember,\n   [${1:Account}].CurrentMember, [Measures].[${5:Balance}]) <> 0\n)}',
        example: '',
      },
      {
        name: 'Flag/mapping cube filter',
        signature: 'FILTER(set, [MappingCube].([Dim].CurrentMember, [Flag]) = 1)',
        params: [
          'set — members to filter',
          'MappingCube — a cube containing 1/0 flags or mapping values',
          'Flag — the measure in the mapping cube',
        ],
        description: 'Use a flag or mapping cube to control which members are visible — centralises inclusion/exclusion logic in a cube rather than hardcoding in MDX.',
        template: '{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  [${2:MappingCube}].([${3:Company}].CurrentMember, [${1:Dim}].CurrentMember, [${4:FlagMeasure}]) = 1\n)}',
        example: '',
      },
      {
        name: 'Non-empty members',
        signature: 'FILTER(set, NOT ISEMPTY([Cube].(tuple)))',
        params: [
          'set — members to test',
          'Cube — cube to check for data',
          'tuple — members for every other cube dimension',
        ],
        description: 'Keep only members that have any data in a cube. Useful for pruning sparse dimensions.',
        template: '{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${1:Dim}])}, 0)},\n  NOT ISEMPTY([${2:CubeName}].([${3:Scenario}].[${3:Scenario}].[${4:Actual}], [Measures].[${5:Value}]))\n)}',
        example: '',
      },
    ],
  },
  {
    category: 'TM1 Extensions',
    fns: [
      {
        name: 'TM1MEMBER',
        signature: 'TM1MEMBER(dimension, memberName)',
        params: ['dimension — dimension name string', 'memberName — member name string'],
        description: 'Reference a member by name strings (useful for dynamic member references).',
        template: 'TM1MEMBER("${1:Dimension}", "${2:MemberName}")',
        example: '',
      },
      {
        name: 'TM1DRILLDOWNMEMBER',
        signature: 'TM1DRILLDOWNMEMBER(Set1, {Set2 | ALL} [, RECURSIVE])',
        params: [
          'Set1 — the member pool to reorder. Children of Set2 members are moved to appear directly after their parent in this set. The template uses {TM1SUBSETALL([Dim])} so all members are in scope — replace with a narrower set (e.g. top-level consolidations only) for a focused tree rather than the full membership.',
          'Set2 | ALL — the parent(s) to expand: wrap in braces {[Dim].[Dim].[Parent]}, or use ALL to expand every consolidation found in Set1.',
          'RECURSIVE (optional) — expand all descendants recursively, not just immediate children.',
        ],
        description: 'Reorders Set1 so children of Set2 members appear directly after their parent — the drill-expand effect. Does not add new members; Set1 is the complete pool.',
        template: '{TM1DRILLDOWNMEMBER({TM1SUBSETALL([${1:Dim}])}, {[${1:Dim}].[${1:Dim}].[${2:Parent}]})}',
        example: '{TM1DRILLDOWNMEMBER({TM1SUBSETALL([GBL Account])}, {[GBL Account].[GBL Account].[Revenue]}, RECURSIVE)}',
      },
    ],
  },
]

export const MDX_ADVANCED_PATTERNS = [
  {
    category: 'Advanced Patterns',
    patterns: [
      {
        name: 'All leaves',
        description: 'All leaf (N-level) members of a dimension using TM1SUBSETALL.',
        mdx: (dim) => `{TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)}`,
      },
      {
        name: 'All descendants of a parent',
        description: 'Every member that rolls up under a specific consolidation.',
        mdx: (dim) => `{DESCENDANTS([${dim}].[${dim}].[ParentMember])}`,
      },
      {
        name: 'Pattern match',
        description: 'Members whose names start with a specific prefix.',
        mdx: (dim) => `{TM1FILTERBYPATTERN({TM1SUBSETALL([${dim}])}, "A*")}`,
      },
      {
        name: 'Simple cube value filter',
        description: 'Leaf members where a cube value is greater than zero.',
        mdx: (dim) => `{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)},\n  [CubeName].([Scenario].[Actual], [Measures].[Amount]) > 0\n)}`,
      },
      {
        name: 'Cross-cube: actuals beating budget by 10%',
        description: 'Members where actuals exceed budget by more than 10% — compares values across two separate cubes.',
        mdx: (dim) => `{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)},\n  [SalesCube].([Version].[Actual], [Measures].[Sales]) >\n  [BudgetCube].([Version].[Budget], [Measures].[Sales]) * 1.1\n)}`,
      },
      {
        name: 'Dynamic threshold from lookup cube',
        description: 'Threshold value comes from a parameter/lookup cube — no hardcoding in the MDX.',
        mdx: (dim) => `{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)},\n  [GLCube].([Scenario].CurrentMember, [Measures].[Amount]) >\n  [LookupCube].([Param].[Threshold], [Measures].[Value])\n)}`,
      },
      {
        name: 'CurrentMember context (Active Forms / Views)',
        description: 'Subset responds to the current row/column context — other dimensions use CurrentMember so the result changes as the user navigates.',
        mdx: (dim) => `{FILTER(\n  {TM1SUBSETALL([${dim}])},\n  [FinanceCube].([Company].CurrentMember, [Department].CurrentMember,\n   [${dim}].CurrentMember, [Measures].[Balance]) <> 0\n)}`,
      },
      {
        name: 'Flag / mapping cube controls visibility',
        description: 'A 1/0 flag in a mapping cube determines which members appear — centralise inclusion logic without changing the subset.',
        mdx: (dim) => `{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)},\n  [MappingCube].([Company].CurrentMember, [${dim}].CurrentMember, [FlagMeasure]) = 1\n)}`,
      },
      {
        name: 'Top 20 by cube value',
        description: 'Top 20 leaf members ranked by a value in another cube.',
        mdx: (dim) => `{TOPCOUNT(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)},\n  20,\n  [SalesCube].([Actual], [Measures].[Revenue])\n)}`,
      },
      {
        name: 'Leaves with positive variance vs budget',
        description: 'Leaf members under a specific hierarchy node where actuals exceed budget.',
        mdx: (dim) => `{FILTER(\n  {TM1FILTERBYLEVEL(DESCENDANTS([${dim}].[${dim}].[TotalNode]), 0)},\n  [ActualCube].([Measures].[Amount]) -\n  [BudgetCube].([Measures].[Amount]) > 0\n)}`,
      },
      {
        name: 'Attribute + cube value combined',
        description: 'Filter by element attribute AND a cube value threshold — AND logic.',
        mdx: (dim) => `{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)},\n  [${dim}].CurrentMember.Properties("Category") = "Electronics" AND\n  [SalesCube].([Measures].[Qty]) > 1000\n)}`,
      },
      {
        name: 'Non-empty members',
        description: 'Leaf members that have any data in a cube — prunes sparse dimensions.',
        mdx: (dim) => `{FILTER(\n  {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)},\n  NOT ISEMPTY([GLCube].([Scenario].[Actual], [Measures].[Value]))\n)}`,
      },
    ],
  },
]

// Flat list for Monaco signature help and completions
export const MDX_FUNCTIONS_FLAT = MDX_CATALOG.flatMap(c => c.fns)

export const MDX_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'WITH', 'MEMBER', 'SET', 'AS',
  'ON', 'COLUMNS', 'ROWS', 'NON', 'EMPTY', 'NON EMPTY',
  'PROPERTIES', 'DIMENSION', 'CELL', 'CALCULATION',
  'ASC', 'DESC', 'BASC', 'BDESC', 'ALL', 'RECURSIVE',
  'NOT', 'AND', 'OR', 'NULL', 'SELF', 'ISEMPTY',
]

export const MDX_QUERY_PATTERNS = [
  {
    label: 'Simple SELECT',
    description: 'Two dimensions on columns and rows',
    code: `SELECT
  {TM1SUBSETALL([Dimension1])} ON COLUMNS,
  {TM1SUBSETALL([Dimension2])} ON ROWS
FROM [CubeName]`,
  },
  {
    label: 'Non Empty',
    description: 'Suppress rows and columns with no data',
    code: `SELECT
  NON EMPTY {TM1SUBSETALL([Dimension1])} ON COLUMNS,
  NON EMPTY {TM1SUBSETALL([Dimension2])} ON ROWS
FROM [CubeName]`,
  },
  {
    label: 'WHERE slice',
    description: 'Fix a dimension to a specific member',
    code: `SELECT
  NON EMPTY {TM1SUBSETALL([Dimension1])} ON COLUMNS,
  NON EMPTY {TM1SUBSETALL([Dimension2])} ON ROWS
FROM [CubeName]
WHERE ([Dimension3].[MemberName])`,
  },
  {
    label: 'Multiple WHERE',
    description: 'Fix multiple dimensions as a tuple',
    code: `SELECT
  NON EMPTY {TM1SUBSETALL([Dimension1])} ON COLUMNS,
  NON EMPTY {TM1SUBSETALL([Dimension2])} ON ROWS
FROM [CubeName]
WHERE ([Dimension3].[Member1], [Dimension4].[Member2])`,
  },
  {
    label: 'WITH MEMBER — ratio',
    description: 'Calculated percentage measure',
    code: `WITH MEMBER [Measures].[Variance %] AS
  IIf(
    [Measures].[Budget] = 0, NULL,
    ([Measures].[Actual] - [Measures].[Budget]) / [Measures].[Budget]
  ),
  FORMAT_STRING = '0.00%'
SELECT
  {[Measures].[Actual], [Measures].[Budget], [Measures].[Variance %]}
  ON COLUMNS,
  NON EMPTY {TM1SUBSETALL([DimensionName])} ON ROWS
FROM [CubeName]`,
  },
]
