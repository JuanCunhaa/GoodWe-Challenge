import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Live from './pages/Live.jsx'
import Fluxo from './pages/Fluxo.jsx'
import Geracao from './pages/Geracao.jsx'
import Consumo from './pages/Consumo.jsx'
import Inversores from './pages/Inversores.jsx'
import Alertas from './pages/Alertas.jsx'
import Manutencao from './pages/Manutencao.jsx'
import Relatorios from './pages/Relatorios.jsx'
import Faturamento from './pages/Faturamento.jsx'
import Admin from './pages/Admin.jsx'
import Auditoria from './pages/Auditoria.jsx'
import Configuracoes from './pages/Configuracoes.jsx'
import Perfil from './pages/Perfil.jsx'
// Auth pages (new)
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'

export default function App(){
  function RequireAuth({ children }){
    const token = localStorage.getItem('token');
    if (!token) return <Navigate to="/login" replace />;
    return children;
  }
  return (
    <Routes>
      {/* Auth routes (no Layout) */}
      <Route path="/login" element={<Login/>} />
      <Route path="/register" element={<Register/>} />
      <Route element={<RequireAuth><Layout/></RequireAuth>}>
        <Route path="/" element={<Dashboard/>} />
        <Route path="/live" element={<Live/>} />
        <Route path="/fluxo" element={<Fluxo/>} />
        <Route path="/geracao" element={<Geracao/>} />
        <Route path="/consumo" element={<Consumo/>} />
        <Route path="/inversores" element={<Inversores/>} />
        <Route path="/alertas" element={<Alertas/>} />
        <Route path="/manutencao" element={<Manutencao/>} />
        <Route path="/relatorios" element={<Relatorios/>} />
        <Route path="/faturamento" element={<Faturamento/>} />
        <Route path="/admin" element={<Admin/>} />
        <Route path="/auditoria" element={<Auditoria/>} />
        <Route path="/configuracoes" element={<Configuracoes/>} />
        <Route path="/perfil" element={<Perfil/>} />
        <Route path="*" element={<Navigate to="/" replace/>} />
      </Route>
    </Routes>
  )
}
