import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, loadSession } from '../services/authApi.js'
import { integrationsApi } from '../services/integrationsApi.js'
import React from 'react'

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

  // Checa status SmartThings ao carregar a página
  useEffect(()=>{ refreshStStatus() }, [])

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
    if (pw.n1 !== pw.n2){ setPwErr('As senhas nÃ£o coincidem.'); return }
    const { token } = loadSession()
    if (!token){ setPwErr('SessÃ£o expirada. Entre novamente.'); return }
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
      const scopesStr = String(s?.scopes||'');
      const canControl = scopesStr.includes('devices:commands') || scopesStr.includes('x:devices:*');
      setSt(prev => ({ ...prev, connected: !!s?.connected, scopes: scopesStr, canControl, error:'' }))
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
      const { token } = loadSession(); if (!token) throw new Error('SessÃ£o expirada')
      const j = await integrationsApi.stDevices(token)
      const ts = Date.now(); localStorage.setItem('st_last_sync', String(ts))
      setSt(prev=> ({ ...prev, count: Number(j?.total||0), lastSync: ts }))
    }catch(e){ setSt(prev=> ({ ...prev, error:String(e.message||e) })) }
    finally{ setSt(prev=> ({ ...prev, syncing:false })) }
  }
  async function stUnlink(){
    setSt(prev=> ({ ...prev, syncing:true, error:'' }))
    try{
      const { token } = loadSession(); if (!token) throw new Error('SessÃ£o expirada')
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
        <div className="h2 mb-2">ConexÃµes</div>
        <div className="grid gap-2">
          <button className="btn btn-ghost w-fit" onClick={checkConnections}>Testar conexÃµes</button>
          <div className="text-sm">API: {apiHealth==null ? '-' : (apiHealth ? 'OK' : 'Falha')}</div>
          <div className="text-sm">Assistant: {assistantPing?.ok ? 'OK' : (assistantPing==null ? '-' : 'Falha')}</div>
          {assistantPing?.ok && (
            <div className="muted text-xs">GoodWe auth: {assistantPing.hasAuth ? 'OK' : 'Sem autenticaÃ§Ã£o'} {assistantPing.api_base ? `â€¢ ${assistantPing.api_base}` : ''}</div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="h2 mb-2">Integrações de automação</div>
        <div className="grid gap-3">
          <div className="panel">
            <div className="font-semibold mb-1">SmartThings</div>
            <div className="muted text-xs">Status: {st.connected ? 'Conectado' : 'Desconectado'}</div>
            {st.connected && (
              <div className="muted text-xs">Permissões: {st.canControl ? 'Comandos habilitados' : 'Somente leitura'}{st.scopes? ` (scopes: ${st.scopes})` : ''}</div>
            )}
            {st.lastSync && <div className="muted text-xs mb-1">Ãšltimo sync: {new Date(st.lastSync).toLocaleString()}</div>}
            {st.count!=null && <div className="muted text-xs mb-2">Dispositivos: {st.count}</div>}
            {st.error && <div className="text-red-600 text-xs mb-1">{st.error}</div>}
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-primary" onClick={stConnect} disabled={st.syncing}>Conectar</button>
              <button className="btn" onClick={stSync} disabled={st.syncing || !st.connected}>{st.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
              <button className="btn btn-danger" onClick={stUnlink} disabled={!st.connected || st.syncing}>Desconectar</button>
              {!st.canControl && st.connected && (
                <button className="btn" onClick={stConnect} disabled={st.syncing} title="Necessário escopo de comandos (devices:commands ou x:devices:*)">Re‑conectar com comandos</button>
              )}
            </div>
            {st.connected && st.scopes && (
              <div className="muted text-xs mt-2">Scopes: <span className="font-mono">{st.scopes}</span></div>
            )}
            <div className="muted text-[11px] mt-1">Scopes necessários para controle: <span className="font-mono">devices:commands</span> ou <span className="font-mono">x:devices:*</span>.</div>
          </div>
          <HueCard />
          <TuyaCard />
        </div>
      </div>
    </section>
  )
}

function HueCard(){
  const [state, setState] = React.useState({ connected:false, syncing:false, error:'', count:null, scopes:'' })

  React.useEffect(()=>{ refresh() }, [])

  async function refresh(){
    try{
      const { token } = loadSession(); if (!token) return
      const s = await integrationsApi.hueStatus(token)
      setState(prev=> ({ ...prev, connected: !!s?.connected, scopes: String(s?.scopes||''), error:'' }))
    }catch(e){ setState(prev=> ({ ...prev, connected:false, error:String(e.message||e) })) }
  }
  async function connect(){
    const base = import.meta.env.VITE_API_BASE || '/api'
    const { token } = loadSession();
    const url = token ? `${base}/auth/hue?token=${encodeURIComponent(token)}` : `${base}/auth/hue`;
    window.open(url, '_blank', 'noopener')
  }
  async function sync(){
    setState(prev=> ({ ...prev, syncing:true, error:'' }))
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const j = await integrationsApi.hueDevices(token)
      setState(prev=> ({ ...prev, count: Number(j?.total||0) }))
    }catch(e){ setState(prev=> ({ ...prev, error:String(e.message||e) })) }
    finally{ setState(prev=> ({ ...prev, syncing:false })) }
  }
  async function unlink(){
    setState(prev=> ({ ...prev, syncing:true, error:'' }))
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      await integrationsApi.hueUnlink(token)
      setState({ connected:false, syncing:false, error:'', count:null, scopes:'' })
    }catch(e){ setState(prev=> ({ ...prev, syncing:false, error:String(e.message||e) })) }
  }

  React.useEffect(()=>{
    function onMsg(e){ try{ if (String(e.data)==='hue:linked'){ refresh() } }catch{} }
    window.addEventListener('message', onMsg)
    return ()=> window.removeEventListener('message', onMsg)
  },[])

  return (
    <div className="panel">
      <div className="font-semibold mb-1">Philips Hue</div>
      <div className="muted text-xs">Status: {state.connected ? 'Conectado' : 'Desconectado'}</div>
      {state.connected && state.scopes && (
        <div className="muted text-xs">Scopes: <span className="font-mono">{state.scopes}</span></div>
      )}
      {state.count!=null && <div className="muted text-xs mb-2">Dispositivos: {state.count}</div>}
      {state.error && <div className="text-red-600 text-xs mb-1">{state.error}</div>}
      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-primary" onClick={connect} disabled={state.syncing}>Conectar</button>
        <button className="btn" onClick={sync} disabled={state.syncing || !state.connected}>{state.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
        <button className="btn btn-danger" onClick={unlink} disabled={!state.connected || state.syncing}>Desconectar</button>
      </div>
      {state.connected && (
        <div className="mt-2 grid gap-2">
          <div className="muted text-xs">Para usar a Remote API é necessária uma Application Key do bridge.</div>
          <button className="btn btn-ghost" onClick={async()=>{
            try {
              const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
              const r = await integrationsApi.hueEnsureAppKey(token)
              alert('App Key gerada: ' + (r?.app_key || ''))
            } catch(e){ alert(String(e.message||e)) }
          }} title="Aperte o botão do bridge e clique aqui em até 30s">Gerar App Key (apertar botão do bridge)</button>
        </div>
      )}
      <div className="muted text-[11px] mt-2">Cadastre seu app no portal Hue (Remote API v2) e defina HUE_CLIENT_ID/SECRET, HUE_APP_KEY no backend.</div>
    </div>
  )
}

function TuyaCard(){
  const [state, setState] = React.useState({ connected:false, uid:'', syncing:false, error:'', count:null })
  const uidRef = React.useRef('')

  React.useEffect(()=>{ refresh() }, [])

  async function refresh(){
    try{
      const { token } = loadSession(); if (!token) return
      const s = await integrationsApi.tuyaStatus(token)
      setState(prev=> ({ ...prev, connected: !!s?.connected, uid: String(s?.uid||''), error:'' }))
    }catch(e){ setState(prev=> ({ ...prev, connected:false, error:String(e.message||e) })) }
  }
  async function link(){
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const uid = (uidRef.current?.value || '').trim();
      if (!uid) throw new Error('Informe o UID da sua conta Tuya/Smart Life vinculada ao projeto no Tuya IoT Console')
      await integrationsApi.tuyaLink(token, uid)
      await refresh()
    }catch(e){ alert(String(e.message||e)) }
  }
  async function sync(){
    setState(prev=> ({ ...prev, syncing:true, error:'' }))
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      const j = await integrationsApi.tuyaDevices(token)
      setState(prev=> ({ ...prev, count: Number(j?.total||0) }))
    }catch(e){ setState(prev=> ({ ...prev, error:String(e.message||e) })) }
    finally{ setState(prev=> ({ ...prev, syncing:false })) }
  }
  async function unlink(){
    setState(prev=> ({ ...prev, syncing:true, error:'' }))
    try{
      const { token } = loadSession(); if (!token) throw new Error('Sessão expirada')
      await integrationsApi.tuyaUnlink(token)
      setState({ connected:false, uid:'', syncing:false, error:'', count:null })
    }catch(e){ setState(prev=> ({ ...prev, syncing:false, error:String(e.message||e) })) }
  }

  return (
    <div className="panel">
      <div className="font-semibold mb-1">Tuya (dev/test)</div>
      <div className="muted text-xs mb-1">Status: {state.connected ? `Vinculado (uid: ${state.uid})` : 'Desvinculado'}</div>
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
      {state.count!=null && <div className="muted text-xs mt-2">Dispositivos: {state.count}</div>}
      <div className="muted text-[11px] mt-2">Observação: a Tuya Cloud não tem OAuth público. Para testes, use o projeto no Tuya IoT Console com uma conta Smart Life vinculada e informe o UID dessa conta aqui.</div>
    </div>
  )
}
import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi, loadSession } from '../services/authApi.js'
import { integrationsApi } from '../services/integrationsApi.js'

export default function Perfil(){
  const navigate = useNavigate()

  // Minha conta
  const [email, setEmail] = useState('')
  const [powerstationId, setPowerstationId] = useState('')
  const [loadingEmail, setLoadingEmail] = useState(true)

  // Troca de senha
  const [pw, setPw] = useState({ old:'', n1:'', n2:'' })
  const [pwErr, setPwErr] = useState('')
  const [pwOk, setPwOk] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  // Nome local da planta
  const [psName, setPsName] = useState('')
  const [psOk, setPsOk] = useState('')
  const [psErr, setPsErr] = useState('')

  // Conexões
  const [apiHealth, setApiHealth] = useState(null)
  const [assistantPing, setAssistantPing] = useState(null)

  // SmartThings (apenas status/botões)
  const [st, setSt] = useState({ connected:false, syncing:false })

  useEffect(()=>{
    const { token, user } = loadSession()
    if (user?.email) setEmail(user.email)
    if (user?.powerstation_id) setPowerstationId(user.powerstation_id)
    if (!token){ setLoadingEmail(false); return }
    ;(async()=>{
      try{
        const r = await authApi.me(token)
        if (r?.ok){
          setEmail(r.user?.email||'')
          setPowerstationId(r.user?.powerstation_id||'')
        }
      } finally { setLoadingEmail(false) }
    })()
  },[])

  useEffect(()=>{ refreshStStatus() }, [])

  // Carregar nome local da planta
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
    if (pw.n1.length < 6){ setPwErr('A nova senha deve ter pelo menos 6 caracteres.'); return }
    if (pw.n1 !== pw.n2){ setPwErr('As senhas não coincidem.'); return }
    const { token } = loadSession(); if (!token){ setPwErr('Sessão expirada. Entre novamente.'); return }
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
      const { token } = loadSession(); if (!token) return
      const s = await integrationsApi.stStatus(token)
      setSt(prev => ({ ...prev, connected: !!s?.connected }))
    }catch{}
  }
  async function stConnect(){
    const base = import.meta.env.VITE_API_BASE || '/api'
    const { token } = loadSession()
    const url = token ? `${base}/auth/smartthings?token=${encodeURIComponent(token)}` : `${base}/auth/smartthings`
    window.open(url, '_blank', 'noopener')
  }
  async function stSync(){ setSt(p=>({ ...p, syncing:true })); try{ const { token }=loadSession(); if (!token) return; await integrationsApi.stDevices(token) } finally { setSt(p=>({ ...p, syncing:false })) } }
  async function stUnlink(){ const { token }=loadSession(); if (!token) return; await integrationsApi.stUnlink(token); setSt({ connected:false, syncing:false }) }

  async function savePsName(){
    setPsErr(''); setPsOk('')
    try{
      const base = import.meta.env.VITE_API_BASE || '/api'
      const res = await fetch(`${base}/powerstations/${encodeURIComponent(powerstationId)}/name`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ name: psName||null }) })
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

  function copyToken(){ const { token } = loadSession(); if (!token) return; try{ navigator.clipboard.writeText(token) }catch{} }
  function logout(){ try{ localStorage.removeItem('token'); localStorage.removeItem('user') }catch{}; navigate('/login', { replace:true }) }

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
        <div className="h2 mb-2">Trocar Senha</div>
        <form onSubmit={onChangePassword} className="grid gap-3">
          <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="Senha atual" value={pw.old} onChange={e=>setPw(p=>({...p,old:e.target.value}))} required />
          <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="Nova senha" value={pw.n1} onChange={e=>setPw(p=>({...p,n1:e.target.value}))} required />
          <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="Repetir nova senha" value={pw.n2} onChange={e=>setPw(p=>({...p,n2:e.target.value}))} required />
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
          <input className="panel outline-none focus:ring-2 ring-brand mt-2" value={psName} onChange={e=>{ setPsName(e.target.value); setPsOk(''); setPsErr('') }} placeholder="Nome comercial (local)" />
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
          <div className="text-sm">Assistente: {assistantPing?.ok ? 'OK' : (assistantPing==null ? '-' : 'Falha')}</div>
        </div>
      </div>

      <div className="card">
        <div className="h2 mb-2">Integrações de automação</div>
        <div className="grid gap-3">
          <SmartThingsCard st={st} stConnect={stConnect} stSync={stSync} stUnlink={stUnlink} />
          <HueCard />
          <TuyaCard />
        </div>
      </div>
    </section>
  )
}

function SmartThingsCard({ st, stConnect, stSync, stUnlink }){
  return (
    <div className="panel">
      <div className="font-semibold mb-1">SmartThings</div>
      <div className="muted text-xs">Status: {st.connected ? 'Conectado' : 'Desconectado'}</div>
      <div className="flex gap-2 flex-wrap mt-2">
        <button className="btn btn-primary" onClick={stConnect} disabled={st.syncing}>Conectar</button>
        <button className="btn" onClick={stSync} disabled={st.syncing || !st.connected}>{st.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
        <button className="btn btn-danger" onClick={stUnlink} disabled={!st.connected || st.syncing}>Desconectar</button>
      </div>
    </div>
  )
}

function HueCard(){
  const [state, setState] = useState({ connected:false, syncing:false })
  useEffect(()=>{ (async()=>{ try{ const { token }=loadSession(); if(!token) return; const s=await integrationsApi.hueStatus(token); setState(p=>({...p, connected:!!s?.connected})) }catch{} })() }, [])
  async function connect(){ const base=import.meta.env.VITE_API_BASE||'/api'; const { token }=loadSession(); const url = token?`${base}/auth/hue?token=${encodeURIComponent(token)}`:`${base}/auth/hue`; window.open(url,'_blank','noopener') }
  async function sync(){ setState(p=>({...p, syncing:true})); try{ const { token }=loadSession(); if(!token) return; await integrationsApi.hueDevices(token) } finally{ setState(p=>({...p, syncing:false})) } }
  async function unlink(){ const { token }=loadSession(); if(!token) return; await integrationsApi.hueUnlink(token); setState({ connected:false, syncing:false }) }
  return (
    <div className="panel">
      <div className="font-semibold mb-1">Philips Hue</div>
      <div className="muted text-xs">Status: {state.connected ? 'Conectado' : 'Desconectado'}</div>
      <div className="flex gap-2 flex-wrap mt-2">
        <button className="btn btn-primary" onClick={connect} disabled={state.syncing}>Conectar</button>
        <button className="btn" onClick={sync} disabled={state.syncing || !state.connected}>{state.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
        <button className="btn btn-danger" onClick={unlink} disabled={!state.connected || state.syncing}>Desconectar</button>
      </div>
    </div>
  )
}

function TuyaCard(){
  const [state, setState] = useState({ connected:false, uid:'', syncing:false })
  const uidRef = useRef('')
  useEffect(()=>{ (async()=>{ try{ const { token }=loadSession(); if(!token) return; const s = await integrationsApi.tuyaStatus(token); setState(p=>({...p, connected:!!s?.connected, uid:String(s?.uid||'')})) }catch{} })() }, [])
  async function link(){ try{ const { token }=loadSession(); if(!token) throw new Error('Sessão expirada'); const uid=(uidRef.current?.value||'').trim(); if(!uid) throw new Error('Informe o UID'); await integrationsApi.tuyaLink(token, uid); const s=await integrationsApi.tuyaStatus(token); setState({ connected:!!s?.connected, uid:String(s?.uid||''), syncing:false }) }catch(e){ alert(String(e.message||e)) } }
  async function sync(){ setState(p=>({...p, syncing:true})); try{ const { token }=loadSession(); if(!token) return; await integrationsApi.tuyaDevices(token) } finally{ setState(p=>({...p, syncing:false})) } }
  async function unlink(){ const { token }=loadSession(); if(!token) return; await integrationsApi.tuyaUnlink(token); setState({ connected:false, uid:'', syncing:false }) }
  return (
    <div className="panel">
      <div className="font-semibold mb-1">Tuya (dev/test)</div>
      <div className="muted text-xs">Status: {state.connected ? 'Conectado' : 'Desconectado'}</div>
      {!state.connected && (
        <div className="grid sm:flex items-end gap-2 mt-2">
          <input ref={uidRef} className="panel outline-none focus:ring-2 ring-brand min-w-64" placeholder="UID (Smart Life)" />
          <button className="btn btn-primary" onClick={link}>Vincular</button>
        </div>
      )}
      <div className="flex gap-2 flex-wrap mt-2">
        <button className="btn" onClick={sync} disabled={state.syncing || !state.connected}>{state.syncing ? 'Sincronizando...' : 'Sincronizar'}</button>
        <button className="btn btn-danger" onClick={unlink} disabled={!state.connected || state.syncing}>Desvincular</button>
      </div>
    </div>
  )
}
