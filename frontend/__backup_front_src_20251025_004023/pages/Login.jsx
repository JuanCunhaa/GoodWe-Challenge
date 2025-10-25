import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { authApi, saveSession, loadSession } from '../services/authApi.js'
import { energyService } from '../services/energyService.js'

export default function Login(){
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(()=>{
    const { token } = loadSession();
    if (token) nav('/', { replace:true });
  },[]);

  async function onSubmit(e){
    e.preventDefault();
    setError(''); setLoading(true);
    try{
      const resp = await authApi.login(email, password);
      if (!resp?.ok) throw new Error(resp?.error || 'Falha no login');
      saveSession(resp.token, resp.user);
      // Prewarm caches (day/week/month) em background, sem bloquear navegação
      try { const { token, user } = { token: resp.token, user: resp.user }; setTimeout(()=>{ energyService.prewarm({ token, plantId: user.powerstation_id }).catch(()=>{}) }, 50) } catch {}
      nav('/', { replace:true });
    }catch(err){
      setError(String(err.message || err));
    }finally{ setLoading(false); }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-app-light dark:bg-app-dark">
      <div className="card w-full max-w-md">
        <div className="mb-4">
          <h1 className="h1">Entrar</h1>
          <p className="muted text-sm">Acesse sua conta para abrir o painel.</p>
        </div>
        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1">
            <span className="muted text-sm">Email</span>
            <input type="email" className="panel outline-none focus:ring-2 ring-brand" placeholder="email@exemplo.com" value={email} onChange={e=>setEmail(e.target.value)} required />
          </label>
          <label className="grid gap-1">
            <span className="muted text-sm">Senha</span>
            <input type="password" className="panel outline-none focus:ring-2 ring-brand" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required />
          </label>
          <button className="btn btn-primary w-full" disabled={loading} type="submit">{loading ? 'Entrando...' : 'Entrar'}</button>
          {error && <div className="text-red-500 text-sm">{error}</div>}
        </form>
        <div className="muted text-sm text-center mt-3">
          Não tem conta? <Link className="text-brand font-medium" to="/register">Criar conta</Link>
        </div>
      </div>
    </div>
  )
}
