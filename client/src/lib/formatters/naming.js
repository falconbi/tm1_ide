// ── IBM TM1 Naming Dictionary ─────────────────────────────────────────────────
// Canonical IBM official capitalization for TM1 identifiers.
// Merges with user-defined custom entries and respects disabled defaults.

// ── Default IBM Official Names ──────────────────────────────────────────────

export const IBM_DEFAULTS = {
  // ── Rules keywords ──
  'if': 'IF',
  'elseif': 'ELSEIF',
  'else': 'ELSE',
  'endif': 'ENDIF',
  'continue': 'CONTINUE',
  'stet': 'STET',
  'feeders': 'FEEDERS',
  'skipcheck': 'SKIPCHECK',
  // ── Rules: Cube lookup ──
  'db': 'DB',
  'attrs': 'ATTRS',
  'attrn': 'ATTRN',
  'attrsl': 'ATTRSL',
  'cellgetn': 'CELLGETN',
  'cellgets': 'CELLGETS',
  'cellgetsn': 'CELLGETSN',
  'dnlev': 'DNLEV',
  'dnum': 'DNUM',
  'dtlev': 'DTLEV',
  'dtnum': 'DTNUM',
  'parel': 'PAREL',
  // ── Rules: Math ──
  'abs': 'ABS',
  'acos': 'ACOS',
  'asin': 'ASIN',
  'atan': 'ATAN',
  'cos': 'COS',
  'exp': 'EXP',
  'int': 'INT',
  'isund': 'ISUND',
  'ln': 'LN',
  'log': 'LOG',
  'max': 'MAX',
  'min': 'MIN',
  'mod': 'MOD',
  'rand': 'RAND',
  'round': 'ROUND',
  'roundp': 'ROUNDP',
  'sign': 'SIGN',
  'sin': 'SIN',
  'sqrt': 'SQRT',
  'tan': 'TAN',
  'undef': 'UNDEF',
  'undeffn': 'UNDEF',
  // ── Rules: Consolidation ──
  'consolidatedavg': 'CONSOLIDATEDAVG',
  'consolidatedcount': 'CONSOLIDATEDCOUNT',
  'consolidatedmax': 'CONSOLIDATEDMAX',
  'consolidatedmin': 'CONSOLIDATEDMIN',
  'consolidatedsum': 'CONSOLIDATEDSUM',
  // ── Rules: Date / Time ──
  'dat': 'DAT',
  'date': 'DATE',
  'dates': 'DATES',
  'day': 'DAY',
  'dayno': 'DAYNO',
  'month': 'MONTH',
  'now': 'NOW',
  'time': 'TIME',
  'timst': 'TIMST',
  'today': 'TODAY',
  'year': 'YEAR',
  // ── Rules: String ──
  'char': 'CHAR',
  'code': 'CODE',
  'delet': 'DELET',
  'fill': 'FILL',
  'insrt': 'INSRT',
  'long': 'LONG',
  'lower': 'LOWER',
  'numbertostring': 'NUMBERTOSTRING',
  'numbertostringex': 'NUMBERTOSTRINGEX',
  'scan': 'SCAN',
  'str': 'STR',
  'subst': 'SUBST',
  'trim': 'TRIM',
  'upper': 'UPPER',
  // ── Rules: Dimension / Element ──
  'cubeexists': 'CUBEEXISTS',
  'dimensionelementexists': 'DIMENSIONELEMENTEXISTS',
  'dimensionelementsortorder': 'DIMENSIONELEMENTSORTORDER',
  'dimensionhierarchysortorder': 'DIMENSIONHIERARCHYSORTORDER',
  'elcomp': 'ELCOMP',
  'elcompn': 'ELCOMPN',
  'ellev': 'ELLEV',
  'elisanc': 'ELISANC',
  'elispar': 'ELISPAR',
  'elisparc': 'ELISPARC',
  'elpar': 'ELPAR',
  'elparn': 'ELPARN',
  'elweight': 'ELWEIGHT',
  'tabdim': 'TABDIM',
  'tidy': 'TIDY',
  // ── Rules: Logging ──
  'logoutput': 'LOGOUTPUT',

  // ── TI Process: Control flow ──
  'while': 'While',
  'end': 'End',
  'break': 'Break',
  'executeprocess': 'ExecuteProcess',
  'processreturncode': 'ProcessReturnCode',
  'processerror': 'ProcessError',
  'processbreak': 'ProcessBreak',
  'processcontinue': 'ProcessContinue',
  'processexit': 'ProcessExit',
  // ── TI Process: Data source / ASCII ──
  'asciidelete': 'AsciiDelete',
  'asciioutput': 'AsciiOutput',
  'asciiread': 'AsciiRead',
  'asctowide': 'AscToWide',
  'filedelete': 'FileDelete',
  'fileexists': 'FileExists',
  'removedirectory': 'RemoveDirectory',
  'textoutput': 'TextOutput',
  'widedelete': 'WideDelete',
  'wideread': 'WideRead',
  'widetoasc': 'WideToAsc',
  'read': 'Read',
  'write': 'Write',
  // ── TI Process: Cell operations ──
  'batchupdatefinish': 'BatchUpdateFinish',
  'batchupdatestart': 'BatchUpdateStart',
  'cellincrementn': 'CellIncrementN',
  'cellputn': 'CellPutN',
  'cellputs': 'CellPutS',
  'cellputsn': 'CellPutSN',
  'cellsetdn': 'CellSetDN',
  'cellsetds': 'CellSetDS',
  // ── TI Process: Cube operations ──
  'cubecreate': 'CubeCreate',
  'cubecomponentadd': 'CubeComponentAdd',
  'cubecomponentdelete': 'CubeComponentDelete',
  'cubecreatedatacopy': 'CubeCreateDataCopy',
  'cubedatacopy': 'CubeDataCopy',
  'cubedestroy': 'CubeDestroy',
  'cubesaveas': 'CubeSaveAs',
  'cubesetlogchanges': 'CubeSetLogChanges',
  'rulesloadoptimization': 'RulesLoadOptimization',
  // ── TI Process: Dimension operations ──
  'dimensioncreate': 'DimensionCreate',
  'dimensiondeleteallelements': 'DimensionDeleteAllElements',
  'dimensiondestroy': 'DimensionDestroy',
  'dimensionelementcomponentadd': 'DimensionElementComponentAdd',
  'dimensionelementcomponentdelete': 'DimensionElementComponentDelete',
  'dimensionelementcreate': 'DimensionElementCreate',
  'dimensionelementdelete': 'DimensionElementDelete',
  'dimensionelementinsert': 'DimensionElementInsert',
  'dimensiontopelementinsert': 'DimensionTopElementInsert',
  'dimensionsortorder': 'DimensionSortOrder',
  // ── TI Process: Element operations ──
  'elementcomponentadd': 'ElementComponentAdd',
  'elementcomponentdelete': 'ElementComponentDelete',
  'elementcreate': 'ElementCreate',
  'elementdelete': 'ElementDelete',
  'elementinsert': 'ElementInsert',
  'elementtype': 'ElementType',
  'elementupdate': 'ElementUpdate',
  'newelementinsert': 'NewElementInsert',
  'setelement': 'SetElement',
  // ── TI Process: Element attributes ──
  'elementattributedelete': 'ElementAttributeDelete',
  'elementattributeinsert': 'ElementAttributeInsert',
  'elementattributegetn': 'ElementAttributeGetN',
  'elementattributegets': 'ElementAttributeGetS',
  'elementattributeputn': 'ElementAttributePutN',
  'elementattributeputs': 'ElementAttributePutS',
  // ── TI Process: Hierarchy operations (v2 REST) ──
  'hierarchycreate': 'HierarchyCreate',
  'hierarchydestroy': 'HierarchyDestroy',
  'hierarchyelementcomponentadd': 'HierarchyElementComponentAdd',
  'hierarchyelementcomponentdelete': 'HierarchyElementComponentDelete',
  'hierarchyelementcreate': 'HierarchyElementCreate',
  'hierarchyelementdelete': 'HierarchyElementDelete',
  'hierarchyelementinsert': 'HierarchyElementInsert',
  // ── TI Process: Subset operations ──
  'subsetcreate': 'SubsetCreate',
  'subsetaliasgetsort': 'SubsetAliasGetSort',
  'subsetaliasset': 'SubsetAliasSet',
  'subsetdeleteallelements': 'SubsetDeleteAllElements',
  'subsetelementdelete': 'SubsetElementDelete',
  'subsetelementinsert': 'SubsetElementInsert',
  'subsetexists': 'SubsetExists',
  'subsetgetelement': 'SubsetGetElement',
  'subsetgetelementname': 'SubsetGetElementName',
  'subsetgetsize': 'SubsetGetSize',
  'subsetmdxset': 'SubsetMDXSet',
  'subsettomdx': 'SubsetToMDX',
  'subsetisallset': 'SubsetIsAllSet',
  'createtemporarysubsetbymdx': 'CreateTemporarySubsetByMDX',
  // ── TI Process: View operations ──
  'viewcreate': 'ViewCreate',
  'viewdestroy': 'ViewDestroy',
  'viewexists': 'ViewExists',
  'viewconstruct': 'ViewConstruct',
  'viewextract': 'ViewExtract',
  'publishview': 'PublishView',
  'unpublishview': 'UnPublishView',
  'refreshmdxview': 'RefreshMDXView',
  'viewcolumnsuppresszeroset': 'ViewColumnSuppressZeroSet',
  'viewrowsuppresszeroset': 'ViewRowSuppressZeroSet',
  'viewextractskipcalcsset': 'ViewExtractSkipCalcsSet',
  'viewextractskipconsolidatedstringset': 'ViewExtractSkipConsolidatedStringSet',
  'viewextractskiprulevaluesset': 'ViewExtractSkipRuleValuesSet',
  'viewextractskipzeroesset': 'ViewExtractSkipZeroesSet',
  'viewsetdn': 'ViewSetDN',
  'viewsetds': 'ViewSetDS',
  'viewsubsetassign': 'ViewSubsetAssign',
  'viewtitlesubsetassign': 'ViewTitleSubsetAssign',
  // ── TI Process: Security ──
  'addclient': 'AddClient',
  'deleteclient': 'DeleteClient',
  'assignclienttogroup': 'AssignClientToGroup',
  'removeclientfromgroup': 'RemoveClientFromGroup',
  'addgroup': 'AddGroup',
  'deletegroup': 'DeleteGroup',
  'assigngrouptoroles': 'AssignGroupToRoles',
  'removegroupfromroles': 'RemoveGroupFromRoles',
  'securityrefresh': 'SecurityRefresh',
  'setpwd': 'SetPWD',
  // ── TI Process: Chore / server ──
  'choreerror': 'ChoreError',
  'getcurrentuser': 'GetCurrentUser',
  'sleep': 'Sleep',
  'serverrename': 'ServerRename',
  'servershutdown': 'ServerShutdown',
  // ── TI Process: Tailors ──
  'getusenamedtailors': 'GetUseNamedTailors',
  'setnamedtailor': 'SetNamedTailor',
  'setusenamedtailors': 'SetUseNamedTailors',
  'numberoftailors': 'NumberOfTailors',
  // ── TI Process: Locking / misc ──
  'lock': 'Lock',
  'lockname': 'LockName',
  'periods': 'Periods',
  'error': 'Error',
  'itemreject': 'ItemReject',
  'itemskip': 'ItemSkip',
  'save': 'Save',

  // ── MDX: TM1-specific functions ──
  'tm1subsetall': 'TM1SubsetAll',
  'tm1subsettoset': 'TM1SubsetToSet',
  'tm1elementlisttoset': 'TM1ElementListToSet',
  'tm1filterbylevel': 'TM1FilterByLevel',
  'tm1filterbypattern': 'TM1FilterByPattern',
  'tm1member': 'TM1Member',
  'tm1sort': 'TM1Sort',
  'tm1lastupdated': 'TM1LastUpdated',
  'tm1lastupdatedby': 'TM1LastUpdatedBy',
  'tm1drilldownmember': 'TM1DrilldownMember',
  // ── MDX: Set functions ──
  'members': 'Members',
  'allmembers': 'AllMembers',
  'children': 'Children',
  'descendants': 'Descendants',
  'ancestors': 'Ancestors',
  'crossjoin': 'CrossJoin',
  'nonemptycrossjoin': 'NonEmptyCrossJoin',
  'filter': 'Filter',
  'nonempty': 'NonEmpty',
  'order': 'Order',
  'hierarchize': 'Hierarchize',
  'distinct': 'Distinct',
  'union': 'Union',
  'intersect': 'Intersect',
  'except': 'Except',
  'subset': 'Subset',
  'generate': 'Generate',
  'extract': 'Extract',
  'head': 'Head',
  'tail': 'Tail',
  'addcalculatedmembers': 'AddCalculatedMembers',
  'stripcalculatedmembers': 'StripCalculatedMembers',
  'toggledrillstate': 'ToggleDrillState',
  'drilldownlevel': 'DrilldownLevel',
  'drilldownmember': 'DrilldownMember',
  'drilluplevel': 'DrillupLevel',
  'drillupmember': 'DrillupMember',
  // ── MDX: Topcount / ranking ──
  'topcount': 'TopCount',
  'bottomcount': 'BottomCount',
  'toppercent': 'TopPercent',
  'bottompercent': 'BottomPercent',
  'topsum': 'TopSum',
  'bottomsum': 'BottomSum',
  'rank': 'Rank',
  // ── MDX: Member navigation ──
  'currentmember': 'CurrentMember',
  'parent': 'Parent',
  'ancestor': 'Ancestor',
  'cousin': 'Cousin',
  'firstchild': 'FirstChild',
  'lastchild': 'LastChild',
  'firstsibling': 'FirstSibling',
  'lastsibling': 'LastSibling',
  'prevmember': 'PrevMember',
  'nextmember': 'NextMember',
  'defaultmember': 'DefaultMember',
  // ── MDX: Member properties ──
  'name': 'Name',
  'uniquename': 'UniqueName',
  'caption': 'Caption',
  'ordinal': 'Ordinal',
  'item': 'Item',
  'properties': 'Properties',
  'dimension': 'Dimension',
  'hierarchy': 'Hierarchy',
  'level': 'Level',
  'levels': 'Levels',
  // ── MDX: Aggregation ──
  'count': 'Count',
  'sum': 'Sum',
  'avg': 'Avg',
  'aggregate': 'Aggregate',
  'coalesceempty': 'CoalesceEmpty',
  'validmeasure': 'ValidMeasure',
  // ── MDX: Conditional / logical ──
  'iif': 'IIf',
  'isempty': 'IsEmpty',
  'isancestor': 'IsAncestor',
  'isleaf': 'IsLeaf',
  'isgeneration': 'IsGeneration',
  'islevel': 'IsLevel',
  'isparent': 'IsParent',
  'issibling': 'IsSibling',
  'ischild': 'IsChild',
  // ── MDX: Type conversion ──
  'strtomember': 'StrToMember',
  'strtoset': 'StrToSet',
  'strtotuple': 'StrToTuple',
  'membertostr': 'MemberToStr',
  'settostr': 'SetToStr',
  'tupletostr': 'TupleToStr',
  // ── MDX: Time intelligence ──
  'periodstodate': 'PeriodsToDate',
  'parallelperiod': 'ParallelPeriod',
  'lastperiods': 'LastPeriods',
  'mtd': 'Mtd',
  'qtd': 'Qtd',
  'ytd': 'Ytd',
  'wtd': 'Wtd',
  // ── MDX: Statistical ──
  'linregintercept': 'LinRegIntercept',
  'linregpoint': 'LinRegPoint',
  'linregr2': 'LinRegR2',
  'linregslope': 'LinRegSlope',
  'linregvariance': 'LinRegVariance',
}

const STORAGE_KEY = 'tm1-ide-naming-dictionary'

/**
 * Load user customizations and disabled defaults from localStorage.
 * @returns {{customEntries: object, disabledDefaults: string[]}}
 */
function loadUserConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        customEntries: parsed.customEntries ?? {},
        disabledDefaults: parsed.disabledDefaults ?? [],
      }
    }
  } catch {}
  return { customEntries: {}, disabledDefaults: [] }
}

/**
 * Save user customizations to localStorage.
 * @param {object} customEntries
 * @param {string[]} disabledDefaults
 */
function saveUserConfig(customEntries, disabledDefaults) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      customEntries,
      disabledDefaults,
    }))
  } catch {}
}

/**
 * Build the merged naming map.
 * Priority: customEntries > IBM_DEFAULTS (unless disabled)
 * @returns {object} { map, customEntries, disabledDefaults }
 */
export function getNamingMap() {
  const { customEntries, disabledDefaults } = loadUserConfig()
  const disabled = new Set(disabledDefaults.map(s => s.toLowerCase()))
  const map = {}

  // Add defaults (unless disabled)
  for (const [key, val] of Object.entries(IBM_DEFAULTS)) {
    if (!disabled.has(key)) {
      map[key] = val
    }
  }

  // Override with custom entries
  for (const [key, val] of Object.entries(customEntries)) {
    map[key.toLowerCase()] = val
  }

  return { map, customEntries, disabledDefaults }
}

/**
 * Update the naming dictionary with new custom entries and disabled defaults.
 * @param {object} customEntries
 * @param {string[]} disabledDefaults
 */
export function updateNamingDictionary(customEntries, disabledDefaults) {
  saveUserConfig(customEntries, disabledDefaults)
}

/**
 * Reset the naming dictionary to IBM defaults (clear all customizations).
 */
export function resetNamingDictionary() {
  saveUserConfig({}, [])
}

/**
 * Export the current naming dictionary as JSON.
 * @returns {string}
 */
export function exportNamingDictionary() {
  const { customEntries, disabledDefaults } = loadUserConfig()
  return JSON.stringify({
    version: 1,
    customEntries,
    disabledDefaults,
  }, null, 2)
}

/**
 * Import a naming dictionary from JSON string.
 * @param {string} json
 */
export function importNamingDictionary(json) {
  try {
    const parsed = JSON.parse(json)
    if (parsed && typeof parsed.customEntries === 'object' && Array.isArray(parsed.disabledDefaults)) {
      saveUserConfig(parsed.customEntries, parsed.disabledDefaults)
      return true
    }
  } catch {}
  return false
}
