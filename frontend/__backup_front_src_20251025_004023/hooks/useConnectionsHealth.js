import { useState } from 'react'


export function useConnectionsHealth() {
    const [apiHealth, setApiHealth] = useState(null)
    const [assistantPing, setAssistantPing] = useState(null)


    async function check() {
        try {
            const base = import.meta.env.VITE_API_BASE || '/api'
            const r1 = await fetch(`${base}/health`).then(r => r.ok)
            setApiHealth(!!r1)
            const r2 = await fetch(`${base}/assistant/ping`).then(r => r.json()).catch(() => null)
            setAssistantPing(r2 || null)
        } catch { setApiHealth(false) }
    }


    return { apiHealth, assistantPing, check }
}