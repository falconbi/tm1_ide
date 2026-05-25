import {
  daysInMonth, excelSerial,
  fyForMonth, fyBounds,
  formatMonth, formatCaption, formatLongName, formatFY,
} from './dateUtils.js'

export function computeDimension(params) {
  const {
    dimensionName,
    fyStartMonth,
    firstCalYear,
    lastCalYear,
    yearFormat,
    monthFormat,
    captionFormat,
    longNameFormat,
    includeTotal,
    partialBoundary,
    includeCurrentPeriodAttr,
  } = params

  // All calendar months in the requested range
  const allMonths = []
  for (let y = firstCalYear; y <= lastCalYear; y++) {
    for (let m = 1; m <= 12; m++) {
      allMonths.push({ year: y, month: m })
    }
  }

  // Group months by FY
  const fyMap = new Map()
  for (const { year, month } of allMonths) {
    const fy = fyForMonth(year, month, fyStartMonth)
    if (!fyMap.has(fy)) fyMap.set(fy, [])
    fyMap.get(fy).push({ year, month })
  }

  const fyYears = [...fyMap.keys()].sort((a, b) => a - b)
  const fyData = {}
  for (const fyYear of fyYears) {
    const months = fyMap.get(fyYear)
    fyData[fyYear] = { months, isPartial: months.length < 12 }
  }

  // Optionally drop partial boundary FYs
  const includedFYs = partialBoundary === 'full-only'
    ? fyYears.filter(fy => !fyData[fy].isPartial)
    : fyYears

  const includedMonths = allMonths.filter(
    ({ year, month }) => includedFYs.includes(fyForMonth(year, month, fyStartMonth))
  )

  // Build element list: Total → FYs → months (in order)
  const elements = []
  if (includeTotal) {
    elements.push({ name: `Total ${dimensionName}`, type: 'C', level: 'total' })
  }
  for (const fyYear of includedFYs) {
    elements.push({ name: formatFY(fyYear, fyStartMonth, yearFormat), type: 'C', level: 'fy', fyYear })
  }
  for (const { year, month } of includedMonths) {
    elements.push({ name: formatMonth(year, month, monthFormat), type: 'N', level: 'month', year, month })
  }

  // Edges
  const edges = []
  const totalName = `Total ${dimensionName}`
  for (const fyYear of includedFYs) {
    const fyName = formatFY(fyYear, fyStartMonth, yearFormat)
    if (includeTotal) edges.push({ parent: totalName, child: fyName, weight: 1 })
    for (const { year, month } of fyData[fyYear].months) {
      if (!includedMonths.find(m => m.year === year && m.month === month)) continue
      edges.push({ parent: fyName, child: formatMonth(year, month, monthFormat), weight: 1 })
    }
  }

  // Attribute values — only computed for leaf months; FY consolidations left blank
  const attributes = {}

  const includedSet = new Set(includedMonths.map(({ year, month }) => `${year}:${month}`))

  for (const el of elements) {
    if (el.level !== 'month') {
      attributes[el.name] = {}
      continue
    }
    const { year, month } = el
    const fy = fyForMonth(year, month, fyStartMonth)
    const fyName = formatFY(fy, fyStartMonth, yearFormat)
    const bounds = fyBounds(fy, fyStartMonth)

    const prevYear = month === 1 ? year - 1 : year
    const prevMonth = month === 1 ? 12 : month - 1
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const hasPrev = includedSet.has(`${prevYear}:${prevMonth}`)
    const hasNext = includedSet.has(`${nextYear}:${nextMonth}`)

    attributes[el.name] = {
      'Period Start Serial': excelSerial(year, month, 1),
      'Period End Serial': excelSerial(year, month, daysInMonth(year, month)),
      'Calendar Year': year,
      'Calendar Month': month,
      'Days in Period': daysInMonth(year, month),
      'Fin Year': fyName,
      'First Period': formatMonth(bounds.firstYear, bounds.firstMonth, monthFormat),
      'Last Period': formatMonth(bounds.lastYear, bounds.lastMonth, monthFormat),
      'Previous Period': hasPrev ? formatMonth(prevYear, prevMonth, monthFormat) : '',
      'Next Period': hasNext ? formatMonth(nextYear, nextMonth, monthFormat) : '',
      'Caption': formatCaption(year, month, captionFormat),
      'Long Name': formatLongName(year, month, longNameFormat),
      ...(includeCurrentPeriodAttr ? { 'Is Current Period': '' } : {}),
    }
  }

  return { elements, edges, attributes, fyData, includedFYs, includedMonths }
}
