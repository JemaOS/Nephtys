// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Page « Lier un appareil » — accessible depuis l'accueil, façon WhatsApp.
 *
 * Sur un nouvel appareil : on colle (ou scanne) le lien généré sur le premier
 * appareil (Paramètres → Appareils). Cela importe les clés E2EE pour lire les
 * messages chiffrés sur ce nouvel appareil.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Link2, Smartphone, Check } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { redeemDeviceLink } from '@/lib/deviceLink'

export function LinkDevicePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleRedeem = useCallback(async () => {
    if (!user || !link.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const { installed } = await redeemDeviceLink(user.id, link.trim())
      setDone(true)
      setMsg(`Appareil lié (${installed.join(', ') || 'aucune clé'}). Recharge l'application.`)
      setLink('')
    } catch (e) {
      setMsg(`Échec : ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [user, link])

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-bg-surface p-6 space-y-4">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/auth')} className="p-2 rounded-lg hover:bg-bg-hover" aria-label="Retour">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Smartphone size={20} className="text-[#7578db]" />
            <h1 className="text-lg font-semibold text-text-primary">Lier un appareil</h1>
          </div>
        </div>

        <p className="text-xs text-text-secondary">
          Sur ton <b>premier appareil</b> (déjà connecté) : ouvre <b>Paramètres → Appareils</b>,
          génère le QR code, puis scanne-le ici ou colle le lien ci-dessous.
          Le secret circule hors-bande — le serveur ne voit jamais tes clés.
        </p>

        {!user ? (
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300">
            Connecte-toi d'abord (avec tes identifiants), puis reviens ici pour coller le lien.
            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="mt-2 block w-full px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium"
            >
              Se connecter
            </button>
          </div>
        ) : done ? (
          <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-3 text-xs text-green-300 flex items-center gap-2">
            <Check size={16} /> {msg}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-text-primary font-medium">
              <Link2 size={16} /> Lien de liaison
            </div>
            <textarea
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="Colle ici le lien d'appareil (nept-device://…)"
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-bg-primary text-xs text-text-primary font-mono resize-none"
            />
            <button
              type="button"
              onClick={handleRedeem}
              disabled={busy || !link.trim()}
              className="w-full px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50"
            >
              Lier cet appareil
            </button>
            {msg && <p className="text-xs text-red-400">{msg}</p>}
          </div>
        )}
      </div>
    </div>
  )
}