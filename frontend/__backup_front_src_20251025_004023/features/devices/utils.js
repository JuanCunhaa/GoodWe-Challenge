// src/features/devices/utils.js
export async function batch(arr, size, fn) {
  for (let i = 0; i < arr.length; i += size) {
    await Promise.all(arr.slice(i, i + size).map(fn))
  }
}

export function safeParse(jsonLike) {
  try {
    if (!jsonLike || typeof jsonLike !== 'string') return null
    return JSON.parse(jsonLike)
  } catch {
    return null
  }
}
