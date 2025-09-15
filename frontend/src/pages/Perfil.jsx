import { useEffect, useState } from 'react'
import { authApi, loadSession } from '../services/authApi.js'

export default function Perfil(){
  const [email, setEmail] = useState('')
  const [loadingEmail, setLoadingEmail] = useState(true)

  const [pw, setPw] = useState({ old:'', n1:'', n2:'' })
  const [pwErr, setPwErr] = useState('')
  const [pwOk, setPwOk] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  useEffect(()=>{
    const { token, user } = loadSession()
    if (user?.email) setEmail(user.email)
    if (!token){ setLoadingEmail(false); return }
    ;(async()=>{
      try{
        const r = await authApi.me(token)
        if (r?.ok && r.user?.email) setEmail(r.user.email)
      }catch{} finally{ setLoadingEmail(false) }
    })()
  },[])

  async function onChangePassword(e){
    e.preventDefault()
    setPwErr(''); setPwOk('')
    if (!pw.old || !pw.n1 || !pw.n2){ setPwErr('Preencha todos os campos.'); return }
    if (pw.n1.length < 6){ setPwErr('A nova senha deve ter ao menos 6 caracteres.'); return }
    if (pw.n1 !== pw.n2){ setPwErr('As senhas não coincidem.'); return }
    const { token } = loadSession()
    if (!token){ setPwErr('Sessão expirada. Entre novamente.'); return }
    setPwLoading(true)
    try{
      const resp = await authApi.changePassword(token, pw.old, pw.n1)
      if (!resp?.ok) throw new Error(resp?.error || 'Falha ao alterar senha')
      setPwOk('Senha alterada com sucesso.')
      setPw({ old:'', n1:'', n2:'' })
    }catch(err){ setPwErr(String(err.message || err)) }
    finally{ setPwLoading(false) }
  }

  return (
    <section className="grid gap-6 md:grid-cols-2">
      <div className="card">
        <div className="h2 mb-2">Operador</div>
        <div className="flex items-center gap-4">
          <div className="size-16 rounded-full bg-brand/20 border border-brand/30" />
          <div>
            <div className="muted text-sm">{loadingEmail ? 'Carregando...' : (email || '-')}</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="h2 mb-2">Trocar senha</div>
        <form onSubmit={onChangePassword} className="grid gap-3">
          <label className="grid gap-1">
            <span className="muted text-sm">Senha atual</span>
            <input type="password" className="panel outline-none focus:ring-2 ring-brand" value={pw.old} onChange={e=>setPw(p=>({...p,old:e.target.value}))} required />
          </label>
          <label className="grid gap-1">
            <span className="muted text-sm">Nova senha</span>
            <input type="password" className="panel outline-none focus:ring-2 ring-brand" value={pw.n1} onChange={e=>setPw(p=>({...p,n1:e.target.value}))} required />
          </label>
          <label className="grid gap-1">
            <span className="muted text-sm">Repetir nova senha</span>
            <input type="password" className="panel outline-none focus:ring-2 ring-brand" value={pw.n2} onChange={e=>setPw(p=>({...p,n2:e.target.value}))} required />
          </label>
          {pwErr && <div className="text-red-600 text-sm">{pwErr}</div>}
          {pwOk && <div className="text-green-600 text-sm">{pwOk}</div>}
          <button className="btn btn-primary" type="submit" disabled={pwLoading}>{pwLoading ? 'Salvando...' : 'Salvar'}</button>
        </form>
      </div>
    </section>
  )
}
