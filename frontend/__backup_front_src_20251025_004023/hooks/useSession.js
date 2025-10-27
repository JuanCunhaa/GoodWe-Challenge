import { useEffect, useState } from 'react'
import { authApi, loadSession } from '../services/authApi.js'


export function useSession() {
    const [email, setEmail] = useState('')
    const [powerstationId, setPowerstationId] = useState('')
    const [loading, setLoading] = useState(true)


    useEffect(() => {
        const { token, user } = loadSession()
        if (user?.email) setEmail(user.email)
        if (user?.powerstation_id) setPowerstationId(user.powerstation_id)
        if (!token) { setLoading(false); return }


        (async () => {
            try {
                const r = await authApi.me(token)
                if (r?.ok) {
                    setEmail(r.user?.email || '')
                    setPowerstationId(r.user?.powerstation_id || '')
                }
            } finally { setLoading(false) }
        })()
    }, [])


    return { email, powerstationId, setPowerstationId, loading }
}