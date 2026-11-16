// Builds the Monaco tm1rules function-name regex. Kept pure so the
// effective-catalog refresh can rebuild it after Catalog Admin overrides load.
export function buildRulesFunctionPattern(catalog) {
  const names = Object.keys(catalog).sort((a, b) => b.length - a.length)
  return new RegExp(`\\b(${names.join('|')})\\b`, 'i')
}
