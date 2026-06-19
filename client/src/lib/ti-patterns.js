// TI Pattern definitions — each pattern generates code for one or more sections.
// generate(fields) returns { PrologProcedure?, MetaDataProcedure?, DataProcedure?, EpilogProcedure? }
// Naming conventions follow Bedrock best practice:
//   c = constant (process-local), p = parameter, v = datasource variable, n = numeric, s = string

const lines = (...parts) => parts.filter(Boolean).join('\n')

export const PATTERN_CATEGORIES = [
  {
    id: 'templates',
    label: 'Templates',
    patterns: [
      {
        id: 'process-bootstrap',
        label: 'New Process Bootstrap',
        description: 'Full process skeleton — header, constants, optional pDebug and nValid scaffolding across all four sections',
        fields: [
          { key: 'desc',    label: 'Description',        type: 'text',   placeholder: 'What this process does' },
          { key: 'author',  label: 'Author',             type: 'text',   placeholder: 'Your name' },
          { key: 'pDebug',    label: 'Include pDebug',     type: 'select', options: ['Yes', 'No'] },
          { key: 'nValid',    label: 'Include validation', type: 'select', options: ['Yes', 'No'] },
          { key: 'changeLog', label: 'Change log',         type: 'select', options: ['Yes', 'No'] },
        ],
        generate: ({ desc, author, pDebug, nValid, changeLog }) => {
          const today      = new Date().toISOString().slice(0, 10)
          const withDebug  = pDebug     !== 'No'
          const withValid  = nValid     !== 'No'
          const withLog    = changeLog  !== 'No'

          const prolog = lines(
            `#================================================================`,
            `# Description: ${desc   || 'TODO — describe this process'}`,
            `# Author:      ${author || 'TODO'}`,
            `# Date:        ${today}`,
            `#================================================================`,
            withLog ? lines(
              `#`,
              `# Change Log`,
              `# ----------  --------  ------------------------------------`,
              `# ${today}  ${(author || 'TODO').padEnd(8).slice(0, 8)}  Initial version`,
              `#================================================================`,
            ) : null,
            ``,
            `#============`,
            `# Constants`,
            `#============`,
            `cProcName = GetProcessName();`,
            withDebug ? `cLogFile  = GetProcessErrorFileDirectory() | cProcName | '.log';` : null,
            ``,
            withDebug ? lines(
              `# pDebug: 0 = none, 1 = log, 2 = log + no data updates`,
              `# Add pDebug as a numeric Parameter on the Parameters tab (default 0)`,
              `IF(pDebug >= 1);`,
              `    AsciiOutput(cLogFile, TimSt(Now, '\\\\Y-\\\\m-\\\\d \\\\H:\\\\i:\\\\s') | ' | ' | cProcName | ' | START');`,
              `ENDIF;`,
              ``,
              `IF(pDebug >= 2);`,
              `    ProcessQuit;`,
              `ENDIF;`,
            ) : null,
            withValid ? lines(
              `#============`,
              `# Validation`,
              `#============`,
              `nValid = 1;`,
              ``,
              `# IF(pParam @= '');`,
              `#     nValid = 0;`,
              `#     LogOutput('ERROR', 'pParam is required');`,
              `# ENDIF;`,
              ``,
              `IF(nValid = 0);`,
              `    ProcessQuit;`,
              `ENDIF;`,
            ) : null,
          )

          return {
            PrologProcedure: prolog,
            MetaDataProcedure: lines(
              `#================================================================`,
              `# Metadata`,
              `# Insert elements, create consolidations, build hierarchies`,
              `#================================================================`,
            ),
            DataProcedure: lines(
              `#================================================================`,
              `# Data`,
              `# Write cell values, write element attributes`,
              `#================================================================`,
            ),
            EpilogProcedure: lines(
              `#================================================================`,
              `# Epilog`,
              `# Post-processing: run child processes, clean up temp objects`,
              `#================================================================`,
              withDebug ? lines(
                ``,
                `IF(pDebug >= 1);`,
                `    AsciiOutput(cLogFile, TimSt(Now, '\\\\Y-\\\\m-\\\\d \\\\H:\\\\i:\\\\s') | ' | ' | cProcName | ' | END');`,
                `ENDIF;`,
              ) : null,
            ),
          }
        },
      },
    ],
  },
  {
    id: 'cube',
    label: 'Cube Operations',
    patterns: [
      {
        id: 'clear-view',
        label: 'Clear View (Zero Out)',
        description: 'Zero a cube in Prolog using ViewZeroOut — creates a process-scoped temp view, zeroes it, then destroys it (Bedrock pattern)',
        fields: [
          { key: 'cube', label: 'Cube name', type: 'text', placeholder: 'MyCube' },
        ],
        generate: ({ cube }) => {
          const cCube = cube || 'MyCube'
          return {
            PrologProcedure: lines(
              `#============`,
              `# Constants`,
              `#============`,
              `cCube     = '${cCube}';`,
              `cProcName = GetProcessName();`,
              `cView     = 'TI Zero Out - ' | cProcName;`,
              ``,
              `#============`,
              `# Zero out`,
              `#============`,
              `IF(ViewExists(cCube, cView) = 1);`,
              `    ViewDestroy(cCube, cView);`,
              `ENDIF;`,
              `ViewCreate(cCube, cView);`,
              ``,
              `ViewZeroOut(cCube, cView);`,
              ``,
              `#============`,
              `# Clean up`,
              `#============`,
              `ViewDestroy(cCube, cView);`,
            ),
          }
        },
      },
      {
        id: 'copy-view',
        label: 'Copy View → Cube',
        description: 'Copy numeric values from a source view into a target cube',
        fields: [
          { key: 'srcCube', label: 'Source cube', type: 'text', placeholder: 'SourceCube' },
          { key: 'srcView', label: 'Source view', type: 'text', placeholder: 'Default' },
          { key: 'tgtCube', label: 'Target cube', type: 'text', placeholder: 'TargetCube' },
        ],
        generate: ({ srcCube, srcView, tgtCube }) => {
          const cSrc = srcCube || 'SourceCube'
          const cView = srcView || 'Default'
          const cTgt = tgtCube || 'TargetCube'
          return {
            PrologProcedure: lines(
              `#============`,
              `# Constants`,
              `#============`,
              `cSrcCube = '${cSrc}';`,
              `cSrcView = '${cView}';`,
              `cTgtCube = '${cTgt}';`,
              ``,
              `DataSourceType          = 'TM1CubeView';`,
              `DataSourceNameForServer = cSrcCube;`,
              `DataSourceNameForClient = cSrcCube;`,
              `DataSourceView          = cSrcView;`,
            ),
            DataProcedure: lines(
              `# Replace v1, v2... with datasource variable names from the Variables tab`,
              `nValue = CellGetN(cSrcCube, v1, v2);`,
              `CellPutN(nValue, cTgtCube, v1, v2);`,
            ),
          }
        },
      },
    ],
  },
  {
    id: 'dimension',
    label: 'Dimension Operations',
    patterns: [
      {
        id: 'dim-loop',
        label: 'Loop over Dimension',
        description: 'Iterate every element in a dimension using DimSiz / DimNm',
        fields: [
          { key: 'dim',   label: 'Dimension',   type: 'text', placeholder: 'MyDimension' },
          { key: 'elVar', label: 'Element var',  type: 'text', placeholder: 'vEl' },
        ],
        generate: ({ dim, elVar }) => {
          const vEl  = elVar || 'vEl'
          const cDim = dim   || 'MyDimension'
          return {
            PrologProcedure: lines(
              `cDimension = '${cDim}';`,
              `nCount     = DimSiz(cDimension);`,
              `nIdx       = 1;`,
              ``,
              `WHILE(nIdx <= nCount);`,
              `    ${vEl} = DimNm(cDimension, nIdx);`,
              ``,
              `    # --- your code here ---`,
              ``,
              `    nIdx = nIdx + 1;`,
              `END;`,
            ),
          }
        },
      },
      {
        id: 'subset-static',
        label: 'Build Subset (Static)',
        description: 'Destroy and recreate a subset by inserting explicit elements',
        fields: [
          { key: 'dim',    label: 'Dimension',   type: 'text', placeholder: 'MyDimension' },
          { key: 'subset', label: 'Subset name', type: 'text', placeholder: 'My Subset' },
        ],
        generate: ({ dim, subset }) => {
          const cDim = dim    || 'MyDimension'
          const cSub = subset || 'My Subset'
          return {
            PrologProcedure: lines(
              `cDimension = '${cDim}';`,
              `cSubset    = '${cSub}';`,
              ``,
              `IF(SubsetExists(cDimension, cSubset) = 1);`,
              `    SubsetDestroy(cDimension, cSubset);`,
              `ENDIF;`,
              `SubsetCreate(cDimension, cSubset);`,
              ``,
              `nPos = 1;`,
              `SubsetElementInsert(cDimension, cSubset, 'Element1', nPos); nPos = nPos + 1;`,
              `SubsetElementInsert(cDimension, cSubset, 'Element2', nPos); nPos = nPos + 1;`,
            ),
          }
        },
      },
      {
        id: 'subset-mdx',
        label: 'Build Subset (MDX)',
        description: 'Destroy and recreate a subset using an MDX expression',
        fields: [
          { key: 'dim',    label: 'Dimension',      type: 'text', placeholder: 'MyDimension' },
          { key: 'subset', label: 'Subset name',    type: 'text', placeholder: 'My Subset' },
          { key: 'mdx',    label: 'MDX expression', type: 'textarea',
            placeholder: '{TM1FilterByLevel({[MyDimension].[MyDimension].Members}, 0)}' },
        ],
        generate: ({ dim, subset, mdx }) => {
          const cDim = dim    || 'MyDimension'
          const cSub = subset || 'My Subset'
          const cMDX = mdx    || `{TM1FilterByLevel({[${cDim}].[${cDim}].Members}, 0)}`
          return {
            PrologProcedure: lines(
              `cDimension = '${cDim}';`,
              `cSubset    = '${cSub}';`,
              `cMDX       = '${cMDX}';`,
              ``,
              `IF(SubsetExists(cDimension, cSubset) = 1);`,
              `    SubsetDestroy(cDimension, cSubset);`,
              `ENDIF;`,
              `SubsetCreateByMDX(cSubset, cMDX, cDimension);`,
            ),
          }
        },
      },
      {
        id: 'alias-setter',
        label: 'Set Alias from Attribute',
        description: 'Copy an existing String attribute into an Alias-type attribute on every element. Creates the alias attribute if it does not exist. Handles blank source values per pHandleBlank.',
        fields: [
          { key: 'dim',       label: 'Dimension',           type: 'dim-select' },
          { key: 'srcAttr',   label: 'Source attribute',    type: 'attr-select', dependsOn: 'dim' },
          { key: 'aliasAttr', label: 'Alias attribute name',type: 'text',   placeholder: 'Alias' },
          { key: 'handleBlank', label: 'Blank source value', type: 'select', options: ['Use element name', 'Skip element'] },
        ],
        generate: ({ dim, srcAttr, aliasAttr, handleBlank }) => {
          const cDim   = dim       || 'MyDimension'
          const cSrc   = srcAttr   || 'Caption'
          const cAlias = aliasAttr || 'Alias'
          const skip   = handleBlank === 'Skip element'
          return {
            PrologProcedure: lines(
              `#============`,
              `# Constants`,
              `#============`,
              `cProcName = GetProcessName();`,
              ``,
              `#============`,
              `# Parameters — move to Parameters tab and set defaults`,
              `#============`,
              `# pDimension    (String)  = '${cDim}'`,
              `# pSourceAttr   (String)  = '${cSrc}'`,
              `# pAliasAttrName(String)  = '${cAlias}'`,
              `# pHandleBlank  (Numeric) = ${skip ? '0' : '1'}   # 1 = use element name, 0 = skip`,
              ``,
              `pDimension     = '${cDim}';`,
              `pSourceAttr    = '${cSrc}';`,
              `pAliasAttrName = '${cAlias}';`,
              `pHandleBlank   = ${skip ? '0' : '1'};`,
              ``,
              `#============`,
              `# Validation`,
              `#============`,
              `nValid = 1;`,
              `IF(pDimension @= '');`,
              `    nValid = 0; LogOutput('ERROR', 'pDimension is required');`,
              `ENDIF;`,
              `IF(pSourceAttr @= '');`,
              `    nValid = 0; LogOutput('ERROR', 'pSourceAttr is required');`,
              `ENDIF;`,
              `IF(pAliasAttrName @= '');`,
              `    nValid = 0; LogOutput('ERROR', 'pAliasAttrName is required');`,
              `ENDIF;`,
              `IF(nValid = 0);`,
              `    ProcessQuit;`,
              `ENDIF;`,
              ``,
              `nCount = DimSiz(pDimension);`,
              ``,
              `IF(pSourceAttr @= pAliasAttrName);`,
              `    #============`,
              `    # Same name: convert String attribute → Alias in place`,
              `    # Values are staged in a temp attribute because TM1 cannot`,
              `    # change an attribute's type without deleting and recreating it.`,
              `    #============`,
              `    vTempAttr = '__alias_tmp__';`,
              `    IF(DIMIX('}ElementAttributes_' | pDimension, vTempAttr) = 0);`,
              `        DimensionElementAttributeCreate(pDimension, vTempAttr, 'S');`,
              `    ENDIF;`,
              ``,
              `    nIdx = 1;`,
              `    WHILE(nIdx <= nCount);`,
              `        vEl = DimNm(pDimension, nIdx);`,
              `        vVal = ATTRS(pDimension, vEl, pSourceAttr);`,
              `        IF(vVal @= '' & pHandleBlank = 1);`,
              `            vVal = vEl;`,
              `        ENDIF;`,
              `        ElementAttrPutS(vVal, pDimension, vEl, vTempAttr);`,
              `        nIdx = nIdx + 1;`,
              `    END;`,
              ``,
              `    # Delete source attribute by removing it from the }ElementAttributes control dim`,
              `    DimensionElementDelete('}ElementAttributes_' | pDimension, pSourceAttr);`,
              `    DimensionElementAttributeCreate(pDimension, pAliasAttrName, 'A');`,
              ``,
              `    nIdx = 1;`,
              `    WHILE(nIdx <= nCount);`,
              `        vEl = DimNm(pDimension, nIdx);`,
              `        ElementAttrPutS(ATTRS(pDimension, vEl, vTempAttr), pDimension, vEl, pAliasAttrName);`,
              `        nIdx = nIdx + 1;`,
              `    END;`,
              ``,
              `    DimensionElementDelete('}ElementAttributes_' | pDimension, vTempAttr);`,
              `    LogOutput('INFO', cProcName | ': Converted ' | pSourceAttr | ' to Alias type — ' | NumberToString(nCount) | ' elements updated');`,
              ``,
              `ELSE;`,
              `    #============`,
              `    # Different name: create alias attribute if absent, copy values across`,
              `    # DIMIX on }ElementAttributes_{dim} returns 0 when the attribute is absent`,
              `    #============`,
              `    IF(DIMIX('}ElementAttributes_' | pDimension, pAliasAttrName) = 0);`,
              `        DimensionElementAttributeCreate(pDimension, pAliasAttrName, 'A');`,
              `    ENDIF;`,
              ``,
              `    nIdx     = 1;`,
              `    nUpdated = 0;`,
              `    nSkipped = 0;`,
              ``,
              `    WHILE(nIdx <= nCount);`,
              `        vEl    = DimNm(pDimension, nIdx);`,
              `        vAlias = ATTRS(pDimension, vEl, pSourceAttr);`,
              ``,
              `        IF(vAlias @<> '');`,
              `            ElementAttrPutS(vAlias, pDimension, vEl, pAliasAttrName);`,
              `            nUpdated = nUpdated + 1;`,
              `        ELSEIF(pHandleBlank = 1);`,
              `            ElementAttrPutS(vEl, pDimension, vEl, pAliasAttrName);`,
              `            nUpdated = nUpdated + 1;`,
              `            LogOutput('WARN', cProcName | ': ' | vEl | ' — blank source attr, used element name');`,
              `        ELSE;`,
              `            nSkipped = nSkipped + 1;`,
              `            LogOutput('WARN', cProcName | ': ' | vEl | ' — blank source attr, skipped');`,
              `        ENDIF;`,
              ``,
              `        nIdx = nIdx + 1;`,
              `    END;`,
              ``,
              `    LogOutput('INFO', cProcName | ': Done — '`,
              `        | NumberToString(nUpdated) | ' updated, '`,
              `        | NumberToString(nSkipped) | ' skipped');`,
              `ENDIF;`,
              ``,
              `# NOTE: This process does not detect duplicate alias values.`,
              `# After running, open a }ElementAttributes_${cDim} view filtered`,
              `# to the ${cAlias} attribute and verify values are unique.`,
            ),
          }
        },
      },
      {
        id: 'write-attr',
        label: 'Write Element Attribute',
        description: 'Write a string or numeric attribute value for every element in a dimension',
        fields: [
          { key: 'dim',   label: 'Dimension',      type: 'text', placeholder: 'MyDimension' },
          { key: 'attr',  label: 'Attribute name', type: 'text', placeholder: 'MyAttribute' },
          { key: 'atype', label: 'Type',            type: 'select', options: ['String', 'Numeric'] },
        ],
        generate: ({ dim, attr, atype }) => {
          const cDim  = dim  || 'MyDimension'
          const cAttr = attr || 'MyAttribute'
          const putFn = (atype === 'Numeric') ? 'ElementAttrPutN' : 'ElementAttrPutS'
          const valEx = (atype === 'Numeric') ? '0'               : `''`
          return {
            PrologProcedure: lines(
              `cDimension = '${cDim}';`,
              `nCount     = DimSiz(cDimension);`,
              `nIdx       = 1;`,
              ``,
              `WHILE(nIdx <= nCount);`,
              `    vEl = DimNm(cDimension, nIdx);`,
              `    IF(ElementLevel(cDimension, cDimension, vEl) = 0);`,
              `        # Leaf elements only — remove IF/ENDIF to include consolidations`,
              `        ${putFn}(cDimension, vEl, '${cAttr}', ${valEx});`,
              `    ENDIF;`,
              `    nIdx = nIdx + 1;`,
              `END;`,
            ),
          }
        },
      },
    ],
  },
  {
    id: 'debug',
    label: 'Debug & Utilities',
    patterns: [
      {
        id: 'ascii-output',
        label: 'AsciiOutput Debug',
        description: 'Write variable values to a log file — uses GetProcessErrorFileDirectory() for a safe path',
        fields: [
          { key: 'logName', label: 'Log filename',                  type: 'text', placeholder: 'debug.log' },
          { key: 'vars',    label: 'Variables (comma-separated)',    type: 'text', placeholder: 'vEl, nValue' },
        ],
        generate: ({ logName, vars }) => {
          const fn      = logName || 'debug.log'
          const varList = (vars || 'vVar1, vVar2')
            .split(',').map(v => v.trim()).filter(Boolean)
          const concat  = varList
            .map((v, i) => i === 0 ? v : `' | ' | ${v}`)
            .join(' | ')
          return {
            PrologProcedure: lines(
              `# Debug output — remove before production`,
              `cLogFile = GetProcessErrorFileDirectory() | '${fn}';`,
              `AsciiOutput(cLogFile, 'DEBUG: ' | ${concat});`,
            ),
          }
        },
      },
      {
        id: 'pdebug',
        label: 'pDebug Mode',
        description: 'Standard Bedrock debug parameter: 0=off, 1=log output, 2=log+no-updates. Add pDebug to the Parameters tab.',
        fields: [
          { key: 'logName', label: 'Log filename',                       type: 'text', placeholder: 'debug.log' },
          { key: 'vars',    label: 'Variables to log (comma-separated)', type: 'text', placeholder: 'vEl, nValue' },
        ],
        generate: ({ logName, vars }) => {
          const fn      = logName || 'debug.log'
          const varList = (vars || 'vEl, nValue')
            .split(',').map(v => v.trim()).filter(Boolean)
          const concat  = varList
            .map((v, i) => i === 0 ? v : `' | ' | ${v}`)
            .join(' | ')
          return {
            PrologProcedure: lines(
              `# pDebug: 0 = none, 1 = log output, 2 = log + no data updates`,
              `# Add pDebug as a numeric Parameter on the Parameters tab (default 0)`,
              `cLogFile = GetProcessErrorFileDirectory() | '${fn}';`,
              ``,
              `IF(pDebug >= 1);`,
              `    AsciiOutput(cLogFile,`,
              `        TimSt(Now, '\\\\Y-\\\\m-\\\\d \\\\H:\\\\i:\\\\s') | ' | ' | ${concat});`,
              `ENDIF;`,
              ``,
              `IF(pDebug >= 2);`,
              `    # pDebug = 2: log only, do not write data`,
              `    ProcessQuit;`,
              `ENDIF;`,
            ),
          }
        },
      },
      {
        id: 'nvalid',
        label: 'Parameter Validation',
        description: 'nValid guard pattern — validate one or more parameters and quit if any fail (Bedrock pattern)',
        fields: [
          { key: 'param',   label: 'Parameter name',    type: 'text', placeholder: 'pCube' },
          { key: 'check',   label: 'Invalid condition', type: 'text', placeholder: "pCube @= ''" },
          { key: 'message', label: 'Error message',     type: 'text', placeholder: 'pCube is required' },
        ],
        generate: ({ param, check, message }) => {
          const p    = param   || 'pParam'
          const cond = check   || `${p} @= ''`
          const msg  = message || `${p} is required`
          return {
            PrologProcedure: lines(
              `nValid = 1;`,
              ``,
              `IF(${cond});`,
              `    nValid = 0;`,
              `    LogOutput('ERROR', '${msg}');`,
              `ENDIF;`,
              ``,
              `# Add more IF blocks above for each parameter to validate`,
              ``,
              `IF(nValid = 0);`,
              `    ProcessQuit;`,
              `ENDIF;`,
            ),
          }
        },
      },
      {
        id: 'date-serial',
        label: 'Date Serial (PA 2.0.8)',
        description: 'Build an Excel-compatible date serial using ParseDate (NewDateFormatter API)',
        fields: [
          { key: 'yearVar',  label: 'Year variable',   type: 'text', placeholder: 'nYear' },
          { key: 'monthVar', label: 'Month variable',  type: 'text', placeholder: 'nMonth' },
          { key: 'dayVar',   label: 'Day variable',    type: 'text', placeholder: 'nDay' },
          { key: 'outVar',   label: 'Output variable', type: 'text', placeholder: 'nSerial' },
        ],
        generate: ({ yearVar, monthVar, dayVar, outVar }) => {
          const y   = yearVar  || 'nYear'
          const m   = monthVar || 'nMonth'
          const d   = dayVar   || 'nDay'
          const out = outVar   || 'nSerial'
          return {
            PrologProcedure: lines(
              `# Excel date serial via PA 2.0.8 ParseDate`,
              `# TM1 epoch: Jan 1 1960 = 0; Excel serial for that date = 21916`,
              `nDateFmt = NewDateFormatter('yyyyMMdd');`,
              `sDateStr = NumberToString(${y})`,
              `        | IF(${m} < 10, '0', '') | NumberToString(${m})`,
              `        | IF(${d} < 10, '0', '') | NumberToString(${d});`,
              `${out} = ParseDate(nDateFmt, sDateStr) + 21916;`,
            ),
          }
        },
      },
      {
        id: 'process-error',
        label: 'Error Handling',
        description: 'Guard a condition and quit or raise a process error',
        fields: [
          { key: 'condition', label: 'Error condition', type: 'text',   placeholder: "pParam @= ''" },
          { key: 'message',   label: 'Error message',   type: 'text',   placeholder: 'Parameter must not be blank' },
          { key: 'action',    label: 'On error',        type: 'select', options: ['ProcessQuit', 'ProcessError'] },
        ],
        generate: ({ condition, message, action }) => ({
          PrologProcedure: lines(
            `IF(${condition || "pParam @= ''"});`,
            `    ${action === 'ProcessError' ? `ProcessError('${message || 'Validation failed'}');` : 'ProcessQuit;'}`,
            `ENDIF;`,
          ),
        }),
      },
      {
        id: 'execute-chain',
        label: 'Execute Process Chain',
        description: 'Run a sequence of TI processes from the Epilog',
        fields: [
          { key: 'processes', label: 'Process names (one per line)', type: 'textarea',
            placeholder: 'MyModule.Step1\nMyModule.Step2\nMyModule.Step3' },
        ],
        generate: ({ processes }) => {
          const procs = (processes || 'MyModule.Step1\nMyModule.Step2')
            .split('\n').map(p => p.trim()).filter(Boolean)
          return {
            EpilogProcedure: procs
              .map(p => `ExecuteProcess('${p}');`)
              .join('\n'),
          }
        },
      },
    ],
  },
]

export const ALL_PATTERNS = PATTERN_CATEGORIES.flatMap(c => c.patterns)
