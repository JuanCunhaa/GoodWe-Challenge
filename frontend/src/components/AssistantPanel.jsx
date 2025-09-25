import { useEffect, useRef, useState } from 'react'
import { Bot, Minus, Plus, Loader2, Mic, MicOff } from 'lucide-react'

export default function AssistantPanel(){
  const [open, setOpen] = useState(true)
  const [messages, setMessages] = useState([]) // {role:'user'|'assistant', content}
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [listening, setListening] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const recognitionRef = useRef(null)

  useEffect(()=>{
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  // Fala a resposta do assistente (TTS via backend, com fallback Web Speech)
  async function speak(text) {
    const base = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api'
    // 1) Tenta back-end TTS em chunks (resposta mais rápida para frases longas)
    try {
      const chunks = splitTextForTTS(text)
      for (let i = 0; i < chunks.length; i++){
        const r = await fetch(`${base}/tts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunks[i] })
        })
        if (!r.ok || !(r.headers.get('content-type')||'').includes('audio')) throw new Error('bad audio')
        const blob = await r.blob()
        await playBlob(blob)
      }
      return
    } catch {}

    // 2) Fallback: Web Speech API (pode variar de voz entre máquinas)
    try {
      if (!window.speechSynthesis) return
      const utter = new window.SpeechSynthesisUtterance(text)
      const voices = window.speechSynthesis.getVoices()
      utter.voice = voices.find(v => v.lang === 'pt-BR') || voices[0]
      utter.rate = 1
      window.speechSynthesis.speak(utter)
    } catch {}
  }

  function splitTextForTTS(s){
    const txt = String(s||'').trim()
    if (!txt) return []
    // Primeiro tenta quebrar por sentenças
    const parts = txt.split(/(?<=[\.!?…])\s+/g).filter(Boolean)
    // Unir pedaços muito curtos e limitar comprimento ~ 220 chars
    const chunks = []
    let cur = ''
    for (const p of parts){
      if ((cur + ' ' + p).trim().length <= 220) cur = (cur ? cur + ' ' : '') + p
      else { if (cur) chunks.push(cur); cur = p }
    }
    if (cur) chunks.push(cur)
    // Fallback se nada dividir
    if (chunks.length === 0) chunks.push(txt)
    return chunks
  }

  function playBlob(blob){
    return new Promise((resolve)=>{
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => { URL.revokeObjectURL(url); resolve() }
      audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
      audio.play().catch(()=>{ URL.revokeObjectURL(url); resolve() })
    })
  }

  // Envia mensagem; se source === 'voice', responder também em áudio
  async function send(text, { source } = {}){
    const content = text?.trim() || input.trim()
    if (!content) return
    setError('')
    const newMsgs = [...messages, { role:'user', content }]
    setMessages(newMsgs); setInput(''); setLoading(true)
    try{
      const token = localStorage.getItem('token')
      const r = await fetch((import.meta.env.VITE_API_BASE || 'http://localhost:3000/api') + '/assistant/chat', {
        method:'POST', headers: { 'Content-Type':'application/json', ...(token? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ input: content, messages: newMsgs })
      })
      if (!r.ok){ const t = await r.json().catch(()=>null); throw new Error(t?.error || `HTTP ${r.status}`) }
      const j = await r.json()
      const answer = String(j?.answer||'')
      setMessages((prev)=> [...prev, { role:'assistant', content: answer }])
      if (source === 'voice' && answer) {
        try{ await speak(answer) }catch{}
      }
    }catch(e){ setError(String(e.message || e)) }
    finally{ setLoading(false); inputRef.current?.focus() }
  }

  function onKeyDown(e){
    if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send() }
  }

  function startListening() {
    if (!('webkitSpeechRecognition' in window)) {
      alert('Seu navegador não suporta reconhecimento de voz.')
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.lang = 'pt-BR'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript
      setInput(transcript)
      setListening(false)
      inputRef.current?.focus()
      // Envia automaticamente ao terminar de falar
      setTimeout(() => send(transcript, { source: 'voice' }), 100)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setListening(true)
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setListening(false)
  }

  // Atalho de teclado: Ctrl+M para alternar escuta de voz
  useEffect(() => {
    function onKey(e){
      const isMod = e.ctrlKey || e.metaKey
      if (isMod && e.key.toLowerCase() === 'm'){
        e.preventDefault()
        if (listening) stopListening(); else startListening()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening])

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100/60 dark:border-gray-800/60">
        <div className="inline-flex items-center gap-2"><Bot className="w-4 h-4"/><span className="font-semibold">Assistente Virtual</span></div>
        <button className="btn" aria-label={open? 'Minimizar' : 'Expandir'} onClick={()=> setOpen(v=>!v)}>{open? <Minus className="w-4 h-4"/> : <Plus className="w-4 h-4"/>}</button>
      </div>
      {open && (
        <div className="p-3 grid gap-3" style={{height:'420px'}}>
          <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border border-gray-100/60 dark:border-gray-800/60 p-3 bg-white/50 dark:bg-gray-900/50 min-h-[220px] max-h-[280px]">
            {messages.length===0 ? (
              <div className="muted text-sm">Pergunte algo!</div>
            ) : (
              <div className="space-y-3">
                {messages.map((m,i)=> (
                  <div key={i} className={m.role==='user' ? 'text-right' : 'text-left'}>
                    <div className={m.role==='user' ? 'inline-block px-3 py-2 rounded-xl bg-brand/20 text-gray-900 dark:text-gray-100' : 'inline-block px-3 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'}>{m.content}</div>
                  </div>
                ))}
                {loading && <div className="inline-flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin"/> Consultando...</div>}
              </div>
            )}
          </div>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <div className="grid gap-2">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e=>setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                className="flex-1 panel outline-none focus:ring-2 ring-brand resize-none max-w-xs"
                placeholder=""
                aria-label="Escreva aqui"
              />
              <button
                type="button"
                className={`btn ${listening ? 'bg-red-600 text-white' : ''}`}
                onClick={listening ? stopListening : startListening}
                aria-label={listening ? 'Parar gravação' : 'Falar'}
                disabled={loading}
              >
                {listening ? <MicOff className="w-4 h-4"/> : <Mic className="w-4 h-4"/>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
