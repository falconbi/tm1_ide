// The Lens editor's identity follows the name the server saved. A new Lens gets
// its name after Save; a rename moves every later bridge call to the new name.
export function afterLensSave(previousName, saved) {
  const name = saved?.name ?? previousName ?? ''
  const patch = name && name !== previousName ? { name, label: name } : null
  return { savedName: name, patch }
}
