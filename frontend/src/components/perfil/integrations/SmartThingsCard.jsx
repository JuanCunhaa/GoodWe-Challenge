import React from 'react'
import { useSmartThings } from '../../../hooks/integrations/useSmartThings.js'


export default function SmartThingsCard() {
    const { state, connect, sync, unlink } = useSmartThings()
    return (
        <div className="panel">
            <div className="font-semibold mb-1">SmartThings</div>
            <div className="muted text-xs">Status: {state.connected ? 'Conectado' : 'Desconectado'}</div>
            {state.connected && (
                <div className="muted text-xs">Permissões: {state.canControl ? 'Comandos habilitados' : 'Somente leitura'}{state.scopes ? ` (scopes: ${state.scopes})` : ''}</div>
            )}
            {state.lastSync && <div className="muted text-xs mb-1">Último sync: {new Date(state.lastSync).toLocaleString()}</div>}
            {state.count != null && <div className="muted text-xs mb-2">Dispositivos: {state.count}</div>}
            {state.error && <div className="text-red-600 text-xs mb-1">{state.error}</div>}
            <div className="flex gap-2 flex-wrap">
                <button className="btn btn-primary" onClick={connect} disabled={state.syncing}>Conectar</button>
                <button className="btn" onClick={sync} disabled={state.syncing || !state.connected}>{state.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
                <button className="btn btn-danger" onClick={unlink} disabled={!state.connected || state.syncing}>Desconectar</button>
                {!state.canControl && state.connected && (
                    <button className="btn" onClick={connect} disabled={state.syncing} title="Necessário escopo de comandos (devices:commands ou x:devices:*)">Re‑conectar com comandos</button>
                )}
            </div>
            {state.connected && state.scopes && (
                <div className="muted text-xs mt-2">Scopes: <span className="font-mono">{state.scopes}</span></div>
            )}
        </div>
    )
}