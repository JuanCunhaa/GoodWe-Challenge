import React from 'react'
import { useConnectionsHealth } from '../../hooks/useConnectionsHealth.js'


export default function ConnectionsCard() {
    const { apiHealth, assistantPing, check } = useConnectionsHealth()


    return (
        <div className="card">
            <div className="h2 mb-2">Conexões</div>
            <div className="grid gap-2">
                <button className="btn btn-ghost w-fit" onClick={check}>Testar conexões</button>
                <div className="text-sm">API: {apiHealth == null ? '-' : (apiHealth ? 'OK' : 'Falha')}</div>
                <div className="text-sm">Assistente: {assistantPing?.ok ? 'OK' : (assistantPing == null ? '-' : 'Falha')}</div>
                {assistantPing?.ok && (
                    <div className="muted text-xs">GoodWe auth: {assistantPing.hasAuth ? 'OK' : 'Sem autenticação'} {assistantPing.api_base ? `• ${assistantPing.api_base}` : ''}</div>
                )}
            </div>
        </div>
    )
}