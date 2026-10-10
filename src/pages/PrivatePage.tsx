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
import { ArrowLeft, Copy, Link2, Lock, Paperclip, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { MainLayout } from '@/components/MainLayout'
import { getPrivateMessenger, getRelayUrl, getRelayLabel, setRelayUrl } from '@/lib/relay/relayClient'
import { getGroupMessenger } from '@/lib/relay/groupClient'
import type { GroupRecord } from '@/lib/relay/groupMessenger'
import { parseFileMessage } from '@/lib/relay/privateMessenger'
import { parseStatus, encodeStatus, toRecord, type StatusPayload, type StatusRecord } from '@/lib/relay/statusStore'
import { PrivateCall, type CallState, type PeerLike } from '@/lib/relay/privateCall'
import { isCallSignal, parseCallSignal } from '@/lib/relay/callSignaling'
import { IdbStatusStore } from '@/lib/relay/statusIdbStore'
import { encryptAndUploadFile, downloadAndDecryptFile, type FileDescriptor } from '@/lib/relay/fileTransfer'
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
  const [relayInput, setRelayInput] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  // Groupes privés
  const groupMessenger = useMemo(() => getGroupMessenger(), [])
  const [groups, setGroups] = useState<GroupRecord[]>([])
  const [groupInvite, setGroupInvite] = useState<string | null>(null)
  const [groupJoinLink, setGroupJoinLink] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [groupMessages, setGroupMessages] = useState<ChatItem[]>([])
  const [groupDraft, setGroupDraft] = useState('')
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupError, setGroupError] = useState<string | null>(null)
  const groupUnsubRef = useRef<(() => void) | null>(null)

  // Abonnements « monitor » : un seul par connexion (messages + statuts).
  const activeRef = useRef<string | null>(null)
  const monitorsRef = useRef<Map<string, () => void>>(new Map())

  // Statuts privés (éphémères)
  const statusStore = useMemo(() => new IdbStatusStore(), [])
  const [statuses, setStatuses] = useState<StatusRecord[]>([])
  const [statusDraft, setStatusDraft] = useState('')

  // Appel privé (signalisation WebRTC via le canal chiffré)
  const [callState, setCallState] = useState<CallState>('idle')
  const [callConv, setCallConv] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const localMediaRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)

  const acquireMedia = useCallback(async (): Promise<MediaStream | null> => {
    if (localMediaRef.current) return localMediaRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
      localMediaRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      return stream
    } catch (e) {
      setMediaError(`Micro/caméra indisponible — ${(e as Error).message}`)
      return null
    }
  }, [])

  const privateCall = useMemo(
    () =>
      new PrivateCall({
        createPeer: () => {
          if (typeof RTCPeerConnection === 'undefined') return null
          const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
          const stream = localMediaRef.current
          if (stream) for (const track of stream.getTracks()) pc.addTrack(track, stream)
          pc.ontrack = (ev: RTCTrackEvent) => {
            const [remote] = ev.streams
            if (remote && remoteVideoRef.current) remoteVideoRef.current.srcObject = remote
          }
          return pc as unknown as PeerLike
        },
        send: (convId, text) => messenger.send(convId, text),
        onState: (convId, state) => {
          setCallConv(convId)
          setCallState(state)
        },
      }),
    [messenger],
  )

  const startCall = useCallback(async () => {
    if (!active) return
    setMediaError(null)
    await acquireMedia()
    await privateCall.start(active)
  }, [active, acquireMedia, privateCall])

  const refresh = useCallback(async () => {
    try {
      setConnections(await messenger.listConnections())
    } catch (e) {
      console.error('[private] list failed', e)
    }
  }, [messenger])

  useEffect(() => {
    refresh()
    // Ré-enregistre les connexions stockées dans le transport (après reload).
    void messenger.refreshConnections()
  }, [refresh, messenger])

  const refreshStatuses = useCallback(async () => {
    try {
      setStatuses(await statusStore.active())
    } catch (e) {
      console.error('[status] load failed', e)
    }
  }, [statusStore])

  const handleIncomingStatus = useCallback(
    async (payload: StatusPayload, conversationId: string) => {
      await statusStore.save(toRecord(payload, conversationId))
      await refreshStatuses()
    },
    [statusStore, refreshStatuses],
  )

  const publishStatus = useCallback(async () => {
    const text = statusDraft.trim()
    if (!text) return
    setStatusDraft('')
    const conns = await messenger.listConnections()
    const payload = encodeStatus(text)
    for (const c of conns) {
      try { await messenger.send(c.conversationId, payload) } catch { /* ignore */ }
    }
    const parsed = parseStatus(payload)
    if (parsed) await statusStore.save(toRecord(parsed, 'moi'))
    await refreshStatuses()
  }, [statusDraft, messenger, statusStore, refreshStatuses])

  const openConnection = useCallback(
    async (conversationId: string) => {
      activeRef.current = conversationId
      setActive(conversationId)
      setMessages([])
      setError(null)
      // Recharge l'historique local persistant.
      try {
        const rows = await messenger.history(conversationId)
        setMessages(rows.map(r => ({ id: r.id, text: r.text, mine: r.mine })))
      } catch {
        // historique indisponible → on démarre vide
      }
    },
    [messenger],
  )

  // Un SEUL abonnement par connexion (messages + statuts), pour toutes les
  // connexions (pas seulement l'active) afin de capter les statuts. La rotation
  // de files et le trafic de couverture démarrent ici, une fois par connexion.
  useEffect(() => {
    const monitors = monitorsRef.current
    const ids = new Set(connections.map(c => c.conversationId))

    for (const c of connections) {
      if (monitors.has(c.conversationId)) continue
      const convId = c.conversationId
      const unsubMsg = messenger.subscribe(convId, text => {
        if (isCallSignal(text)) {
          const sig = parseCallSignal(text)
          if (sig?.kind === 'offer' && !localMediaRef.current) {
            void (async () => {
              await acquireMedia()
              await privateCall.handleSignal(convId, text)
            })()
          } else {
            void privateCall.handleSignal(convId, text)
          }
          return
        }
        const status = parseStatus(text)
        if (status) {
          void handleIncomingStatus(status, convId)
          return
        }
        if (activeRef.current === convId) {
          setMessages(prev => [...prev, { id: `in-${Date.now()}-${prev.length}`, text, mine: false }])
        }
      })
      const stopRot = messenger.startQueueRotation(convId)
      const stopCover = messenger.startCoverTraffic(convId)
      monitors.set(convId, () => { unsubMsg(); stopRot(); stopCover() })
    }

    for (const [id, stop] of monitors) {
      if (!ids.has(id)) { stop(); monitors.delete(id) }
    }
  }, [connections, messenger, handleIncomingStatus, privateCall, acquireMedia])

  useEffect(() => {
    refreshStatuses()
  }, [refreshStatuses])

  useEffect(() => {
    return () => {
      for (const stop of monitorsRef.current.values()) stop()
      monitorsRef.current.clear()
      groupUnsubRef.current?.()
      groupUnsubRef.current = null
    }
  }, [])

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

  const handleFileSend = useCallback(
    async (file: File) => {
      if (!active) return
      setUploading(true)
      setError(null)
      try {
        const descriptor = await encryptAndUploadFile(file)
        await messenger.sendFile(active, descriptor)
        // Affiche le descripteur localement (rendu comme fichier chiffré).
        setMessages(prev => [
          ...prev,
          { id: `out-file-${Date.now()}-${prev.length}`, text: `\u0000NPT-FILE:${JSON.stringify(descriptor)}`, mine: true },
        ])
      } catch (e) {
        setError(`Envoi du fichier impossible — ${(e as Error).message}`)
      } finally {
        setUploading(false)
      }
    },
    [active, messenger],
  )

  const handleDownloadFile = useCallback(async (descriptor: FileDescriptor) => {
    try {
      const blob = await downloadAndDecryptFile(descriptor)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = descriptor.name || 'fichier'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(`Téléchargement impossible — ${(e as Error).message}`)
    }
  }, [])

  // ─── Groupes privés ─────────────────────────────────────────────────
  const refreshGroups = useCallback(async () => {
    try {
      setGroups(await groupMessenger.listGroups())
    } catch (e) {
      console.error('[group] list failed', e)
    }
  }, [groupMessenger])

  useEffect(() => { refreshGroups() }, [refreshGroups])

  const openGroup = useCallback(
    (groupId: string) => {
      groupUnsubRef.current?.()
      groupUnsubRef.current = null
      setActiveGroupId(groupId)
      setGroupMessages([])
      setGroupError(null)
      groupUnsubRef.current = groupMessenger.subscribe(groupId, text => {
        setGroupMessages(prev => [...prev, { id: `gin-${Date.now()}-${prev.length}`, text, mine: false }])
      })
    },
    [groupMessenger],
  )

  const handleCreateGroup = useCallback(async () => {
    setGroupBusy(true)
    setGroupError(null)
    try {
      const { record, invite } = await groupMessenger.create('Groupe privé')
      setGroupInvite(invite)
      await refreshGroups()
      openGroup(record.groupId)
    } catch (e) {
      setGroupError(`Création du groupe impossible — ${(e as Error).message}`)
    } finally {
      setGroupBusy(false)
    }
  }, [groupMessenger, refreshGroups, openGroup])

  const handleJoinGroup = useCallback(async () => {
    if (!groupJoinLink.trim()) return
    setGroupBusy(true)
    setGroupError(null)
    try {
      const rec = await groupMessenger.join(groupJoinLink.trim(), 'moi')
      setGroupJoinLink('')
      await refreshGroups()
      openGroup(rec.groupId)
    } catch (e) {
      setGroupError(`Impossible de rejoindre — ${(e as Error).message}`)
    } finally {
      setGroupBusy(false)
    }
  }, [groupMessenger, refreshGroups, openGroup, groupJoinLink])

  const handleSendGroup = useCallback(async () => {
    const text = groupDraft.trim()
    if (!text || !activeGroupId) return
    setGroupDraft('')
    try {
      await groupMessenger.send(activeGroupId, text)
      setGroupMessages(prev => [...prev, { id: `gout-${Date.now()}-${prev.length}`, text, mine: true }])
    } catch (e) {
      setGroupError(`Envoi impossible — ${(e as Error).message}`)
    }
  }, [groupDraft, activeGroupId, groupMessenger])

  const handleForgetGroup = useCallback(
    async (groupId: string) => {
      await groupMessenger.forgetGroup(groupId)
      if (activeGroupId === groupId) {
        groupUnsubRef.current?.()
        groupUnsubRef.current = null
        setActiveGroupId(null)
      }
      await refreshGroups()
    },
    [groupMessenger, activeGroupId, refreshGroups],
  )

  const handleForget = useCallback(
    async (conversationId: string) => {
      monitorsRef.current.get(conversationId)?.()
      monitorsRef.current.delete(conversationId)
      await messenger.forget(conversationId)
      if (active === conversationId) {
        activeRef.current = null
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
          {callState !== 'idle' && callState !== 'ended' && (
            <div className="rounded-xl bg-[#7578db]/20 border border-[#7578db]/40 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm text-text-primary">
                <span>Appel — {callState}{callConv ? ` (${callConv})` : ''}</span>
                <button
                  type="button"
                  onClick={() => callConv && privateCall.end(callConv)}
                  className="px-2 py-1 rounded-lg bg-red-500/20 text-red-300 text-xs"
                >
                  Raccrocher
                </button>
              </div>
              <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-2 right-2 w-24 h-16 object-cover rounded-md border border-white/20" />
              </div>
              {mediaError && <p className="text-xs text-red-400">{mediaError}</p>}
            </div>
          )}
          <div className="flex items-start gap-2 rounded-xl bg-blue-500/10 border border-blue-500/20 p-3 text-xs text-text-secondary">
            <ShieldCheck size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <p>
              Le mode privé chiffre de bout en bout (Double Ratchet) et livre via un relais qui
              ne connaît ni votre identité, ni votre correspondant. Échangez le lien ci-dessous
              de vive voix, par QR ou via un autre canal de confiance.
            </p>
          </div>
          <p className="text-[11px] text-text-tertiary">
            Transport privé : <span className="text-text-secondary">{getRelayLabel()}</span>
          </p>
          <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
            <span className="shrink-0">Relais :</span>
            <input
              value={relayInput}
              onChange={e => setRelayInput(e.target.value)}
              placeholder="(vide = réseau chiffré) ou wss://xxxx.onion"
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

          {/* Groupes privés */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-text-primary">Groupes privés</h2>
            <p className="text-[11px] text-text-tertiary">
              Groupe chiffré : clé de groupe distribuée via les files du relais, rotation à
              l'ajout/retrait de membres.
            </p>
            <button
              type="button"
              onClick={handleCreateGroup}
              disabled={groupBusy}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50"
            >
              <Plus size={16} /> Créer un groupe privé
            </button>

            {groupInvite && (
              <div className="rounded-2xl bg-bg-surface p-4 flex flex-col items-center gap-3">
                <div className="bg-white p-3 rounded-xl"><QRCode value={groupInvite} size={160} /></div>
                <div className="w-full flex items-center gap-2">
                  <input readOnly value={groupInvite} className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-primary text-[11px] font-mono text-text-secondary truncate" />
                  <button type="button" onClick={() => navigator.clipboard?.writeText(groupInvite)} className="px-3 py-2 rounded-lg bg-bg-hover text-xs text-text-primary">Copier</button>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-bg-surface p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-text-primary font-medium"><Link2 size={16} /> Rejoindre un groupe</div>
              <textarea value={groupJoinLink} onChange={e => setGroupJoinLink(e.target.value)} placeholder="Collez le lien d'invitation au groupe" rows={2} className="w-full px-3 py-2 rounded-lg bg-bg-primary text-xs text-text-primary font-mono resize-none" />
              <button type="button" onClick={handleJoinGroup} disabled={groupBusy || !groupJoinLink.trim()} className="px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50">Rejoindre</button>
            </div>

            {groupError && <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">{groupError}</div>}

            {groups.length === 0 && <p className="text-xs text-text-tertiary">Aucun groupe pour l'instant.</p>}
            {groups.map(g => (
              <div key={g.groupId} className="flex items-center justify-between gap-2 rounded-xl bg-bg-surface px-3 py-2">
                <button type="button" onClick={() => openGroup(g.groupId)} className="flex items-center gap-2 text-sm text-text-primary min-w-0">
                  <Lock size={15} className="text-[#7578db] shrink-0" />
                  <span className="truncate">{g.name}</span>
                  <span className="text-[10px] text-text-tertiary shrink-0">{g.members.length + 1} membres</span>
                </button>
                <button type="button" onClick={() => handleForgetGroup(g.groupId)} className="p-2 rounded-lg hover:bg-bg-hover text-text-tertiary" aria-label="Oublier"><Trash2 size={15} /></button>
              </div>
            ))}

            {activeGroupId && (
              <div className="border border-bg-hover rounded-2xl bg-bg-secondary overflow-hidden">
                <div className="px-4 py-2 text-xs text-text-secondary flex items-center gap-2"><Lock size={13} className="text-[#7578db]" /> groupe {activeGroupId}</div>
                <div className="h-48 overflow-auto px-4 py-2 space-y-2">
                  {groupMessages.length === 0 && <p className="text-xs text-text-tertiary">Aucun message.</p>}
                  {groupMessages.map(m => (
                    <div key={m.id} className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${m.mine ? 'ml-auto bg-[#7578db] text-white' : 'mr-auto bg-bg-surface text-text-primary'}`}>{m.text}</div>
                  ))}
                </div>
                <div className="flex items-center gap-2 px-4 py-3 border-t border-bg-hover">
                  <input value={groupDraft} onChange={e => setGroupDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendGroup() } }} placeholder="Message de groupe chiffré…" className="flex-1 px-3 py-2 rounded-xl bg-bg-primary text-sm text-text-primary" />
                  <button type="button" onClick={handleSendGroup} disabled={!groupDraft.trim()} className="p-2 rounded-xl bg-[#7578db] text-white disabled:opacity-50" aria-label="Envoyer"><Send size={18} /></button>
                </div>
              </div>
            )}
          </div>

          {/* Statuts privés (éphémères) */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-text-primary">Statuts privés</h2>
            <p className="text-[11px] text-text-tertiary">
              Diffusés à vos connexions privées, chiffrés, expirés après 24 h.
            </p>
            <div className="flex items-center gap-2">
              <input
                value={statusDraft}
                onChange={e => setStatusDraft(e.target.value)}
                placeholder="Écrire un statut…"
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-bg-primary text-sm text-text-primary"
              />
              <button
                type="button"
                onClick={publishStatus}
                disabled={!statusDraft.trim()}
                className="px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50"
              >
                Publier
              </button>
            </div>
            {statuses.length === 0 && <p className="text-xs text-text-tertiary">Aucun statut actif.</p>}
            {statuses.map(s => (
              <div key={s.id} className="rounded-xl bg-bg-surface px-3 py-2">
                <div className="flex items-center justify-between text-[10px] text-text-tertiary">
                  <span className="truncate">{s.conversationId === 'moi' ? 'moi' : s.conversationId}</span>
                  <span>{Math.max(0, Math.round((s.expiresAt - Date.now()) / 3_600_000))} h restantes</span>
                </div>
                <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{s.text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Chat actif */}
        {active && (
          <div className="border-t border-bg-hover bg-bg-secondary">
            <div className="px-4 py-2 text-xs text-text-secondary flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Lock size={13} className="text-[#7578db]" /> {active}</span>
              <button
                type="button"
                onClick={() => active && startCall()}
                className="px-2 py-1 rounded-lg bg-bg-hover text-text-primary text-xs"
                aria-label="Appeler"
              >
                Appeler
              </button>
            </div>
            <div className="h-56 overflow-auto px-4 py-2 space-y-2">
              {messages.length === 0 && (
                <p className="text-xs text-text-tertiary">
                  Aucun message. Les messages privés ne sont pas conservés par le relais.
                </p>
              )}
              {messages.map(item => {
                const file = parseFileMessage(item.text) as FileDescriptor | null
                return (
                  <div
                    key={item.id}
                    className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                      item.mine
                        ? 'ml-auto bg-[#7578db] text-white'
                        : 'mr-auto bg-bg-surface text-text-primary'
                    }`}
                  >
                    {file ? (
                      <button
                        type="button"
                        onClick={() => handleDownloadFile(file)}
                        className="flex items-center gap-2 text-left"
                      >
                        <Paperclip size={14} />
                        <span className="truncate max-w-[180px]">{file.name}</span>
                        <span className="opacity-70 text-[10px]">
                          {Math.max(1, Math.round(file.size / 1024))} Ko
                        </span>
                      </button>
                    ) : (
                      item.text
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-bg-hover">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) handleFileSend(f)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="p-2 rounded-xl bg-bg-hover text-text-primary disabled:opacity-50"
                aria-label="Joindre un fichier"
              >
                <Paperclip size={18} />
              </button>
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
