import {
  daysInMonth, excelSerial,
  fyForMonth, fyBounds,
  formatMonth, formatCaption, formatLongName, formatFY,
} from './dateUtils.js'

export function computeDimension(params) {
  const {
    dimensionName, fyStartMonth, firstFY, lastFY,
    yearFormat, monthFormat, captionFormat, longNameFormat,
    includeTotal, includeCurrentPeriodAttr,
  } = params

  const fyData  = {}
  const allFYs  = []
  const allMonths = []

  for (let fy = firstFY; fy <= lastFY; fy++) {
    const bounds = fyBounds(fy, fyStartMonth)
    const months = []
    let y = bounds.firstYear
    let m = bounds.firstMonth
    for (let i = 0; i < 12; i++) {
      months.push({ year: y, month: m })
      allMonths.push({ year: y, month: m })
      m++
      if (m > 12) { m = 1; y++ }
    }
    fyData[fy] = { months, isPartial: false }
    allFYs.push(fy)
  }

  const elements = []
  if (includeTotal) {
    elements.push({ name: `Total ${dimensionName}`, type: 'C', level: 'total' })
  }
  for (const fyYear of allFYs) {
    elements.push({ name: formatFY(fyYear, fyStartMonth, yearFormat), type: 'C', level: 'fy', fyYear })
  }
  for (const { year, month } of allMonths) {
    elements.push({ name: formatMonth(year, month, monthFormat), type: 'N', level: 'month', year, month })
  }

  const edges = []
  const totalName = `Total ${dimensionName}`
  for (const fyYear of allFYs) {
    const fyName = formatFY(fyYear, fyStartMonth, yearFormat)
    if (includeTotal) edges.push({ parent: totalName, child: fyName, weight: 1 })
    for (const { year, month } of fyData[fyYear].months) {
      edges.push({ parent: fyName, child: formatMonth(year, month, monthFormat), weight: 1 })
    }
  }

  const attributes = {}
  const allSet = new Set(allMonths.map(({ year, month }) => `${year}:${month}`))

  for (const el of elements) {
    if (el.level !== 'month') { attributes[el.name] = {}; continue }
    const { year, month } = el
    const fy      = fyForMonth(year, month, fyStartMonth)
    const fyName  = formatFY(fy, fyStartMonth, yearFormat)
    const bounds  = fyBounds(fy, fyStartMonth)
    const prevYear = month === 1 ? year - 1 : year
    const prevMonth = month === 1 ? 12 : month - 1
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const hasPrev = allSet.has(`${prevYear}:${prevMonth}`)
    const hasNext = allSet.has(`${nextYear}:${nextMonth}`)

    attributes[el.name] = {
      'Period Start Serial': excelSerial(year, month, 1),
      'Period End Serial':   excelSerial(year, month, daysInMonth(year, month)),
      'Calendar Year':       year,
      'Calendar Month':      month,
      'Days in Period':      daysInMonth(year, month),
      'Fin Year':            fyName,
      'First Period':        formatMonth(bounds.firstYear, bounds.firstMonth, monthFormat),
      'Last Period':         formatMonth(bounds.lastYear, bounds.lastMonth, monthFormat),
      'Previous Period':     hasPrev ? formatMonth(prevYear, prevMonth, monthFormat) : '',
      'Next Period':         hasNext ? formatMonth(nextYear, nextMonth, monthFormat) : '',
      'Caption':             formatCaption(year, month, captionFormat),
      'Long Name':           formatLongName(year, month, longNameFormat),
      ...(includeCurrentPeriodAttr ? { 'Is Current Period': '' } : {}),
    }
  }

  return { elements, edges, attributes, fyData, includedFYs: allFYs, includedMonths: allMonths }
}

export function generateBuildDimensionProlog(params, selectedSubsets = []) {
  const {
    dimensionName, includeTotal, replaceDimension,
  } = params

  const out = []

  out.push(`# =============================================`)
  out.push(`# Build Period Dimension — ${dimensionName}`)
  out.push(`# Parameters: pFirstFY, pLastFY, pFYStartM, pCurrentPeriod`)
  out.push(`# =============================================`)
  out.push(``)
  out.push(`# ── Input: constant, string working copies ──`)
  out.push(`cDimension = '${dimensionName}';`)
  out.push(`sCurrentPeriod = pCurrentPeriod;`)
  out.push(`sMsg = '';`)
  out.push(``)
  out.push(`# ── Validate parameters ──`)
  out.push(`nFirstFY = NUMBR(TRIM(pFirstFY));`)
  out.push(`IF(nFirstFY < 1900 % nFirstFY > 2200);`)
  out.push(`  sMsg = 'pFirstFY invalid: ' | pFirstFY | ' — expected a 4-digit fiscal year number';`)
  out.push(`  AttrPutS('__ERROR:' | sMsg, '}Processes', GetProcessName(), '__RUN_LOG');`)
  out.push(`  ProcessQuit;`)
  out.push(`ENDIF;`)
  out.push(``)
  out.push(`nLastFY = NUMBR(TRIM(pLastFY));`)
  out.push(`IF(nLastFY < nFirstFY);`)
  out.push(`  sMsg = 'pLastFY invalid: ' | pLastFY | ' — must be >= pFirstFY (' | pFirstFY | ')';`)
  out.push(`  AttrPutS('__ERROR:' | sMsg, '}Processes', GetProcessName(), '__RUN_LOG');`)
  out.push(`  ProcessQuit;`)
  out.push(`ENDIF;`)
  out.push(``)
  out.push(`nFYStartM = NUMBR(TRIM(pFYStartM));`)
  out.push(`IF(nFYStartM < 1 % nFYStartM > 12);`)
  out.push(`  sMsg = 'pFYStartM invalid: ' | pFYStartM | ' — must be 1-12';`)
  out.push(`  AttrPutS('__ERROR:' | sMsg, '}Processes', GetProcessName(), '__RUN_LOG');`)
  out.push(`  ProcessQuit;`)
  out.push(`ENDIF;`)
  out.push(``)
  out.push(`IF(sCurrentPeriod @= '');`)
  out.push(`  sMsg = 'pCurrentPeriod is required — format YYYY-MM e.g. 2027-05';`)
  out.push(`  AttrPutS('__ERROR:' | sMsg, '}Processes', GetProcessName(), '__RUN_LOG');`)
  out.push(`  ProcessQuit;`)
  out.push(`ENDIF;`)
  out.push(`IF(LONG(sCurrentPeriod) <> 7 % SUBST(sCurrentPeriod, 5, 1) @<> '-');`)
  out.push(`  sMsg = 'pCurrentPeriod invalid format: ' | sCurrentPeriod | ' — expected YYYY-MM e.g. 2027-05';`)
  out.push(`  AttrPutS('__ERROR:' | sMsg, '}Processes', GetProcessName(), '__RUN_LOG');`)
  out.push(`  ProcessQuit;`)
  out.push(`ENDIF;`)
  out.push(`nCPYear  = NUMBR(SUBST(sCurrentPeriod, 1, 4));`)
  out.push(`nCPMonth = NUMBR(SUBST(sCurrentPeriod, 6, 2));`)
  out.push(`IF(nCPYear < nFirstFY % nCPYear > nLastFY % nCPMonth < 1 % nCPMonth > 12);`)
  out.push(`  sMsg = 'pCurrentPeriod out of range: ' | sCurrentPeriod | ' — year must be ' | NumberToString(nFirstFY) | '-' | NumberToString(nLastFY) | ', month 1-12';`)
  out.push(`  AttrPutS('__ERROR:' | sMsg, '}Processes', GetProcessName(), '__RUN_LOG');`)
  out.push(`  ProcessQuit;`)
  out.push(`ENDIF;`)
  out.push(``)

  out.push(`# 1. Create Dimension`)
  out.push(`# ─────────────────────────────────────────────`)
  if (replaceDimension) {
    out.push(`# If replace is enabled: destroy the existing dimension first`)
    out.push(`IF(DIMIX('}Dimensions', cDimension) > 0);`)
    out.push(`    DimensionDestroy(cDimension);`)
    out.push(`ENDIF;`)
  }
  out.push(`# Create the dimension if it does not already exist`)
  out.push(`IF(DIMIX('}Dimensions', cDimension) = 0);`)
  out.push(`    DimensionCreate(cDimension);`)
  out.push(`ENDIF;`)
  out.push(``)

  out.push(`# 2. Create Attributes`)
  out.push(`# ─────────────────────────────────────────────`)
  out.push(`# Create element attributes (N = numeric, S = string, A = alias)`)
  out.push(`sAttrDim = '}ElementAttributes_' | cDimension;`)
  const ATTRS = [
    { name: 'Period Start Serial', type: 'N' },
    { name: 'Period End Serial',   type: 'N' },
    { name: 'Calendar Year',       type: 'N' },
    { name: 'Calendar Month',      type: 'N' },
    { name: 'Days in Period',      type: 'N' },
    { name: 'Fin Year',            type: 'S' },
    { name: 'First Period',        type: 'S' },
    { name: 'Last Period',         type: 'S' },
    { name: 'Previous Period',     type: 'S' },
    { name: 'Next Period',         type: 'S' },
    { name: 'Caption',             type: 'A' },
    { name: 'Long Name',           type: 'S' },
    { name: 'Is Current Period',   type: 'S' },
    { name: 'YTD',                 type: 'S' },
    { name: 'YTG',                 type: 'S' },
    { name: 'LTD',                 type: 'S' },
    { name: 'Period Type',         type: 'S' },
  ]
  for (const a of ATTRS) {
    out.push(`IF(DIMIX(sAttrDim, '${a.name}') = 0); AttrInsert(cDimension, '', '${a.name}', '${a.type}'); ENDIF;`)
  }
  out.push(``)

  out.push(`# Date Formatter`)
  out.push(`nFmt = NewDateFormatter('yyyyMMdd');`)
  out.push(``)

  out.push(`# =============================================`)
  out.push(`# 3. BUILD STRUCTURE`)
  out.push(`# =============================================`)
  out.push(`# Loops through each FY year`)
  out.push(`# For each FY: creates consolidation, OBL, 12 months`)
  out.push(`# Then builds YTD/YTG/LTD consolidations with correct child ranges`)
  out.push(`# ═══════════════════════════════════════════════════════════`)
  out.push(`nFY = nFirstFY;`)
  out.push(``)
  out.push(`WHILE(nFY <= nLastFY);`)
  out.push(``)
  out.push(`    IF(nFYStartM = 1);`)
  out.push(`        nFisStartY = nFY; nFisStartM = 1; nFisEndY = nFY; nFisEndM = 12;`)
  out.push(`    ELSE;`)
  out.push(`        nFisStartY = nFY - 1; nFisStartM = nFYStartM; nFisEndY = nFY; nFisEndM = nFYStartM - 1;`)
  out.push(`    ENDIF;`)
  out.push(``)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Create FY consolidation (e.g. FY2025)`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    sFY = 'FY' | NumberToString(nFY);`)
  out.push(``)
  out.push(`    IF(DIMIX(cDimension, sFY) = 0);`)
  out.push(`        DimensionElementInsert(cDimension, '', sFY, 'C');`)
  out.push(`    ENDIF;`)
  out.push(``)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Create OBL leaf (e.g. 2025 OBL)`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    sOBL = NumberToString(nFY) | ' OBL';`)
  out.push(`    IF(DIMIX(cDimension, sOBL) = 0);`)
  out.push(`        DimensionElementInsert(cDimension, '', sOBL, 'N');`)
  out.push(`    ENDIF;`)
  out.push(``)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Create 12 months and link to FY`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    nFisY = nFisStartY;`)
  out.push(`    nFisM = nFisStartM;`)
  out.push(`    nMonthCount = 0;`)
  out.push(``)
  out.push(`    WHILE(nMonthCount < 12);`)
  out.push(`        sMonth = ${yyyymmPad('nFisY', 'nFisM')};`)
  out.push(`        IF(DIMIX(cDimension, sMonth) = 0);`)
  out.push(`            DimensionElementInsert(cDimension, '', sMonth, 'N');`)
  out.push(`        ENDIF;`)
  out.push(`        DimensionElementComponentAdd(cDimension, sFY, sMonth, 1);`)
  out.push(`        nFisM = nFisM + 1;`)
  out.push(`        IF(nFisM > 12); nFisM = 1; nFisY = nFisY + 1; ENDIF;`)
  out.push(`        nMonthCount = nMonthCount + 1;`)
  out.push(`    END;`)
  out.push(``)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Build YTD / YTG / LTD per-month consolidations`)
  out.push(`    # YTD = months from FY start through current; YTG = remaining months`)
  out.push(`    # LTD = OBL + YTD`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    nPos = 0;`)
  out.push(`    nCalY = nFisStartY;`)
  out.push(`    nCalM = nFisStartM;`)
  out.push(``)
  out.push(`    WHILE(nPos < 12);`)
  out.push(`        sYM = ${yyyymmPad('nCalY', 'nCalM')};`)
  out.push(`        nFisP = MOD(nCalM - nFYStartM + 12, 12) + 1;`)
  out.push(`        sYTDName = 'YTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sYTGName = 'YTG FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sLTDName = 'LTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(``)
  out.push(`        DimensionElementInsert(cDimension, '', sYTDName, 'C');`)
  out.push(`        DimensionElementInsert(cDimension, '', sYTGName, 'C');`)
  out.push(`        DimensionElementInsert(cDimension, '', sLTDName, 'C');`)
  out.push(``)
  out.push(`        # Walk all 12 months and classify as YTD / YTG`)
  out.push(`        nInner = 0;`)
  out.push(`        nIY = nFisStartY;`)
  out.push(`        nIM = nFisStartM;`)
  out.push(`        WHILE(nInner < 12);`)
  out.push(`            sIM = ${yyyymmPad('nIY', 'nIM')};`)
  out.push(`            IF(nInner <= nPos);`)
  out.push(`                DimensionElementComponentAdd(cDimension, sYTDName, sIM, 1);`)
  out.push(`            ENDIF;`)
  out.push(`            IF(nInner > nPos);`)
  out.push(`                DimensionElementComponentAdd(cDimension, sYTGName, sIM, 1);`)
  out.push(`            ENDIF;`)
  out.push(`            nIM = nIM + 1;`)
  out.push(`            IF(nIM > 12); nIM = 1; nIY = nIY + 1; ENDIF;`)
  out.push(`            nInner = nInner + 1;`)
  out.push(`        END;`)
  out.push(``)
  out.push(`        DimensionElementComponentAdd(cDimension, sLTDName, sOBL, 1);`)
  out.push(`        DimensionElementComponentAdd(cDimension, sLTDName, sYTDName, 1);`)
  out.push(``)
  out.push(`        nCalM = nCalM + 1;`)
  out.push(`        IF(nCalM > 12); nCalM = 1; nCalY = nCalY + 1; ENDIF;`)
  out.push(`        nPos = nPos + 1;`)
  out.push(`    END;`)
  out.push(``)
  out.push(`    nFY = nFY + 1;`)
  out.push(`END;`)
  out.push(``)

  out.push(`# =============================================`)
  out.push(`# Top-Level Consolidations`)
  out.push(`# Populates All Periods, All FY, All YTD, All YTG, All LTD, All OBL`)
  out.push(`# =============================================`)
  out.push(`IF(DIMIX(cDimension, 'All Periods') = 0); DimensionElementInsert(cDimension, '', 'All Periods', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(cDimension, 'All FY') = 0);  DimensionElementInsert(cDimension, '', 'All FY', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(cDimension, 'All YTD') = 0); DimensionElementInsert(cDimension, '', 'All YTD', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(cDimension, 'All YTG') = 0); DimensionElementInsert(cDimension, '', 'All YTG', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(cDimension, 'All LTD') = 0); DimensionElementInsert(cDimension, '', 'All LTD', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(cDimension, 'All OBL') = 0); DimensionElementInsert(cDimension, '', 'All OBL', 'C'); ENDIF;`)
  if (selectedSubsets.includes('rolling-12')) {
    out.push(`IF(DIMIX(cDimension, 'Rolling 12') = 0); DimensionElementInsert(cDimension, '', 'Rolling 12', 'C'); ENDIF;`)
  }
  if (selectedSubsets.includes('rolling-6')) {
    out.push(`IF(DIMIX(cDimension, 'Rolling 6') = 0); DimensionElementInsert(cDimension, '', 'Rolling 6', 'C'); ENDIF;`)
  }
  if (selectedSubsets.includes('rolling-3')) {
    out.push(`IF(DIMIX(cDimension, 'Rolling 3') = 0); DimensionElementInsert(cDimension, '', 'Rolling 3', 'C'); ENDIF;`)
  }
  out.push(``)
  out.push(`nFY = nFirstFY;`)
  out.push(`WHILE(nFY <= nLastFY);`)
  out.push(`    IF(nFYStartM = 1);`)
  out.push(`        nFisStartY = nFY; nFisStartM = 1;`)
  out.push(`    ELSE;`)
  out.push(`        nFisStartY = nFY - 1; nFisStartM = nFYStartM;`)
  out.push(`    ENDIF;`)
  out.push(`    sFY = 'FY' | NumberToString(nFY);`)
  out.push(`    sOBL = NumberToString(nFY) | ' OBL';`)
  out.push(``)
  out.push(`    IF(DIMIX(cDimension, sFY) > 0);`)
  out.push(`        DimensionElementComponentAdd(cDimension, 'All FY', sFY, 1);`)
  out.push(`    ENDIF;`)
  out.push(`    IF(DIMIX(cDimension, sOBL) > 0);`)
  out.push(`        DimensionElementComponentAdd(cDimension, 'All OBL', sOBL, 1);`)
  out.push(`    ENDIF;`)
  out.push(``)
  out.push(`    nCY = nFisStartY; nCM = nFisStartM; nCount = 0;`)
  out.push(`    WHILE(nCount < 12);`)
  out.push(`        sM = ${yyyymmPad('nCY', 'nCM')};`)
  out.push(`        nFisP = MOD(nCM - nFYStartM + 12, 12) + 1;`)
  out.push(`        DimensionElementComponentAdd(cDimension, 'All Periods', sM, 1);`)
  out.push(`        sYTDName = 'YTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sYTGName = 'YTG FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sLTDName = 'LTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        IF(DIMIX(cDimension, sYTDName) > 0); DimensionElementComponentAdd(cDimension, 'All YTD', sYTDName, 1); ENDIF;`)
  out.push(`        IF(DIMIX(cDimension, sYTGName) > 0); DimensionElementComponentAdd(cDimension, 'All YTG', sYTGName, 1); ENDIF;`)
  out.push(`        IF(DIMIX(cDimension, sLTDName) > 0); DimensionElementComponentAdd(cDimension, 'All LTD', sLTDName, 1); ENDIF;`)
  out.push(`        nCM = nCM + 1; IF(nCM > 12); nCM = 1; nCY = nCY + 1; ENDIF;`)
  out.push(`        nCount = nCount + 1;`)
  out.push(`    END;`)
  out.push(``)
  out.push(`    nFY = nFY + 1;`)
  out.push(`END;`)

  return out.join('\n')
}

export function generateBuildDimensionData(params) {
  return ''
}

function yyyymmPad(yVar, mVar) {
  return `NumberToString(${yVar}) | '-' | IF(${mVar} < 10, '0' | NumberToString(${mVar}), NumberToString(${mVar}))`
}

export function generateBuildDimensionEpilog(params, selectedSubsets = []) {
  const { includeCurrentPeriodAttr, fyStartMonth } = params

  const attrLines = []
  attrLines.push(`# =============================================`)
  attrLines.push(`# 4. WRITE ATTRIBUTES`)
  attrLines.push(`# =============================================`)
  attrLines.push(`nFY = nFirstFY;`)
  attrLines.push(``)
  attrLines.push(`WHILE(nFY <= nLastFY);`)
  attrLines.push(``)
  attrLines.push(`    IF(nFYStartM = 1);`)
  attrLines.push(`        nFisStartY = nFY; nFisStartM = 1; nFisEndY = nFY; nFisEndM = 12;`)
  attrLines.push(`    ELSE;`)
  attrLines.push(`        nFisStartY = nFY - 1; nFisStartM = nFYStartM; nFisEndY = nFY; nFisEndM = nFYStartM - 1;`)
  attrLines.push(`    ENDIF;`)
  attrLines.push(``)
  attrLines.push(`    sFY = 'FY' | NumberToString(nFY);`)
  attrLines.push(`    sOBL = NumberToString(nFY) | ' OBL';`)
  attrLines.push(``)
  attrLines.push(`    IF(DIMIX(cDimension, sOBL) > 0);`)
  attrLines.push(`        ElementAttrPutS(sFY, cDimension, '', sOBL, 'Fin Year');`)
  attrLines.push(`        ElementAttrPutS('OBL', cDimension, '', sOBL, 'Period Type');`)
  attrLines.push(`        ElementAttrPutS(sOBL, cDimension, '', sOBL, 'Caption');`)
  attrLines.push(`        ElementAttrPutS('Opening Balance ' | NumberToString(nFY), cDimension, '', sOBL, 'Long Name');`)
  attrLines.push(`    ENDIF;`)
  attrLines.push(``)
  attrLines.push(`    nFisY = nFisStartY;`)
  attrLines.push(`    nFisM = nFisStartM;`)
  attrLines.push(`    nMonthCount = 0;`)
  attrLines.push(``)
  attrLines.push(`    WHILE(nMonthCount < 12);`)
  attrLines.push(`       `)
  attrLines.push(`        sMonth = ${yyyymmPad('nFisY', 'nFisM')};`)
  attrLines.push(``)
  attrLines.push(`        IF(DIMIX(cDimension, sMonth) > 0);`)
  attrLines.push(`            nYear = nFisY;`)
  attrLines.push(`            nMonth = nFisM;`)
  attrLines.push(``)
  attrLines.push(`            IF(nMonth = 2);`)
  attrLines.push(`                nDays = 28;`)
  attrLines.push(`            ELSEIF(nMonth = 4 % nMonth = 6 % nMonth = 9 % nMonth = 11);`)
  attrLines.push(`                nDays = 30;`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                nDays = 31;`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(``)
  attrLines.push(`            IF(nFisM = 1);`)
  attrLines.push(`                nPrevY = nFisY - 1; nPrevM = 12;`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                nPrevY = nFisY; nPrevM = nFisM - 1;`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(``)
  attrLines.push(`            IF(nFisM = 12);`)
  attrLines.push(`                nNextY = nFisY + 1; nNextM = 1;`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                nNextY = nFisY; nNextM = nFisM + 1;`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(``)
  attrLines.push(`            sPrev   = ${yyyymmPad('nPrevY', 'nPrevM')};`)
  attrLines.push(`            sNext   = ${yyyymmPad('nNextY', 'nNextM')};`)
  attrLines.push(`            sFirstM = ${yyyymmPad('nFisStartY', 'nFisStartM')};`)
  attrLines.push(`            sLastM  = ${yyyymmPad('nFisEndY',   'nFisEndM')};`)
  attrLines.push(``)
  attrLines.push(`            nFisP = MOD(nFisM - nFYStartM + 12, 12) + 1;`)
  attrLines.push(`            sYTD = 'YTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  attrLines.push(`            sYTG = 'YTG FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  attrLines.push(`            sLTD = 'LTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  attrLines.push(``)
  attrLines.push(`            sStartStr = NumberToString(nYear) | IF(nMonth < 10, '0', '') | NumberToString(nMonth) | '01';`)
  attrLines.push(`            sEndStr   = NumberToString(nYear) | IF(nMonth < 10, '0', '') | NumberToString(nMonth) | IF(nDays < 10, '0', '') | NumberToString(nDays);`)
  attrLines.push(`            nStartSerial = ParseDate(sStartStr, 'yyyyMMdd', nFmt) + 21916;`)
  attrLines.push(`            nEndSerial   = ParseDate(sEndStr,   'yyyyMMdd', nFmt) + 21916;`)
  attrLines.push(``)
  attrLines.push(`            sCaption  = IF(nFisM=1,'Jan',IF(nFisM=2,'Feb',IF(nFisM=3,'Mar',IF(nFisM=4,'Apr',IF(nFisM=5,'May',IF(nFisM=6,'Jun',IF(nFisM=7,'Jul',IF(nFisM=8,'Aug',IF(nFisM=9,'Sep',IF(nFisM=10,'Oct',IF(nFisM=11,'Nov','Dec'))))))))))) | ' ' | SUBST(NumberToString(nYear), 3, 2);`)
  attrLines.push(`            ElementAttrPutS(sCaption, cDimension, '', sMonth, 'Caption');`)
  attrLines.push(`            ElementAttrPutS(sMonth, cDimension, '', sMonth, 'Long Name');`)
  attrLines.push(`            ElementAttrPutS('Month', cDimension, '', sMonth, 'Period Type');`)
  attrLines.push(`            IF(sMonth @= sCurrentPeriod);`)
  attrLines.push(`                ElementAttrPutS('Y', cDimension, '', sMonth, 'Is Current Period');`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                ElementAttrPutS('', cDimension, '', sMonth, 'Is Current Period');`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(`            ElementAttrPutN(nStartSerial, cDimension, '', sMonth, 'Period Start Serial');`)
  attrLines.push(`            ElementAttrPutN(nEndSerial,   cDimension, '', sMonth, 'Period End Serial');`)
  attrLines.push(`            ElementAttrPutN(nYear,        cDimension, '', sMonth, 'Calendar Year');`)
  attrLines.push(`            ElementAttrPutN(nMonth,       cDimension, '', sMonth, 'Calendar Month');`)
  attrLines.push(`            ElementAttrPutN(nDays,        cDimension, '', sMonth, 'Days in Period');`)
  attrLines.push(`            ElementAttrPutS(sFY,      cDimension, '', sMonth, 'Fin Year');`)
  attrLines.push(`            ElementAttrPutS(sFirstM,  cDimension, '', sMonth, 'First Period');`)
  attrLines.push(`            ElementAttrPutS(sLastM,   cDimension, '', sMonth, 'Last Period');`)
  attrLines.push(`            ElementAttrPutS(sPrev,    cDimension, '', sMonth, 'Previous Period');`)
  attrLines.push(`            ElementAttrPutS(sNext,    cDimension, '', sMonth, 'Next Period');`)
  attrLines.push(`            ElementAttrPutS(sYTD,     cDimension, '', sMonth, 'YTD');`)
  attrLines.push(`            ElementAttrPutS(sYTG,     cDimension, '', sMonth, 'YTG');`)
  attrLines.push(`            ElementAttrPutS(sLTD,     cDimension, '', sMonth, 'LTD');`)
  attrLines.push(`        ENDIF;`)
  attrLines.push(``)
  attrLines.push(`        nFisM = nFisM + 1;`)
  attrLines.push(`        IF(nFisM > 12);`)
  attrLines.push(`            nFisM = 1;`)
  attrLines.push(`            nFisY = nFisY + 1;`)
  attrLines.push(`        ENDIF;`)
  attrLines.push(`       `)
  attrLines.push(`        nMonthCount = nMonthCount + 1;`)
  attrLines.push(`    END;`)
  attrLines.push(``)
  attrLines.push(`    nFY = nFY + 1;`)
  attrLines.push(`END;`)

  return [
    attrLines.join('\n'),
    ``,
    `# Consolidation Captions`,
    `nFY = nFirstFY;`,
    `WHILE(nFY <= nLastFY);`,
    `    IF(nFYStartM = 1);`,
    `        nFisStartY = nFY; nFisStartM = 1;`,
    `    ELSE;`,
    `        nFisStartY = nFY - 1; nFisStartM = nFYStartM;`,
    `    ENDIF;`,
    `    nCY = nFisStartY;`,
    `    nCM = nFisStartM;`,
    `    nCount = 0;`,
    `    WHILE(nCount < 12);`,
    `        nFisP = MOD(nCM - nFYStartM + 12, 12) + 1;`,
    `        sYTDName = 'YTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`,
    `        sYTGName = 'YTG FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`,
    `        sLTDName = 'LTD FY' | NumberToString(nFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`,
    `        sCap = ${yyyymmPad('nCY', 'nCM')};`,
    `        ElementAttrPutS('YTD ' | sCap, cDimension, '', sYTDName, 'Caption');`,
    `        ElementAttrPutS('YTG ' | sCap, cDimension, '', sYTGName, 'Caption');`,
    `        ElementAttrPutS('LTD ' | sCap, cDimension, '', sLTDName, 'Caption');`,
    `        nCM = nCM + 1; IF(nCM > 12); nCM = 1; nCY = nCY + 1; ENDIF;`,
    `        nCount = nCount + 1;`,
    `    END;`,
    `    nFY = nFY + 1;`,
    `END;`,
    ``,
    `# =============================================`,
    `# 5. POPULATE ROLLING CONSOLIDATIONS (using Next Period chain)`,
    `# =============================================`,
    `IF(sCurrentPeriod @<> '');`,
    `    IF(DIMIX(cDimension, 'Rolling 3') > 0);`,
    `        sM = sCurrentPeriod;`,
    `        nDone = 0;`,
    `        WHILE(nDone < 3 & DIMIX(cDimension, sM) > 0);`,
    `            DimensionElementComponentAddDirect(cDimension, 'Rolling 3', sM, 1);`,
    `            sM = ATTRS(cDimension, sM, 'Next Period');`,
    `            nDone = nDone + 1;`,
    `        END;`,
    `    ENDIF;`,
    `    IF(DIMIX(cDimension, 'Rolling 6') > 0);`,
    `        sM = sCurrentPeriod;`,
    `        nDone = 0;`,
    `        WHILE(nDone < 6 & DIMIX(cDimension, sM) > 0);`,
    `            DimensionElementComponentAddDirect(cDimension, 'Rolling 6', sM, 1);`,
    `            sM = ATTRS(cDimension, sM, 'Next Period');`,
    `            nDone = nDone + 1;`,
    `        END;`,
    `    ENDIF;`,
    `    IF(DIMIX(cDimension, 'Rolling 12') > 0);`,
    `        sM = sCurrentPeriod;`,
    `        nDone = 0;`,
    `        WHILE(nDone < 12 & DIMIX(cDimension, sM) > 0);`,
    `            DimensionElementComponentAddDirect(cDimension, 'Rolling 12', sM, 1);`,
    `            sM = ATTRS(cDimension, sM, 'Next Period');`,
    `            nDone = nDone + 1;`,
    `        END;`,
    `    ENDIF;`,
    `ENDIF;`,
  ].join('\n')
}
