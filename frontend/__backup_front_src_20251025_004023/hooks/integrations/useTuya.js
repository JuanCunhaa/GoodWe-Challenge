import { useEffect, useRef, useState } from 'react'
import { loadSession } from '../../services/authApi.js'
import { integrationsApi } from '../../services/integrationsApi.js'


export function useTuya() {
    const [state, setState] = useState({ connected: false, uid: '', syncing: false, error: '', count: null })
    const uidRef = useRef('')


    useEffect(() => { refresh() }, [])


    async function refresh() {
        try {
            const { token } = loadSession(); if (!token) return
            const s = await integrationsApi.tuyaStatus(token)
            setState(p => ({ ...p, connected: !!s?.connected, uid: String(s?.uid || ''), error: '' }))
        } catch (e) { setState(p => ({ ...p, connected: false, error: String(e.message || e) })) }
    }


    async function link() {
        try {
            const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
            const uid = (uidRef.current?.value || '').trim()
            if (!uid) throw new Error('Informe o UID da sua conta Tuya/Smart Life vinculada ao projeto no Tuya IoT Console')
            await integrationsApi.tuyaLink(token, uid)
            await refresh()
        } catch (e) { alert(String(e.message || e)) }
    }


    async function sync() {
        setState(p => ({ ...p, syncing: true, error: '' }))
        try {
            const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
            const j = await integrationsApi.tuyaDevices(token)
            setState(p => ({ ...p, count: Number(j?.total || 0) }))
        } catch (e) { setState(p => ({ ...p, error: String(e.message || e) })) }
        finally { setState(p => ({ ...p, syncing: false })) }
    }


    async function unlink() {
        setState(p => ({ ...p, syncing: true, error: '' }))
        try {
            const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
            await integrationsApi.tuyaUnlink(token)
            setState({ connected: false, uid: '', syncing: false, error: '', count: null })
        } catch (e) { setState(p => ({ ...p, syncing: false, error: String(e.message || e) })) }
    }


    return { state, uidRef, link, sync, unlink }
}