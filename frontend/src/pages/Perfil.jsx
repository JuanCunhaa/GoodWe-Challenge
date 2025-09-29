import React from 'react'
import { useNavigate } from 'react-router-dom'
import { loadSession } from '../services/authApi.js'
import AccountCard from '../components/perfil/AccountCard.jsx'
import PasswordCard from '../components/perfil/PasswordCard.jsx'
import PlantCard from '../components/perfil/PlantCard.jsx'
import ConnectionsCard from '../components/perfil/ConnectionsCard.jsx'
import SmartThingsCard from '../components/perfil/integrations/SmartThingsCard.jsx'
import HueCard from '../components/perfil/integrations/HueCard.jsx'
import TuyaCard from '../components/perfil/integrations/TuyaCard.jsx'
import { useSession } from '../hooks/useSession.js'


export default function Perfil() {
  const navigate = useNavigate()
  const { email, powerstationId, loading } = useSession()


  function copyToken() { const { token } = loadSession(); if (!token) return; try { navigator.clipboard.writeText(token) } catch { } }
  function logout() { try { localStorage.removeItem('token'); localStorage.removeItem('user') } catch { }; navigate('/login', { replace: true }) }


  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <AccountCard loadingEmail={loading} email={email} powerstationId={powerstationId} onCopyToken={copyToken} onLogout={logout} />
      <PasswordCard />
      <PlantCard powerstationId={powerstationId} />
      <ConnectionsCard />


      <div className="card">
        <div className="h2 mb-2">Integrações de automação</div>
        <div className="grid gap-3">
          <SmartThingsCard />
          {/* <HueCard /> */}
          <TuyaCard />
        </div>
      </div>
    </section>
  )
}