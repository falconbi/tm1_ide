// One place for the identity of an object tab. The id is what openTab dedupes on,
// so the same view or dimension must produce the same string from every opener.

export function rulesTabId(server, cube) {
    return `rules:${server}:${cube}`
}

export function processTabId(server, name) {
    return `process:${server}:${name}`
}

export function dimensionTabId(server, dimension, hierarchy) {
    return `dim:${server}:${dimension}:${hierarchy ?? dimension}`
}

// The default TM1 view keeps the old three-segment id; a named view adds its name.
export function viewTabId(server, cube, view) {
    const v = view || 'Default'
    return v === 'Default' ? `cubeview:${server}:${cube}` : `cubeview:${server}:${cube}:${v}`
}

// A subset name can be reused in another hierarchy: the default hierarchy keeps the
// old id shape and an alternate hierarchy adds its name before the subset name.
export function subsetTabId(server, dimension, hierarchy, name, stamp) {
    const h = hierarchy ?? dimension
    return `subset:${server}:${dimension}${h !== dimension ? `:${h}` : ''}:${name ?? `new:${stamp ?? Date.now()}`}`
}

export function subsetLocateId(dimension, hierarchy, name) {
    const h = hierarchy ?? dimension
    return `subset:${dimension}${h !== dimension ? `:${h}` : ''}:${name}`
}
