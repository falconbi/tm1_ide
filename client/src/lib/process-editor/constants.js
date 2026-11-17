export const CODE_TABS = [
  { key: 'PrologProcedure',   label: 'Prolog'   },
  { key: 'MetadataProcedure', label: 'Metadata' },
  { key: 'DataProcedure',     label: 'Data'     },
  { key: 'EpilogProcedure',   label: 'Epilog'   },
]

export const SECTION_LABEL = Object.fromEntries(CODE_TABS.map(({ key, label }) => [key, label]))

export const SECTION_TO_KEY = {
  Prolog: 'PrologProcedure',
  Metadata: 'MetadataProcedure',
  Data: 'DataProcedure',
  Epilog: 'EpilogProcedure',
}

export const CAPTURE_HOVER = { value: 'Capture point — records the selected watches when execution reaches this line. The process runs to completion.' }

export const CAPTURE_WHEN_HELP = "Only record a capture when this TI condition is true.\n\nExamples:\n  nBad = 1\n  vPosition @= 'ENG-001'\n  vPosition @= 'ENG-001' & nBad = 1\n\nUse @= for string comparisons."

export const PARAM_TYPE = { 1: 'Numeric', 2: 'String', Numeric: 'Numeric', String: 'String' }

export const toTypeStr = t => (t === 1 ? 'Numeric' : t === 2 ? 'String' : t ?? 'String')
