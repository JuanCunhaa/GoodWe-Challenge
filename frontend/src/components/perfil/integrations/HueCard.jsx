import React from 'react'
import { useHue } from '../../../hooks/integrations/useHue.js'


export default function HueCard() {
    const { state, connect, sync, unlink, ensureAppKey } = useHue()


    return (
        <div className="panel">
            <div className="font-semibold mb-1">Philips Hue</div>
            <div className="muted text-xs">Status: {state.connected ? 'Conectado' : 'Desconectado'}</div>
            {state.connected && state.scopes && (
                <div className="muted text-xs">Scopes: <span className="font-mono">{state.scopes}</span></div>
            )}
            {state.count != null && <div className="muted text-xs mb-2">Dispositivos: {state.count}</div>}
            {state.error && <div className="text-red-600 text-xs mb-1">{state.error}</div>}
            <div className="flex gap-2 flex-wrap">
                <button className="btn btn-primary" onClick={connect} disabled={state.syncing}>Conectar</button>
                <button className="btn" onClick={sync} disabled={state.syncing || !state.connected}>{state.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
                <button className="btn btn-danger" onClick={unlink} disabled={!state.connected || state.syncing}>Desconectar</button>
            </div>
            {state.connected && (
                <div className="mt-2 grid gap-2">
                    <div className="muted text-xs">Para usar a Remote API é necessária uma Application Key do bridge.</div>
                    <button className="btn btn-ghost" onClick={async () => {
                        try {
                            const r = await ensureAppKey()
                            alert('App Key gerada: ' + (r?.app_key || ''))
                        } catch (e) { alert(String(e.message || e)) }
                    }} title="Aperte o botão do bridge e clique aqui em até 30s">Gerar App Key (apertar botão do bridge)</button>
                </div>
            )}
            <div className="muted text-[11px] mt-2">Cadastre seu app no portal Hue (Remote API v2) e defina HUE_CLIENT_ID/SECRET, HUE_APP_KEY no backend.</div>
        </div>
    )
}