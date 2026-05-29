/**
 * TM1 MDX Patterns — Foundation from the classic "Creating Dynamic Subsets in Applix TM1 with MDX - A Primer"
 * by Philip Bichard (with additional material by Martin Findon).
 *
 * Source: https://www.bihints.com/book/export/html/68
 * This catalog is heavily inspired by that work and modernized for the Subset MDX Builder.
 *
 * Improvements added:
 * - Better structure and searchability
 * - Dimension-parameterized templates
 * - Modern TM1/Planning Analytics friendly examples
 * - Combination with existing function catalog
 */

export const MDX_PRIMER_CATEGORIES = [
  {
    category: 'Basics (Primer Foundation)',
    description: 'Core building blocks from the original MDX Primer.',
    patterns: [
      {
        id: 'primer-tm1subsetall',
        name: 'TM1SubsetAll (All Members)',
        description: 'Returns (almost) the entire dimension. The foundation for most dynamic subsets. Preferred over .Members in TM1.',
        mdx: (dim) => `TM1SUBSETALL([${dim}])`,
        example: 'Use as the base for almost every dynamic subset.',
        source: 'MDX Primer § TM1SubsetAll, Members, member range'
      },
      {
        id: 'primer-members',
        name: 'All Members (.Members)',
        description: 'Returns all members of the hierarchy (including consolidated).',
        mdx: (dim) => `{[${dim}].[${dim}].Members}`,
        example: 'When you explicitly want every member.',
        source: 'MDX Primer'
      },
      {
        id: 'primer-children',
        name: 'Children of a Member',
        description: 'Direct children of a specific consolidated member.',
        mdx: (dim) => `{[${dim}].[${dim}].[ParentMember].Children}`,
        example: 'All direct children under a parent.',
        source: 'MDX Primer'
      },
    ]
  },
  {
    category: 'Filtering (Core of Dynamic Subsets)',
    description: 'The most powerful technique from the Primer — filtering sets based on data or attributes.',
    patterns: [
      {
        id: 'primer-filter-level',
        name: 'Filter by Level (Leaves / N-Level)',
        description: 'Keep only members at a specific level. Level 0 = leaves (numeric). This is one of the most used patterns in the Primer.',
        mdx: (dim) => `{TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)}`,
        example: 'All base-level (leaf) elements only.',
        source: 'MDX Primer § TM1FILTERBYLEVEL'
      },
      {
        id: 'primer-filter-pattern',
        name: 'Filter by Pattern (Wildcards)',
        description: 'Filter members whose names match a wildcard pattern (* works).',
        mdx: (dim) => `{TM1FILTERBYPATTERN({TM1SUBSETALL([${dim}])}, "A*")}`,
        example: 'All members starting with A.',
        source: 'MDX Primer § TM1FILTERBYPATTERN'
      },
      {
        id: 'primer-filter-cube-value',
        name: 'Filter by Cube Value (Data-Driven)',
        description: 'The classic Primer power move: keep only members that have data (or meet a condition) in a cube. Extremely useful for dynamic "has data" subsets.',
        mdx: (dim) => `FILTER({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)}, [YourCube].([${dim}].[${dim}].CurrentMember, [Measures].[Amount]) > 0)`,
        example: 'All products that have sales > 0 this period.',
        source: 'MDX Primer § FILTER + cube values (highly recommended)'
      },
      {
        id: 'primer-filter-attribute',
        name: 'Filter by Attribute Value',
        description: 'Filter using an attribute (very common in real models).',
        mdx: (dim) => `FILTER({TM1SUBSETALL([${dim}])}, [${dim}].[${dim}].CurrentMember.Properties("AttributeName") = "SomeValue")`,
        example: 'All customers where Region = "North America".',
        source: 'MDX Primer + common extension'
      },
    ]
  },
  {
    category: 'Ranking & Top/Bottom (Primer Favorites)',
    description: 'Top N / Bottom N patterns, heavily featured in the Primer.',
    patterns: [
      {
        id: 'primer-topcount',
        name: 'TopCount by Cube Value',
        description: 'Return the top N members ranked by a numeric value in a cube. One of the most practical patterns from the Primer.',
        mdx: (dim) => `TOPCOUNT({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)}, 10, [YourCube].([${dim}].[${dim}].CurrentMember, [Measures].[Sales]))`,
        example: 'Top 10 customers by revenue.',
        source: 'MDX Primer § TOPCOUNT'
      },
      {
        id: 'primer-bottomcount',
        name: 'BottomCount',
        description: 'The opposite of TopCount.',
        mdx: (dim) => `BOTTOMCOUNT({TM1FILTERBYLEVEL({TM1SUBSETALL([${dim}])}, 0)}, 5, [YourCube].([${dim}].[${dim}].CurrentMember, [Measures].[Margin]))`,
        example: 'Bottom 5 products by margin.',
        source: 'MDX Primer'
      },
    ]
  },
  {
    category: 'Time & Period Patterns',
    description: 'Common time intelligence patterns (Primer covers some; we extend with modern best practices).',
    patterns: [
      {
        id: 'primer-periodstodate',
        name: 'PeriodsToDate (YTD / QTD / MTD)',
        description: 'All periods from the start of a higher level to the current member.',
        mdx: (dim) => `PeriodsToDate([${dim}].[${dim}].[Year], [${dim}].[${dim}].[CurrentPeriod])`,
        example: 'Year-to-date periods.',
        source: 'MDX Primer + common TM1 extension'
      },
    ]
  }
];

/**
 * Flattened list for easy searching.
 */
export const MDX_PRIMER_PATTERNS_FLAT = MDX_PRIMER_CATEGORIES.flatMap(cat =>
  cat.patterns.map(p => ({ ...p, category: cat.category }))
);

export default {
  categories: MDX_PRIMER_CATEGORIES,
  flat: MDX_PRIMER_PATTERNS_FLAT,
};