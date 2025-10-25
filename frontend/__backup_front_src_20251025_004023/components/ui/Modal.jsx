import React from 'react'

export default function Modal({ open, onClose, title, children, footer }){
  if (!open) return null; // não renderiza nada quando fechado
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 transition-opacity opacity-100" onClick={onClose} />
      <div className="absolute inset-x-0 top-10 mx-auto w-[92%] max-w-2xl rounded-2xl bg-white shadow-2xl transition-transform translate-y-0">
        <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-md hover:bg-black/5" aria-label="Fechar">✕</button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-black/10 bg-black/[0.02] rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}
