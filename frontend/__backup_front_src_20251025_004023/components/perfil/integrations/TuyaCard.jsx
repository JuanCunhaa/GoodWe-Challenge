import React from 'react'
import { useTuya } from '../../../hooks/integrations/useTuya.js'


export default function TuyaCard() {
    const { state, uidRef, link, sync, unlink } = useTuya()


    return (
        <div className="panel">
            <div className="font-semibold mb-1">TUYA</div>
            <div className="muted text-xs mb-1">Status: {state.connected ? `Vinculado` : 'Desvinculado'}</div>
            {state.error && <div className="text-red-600 text-xs mb-1">{state.error}</div>}
            {!state.connected && (
                <div className="grid sm:flex items-end gap-2 mb-2">
                    <label className="grid gap-1 min-w-64">
                        <span className="muted text-xs">UID do usuário (Tuya/Smart Life)</span>
                        <input ref={uidRef} className="panel outline-none focus:ring-2 ring-brand" placeholder="ex.: eu1623*********" />
                    </label>
                    <button className="btn btn-primary" onClick={link}>Vincular</button>
                </div>
            )}
            <div className="flex gap-2 flex-wrap">
                <button className="btn" onClick={sync} disabled={state.syncing || !state.connected}>{state.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
                <button className="btn btn-danger" onClick={unlink} disabled={!state.connected || state.syncing}>Desvincular</button>
            </div>
            {state.count != null && <div className="muted text-xs mt-2">Dispositivos: {state.count}</div>}
        </div>
    )
}