import { useEffect, useState } from 'react'
import { loadSession } from '../../services/authApi.js'
import { metaApi } from '../../services/metaApi.js'

export default function RoomsCard(){
  const [rooms, setRooms] = useState([])
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(()=>{ (async()=>{
    try{ const { token } = loadSession(); const j = await metaApi.listRooms(token); setRooms(j.items||[]) }catch(e){ setErr(String(e?.message||e)) } finally{ setLoading(false) }
  })() },[])

  async function add(){
    try{ setErr(''); const { token } = loadSession(); const j = await metaApi.createRoom(token, name); setRooms(r=> [...r, j.item]); setName('') }catch(e){ setErr(String(e?.message||e)) }
  }
  async function del(id){
    try{ setErr(''); const { token } = loadSession(); await metaApi.deleteRoom(token, id); setRooms(r=> r.filter(x=> x.id!==id)) }catch(e){ setErr(String(e?.message||e)) }
  }

  return (
    <div className="card">
      <div className="h2 mb-2">Cômodos (App)</div>
      {err && <div className="text-red-600 text-sm mb-2">{err}</div>}
      <div className="flex items-center gap-2 mb-3">
        <input className="panel w-full" placeholder="Novo cômodo..." value={name} onChange={e=>setName(e.target.value)} />
        <button className="btn btn-primary" onClick={add} disabled={!name.trim()}>Adicionar</button>
      </div>
      <div className="grid gap-2">
        {loading ? (<div className="panel">Carregando...</div>) : (
          rooms.length ? rooms.map(r => (
            <div key={r.id} className="panel flex items-center justify-between">
              <div>{r.name}</div>
              <button className="btn btn-danger" onClick={()=>del(r.id)}>Remover</button>
            </div>
          )) : <div className="muted text-sm">Nenhum cômodo cadastrado.</div>
        )}
      </div>
    </div>
  )
}

