// Best-effort MDX → visual-builder axes parsing. Pure; used by the View
// editor's load/save flow and by the visual/MDX mode switch.

export function parseMdxToAxes(mdxText) {
    const make = (dim, subset = null, member = null) => ({ dimension: dim, subset, member })
    const cols = [], rows = [], pages = []

    // Extract axes part between SELECT and FROM
    const axisMatch = mdxText.match(/SELECT\s+([\s\S]*?)\s+FROM\s+\[/i)
    if (axisMatch) {
        const axesPart = axisMatch[1]

        // Find ordinal positions to split axes without overlap
        const colPos = axesPart.search(/\bON\s+(?:COLUMNS|0)\b/i)
        const rowPos = axesPart.search(/\bON\s+(?:ROWS|1)\b/i)

        let colExpr = null, rowExpr = null
        if (colPos >= 0 && rowPos >= 0) {
            if (colPos < rowPos) {
                colExpr = axesPart.slice(0, colPos).replace(/,\s*$/, '').trim()
                const afterCol = axesPart.indexOf(',', colPos)
                rowExpr = axesPart.slice(afterCol + 1, rowPos).trim()
            } else {
                rowExpr = axesPart.slice(0, rowPos).replace(/,\s*$/, '').trim()
                const afterRow = axesPart.indexOf(',', rowPos)
                colExpr = axesPart.slice(afterRow + 1, colPos).trim()
            }
        } else if (colPos >= 0) {
            colExpr = axesPart.slice(0, colPos).trim()
        } else if (rowPos >= 0) {
            rowExpr = axesPart.slice(0, rowPos).trim()
        }

        const extractSets = (expr) => {
            if (!expr) return []
            const sets = []
            let m
            // TM1SubsetToSet([Dim].[Hier], "Sub") or TM1SubsetToSet([Dim], "Sub")
            const subsetRe = /TM1SubsetToSet\s*\(\s*\[([^\]]+)\](?:\.[^\]]*\])?\s*,\s*"([^"]+)"(?:\s*,\s*"[^"]*")?\s*\)/gi
            while ((m = subsetRe.exec(expr)) !== null) sets.push(make(m[1], m[2]))
            // TM1SUBSETALL([Dim].[Hier])
            const allRe = /TM1SUBSETALL\s*\(\s*\[([^\]]+)\](?:\.[^\]]*\])?\s*\)/gi
            while ((m = allRe.exec(expr)) !== null) sets.push(make(m[1]))
            // [Dim].[Dim].Members or MEMBERS
            const membersRe = /\[([^\]]+)\]\.[^\]]*\]\.Members/gi
            while ((m = membersRe.exec(expr)) !== null) {
                if (!sets.some(s => s.dimension === m[1])) sets.push(make(m[1]))
            }
            // {[Dim].[Dim].[M1], [Dim].[Dim].[M2], ...} — multi-member set
            const multiRe = /\{\s*(\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\](?:\s*,\s*\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\])*)\s*\}/gi
            while ((m = multiRe.exec(expr)) !== null) {
                const memberMatches = [...m[1].matchAll(/\[([^\]]+)\]\.\[[^\]]+\]\.\[([^\]]+)\]/g)]
                if (memberMatches.length > 0) {
                    const dim = memberMatches[0][1]
                    if (!sets.some(s => s.dimension === dim)) {
                        const members = memberMatches.map(mm => mm[2])
                        sets.push(members.length === 1
                            ? make(dim, null, members[0])
                            : { ...make(dim), members })
                    }
                }
            }
            return sets
        }

        if (colExpr) cols.push(...extractSets(colExpr))
        if (rowExpr) rows.push(...extractSets(rowExpr))
    }

    // Extract WHERE slicers
    const whereMatch = mdxText.match(/WHERE\s*\(([\s\S]*?)\)\s*$/i)
    if (whereMatch) {
        for (const s of whereMatch[1].split(',')) {
            const trimmed = s.trim()
            // [Dim].[Hier].[Member] — specific member
            const m = trimmed.match(/\[([^\]]+)\]\.[^\]]*\]\.\[([^\]]+)\]/)
            if (m) { pages.push(make(m[1], null, m[2])); continue }
            // [Dim].[Hier].DefaultMember — placeholder slicer, keep dim in filter zone with no member
            const dm = trimmed.match(/\[([^\]]+)\]\.[^\]]*\]\.DefaultMember/i)
            if (dm) pages.push(make(dm[1]))
        }
    }

    return { columns: cols, rows, pages }
}
