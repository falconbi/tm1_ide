// TM1 function catalog and Monaco autocomplete registration
import { formatRules } from '@/lib/formatters/rules-formatter.js'
import { loadSettings } from '@/lib/formatters/settings.js'
import { getNamingMap } from '@/lib/formatters/naming.js'
import { registerTM1Snippets } from '@/lib/tm1-snippets.js'

// ── TM1 Function Catalog ──────────────────────────────────────────────────────
// Each entry: description, params[], returns, variadic, language
// language: 'rules' | 'ti' | 'both'

const TM1_FUNCTIONS = {

  // ── Rules: Cube reads ────────────────────────────────────────────────────────
  DB: {
    description: 'Returns a numeric value from a cube cell.',
    params: [
      { name: 'cube',     type: 'String',  description: 'Name of the cube' },
      { name: 'element1', type: 'String',  description: 'Element for dimension 1' },
      { name: 'element2', type: 'String',  description: 'Element for dimension 2' },
      { name: '...',      type: 'String',  description: 'Elements for remaining dimensions' },
    ],
    returns: 'Numeric', variadic: true, language: 'rules',
  },
  DBS: {
    description: 'Returns a string value from a cube cell.',
    params: [
      { name: 'cube',     type: 'String', description: 'Name of the cube' },
      { name: 'element1', type: 'String', description: 'Element for dimension 1' },
      { name: '...',      type: 'String', description: 'Elements for remaining dimensions' },
    ],
    returns: 'String', variadic: true, language: 'rules',
  },

  // ── Rules: Attributes ────────────────────────────────────────────────────────
  ATTRS: {
    description: 'Returns a string attribute value for a dimension element.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
      { name: 'attribute', type: 'String', description: 'Attribute name' },
    ],
    returns: 'String', language: 'rules',
  },
  ATTRN: {
    description: 'Returns a numeric attribute value for a dimension element.',
    params: [
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'element',   type: 'String',  description: 'Element name' },
      { name: 'attribute', type: 'String',  description: 'Attribute name' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  ATTRL: {
    description: 'Returns a long string attribute value for a dimension element.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
      { name: 'attribute', type: 'String', description: 'Attribute name' },
    ],
    returns: 'String', language: 'rules',
  },

  // ── Rules: Control ───────────────────────────────────────────────────────────
  STET: {
    description: 'Instructs TM1 to use the existing stored value — no calculation applied.',
    params: [], returns: 'Void', language: 'rules',
  },
  CONTINUE: {
    description: 'Skips to the next feeder — used in conditional feeder logic.',
    params: [], returns: 'Void', language: 'rules',
  },

  // ── Rules: Element / Dimension queries ───────────────────────────────────────
  DIMIX: {
    description: 'Returns the index (1-based) of an element in a dimension.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  DIMSIZ: {
    description: 'Returns the number of elements in a dimension.',
    params: [{ name: 'dimension', type: 'String', description: 'Dimension name' }],
    returns: 'Numeric', language: 'rules',
  },
  DTYPE: {
    description: "Returns the element type: 'N' (numeric), 'C' (consolidated), or 'S' (string).",
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
    ],
    returns: 'String', language: 'rules',
  },
  ELLEV: {
    description: 'Returns the level of an element (0 = leaf, higher = more consolidated).',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  ELPAR: {
    description: 'Returns the name of the nth parent of an element.',
    params: [
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'element',   type: 'String',  description: 'Element name' },
      { name: 'n',         type: 'Numeric', description: 'Parent index (1-based)' },
    ],
    returns: 'String', language: 'rules',
  },
  ELPARN: {
    description: 'Returns the number of parents of an element.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  ELCOMP: {
    description: 'Returns the name of the nth direct component of a consolidated element.',
    params: [
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'element',   type: 'String',  description: 'Consolidated element name' },
      { name: 'n',         type: 'Numeric', description: 'Component index (1-based)' },
    ],
    returns: 'String', language: 'rules',
  },
  ELCOMPN: {
    description: 'Returns the number of direct components of a consolidated element.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Consolidated element name' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  ELISANC: {
    description: 'Returns 1 if ancestor is an ancestor of element, 0 otherwise.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element to test' },
      { name: 'ancestor',  type: 'String', description: 'Potential ancestor element' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  ELISPAR: {
    description: 'Returns 1 if parent is a direct parent of element, 0 otherwise.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element to test' },
      { name: 'parent',    type: 'String', description: 'Potential parent element' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  ELWEIGHT: {
    description: 'Returns the consolidation weight of an element under a parent.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'parent',    type: 'String', description: 'Parent element' },
      { name: 'element',   type: 'String', description: 'Child element' },
    ],
    returns: 'Numeric', language: 'rules',
  },
  TABDIM: {
    description: 'Returns the name of the nth dimension of a cube (1-based).',
    params: [
      { name: 'cube', type: 'String',  description: 'Cube name' },
      { name: 'n',    type: 'Numeric', description: 'Dimension index (1-based)' },
    ],
    returns: 'String', language: 'rules',
  },

  // ── Both: Conditional / String extras ────────────────────────────────────────
  IF: {
    description: 'Returns true_value if condition is non-zero, otherwise false_value.',
    params: [
      { name: 'condition',   type: 'Numeric', description: 'Condition to evaluate (0 = false)' },
      { name: 'true_value',  type: 'Any',     description: 'Value returned when true' },
      { name: 'false_value', type: 'Any',     description: 'Value returned when false' },
    ],
    returns: 'Any', language: 'both',
  },
  DELET: {
    description: 'Deletes characters from a string.',
    params: [
      { name: 'string', type: 'String',  description: 'Input string' },
      { name: 'start',  type: 'Numeric', description: 'Start position (1-based)' },
      { name: 'length', type: 'Numeric', description: 'Number of characters to delete' },
    ],
    returns: 'String', language: 'both',
  },
  INSRT: {
    description: 'Inserts a string into another string at a given position.',
    params: [
      { name: 'insert',   type: 'String',  description: 'String to insert' },
      { name: 'string',   type: 'String',  description: 'Target string' },
      { name: 'position', type: 'Numeric', description: 'Insert position (1-based)' },
    ],
    returns: 'String', language: 'both',
  },
  CAPIT: {
    description: 'Capitalises the first letter of each word in a string.',
    params: [{ name: 'string', type: 'String', description: 'Input string' }],
    returns: 'String', language: 'both',
  },
  SCANR: {
    description: 'Returns the position of a string within another, searching from right (0 if not found).',
    params: [
      { name: 'find',   type: 'String', description: 'String to search for' },
      { name: 'within', type: 'String', description: 'String to search within' },
    ],
    returns: 'Numeric', language: 'both',
  },

  // ── TI: Cell operations ──────────────────────────────────────────────────────
  CellGetN: {
    description: 'Returns a numeric value from a cube cell.',
    params: [
      { name: 'cube',     type: 'String',  description: 'Cube name' },
      { name: 'element1', type: 'String',  description: 'Element for dimension 1' },
      { name: '...',      type: 'String',  description: 'Elements for remaining dimensions' },
    ],
    returns: 'Numeric', variadic: true, language: 'ti',
  },
  CellGetS: {
    description: 'Returns a string value from a cube cell.',
    params: [
      { name: 'cube',     type: 'String', description: 'Cube name' },
      { name: 'element1', type: 'String', description: 'Element for dimension 1' },
      { name: '...',      type: 'String', description: 'Elements for remaining dimensions' },
    ],
    returns: 'String', variadic: true, language: 'ti',
  },
  CellPutN: {
    description: 'Writes a numeric value to a cube cell.',
    params: [
      { name: 'value',    type: 'Numeric', description: 'Value to write' },
      { name: 'cube',     type: 'String',  description: 'Cube name' },
      { name: 'element1', type: 'String',  description: 'Element for dimension 1' },
      { name: '...',      type: 'String',  description: 'Elements for remaining dimensions' },
    ],
    returns: 'Void', variadic: true, language: 'ti',
  },
  CellPutS: {
    description: 'Writes a string value to a cube cell.',
    params: [
      { name: 'value',    type: 'String', description: 'Value to write' },
      { name: 'cube',     type: 'String', description: 'Cube name' },
      { name: 'element1', type: 'String', description: 'Element for dimension 1' },
      { name: '...',      type: 'String', description: 'Elements for remaining dimensions' },
    ],
    returns: 'Void', variadic: true, language: 'ti',
  },
  CellIsUpdateable: {
    description: 'Returns 1 if the cell can be updated, 0 otherwise.',
    params: [
      { name: 'cube',     type: 'String', description: 'Cube name' },
      { name: 'element1', type: 'String', description: 'Element for dimension 1' },
      { name: '...',      type: 'String', description: 'Elements for remaining dimensions' },
    ],
    returns: 'Numeric', variadic: true, language: 'ti',
  },
  CellIsPopulated: {
    description: 'Returns 1 if the cell contains a non-zero value, 0 otherwise.',
    params: [
      { name: 'cube',     type: 'String', description: 'Cube name' },
      { name: 'element1', type: 'String', description: 'Element for dimension 1' },
      { name: '...',      type: 'String', description: 'Elements for remaining dimensions' },
    ],
    returns: 'Numeric', variadic: true, language: 'ti',
  },

  // ── TI: Dimension / Element operations ───────────────────────────────────────
  DimensionExists: {
    description: 'Returns 1 if the dimension exists, 0 otherwise.',
    params: [{ name: 'dimension', type: 'String', description: 'Dimension name' }],
    returns: 'Numeric', language: 'ti',
  },
  DimensionElementCount: {
    description: 'Returns the number of elements in a dimension.',
    params: [{ name: 'dimension', type: 'String', description: 'Dimension name' }],
    returns: 'Numeric', language: 'ti',
  },
  DimensionElementInsert: {
    description: 'Inserts an element into a dimension under a parent with a given weight.',
    params: [
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'parent',    type: 'String',  description: 'Parent element (empty string for root)' },
      { name: 'element',   type: 'String',  description: 'Element name to insert' },
      { name: 'type',      type: 'String',  description: '"N" for numeric, "C" for consolidated, "S" for string' },
      { name: 'weight',    type: 'Numeric', description: 'Consolidation weight (typically 1 or -1)' },
    ],
    returns: 'Void', language: 'ti',
  },
  DimensionElementAdd: {
    description: 'Adds an element to a dimension without a parent.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
      { name: 'type',      type: 'String', description: '"N", "C", or "S"' },
    ],
    returns: 'Void', language: 'ti',
  },
  DimensionElementDelete: {
    description: 'Deletes an element from a dimension.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name to delete' },
    ],
    returns: 'Void', language: 'ti',
  },
  ElementExists: {
    description: 'Returns 1 if the element exists in the dimension, 0 otherwise.',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  ElementIndex: {
    description: 'Returns the index of an element in a dimension (1-based).',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  ElementName: {
    description: 'Returns the element name at a given index in a dimension.',
    params: [
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'index',     type: 'Numeric', description: 'Element index (1-based)' },
    ],
    returns: 'String', language: 'ti',
  },
  HierarchyElementInsert: {
    description: 'Inserts an element into a hierarchy under a parent with a given weight.',
    params: [
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'hierarchy', type: 'String',  description: 'Hierarchy name' },
      { name: 'parent',    type: 'String',  description: 'Parent element' },
      { name: 'element',   type: 'String',  description: 'Element name' },
      { name: 'type',      type: 'String',  description: '"N", "C", or "S"' },
      { name: 'weight',    type: 'Numeric', description: 'Consolidation weight' },
    ],
    returns: 'Void', language: 'ti',
  },

  // ── TI: Attribute operations ─────────────────────────────────────────────────
  AttrPutN: {
    description: 'Writes a numeric attribute value for a dimension element.',
    params: [
      { name: 'value',     type: 'Numeric', description: 'Value to write' },
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'element',   type: 'String',  description: 'Element name' },
      { name: 'attribute', type: 'String',  description: 'Attribute name' },
    ],
    returns: 'Void', language: 'ti',
  },
  AttrPutS: {
    description: 'Writes a string attribute value for a dimension element.',
    params: [
      { name: 'value',     type: 'String', description: 'Value to write' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
      { name: 'attribute', type: 'String', description: 'Attribute name' },
    ],
    returns: 'Void', language: 'ti',
  },
  AttrN: {
    description: 'Returns a numeric attribute value for a dimension element (TI version).',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
      { name: 'attribute', type: 'String', description: 'Attribute name' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  AttrS: {
    description: 'Returns a string attribute value for a dimension element (TI version).',
    params: [
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name' },
      { name: 'attribute', type: 'String', description: 'Attribute name' },
    ],
    returns: 'String', language: 'ti',
  },

  // ── TI: Subset operations ────────────────────────────────────────────────────
  SubsetCreate: {
    description: 'Creates an empty named subset on a dimension.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
    ],
    returns: 'Void', language: 'ti',
  },
  SubsetCreateByMDX: {
    description: 'Creates a dynamic MDX-based subset on a dimension.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'MDX',       type: 'String', description: 'MDX expression defining the subset members' },
    ],
    returns: 'Void', language: 'ti',
  },
  SubsetDelete: {
    description: 'Deletes a named subset from a dimension.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
    ],
    returns: 'Void', language: 'ti',
  },
  SubsetAddElement: {
    description: 'Adds an element to a static subset.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'element',   type: 'String', description: 'Element name to add' },
    ],
    returns: 'Void', language: 'ti',
  },
  SubsetExists: {
    description: 'Returns 1 if the subset exists, 0 otherwise.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  SubsetGetSize: {
    description: 'Returns the number of elements in a subset.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  SubsetElementName: {
    description: 'Returns the element name at a given index in a subset.',
    params: [
      { name: 'subset',    type: 'String',  description: 'Subset name' },
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'index',     type: 'Numeric', description: 'Element index (1-based)' },
    ],
    returns: 'String', language: 'ti',
  },
  SubsetMDXGet: {
    description: 'Returns the MDX expression of a dynamic subset.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
    ],
    returns: 'String', language: 'ti',
  },
  SubsetMDXSet: {
    description: 'Sets the MDX expression of a dynamic subset.',
    params: [
      { name: 'subset',    type: 'String', description: 'Subset name' },
      { name: 'dimension', type: 'String', description: 'Dimension name' },
      { name: 'MDX',       type: 'String', description: 'MDX expression' },
    ],
    returns: 'Void', language: 'ti',
  },

  // ── TI: String functions ─────────────────────────────────────────────────────
  TRIM: {
    description: 'Removes leading and trailing spaces from a string.',
    params: [{ name: 'string', type: 'String', description: 'Input string' }],
    returns: 'String', language: 'both',
  },
  LTRIM: {
    description: 'Removes leading spaces from a string.',
    params: [{ name: 'string', type: 'String', description: 'Input string' }],
    returns: 'String', language: 'both',
  },
  RTRIM: {
    description: 'Removes trailing spaces from a string.',
    params: [{ name: 'string', type: 'String', description: 'Input string' }],
    returns: 'String', language: 'both',
  },
  UPPER: {
    description: 'Converts a string to upper case.',
    params: [{ name: 'string', type: 'String', description: 'Input string' }],
    returns: 'String', language: 'both',
  },
  LOWER: {
    description: 'Converts a string to lower case.',
    params: [{ name: 'string', type: 'String', description: 'Input string' }],
    returns: 'String', language: 'both',
  },
  SUBST: {
    description: 'Returns a substring from a string.',
    params: [
      { name: 'string', type: 'String',  description: 'Input string' },
      { name: 'start',  type: 'Numeric', description: 'Start position (1-based)' },
      { name: 'length', type: 'Numeric', description: 'Number of characters to return' },
    ],
    returns: 'String', language: 'both',
  },
  LONG: {
    description: 'Returns the length of a string.',
    params: [{ name: 'string', type: 'String', description: 'Input string' }],
    returns: 'Numeric', language: 'both',
  },
  SCAN: {
    description: 'Returns the position of one string within another (0 if not found).',
    params: [
      { name: 'find',   type: 'String', description: 'String to search for' },
      { name: 'within', type: 'String', description: 'String to search within' },
    ],
    returns: 'Numeric', language: 'both',
  },
  CONT: {
    description: 'Concatenates two strings.',
    params: [
      { name: 'string1', type: 'String', description: 'First string' },
      { name: 'string2', type: 'String', description: 'Second string' },
    ],
    returns: 'String', language: 'both',
  },
  FILL: {
    description: 'Pads or truncates a string to a specified length.',
    params: [
      { name: 'string', type: 'String',  description: 'Input string' },
      { name: 'length', type: 'Numeric', description: 'Target length' },
    ],
    returns: 'String', language: 'both',
  },
  CODE: {
    description: 'Returns the ASCII code of a character at a given position in a string.',
    params: [
      { name: 'string',   type: 'String',  description: 'Input string' },
      { name: 'position', type: 'Numeric', description: 'Character position (1-based)' },
    ],
    returns: 'Numeric', language: 'both',
  },
  CHAR: {
    description: 'Returns the character corresponding to an ASCII code.',
    params: [{ name: 'code', type: 'Numeric', description: 'ASCII code' }],
    returns: 'String', language: 'both',
  },
  NUMBR: {
    description: 'Converts a string to a number.',
    params: [{ name: 'string', type: 'String', description: 'Numeric string to convert' }],
    returns: 'Numeric', language: 'both',
  },
  STR: {
    description: 'Converts a number to a string with specified width and decimal places.',
    params: [
      { name: 'number',   type: 'Numeric', description: 'Number to convert' },
      { name: 'length',   type: 'Numeric', description: 'Total string width' },
      { name: 'decimals', type: 'Numeric', description: 'Decimal places' },
    ],
    returns: 'String', language: 'both',
  },

  // ── TI: Numeric functions ────────────────────────────────────────────────────
  ABS: {
    description: 'Returns the absolute value of a number.',
    params: [{ name: 'number', type: 'Numeric', description: 'Input number' }],
    returns: 'Numeric', language: 'both',
  },
  INT: {
    description: 'Returns the integer part of a number (truncates, does not round).',
    params: [{ name: 'number', type: 'Numeric', description: 'Input number' }],
    returns: 'Numeric', language: 'both',
  },
  ROUND: {
    description: 'Rounds a number to a specified number of decimal places.',
    params: [
      { name: 'number',   type: 'Numeric', description: 'Number to round' },
      { name: 'decimals', type: 'Numeric', description: 'Decimal places (0 for integer)' },
    ],
    returns: 'Numeric', language: 'both',
  },
  MOD: {
    description: 'Returns the remainder after dividing one number by another.',
    params: [
      { name: 'number',  type: 'Numeric', description: 'Dividend' },
      { name: 'divisor', type: 'Numeric', description: 'Divisor' },
    ],
    returns: 'Numeric', language: 'both',
  },
  POWER: {
    description: 'Returns the result of raising a base to a power.',
    params: [
      { name: 'base',     type: 'Numeric', description: 'Base number' },
      { name: 'exponent', type: 'Numeric', description: 'Exponent' },
    ],
    returns: 'Numeric', language: 'both',
  },
  SQRT: {
    description: 'Returns the square root of a number.',
    params: [{ name: 'number', type: 'Numeric', description: 'Input number (must be >= 0)' }],
    returns: 'Numeric', language: 'both',
  },
  LOG: {
    description: 'Returns the natural logarithm of a number.',
    params: [{ name: 'number', type: 'Numeric', description: 'Input number (must be > 0)' }],
    returns: 'Numeric', language: 'both',
  },
  EXP: {
    description: 'Returns e raised to the power of a number.',
    params: [{ name: 'number', type: 'Numeric', description: 'Exponent' }],
    returns: 'Numeric', language: 'both',
  },
  MAX: {
    description: 'Returns the larger of two numbers.',
    params: [
      { name: 'number1', type: 'Numeric', description: 'First number' },
      { name: 'number2', type: 'Numeric', description: 'Second number' },
    ],
    returns: 'Numeric', language: 'both',
  },
  MIN: {
    description: 'Returns the smaller of two numbers.',
    params: [
      { name: 'number1', type: 'Numeric', description: 'First number' },
      { name: 'number2', type: 'Numeric', description: 'Second number' },
    ],
    returns: 'Numeric', language: 'both',
  },
  SIGN: {
    description: 'Returns 1 if positive, -1 if negative, 0 if zero.',
    params: [{ name: 'number', type: 'Numeric', description: 'Input number' }],
    returns: 'Numeric', language: 'both',
  },
  RAND: {
    description: 'Returns a random number between 0 and 1.',
    params: [],
    returns: 'Numeric', language: 'both',
  },

  // ── TI: Date / Time functions ────────────────────────────────────────────────
  NOW: {
    description: 'Returns the current date as a number (days since 1 Jan 1960).',
    params: [],
    returns: 'Numeric', language: 'ti',
  },
  DATE: {
    description: 'Returns a date value from year, month, and day.',
    params: [
      { name: 'year',  type: 'Numeric', description: 'Four-digit year' },
      { name: 'month', type: 'Numeric', description: 'Month (1-12)' },
      { name: 'day',   type: 'Numeric', description: 'Day (1-31)' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  DATES: {
    description: 'Returns a formatted date string from a date number.',
    params: [
      { name: 'date',   type: 'Numeric', description: 'Date number (days since 1 Jan 1960)' },
      { name: 'format', type: 'String',  description: 'Format string e.g. "YYYY-MM-DD"' },
    ],
    returns: 'String', language: 'ti',
  },
  DATEADD: {
    description: 'Adds a number of units to a date.',
    params: [
      { name: 'units',  type: 'String',  description: '"days", "months", or "years"' },
      { name: 'value',  type: 'Numeric', description: 'Number of units to add' },
      { name: 'date',   type: 'Numeric', description: 'Date number' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  DATEDIFF: {
    description: 'Returns the difference between two dates in specified units.',
    params: [
      { name: 'units', type: 'String',  description: '"days", "months", or "years"' },
      { name: 'date1', type: 'Numeric', description: 'Start date' },
      { name: 'date2', type: 'Numeric', description: 'End date' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  DAY: {
    description: 'Returns the day of the month from a date number.',
    params: [{ name: 'date', type: 'Numeric', description: 'Date number' }],
    returns: 'Numeric', language: 'ti',
  },
  MONTH: {
    description: 'Returns the month number from a date number.',
    params: [{ name: 'date', type: 'Numeric', description: 'Date number' }],
    returns: 'Numeric', language: 'ti',
  },
  YEAR: {
    description: 'Returns the year from a date number.',
    params: [{ name: 'date', type: 'Numeric', description: 'Date number' }],
    returns: 'Numeric', language: 'ti',
  },
  TIME: {
    description: 'Returns the current time as a fraction of a day.',
    params: [],
    returns: 'Numeric', language: 'ti',
  },
  TIMST: {
    description: 'Returns a formatted time string.',
    params: [
      { name: 'time',   type: 'Numeric', description: 'Time value (fraction of day)' },
      { name: 'format', type: 'String',  description: 'Format string e.g. "HH:MM:SS"' },
    ],
    returns: 'String', language: 'ti',
  },

  // ── TI: Process control ──────────────────────────────────────────────────────
  ProcessBreak: {
    description: 'Stops processing the current datasource record and moves to the next.',
    params: [], returns: 'Void', language: 'ti',
  },
  ProcessError: {
    description: 'Marks the process as errored and stops execution.',
    params: [], returns: 'Void', language: 'ti',
  },
  ProcessQuit: {
    description: 'Stops the process immediately without error.',
    params: [], returns: 'Void', language: 'ti',
  },
  LogOutput: {
    description: 'Writes a message to the TM1 server log.',
    params: [
      { name: 'flag',    type: 'String', description: '"INFO", "WARN", or "ERROR"' },
      { name: 'message', type: 'String', description: 'Message text to log' },
    ],
    returns: 'Void', language: 'ti',
  },
  ItemReject: {
    description: 'Rejects the current datasource record and logs a message.',
    params: [{ name: 'message', type: 'String', description: 'Rejection reason' }],
    returns: 'Void', language: 'ti',
  },
  ItemSkip: {
    description: 'Skips the current datasource record without logging.',
    params: [], returns: 'Void', language: 'ti',
  },
  ExecuteProcess: {
    description: 'Runs another TI process, optionally passing parameters.',
    params: [
      { name: 'process', type: 'String', description: 'Process name' },
      { name: 'param1',  type: 'String', description: 'Parameter name (optional)' },
      { name: 'value1',  type: 'String', description: 'Parameter value (optional)' },
      { name: '...',     type: 'String', description: 'Additional param/value pairs' },
    ],
    returns: 'Numeric', variadic: true, language: 'ti',
  },

  // ── TI: Cube / View operations ───────────────────────────────────────────────
  CubeExists: {
    description: 'Returns 1 if the cube exists, 0 otherwise.',
    params: [{ name: 'cube', type: 'String', description: 'Cube name' }],
    returns: 'Numeric', language: 'ti',
  },
  CubeCreate: {
    description: 'Creates a new cube with the specified dimensions.',
    params: [
      { name: 'cube',       type: 'String', description: 'Cube name' },
      { name: 'dimension1', type: 'String', description: 'First dimension' },
      { name: '...',        type: 'String', description: 'Additional dimensions' },
    ],
    returns: 'Void', variadic: true, language: 'ti',
  },
  ViewCreate: {
    description: 'Creates a new view on a cube.',
    params: [
      { name: 'cube', type: 'String', description: 'Cube name' },
      { name: 'view', type: 'String', description: 'View name' },
    ],
    returns: 'Void', language: 'ti',
  },
  ViewExists: {
    description: 'Returns 1 if the view exists on the cube, 0 otherwise.',
    params: [
      { name: 'cube', type: 'String', description: 'Cube name' },
      { name: 'view', type: 'String', description: 'View name' },
    ],
    returns: 'Numeric', language: 'ti',
  },
  ViewDelete: {
    description: 'Deletes a view from a cube.',
    params: [
      { name: 'cube', type: 'String', description: 'Cube name' },
      { name: 'view', type: 'String', description: 'View name' },
    ],
    returns: 'Void', language: 'ti',
  },
  ViewZeroOut: {
    description: 'Sets all cells in a view to zero.',
    params: [
      { name: 'cube', type: 'String', description: 'Cube name' },
      { name: 'view', type: 'String', description: 'View name' },
    ],
    returns: 'Void', language: 'ti',
  },
  ViewConstruct: {
    description: 'Constructs (recalculates) the in-memory view.',
    params: [
      { name: 'cube', type: 'String', description: 'Cube name' },
      { name: 'view', type: 'String', description: 'View name' },
    ],
    returns: 'Void', language: 'ti',
  },
  ViewSubsetAssign: {
    description: 'Assigns a subset to a dimension in a view.',
    params: [
      { name: 'cube',      type: 'String',  description: 'Cube name' },
      { name: 'view',      type: 'String',  description: 'View name' },
      { name: 'dimension', type: 'String',  description: 'Dimension name' },
      { name: 'axis',      type: 'Numeric', description: '0=row, 1=column, 2=title' },
      { name: 'subset',    type: 'String',  description: 'Subset name' },
    ],
    returns: 'Void', language: 'ti',
  },
  ViewExtractSkipZeroesSet: {
    description: 'Sets whether to skip zero values when extracting a view.',
    params: [
      { name: 'cube',  type: 'String',  description: 'Cube name' },
      { name: 'view',  type: 'String',  description: 'View name' },
      { name: 'skip',  type: 'Numeric', description: '1 to skip zeroes, 0 to include' },
    ],
    returns: 'Void', language: 'ti',
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSignature(name, fn) {
  if (!fn.params.length) return `${name}()`
  const paramStr = fn.params.map(p => p.name).join(', ')
  return `${name}(${paramStr}) : ${fn.returns}`
}

function buildSnippet(name, fn) {
  if (!fn.params.length) return `${name}()`
  const realParams = fn.params.filter(p => p.name !== '...')
  const snippetParams = realParams.map((p, i) => `\${${i + 1}:${p.name}}`).join(', ')
  return `${name}(${snippetParams})`
}

// Extract function call context — returns funcName, prevParams[], paramIndex
// prevParams contains string literal values where extractable, null for variables
function extractParamContext(model, position) {
  const text = model.getValueInRange({
    startLineNumber: 1, startColumn: 1,
    endLineNumber: position.lineNumber, endColumn: position.column,
  })

  let depth = 0
  let openParenPos = -1

  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ')') { depth++; continue }
    if (ch === '(') {
      if (depth === 0) { openParenPos = i; break }
      depth--
    }
  }

  if (openParenPos === -1) return null

  const before = text.substring(0, openParenPos)
  const fnMatch = before.match(/([A-Za-z_]\w*)$/)
  if (!fnMatch) return null

  const funcName = fnMatch[1].toUpperCase()
  const paramText = text.substring(openParenPos + 1)

  // Split by commas respecting nested parens
  const rawParams = []
  let current = ''
  let d = 0
  for (const ch of paramText) {
    if      (ch === '(' )           { d++; current += ch }
    else if (ch === ')' )           { d--; current += ch }
    else if (ch === ',' && d === 0) { rawParams.push(current.trim()); current = '' }
    else                            { current += ch }
  }
  // current = the param being typed right now (not complete)
  const paramIndex = rawParams.length

  // Extract string literal value from a raw param, e.g. "'Revenue'" → "Revenue"
  const prevParams = rawParams.map(p => {
    const m = p.match(/^['"](.+)['"]$/)
    return m ? m[1] : null
  })

  return { funcName, prevParams, paramIndex }
}

// ── In-memory cache with 60s TTL ──────────────────────────────────────────────
const _cache = new Map()

async function tm1Fetch(url) {
  if (_cache.has(url)) return _cache.get(url)
  try {
    const res  = await fetch(url)
    const data = res.ok ? await res.json() : []
    _cache.set(url, data)
    setTimeout(() => _cache.delete(url), 60_000)
    return data
  } catch {
    return []
  }
}

function enc(s) { return encodeURIComponent(s) }

// ── Contextual suggestion builders ───────────────────────────────────────────

function wordRange(model, position) {
  const word = model.getWordUntilPosition(position)
  return {
    startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
    startColumn: word.startColumn,        endColumn:    word.endColumn,
  }
}

// Detect if the cursor is already inside an open string literal
// Returns: 'close' (already have opening quote — add closing quote only)
//          'wrap'  (no quote yet — wrap in single quotes)
function quoteMode(model, position) {
  const word = model.getWordUntilPosition(position)
  if (word.startColumn <= 1) return 'wrap'
  const prev = model.getValueInRange({
    startLineNumber: position.lineNumber, startColumn: word.startColumn - 1,
    endLineNumber:   position.lineNumber, endColumn:   word.startColumn,
  })
  return (prev === "'" || prev === '"') ? 'close' : 'wrap'
}

function quoted(name, mode) {
  return mode === 'close' ? `${name}'` : `'${name}'`
}

function cubeItems(cubes, range, mode) {
  return cubes.map(name => ({
    label: name, kind: 17,
    detail: 'Cube', insertText: quoted(name, mode), range,
  }))
}

function dimensionItems(dims, range, mode) {
  return dims.map(name => ({
    label: name, kind: 9,
    detail: 'Dimension', insertText: quoted(name, mode), range,
  }))
}

function elementItems(elements, range, mode, detail, dimName) {
  const typeLabel = { N: 'Numeric', C: 'Consolidated', S: 'String' }
  const items = elements
    .filter(e => !e.Name.startsWith('}'))
    .map(e => ({
      label:      e.Name,
      kind:       12,
      detail:     detail ?? typeLabel[e.Type] ?? e.Type,
      insertText: quoted(e.Name, mode),
      sortText:   'z' + e.Name,
      range,
    }))
  if (dimName) {
    items.unshift({
      label:      `!${dimName}`,
      kind:       6,
      detail:     'Current element (rule variable)',
      insertText: `!${dimName}`,
      sortText:   '0',
      range,
    })
  }
  return items
}

function attributeItems(attrs, range, mode) {
  return attrs.map(a => ({
    label:      a.name,
    kind:       5,
    detail:     `Attribute (${a.type})`,
    insertText: quoted(a.name, mode),
    range,
  }))
}

// Functions where param 0 = cube, params 1+ = elements per dimension
const CUBE_ELEMENT_FUNCS = new Set(['DB', 'DBS', 'CELLGETN', 'CELLGETS', 'CELLPUTN', 'CELLPUTS',
  'CELLISUPDATEABLE', 'CELLISPOPULATED'])

// Functions where param 0 = dimension, param 1 = element, param 2 = attribute
const DIM_ATTR_FUNCS = new Set(['ATTRS', 'ATTRN', 'ATTRL', 'ATTRPUTN', 'ATTRPUTS'])

// Functions where param 0 = dimension, param 1+ = elements
const DIM_ELEMENT_FUNCS = new Set(['DIMIX', 'DTYPE', 'ELLEV', 'ELPAR', 'ELPARN',
  'ELCOMP', 'ELCOMPN', 'ELISANC', 'ELISPAR', 'ELWEIGHT'])

// Functions where param 0 = dimension only (no element params)
const DIM_ONLY_FUNCS = new Set(['DIMSIZ', 'DIMENSIONEXISTS', 'DIMENSIONELEMENTCOUNT',
  'DIMENSIONELEMENTINSERT', 'DIMENSIONELEMENTADD', 'DIMENSIONELEMENTDELETE',
  'ELEMENTEXISTS', 'ELEMENTINDEX', 'ELEMENTNAME',
  'SUBSETCREATE', 'SUBSETCREATEBYMDX', 'SUBSETDELETE', 'SUBSETADDELEMENT',
  'SUBSETEXISTS', 'SUBSETGETSIZE', 'SUBSETELEMENTNAME', 'SUBSETMDXGET', 'SUBSETMDXSET'])

// ── Monaco registration ───────────────────────────────────────────────────────

// getServer: function that returns the currently connected server name or null
function registerTM1Completions(monaco, getServer) {
  // ── Language registration + tokenizers ──────────────────────────────────────
  monaco.languages.register({ id: 'tm1rules' })
  monaco.languages.setMonarchTokensProvider('tm1rules', {
    tokenizer: {
      root: [
        [/#.*/, 'comment'],
        [/\/\/.*/, 'comment'],
        [/'[^']*'/, 'string'],
        [/\b(SKIPCHECK|FEEDSTRINGS|FEEDERS|FEEDER|N:|C:|S:)\b/i, 'keyword'],
        [/\b(DB|DBS|ATTRS?|ATTRN|ATTRL|STET|CONTINUE|IF|ELSEIF|ELSE|ENDIF)\b/i, 'type'],
        [/![a-zA-Z_][\w ]*/, 'variable'],
        [/\[([^\]]+)\]/, 'string'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[=>|,;()+\-*/]/, 'operator'],
      ]
    }
  })

  // Folding: #Region / #EndRegion blocks (PAW-style)
  monaco.languages.registerFoldingRangeProvider('tm1rules', {
    provideFoldingRanges(model, _context, _token) {
      const ranges = []
      const lineCount = model.getLineCount()
      const stack = []
      for (let line = 1; line <= lineCount; line++) {
        const text = model.getLineContent(line).trim()
        if (/^#Region\b/i.test(text)) {
          stack.push(line)
        } else if (/^#EndRegion\b/i.test(text)) {
          const start = stack.pop()
          if (start != null) {
            ranges.push({ start, end: line, kind: monaco.languages.FoldingRangeKind.Region })
          }
        }
      }
      return ranges
    }
  })

  // Go to Symbol: #Region blocks appear in Ctrl+Shift+O outline
  monaco.languages.registerDocumentSymbolProvider('tm1rules', {
    provideDocumentSymbols(model, _token) {
      const symbols = []
      const lineCount = model.getLineCount()
      const stack = []
      for (let line = 1; line <= lineCount; line++) {
        const text = model.getLineContent(line).trim()
        const match = text.match(/^#Region\s+(.*)$/i)
        if (match) {
          const name = match[1].trim() || 'Region'
          stack.push({ name, line })
        } else if (/^#EndRegion\b/i.test(text)) {
          const region = stack.pop()
          if (region) {
            symbols.push({
              name: region.name,
              kind: monaco.languages.SymbolKind.Namespace,
              range: new monaco.Range(region.line, 1, line, model.getLineMaxColumn(line)),
              selectionRange: new monaco.Range(region.line, 1, region.line, model.getLineMaxColumn(region.line)),
              children: [],
            })
          }
        }
      }
      // Close any unclosed regions at end of file
      while (stack.length) {
        const region = stack.pop()
        symbols.push({
          name: region.name,
          kind: monaco.languages.SymbolKind.Namespace,
          range: new monaco.Range(region.line, 1, lineCount, model.getLineMaxColumn(lineCount)),
          selectionRange: new monaco.Range(region.line, 1, region.line, model.getLineMaxColumn(region.line)),
          children: [],
        })
      }
      return symbols
    }
  })

  // Format Document: auto-format TM1 rules (token-aware engine)
  monaco.languages.registerDocumentFormattingEditProvider('tm1rules', {
    provideDocumentFormattingEdits(model, _options, _token) {
      const text = model.getValue()
      const settings = loadSettings()
      const { map: namingMap } = getNamingMap()
      const formatted = formatRules(text, settings.rules, namingMap)
      return [{ range: model.getFullModelRange(), text: formatted }]
    }
  })

  monaco.languages.registerDocumentRangeFormattingEditProvider('tm1rules', {
    provideDocumentRangeFormattingEdits(model, range, _options, _token) {
      const text = model.getValueInRange(range)
      const settings = loadSettings()
      const { map: namingMap } = getNamingMap()
      const formatted = formatRules(text, settings.rules, namingMap)
      return [{ range, text: formatted }]
    }
  })

  monaco.languages.register({ id: 'tm1ti' })
  monaco.languages.setMonarchTokensProvider('tm1ti', {
    tokenizer: {
      root: [
        [/#.*/, 'comment'],
        [/'[^']*'/, 'string'],
        [/\b(IF|ELSE|ELSEIF|ENDIF|WHILE|END|NEXT|FOR|BREAK)\b/i, 'keyword'],
        [/\b[A-Za-z_]\w*\s*(?=\()/, 'type'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[=><!|,;()+\-*/]/, 'operator'],
        [/[A-Za-z_]\w*/, 'variable'],
      ]
    }
  })

  monaco.languages.register({ id: 'tm1mdx' })
  monaco.languages.setMonarchTokensProvider('tm1mdx', {
    tokenizer: {
      root: [
        [/--.*/, 'comment'],
        [/'[^']*'/, 'string'],
        [/"[^"]*"/, 'string'],
        [/\[([^\]]*)\]/, 'variable'],
        [/\b(SELECT|FROM|WHERE|ON|ROWS|COLUMNS|AXIS|WITH|MEMBER|AS|SET|NON|EMPTY)\b/i, 'keyword'],
        [/\b(FILTER|CROSSJOIN|TOPCOUNT|BOTTOMCOUNT|ORDER|DESCENDANTS|ANCESTORS|NONEMPTY|INTERSECT|UNION|EXCEPT|GENERATE|EXTRACT|PERIODSTODATE|PARALLELPERIOD|LAG|LEAD)\b/i, 'type'],
        [/\b(TM1FILTERBYLEVEL|TM1FILTERBYPATTERN|TM1SORT|TM1MEMBER|TM1DRILLDOWNMEMBER|TM1DRILLDOWNLEVEL)\b/i, 'type'],
        [/\b(CURRENTMEMBER|PROPERTIES|CHILDREN|ANCESTORS|PARENT|NEXTMEMBER|PREVMEMBER|SIBLINGS|MEMBERS|ALLMEMBERS|DEFAULTMEMBER|FIRSTCHILD|LASTCHILD)\b/i, 'type'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[{}()\[\],.]/, 'operator'],
      ]
    }
  })

  const langMap = { tm1rules: 'rules', tm1ti: 'ti' }

  Object.entries(langMap).forEach(([langId, langKey]) => {

    // ── Completion provider ──────────────────────────────────────────────────
    monaco.languages.registerCompletionItemProvider(langId, {
      triggerCharacters: ['(', ',', "'", '"'],

      provideCompletionItems: async (model, position) => {
        const server = getServer ? getServer() : null
        const ctx    = extractParamContext(model, position)
        const range  = wordRange(model, position)
        const mode   = quoteMode(model, position)

        // ── Inside a function call → contextual completions ─────────────────
        if (ctx && server) {
          const { funcName, prevParams, paramIndex } = ctx

          // Cube + element params: DB, DBS, CellGetN, CellPutN, etc.
          if (CUBE_ELEMENT_FUNCS.has(funcName)) {
            if (paramIndex === 0) {
              const cubes = await tm1Fetch(`/api/cubes?server=${enc(server)}`)
              return { suggestions: cubeItems(cubes, range, mode) }
            }
            if (paramIndex >= 1 && prevParams[0]) {
              const dims = await tm1Fetch(
                `/api/cube/dimensions?server=${enc(server)}&cube=${enc(prevParams[0])}`
              )
              const dimIndex = paramIndex - 1
              if (dims[dimIndex]) {
                const elements = await tm1Fetch(
                  `/api/elements?server=${enc(server)}&dimension=${enc(dims[dimIndex])}`
                )
                const dimHint = `${prevParams[0]} → dim ${dimIndex + 1}: ${dims[dimIndex]}`
                return {
                  suggestions: elementItems(elements, range, mode, dimHint, dims[dimIndex]),
                }
              }
            }
          }

          // Dimension + element + attribute params: ATTRS, ATTRN, AttrPutS, etc.
          if (DIM_ATTR_FUNCS.has(funcName)) {
            if (paramIndex === 0) {
              const dims = await tm1Fetch(`/api/dimensions?server=${enc(server)}`)
              return { suggestions: dimensionItems(dims, range, mode) }
            }
            if (paramIndex === 1 && prevParams[0]) {
              const elements = await tm1Fetch(
                `/api/elements?server=${enc(server)}&dimension=${enc(prevParams[0])}`
              )
              return { suggestions: elementItems(elements, range, mode, undefined, prevParams[0]) }
            }
            if (paramIndex === 2 && prevParams[0]) {
              const attrs = await tm1Fetch(
                `/api/dimension/attributes?server=${enc(server)}&dimension=${enc(prevParams[0])}`
              )
              return { suggestions: attributeItems(attrs, range, mode) }
            }
          }

          // Dimension + element params: DIMIX, DTYPE, ELLEV, ELPAR, ELCOMP, etc.
          if (DIM_ELEMENT_FUNCS.has(funcName)) {
            if (paramIndex === 0) {
              const dims = await tm1Fetch(`/api/dimensions?server=${enc(server)}`)
              return { suggestions: dimensionItems(dims, range, mode) }
            }
            if (paramIndex >= 1 && prevParams[0]) {
              const elements = await tm1Fetch(
                `/api/elements?server=${enc(server)}&dimension=${enc(prevParams[0])}`
              )
              return { suggestions: elementItems(elements, range, mode, undefined, prevParams[0]) }
            }
          }

          // Dimension-only params: DIMSIZ, SubsetCreate, ElementExists, etc.
          if (DIM_ONLY_FUNCS.has(funcName) && paramIndex === 0) {
            const dims = await tm1Fetch(`/api/dimensions?server=${enc(server)}`)
            return { suggestions: dimensionItems(dims, range, mode) }
          }

          // Cube name param: TABDIM, ViewCreate, ViewExists, CubeExists, etc.
          if (['TABDIM', 'VIEWCREATE', 'VIEWEXISTS', 'VIEWDELETE', 'VIEWZEROOUT',
               'VIEWCONSTRUCT', 'CUBEEXISTS'].includes(funcName) && paramIndex === 0) {
            const cubes = await tm1Fetch(`/api/cubes?server=${enc(server)}`)
            return { suggestions: cubeItems(cubes, range, mode) }
          }
        }

        // ── DataSource* system variable completions (tm1ti Prolog) ─────────
        const word  = model.getWordUntilPosition(position)
        const upper = word.word.toUpperCase()
        if (!upper) return { suggestions: [] }

        if (langKey === 'ti' && upper.startsWith('DATASOURCE')) {
          const DS_VARS = [
            { name: 'DataSourceType',                desc: "Set datasource type: 'ASCII', 'ODBC', 'TM1CubeView', 'TM1DimensionSubset', 'NULL'" },
            { name: 'DataSourceNameForServer',        desc: 'File path or DSN name as seen from the TM1 server' },
            { name: 'DataSourceNameForClient',        desc: 'File path or DSN name as seen from the client machine' },
            { name: 'DataSourceASCIIDelimiterType',   desc: "Delimiter style: 'Character', 'FixedWidth'" },
            { name: 'DataSourceASCIIDelimiterChar',   desc: "Delimiter character e.g. ','" },
            { name: 'DataSourceASCIIHeaderRecords',   desc: 'Number of header rows to skip (integer)' },
            { name: 'DataSourceASCIIQuoteCharacter',  desc: "Quote character e.g. '\"'" },
            { name: 'DataSourceASCIIDecimalSeparator',desc: "Decimal separator e.g. '.'" },
            { name: 'DataSourceASCIIThousandSeparator',desc: "Thousand separator e.g. ','"},
            { name: 'DataSourceQuery',                desc: 'SQL query string for ODBC datasource' },
            { name: 'DataSourceUserName',             desc: 'ODBC username' },
            { name: 'DataSourcePassword',             desc: 'ODBC password' },
            { name: 'DataSourceView',                 desc: 'View name for TM1CubeView datasource' },
            { name: 'DataSourceDimensionSubset',      desc: 'Subset name for TM1DimensionSubset datasource' },
          ]
          const dsRange = { ...range, startColumn: word.startColumn }
          return {
            suggestions: DS_VARS
              .filter(v => v.name.toUpperCase().startsWith(upper))
              .map(v => ({
                label:         v.name,
                kind:          monaco.languages.CompletionItemKind.Variable,
                detail:        'DataSource system variable',
                documentation: { value: v.desc },
                insertText:    v.name,
                range:         dsRange,
              })),
          }
        }

        // ── Not inside a call (or no server) → function name completions ────
        const suggestions = Object.entries(TM1_FUNCTIONS)
          .filter(([name, fn]) =>
            (fn.language === langKey || fn.language === 'both') &&
            name.toUpperCase().startsWith(upper)
          )
          .map(([name, fn]) => ({
            label:           name,
            kind:            monaco.languages.CompletionItemKind.Function,
            detail:          buildSignature(name, fn),
            documentation:   { value: fn.description },
            insertText:      buildSnippet(name, fn),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          }))
        return { suggestions }
      },
    })

    // ── Signature help provider ──────────────────────────────────────────────
    monaco.languages.registerSignatureHelpProvider(langId, {
      signatureHelpTriggerCharacters:   ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      provideSignatureHelp: (model, position) => {
        const ctx = extractParamContext(model, position)
        if (!ctx) return null

        const fn = TM1_FUNCTIONS[ctx.funcName]
        if (!fn || !fn.params.length) return null

        const realParams = fn.params.filter(p => p.name !== '...')
        return {
          value: {
            signatures: [{
              label:         buildSignature(ctx.funcName, fn),
              documentation: fn.description,
              parameters:    realParams.map(p => ({
                label:         p.name,
                documentation: `${p.type} — ${p.description}`,
              })),
            }],
            activeSignature: 0,
            activeParameter: Math.min(ctx.paramIndex, realParams.length - 1),
          },
          dispose: () => {},
        }
      },
    })
  })

  registerTM1Snippets(monaco)
  console.log(`TM1 autocomplete registered — ${Object.keys(TM1_FUNCTIONS).length} functions`)
}

// ── Register custom Monaco theme with user-defined colours ────────────────────

import { buildMonacoTheme, loadColourSettings, applyColourTheme } from '@/lib/formatters/colours.js'

function bgIsLight(hex) {
  const h = (hex ?? '#282a36').replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5
}

export function registerTM1Theme(monaco, dark) {
  let cs = loadColourSettings()
  // Auto-correct if the stored colour theme doesn't match the UI dark/light mode
  const colourIsLight = bgIsLight(cs.background)
  if (!dark && !colourIsLight) cs = applyColourTheme('light', cs)
  else if (dark && colourIsLight) cs = applyColourTheme('dracula', cs)
  const editorTheme = dark ? 'vs-dark' : 'vs'
  const themeDef = buildMonacoTheme(editorTheme, cs)
  monaco.editor.defineTheme('tm1-custom', themeDef)
  monaco.editor.setTheme('tm1-custom')
}

export { registerTM1Completions, TM1_FUNCTIONS }
