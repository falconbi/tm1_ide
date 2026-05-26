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

  // ── Header ──
  out.push(`# =============================================`)
  out.push(`# Build Period Dimension — ${dimensionName}`)
  out.push(`# Parameters: pFirstFY, pLastFY, pFYStartM`)
  out.push(`# =============================================`)
  out.push(``)
  out.push(`pDimension = '${dimensionName}';`)
  out.push(``)

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 1 — Create or Destroy Dimension
  // ═══════════════════════════════════════════════════════════════════════════
  out.push(`# 1. Create Dimension`)
  out.push(`# ─────────────────────────────────────────────`)
  if (replaceDimension) {
    out.push(`# If replace is enabled: destroy the existing dimension first`)
    out.push(`IF(DIMIX('}Dimensions', pDimension) > 0);`)
    out.push(`    DimensionDestroy(pDimension);`)
    out.push(`ENDIF;`)
  }
  out.push(`# Create the dimension if it does not already exist`)
  out.push(`IF(DIMIX('}Dimensions', pDimension) = 0);`)
  out.push(`    DimensionCreate(pDimension);`)
  out.push(`ENDIF;`)
  out.push(``)

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 2 — Create Element Attributes
  // ═══════════════════════════════════════════════════════════════════════════
  out.push(`# 2. Create Attributes`)
  out.push(`# ─────────────────────────────────────────────`)
  out.push(`# Create 16 element attributes (N = numeric, S = string, A = alias)`)
  out.push(`# sAttrDim = control dimension that stores element attribute definitions`)
  out.push(`sAttrDim = '}ElementAttributes_' | pDimension;`)
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
    out.push(`IF(DIMIX(sAttrDim, '${a.name}') = 0); AttrInsert(pDimension, '', '${a.name}', '${a.type}'); ENDIF;`)
  }
  out.push(``)

  out.push(`# Date Formatter`)
  out.push(`nFmt = NewDateFormatter('yyyyMMdd');`)
  out.push(``)

  // ── STEP 3: Build Structure ──
  // ── Build Structure: FY loop ──
  // Creates FY consolidation + OBL leaf + 12 month leaves per FY
  // Then builds YTD/YTG/LTD per-month consolidations with proper child ranges
  out.push(`# =============================================`)
  out.push(`# 3. BUILD STRUCTURE`)
  out.push(`# =============================================`)
  out.push(`# Loops through each FY year`)
  out.push(`# For each FY: creates consolidation, OBL, 12 months`)
  out.push(`# Then builds YTD/YTG/LTD consolidations with correct child ranges`)
  out.push(`# ═══════════════════════════════════════════════════════════`)
  out.push(`vFY = pFirstFY;`)
  out.push(``)
  out.push(`WHILE(vFY <= pLastFY);`)
  out.push(``)
  out.push(`    IF(pFYStartM = 1);`)
  out.push(`        vFisStartY = vFY; vFisStartM = 1; vFisEndY = vFY; vFisEndM = 12;`)
  out.push(`    ELSE;`)
  out.push(`        vFisStartY = vFY - 1; vFisStartM = pFYStartM; vFisEndY = vFY; vFisEndM = pFYStartM - 1;`)
  out.push(`    ENDIF;`)
  out.push(``)
  // ── FY loop: create consolidation + OBL + 12 months ──
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Create FY consolidation (e.g. FY2025)`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    sFY = 'FY' | NumberToString(vFY);`)
  out.push(``)
  out.push(`    IF(DIMIX(pDimension, sFY) = 0);`)
  out.push(`        DimensionElementInsert(pDimension, '', sFY, 'C');`)
  out.push(`    ENDIF;`)
  out.push(``)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Create OBL leaf (e.g. 2025 OBL)`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    sOBL = NumberToString(vFY) | ' OBL';`)
  out.push(`    IF(DIMIX(pDimension, sOBL) = 0);`)
  out.push(`        DimensionElementInsert(pDimension, '', sOBL, 'N');`)
  out.push(`    ENDIF;`)
  out.push(``)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Create 12 months and link to FY`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    vFisY = vFisStartY;`)
  out.push(`    vFisM = vFisStartM;`)
  out.push(`    vMonthCount = 0;`)
  out.push(``)
  out.push(`    WHILE(vMonthCount < 12);`)
  out.push(`        sMonth = ${yyyymmPad('vFisY', 'vFisM')};`)
  out.push(`        IF(DIMIX(pDimension, sMonth) = 0);`)
  out.push(`            DimensionElementInsert(pDimension, '', sMonth, 'N');`)
  out.push(`        ENDIF;`)
  out.push(`        DimensionElementComponentAdd(pDimension, sFY, sMonth, 1);`)
  out.push(`        vFisM = vFisM + 1;`)
  out.push(`        IF(vFisM > 12); vFisM = 1; vFisY = vFisY + 1; ENDIF;`)
  out.push(`        vMonthCount = vMonthCount + 1;`)
  out.push(`    END;`)
  out.push(``)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    # Build YTD / YTG / LTD per-month consolidations`)
  out.push(`    # YTD = months Apr through current; YTG = remaining months`)
  out.push(`    # LTD = OBL + YTD`)
  out.push(`    # ─────────────────────────────────────────────`)
  out.push(`    vPos = 0;`)
  out.push(`    vCalY = vFisStartY;`)
  out.push(`    vCalM = vFisStartM;`)
  out.push(``)
  out.push(`    WHILE(vPos < 12);`)
  out.push(`        sYM = ${yyyymmPad('vCalY', 'vCalM')};`)
  out.push(`        nFisP = MOD(vCalM - pFYStartM + 12, 12) + 1;`)
  out.push(`        sYTDName = 'YTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sYTGName = 'YTG FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sLTDName = 'LTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(``)
  out.push(`        DimensionElementInsert(pDimension, '', sYTDName, 'C');`)
  out.push(`        DimensionElementInsert(pDimension, '', sYTGName, 'C');`)
  out.push(`        DimensionElementInsert(pDimension, '', sLTDName, 'C');`)
  out.push(``)

  out.push(`        # Walk all 12 months and classify as YTD / YTG`)
  out.push(`        vInner = 0;`)
  out.push(`        vIY = vFisStartY;`)
  out.push(`        vIM = vFisStartM;`)
  out.push(`        WHILE(vInner < 12);`)
  out.push(`            sIM = ${yyyymmPad('vIY', 'vIM')};`)
  out.push(`            IF(vInner <= vPos);`)
  out.push(`                DimensionElementComponentAdd(pDimension, sYTDName, sIM, 1);`)
  out.push(`            ENDIF;`)
  out.push(`            IF(vInner > vPos);`)
  out.push(`                DimensionElementComponentAdd(pDimension, sYTGName, sIM, 1);`)
  out.push(`            ENDIF;`)
  out.push(`            vIM = vIM + 1;`)
  out.push(`            IF(vIM > 12); vIM = 1; vIY = vIY + 1; ENDIF;`)
  out.push(`            vInner = vInner + 1;`)
  out.push(`        END;`)
  out.push(``)
  out.push(`        DimensionElementComponentAdd(pDimension, sLTDName, sOBL, 1);`)
  out.push(`        DimensionElementComponentAdd(pDimension, sLTDName, sYTDName, 1);`)
  out.push(``)
  out.push(`        vCalM = vCalM + 1;`)
  out.push(`        IF(vCalM > 12); vCalM = 1; vCalY = vCalY + 1; ENDIF;`)
  out.push(`        vPos = vPos + 1;`)
  out.push(`    END;`)
  out.push(``)
  out.push(`    vFY = vFY + 1;`)
  out.push(`END;`)
  out.push(``)

  // ── ALL Periods consolidation ──
  // ── ALL consolidations + populating them ──
  out.push(`# =============================================`)
  out.push(`# Top-Level Consolidations`)
  out.push(`# Populates All Periods, All FY, All YTD, All YTG, All LTD, All OBL`)
  out.push(`# Optionally builds Rolling 12/6/3 (filtered by pCurrentPeriod)`)
  out.push(`# =============================================`)
  out.push(`IF(DIMIX(pDimension, 'All Periods') = 0); DimensionElementInsert(pDimension, '', 'All Periods', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(pDimension, 'All FY') = 0);  DimensionElementInsert(pDimension, '', 'All FY', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(pDimension, 'All YTD') = 0); DimensionElementInsert(pDimension, '', 'All YTD', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(pDimension, 'All YTG') = 0); DimensionElementInsert(pDimension, '', 'All YTG', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(pDimension, 'All LTD') = 0); DimensionElementInsert(pDimension, '', 'All LTD', 'C'); ENDIF;`)
  out.push(`IF(DIMIX(pDimension, 'All OBL') = 0); DimensionElementInsert(pDimension, '', 'All OBL', 'C'); ENDIF;`)
  if (selectedSubsets.includes('rolling-12')) {
    out.push(`IF(DIMIX(pDimension, 'Rolling 12') = 0); DimensionElementInsert(pDimension, '', 'Rolling 12', 'C'); ENDIF;`)
  }
  if (selectedSubsets.includes('rolling-6')) {
    out.push(`IF(DIMIX(pDimension, 'Rolling 6') = 0); DimensionElementInsert(pDimension, '', 'Rolling 6', 'C'); ENDIF;`)
  }
  if (selectedSubsets.includes('rolling-3')) {
    out.push(`IF(DIMIX(pDimension, 'Rolling 3') = 0); DimensionElementInsert(pDimension, '', 'Rolling 3', 'C'); ENDIF;`)
  }
  out.push(``)
  out.push(`vFY = pFirstFY;`)
  out.push(`WHILE(vFY <= pLastFY);`)
  out.push(`    IF(pFYStartM = 1);`)
  out.push(`        vFisStartY = vFY; vFisStartM = 1;`)
  out.push(`    ELSE;`)
  out.push(`        vFisStartY = vFY - 1; vFisStartM = pFYStartM;`)
  out.push(`    ENDIF;`)
  out.push(`    sFY = 'FY' | NumberToString(vFY);`)
  out.push(`    sOBL = NumberToString(vFY) | ' OBL';`)
  out.push(``)
  out.push(`    IF(DIMIX(pDimension, sFY) > 0);`)
  out.push(`        DimensionElementComponentAdd(pDimension, 'All FY', sFY, 1);`)
  out.push(`    ENDIF;`)
  out.push(`    IF(DIMIX(pDimension, sOBL) > 0);`)
  out.push(`        DimensionElementComponentAdd(pDimension, 'All OBL', sOBL, 1);`)
  out.push(`    ENDIF;`)
  out.push(``)
  out.push(`    vCY = vFisStartY; vCM = vFisStartM; vCount = 0;`)
  out.push(`    WHILE(vCount < 12);`)
  out.push(`        sM = ${yyyymmPad('vCY', 'vCM')};`)
  out.push(`        nFisP = MOD(vCM - pFYStartM + 12, 12) + 1;`)
  out.push(`        DimensionElementComponentAdd(pDimension, 'All Periods', sM, 1);`)
  // Rolling 12/6/3 children are populated at the end of the Epilog
  // using the 'Next Period' attribute chain (cleaner + more reliable)
  out.push(`        sYTDName = 'YTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sYTGName = 'YTG FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        sLTDName = 'LTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  out.push(`        IF(DIMIX(pDimension, sYTDName) > 0); DimensionElementComponentAdd(pDimension, 'All YTD', sYTDName, 1); ENDIF;`)
  out.push(`        IF(DIMIX(pDimension, sYTGName) > 0); DimensionElementComponentAdd(pDimension, 'All YTG', sYTGName, 1); ENDIF;`)
  out.push(`        IF(DIMIX(pDimension, sLTDName) > 0); DimensionElementComponentAdd(pDimension, 'All LTD', sLTDName, 1); ENDIF;`)
  out.push(`        vCM = vCM + 1; IF(vCM > 12); vCM = 1; vCY = vCY + 1; ENDIF;`)
  out.push(`        vCount = vCount + 1;`)
  out.push(`    END;`)
  out.push(``)
  out.push(`    vFY = vFY + 1;`)
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
  attrLines.push(`vFY = pFirstFY;`)
  attrLines.push(``)
  attrLines.push(`WHILE(vFY <= pLastFY);`)
  attrLines.push(``)
  attrLines.push(`    IF(pFYStartM = 1);`)
  attrLines.push(`        vFisStartY = vFY; vFisStartM = 1; vFisEndY = vFY; vFisEndM = 12;`)
  attrLines.push(`    ELSE;`)
  attrLines.push(`        vFisStartY = vFY - 1; vFisStartM = pFYStartM; vFisEndY = vFY; vFisEndM = pFYStartM - 1;`)
  attrLines.push(`    ENDIF;`)
  attrLines.push(``)
  attrLines.push(`    sFY = 'FY' | NumberToString(vFY);`)
  attrLines.push(`    sOBL = NumberToString(vFY) | ' OBL';`)
  attrLines.push(``)
  attrLines.push(`    IF(DIMIX(pDimension, sOBL) > 0);`)
  attrLines.push(`        ElementAttrPutS(sFY, pDimension, '', sOBL, 'Fin Year');`)
  attrLines.push(`        ElementAttrPutS('OBL', pDimension, '', sOBL, 'Period Type');`)
  attrLines.push(`        ElementAttrPutS(sOBL, pDimension, '', sOBL, 'Caption');`)
  attrLines.push(`        ElementAttrPutS('Opening Balance ' | NumberToString(vFY), pDimension, '', sOBL, 'Long Name');`)
  attrLines.push(`    ENDIF;`)
  attrLines.push(``)
  attrLines.push(`    vFisY = vFisStartY;`)
  attrLines.push(`    vFisM = vFisStartM;`)
  attrLines.push(`    vMonthCount = 0;`)
  attrLines.push(``)
  attrLines.push(`    WHILE(vMonthCount < 12);`)
  attrLines.push(`       `)
  attrLines.push(`        sMonth = ${yyyymmPad('vFisY', 'vFisM')};`)
  attrLines.push(``)
  attrLines.push(`        IF(DIMIX(pDimension, sMonth) > 0);`)
  attrLines.push(`            nYear = vFisY;`)
  attrLines.push(`            nMonth = vFisM;`)
  attrLines.push(``)
  attrLines.push(`            IF(nMonth = 2);`)
  attrLines.push(`                nDays = 28;`)
  attrLines.push(`            ELSEIF(nMonth = 4 % nMonth = 6 % nMonth = 9 % nMonth = 11);`)
  attrLines.push(`                nDays = 30;`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                nDays = 31;`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(``)
  attrLines.push(`            IF(vFisM = 1);`)
  attrLines.push(`                nPrevY = vFisY - 1; nPrevM = 12;`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                nPrevY = vFisY; nPrevM = vFisM - 1;`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(``)
  attrLines.push(`            IF(vFisM = 12);`)
  attrLines.push(`                nNextY = vFisY + 1; nNextM = 1;`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                nNextY = vFisY; nNextM = vFisM + 1;`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(``)
  attrLines.push(`            sPrev   = ${yyyymmPad('nPrevY', 'nPrevM')};`)
  attrLines.push(`            sNext   = ${yyyymmPad('nNextY', 'nNextM')};`)
  attrLines.push(`            sFirstM = ${yyyymmPad('vFisStartY', 'vFisStartM')};`)
  attrLines.push(`            sLastM  = ${yyyymmPad('vFisEndY',   'vFisEndM')};`)
  attrLines.push(``)
  attrLines.push(`            nFisP = MOD(vFisM - pFYStartM + 12, 12) + 1;`)
  attrLines.push(`            sYTD = 'YTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  attrLines.push(`            sYTG = 'YTG FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  attrLines.push(`            sLTD = 'LTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`)
  attrLines.push(``)
  attrLines.push(`            sStartStr = NumberToString(nYear) | IF(nMonth < 10, '0', '') | NumberToString(nMonth) | '01';`)
  attrLines.push(`            sEndStr   = NumberToString(nYear) | IF(nMonth < 10, '0', '') | NumberToString(nMonth) | IF(nDays < 10, '0', '') | NumberToString(nDays);`)
  attrLines.push(`            nStartSerial = ParseDate(sStartStr, 'yyyyMMdd', nFmt) + 21916;`)
  attrLines.push(`            nEndSerial   = ParseDate(sEndStr,   'yyyyMMdd', nFmt) + 21916;`)
  attrLines.push(``)
  attrLines.push(`            sCaption  = IF(vFisM=1,'Jan',IF(vFisM=2,'Feb',IF(vFisM=3,'Mar',IF(vFisM=4,'Apr',IF(vFisM=5,'May',IF(vFisM=6,'Jun',IF(vFisM=7,'Jul',IF(vFisM=8,'Aug',IF(vFisM=9,'Sep',IF(vFisM=10,'Oct',IF(vFisM=11,'Nov','Dec'))))))))))) | ' ' | SUBST(NumberToString(nYear), 3, 2);`)
  attrLines.push(`            ElementAttrPutS(sCaption, pDimension, '', sMonth, 'Caption');`)
  attrLines.push(`            ElementAttrPutS(sMonth, pDimension, '', sMonth, 'Long Name');`)
  attrLines.push(`            ElementAttrPutS('Month', pDimension, '', sMonth, 'Period Type');`)
  attrLines.push(`            IF(sMonth @= pCurrentPeriod);`)
  attrLines.push(`                ElementAttrPutS('Y', pDimension, '', sMonth, 'Is Current Period');`)
  attrLines.push(`            ELSE;`)
  attrLines.push(`                ElementAttrPutS('', pDimension, '', sMonth, 'Is Current Period');`)
  attrLines.push(`            ENDIF;`)
  attrLines.push(`            ElementAttrPutN(nStartSerial, pDimension, '', sMonth, 'Period Start Serial');`)
  attrLines.push(`            ElementAttrPutN(nEndSerial,   pDimension, '', sMonth, 'Period End Serial');`)
  attrLines.push(`            ElementAttrPutN(nYear,        pDimension, '', sMonth, 'Calendar Year');`)
  attrLines.push(`            ElementAttrPutN(nMonth,       pDimension, '', sMonth, 'Calendar Month');`)
  attrLines.push(`            ElementAttrPutN(nDays,        pDimension, '', sMonth, 'Days in Period');`)
  attrLines.push(`            ElementAttrPutS(sFY,      pDimension, '', sMonth, 'Fin Year');`)
  attrLines.push(`            ElementAttrPutS(sFirstM,  pDimension, '', sMonth, 'First Period');`)
  attrLines.push(`            ElementAttrPutS(sLastM,   pDimension, '', sMonth, 'Last Period');`)
  attrLines.push(`            ElementAttrPutS(sPrev,    pDimension, '', sMonth, 'Previous Period');`)
  attrLines.push(`            ElementAttrPutS(sNext,    pDimension, '', sMonth, 'Next Period');`)
  attrLines.push(`            ElementAttrPutS(sYTD,     pDimension, '', sMonth, 'YTD');`)
  attrLines.push(`            ElementAttrPutS(sYTG,     pDimension, '', sMonth, 'YTG');`)
  attrLines.push(`            ElementAttrPutS(sLTD,     pDimension, '', sMonth, 'LTD');`)
  attrLines.push(`        ENDIF;`)
  attrLines.push(``)
  attrLines.push(`        vFisM = vFisM + 1;`)
  attrLines.push(`        IF(vFisM > 12);`)
  attrLines.push(`            vFisM = 1;`)
  attrLines.push(`            vFisY = vFisY + 1;`)
  attrLines.push(`        ENDIF;`)
  attrLines.push(`       `)
  attrLines.push(`        vMonthCount = vMonthCount + 1;`)
  attrLines.push(`    END;`)
  attrLines.push(``)
  attrLines.push(`    vFY = vFY + 1;`)
  attrLines.push(`END;`)

  return [
    attrLines.join('\n'),
    ``,
    `# Consolidation Captions`,
    `vFY = pFirstFY;`,
    `WHILE(vFY <= pLastFY);`,
    `    IF(pFYStartM = 1);`,
    `        vFisStartY = vFY; vFisStartM = 1;`,
    `    ELSE;`,
    `        vFisStartY = vFY - 1; vFisStartM = pFYStartM;`,
    `    ENDIF;`,
    `    vCY = vFisStartY;`,
    `    vCM = vFisStartM;`,
    `    vCount = 0;`,
    `    WHILE(vCount < 12);`,
    `        nFisP = MOD(vCM - pFYStartM + 12, 12) + 1;`,
    `        sYTDName = 'YTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`,
    `        sYTGName = 'YTG FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`,
    `        sLTDName = 'LTD FY' | NumberToString(vFY) | ' P' | IF(nFisP < 10, '0' | NumberToString(nFisP), NumberToString(nFisP));`,
    `        sCap = ${yyyymmPad('vCY', 'vCM')};`,
    `        ElementAttrPutS('YTD ' | sCap, pDimension, '', sYTDName, 'Caption');`,
    `        ElementAttrPutS('YTG ' | sCap, pDimension, '', sYTGName, 'Caption');`,
    `        ElementAttrPutS('LTD ' | sCap, pDimension, '', sLTDName, 'Caption');`,
    `        vCM = vCM + 1; IF(vCM > 12); vCM = 1; vCY = vCY + 1; ENDIF;`,
    `        vCount = vCount + 1;`,
    `    END;`,
    `    vFY = vFY + 1;`,
    `END;`,
    ``,
    `# =============================================`,
    `# 5. POPULATE ROLLING CONSOLIDATIONS (using Next Period chain)`,
    `# Simple forward sequence from pCurrentPeriod`,
    `# =============================================`,
    `IF(pCurrentPeriod @<> '');`,
    `    # Rolling 3 = current + next 2 months`,
    `    IF(DIMIX(pDimension, 'Rolling 3') > 0);`,
    `        sM = pCurrentPeriod;`,
    `        nDone = 0;`,
    `        WHILE(nDone < 3 & DIMIX(pDimension, sM) > 0);`,
    `            DimensionElementComponentAddDirect(pDimension, 'Rolling 3', sM, 1);`,
    `            sM = ATTRS(pDimension, sM, 'Next Period');`,
    `            nDone = nDone + 1;`,
    `        END;`,
    `    ENDIF;`,
    `    # Rolling 6`,
    `    IF(DIMIX(pDimension, 'Rolling 6') > 0);`,
    `        sM = pCurrentPeriod;`,
    `        nDone = 0;`,
    `        WHILE(nDone < 6 & DIMIX(pDimension, sM) > 0);`,
    `            DimensionElementComponentAddDirect(pDimension, 'Rolling 6', sM, 1);`,
    `            sM = ATTRS(pDimension, sM, 'Next Period');`,
    `            nDone = nDone + 1;`,
    `        END;`,
    `    ENDIF;`,
    `    # Rolling 12`,
    `    IF(DIMIX(pDimension, 'Rolling 12') > 0);`,
    `        sM = pCurrentPeriod;`,
    `        nDone = 0;`,
    `        WHILE(nDone < 12 & DIMIX(pDimension, sM) > 0);`,
    `            DimensionElementComponentAddDirect(pDimension, 'Rolling 12', sM, 1);`,
    `            sM = ATTRS(pDimension, sM, 'Next Period');`,
    `            nDone = nDone + 1;`,
    `        END;`,
    `    ENDIF;`,
    `ENDIF;`,
  ].join('\n')
}
