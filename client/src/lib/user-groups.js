export function isAdminGroup(name) {
  return String(name ?? '').trim().toLowerCase() === 'admin'
}

export function defaultUserGroups() {
  return new Set()
}

export function orderGroups(groups = []) {
  return [...groups].sort((a, b) => Number(isAdminGroup(a)) - Number(isAdminGroup(b)))
}
