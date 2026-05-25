const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year, month) {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

// Excel date serial — Jan 1 1970 = 25569, accounts for Excel's phantom Feb 29 1900
export function excelSerial(year, month, day) {
  const unixDays = Date.UTC(year, month - 1, day) / 86400000
  return Math.floor(unixDays + 25569)
}

// FY number = calendar year the FY ends in
// April start: Apr 2023 → FY2024.  January start: Jan 2024 → FY2024.
export function fyForMonth(year, month, fyStartMonth) {
  if (fyStartMonth === 1) return year
  return month >= fyStartMonth ? year + 1 : year
}

// First and last calendar month/year of a given FY
export function fyBounds(fyYear, fyStartMonth) {
  if (fyStartMonth === 1) {
    return { firstYear: fyYear, firstMonth: 1, lastYear: fyYear, lastMonth: 12 }
  }
  return {
    firstYear: fyYear - 1,
    firstMonth: fyStartMonth,
    lastYear: fyYear,
    lastMonth: fyStartMonth - 1,
  }
}

export function formatMonth(year, month, fmt) {
  const m2 = String(month).padStart(2, '0')
  const y2 = String(year).slice(2)
  switch (fmt) {
    case 'YYYY-MM':  return `${year}-${m2}`
    case 'Mon-YY':   return `${MONTH_SHORT[month - 1]}-${y2}`
    case 'YYYYMM':   return `${year}${m2}`
    default:         return `${year}-${m2}`
  }
}

export function formatCaption(year, month, fmt) {
  const y2 = String(year).slice(2)
  switch (fmt) {
    case 'Mon-YY':    return `${MONTH_SHORT[month - 1]}-${y2}`
    case 'Mon YYYY':  return `${MONTH_SHORT[month - 1]} ${year}`
    case 'MMMM YYYY': return `${MONTH_NAMES[month - 1]} ${year}`
    default:          return `${MONTH_SHORT[month - 1]}-${y2}`
  }
}

export function formatLongName(year, month, fmt) {
  const m2 = String(month).padStart(2, '0')
  switch (fmt) {
    case 'Month YYYY': return `${MONTH_NAMES[month - 1]} ${year}`
    case 'YYYY-MM':    return `${year}-${m2}`
    default:           return `${MONTH_NAMES[month - 1]} ${year}`
  }
}

export function formatFY(fyYear, fyStartMonth, fmt) {
  const startYear = fyStartMonth === 1 ? fyYear : fyYear - 1
  switch (fmt) {
    case 'fy-end':   return `FY${fyYear}`
    case 'fy-start': return `FY${startYear}`
    case 'yyyy':     return String(fyYear)
    default:         return `FY${fyYear}`
  }
}

export { MONTH_NAMES, MONTH_SHORT }
