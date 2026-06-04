/**
 * TM1 / Planning Analytics MDX Pattern Library
 * Cross-cube references use [CubeName].(member, member) tuple syntax — not CUBEVALUE (Rules/Excel only).
 * Current user is USERNAME in MDX context — not TM1USER() (Excel only).
 */

export const MDX_PATTERN_CATEGORIES = [
  {
    category: 'Basics',
    description: 'Core set expressions — the foundation of every subset.',
    patterns: [
      {
        id: 'all-members',
        name: 'All Members (TM1SUBSETALL)',
        description: 'Returns all members of the dimension. Preferred over .Members in TM1 — faster and respects security.',
        mdx: (dim) => `{TM1SUBSETALL([${dim}].[${dim}])}`,
        example: 'Base for almost every dynamic subset.',
      },
      {
        id: 'hierarchy-members',
        name: 'All Members (.Members)',
        description: 'All members via MDX hierarchy navigation. Includes consolidated members.',
        mdx: (dim) => `{[${dim}].[${dim}].Members}`,
        example: 'When you need every member including consolidations.',
      },
      {
        id: 'single-member',
        name: 'Single Member',
        description: 'A specific named member.',
        mdx: (dim) => `{[${dim}].[${dim}].[MemberName]}`,
        example: 'Pin one element on an axis.',
      },
      {
        id: 'member-range',
        name: 'Member Range',
        description: 'All members between two named members (inclusive), in dimension order.',
        mdx: (dim) => `{[${dim}].[${dim}].[FirstMember]:[${dim}].[${dim}].[LastMember]}`,
        example: 'Jan through Dec.',
      },
      {
        id: 'named-subset',
        name: 'Named Subset',
        description: 'Reference a saved named subset. The subset must exist on the server.',
        mdx: (dim) => `TM1SubsetToSet([${dim}].[${dim}], "SubsetName")`,
        example: 'Reuse a maintained subset without re-specifying the expression.',
      },
    ]
  },
  {
    category: 'Filtering',
    description: 'Restrict members by level, pattern, attribute, or cube value.',
    patterns: [
      {
        id: 'filter-leaves',
        name: 'Leaf Members Only',
        description: 'Level 0 only — excludes all consolidations. Most FILTER and TOPCOUNT patterns should start here.',
        mdx: (dim) => `{TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}`,
        example: 'All base-level elements only.',
      },
      {
        id: 'filter-consolidations',
        name: 'Consolidations Only',
        description: 'Excludes leaf members — keeps only rolled-up elements.',
        mdx: (dim) => `FILTER({TM1SUBSETALL([${dim}].[${dim}])}, [${dim}].[${dim}].CURRENTMEMBER.LEVEL.ORDINAL > 0)`,
        example: 'All parent nodes — useful for region or hierarchy pickers.',
      },
      {
        id: 'filter-pattern',
        name: 'Filter by Name Pattern',
        description: 'Keep members whose names match a wildcard. * matches any characters, ? matches one character.',
        mdx: (dim) => `{TM1FILTERBYPATTERN({TM1SUBSETALL([${dim}].[${dim}])}, "A*")}`,
        example: 'All members starting with A.',
      },
      {
        id: 'filter-attribute',
        name: 'Filter by Attribute',
        description: 'Keep members where an attribute equals a value. Use ELEMENTATTR for TM1 string attributes.',
        mdx: (dim) => `FILTER({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, ELEMENTATTR("[${dim}]", [${dim}].[${dim}].CURRENTMEMBER.NAME, "AttributeName") = "Value")`,
        example: 'All customers where Country = "NZ".',
      },
      {
        id: 'filter-cubevalue',
        name: 'Filter by Cube Value (Data-Driven)',
        description: 'Keep members where a cell in a cube meets a condition. Replace YourCube, YourMeasuresDim, and YourMeasure with real names.',
        mdx: (dim) => `FILTER({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, [YourCube].([${dim}].[${dim}].CURRENTMEMBER, [YourMeasuresDim].[YourMeasuresDim].[YourMeasure]) > 0)`,
        example: 'All products that have sales > 0.',
      },
      {
        id: 'filter-nonempty',
        name: 'Filter Non-Empty',
        description: 'Keep members that have any value in a cube (any measure, not empty).',
        mdx: (dim) => `FILTER({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, NOT ISEMPTY([YourCube].([${dim}].[${dim}].CURRENTMEMBER, [YourMeasuresDim].[YourMeasuresDim].[YourMeasure])))`,
        example: 'All members with any data — ignore blanks.',
      },
    ]
  },
  {
    category: 'Ranking',
    description: 'Top N, Bottom N, and percent-based ranking.',
    patterns: [
      {
        id: 'topcount',
        name: 'Top N by Cube Value',
        description: 'The N members with the highest value in a cube.',
        mdx: (dim) => `TOPCOUNT({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, 10, [YourCube].([${dim}].[${dim}].CURRENTMEMBER, [YourMeasuresDim].[YourMeasuresDim].[YourMeasure]))`,
        example: 'Top 10 customers by revenue.',
      },
      {
        id: 'bottomcount',
        name: 'Bottom N by Cube Value',
        description: 'The N members with the lowest value.',
        mdx: (dim) => `BOTTOMCOUNT({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, 5, [YourCube].([${dim}].[${dim}].CURRENTMEMBER, [YourMeasuresDim].[YourMeasuresDim].[YourMeasure]))`,
        example: 'Bottom 5 products by margin.',
      },
      {
        id: 'toppercent',
        name: 'Top Percent',
        description: 'Members that together account for the top X% of the total.',
        mdx: (dim) => `TOPPERCENT({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, 80, [YourCube].([${dim}].[${dim}].CURRENTMEMBER, [YourMeasuresDim].[YourMeasuresDim].[YourMeasure]))`,
        example: 'The customers that make up 80% of revenue (Pareto).',
      },
      {
        id: 'bottomsum',
        name: 'Bottom Sum',
        description: 'Members whose cumulative value from the bottom reaches the target sum.',
        mdx: (dim) => `BOTTOMSUM({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, 1000, [YourCube].([${dim}].[${dim}].CURRENTMEMBER, [YourMeasuresDim].[YourMeasuresDim].[YourMeasure]))`,
        example: 'Products whose total loss reaches 1000.',
      },
    ]
  },
  {
    category: 'Sorting',
    description: 'Order members by name or cube value.',
    patterns: [
      {
        id: 'sort-asc',
        name: 'Sort Ascending (Name)',
        description: 'Alphabetical ascending by member name.',
        mdx: (dim) => `{TM1SORT({TM1SUBSETALL([${dim}].[${dim}])}, ASC)}`,
        example: 'A → Z.',
      },
      {
        id: 'sort-desc',
        name: 'Sort Descending (Name)',
        description: 'Alphabetical descending by member name.',
        mdx: (dim) => `{TM1SORT({TM1SUBSETALL([${dim}].[${dim}])}, DESC)}`,
        example: 'Z → A.',
      },
      {
        id: 'order-by-value',
        name: 'Order by Cube Value',
        description: 'Sort members by a numeric value in a cube. BDESC = descending, keeping hierarchy; DESC = flat descending.',
        mdx: (dim) => `ORDER({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, [YourCube].([${dim}].[${dim}].CURRENTMEMBER, [YourMeasuresDim].[YourMeasuresDim].[YourMeasure]), BDESC)`,
        example: 'Members sorted highest to lowest by value.',
      },
    ]
  },
  {
    category: 'Set Operations',
    description: 'Combine, intersect, or subtract sets.',
    patterns: [
      {
        id: 'union',
        name: 'Union',
        description: 'All members from both sets, duplicates removed.',
        mdx: (dim) => `UNION({[${dim}].[${dim}].[MemberA]}, {[${dim}].[${dim}].[MemberB]})`,
        example: 'Merge two selections.',
      },
      {
        id: 'intersect',
        name: 'Intersect',
        description: 'Only members that appear in both sets.',
        mdx: (dim) => `INTERSECT({TM1SubsetToSet([${dim}].[${dim}], "SetA")}, {TM1SubsetToSet([${dim}].[${dim}], "SetB")})`,
        example: 'Members in both the Active subset and the Budget subset.',
      },
      {
        id: 'except',
        name: 'Except (Exclude)',
        description: 'All members from the first set that are not in the second.',
        mdx: (dim) => `EXCEPT({TM1SUBSETALL([${dim}].[${dim}])}, {[${dim}].[${dim}].[ExcludedMember]})`,
        example: 'All members except one.',
      },
    ]
  },
  {
    category: 'Hierarchy Navigation',
    description: 'Navigate parent/child relationships.',
    patterns: [
      {
        id: 'children',
        name: 'Children of a Member',
        description: 'Direct children of a consolidated member.',
        mdx: (dim) => `{[${dim}].[${dim}].[ParentMember].Children}`,
        example: 'All months under Q1.',
      },
      {
        id: 'siblings',
        name: 'Siblings',
        description: 'All members at the same level under the same parent.',
        mdx: (dim) => `{[${dim}].[${dim}].[Member].Siblings}`,
        example: 'All quarters at the same level as Q2.',
      },
      {
        id: 'descendants',
        name: 'Descendants to Level',
        description: 'All descendants of a member down to a specific level.',
        mdx: (dim) => `DESCENDANTS([${dim}].[${dim}].[TopMember], [${dim}].[${dim}].[LevelName])`,
        example: 'All regions under EMEA at the country level.',
      },
      {
        id: 'drilldown',
        name: 'Drill Down Member',
        description: 'Expand a set by replacing a member with its children.',
        mdx: (dim) => `DRILLDOWNMEMBER({TM1SUBSETALL([${dim}].[${dim}])}, [${dim}].[${dim}].[ParentMember])`,
        example: 'Expand one node while keeping the rest.',
      },
    ]
  },
  {
    category: 'Time Patterns',
    description: 'Period-based patterns for time dimensions.',
    patterns: [
      {
        id: 'periodstodate',
        name: 'Periods to Date (YTD / QTD)',
        description: 'All periods from the start of an ancestor level down to the current member. First arg is the ancestor level, second is the current member.',
        mdx: (dim) => `PeriodsToDate([${dim}].[${dim}].[Year], [${dim}].[${dim}].CURRENTMEMBER)`,
        example: 'YTD months when current member is a month.',
      },
      {
        id: 'lastperiods',
        name: 'Last N Periods',
        description: 'The N periods ending at a specified member, in order.',
        mdx: (dim) => `LastPeriods(12, [${dim}].[${dim}].[CurrentMonth])`,
        example: 'Rolling last 12 months.',
      },
      {
        id: 'parallelperiod',
        name: 'Parallel Period (Prior Year)',
        description: 'The member at the same relative position in a prior period.',
        mdx: (dim) => `{ParallelPeriod([${dim}].[${dim}].[Year], 1, [${dim}].[${dim}].CURRENTMEMBER)}`,
        example: 'Same month last year.',
      },
    ]
  },
  {
    category: 'User-Scoped',
    description: 'Patterns that filter based on the current TM1 user. USERNAME is the MDX variable for the current user in REST API context. Cross-cube reads use [Cube].(tuple) syntax.',
    patterns: [
      {
        id: 'user-string-match',
        name: 'User Input Parameter (single member)',
        description: 'Returns the member whose name matches the value the current user has stored in a parameter cube. Replace CubeName, MeasureName, and ElementName with your actual names.',
        mdx: (dim) => `{TM1Member(STRTOMEMBER("[${dim}].[${dim}].[" + [CubeName].(STRTOMEMBER("[}Clients].[}Clients].[" + USERNAME + "]"), [MeasureName].[MeasureName].[ElementName]) + "]"), 0)}`,
        example: 'Returns user input parameters.',
      },
      {
        id: 'user-numeric-filter',
        name: 'Filter by User\'s Stored Numeric Flag',
        description: 'Keep members where the current user has a non-zero numeric value in a cube — classic user-input selection pattern.',
        mdx: (dim) => `{FILTER({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)}, [UserInputCube].(STRTOMEMBER("[}Clients].[}Clients].[" + USERNAME + "]"), [${dim}].[${dim}].CURRENTMEMBER, [UserInputMeasure].[UserInputMeasure].[Value]) <> 0)}`,
        example: 'User has ticked members in an input cube — only ticked members pass the filter.',
      },
      {
        id: 'user-group-member',
        name: 'Filter if User Belongs to a Group',
        description: 'Keep all members if the current user is a member of a specific }Group (e.g. Admins). Uses ELEMENTCOMPONENTOF to test group membership.',
        mdx: (dim) => `IIF(ELEMENTCOMPONENTOF("}GroupName", USERNAME, 1) = 1, {TM1SUBSETALL([${dim}].[${dim}])}, {TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}].[${dim}])}, 0)})`,
        example: 'Admins see all members; regular users see leaves only.',
      },
    ]
  },
]

export const MDX_PRIMER_PATTERNS_FLAT = MDX_PATTERN_CATEGORIES.flatMap(cat =>
  cat.patterns.map(p => ({ ...p, category: cat.category }))
)

export default {
  categories: MDX_PATTERN_CATEGORIES,
  flat: MDX_PRIMER_PATTERNS_FLAT,
}
