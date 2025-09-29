import React from 'react'


export default function AccountCard({ loadingEmail, email, powerstationId, onCopyToken, onLogout }) {
    return (
        <div className="card">
            <div className="h2 mb-2">Minha Conta</div>
            <div className="grid gap-3">
                <div className="flex items-center gap-4">
                    <div className="size-16 rounded-full bg-brand/20 border border-brand/30" />
                    <div>
                        <div className="muted text-xs">E-mail</div>
                        <div className="font-semibold">{loadingEmail ? 'Carregando...' : (email || '-')}</div>
                        <div className="muted text-xs mt-1">Powerstation</div>
                        <div className="font-mono text-sm">{powerstationId || '-'}</div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-ghost" onClick={onCopyToken}>Copiar token</button>
                    <button className="btn btn-danger" onClick={onLogout}>Sair</button>
                </div>
            </div>
        </div>
    )
}