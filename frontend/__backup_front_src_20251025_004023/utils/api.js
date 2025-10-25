export const apiBase = import.meta.env.VITE_API_BASE || '/api'


export function openAuthPopup(pathWithQuery){
const url = `${apiBase}${pathWithQuery}`
window.open(url, '_blank', 'noopener')
}