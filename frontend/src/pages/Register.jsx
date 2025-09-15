import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi, saveSession, loadSession } from '../services/authApi.js'

export default function Register(){
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [powerstationId, setPowerstationId] = useState('');
  const [powerstations, setPowerstations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(()=>{
    const { token } = loadSession();
    if (token) nav('/', { replace:true });
    (async()=>{
      try{
        const data = await authApi.listPowerstations();
        setPowerstations(data?.items || []);
      }catch(e){ setError('Falha ao carregar PowerStations'); }
      finally{ setLoading(false); }
    })();
  },[]);

  async function onSubmit(e){
    e.preventDefault();
    setSubmitting(true); setError('');
    try{
      const resp = await authApi.register(email, password, powerstationId);
      if (!resp?.ok) throw new Error(resp?.error || 'Falha no registro');
      saveSession(resp.token, resp.user);
      nav('/', { replace:true });
    }catch(err){
      setError(String(err.message || err));
    }finally{ setSubmitting(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-app-light dark:bg-app-dark">
      <div className="card w-full max-w-xl">
        <div className="mb-4">
          <h1 className="h1">Criar conta</h1>
          <p className="muted text-sm">Vincule seu login a um PowerStationId.</p>
        </div>
        {loading ? (
          <div className="muted">Carregando opções...</div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-3">
            <label className="grid gap-1">
              <span className="muted text-sm">Email</span>
              <input type="email" className="panel outline-none focus:ring-2 ring-brand" placeholder="email@exemplo.com" value={email} onChange={e=>setEmail(e.target.value)} required />
            </label>
            <label className="grid gap-1">
              <span className="muted text-sm">Senha</span>
              <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required />
            </label>
            <label className="grid gap-1">
              <span className="muted text-sm">PowerStationId</span>
              <select className="panel outline-none focus:ring-2 ring-brand" value={powerstationId} onChange={e=>setPowerstationId(e.target.value)} required>
                <option value="">Selecione...</option>
                {powerstations.map(ps => (
                  <option key={ps.id} value={ps.id}>{ps.business_name ? `${ps.business_name} — ` : ''}{ps.id}</option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary w-full" disabled={submitting} type="submit">{submitting ? 'Registrando...' : 'Registrar'}</button>
            {error && <div className="text-red-500 text-sm">{error}</div>}
          </form>
        )}
        <div className="muted text-sm text-center mt-3">
          Já tem conta? <Link className="text-brand font-medium" to="/login">Entrar</Link>
        </div>
      </div>
    </div>
  )
}

