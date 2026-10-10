// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Page « Connexions privées » — interface du mode privé anonyme.
 *
 * Permet de :
 *   • créer une connexion privée (identité locale, sans compte) et d'en
 *     partager le **lien / QR** hors-bande ;
 *   • rejoindre une connexion à partir d'un lien reçu ;
 *   • discuter via le **relais** (aucun graphe social côté serveur) avec
 *     chiffrement E2EE (Double Ratchet).
 *
 * 100 % additif : n'altère aucune autre page ni le modèle Supabase existant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { ArrowLeft, Copy, Link2, Lock, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { MainLayout } from '@/components/MainLayout'
import { getPrivateMessenger, getRelayUrl, setRelayUrl } from '@/lib/relay/relayClient'
import type { PrivateConnectionRecord } from '@/lib/relay/connectionStore'

interface ChatItem {
  id: string
  text: string
  mine: boolean
}

function newConnectionId(): string {
  const suffix = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replaceAll('-', '').slice(0, 12)
  return `priv-${suffix}`
}

export function PrivatePage() {
  const navigate = useNavigate()
  const messenger = useMemo(() => getPrivateMessenger(), [])
  const relayUrl = useMemo(() => getRelayUrl(), [])

  const [connections, setConnections] = useState<PrivateConnectionRecord[]>([])
  const [invite, setInvite] = useState<string | null>(null)
  const [joinLink, setJoinLink] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [relayInput, setRelayInput] = useState(relayUrl)

  const unsubscribeRef = useRef<(() => void) | null>(null)
  const rotationStopRef = useRef<(() => void) | null>(null)
  const coverStopRef = useRef<(() => void) | null>(null)

  const refresh = useCallback(async () => {
    try {
      setConnections(await messenger.listConnections())
    } catch (e) {
      console.error('[private] list failed', e)
    }
  }, [messenger])

  useEffect(() => {
    refresh()
    return () => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      rotationStopRef.current?.()
      rotationStopRef.current = null
      coverStopRef.current?.()
      coverStopRef.current = null
    }
  }, [refresh])

  const openConnection = useCallback(
    async (conversationId: string) => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      setActive(conversationId)
      setMessages([])
      setError(null)

      // Recharge l'historique local persistant avant d'écouter le direct.
      try {
        const rows = await messenger.history(conversationId)
        setMessages(rows.map(r => ({ id: r.id, text: r.text, mine: r.mine })))
      } catch {
        // historique indisponible → on démarre vide
      }

      unsubscribeRef.current = messenger.subscribe(conversationId, text => {
        setMessages(prev => [...prev, { id: `in-${Date.now()}-${prev.length}`, text, mine: false }])
      })

      // Durcissement métadonnées : rotation périodique des files
      // (anti-corrélation longue durée) + trafic de couverture (brouille le
      // timing/volume). Les précédents jobs de la connexion active sont arrêtés.
      rotationStopRef.current?.()
      coverStopRef.current?.()
      rotationStopRef.current = messenger.startQueueRotation(conversationId)
      coverStopRef.current = messenger.startCoverTraffic(conversationId)
    },
    [messenger],
  )

  const handleCreate = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const id = newConnectionId()
      const { link } = await messenger.establish(id)
      setInvite(link)
      await refresh()
      openConnection(id)
    } catch (e) {
      setError(
        `Impossible de créer la connexion. Le relais est-il démarré ? (${relayUrl}) — ${(e as Error).message}`,
      )
    } finally {
      setBusy(false)
    }
  }, [messenger, refresh, openConnection, relayUrl])

  const handleJoin = useCallback(async () => {
    if (!joinLink.trim()) return
    setBusy(true)
    setError(null)
    try {
      const id = newConnectionId()
      await messenger.accept(id, joinLink.trim())
      setJoinLink('')
      await refresh()
      openConnection(id)
    } catch (e) {
      setError(`Lien invalide ou relais injoignable — ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [messenger, refresh, openConnection, joinLink])

  const handleSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || !active) return
    setDraft('')
    try {
      await messenger.send(active, text)
      setMessages(prev => [...prev, { id: `${Date.now()}-${prev.length}`, text, mine: true }])
    } catch (e) {
      setError(`Envoi impossible — ${(e as Error).message}`)
    }
  }, [draft, active, messenger])

  const handleForget = useCallback(
    async (conversationId: string) => {
      await messenger.forget(conversationId)
      if (active === conversationId) {
        unsubscribeRef.current?.()
        unsubscribeRef.current = null
        setActive(null)
      }
      await refresh()
    },
    [messenger, active, refresh],
  )

  const handleCopy = useCallback(async () => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // presse-papiers indisponible
    }
  }, [invite])

  return (
    <MainLayout>
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bg-hover">
          <button
            type="button"
            onClick={() => navigate('/chats')}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <Lock size={20} className="text-[#7578db]" />
            <div>
              <h1 className="text-base font-semibold text-text-primary">Connexions privées</h1>
              <p className="text-xs text-text-secondary">
                Sans compte, sans métadonnées — via un relais indépendant
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          <div className="flex items-start gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-text-secondary">
            <ShieldCheck size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <p>
              Le mode privé chiffre de bout en bout (Double Ratchet) et livre via un relais qui
              ne connaît ni votre identité, ni votre correspondant. Échangez le lien ci-dessous
              de vive voix, par QR ou via un autre canal de confiance.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <span className="shrink-0">Relais :</span>
            <input
              value={relayInput}
              onChange={e => setRelayInput(e.target.value)}
              placeholder="ws://127.0.0.1:8090 ou wss://xxxx.onion"
              aria-label="URL du relais"
              className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-primary text-[11px] text-text-secondary font-mono"
            />
            <button
              type="button"
              onClick={() => {
                setRelayUrl(relayInput)
                globalThis.location.reload()
              }}
              className="px-2 py-1 rounded-lg bg-bg-hover text-[11px] text-text-primary shrink-0"
            >
              Appliquer
            </button>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Plus size={16} /> Créer une connexion privée
            </button>
          </div>

          {/* Invite (QR + lien) */}
          {invite && (
            <div className="rounded-2xl bg-bg-surface p-4 flex flex-col items-center gap-3">
              <div className="bg-white p-3 rounded-xl">
                <QRCode value={invite} size={180} />
              </div>
              <div className="w-full flex items-center gap-2">
                <input
                  readOnly
                  value={invite}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-primary text-xs text-text-secondary font-mono truncate"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-bg-hover text-xs text-text-primary"
                >
                  <Copy size={14} /> {copied ? 'Copié' : 'Copier'}
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary text-center">
                Partagez ce lien/QR avec votre contact. Il l'ouvrira pour établir la connexion.
              </p>
            </div>
          )}

          {/* Rejoindre */}
          <div className="rounded-2xl bg-bg-surface p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-text-primary font-medium">
              <Link2 size={16} /> Rejoindre une connexion
            </div>
            <textarea
              value={joinLink}
              onChange={e => setJoinLink(e.target.value)}
              placeholder="Collez ici le lien d'invitation reçu"
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-bg-primary text-xs text-text-primary font-mono resize-none"
            />
            <button
              type="button"
              onClick={handleJoin}
              disabled={busy || !joinLink.trim()}
              className="px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              Rejoindre
            </button>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Connexions */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-text-primary">Mes connexions privées</h2>
            {connections.length === 0 && (
              <p className="text-xs text-text-tertiary">Aucune connexion pour l'instant.</p>
            )}
            {connections.map(conn => (
              <div
                key={conn.conversationId}
                className="flex items-center justify-between gap-2 rounded-xl bg-bg-surface px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => openConnection(conn.conversationId)}
                  className="flex items-center gap-2 text-sm text-text-primary min-w-0"
                >
                  <Lock size={15} className="text-[#7578db] shrink-0" />
                  <span className="truncate">{conn.conversationId}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleForget(conn.conversationId)}
                  className="p-2 rounded-lg hover:bg-bg-hover text-text-tertiary"
                  aria-label="Oublier"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Chat actif */}
        {active && (
          <div className="border-t border-bg-hover bg-bg-secondary">
            <div className="px-4 py-2 text-xs text-text-secondary flex items-center gap-2">
              <Lock size={13} className="text-[#7578db]" /> {active}
            </div>
            <div className="h-56 overflow-auto px-4 py-2 space-y-2">
              {messages.length === 0 && (
                <p className="text-xs text-text-tertiary">
                  Aucun message. Les messages privés ne sont pas conservés par le relais.
                </p>
              )}
              {messages.map(item => (
                <div
                  key={item.id}
                  className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                    item.mine
                      ? 'ml-auto bg-[#7578db] text-white'
                      : 'mr-auto bg-bg-surface text-text-primary'
                  }`}
                >
                  {item.text}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-bg-hover">
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Message privé chiffré…"
                className="flex-1 px-3 py-2 rounded-xl bg-bg-primary text-sm text-text-primary"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!draft.trim()}
                className="p-2 rounded-xl bg-[#7578db] text-white disabled:opacity-50"
                aria-label="Envoyer"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  )
}
