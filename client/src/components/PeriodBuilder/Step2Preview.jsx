import { formatFY, formatMonth, MONTH_SHORT } from './lib/dateUtils.js'

export default function Step2Preview({ params, computed }) {
  const { fyData, includedFYs, includedMonths } = computed
  const { fyStartMonth, yearFormat, monthFormat } = params

  const totalMonths = includedMonths.length
  const totalFYs    = includedFYs.length

  return (
    <div className="flex flex-col gap-4 p-6 h-full overflow-hidden">
      <div className="flex gap-6 text-sm">
        <span><span className="text-muted-foreground">Fiscal years: </span><span className="font-medium">{totalFYs}</span></span>
        <span><span className="text-muted-foreground">Months: </span><span className="font-medium">{totalMonths}</span></span>
        <span className="text-muted-foreground">(all full 12-month FYs)</span>
      </div>

      <div className="flex-1 overflow-y-auto border border-border rounded text-xs font-mono">
        <table className="w-full">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b border-border text-muted-foreground text-left">
              <th className="px-3 py-2 font-medium w-24">FY</th>
              <th className="px-3 py-2 font-medium">Months</th>
              <th className="px-3 py-2 font-medium w-16 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {includedFYs.map(fyYear => {
              const fyName = formatFY(fyYear, fyStartMonth, yearFormat)
              const months = fyData[fyYear]?.months ?? []

              return (
                <tr key={fyYear} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-3 py-1.5 font-medium">{fyName}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {months.map(({ year, month }) => (
                        <span
                          key={`${year}-${month}`}
                          className="px-1.5 py-0.5 rounded bg-muted text-foreground"
                        >
                          {formatMonth(year, month, monthFormat)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {months.length}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        FY start: <strong>{MONTH_SHORT[fyStartMonth - 1]}</strong>.
        Each FY has exactly 12 months. Go back to Step 1 to adjust.
      </p>
    </div>
  )
}
