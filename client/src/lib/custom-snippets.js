const KEY = 'tm1.custom.snippets'

export function loadCustomSnippets() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') }
  catch { return [] }
}

export function saveCustomSnippets(snippets) {
  localStorage.setItem(KEY, JSON.stringify(snippets))
}

export function addOrUpdateCustomSnippet(snippet) {
  const all = loadCustomSnippets()
  const i = all.findIndex(s => s.trigger === snippet.trigger && s.language === snippet.language)
  if (i >= 0) all[i] = snippet; else all.push(snippet)
  saveCustomSnippets(all)
}

export function deleteCustomSnippet(trigger, language) {
  saveCustomSnippets(loadCustomSnippets().filter(s => !(s.trigger === trigger && s.language === language)))
}

export function exportSnippetsFile(language, snippets) {
  const payload = JSON.stringify({
    type: 'tm1-snippets',
    version: 1,
    language,
    exported: new Date().toISOString(),
    snippets,
  }, null, 2)
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([payload], { type: 'application/json' })),
    download: `tm1-${language}-snippets.json`,
  })
  a.click()
  URL.revokeObjectURL(a.href)
}

export function parseSnippetImport(text) {
  const data = JSON.parse(text)
  if (data.type !== 'tm1-snippets') throw new Error('Not a TM1 snippets file')
  if (!Array.isArray(data.snippets)) throw new Error('Invalid format — snippets array missing')
  return data.snippets
}
