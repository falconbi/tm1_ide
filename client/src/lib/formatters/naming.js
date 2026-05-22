// ── IBM TM1 Naming Dictionary ─────────────────────────────────────────────────
// Canonical IBM official capitalization for TM1 identifiers.
// Merges with user-defined custom entries and respects disabled defaults.

// ── Default IBM Official Names ──────────────────────────────────────────────

export const IBM_DEFAULTS = {
  // ── Rules functions ──
  'db': 'DB',
  'attrs': 'ATTRS',
  'attrn': 'ATTRN',
  'attrsl': 'ATTRSL',
  'if': 'IF',
  'elseif': 'ELSEIF',
  'else': 'ELSE',
  'endif': 'ENDIF',
  'continue': 'CONTINUE',
  'stet': 'STET',
  'feeders': 'FEEDERS',
  'skipcheck': 'SKIPCHECK',
  // Math
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
  'undeffn': 'UNDEF',
  // Consolidation
  'consolidatedavg': 'CONSOLIDATEDAVG',
  'consolidatedcount': 'CONSOLIDATEDCOUNT',
  'consolidatedmax': 'CONSOLIDATEDMAX',
  'consolidatedmin': 'CONSOLIDATEDMIN',
  'consolidatedsum': 'CONSOLIDATEDSUM',
  // Date/Time
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
  // String
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
  // Cube / Dimension
  'cubeexists': 'CUBEEXISTS',
  'dimensionelementexists': 'DIMENSIONELEMENTEXISTS',
  'dimensionelementsortorder': 'DIMENSIONELEMENTSORTORDER',
  'dimensionhierarchysortorder': 'DIMENSIONHIERARCHYSORTORDER',
  'elcomp': 'ELCOMP',
  'elcompn': 'ELCOMPN',
  'ellev': 'ELLEV',
  'elisanc': 'ELISANC',
  'elispar': 'ELISPARC',
  'elisparc': 'ELISPARC',
  'elpar': 'ELPAR',
  'elparn': 'ELPARN',
  'elweight': 'ELWEIGHT',
  'tabdim': 'TABDIM',
  'tidy': 'TIDY',
  // Lookup
  'cellgetn': 'CELLGETN',
  'cellgets': 'CELLGETS',
  'cellgetsn': 'CELLGETSN',
  'db': 'DB',
  'dnlev': 'DNLEV',
  'dnum': 'DNUM',
  'dtlev': 'DTLEV',
  'dtnum': 'DTNUM',
  'parel': 'PAREL',
  // Logging
  'logoutput': 'LOGOUTPUT',
  // ── TI Process functions ──
  'asciidelete': 'ASCIIDELETE',
  'asciioutput': 'ASCIIOUTPUT',
  'asciiread': 'ASCIIREAD',
  'asctowide': 'ASCTOWIDE',
  'batchupdatefinish': 'BATCHUPDATEFINISH',
  'batchupdatestart': 'BATCHUPDATESTART',
  'cellincrementn': 'CELLINCREMENTN',
  'cellputn': 'CELLPUTN',
  'cellputs': 'CELLPUTS',
  'cellputsn': 'CELLPUTSN',
  'cellsetdn': 'CELLSETDN',
  'cellsetds': 'CELLSETDS',
  'choreerror': 'CHOREERROR',
  'createtemporarysubsetbymdx': 'CREATETEMPORARYSUBSETBYMDX',
  'cubecomponentadd': 'CUBECOMPONENTADD',
  'cubecomponentdelete': 'CUBECOMPONENTDELETE',
  'cubecreatedatacopy': 'CUBECREATEDATACOPY',
  'cubedatacopy': 'CUBEDATACOPY',
  'cubedestroy': 'CUBEDESTROY',
  'dimensioncreate': 'DIMENSIONCREATE',
  'dimensiondeleteallelements': 'DIMENSIONDELETEALLELEMENTS',
  'dimensiondestroy': 'DIMENSIONDESTROY',
  'elementcomponentadd': 'ELEMENTCOMPONENTADD',
  'elementcomponentdelete': 'ELEMENTCOMPONENTDELETE',
  'elementcreate': 'ELEMENTCREATE',
  'elementdelete': 'ELEMENTDELETE',
  'elementinsert': 'ELEMENTINSERT',
  'elementtype': 'ELEMENTTYPE',
  'elementupdate': 'ELEMENTUPDATE',
  'error': 'ERROR',
  'filedelete': 'FILEDELETE',
  'fileexists': 'FILEEXISTS',
  'getusenamedtailors': 'GETUSENAMEDTAILORS',
  'itemreject': 'ITEMREJECT',
  'itemskip': 'ITEMSKIP',
  'lock': 'LOCK',
  'lockname': 'LOCKNAME',
  'newelementinsert': 'NEWELEMENTINSERT',
  'numberoftailors': 'NUMBEROFTAILORS',
  'periods': 'PERIODS',
  'processbreak': 'PROCESSBREAK',
  'processerror': 'PROCESSERROR',
  'publishview': 'PUBLISHVIEW',
  'read': 'READ',
  'refreshmdxview': 'REFRESHMDXVIEW',
  'removedirectory': 'REMOVEDIRECTORY',
  'save': 'SAVE',
  'setelement': 'SETELEMENT',
  'setnamedtailor': 'SETNAMEDTAILOR',
  'setusenamedtailors': 'SETUSENAMEDTAILORS',
  'subsetcreate': 'SUBSETCREATE',
  'subsetdeleteallelements': 'SUBSETDELETEALLELEMENTS',
  'subsetelementdelete': 'SUBSETELEMENTDELETE',
  'subsetelementinsert': 'SUBSETELEMENTINSERT',
  'subsetexists': 'SUBSETEXISTS',
  'textoutput': 'TEXTOUTPUT',
  'unpublishview': 'UNPUBLISHVIEW',
  'viewcolumnsuppresszeroset': 'VIEWCOLUMNSUPPRESSZEROSET',
  'viewcreate': 'VIEWCREATE',
  'viewdestroy': 'VIEWDESTROY',
  'viewextractskipcalcsset': 'VIEWEXTRACTSKIPCALCSSET',
  'viewextractskipconsolidatedstringset': 'VIEWEXTRACTSKIPCONSOLIDATEDSTRINGSSET',
  'viewextractskiprulevaluesset': 'VIEWEXTRACTSKIPRULEVALUESSET',
  'viewextractskipzeroesset': 'VIEWEXTRACTSKIPZEROSSET',
  'viewrowsuppresszeroset': 'VIEWROWSUPPRESSZEROSET',
  'viewsetdn': 'VIEWSETDN',
  'viewsetds': 'VIEWSETDS',
  'viewsubsetassign': 'VIEWSUBSETASSIGN',
  'viewtitlesubsetassign': 'VIEWTITLESUBSETASSIGN',
  'widedelete': 'WIDEDELETE',
  'wideread': 'WIDEREAD',
  'widetoasc': 'WIDETOASC',
  'write': 'WRITE',
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
