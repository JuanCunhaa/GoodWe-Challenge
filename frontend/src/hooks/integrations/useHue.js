import { useEffect, useState } from 'react'
import { loadSession } from '../../services/authApi.js'
import { integrationsApi } from '../../services/integrationsApi.js'
import { openAuthPopup } from '../../utils/api.js'


export function useHue() {
    const [state, setState] = useState({ connected: false, syncing: false, error: '', count: null, scopes: '' })


    useEffect(() => { refresh() }, [])


    useEffect(() => {
        function onMsg(e) { try { if (String(e.data) === 'hue:linked') { refresh() } } catch { } }
        window.addEventListener('message', onMsg)
        return () => window.removeEventListener('message', onMsg)
    }, [])


    async function refresh() {
        try {
            const { token } = loadSession(); if (!token) return
            const s = await integrationsApi.hueStatus(token)
            setState(p => ({ ...p, connected: !!s?.connected, scopes: String(s?.scopes || ''), error: '' }))
        } catch (e) { setState(p => ({ ...p, connected: false, error: String(e.message || e) })) }
    }


    function connect() {
        const { token } = loadSession();
        const url = token ? `/auth/hue?token=${encodeURIComponent(token)}` : `/auth/hue`
        openAuthPopup(url)
    }


    async function sync() {
        setState(p => ({ ...p, syncing: true, error: '' }))
        try {
            const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
            const j = await integrationsApi.hueDevices(token)
            setState(p => ({ ...p, count: Number(j?.total || 0) }))
        } catch (e) { setState(p => ({ ...p, error: String(e.message || e) })) }
        finally { setState(p => ({ ...p, syncing: false })) }
    }


    async function unlink() {
        setState(p => ({ ...p, syncing: true, error: '' }))
        try {
            const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
            await integrationsApi.hueUnlink(token)
            setState({ connected: false, syncing: false, error: '', count: null, scopes: '' })
        } catch (e) { setState(p => ({ ...p, syncing: false, error: String(e.message || e) })) }
    }


    async function ensureAppKey() {
        const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
        return integrationsApi.hueEnsureAppKey(token)
    }


    return { state, connect, sync, unlink, ensureAppKey }
}