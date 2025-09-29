import { useEffect, useState } from 'react'
import { authApi } from '../services/authApi.js'


export function usePowerstationName(powerstationId) {
    const [psName, setPsName] = useState('')
    const [ok, setOk] = useState('')
    const [err, setErr] = useState('')


    useEffect(() => {
        if (!powerstationId) { setPsName(''); return }
        (async () => {
            try {
                const list = await authApi.listPowerstations()
                const it = (list?.items || []).find(x => String(x.id) === String(powerstationId))
                if (it) setPsName(String(it.business_name || ''))
            } catch { }
        })()
    }, [powerstationId])


    async function saveName() {
        setOk(''); setErr('')
        try {
            const base = import.meta.env.VITE_API_BASE || '/api'
            const res = await fetch(`${base}/powerstations/${encodeURIComponent(powerstationId)}/name`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: psName || null })
            })
            const j = await res.json().catch(() => null)
            if (!res.ok || !j?.ok) throw new Error(j?.error || `${res.status} ${res.statusText}`)
            setOk('Nome atualizado.')
        } catch (e) { setErr(String(e.message || e)) }
    }


    return { psName, setPsName, ok, err, saveName }
}