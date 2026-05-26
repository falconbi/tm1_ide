// ── TM1 Snippet data ──────────────────────────────────────────────────────────
// code uses Monaco snippet syntax: ${N:placeholder}, ${0} = final cursor.
// The panel strips markers before insertion; autocomplete uses them as tab stops.

const S = (trigger, label, description, category, language, code) =>
  ({ trigger, label, description, category, language, code })

// ── Rules snippets ────────────────────────────────────────────────────────────

const RULES = [

  // Structure
  S('region',   '#Region block',          'Collapsible named code region',                             'Structure', 'rules',
    `#Region \${1:RegionName}\n\n\${2:['Element'] = value}\n\n#EndRegion \${1:RegionName}`),

  S('feeders',  'FEEDERS section',        'Start the feeders section of the rules file',               'Structure', 'rules',
    `FEEDERS;\n\n\${0}`),

  S('skip',     'SKIPCHECK',              'Disable consolidation check for this rules file',            'Structure', 'rules',
    `SKIPCHECK;\n\${0}`),

  S('comment',  'Comment block',          'Multi-line comment block',                                  'Structure', 'rules',
    `#==============================================================\n# \${1:Section name}\n#==============================================================\n\${0}`),

  // Conditionals
  S('if',       'IF / ENDIF',             'Simple conditional block',                                  'Conditionals', 'rules',
    `IF(\${1:condition});\n  \${2:['Element'] = value}\nENDIF;\n\${0}`),

  S('ife',      'IF / ELSE / ENDIF',      'Conditional with else branch',                              'Conditionals', 'rules',
    `IF(\${1:condition});\n  \${2:['Element'] = value1}\nELSE;\n  \${3:['Element'] = value2}\nENDIF;\n\${0}`),

  S('ifei',     'IF / ELSEIF / ELSE',     'Multi-branch conditional',                                  'Conditionals', 'rules',
    `IF(\${1:condition1});\n  \${2:['Element'] = value1}\nELSEIF(\${3:condition2});\n  \${4:['Element'] = value2}\nELSE;\n  \${5:['Element'] = value3}\nENDIF;\n\${0}`),

  // DB References
  S('db',       'DB() numeric',           'Read a numeric value from another cube',                    'DB References', 'rules',
    `DB('\${1:CubeName}', \${2:!dim1}, \${3:!dim2})`),

  S('dbs',      'DBS() string',           'Read a string value from another cube',                     'DB References', 'rules',
    `DBS('\${1:CubeName}', \${2:!dim1}, \${3:!dim2})`),

  S('dbn',      'N: DB() rule',           'Numeric rule using DB reference',                           'DB References', 'rules',
    `N: ['\${1:Element}'] = DB('\${2:CubeName}', \${3:!dim1}, \${4:!dim2});\n\${0}`),

  S('dbc',      'C: DB() rule',           'Consolidated element rule using DB reference',              'DB References', 'rules',
    `C: ['\${1:Element}'] = DB('\${2:CubeName}', \${3:!dim1}, \${4:!dim2});\n\${0}`),

  S('attrs',    'ATTRS() string attr',    'Read a string attribute of an element',                     'DB References', 'rules',
    `ATTRS('\${1:Dimension}', \${2:!Element}, '\${3:AttributeName}')`),

  S('attrn',    'ATTRN() numeric attr',   'Read a numeric attribute of an element',                    'DB References', 'rules',
    `ATTRN('\${1:Dimension}', \${2:!Element}, '\${3:AttributeName}')`),

  S('attrl',    'ATTRL() locale attr',    'Read a locale-specific string attribute',                   'DB References', 'rules',
    `ATTRL('\${1:Dimension}', \${2:!Element}, '\${3:AttributeName}', '\${4:locale}')`),

  // FEEDERS
  S('feed',     'Simple feeder',          'Feed a target element or cube intersection',                'FEEDERS', 'rules',
    `['\${1:FeedingElement}'] => DB('\${2:FedCubeName}', \${3:!dim1}, \${4:!dim2});\n\${0}`),

  S('feedif',   'Conditional feeder',     'Only feed when a condition is met',                         'FEEDERS', 'rules',
    `IF(['\${1:Condition}'] <> 0);\n  ['\${2:FeedingElement}'] => DB('\${3:FedCube}', \${4:!dim1});\nENDIF;\n\${0}`),

  S('stet',     'STET feeder',            'Element feeds itself (prevents zeroing)',                   'FEEDERS', 'rules',
    `['\${1:Element}'] => STET;\n\${0}`),

  S('feeddb',   'DB source feeder',       'Feed from a DB() call result',                              'FEEDERS', 'rules',
    `DB('\${1:SourceCube}', \${2:!dim1}, \${3:!dim2}) => DB('\${4:TargetCube}', \${5:!dim1}, \${6:!dim2});\n\${0}`),

  // Element Functions
  S('ellev',    'ELLEV()',                'Level of an element in the hierarchy',                      'Element Functions', 'rules',
    `ELLEV('\${1:Dimension}', \${2:!Element})`),

  S('elcomp',   'ELCOMP()',               'Name of the Nth component of a consolidated element',       'Element Functions', 'rules',
    `ELCOMP('\${1:Dimension}', \${2:!Element}, \${3:index})`),

  S('elcompn',  'ELCOMPN()',              'Number of components of a consolidated element',            'Element Functions', 'rules',
    `ELCOMPN('\${1:Dimension}', \${2:!Element})`),

  S('elisanc',  'ELISANC()',              'True if first element is ancestor of second',               'Element Functions', 'rules',
    `ELISANC('\${1:Dimension}', '\${2:AncestorElement}', \${3:!ChildElement})`),

  S('elispar',  'ELISPAR()',              'True if first element is parent of second',                 'Element Functions', 'rules',
    `ELISPAR('\${1:Dimension}', '\${2:ParentElement}', \${3:!ChildElement})`),

  S('etype',    'ETYPE()',                'Type of element: N=numeric, C=consolidated, S=string',      'Element Functions', 'rules',
    `ETYPE('\${1:Dimension}', \${2:!Element})`),

  S('dimix',    'DIMIX()',                'Index position of an element in the dimension',             'Element Functions', 'rules',
    `DIMIX('\${1:Dimension}', \${2:!Element})`),

  S('dimnm',    'DIMNM()',                'Element name at a given index position',                    'Element Functions', 'rules',
    `DIMNM('\${1:Dimension}', \${2:index})`),

  S('dimsiz',   'DIMSIZ()',               'Total number of elements in a dimension',                   'Element Functions', 'rules',
    `DIMSIZ('\${1:Dimension}')`),

  S('tabdim',   'TABDIM()',               'Dimension name at a given position in a cube',              'Element Functions', 'rules',
    `TABDIM('\${1:CubeName}', \${2:position})`),

  // Math
  S('round',    'ROUND()',                'Round to N decimal places',                                 'Math', 'rules',
    `ROUND(\${1:value}, \${2:2})`),

  S('int',      'INT()',                  'Integer part of a number (truncate)',                       'Math', 'rules',
    `INT(\${1:value})`),

  S('mod',      'MOD()',                  'Modulus (remainder after division)',                        'Math', 'rules',
    `MOD(\${1:value}, \${2:divisor})`),

  S('power',    'POWER()',                'Raise a number to an exponent',                             'Math', 'rules',
    `POWER(\${1:base}, \${2:exponent})`),

  S('abs',      'ABS()',                  'Absolute value',                                            'Math', 'rules',
    `ABS(\${1:value})`),

  // Date
  S('today',    'TODAY()',                'Current date as a serial number',                           'Date', 'rules',
    `TODAY()`),

  S('year',     'YEAR()',                 'Year component of a date serial',                           'Date', 'rules',
    `YEAR(\${1:dateSerial})`),

  S('month',    'MONTH()',                'Month component of a date serial',                          'Date', 'rules',
    `MONTH(\${1:dateSerial})`),

  S('day',      'DAY()',                  'Day component of a date serial',                            'Date', 'rules',
    `DAY(\${1:dateSerial})`),

  S('date',     'DATE()',                 'Construct a date from year, month, day',                    'Date', 'rules',
    `DATE(\${1:year}, \${2:month}, \${3:day})`),
]

// ── TI snippets ───────────────────────────────────────────────────────────────

const TI = [

  // Control Flow
  S('if',       'IF / ENDIF',             'Simple conditional block',                                  'Control Flow', 'ti',
    `IF(\${1:condition});\n  \${2:# code}\nENDIF;\n\${0}`),

  S('ife',      'IF / ELSE / ENDIF',      'Conditional with else branch',                              'Control Flow', 'ti',
    `IF(\${1:condition});\n  \${2:# code}\nELSE;\n  \${3:# code}\nENDIF;\n\${0}`),

  S('ifei',     'IF / ELSEIF / ELSE',     'Multi-branch conditional',                                  'Control Flow', 'ti',
    `IF(\${1:condition1});\n  \${2:# code}\nELSEIF(\${3:condition2});\n  \${4:# code}\nELSE;\n  \${5:# code}\nENDIF;\n\${0}`),

  S('while',    'WHILE / END loop',       'Counted while loop with index variable',                   'Control Flow', 'ti',
    `nCount = 1;\nWHILE(nCount <= \${1:nTotal});\n  \${2:# loop body}\n  nCount = nCount + 1;\nEND;\n\${0}`),

  S('break',    'ProcessBreak',           'Skip remaining Data tab iterations and go to Epilog',      'Control Flow', 'ti',
    `ProcessBreak;\n\${0}`),

  S('quit',     'ProcessQuit',            'Terminate the process immediately',                        'Control Flow', 'ti',
    `ProcessQuit;\n\${0}`),

  // Datasource Setup
  S('ascii',    'ASCII datasource',       'Full ASCII file datasource setup (all variables)',          'Datasource Setup', 'ti',
    `DataSourceType = 'ASCII';\nDataSourceNameForServer = '\${1:C:\\\\path\\\\to\\\\file.csv}';\nDataSourceNameForClient = '\${1:C:\\\\path\\\\to\\\\file.csv}';\nDataSourceASCIIDelimiter = '\${2:,}';\nDataSourceASCIIQuoteCharacter = '"';\nDataSourceASCIIHeaderRecords = \${3:1};\nDataSourceASCIIDecimalSeparator = '.';\n\${0}`),

  S('odbc',     'ODBC datasource',        'ODBC connection with SQL query',                            'Datasource Setup', 'ti',
    `DataSourceType = 'ODBC';\nDataSourceNameForServer = '\${1:DSNName}';\nDataSourceNameForClient = '\${1:DSNName}';\nDataSourceQuery = '\${2:SELECT * FROM TableName}';\n\${0}`),

  S('cubeview', 'TM1 Cube view source',   'Use a TM1 cube view as the datasource',                    'Datasource Setup', 'ti',
    `DataSourceType = 'TM1CubeView';\nDataSourceNameForServer = '\${1:CubeName}';\nDataSourceNameForClient = '\${1:CubeName}';\nDataSourceView = '\${2:ViewName}';\n\${0}`),

  S('dimsubset','Dimension subset source','Use a TM1 dimension subset as the datasource',             'Datasource Setup', 'ti',
    `DataSourceType = 'TM1DimensionSubset';\nDataSourceNameForServer = '\${1:DimensionName}';\nDataSourceNameForClient = '\${1:DimensionName}';\nDataSourceDimensionSubset = '\${2:SubsetName}';\n\${0}`),

  // Dimension Operations
  S('dimcreate','DimensionCreate',        'Create a dimension if it does not exist',                  'Dimension Operations', 'ti',
    `IF(DimensionExists('\${1:DimensionName}') = 0);\n  DimensionCreate('\${1:DimensionName}');\nENDIF;\n\${0}`),

  S('dimdelete','DimensionDeleteAll',     'Delete all elements from a dimension',                     'Dimension Operations', 'ti',
    `DimensionDeleteAllElements('\${1:DimensionName}');\n\${0}`),

  S('dimexists','DimensionExists check',  'Branch on whether a dimension exists',                     'Dimension Operations', 'ti',
    `IF(DimensionExists('\${1:DimensionName}') = 0);\n  # dimension does not exist\nELSE;\n  # dimension exists\nENDIF;\n\${0}`),

  S('eleminsert','DimensionElementInsert N', 'Insert a simple (numeric leaf) element',               'Dimension Operations', 'ti',
    `DimensionElementInsert('\${1:DimensionName}', '', '\${2:ElementName}', 'N');\n\${0}`),

  S('eleminserts','DimensionElementInsert S','Insert a string element',                              'Dimension Operations', 'ti',
    `DimensionElementInsert('\${1:DimensionName}', '', '\${2:ElementName}', 'S');\n\${0}`),

  S('elemcons','Insert consolidated element','Insert a C element and set one child weight',          'Dimension Operations', 'ti',
    `DimensionElementInsert('\${1:DimensionName}', '', '\${2:ParentName}', 'C');\nElementConsolidationSet('\${1:DimensionName}', '\${2:ParentName}', '\${3:ChildName}', \${4:1});\n\${0}`),

  S('elemdelete','DimensionElementDelete','Delete an element from a dimension',                      'Dimension Operations', 'ti',
    `DimensionElementDelete('\${1:DimensionName}', '\${2:ElementName}');\n\${0}`),

  S('loopelems','Loop over all elements', 'Iterate every element in a dimension using DIMNM',        'Dimension Operations', 'ti',
    `nCount = 1;\nnTotal = DIMSIZ('\${1:DimensionName}');\nWHILE(nCount <= nTotal);\n  sElement = DIMNM('\${1:DimensionName}', nCount);\n  \${2:# process sElement}\n  nCount = nCount + 1;\nEND;\n\${0}`),

  S('loopcomps','Loop over C-element children','Iterate components of a consolidated element',       'Dimension Operations', 'ti',
    `nCount = 1;\nnTotal = ELCOMPN('\${1:DimensionName}', '\${2:ConsolidatedElement}');\nWHILE(nCount <= nTotal);\n  sElement = ELCOMP('\${1:DimensionName}', '\${2:ConsolidatedElement}', nCount);\n  \${3:# process sElement}\n  nCount = nCount + 1;\nEND;\n\${0}`),

  S('hierinsert','HierarchyElementInsert','Insert element into a specific hierarchy',                'Dimension Operations', 'ti',
    `HierarchyElementInsert('\${1:DimensionName}', '\${1:DimensionName}', '', '\${2:ElementName}', 'N');\n\${0}`),

  // Subsets
  S('subcreate', 'SubsetCreate',           'Create a subset (destroy first if it exists)',           'Subsets', 'ti',
    `IF(SubsetExists('\${1:DimensionName}', '\${2:SubsetName}') = 1);\n  SubsetDestroy('\${1:DimensionName}', '\${2:SubsetName}');\nENDIF;\nSubsetCreate('\${1:DimensionName}', '\${2:SubsetName}');\n\${0}`),

  S('submdx',   'SubsetCreateByMDX',       'Create a subset from an MDX expression',                'Subsets', 'ti',
    `IF(SubsetExists('\${1:DimensionName}', '\${2:SubsetName}') = 1);\n  SubsetDestroy('\${1:DimensionName}', '\${2:SubsetName}');\nENDIF;\nSubsetCreateByMDX('\${2:SubsetName}', '\${3:MDX}', '\${1:DimensionName}');\n\${0}`),

  S('subinsert','SubsetElementInsert',     'Insert an element into a subset at a given position',   'Subsets', 'ti',
    `SubsetElementInsert('\${1:DimensionName}', '\${2:SubsetName}', '\${3:ElementName}', \${4:1});\n\${0}`),

  S('subdestroy','SubsetDestroy',          'Destroy a subset if it exists',                          'Subsets', 'ti',
    `IF(SubsetExists('\${1:DimensionName}', '\${2:SubsetName}') = 1);\n  SubsetDestroy('\${1:DimensionName}', '\${2:SubsetName}');\nENDIF;\n\${0}`),

  S('subassign','ViewSubsetAssign',        'Assign a subset to a view dimension',                   'Subsets', 'ti',
    `ViewSubsetAssign('\${1:CubeName}', '\${2:ViewName}', '\${3:DimensionName}', '\${4:SubsetName}');\n\${0}`),

  // Attributes
  S('attrcreate','ElementAttributeCreate S','Create a string attribute on a dimension',             'Attributes', 'ti',
    `ElementAttributeCreate('\${1:DimensionName}', '\${2:AttributeName}', 'S');\n\${0}`),

  S('attrcreatein','ElementAttributeCreate N','Create a numeric attribute on a dimension',          'Attributes', 'ti',
    `ElementAttributeCreate('\${1:DimensionName}', '\${2:AttributeName}', 'N');\n\${0}`),

  S('attrputs', 'ElementAttrPutS',           'Set a string attribute value for an element',         'Attributes', 'ti',
    `ElementAttrPutS('\${1:DimensionName}', '\${2:ElementName}', '\${3:AttributeName}', '\${4:Value}');\n\${0}`),

  S('attrputn', 'ElementAttrPutN',           'Set a numeric attribute value for an element',         'Attributes', 'ti',
    `ElementAttrPutN('\${1:DimensionName}', '\${2:ElementName}', '\${3:AttributeName}', \${4:0});\n\${0}`),

  S('attrdelete','ElementAttributeDelete','Delete an attribute from a dimension',                   'Attributes', 'ti',
    `ElementAttributeDelete('\${1:DimensionName}', '\${2:AttributeName}');\n\${0}`),

  // Cube Operations
  S('cellputn', 'CellPutN',              'Write a numeric value into a cube',                        'Cube Operations', 'ti',
    `CellPutN(\${1:value}, '\${2:CubeName}', '\${3:Element1}', '\${4:Element2}');\n\${0}`),

  S('cellputs', 'CellPutS',              'Write a string value into a cube',                         'Cube Operations', 'ti',
    `CellPutS('\${1:value}', '\${2:CubeName}', '\${3:Element1}', '\${4:Element2}');\n\${0}`),

  S('cellgetn', 'CellGetN',              'Read a numeric value from a cube into a variable',         'Cube Operations', 'ti',
    `nValue = CellGetN('\${1:CubeName}', '\${2:Element1}', '\${3:Element2}');\n\${0}`),

  S('cellgets', 'CellGetS',              'Read a string value from a cube into a variable',          'Cube Operations', 'ti',
    `sValue = CellGetS('\${1:CubeName}', '\${2:Element1}', '\${3:Element2}');\n\${0}`),

  S('cellisup', 'CellIsUpdateable',      'Check if a cell can be written to',                        'Cube Operations', 'ti',
    `IF(CellIsUpdateable('\${1:CubeName}', '\${2:Element1}', '\${3:Element2}') = 1);\n  CellPutN(\${4:value}, '\${1:CubeName}', '\${2:Element1}', '\${3:Element2}');\nENDIF;\n\${0}`),

  S('viewcreate','ViewCreate (native)',   'Create a native cube view programmatically',              'Cube Operations', 'ti',
    `ViewCreate('\${1:CubeName}', '\${2:ViewName}');\nViewRowDimensionSet('\${1:CubeName}', '\${2:ViewName}', '\${3:RowDimension}');\nViewColumnDimensionSet('\${1:CubeName}', '\${2:ViewName}', '\${4:ColumnDimension}');\nViewExtractSkipRuleValuesSet('\${1:CubeName}', '\${2:ViewName}', 0);\n\${0}`),

  S('viewzero', 'ViewZeroOut',            'Zero all cells in a view (Bedrock pattern with cleanup)', 'Cube Operations', 'ti',
    `cProcName = GetProcessName();\ncView = 'TI Zero Out - ' | cProcName;\n\nIF(ViewExists('\${1:CubeName}', cView) = 1);\n  ViewDestroy('\${1:CubeName}', cView);\nENDIF;\nViewCreate('\${1:CubeName}', cView);\n\nViewZeroOut('\${1:CubeName}', cView);\n\nViewDestroy('\${1:CubeName}', cView);\n\${0}`),

  S('viewdestroy','ViewDestroy (safe)',   'Destroy a view if it exists',                             'Cube Operations', 'ti',
    `IF(ViewExists('\${1:CubeName}', '\${2:ViewName}') = 1);\n  ViewDestroy('\${1:CubeName}', '\${2:ViewName}');\nENDIF;\n\${0}`),

  S('viewsubset','ViewSubsetAssign',      'Assign a named subset to a view dimension slot',          'Cube Operations', 'ti',
    `ViewSubsetAssign('\${1:CubeName}', '\${2:ViewName}', '\${3:DimensionName}', '\${4:SubsetName}');\n\${0}`),

  // Process Control
  S('execp',    'ExecuteProcess',        'Run another TI process, passing parameters',               'Process Control', 'ti',
    `ExecuteProcess('\${1:ProcessName}', '\${2:pParam1}', \${3:value1});\n\${0}`),

  S('error',    'ProcessError',          'Log an error message and terminate with error status',     'Process Control', 'ti',
    `sErrorMsg = '\${1:Error description: }' | \${2:sVariable};\nLogOutput('ERROR', sErrorMsg);\nProcessError;\n\${0}`),

  S('errquit',  'Log error + ProcessQuit','Log a warning and quit without error status',            'Process Control', 'ti',
    `sMsg = '\${1:Warning: }' | \${2:sVariable};\nLogOutput('WARN', sMsg);\nProcessQuit;\n\${0}`),

  S('logmsg',   'LogOutput message',     'Write a message to the TM1 process log',                  'Process Control', 'ti',
    `LogOutput('\${1:INFO}', '\${2:Message: }' | \${3:sVariable});\n\${0}`),

  S('asciiout', 'ASCIIOutput to file',   'Append a delimited line to an ASCII log file',            'Process Control', 'ti',
    `ASCIIOutput('\${1:logfile.txt}', \${2:sField1}, \${3:sField2});\n\${0}`),

  S('setout',   'SetOutputDir + File',   'Set directory and filename for ASCIIOutput',              'Process Control', 'ti',
    `SetOutputDir('\${1:C:\\\\Logs\\\\}');\nASCIIOutput('\${2:logfile.txt}', 'Header');\n\${0}`),

  S('sleep',    'Sleep()',               'Pause execution for N milliseconds',                       'Process Control', 'ti',
    `Sleep(\${1:1000});\n\${0}`),

  S('secrefresh','SecurityRefresh',      'Reload TM1 security after user/group changes',            'Process Control', 'ti',
    `SecurityRefresh;\n\${0}`),

  S('getuser',  'GetCurrentUser',        'Get the name of the user running this process',           'Process Control', 'ti',
    `sUser = GetCurrentUser;\n\${0}`),

  S('getdate',  'Get current date parts','Get today\'s year, month, and day into variables',        'Process Control', 'ti',
    `nYear  = Year(Today);\nnMonth = Month(Today);\nnDay   = DayNo(Today);\n\${0}`),

  S('numtostr', 'NumberToString',         'Convert a number to a string',                            'Process Control', 'ti',
    `NumberToString(\${1:nValue})`),

  S('timst',    'TimSt timestamp',        'Format current time as a string (e.g. for log entries)',  'Process Control', 'ti',
    `TimSt(Now, '\\\\Y-\\\\m-\\\\d \\\\H:\\\\i:\\\\s')`),

  S('getpname', 'GetProcessName',         'Get the name of the currently running process',           'Process Control', 'ti',
    `cProcName = GetProcessName();\n\${0}`),

  S('geterrdir','GetProcessErrorFileDirectory','Get the server error log directory path',            'Process Control', 'ti',
    `cLogFile = GetProcessErrorFileDirectory() | '\${1:debug.log}';\n\${0}`),

  // Error handling patterns
  S('trycatch', 'Try / error-check pattern','Execute a process and check for errors',               'Process Control', 'ti',
    `nResult = ExecuteProcess('\${1:ProcessName}');\nIF(nResult <> ProcessExitNormal());\n  sMsg = 'Process \${1:ProcessName} failed — ' | STR(nResult, 5, 0);\n  LogOutput('ERROR', sMsg);\n  ProcessError;\nENDIF;\n\${0}`),
]

// ── Shared snippets (work in both Rules and TI) ───────────────────────────────

const SHARED = [
  S('subst',    'SUBST()',               'Extract a substring by position and length',               'String Functions', 'both',
    `SUBST(\${1:string}, \${2:start}, \${3:length})`),

  S('long',     'LONG()',                'Length of a string',                                       'String Functions', 'both',
    `LONG(\${1:string})`),

  S('trim',     'TRIM()',                'Remove leading and trailing spaces',                       'String Functions', 'both',
    `TRIM(\${1:string})`),

  S('ucase',    'UCASE()',               'Convert string to upper case',                             'String Functions', 'both',
    `UCASE(\${1:string})`),

  S('lcase',    'LCASE()',               'Convert string to lower case',                             'String Functions', 'both',
    `LCASE(\${1:string})`),

  S('numbr',    'NUMBR()',               'Convert a string to a number',                             'String Functions', 'both',
    `NUMBR(\${1:string})`),

  S('str',      'STR()',                 'Format a number as a string (width, decimals)',             'String Functions', 'both',
    `STR(\${1:value}, \${2:10}, \${3:2})`),

  S('scan',     'SCAN()',                'Find position of a substring within a string (0=not found)','String Functions', 'both',
    `SCAN('\${1:searchFor}', \${2:string})`),

  S('fill',     'FILL()',                'Pad or repeat a string to a given length',                 'String Functions', 'both',
    `FILL('\${1:char}', \${2:length})`),

  S('code',     'CODE()',                'ASCII code of the first character of a string',            'String Functions', 'both',
    `CODE(\${1:string})`),

  S('char',     'CHAR()',                'Character from an ASCII code number',                      'String Functions', 'both',
    `CHAR(\${1:65})`),
]

// ── Combined export ───────────────────────────────────────────────────────────

export const ALL_SNIPPETS = [...RULES, ...TI, ...SHARED]

export function getSnippets(language) {
  return ALL_SNIPPETS.filter(s => s.language === language || s.language === 'both')
}

// ── Monaco registration ───────────────────────────────────────────────────────

let _registered = false

export function registerTM1Snippets(monaco) {
  if (_registered) return
  _registered = true

  const langMap = { tm1rules: 'rules', tm1ti: 'ti' }

  Object.entries(langMap).forEach(([langId, langKey]) => {
    monaco.languages.registerCompletionItemProvider(langId, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position)
        const trigger = word.word.toLowerCase()
        if (!trigger) return { suggestions: [] }

        const range = {
          startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn,        endColumn: word.endColumn,
        }

        const suggestions = ALL_SNIPPETS
          .filter(s => s.language === langKey || s.language === 'both')
          .filter(s => s.trigger.startsWith(trigger) || s.label.toLowerCase().startsWith(trigger))
          .map(s => ({
            label:           s.label,
            kind:            monaco.languages.CompletionItemKind.Snippet,
            detail:          s.category,
            documentation:   { value: `**${s.label}**\n\n${s.description}` },
            insertText:      s.code,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText:        `z_${s.trigger}`,
            range,
          }))

        return { suggestions }
      },
    })
  })
}
