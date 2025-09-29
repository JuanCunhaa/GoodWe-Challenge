import { useEffect, useState } from 'react'
import { loadSession } from '../../services/authApi.js'
import { integrationsApi } from '../../services/integrationsApi.js'
import { apiBase, openAuthPopup } from '../../utils/api.js'


export function useSmartThings() {
    const [state, setState] = useState({ connected: false, syncing: false, error: '', scopes: '', canControl: false, count: null, lastSync: (() => { const v = localStorage.getItem('st_last_sync'); return v ? Number(v) : null })() })


    useEffect(() => { refresh() }, [])


    useEffect(() => {
        function onMsg(e) { try { if (String(e.data) === 'st:linked') { refresh() } } catch { } }
        window.addEventListener('message', onMsg)
        return () => window.removeEventListener('message', onMsg)
    }, [])


    async function refresh() {
        try {
            const { token } = loadSession(); if (!token) return
            const s = await integrationsApi.stStatus(token)
            const scopesStr = String(s?.scopes || '')
            const canControl = scopesStr.includes('devices:commands') || scopesStr.includes('x:devices:*')
            setState(p => ({ ...p, connected: !!s?.connected, scopes: scopesStr, canControl, error: '' }))
        } catch (e) { setState(p => ({ ...p, connected: false, error: String(e.message || e) })) }
    }


    function connect() {
        const { token } = loadSession()
        const url = token ? `/auth/smartthings?token=${encodeURIComponent(token)}` : '/auth/smartthings'
        openAuthPopup(url)
    }


    async function sync() {
        setState(p => ({ ...p, syncing: true, error: '' }))
        try {
            const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
            const j = await integrationsApi.stDevices(token)
            const ts = Date.now(); localStorage.setItem('st_last_sync', String(ts))
            setState(p => ({ ...p, count: Number(j?.total || 0), lastSync: ts }))
        } catch (e) { setState(p => ({ ...p, error: String(e.message || e) })) }
        finally { setState(p => ({ ...p, syncing: false })) }
    }


    async function unlink() {
        setState(p => ({ ...p, syncing: true, error: '' }))
        try {
            const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
            await integrationsApi.stUnlink(token)
            setState({ connected: false, syncing: false, error: '', scopes: '', canControl: false, count: null, lastSync: null })
        } catch (e) { setState(p => ({ ...p, syncing: false, error: String(e.message || e) })) }
    }


    return { state, connect, sync, unlink }
}