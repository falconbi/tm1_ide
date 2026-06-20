// ── Catalog entry schema ──────────────────────────────────────────────────────
// Each entry: { params, returnType, description, compat, deprecated, isStatement }
// params:      string[] — param type tags for arg-count validation and context completions
//              Types: 'cubename'|'dimname'|'element'|'attribute'|'hiername'|'value'|'n'|'string'|...
//              '*' suffix = repeating (variadic last arg)
// returnType:  'numeric'|'string'|'void'|'any'
// compat:      'both'|'v11'|'v12'   — v12 = PA 2.0+ only (alternate hierarchy functions)
// deprecated:  string | null         — shown as amber squiggle in editor; null = not deprecated
// isStatement: boolean               — true = cannot be used in an expression / assignment

const _fn   = (params, returnType, description, opts = {}) =>
  ({ params, returnType, description, compat: opts.compat ?? 'both', deprecated: opts.deprecated ?? null, isStatement: false })
const _stmt = (params, description, opts = {}) =>
  ({ params, returnType: 'void', description, compat: opts.compat ?? 'both', deprecated: null, isStatement: true })
const V12 = { compat: 'v12' }

// ── Rules Functions ───────────────────────────────────────────────────────────
const RULES_CATALOG = {
  // Cube data
  DB:         _fn(['cubename', 'element*'],  'numeric', 'Returns a numeric value from a cube using the current element context.'),
  CELLVALUEN: _fn(['cubename', 'element*'],  'numeric', 'Returns a numeric cube cell value (Rules alias for DB).'),
  CELLVALUES: _fn(['cubename', 'element*'],  'string',  'Returns a string cube cell value.'),
  DBS:        _fn(['cubename', 'element*'],  'string',  'Returns a string value from a cube.'),

  // Dimension info
  TABDIM:     _fn(['cubename', 'n'],         'string',  'Returns the name of the Nth dimension of a cube.'),
  DIMSIZ:     _fn(['dimname'],               'numeric', 'Returns the number of elements in a dimension.'),
  DIMIX:      _fn(['dimname', 'element'],    'numeric', 'Returns the 1-based index of an element in a dimension.'),
  DNEXT:      _fn(['dimname', 'element'],    'string',  'Returns the next element name in a dimension.'),
  DNLEV:      _fn(['dimname'],               'numeric', 'Returns the number of levels in a dimension.'),
  DTYPE:      _fn(['dimname', 'element'],    'string',  "Returns the element type: 'N', 'S', or 'C'."),

  // Element info — classic (V11 compatible, no hierarchy parameter)
  ELCOMP:  _fn(['dimname', 'element', 'n'],              'string',  'Returns the Nth component of a consolidated element.'),
  ELCOMPN: _fn(['dimname', 'element'],                    'numeric', 'Returns the number of components of a consolidated element.'),
  ELLEV:   _fn(['dimname', 'element'],                    'numeric', 'Returns the level of an element (0 = leaf).'),
  ELPAR:   _fn(['dimname', 'element', 'n'],               'string',  'Returns the Nth parent of an element.'),
  ELPARN:  _fn(['dimname', 'element'],                    'numeric', 'Returns the number of parents of an element.'),
  ELWEIGHT:_fn(['dimname', 'element', 'element'],         'numeric', 'Returns the weight of a child element within a parent.'),
  ELISANC: _fn(['dimname', 'element', 'element'],         'numeric', 'Returns 1 if the first element is an ancestor of the second.'),
  ELISCOMP:_fn(['dimname', 'element', 'element'],         'numeric', 'Returns 1 if the second element is a component of the first.'),
  ELISPAR: _fn(['dimname', 'element', 'element'],         'numeric', 'Returns 1 if the first element is a direct parent of the second.'),

  // Element info — hierarchy-aware (PA 2.0 / V12 only)
  ELEMENTCOMPONENT:      _fn(['dimname', 'hiername', 'element', 'n'],           'string',  'Returns the Nth component of a consolidated element (hierarchy-aware).', V12),
  ELEMENTCOMPONENTCOUNT: _fn(['dimname', 'hiername', 'element'],                'numeric', 'Returns the number of components of a consolidated element.', V12),
  ELEMENTCOUNT:          _fn(['dimname', 'hiername'],                           'numeric', 'Returns the total number of elements in a hierarchy.', V12),
  ELEMENTFIRST:          _fn(['dimname', 'hiername'],                           'string',  'Returns the first element name in a hierarchy.', V12),
  ELEMENTINDEX:          _fn(['dimname', 'hiername', 'element'],                'numeric', 'Returns the 1-based index of an element in a hierarchy.', V12),
  ELEMENTISANCESTOR:     _fn(['dimname', 'hiername', 'element', 'element'],     'numeric', 'Returns 1 if the first element is an ancestor of the second.', V12),
  ELEMENTISCOMPONENT:    _fn(['dimname', 'hiername', 'element', 'element'],     'numeric', 'Returns 1 if the second element is a component of the first.', V12),
  ELEMENTISPARENT:       _fn(['dimname', 'hiername', 'element', 'element'],     'numeric', 'Returns 1 if the first element is a direct parent of the second.', V12),
  ELEMENTLEVEL:          _fn(['dimname', 'hiername', 'element'],                'numeric', 'Returns the level of an element within a hierarchy (0 = leaf).', V12),
  ELEMENTNAME:           _fn(['dimname', 'hiername', 'n'],                      'string',  'Returns the element name at position n in a hierarchy.', V12),
  ELEMENTNEXT:           _fn(['dimname', 'hiername', 'element'],                'string',  'Returns the next element name in a hierarchy.', V12),
  ELEMENTPARENT:         _fn(['dimname', 'hiername', 'element', 'n'],           'string',  'Returns the Nth parent of an element in a hierarchy.', V12),
  ELEMENTPARENTCOUNT:    _fn(['dimname', 'hiername', 'element'],                'numeric', 'Returns the number of parents of an element.', V12),
  ELEMENTTYPE:           _fn(['dimname', 'hiername', 'element'],                'string',  "Returns the element type: 'N', 'S', or 'C'.", V12),
  ELEMENTWEIGHT:         _fn(['dimname', 'hiername', 'element', 'element'],     'numeric', 'Returns the weight of a child element within a parent in a hierarchy.', V12),

  // Attribute read
  ATTRN:        _fn(['dimname', 'element', 'attribute'],                 'numeric', 'Returns a numeric element attribute value.'),
  ATTRS:        _fn(['dimname', 'element', 'attribute'],                 'string',  'Returns a string element attribute value.'),
  ATTRL:        _fn(['dimname', 'element', 'attribute'],                 'string',  'Returns a locale-aware element attribute value.'),
  CUBEATTRN:    _fn(['cubename', 'attribute'],                           'numeric', 'Returns a numeric cube attribute value.'),
  CUBEATTRS:    _fn(['cubename', 'attribute'],                           'string',  'Returns a string cube attribute value.'),
  DIMENSIONATTRN: _fn(['dimname', 'attribute'],                          'numeric', 'Returns a numeric dimension attribute value.'),
  DIMENSIONATTRS: _fn(['dimname', 'attribute'],                          'string',  'Returns a string dimension attribute value.'),
  ELEMENTATTRN:   _fn(['dimname', 'hiername', 'element', 'attribute'],   'numeric', 'Returns a numeric element attribute value (hierarchy-aware).', V12),
  ELEMENTATTRS:   _fn(['dimname', 'hiername', 'element', 'attribute'],   'string',  'Returns a string element attribute value (hierarchy-aware).', V12),

  // Control
  STET:     _stmt([], 'Leaves the cell value unchanged; applies natural consolidation.'),
  CONTINUE: _stmt([], 'Passes control to the next matching rule for this cell.'),

  // Conditional
  IF: _fn(['condition', 'true_value', 'false_value'], 'any', 'Returns true_value if condition is non-zero, else false_value.'),

  // String functions
  CAPIT: _fn(['string'],                  'string',  'Capitalises the first letter of each word.'),
  CHAR:  _fn(['code'],                    'string',  'Returns the character for an ASCII code value.'),
  CODE:  _fn(['string', 'position'],      'numeric', 'Returns the ASCII code of the character at the given position.'),
  CONT:  _fn(['string1', 'string2'],      'numeric', 'Returns 1 if string2 is contained within string1.'),
  DELET: _fn(['string', 'start', 'length'], 'string', 'Deletes a substring from a string.'),
  FILL:  _fn(['string', 'length'],        'string',  'Repeats or truncates a string to the specified length.'),
  INSRT: _fn(['insert', 'string', 'position'], 'string', 'Inserts a string into another string at a position.'),
  LONG:  _fn(['string'],                  'numeric', 'Returns the length of a string.'),
  LOWER: _fn(['string'],                  'string',  'Converts a string to lowercase.'),
  LTRIM: _fn(['string'],                  'string',  'Removes leading whitespace from a string.'),
  NUMBR: _fn(['string'],                  'numeric', 'Converts a string to a number.'),
  RTRIM: _fn(['string'],                  'string',  'Removes trailing whitespace from a string.'),
  SCAN:  _fn(['find', 'within'],          'numeric', 'Returns the position of the first occurrence of find within within (0 = not found).'),
  SCANR: _fn(['find', 'within'],          'numeric', 'Returns the position of the last occurrence of find within within.'),
  STR:   _fn(['number', 'length', 'decimals'], 'string', 'Formats a number as a fixed-width string with specified decimal places.'),
  SUBST: _fn(['string', 'start', 'length'], 'string', 'Returns a substring starting at position start.'),
  TRIM:  _fn(['string'],                  'string',  'Removes leading and trailing whitespace from a string.'),
  UPPER: _fn(['string'],                  'string',  'Converts a string to uppercase.'),

  // Math / numeric
  ABS:   _fn(['number'],              'numeric', 'Returns the absolute value of a number.'),
  EXP:   _fn(['number'],              'numeric', 'Returns e raised to the power of number.'),
  INT:   _fn(['number'],              'numeric', 'Returns the integer portion of a number (truncates toward zero).'),
  LOG:   _fn(['number'],              'numeric', 'Returns the natural logarithm of a number.'),
  MAX:   _fn(['number1', 'number2'],  'numeric', 'Returns the larger of two numbers.'),
  MIN:   _fn(['number1', 'number2'],  'numeric', 'Returns the smaller of two numbers.'),
  MOD:   _fn(['number', 'divisor'],   'numeric', 'Returns the remainder of number divided by divisor.'),
  POWER: _fn(['base', 'exponent'],    'numeric', 'Returns base raised to the power of exponent.'),
  RAND:  _fn([],                      'numeric', 'Returns a random number between 0 and 1.'),
  ROUND: _fn(['number', 'decimals'],  'numeric', 'Rounds a number to the specified number of decimal places.'),
  SIGN:  _fn(['number'],              'numeric', 'Returns 1, 0, or -1 based on the sign of number.'),
  SQRT:  _fn(['number'],              'numeric', 'Returns the square root of a number.'),
}

// ── TurboIntegrator Functions ─────────────────────────────────────────────────
// Verified against IBM PA 2.0 docs (cubewise.com/functions-library). 2026-06-20.
const TI_CATALOG = {
  // Cell read/write
  CELLGETN:         _fn(['cubename', 'element*'],            'numeric', 'Returns a numeric value from a cube cell.'),
  CELLGETS:         _fn(['cubename', 'element*'],            'string',  'Returns a string value from a cube cell.'),
  CELLPUTN:        _stmt(['value', 'cubename', 'element*'],             'Writes a numeric value to a cube cell.'),
  CELLPUTS:        _stmt(['value', 'cubename', 'element*'],             'Writes a string value to a cube cell.'),
  CELLINCREMENTN:  _stmt(['value', 'cubename', 'element*'],             'Increments a numeric cube cell value by the given amount.'),
  CELLISUPDATEABLE: _fn(['cubename', 'element*'],            'numeric', 'Returns 1 if the cell is writeable by the current user.'),

  // Cube management
  CUBECREATE:           _stmt(['cubename', 'dimname*'],                    'Creates a new cube with the specified dimensions.'),
  CUBEDESTROY:          _stmt(['cubename'],                                'Deletes a cube and all its data permanently.'),
  CUBEEXISTS:            _fn(['cubename'],              'numeric',          'Returns 1 if the named cube exists.'),
  CUBESAVEDATA:         _stmt(['cubename'],                                'Serialises cube data to disk immediately.'),
  CUBETIMELASTUPDATED:   _fn(['cubename'],              'string',           'Returns the timestamp when the cube data was last updated.'),
  CUBEUNLOAD:           _stmt(['cubename'],                                'Unloads a cube from server memory.'),
  CUBESETLOGCHANGES:    _stmt(['cubename', 'value'],                       'Enables (1) or disables (0) transaction logging for a cube.'),
  CUBEPROCESSFEEDERS:   _stmt(['cubename'],                                'Reprocesses all feeders for a cube.'),
  CUBERULEAPPEND:       _stmt(['cubename', 'value', 'value'],              'Appends a rule string to a cube\'s existing rules.'),
  CUBERULEDESTROY:      _stmt(['cubename'],                                'Deletes all rules from a cube.'),

  // Dimension management
  DIMENSIONCREATE:                       _stmt(['dimname'],                                              'Creates a new dimension.'),
  DIMENSIONDESTROY:                      _stmt(['dimname'],                                              'Deletes a dimension and all associated elements.'),
  DIMENSIONEXISTS:                        _fn(['dimname'],                              'numeric',        'Returns 1 if the named dimension exists.'),
  DIMENSIONTIMELASTUPDATED:               _fn(['dimname'],                              'string',         'Returns the timestamp when the dimension was last modified.'),
  DIMENSIONUPDATEDIRECT:                 _stmt(['dimname'],                                              'Commits buffered dimension changes directly to the server.'),
  DIMENSIONHIERARCHYCREATE:              _stmt(['dimname', 'hiername'],                                  'Creates an alternate hierarchy within a dimension.', V12),
  DIMENSIONSORTORDER:                    _stmt(['dimname', 'value', 'value', 'value', 'value'],          'Sets the sort order for elements in a dimension.'),
  DIMENSIONDELETEALLELEMENTS:            _stmt(['dimname'],                                              'Deletes all elements from a dimension.'),
  DIMENSIONDELETEELEMENTS:               _stmt(['dimname', 'value'],                                    'Deletes elements matching a wildcard pattern from a dimension.'),
  DIMENSIONELEMENTINSERT:                _stmt(['dimname', 'element', 'value', 'value'],                'Inserts an element into a dimension (Metadata procedure).'),
  DIMENSIONELEMENTINSERTDIRECT:          _stmt(['dimname', 'element', 'value', 'value'],                'Inserts an element directly without buffering.'),
  DIMENSIONELEMENTDELETE:                _stmt(['dimname', 'element'],                                  'Deletes an element from a dimension.'),
  DIMENSIONELEMENTDELETEDIRECT:          _stmt(['dimname', 'element'],                                  'Deletes an element directly without buffering.'),
  DIMENSIONELEMENTEXISTS:                 _fn(['dimname', 'element'],                   'numeric',        'Returns 1 if the element exists in the dimension.'),
  DIMENSIONELEMENTPRINCIPALNAME:          _fn(['dimname', 'element'],                   'string',         'Returns the principal (canonical) name of an element.', V12),
  DIMENSIONELEMENTCOMPONENTADD:          _stmt(['dimname', 'element', 'element', 'value'],              'Adds a child element to a consolidation.'),
  DIMENSIONELEMENTCOMPONENTADDDIRECT:    _stmt(['dimname', 'element', 'element', 'value'],              'Adds a child to a consolidation directly without buffering.'),
  DIMENSIONELEMENTCOMPONENTDELETE:       _stmt(['dimname', 'element', 'element'],                       'Removes a child from a consolidation.'),
  DIMENSIONELEMENTCOMPONENTDELETEDIRECT: _stmt(['dimname', 'element', 'element'],                       'Removes a child from a consolidation directly without buffering.'),
  DIMENSIONTOPELEMENTINSERT:             _stmt(['dimname', 'element', 'value'],                         'Inserts an element at the top level of a dimension.'),
  DIMENSIONTOPELEMENTINSERTDIRECT:       _stmt(['dimname', 'element', 'value'],                         'Inserts a top-level element directly without buffering.'),

  // Hierarchy management (PA 2.0 / V12 only)
  HIERARCHYCREATE:                   _stmt(['dimname', 'hiername'],                                    'Creates an alternate hierarchy.', V12),
  HIERARCHYDESTROY:                  _stmt(['dimname', 'hiername'],                                    'Deletes an alternate hierarchy.', V12),
  HIERARCHYCONTAINSALLLEAVES:         _fn(['dimname', 'hiername'],                     'numeric',       'Returns 1 if every leaf in the default hierarchy is present.', V12),
  HIERARCHYDELETEALLELEMENTS:        _stmt(['dimname', 'hiername'],                                    'Deletes all elements from a hierarchy.', V12),
  HIERARCHYDELETEELEMENTS:           _stmt(['dimname', 'hiername', 'value'],                           'Deletes elements matching a pattern from a hierarchy.', V12),
  HIERARCHYELEMENTCOMPONENTADD:      _stmt(['dimname', 'hiername', 'element', 'element', 'value'],     'Adds a child to a consolidation in a specific hierarchy.', V12),
  HIERARCHYELEMENTCOMPONENTADDDIRECT:_stmt(['dimname', 'hiername', 'element', 'element', 'value'],     'Adds a child to a hierarchy consolidation directly.', V12),
  HIERARCHYELEMENTCOMPONENTDELETE:   _stmt(['dimname', 'hiername', 'element', 'element'],              'Removes a child from a consolidation in a specific hierarchy.', V12),
  HIERARCHYELEMENTCOMPONENTDELETEDIRECT:_stmt(['dimname', 'hiername', 'element', 'element'],           'Removes a hierarchy consolidation child directly.', V12),
  HIERARCHYELEMENTDELETE:            _stmt(['dimname', 'hiername', 'element'],                         'Deletes an element from a specific hierarchy.', V12),
  HIERARCHYELEMENTDELETEDIRECT:      _stmt(['dimname', 'hiername', 'element'],                         'Deletes a hierarchy element directly without buffering.', V12),
  HIERARCHYELEMENTEXISTS:             _fn(['dimname', 'hiername', 'element'],           'numeric',       'Returns 1 if the element exists in the hierarchy.', V12),

  // Process control
  EXECUTEPROCESS:       _fn(['value', 'value*'],     'numeric', 'Executes a TI process synchronously; returns 0 on success.'),
  RUNPROCESS:           _fn(['value', 'value*'],     'string',  'Executes a TI process in parallel; returns the Job ID.'),
  PROCESSEXISTS:        _fn(['value'],               'numeric', 'Returns 1 if the named process exists.'),
  GETPROCESSNAME:       _fn([],                      'string',  'Returns the name of the currently executing process.'),
  GETPROCESSERRORFILENAME: _fn([],                   'string',  'Returns the filename of the current process error log.'),
  LOGOUTPUT:           _stmt(['value', 'value'],                'Writes a message to the process log (severity, message).'),

  // Dimension / element info
  TABDIM:   _fn(['cubename', 'n'],          'string',  'Returns the name of the Nth dimension of a cube.'),
  DIMSIZ:   _fn(['dimname'],                'numeric', 'Returns the number of elements in a dimension.'),
  DIMNM:    _fn(['dimname', 'n'],           'string',  'Returns the name of the element at position n in a dimension.'),
  DIMIX:    _fn(['dimname', 'element'],     'numeric', 'Returns the 1-based index of an element in a dimension.'),
  DNEXT:    _fn(['dimname', 'element'],     'string',  'Returns the next element name in a dimension.'),
  DNLEV:    _fn(['dimname'],               'numeric', 'Returns the number of levels in a dimension.'),
  DTYPE:    _fn(['dimname', 'element'],     'string',  "Returns the element type: 'N', 'S', or 'C'."),

  // String / number utilities
  NUMBERTOSTRING: _fn(['value'],                         'string',  'Converts a numeric value to a string.'),
  NUMBERTOSTREX:  _fn(['value', 'value', 'value', 'value'], 'string', 'Converts a number to a formatted string (value, length, decimals, separator).'),
  STRINGTONUMBER: _fn(['value'],                         'numeric', 'Converts a string to a numeric value.'),
  STRINGTONUMEX:  _fn(['value', 'value', 'value'],       'numeric', 'Converts a formatted string to a number (value, decimals, separator).'),

  // Element info — classic (V11 compatible, no hierarchy parameter)
  ELCOMP:  _fn(['dimname', 'element', 'n'],          'string',  'Returns the Nth component of a consolidated element.'),
  ELCOMPN: _fn(['dimname', 'element'],               'numeric', 'Returns the number of components of a consolidated element.'),
  ELLEV:   _fn(['dimname', 'element'],               'numeric', 'Returns the level of an element (0 = leaf).'),
  ELPAR:   _fn(['dimname', 'element', 'n'],          'string',  'Returns the Nth parent of an element.'),
  ELPARN:  _fn(['dimname', 'element'],               'numeric', 'Returns the number of parents of an element.'),
  ELWEIGHT:_fn(['dimname', 'element', 'element'],    'numeric', 'Returns the weight of a child element within a parent.'),
  ELISANC: _fn(['dimname', 'element', 'element'],    'numeric', 'Returns 1 if the first element is an ancestor of the second.'),
  ELISCOMP:_fn(['dimname', 'element', 'element'],    'numeric', 'Returns 1 if the second element is a component of the first.'),
  ELISPAR: _fn(['dimname', 'element', 'element'],    'numeric', 'Returns 1 if the first element is a direct parent of the second.'),

  // Element info — hierarchy-aware (PA 2.0 / V12 only)
  ELEMENTCOMPONENT:      _fn(['dimname', 'hiername', 'element', 'n'],        'string',  'Returns the Nth component of a consolidated element (hierarchy-aware).', V12),
  ELEMENTCOMPONENTCOUNT: _fn(['dimname', 'hiername', 'element'],             'numeric', 'Returns the number of components of a consolidated element.', V12),
  ELEMENTCOUNT:          _fn(['dimname', 'hiername'],                        'numeric', 'Returns the total number of elements in a hierarchy.', V12),
  ELEMENTFIRST:          _fn(['dimname', 'hiername'],                        'string',  'Returns the first element name in a hierarchy.', V12),
  ELEMENTINDEX:          _fn(['dimname', 'hiername', 'element'],             'numeric', 'Returns the 1-based index of an element in a hierarchy.', V12),
  ELEMENTISANCESTOR:     _fn(['dimname', 'hiername', 'element', 'element'],  'numeric', 'Returns 1 if the first element is an ancestor of the second.', V12),
  ELEMENTISCOMPONENT:    _fn(['dimname', 'hiername', 'element', 'element'],  'numeric', 'Returns 1 if the second element is a component of the first.', V12),
  ELEMENTISPARENT:       _fn(['dimname', 'hiername', 'element', 'element'],  'numeric', 'Returns 1 if the first element is a direct parent of the second.', V12),
  ELEMENTLEVEL:          _fn(['dimname', 'hiername', 'element'],             'numeric', 'Returns the level of an element within a hierarchy (0 = leaf).', V12),
  ELEMENTNAME:           _fn(['dimname', 'hiername', 'n'],                   'string',  'Returns the element name at position n in a hierarchy.', V12),
  ELEMENTNEXT:           _fn(['dimname', 'hiername', 'element'],             'string',  'Returns the next element name in a hierarchy.', V12),
  ELEMENTPARENT:         _fn(['dimname', 'hiername', 'element', 'n'],        'string',  'Returns the Nth parent of an element in a hierarchy.', V12),
  ELEMENTPARENTCOUNT:    _fn(['dimname', 'hiername', 'element'],             'numeric', 'Returns the number of parents of an element.', V12),
  ELEMENTTYPE:           _fn(['dimname', 'hiername', 'element'],             'string',  "Returns the element type: 'N', 'S', or 'C'.", V12),
  ELEMENTWEIGHT:         _fn(['dimname', 'hiername', 'element', 'element'],  'numeric', 'Returns the weight of a child element within a parent in a hierarchy.', V12),

  // Attribute create/delete
  ATTRINSERT:       _stmt(['dimname', 'attribute', 'value'],                         "Creates a dimension attribute. Type: 'String', 'Numeric', or 'Alias'."),
  ATTRDELETE:       _stmt(['dimname', 'attribute'],                                  'Deletes a dimension attribute.'),
  ELEMENTATTRINSERT:_stmt(['dimname', 'hiername', 'attribute', 'value'],             'Creates a hierarchy attribute (hierarchy-aware).', V12),
  ELEMENTATTRDELETE:_stmt(['dimname', 'hiername', 'attribute'],                      'Deletes a hierarchy attribute (hierarchy-aware).', V12),

  // Attribute read/write — classic (no hierarchy)
  ATTRPUTN: _stmt(['value', 'dimname', 'element', 'attribute'],              'Writes a numeric value to a dimension element attribute.'),
  ATTRPUTS: _stmt(['value', 'dimname', 'element', 'attribute'],              'Writes a string value to a dimension element attribute.'),
  ATTRN:     _fn(['dimname', 'element', 'attribute'],  'numeric',            'Returns a numeric element attribute value.'),
  ATTRS:     _fn(['dimname', 'element', 'attribute'],  'string',             'Returns a string element attribute value.'),

  // Attribute read/write — hierarchy-aware (V12)
  ELEMENTATTRPUTN: _stmt(['value', 'dimname', 'hiername', 'element', 'attribute'],   'Writes a numeric element attribute value (hierarchy-aware).', V12),
  ELEMENTATTRPUTS: _stmt(['value', 'dimname', 'hiername', 'element', 'attribute'],   'Writes a string element attribute value (hierarchy-aware).', V12),
  ELEMENTATTRN:     _fn(['dimname', 'hiername', 'element', 'attribute'],  'numeric',  'Returns a numeric element attribute value (hierarchy-aware).', V12),
  ELEMENTATTRS:     _fn(['dimname', 'hiername', 'element', 'attribute'],  'string',   'Returns a string element attribute value (hierarchy-aware).', V12),

  // Cube / dimension attributes
  CUBEATTRN:      _fn(['cubename', 'attribute'],  'numeric', 'Returns a numeric cube attribute value.'),
  CUBEATTRS:      _fn(['cubename', 'attribute'],  'string',  'Returns a string cube attribute value.'),
  DIMENSIONATTRN: _fn(['dimname', 'attribute'],   'numeric', 'Returns a numeric dimension attribute value.'),
  DIMENSIONATTRS: _fn(['dimname', 'attribute'],   'string',  'Returns a string dimension attribute value.'),
}

// ── Function keyword snippets ─────────────────────────────────────────────────
// Shown when typing a function name (not inside a call).
// Format: { label, snippet, detail }
const TI_KEYWORDS = [
  // Cell
  { label: 'CellPutN',      snippet: 'CellPutN(${1:value}, ${2:cube}, ${3:elements});',             detail: 'Write numeric cell value' },
  { label: 'CellPutS',      snippet: 'CellPutS(${1:value}, ${2:cube}, ${3:elements});',             detail: 'Write string cell value' },
  { label: 'CellGetN',      snippet: 'CellGetN(${1:cube}, ${2:elements})',                          detail: 'Read numeric cell value' },
  { label: 'CellGetS',      snippet: 'CellGetS(${1:cube}, ${2:elements})',                          detail: 'Read string cell value' },
  { label: 'CellIncrementN',snippet: 'CellIncrementN(${1:value}, ${2:cube}, ${3:elements});',       detail: 'Increment numeric cell value' },
  // Cube
  { label: 'CubeCreate',    snippet: 'CubeCreate(${1:CubeName}, ${2:Dim1}, ${3:Dim2});',            detail: 'Create a new cube' },
  { label: 'CubeDestroy',   snippet: 'CubeDestroy(${1:CubeName});',                                 detail: 'Delete a cube' },
  { label: 'CubeExists',    snippet: 'CubeExists(${1:CubeName})',                                   detail: 'Returns 1 if cube exists' },
  { label: 'CubeSaveData',  snippet: 'CubeSaveData(${1:CubeName});',                                detail: 'Serialize cube data to disk' },
  { label: 'CubeUnload',    snippet: 'CubeUnload(${1:CubeName});',                                  detail: 'Unload cube from memory' },
  { label: 'CubeProcessFeeders', snippet: 'CubeProcessFeeders(${1:CubeName});',                     detail: 'Reprocess all cube feeders' },
  // Dimension
  { label: 'DimensionCreate',   snippet: 'DimensionCreate(${1:DimName});',                          detail: 'Create a new dimension' },
  { label: 'DimensionDestroy',  snippet: 'DimensionDestroy(${1:DimName});',                         detail: 'Delete a dimension' },
  { label: 'DimensionExists',   snippet: 'DimensionExists(${1:DimName})',                           detail: 'Returns 1 if dimension exists' },
  { label: 'DimensionElementInsert',       snippet: "DimensionElementInsert(${1:DimName}, '${2:InsertBefore}', '${3:ElName}', '${4:N}');",    detail: 'Add element (Metadata procedure)' },
  { label: 'DimensionElementInsertDirect', snippet: "DimensionElementInsertDirect(${1:DimName}, '${2:InsertBefore}', '${3:ElName}', '${4:N}');", detail: 'Add element directly' },
  { label: 'DimensionElementDelete',       snippet: 'DimensionElementDelete(${1:DimName}, ${2:ElName});',  detail: 'Delete element' },
  { label: 'DimensionElementExists',       snippet: 'DimensionElementExists(${1:DimName}, ${2:ElName})',   detail: 'Returns 1 if element exists' },
  { label: 'DimensionElementComponentAdd', snippet: 'DimensionElementComponentAdd(${1:DimName}, ${2:Parent}, ${3:Child}, ${4:1});', detail: 'Add child to consolidation' },
  // Process control
  { label: 'ExecuteProcess',  snippet: "ExecuteProcess('${1:ProcessName}');",                       detail: 'Run another TI process (synchronous)' },
  { label: 'RunProcess',      snippet: "RunProcess('${1:ProcessName}')",                            detail: 'Run TI process in parallel, returns JobID' },
  { label: 'ItemSkip',        snippet: 'ItemSkip;',                                                 detail: 'Skip current data source record' },
  { label: 'ItemReject',      snippet: "ItemReject('${1:ErrorMessage}');",                          detail: 'Reject record and write to error log' },
  { label: 'ProcessBreak',    snippet: 'ProcessBreak;',                                             detail: 'Stop data processing, jump to Epilog' },
  { label: 'ProcessError',    snippet: 'ProcessError;',                                             detail: 'Immediately terminate process' },
  { label: 'ProcessQuit',     snippet: 'ProcessQuit;',                                              detail: 'Terminate process' },
  { label: 'ProcessRollback', snippet: 'ProcessRollback;',                                          detail: 'Rollback and restart process' },
  { label: 'ProcessExists',   snippet: "ProcessExists('${1:ProcessName}')",                         detail: 'Returns 1 if process exists' },
  // Control flow
  { label: 'If',    snippet: 'If(${1:condition});\n\t${2}\nEndIf;',                                 detail: 'Conditional block' },
  { label: 'While', snippet: 'While(${1:condition});\n\t${2}\nEnd;',                                detail: 'Loop while condition is true' },
  // Attributes
  { label: 'AttrPutN', snippet: "AttrPutN(${1:value}, '${2:DimName}', '${3:Element}', '${4:Attribute}');",  detail: 'Write numeric element attribute' },
  { label: 'AttrPutS', snippet: "AttrPutS('${1:value}', '${2:DimName}', '${3:Element}', '${4:Attribute}');", detail: 'Write string element attribute' },
  // Misc
  { label: 'ASCIIOutput', snippet: "ASCIIOutput('${1:filename.txt}', ${2:value});",                 detail: 'Write line to ASCII file' },
  { label: 'ASCIIInput',  snippet: "ASCIIInput('${1:filename.txt}', ${2:delimiter});",              detail: 'Read from ASCII file' },
  { label: 'GetProcessName',    snippet: 'GetProcessName()',                                        detail: 'Returns current process name' },
  { label: 'GetProcessErrorFilename', snippet: 'GetProcessErrorFilename',                           detail: 'Returns error log filename' },
  { label: 'Synchronized', snippet: "Synchronized('${1:lockName}');",                              detail: 'Serialize parallel process execution' },
]

const RULES_KEYWORDS = [
  { label: 'DB',      snippet: "DB('${1:cube}', ${2:elements})",                 detail: 'Get value from cube (Rules only)' },
  { label: 'SKIPCHECK', snippet: 'SKIPCHECK;',                                   detail: 'Skip zero-value feeders check' },
  { label: 'UNDEFVALS', snippet: 'UNDEFVALS;',                                   detail: 'Enable undefined cell values' },
  { label: 'FEEDER',  snippet: '${1:source} => ${2:target};',                    detail: 'Define a feeder' },
  { label: 'IF',      snippet: 'IF(${1:condition}, ${2:true_value}, ${3:false_value})', detail: 'Conditional expression (Rules)' },
  { label: 'ISLEAF',  snippet: 'ISLEAF',                                         detail: 'Returns 1 if current cell is a leaf' },
]

// ── Context detector ──────────────────────────────────────────────────────────
// Walk forward through text tracking nested calls and string state.
// Returns { fn, paramIdx } of the innermost function the cursor is inside, or null.

export function getCallContext(textBefore) {
  const stack = []   // [{ fn, commas }]
  let inStr  = false
  let strCh  = null

  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i]

    if (inStr) {
      if (ch === strCh && textBefore[i - 1] !== '\\') inStr = false
      continue
    }

    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue }

    if (ch === '(') {
      const fnMatch = textBefore.slice(0, i).match(/([A-Za-z_]\w*)\s*$/)
      stack.push({ fn: fnMatch ? fnMatch[1].toUpperCase() : null, commas: 0 })
    } else if (ch === ')') {
      stack.pop()
    } else if (ch === ',' && stack.length > 0) {
      stack[stack.length - 1].commas++
    }
  }

  if (!stack.length) return null
  const top = stack[stack.length - 1]
  return top.fn ? { fn: top.fn, paramIdx: top.commas } : null
}

// Resolve the parameter type for a given function + param index
function resolveParamType(catalog, fn, paramIdx) {
  const entry = catalog[fn]
  if (!entry) return null
  const params = entry.params ?? []
  if (paramIdx < params.length) {
    const t = params[paramIdx]
    return t.endsWith('*') ? t.slice(0, -1) : t
  }
  const last = params[params.length - 1]
  return last?.endsWith('*') ? last.slice(0, -1) : null
}

// ── In-memory cache (30s cubes/dims, 60s cube-dims) ─────────────────────────
const _cache = new Map()
function _cached(key, ttlMs, fn) {
  const now  = Date.now()
  const hit  = _cache.get(key)
  if (hit && now - hit.t < ttlMs) return Promise.resolve(hit.v)
  return fn().then(v => { _cache.set(key, { v, t: Date.now() }); return v })
}

const enc = encodeURIComponent
const authFetch = (url) => fetch(url, { headers: { 'x-ide-token': localStorage.getItem('tm1-token') ?? '' } })

async function fetchCubes(server) {
  return _cached(`cubes:${server}`, 30_000, async () => {
    const r = await authFetch(`/api/cubes?server=${enc(server)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchDims(server) {
  return _cached(`dims:${server}`, 30_000, async () => {
    const r = await authFetch(`/api/dimensions?server=${enc(server)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchCubeDims(server, cube) {
  return _cached(`cubedims:${server}:${cube}`, 60_000, async () => {
    const r = await authFetch(`/api/cube/dimensions?server=${enc(server)}&cube=${enc(cube)}`)
    return r.ok ? r.json() : []
  })
}

async function fetchElements(server, dim) {
  return _cached(`elements:${server}:${dim}`, 60_000, async () => {
    const r = await authFetch(`/api/elements?server=${enc(server)}&dimension=${enc(dim)}`)
    return r.ok ? r.json() : []
  })
}

// Returns true if textBefore ends inside an unclosed quoted string
function isInsideString(textBefore) {
  let inStr = false, strCh = null
  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i]
    if (inStr) {
      if (ch === strCh && textBefore[i - 1] !== '\\') inStr = false
      continue
    }
    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue }
  }
  return inStr
}

// Returns the string value of the Nth argument of the innermost unclosed call
function extractStringArg(textBefore, argIndex) {
  const stack = []
  let inStr = false, strCh = null
  for (let i = 0; i < textBefore.length; i++) {
    const ch = textBefore[i]
    if (inStr) {
      if (ch === strCh && textBefore[i - 1] !== '\\') inStr = false
      continue
    }
    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; continue }
    if (ch === '(') stack.push(i)
    else if (ch === ')') stack.pop()
  }
  if (!stack.length) return null
  const inside = textBefore.slice(stack[stack.length - 1] + 1)

  let args = [], current = '', depth = 0
  inStr = false; strCh = null
  for (const ch of inside) {
    if (inStr) {
      if (ch === strCh) inStr = false
      current += ch
      continue
    }
    if (ch === "'" || ch === '"') { inStr = true; strCh = ch; current += ch; continue }
    if (ch === '(' || ch === '[') { depth++; current += ch }
    else if ((ch === ')' || ch === ']') && depth > 0) { depth--; current += ch }
    else if (ch === ',' && depth === 0) { args.push(current.trim()); current = '' }
    else { current += ch }
  }
  args.push(current.trim())

  const arg = args[argIndex]
  if (!arg) return null
  const m = arg.match(/^['"](.+)['"]$/)
  return m ? m[1] : null
}

// Functions where param 0 is cubename and params 1+ are element positions
const CUBE_FIRST_FNS = new Set([
  'DB', 'DBS', 'CELLVALUEN', 'CELLVALUES', 'CELLGETN', 'CELLGETS',
  'CELLPUTN', 'CELLPUTS', 'CELLINCREMENTN',
])

// ── Provider factory ─────────────────────────────────────────────────────────

export function registerTM1Completions(monaco, language, catalog, keywords, getServer) {
  const CIK = monaco.languages.CompletionItemKind

  return monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ["'", '"', '(', ',', ' '],

    provideCompletionItems: async (model, position) => {
      const server = getServer()
      if (!server) return { suggestions: [] }

      const textBefore = model.getValueInRange({
        startLineNumber: 1, startColumn: 1,
        endLineNumber: position.lineNumber, endColumn: position.column,
      })

      const word  = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
        startColumn: word.startColumn, endColumn: word.endColumn,
      }

      const ctx = getCallContext(textBefore)

      // ── Keyword/snippet suggestions (not inside a call) ───────────────────
      if (!ctx) {
        if (!word.word) return { suggestions: [] }
        const typed = word.word.toUpperCase()
        return {
          suggestions: keywords
            .filter(k => k.label.toUpperCase().startsWith(typed))
            .map(k => ({
              label:       k.label,
              kind:        CIK.Function,
              detail:      k.detail,
              insertText:  k.snippet,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
            })),
        }
      }

      const paramType = resolveParamType(catalog, ctx.fn, ctx.paramIdx)
      if (!paramType) return { suggestions: [] }

      // ── Cube name parameter ───────────────────────────────────────────────
      if (paramType === 'cubename') {
        const cubes = await fetchCubes(server)

        // Offer full snippet expansion for cell-access functions
        const isExpandable = [
          'DB', 'CELLPUTN', 'CELLPUTS', 'CELLGETN', 'CELLGETS', 'CELLINCREMENTN',
          'CELLVALUEN', 'CELLVALUES',
        ].includes(ctx.fn)

        if (isExpandable) {
          const suggestions = await Promise.all(cubes.map(async cube => {
            const dims = await fetchCubeDims(server, cube)
            const dimStops = dims.map((d, i) => `\${${i + 1}:!${d}}`).join(', ')
            const detail = dims.length ? `${dims.length} dims: ${dims.join(', ')}` : 'No dimensions'

            return {
              label:       { label: cube, description: detail },
              kind:        CIK.Module,
              detail,
              documentation: { value: `**${cube}**\n\nDimensions (in order):\n${dims.map((d, i) => `${i + 1}. ${d}`).join('\n')}` },
              insertText:  dimStops ? `${cube}', ${dimStops}` : `${cube}'`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText:    cube,
            }
          }))
          return { suggestions }
        }

        return {
          suggestions: cubes.map(cube => ({
            label:      cube,
            kind:       CIK.Module,
            insertText: cube,
            range,
          })),
        }
      }

      // ── Dimension name parameter ──────────────────────────────────────────
      if (paramType === 'dimname') {
        const dims = await fetchDims(server)
        return {
          suggestions: dims.map(dim => ({
            label:      dim,
            kind:       CIK.Class,
            detail:     'Dimension',
            insertText: dim,
            range,
          })),
        }
      }

      // ── Element parameter ─────────────────────────────────────────────────
      if (paramType === 'element') {
        const inQuote = isInsideString(textBefore)
        let targetDim = null

        if (CUBE_FIRST_FNS.has(ctx.fn)) {
          const cubeName = extractStringArg(textBefore, 0)
          if (cubeName) {
            const dims = await fetchCubeDims(server, cubeName)
            targetDim = dims[ctx.paramIdx - 1] ?? null
          }
        } else {
          // dim-first functions (ATTRN, ELPAR, etc.) — dim name is at arg 0
          targetDim = extractStringArg(textBefore, 0)
        }

        if (!targetDim) return { suggestions: [] }

        if (inQuote) {
          const ETYPE = { N: 'Numeric', C: 'Consolidated', S: 'String' }
          const elements = await fetchElements(server, targetDim)
          return {
            suggestions: elements.map(el => ({
              label:      el.Name,
              kind:       CIK.Value,
              detail:     ETYPE[el.Type] ?? el.Type,
              insertText: el.Name,
              range,
            })),
          }
        }

        // Not inside a quote — suggest !DimName element reference
        return {
          suggestions: [{
            label:      `!${targetDim}`,
            kind:       CIK.Variable,
            detail:     `Current element — ${targetDim}`,
            insertText: `!${targetDim}`,
            range,
            sortText:   '!',
          }],
        }
      }

      return { suggestions: [] }
    },
  })
}

// ── Convenience registrations ─────────────────────────────────────────────────

export { RULES_CATALOG, TI_CATALOG }

export function registerRulesCompletions(monaco, getServer) {
  return registerTM1Completions(monaco, 'tm1rules', RULES_CATALOG, RULES_KEYWORDS, getServer)
}

export function registerTICompletions(monaco, getServer) {
  return registerTM1Completions(monaco, 'tm1ti', TI_CATALOG, TI_KEYWORDS, getServer)
}
