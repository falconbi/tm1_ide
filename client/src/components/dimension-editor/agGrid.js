import { AllCommunityModule, ModuleRegistry, themeBalham, colorSchemeDark, colorSchemeLight } from 'ag-grid-community'

// One registration for the editor's grids.
ModuleRegistry.registerModules([AllCommunityModule])

export const lightTheme = themeBalham.withPart(colorSchemeLight).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })
export const darkTheme  = themeBalham.withPart(colorSchemeDark).withParams({ fontSize: 12, rowHeight: 24, headerHeight: 28 })

// the attribute grid's column defaults -- one object, so a redraw doesn't reset the columns
export const ATTR_DEFAULT_COL = { resizable: true }
