require('dotenv').config()
const { TM1Client } = require('./core/tm1_client.js')

async function main() {
    const server = 'TM1_Apportionment'
    const cube = 'CST Activity to Activity Config'
    const view = 'RPT Default'
    const client = new TM1Client(server)

    // 1. Current view state
    console.log('=== CURRENT VIEW SETTINGS ===')
    let viewDef = await client.get(`Cubes('${encodeURIComponent(cube)}')/Views('${encodeURIComponent(view)}')`)
    console.log('SuppressEmptyRows:', viewDef.SuppressEmptyRows)
    console.log('SuppressEmptyColumns:', viewDef.SuppressEmptyColumns)

    // 2. Check what string measures exist
    console.log('\n=== STRING MEASURES IN CUBE ===')
    const dim = 'CST Activity to Activity Config Measure'
    const hier = await client.get(`Dimensions('${encodeURIComponent(dim)}')/Hierarchies('${encodeURIComponent(dim)}')/Elements?$select=Name,Type&$filter=Type eq String`)
    console.log('String elements:', hier.value?.map(e => e.Name))

    // 3. Test PAW approach: PATCH SuppressEmptyRows=true, execute, restore
    console.log('\n=== PATCH + EXECUTE + RESTORE TEST ===')
    
    // First, execute without suppression (baseline)
    console.log('\n--- Baseline (SuppressEmptyRows=false) ---')
    let exec1 = await client.executeView(cube, view)
    let r1 = exec1.Axes.find(a => a.Ordinal === 1)
    console.log(`Rows: ${r1?.Tuples?.length ?? 0}, Cells: ${exec1.Cells.length}`)

    // Patch SuppressEmptyRows=true
    console.log('\n--- Patching SuppressEmptyRows=true ---')
    await client.patch(`Cubes('${encodeURIComponent(cube)}')/Views('${encodeURIComponent(view)}')`, { SuppressEmptyRows: true })
    
    // Execute with suppression ON
    console.log('\n--- After patch (SuppressEmptyRows=true) ---')
    let exec2 = await client.executeView(cube, view)
    let r2 = exec2.Axes.find(a => a.Ordinal === 1)
    console.log(`Rows: ${r2?.Tuples?.length ?? 0}, Cells: ${exec2.Cells.length}`)

    // Restore
    console.log('\n--- Restoring SuppressEmptyRows=false ---')
    await client.patch(`Cubes('${encodeURIComponent(cube)}')/Views('${encodeURIComponent(view)}')`, { SuppressEmptyRows: false })
    viewDef = await client.get(`Cubes('${encodeURIComponent(cube)}')/Views('${encodeURIComponent(view)}')`)
    console.log('Restored:', viewDef.SuppressEmptyRows)

    // 4. Also check: any cellset-level suppression?
    // Try ExecuteMDX with the view's MDX-equivalent but including SuppressEmptyRows view property
    console.log('\n=== MDX via ExecuteMDX with view MDX ===')
    // The native view's MDX equivalent from the tool
    const colExpr = `TM1SubsetToSet([GBL Period].[GBL Period], "Bdgt Periods", "public")`
    const rowExpr = `CrossJoin(CrossJoin(CrossJoin({TM1SUBSETALL([CST Activity].[CST Activity])}, {TM1SUBSETALL([CST Activity Dest].[CST Activity Dest])}), {TM1SUBSETALL([GBL Cost Centre].[GBL Cost Centre])}), {TM1SUBSETALL([CST Activity to Activity Config Measure].[CST Activity to Activity Config Measure])})`
    const mdx = `SELECT\n  ${colExpr} ON COLUMNS,\n  ${rowExpr} ON ROWS\nFROM [${cube}]\nWHERE ([GBL Version].[GBL Version].[Budget])`
    
    let execMdx = await client.executeMDX(mdx)
    let rMdx = execMdx.Axes.find(a => a.Ordinal === 1)
    console.log(`Full (no NON EMPTY): ${rMdx?.Tuples?.length ?? 0} rows, ${execMdx.Cells.length} cells`)
    
    // Cleanup
    try { require('fs').unlinkSync('/home/jdlove/apps/tm1_ide/view_investigate4.js') } catch {}
}

main().catch(e => {
    console.error('Fatal:', e.message)
    if (e.response?.data) console.error('Response:', JSON.stringify(e.response.data).slice(0, 500))
    process.exit(1)
})
