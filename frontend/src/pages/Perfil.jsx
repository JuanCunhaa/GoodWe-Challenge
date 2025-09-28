import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, loadSession } from '../services/authApi.js'
import { integrationsApi } from '../services/integrationsApi.js'

export default function Perfil(){
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [powerstationId, setPowerstationId] = useState('')
  const [loadingEmail, setLoadingEmail] = useState(true)

  const [pw, setPw] = useState({ old:'', n1:'', n2:'' })
  const [pwErr, setPwErr] = useState('')
  const [pwOk, setPwOk] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [psName, setPsName] = useState('')
  const [psOk, setPsOk] = useState('')
  const [psErr, setPsErr] = useState('')
  const [apiHealth, setApiHealth] = useState(null)
  const [assistantPing, setAssistantPing] = useState(null)
  // SmartThings
  const [st, setSt] = useState({ connected:false, syncing:false, error:'', count:null, lastSync: (()=>{ const v=localStorage.getItem('st_last_sync'); return v? Number(v): null })() })

  useEffect(()=>{
    const { token, user } = loadSession()
    if (user?.email) setEmail(user.email)
    if (user?.powerstation_id) setPowerstationId(user.powerstation_id)
    if (!token){ setLoadingEmail(false); return }
    ;(async()=>{
      try{
        const r = await authApi.me(token)
        if (r?.ok && r.user?.email) setEmail(r.user.email)
        if (r?.ok && r.user?.powerstation_id) setPowerstationId(r.user.powerstation_id)
      }catch{} finally{ setLoadingEmail(false) }
    })()
  },[])

  useEffect(()=>{
    // Listen for account linking completion
    function onMsg(e){ try{ if (String(e.data)==='st:linked'){ refreshStStatus() } }catch{} }
    window.addEventListener('message', onMsg)
    return ()=> window.removeEventListener('message', onMsg)
  },[])

  // Load local powerstation name
  useEffect(()=>{
    (async()=>{
      try{
        const list = await authApi.listPowerstations()
        const it = (list?.items||[]).find(x=> String(x.id)===String(powerstationId))
        if (it) setPsName(String(it.business_name||''))
      }catch{}
    })()
  }, [powerstationId])

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

  async function refreshStStatus(){
    try{
      const { token } = loadSession(); if (!token) return;
      const s = await integrationsApi.stStatus(token);
      setSt(prev => ({ ...prev, connected: !!s?.connected, error:'' }))
    }catch(e){ setSt(prev=> ({ ...prev, connected:false, error:String(e.message||e) })) }
  }

  async function stConnect(){
    const base = import.meta.env.VITE_API_BASE || '/api'
    const { token } = loadSession();
    const url = token ? `${base}/auth/smartthings?token=${encodeURIComponent(token)}` : `${base}/auth/smartthings`;
    window.open(url, '_blank', 'noopener')
  }
  async function stSync(){
    setSt(prev=> ({ ...prev, syncing:true, error:'' }))
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const j = await integrationsApi.stDevices(token)
      const ts = Date.now(); localStorage.setItem('st_last_sync', String(ts))
      setSt(prev=> ({ ...prev, count: Number(j?.total||0), lastSync: ts }))
    }catch(e){ setSt(prev=> ({ ...prev, error:String(e.message||e) })) }
    finally{ setSt(prev=> ({ ...prev, syncing:false })) }
  }
  async function stUnlink(){
    setSt(prev=> ({ ...prev, syncing:true, error:'' }))
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      await integrationsApi.stUnlink(token)
      setSt({ connected:false, syncing:false, error:'', count:null, lastSync:null })
    }catch(e){ setSt(prev=> ({ ...prev, syncing:false, error:String(e.message||e) })) }
  }

  async function savePsName(){
    setPsErr(''); setPsOk('')
    try{
      const base = import.meta.env.VITE_API_BASE || '/api'
      const res = await fetch(`${base}/powerstations/${encodeURIComponent(powerstationId)}/name`, {
        method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ name: psName||null })
      })
      const j = await res.json().catch(()=>null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `${res.status} ${res.statusText}`)
      setPsOk('Nome atualizado.')
    }catch(e){ setPsErr(String(e.message||e)) }
  }

  async function checkConnections(){
    try{
      const base = import.meta.env.VITE_API_BASE || '/api'
      const r1 = await fetch(`${base}/health`).then(r=> r.ok)
      setApiHealth(!!r1)
      const r2 = await fetch(`${base}/assistant/ping`).then(r=> r.json()).catch(()=>null)
      setAssistantPing(r2||null)
    }catch{ setApiHealth(false) }
  }

  function copyToken(){
    const { token } = loadSession()
    if (!token) return
    try{ navigator.clipboard.writeText(token) }catch{}
  }

  function logout(){
    try{ localStorage.removeItem('token'); localStorage.removeItem('user') }catch{}
    navigate('/login', { replace:true })
  }

  return (
    <section className="grid gap-6 lg:grid-cols-2">
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
            <button className="btn btn-ghost" onClick={copyToken}>Copiar token</button>
            <button className="btn btn-danger" onClick={logout}>Sair</button>
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
      <div className="card">
        <div className="h2 mb-2">Planta</div>
        <div className="grid gap-2">
          <div className="muted text-xs">ID</div>
          <div className="font-mono text-sm">{powerstationId || '-'}</div>
          <label className="grid gap-1 mt-2">
            <span className="muted text-sm">Nome comercial (local)</span>
            <input className="panel outline-none focus:ring-2 ring-brand" value={psName} onChange={e=>{ setPsName(e.target.value); setPsOk(''); setPsErr('') }} placeholder="ex.: Minha Planta" />
          </label>
          <div className="flex items-center gap-2">
            <button className="btn" onClick={savePsName} disabled={!powerstationId}>Salvar</button>
            {psOk && <span className="text-green-600 text-xs">{psOk}</span>}
            {psErr && <span className="text-red-600 text-xs">{psErr}</span>}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="h2 mb-2">Conexões</div>
        <div className="grid gap-2">
          <button className="btn btn-ghost w-fit" onClick={checkConnections}>Testar conexões</button>
          <div className="text-sm">API: {apiHealth==null ? '-' : (apiHealth ? 'OK' : 'Falha')}</div>
          <div className="text-sm">Assistant: {assistantPing?.ok ? 'OK' : (assistantPing==null ? '-' : 'Falha')}</div>
          {assistantPing?.ok && (
            <div className="muted text-xs">GoodWe auth: {assistantPing.hasAuth ? 'OK' : 'Sem autenticação'} {assistantPing.api_base ? `• ${assistantPing.api_base}` : ''}</div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="h2 mb-2">Integrações de automação</div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="panel">
            <div className="font-semibold mb-1">SmartThings</div>
            <div className="muted text-sm mb-2">Status: {st.connected ? 'Conectado' : 'Desconectado'}</div>
            {st.lastSync && <div className="muted text-xs mb-1">Último sync: {new Date(st.lastSync).toLocaleString()}</div>}
            {st.count!=null && <div className="muted text-xs mb-2">Dispositivos: {st.count}</div>}
            {st.error && <div className="text-red-600 text-xs mb-1">{st.error}</div>}
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={stConnect} disabled={st.syncing}>Conectar</button>
              <button className="btn" onClick={stSync} disabled={st.syncing || !st.connected}>{st.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
              <button className="btn btn-danger" onClick={stUnlink} disabled={!st.connected || st.syncing}>Desconectar</button>
            </div>
          </div>
          <div className="panel opacity-60" title="Em breve">
            <div className="font-semibold mb-1">Philips Hue</div>
            <div className="muted text-sm mb-2">Em breve</div>
            <div className="flex gap-2"><button className="btn" disabled>Conectar</button></div>
          </div>
          <div className="panel opacity-60" title="Em breve">
            <div className="font-semibold mb-1">eWeLink</div>
            <div className="muted text-sm mb-2">Em breve</div>
            <div className="flex gap-2"><button className="btn" disabled>Conectar</button></div>
          </div>
        </div>
      </div>
    </section>
  )
}
