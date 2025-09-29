import React from 'react'
import { usePowerstationName } from '../../hooks/usePowerstationName.js'


export default function PlantCard({ powerstationId }) {
    const { psName, setPsName, ok, err, saveName } = usePowerstationName(powerstationId)


    return (
        <div className="card">
            <div className="h2 mb-2">Planta</div>
            <div className="grid gap-2">
                <div className="muted text-xs">ID</div>
                <div className="font-mono text-sm">{powerstationId || '-'}</div>
                <input className="panel outline-none focus:ring-2 ring-brand mt-2" value={psName} onChange={e => { setPsName(e.target.value) }} placeholder="Nome comercial (local)" />
                <div className="flex items-center gap-2">
                    <button className="btn" onClick={saveName} disabled={!powerstationId}>Salvar</button>
                    {ok && <span className="text-green-600 text-xs">{ok}</span>}
                    {err && <span className="text-red-600 text-xs">{err}</span>}
                </div>
            </div>
        </div>
    )
}