export const MDX_REFERENCE = [
  {
    category: 'Basic Queries',
    items: [
      {
        label: 'Simple SELECT',
        description: 'Two dimensions on columns and rows',
        code: `SELECT
  {TM1SubsetAll([Dimension1])} ON COLUMNS,
  {TM1SubsetAll([Dimension2])} ON ROWS
FROM [CubeName]`,
      },
      {
        label: 'Non Empty',
        description: 'Suppress rows and columns with no data',
        code: `SELECT
  NON EMPTY {TM1SubsetAll([Dimension1])} ON COLUMNS,
  NON EMPTY {TM1SubsetAll([Dimension2])} ON ROWS
FROM [CubeName]`,
      },
      {
        label: 'WHERE slice',
        description: 'Fix a dimension to a specific member',
        code: `SELECT
  NON EMPTY {TM1SubsetAll([Dimension1])} ON COLUMNS,
  NON EMPTY {TM1SubsetAll([Dimension2])} ON ROWS
FROM [CubeName]
WHERE ([Dimension3].[MemberName])`,
      },
      {
        label: 'Multiple WHERE',
        description: 'Fix multiple dimensions as a tuple',
        code: `SELECT
  NON EMPTY {TM1SubsetAll([Dimension1])} ON COLUMNS,
  NON EMPTY {TM1SubsetAll([Dimension2])} ON ROWS
FROM [CubeName]
WHERE ([Dimension3].[Member1], [Dimension4].[Member2])`,
      },
      {
        label: 'Single axis (columns only)',
        description: 'Useful for testing set expressions',
        code: `SELECT
  {TM1SubsetAll([DimensionName])} ON COLUMNS
FROM [CubeName]`,
      },
    ],
  },
  {
    category: 'TM1 Functions',
    items: [
      {
        label: 'TM1SubsetAll',
        description: 'All members of a dimension',
        code: `{TM1SubsetAll([DimensionName])}`,
      },
      {
        label: 'TM1FilterByLevel',
        description: 'Leaf members only (level 0)',
        code: `{TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)}`,
      },
      {
        label: 'TM1FilterByPattern',
        description: 'Members matching a wildcard pattern',
        code: `{TM1FilterByPattern({TM1SubsetAll([DimensionName])}, "*pattern*")}`,
      },
      {
        label: 'TM1SortMembers ascending',
        description: 'Members sorted A–Z',
        code: `{TM1SortMembers({TM1SubsetAll([DimensionName])}, ASC)}`,
      },
      {
        label: 'TM1SortMembers by value',
        description: 'Members sorted by a measure, descending',
        code: `{TM1SortMembers(
  {TM1SubsetAll([DimensionName])},
  BDESC,
  [Measures].[Value]
)}`,
      },
      {
        label: 'TM1SubsetToSet',
        description: 'Use a saved named subset',
        code: `{TM1SubsetToSet([DimensionName], "SubsetName")}`,
      },
      {
        label: 'TM1DrillDownMember',
        description: 'Expand children of a member',
        code: `{TM1DrillDownMember({[DimensionName].[ParentMember]}, ALL)}`,
      },
    ],
  },
  {
    category: 'Filter & Sort',
    items: [
      {
        label: 'Filter by value',
        description: 'Members where a measure exceeds a threshold',
        code: `{Filter(
  {TM1SubsetAll([DimensionName])},
  ([DimensionName].CurrentMember, [Measures].[Value]) > 0
)}`,
      },
      {
        label: 'Filter — non-empty members',
        description: 'Exclude members with no data for a measure',
        code: `{Filter(
  {TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)},
  NOT IsEmpty(([DimensionName].CurrentMember, [Measures].[Value]))
)}`,
      },
      {
        label: 'TopCount',
        description: 'Top N members by measure value',
        code: `{TopCount(
  {TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)},
  10,
  ([Measures].[Value])
)}`,
      },
      {
        label: 'BottomCount',
        description: 'Bottom N members by measure value',
        code: `{BottomCount(
  {TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)},
  10,
  ([Measures].[Value])
)}`,
      },
      {
        label: 'Order (value descending)',
        description: 'Sort members by measure, break hierarchy',
        code: `{Order(
  {TM1SubsetAll([DimensionName])},
  ([Measures].[Value]),
  BDESC
)}`,
      },
    ],
  },
  {
    category: 'CrossJoin',
    items: [
      {
        label: 'CrossJoin two dimensions',
        description: 'Combine two dimensions on one axis',
        code: `{CrossJoin(
  {TM1SubsetAll([Dimension1])},
  {TM1SubsetAll([Dimension2])}
)}`,
      },
      {
        label: 'CrossJoin three dimensions',
        description: 'Nested CrossJoin for three dimensions',
        code: `{CrossJoin(
  {TM1SubsetAll([Dimension1])},
  CrossJoin(
    {TM1SubsetAll([Dimension2])},
    {TM1SubsetAll([Dimension3])}
  )
)}`,
      },
      {
        label: 'CrossJoin with filter',
        description: 'Combine dimensions then suppress empties',
        code: `{NonEmpty(
  CrossJoin(
    {TM1SubsetAll([Dimension1])},
    {TM1SubsetAll([Dimension2])}
  ),
  {[Measures].[Value]}
)}`,
      },
    ],
  },
  {
    category: 'Calculated Members',
    items: [
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
  NON EMPTY {TM1SubsetAll([DimensionName])} ON ROWS
FROM [CubeName]`,
      },
      {
        label: 'WITH MEMBER — IIf label',
        description: 'Calculated string member for status',
        code: `WITH MEMBER [Measures].[Status] AS
  IIf(
    [Measures].[Actual] >= [Measures].[Budget],
    "On Track", "Behind"
  )
SELECT
  {[Measures].[Actual], [Measures].[Budget], [Measures].[Status]}
  ON COLUMNS,
  NON EMPTY {TM1SubsetAll([DimensionName])} ON ROWS
FROM [CubeName]`,
      },
      {
        label: 'WITH SET',
        description: 'Named set for reuse within the query',
        code: `WITH SET [ActiveMembers] AS
  Filter(
    {TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)},
    [Measures].[Value] > 0
  )
SELECT
  {[Measures].[Value]} ON COLUMNS,
  [ActiveMembers] ON ROWS
FROM [CubeName]`,
      },
    ],
  },
  {
    category: 'Complex Patterns',
    items: [
      {
        label: 'Top 10 non-empty leaf members',
        description: 'Filtered, leaf-level, top by value',
        code: `SELECT
  NON EMPTY {[Measures].[Value]} ON COLUMNS,
  NON EMPTY {
    TopCount(
      {TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)},
      10,
      [Measures].[Value]
    )
  } ON ROWS
FROM [CubeName]`,
      },
      {
        label: 'Period-to-date (YTD)',
        description: 'Accumulate a measure from start of year to current period',
        code: `WITH MEMBER [Measures].[YTD Value] AS
  Sum(
    PeriodsToDate([Time].[Year], [Time].CurrentMember),
    [Measures].[Value]
  )
SELECT
  {[Measures].[Value], [Measures].[YTD Value]} ON COLUMNS,
  {TM1FilterByLevel({TM1SubsetAll([Time])}, 0)} ON ROWS
FROM [CubeName]`,
      },
      {
        label: 'Variance with conditional colour',
        description: 'Actual vs budget with favourable/unfavourable flag',
        code: `WITH
  MEMBER [Measures].[Variance] AS
    [Measures].[Actual] - [Measures].[Budget]
  MEMBER [Measures].[Variance %] AS
    IIf([Measures].[Budget] = 0, NULL,
      [Measures].[Variance] / [Measures].[Budget]),
    FORMAT_STRING = '0.0%'
  MEMBER [Measures].[Flag] AS
    IIf([Measures].[Variance] >= 0, "F", "U")
SELECT
  {[Measures].[Actual],[Measures].[Budget],
   [Measures].[Variance],[Measures].[Variance %],[Measures].[Flag]}
  ON COLUMNS,
  NON EMPTY {TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)} ON ROWS
FROM [CubeName]`,
      },
      {
        label: 'Filter by string attribute',
        description: 'Members where an attribute equals a value',
        code: `{Filter(
  {TM1FilterByLevel({TM1SubsetAll([DimensionName])}, 0)},
  [DimensionName].[DimensionName].[AttributeName] = "AttributeValue"
)}`,
      },
      {
        label: 'Parent–child with rollup',
        description: 'Show a parent member alongside its leaf children',
        code: `{
  [DimensionName].[ParentMember],
  Descendants(
    [DimensionName].[ParentMember],
    [DimensionName].[LeafLevel],
    SELF
  )
}`,
      },
    ],
  },
]

export const MDX_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'WITH', 'MEMBER', 'SET', 'AS',
  'ON', 'COLUMNS', 'ROWS', 'NON', 'EMPTY', 'NON EMPTY',
  'PROPERTIES', 'DIMENSION', 'CELL', 'CALCULATION',
  'ASC', 'DESC', 'BASC', 'BDESC', 'ALL',
]

export const MDX_FUNCTIONS = [
  { label: 'TM1SubsetAll',      insert: 'TM1SubsetAll([${1:DimensionName}])',                                    doc: 'All members of a dimension' },
  { label: 'TM1FilterByLevel',  insert: 'TM1FilterByLevel({${1:set}}, ${2:0})',                                  doc: 'Filter by hierarchy level (0=leaf)' },
  { label: 'TM1FilterByPattern',insert: 'TM1FilterByPattern({${1:set}}, "${2:pattern*}")',                       doc: 'Filter members by wildcard pattern' },
  { label: 'TM1SortMembers',    insert: 'TM1SortMembers({${1:set}}, ${2:ASC})',                                  doc: 'Sort members ascending or descending' },
  { label: 'TM1SubsetToSet',    insert: 'TM1SubsetToSet([${1:DimensionName}], "${2:SubsetName}")',               doc: 'Use a saved named subset' },
  { label: 'CrossJoin',         insert: 'CrossJoin(\n  {${1:set1}},\n  {${2:set2}}\n)',                          doc: 'Combine two sets into tuples' },
  { label: 'Filter',            insert: 'Filter(\n  {${1:set}},\n  ${2:condition}\n)',                           doc: 'Filter a set by a condition' },
  { label: 'TopCount',          insert: 'TopCount(\n  {${1:set}},\n  ${2:10},\n  ${3:measure}\n)',               doc: 'Top N members by a measure value' },
  { label: 'BottomCount',       insert: 'BottomCount(\n  {${1:set}},\n  ${2:10},\n  ${3:measure}\n)',            doc: 'Bottom N members by a measure value' },
  { label: 'Order',             insert: 'Order({${1:set}}, ${2:measure}, BDESC)',                                 doc: 'Sort a set by a value expression' },
  { label: 'Descendants',       insert: 'Descendants(${1:member}, ${2:level}, SELF)',                            doc: 'Descendants of a member at a level' },
  { label: 'Ancestors',         insert: 'Ancestors(${1:member}, ${2:level})',                                    doc: 'Ancestors of a member at a level' },
  { label: 'PeriodsToDate',     insert: 'PeriodsToDate([${1:Dimension}].[${2:Level}], ${3:member})',             doc: 'Members from period start to current' },
  { label: 'Sum',               insert: 'Sum(${1:set}, ${2:measure})',                                           doc: 'Sum a measure over a set' },
  { label: 'Avg',               insert: 'Avg(${1:set}, ${2:measure})',                                           doc: 'Average a measure over a set' },
  { label: 'Count',             insert: 'Count({${1:set}}, ${2:INCLUDEEMPTY})',                                  doc: 'Count members in a set' },
  { label: 'NonEmpty',          insert: 'NonEmpty(\n  {${1:set}},\n  {${2:measure}}\n)',                         doc: 'Remove empty cells from a set' },
  { label: 'Hierarchize',       insert: 'Hierarchize({${1:set}})',                                               doc: 'Sort members into hierarchy order' },
  { label: 'Distinct',          insert: 'Distinct({${1:set}})',                                                  doc: 'Remove duplicate members from a set' },
  { label: 'Union',             insert: 'Union({${1:set1}}, {${2:set2}})',                                       doc: 'Combine two sets (removes duplicates)' },
  { label: 'Intersect',         insert: 'Intersect({${1:set1}}, {${2:set2}})',                                   doc: 'Members present in both sets' },
  { label: 'Except',            insert: 'Except({${1:set1}}, {${2:set2}})',                                      doc: 'Remove set2 members from set1' },
  { label: 'IIf',               insert: 'IIf(${1:condition}, ${2:trueValue}, ${3:falseValue})',                  doc: 'Conditional expression' },
  { label: 'IsEmpty',           insert: 'IsEmpty(${1:expression})',                                              doc: 'True if expression is empty' },
  { label: 'CoalesceEmpty',     insert: 'CoalesceEmpty(${1:expression}, ${2:default})',                          doc: 'Return default if expression is empty' },
  { label: 'Generate',          insert: 'Generate({${1:set}}, ${2:expression})',                                 doc: 'Apply an expression over each member' },
  { label: 'Extract',           insert: 'Extract({${1:crossjoinSet}}, [${2:Dimension}])',                        doc: 'Extract one dimension from a crossjoin' },
]
