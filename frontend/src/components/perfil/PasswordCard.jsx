import React, { useState } from 'react'
import { authApi, loadSession } from '../../services/authApi.js'


export default function PasswordCard() {
    const [pw, setPw] = useState({ old: '', n1: '', n2: '' })
    const [pwErr, setPwErr] = useState('')
    const [pwOk, setPwOk] = useState('')
    const [pwLoading, setPwLoading] = useState(false)


    async function onChangePassword(e) {
        e.preventDefault()
        setPwErr(''); setPwOk('')
        if (!pw.old || !pw.n1 || !pw.n2) { setPwErr('Preencha todos os campos.'); return }
        if (pw.n1.length < 6) { setPwErr('A nova senha deve ter pelo menos 6 caracteres.'); return }
        if (pw.n1 !== pw.n2) { setPwErr('As senhas não coincidem.'); return }
        const { token } = loadSession(); if (!token) { setPwErr('Sessão expirada. Entre novamente.'); return }
        setPwLoading(true)
        try {
            const resp = await authApi.changePassword(token, pw.old, pw.n1)
            if (!resp?.ok) throw new Error(resp?.error || 'Falha ao alterar senha')
            setPwOk('Senha alterada com sucesso.')
            setPw({ old: '', n1: '', n2: '' })
        } catch (err) { setPwErr(String(err.message || err)) }
        finally { setPwLoading(false) }
    }


    return (
        <div className="card">
            <div className="h2 mb-2">Trocar Senha</div>
            <form onSubmit={onChangePassword} className="grid gap-3">
                <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="Senha atual" value={pw.old} onChange={e => setPw(p => ({ ...p, old: e.target.value }))} required />
                <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="Nova senha" value={pw.n1} onChange={e => setPw(p => ({ ...p, n1: e.target.value }))} required />
                <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="Repetir nova senha" value={pw.n2} onChange={e => setPw(p => ({ ...p, n2: e.target.value }))} required />
                {pwErr && <div className="text-red-600 text-sm">{pwErr}</div>}
                {pwOk && <div className="text-green-600 text-sm">{pwOk}</div>}
                <button className="btn btn-primary" type="submit" disabled={pwLoading}>{pwLoading ? 'Salvando...' : 'Salvar'}</button>
            </form>
        </div>
    )
}