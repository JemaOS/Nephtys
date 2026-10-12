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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPeerConnectionConfig, hasTurnServer, isRelayOnlyCallsEnabled } from '@/lib/iceServers'
import { isCoverTrafficEnabled, setCoverTrafficEnabled } from '@/lib/privacyPrefs'
import { useI18n, tStatic } from '@/i18n'
import { SafeQrCode } from '@/components/SafeQrCode'
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  EyeOff,
  Loader2,
  Lock,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { MainLayout } from '@/components/MainLayout'
import { useAuth } from '@/context/AuthContext'
import {
  getPrivateMessenger,
  getRelayUrl,
  getRelayLabel,
  setRelayUrl,
  isTorRelayEnabled,
  setTorRelayEnabled,
  setDecentralizedRelayEnabled,
  getRelayMode,
  setRelayMode,
  getRelayPool,
  getSmpRelayPresets,
  getSmpV9Host,
  setSmpV9Host,
  type RelayMode,
} from '@/lib/relay/relayClient'
import { getGroupMessenger } from '@/lib/relay/groupClient'
import type { GroupRecord } from '@/lib/relay/groupMessenger'
import { parseFileMessage } from '@/lib/relay/privateMessenger'
import { parseStatus, encodeStatus, toRecord, type StatusPayload, type StatusRecord } from '@/lib/relay/statusStore'
import { PrivateCall, type CallState, type PeerLike } from '@/lib/relay/privateCall'
import { isCallSignal } from '@/lib/relay/callSignaling'
import { IdbStatusStore } from '@/lib/relay/statusIdbStore'
import { uploadFileXftp, downloadAndDecryptFile, sanitizeFileName, type FileDescriptor } from '@/lib/relay/fileTransfer'
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

/**
 * Shell du mode privé **anonyme** (sans compte) : plein écran, SANS la barre
 * latérale ni la navigation de l'app connectée. L'utilisateur final qui n'a pas
 * de compte ne voit jamais l'interface « connectée » — deux interfaces distinctes.
 */
function AnonymousShell({ children }: { readonly children: ReactNode }) {
  return <div className="h-screen-safe flex flex-col bg-bg-primary overflow-hidden">{children}</div>
}

/** Bouton-disclosure repliable (options secondaires masquées par défaut). */
function Disclosure({
  label,
  open,
  onToggle,
  icon,
  children,
}: {
  readonly label: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly icon?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className="rounded-2xl bg-bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-sm text-text-secondary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
      >
        <span className="flex items-center gap-2">{icon}{label}</span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  )
}

/** Interrupteur accessible (libellé + état) — `role="switch"`/`aria-checked`. */
function Toggle({
  label,
  checked,
  onChange,
  icon,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (next: boolean) => void
  readonly icon?: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db] ${
        checked
          ? 'bg-[#7578db]/20 border-[#7578db]/40 text-text-primary'
          : 'bg-bg-primary border-bg-hover text-text-secondary hover:text-text-primary'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span
        aria-hidden
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
          checked ? 'bg-[#7578db]' : 'bg-bg-hover'
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  )
}

export function PrivatePage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const { user, loading } = useAuth()
  const isAnonymous = !user
  // Interface distincte : shell anonyme (sans compte) vs shell de l'app connectée.
  const Shell = isAnonymous ? AnonymousShell : MainLayout
  const messenger = useMemo(() => getPrivateMessenger(), [])

  const [connections, setConnections] = useState<PrivateConnectionRecord[]>([])
  const [invite, setInvite] = useState<string | null>(null)
  const [joinLink, setJoinLink] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Création/jonction d'une connexion privée : la mise en place SMP (createQueue)
  // peut prendre plusieurs secondes → indicateur de chargement + bouton désactivé
  // (anti double-clic) + étape en cours + réessai en cas d'échec.
  const [creating, setCreating] = useState(false)
  const [creatingStep, setCreatingStep] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [connectFailed, setConnectFailed] = useState<'create' | 'join' | null>(null)
  const [copied, setCopied] = useState(false)
  const [relayInput, setRelayInput] = useState(() => getRelayUrl())

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

  // Contrôles de la connexion active (relais SMP / Tor / incognito).
  const [relayModeState, setRelayModeState] = useState<RelayMode>(() => getRelayMode())
  const [torOn, setTorOn] = useState<boolean>(() => isTorRelayEnabled())
  const [coverOn, setCoverOn] = useState<boolean>(() => isCoverTrafficEnabled())
  // Relais SMP : le contrôle « Relais » opère sur les serveurs SMP (hosts), pas
  // sur le pont de transport auto-hébergé (jamais exposé à l'utilisateur).
  const smpPresets = useMemo(() => getSmpRelayPresets(), [])
  const [smpHost, setSmpHost] = useState<string>(() => getSmpV9Host())
  const [smpMode, setSmpMode] = useState<'auto' | 'manual'>(() =>
    getSmpV9Host() === (getSmpRelayPresets()[0] ?? '') ? 'auto' : 'manual',
  )
  // Vrai dès qu'un changement de relais SMP attend un rechargement pour s'appliquer.
  const [smpPending, setSmpPending] = useState(false)
  // Liste des options du sélecteur (inclut un host personnalisé hors presets).
  const smpOptions = useMemo(
    () => (smpHost && !smpPresets.includes(smpHost) ? [smpHost, ...smpPresets] : smpPresets),
    [smpHost, smpPresets],
  )
  // Réglages capturés avant l'activation d'Incognito, pour les restaurer à l'arrêt.
  const incognitoPrevRef = useRef<{ tor: boolean; cover: boolean; mode: RelayMode; smpHost: string } | null>(null)

  // Onglets : une seule section à la fois (écran plus lisible, moins chargé).
  const [tab, setTab] = useState<'connections' | 'groups' | 'status'>('connections')
  const [showJoin, setShowJoin] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
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
      setMediaError(tStatic('pvMediaError', { message: (e as Error).message }))
      return null
    }
  }, [])

  const privateCall = useMemo(
    () =>
      new PrivateCall({
        createPeer: () => {
          if (typeof RTCPeerConnection === 'undefined') return null
          // Fail-closed IP : sans TURN disponible, un PeerConnection replierait
          // en P2P direct (fuite d'IP) → on n'en crée aucun.
          if (isRelayOnlyCallsEnabled() && !hasTurnServer()) return null
          const pc = new RTCPeerConnection(getPeerConnectionConfig())
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
    // Fail-closed : un appel WebRTC (ICE) contourne le transport Tor et expose
    // l'adresse IP réelle de l'appareil. En mode Tor, on refuse l'appel.
    if (isTorRelayEnabled()) {
      setMediaError(tStatic('pvCallDisabledTor'))
      return
    }
    // Fail-closed IP : sans cred TURN, l'appel replierait en P2P direct → refus.
    if (isRelayOnlyCallsEnabled() && !hasTurnServer()) {
      setMediaError(tStatic('pvNoTurn'))
      return
    }
    setMediaError(null)
    await acquireMedia()
    await privateCall.start(active)
  }, [active, acquireMedia, privateCall])

  /** Accepte un appel entrant : n'ouvre micro/caméra QU'après consentement. */
  const acceptCall = useCallback(async () => {
    if (!callConv) return
    // Fail-closed IP : si aucun TURN n'est disponible, accepter exposerait l'IP.
    if (isRelayOnlyCallsEnabled() && !hasTurnServer()) {
      setMediaError(tStatic('pvNoTurn'))
      await privateCall.reject(callConv)
      return
    }
    setMediaError(null)
    await acquireMedia()
    await privateCall.accept(callConv)
  }, [callConv, acquireMedia, privateCall])

  /** Refuse un appel entrant (aucun média n'est acquis). */
  const rejectCall = useCallback(async () => {
    if (!callConv) return
    await privateCall.reject(callConv)
  }, [callConv, privateCall])

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
          // Mode Tor : on n'établit aucun média WebRTC (ICE exposerait l'IP réelle).
          if (isTorRelayEnabled()) return
          // IMPORTANT (sécurité) : on ne fait que TRAITER le signal. Une offre
          // entrante passe en « sonnerie » ; aucun micro/caméra n'est ouvert et
          // aucune réponse n'est envoyée sans acceptation explicite (acceptCall).
          void privateCall.handleSignal(convId, text)
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
      const stopCover = isCoverTrafficEnabled() ? messenger.startCoverTraffic(convId) : () => {}
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
    if (creating) return
    setCreating(true)
    setCreatingStep(tStatic('pvCreateStepIdentity'))
    setError(null)
    setConnectFailed(null)
    try {
      const id = newConnectionId()
      setCreatingStep(tStatic('pvCreateStepQueue'))
      const { link } = await messenger.establish(id)
      setInvite(link)
      await refresh()
      openConnection(id)
    } catch (e) {
      console.error('[private] create failed', e)
      setConnectFailed('create')
    } finally {
      setCreating(false)
      setCreatingStep(null)
    }
  }, [creating, messenger, refresh, openConnection])

  const handleJoin = useCallback(async () => {
    if (!joinLink.trim() || joining) return
    setJoining(true)
    setError(null)
    setConnectFailed(null)
    try {
      const id = newConnectionId()
      await messenger.accept(id, joinLink.trim())
      setJoinLink('')
      await refresh()
      openConnection(id)
    } catch (e) {
      console.error('[private] join failed', e)
      setConnectFailed('join')
    } finally {
      setJoining(false)
    }
  }, [joining, messenger, refresh, openConnection, joinLink])

  const handleSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || !active) return
    setDraft('')
    try {
      await messenger.send(active, text)
      setMessages(prev => [...prev, { id: `${Date.now()}-${prev.length}`, text, mine: true }])
    } catch (e) {
      setError(tStatic('pvSendError', { message: (e as Error).message }))
    }
  }, [draft, active, messenger])

  const handleFileSend = useCallback(
    async (file: File) => {
      if (!active) return
      setUploading(true)
      setError(null)
      try {
        const descriptor = await uploadFileXftp(file)
        await messenger.sendFile(active, descriptor)
        // Affiche le descripteur localement (rendu comme fichier chiffré).
        setMessages(prev => [
          ...prev,
          { id: `out-file-${Date.now()}-${prev.length}`, text: `\u0000NPT-FILE:${JSON.stringify(descriptor)}`, mine: true },
        ])
      } catch (e) {
        setError(tStatic('pvUploadError', { message: (e as Error).message }))
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
      // Nom assaini : un descripteur malveillant ne doit pas pouvoir écrire
      // hors du dossier de téléchargement (séparateurs de chemin retirés).
      a.download = sanitizeFileName(descriptor.name)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      setError(tStatic('pvDownloadError', { message: (e as Error).message }))
    }
  }, [])

  // ─── Contrôles relais SMP / Tor / incognito ─────────────────────────
  /** Relais SMP courant, affiché de façon lisible (jamais le pont interne). */
  const relayDisplay = useMemo(
    () => t('pvSmpCurrent', { host: smpHost }),
    [smpHost, t],
  )

  /** Sélectionne un serveur SMP (mémorisé) ; appliqué à la prochaine connexion. */
  const selectSmpHost = useCallback((host: string, mode: 'auto' | 'manual') => {
    const target = host.trim()
    if (!target) return
    setSmpV9Host(target)
    setSmpHost(target)
    setSmpMode(mode)
    setSmpPending(true)
  }, [])

  /** « Automatique » (preset par défaut) ou bascule en sélection manuelle. */
  const applySmpMode = useCallback(
    (mode: 'auto' | 'manual') => {
      if (mode === 'auto') {
        const preset = smpPresets[0]
        if (preset) selectSmpHost(preset, 'auto')
        else setSmpMode('auto')
      } else {
        setSmpMode('manual')
      }
    },
    [smpPresets, selectSmpHost],
  )

  /** Passe au serveur SMP suivant de la liste des presets (avec bouclage). */
  const changeSmpHost = useCallback(() => {
    if (smpPresets.length === 0) return
    const idx = smpPresets.indexOf(smpHost)
    const next = smpPresets[(idx + 1) % smpPresets.length]
    selectSmpHost(next, 'manual')
  }, [smpPresets, smpHost, selectSmpHost])

  const toggleTor = useCallback((next: boolean) => {
    setTorRelayEnabled(next)
    // isTorRelayEnabled s'auto-répare (aucune adresse .onion → reste désactivé) :
    // on relit l'état effectif pour ne pas afficher un « Tor actif » mensonger.
    setTorOn(isTorRelayEnabled())
  }, [])

  /**
   * Incognito : un seul interrupteur pour le trio de protection des métadonnées
   * (routage Tor + trafic de couverture + relais automatique).
   * ON  → active le trio. OFF → restaure les réglages précédents capturés à
   * l'activation (Tor, couverture, mode de relais) ; à défaut, revient aux
   * valeurs par défaut. Les réglages individuels restent en « Options avancées ».
   */
  const toggleIncognito = useCallback((on: boolean) => {
    if (on) {
      incognitoPrevRef.current = {
        tor: isTorRelayEnabled(),
        cover: isCoverTrafficEnabled(),
        mode: getRelayMode(),
        smpHost: getSmpV9Host(),
      }
      setTorRelayEnabled(true)
      setCoverTrafficEnabled(true)
      setRelayMode('auto')
      setDecentralizedRelayEnabled(true)
      setTorOn(isTorRelayEnabled())
      setCoverOn(true)
      setRelayModeState('auto')
      // Relais automatique : serveur SMP par défaut (le plus neutre).
      const preset = smpPresets[0]
      if (preset) {
        setSmpV9Host(preset)
        setSmpHost(preset)
        setSmpMode('auto')
        setSmpPending(true)
      }
    } else {
      const prev = incognitoPrevRef.current
      incognitoPrevRef.current = null
      const target = prev ?? {
        tor: false,
        cover: true,
        mode: 'auto' as RelayMode,
        smpHost: smpPresets[0] ?? '',
      }
      setTorRelayEnabled(target.tor)
      setCoverTrafficEnabled(target.cover)
      setRelayMode(target.mode)
      setDecentralizedRelayEnabled(target.mode === 'auto')
      setTorOn(isTorRelayEnabled())
      setCoverOn(target.cover)
      setRelayModeState(target.mode)
      if (target.smpHost) {
        setSmpV9Host(target.smpHost)
        setSmpHost(target.smpHost)
        setSmpMode(target.smpHost === (smpPresets[0] ?? '') ? 'auto' : 'manual')
        setSmpPending(true)
      }
    }
  }, [smpPresets])

  const incognitoOn = torOn && coverOn && relayModeState === 'auto'

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
      const { record, invite } = await groupMessenger.create(tStatic('pvGroupName'))
      setGroupInvite(invite)
      await refreshGroups()
      openGroup(record.groupId)
    } catch (e) {
      setGroupError(tStatic('pvGroupCreateError', { message: (e as Error).message }))
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
      setGroupError(tStatic('pvGroupJoinError', { message: (e as Error).message }))
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
      setGroupError(tStatic('pvGroupSendError', { message: (e as Error).message }))
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

  const closeConnection = useCallback(() => {
    activeRef.current = null
    setActive(null)
  }, [])

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

  if (loading) {
    return (
      <div className="h-screen-safe flex items-center justify-center bg-bg-primary">
        <div className="text-sm text-text-secondary">{t('pvLoading')}</div>
      </div>
    )
  }

  const segClass = (on: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db] ${
      on ? 'bg-[#7578db] text-white' : 'text-text-secondary hover:text-text-primary'
    }`
  const chipClass =
    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium border border-bg-hover bg-bg-primary text-text-secondary hover:text-text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]'

  const inviteCard = invite && (
    <div className="rounded-2xl bg-bg-surface p-4 flex flex-col items-center gap-3">
      <div className="w-full flex items-center justify-between">
        <span className="text-xs text-text-secondary">{t('pvInviteTitle')}</span>
        <button
          type="button"
          onClick={() => setInvite(null)}
          className="p-1 rounded-lg hover:bg-bg-hover text-text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
          aria-label={t('close')}
        >
          <X size={16} />
        </button>
      </div>
      <SafeQrCode value={invite} size={180} />
      <div className="w-full flex items-center gap-2">
        <input
          readOnly
          value={invite}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-primary text-xs text-text-secondary font-mono truncate"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-bg-hover text-xs text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
        >
          <Copy size={14} /> {copied ? t('pvCopied') : t('pvCopy')}
        </button>
      </div>
      <p className="text-[11px] text-text-tertiary text-center">{t('pvInviteHint')}</p>
    </div>
  )

  const errorBox = error && (
    <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">{error}</div>
  )

  return (
    <Shell>
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bg-hover">
          {!isAnonymous && (
            <button
              type="button"
              onClick={() => navigate('/chats')}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
              aria-label={t('back')}
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Lock size={20} className="text-[#7578db] shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-text-primary">{t('pvTitle')}</h1>
              <p className="text-xs text-text-secondary truncate">{t('pvSubtitle')}</p>
            </div>
          </div>
          {isAnonymous && (
            <button
              type="button"
              onClick={() => navigate('/auth')}
              className="shrink-0 px-3 py-1.5 rounded-lg border border-bg-hover text-xs text-text-primary hover:bg-bg-hover transition-colors"
            >
              {t('pvSignIn')}
            </button>
          )}
        </div>

        {/* Onglets */}
        <div className="px-4 pt-3">
          <div className="flex gap-1 p-1 rounded-xl bg-bg-surface" role="tablist">
            {([
              { id: 'connections', label: t('pvTabConnections') },
              { id: 'groups', label: t('pvTabGroups') },
              { id: 'status', label: t('pvTabStatus') },
            ] as const).map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db] ${
                  tab === item.id ? 'bg-[#7578db] text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-5">
          {callState === 'ringing' ? (
            <div className="rounded-xl bg-[#7578db]/20 border border-[#7578db]/40 p-3 space-y-2">
              <div className="text-sm text-text-primary">
                {t('pvIncomingCall', { conv: callConv ? ` (${callConv})` : '' })}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={acceptCall}
                  className="flex-1 px-3 py-2 rounded-lg bg-green-500/20 text-green-300 text-sm font-medium"
                >
                  {t('pvAccept')}
                </button>
                <button
                  type="button"
                  onClick={rejectCall}
                  className="flex-1 px-3 py-2 rounded-lg bg-red-500/20 text-red-300 text-sm font-medium"
                >
                  {t('pvDecline')}
                </button>
              </div>
              {mediaError && <p className="text-xs text-red-400">{mediaError}</p>}
            </div>
          ) : callState !== 'idle' && callState !== 'ended' && (
            <div className="rounded-xl bg-[#7578db]/20 border border-[#7578db]/40 p-3 space-y-2">
              <div className="flex items-center justify-between text-sm text-text-primary">
                <span>{t('pvCallState', { state: callState, conv: callConv ? ` (${callConv})` : '' })}</span>
                <button
                  type="button"
                  onClick={() => callConv && privateCall.end(callConv)}
                  className="px-2 py-1 rounded-lg bg-red-500/20 text-red-300 text-xs"
                >
                  {t('pvHangUp')}
                </button>
              </div>
              <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                <video ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-2 right-2 w-24 h-16 object-cover rounded-md border border-white/20" />
              </div>
              {mediaError && <p className="text-xs text-red-400">{mediaError}</p>}
            </div>
          )}

          {tab === 'connections' && (
            <>
              {inviteCard}

              {/* Création : une action principale, le reste replié (aucun empilement). */}
              {!active && (
                <>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    aria-busy={creating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#7578db] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
                  >
                    {creating ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden />
                        {t('pvCreating')}
                      </>
                    ) : (
                      <>
                        <Plus size={16} /> {t('pvCreateConnection')}
                      </>
                    )}
                  </button>
                  {creating && creatingStep && (
                    <p role="status" className="text-[11px] text-text-tertiary text-center">
                      {t('pvCreatingStep', { step: creatingStep })}
                    </p>
                  )}

                  <Disclosure label={t('pvJoinDisclosure')} open={showJoin} onToggle={() => setShowJoin(v => !v)}>
                    <textarea
                      value={joinLink}
                      onChange={e => setJoinLink(e.target.value)}
                      placeholder={t('pvJoinPlaceholder')}
                      rows={2}
                      className="w-full px-3 py-2 rounded-xl bg-bg-primary text-xs text-text-primary font-mono resize-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
                    />
                    <button
                      type="button"
                      onClick={handleJoin}
                      disabled={joining || !joinLink.trim()}
                      aria-busy={joining}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-bg-hover text-text-primary text-sm font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {joining ? (
                        <>
                          <Loader2 size={14} className="animate-spin" aria-hidden />
                          {t('pvJoining')}
                        </>
                      ) : (
                        t('pvJoinAction')
                      )}
                    </button>
                  </Disclosure>

                  <Disclosure
                    label={t('pvAdvanced')}
                    open={showAdvanced}
                    onToggle={() => setShowAdvanced(v => !v)}
                    icon={<SlidersHorizontal size={14} />}
                  >
                    <p className="text-[11px] text-text-tertiary">
                      {t('pvTransport')} : <span className="text-text-secondary break-all">{getRelayLabel()}</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        value={relayInput}
                        onChange={e => setRelayInput(e.target.value)}
                        placeholder={t('pvRelayUrlPlaceholder')}
                        aria-label={t('pvRelayUrlLabel')}
                        className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-primary text-[11px] text-text-secondary font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          // Ne recharger QUE si l'URL a été acceptée (wss:// requis
                          // hors loopback/.onion) — sinon on affiche un message.
                          if (setRelayUrl(relayInput)) {
                            globalThis.location.reload()
                          } else {
                            setError(tStatic('relayInvalidUrl'))
                          }
                        }}
                        className="px-2 py-1 rounded-lg bg-bg-hover text-[11px] text-text-primary shrink-0"
                      >
                        {t('pvApply')}
                      </button>
                    </div>
                  </Disclosure>
                </>
              )}

              {connectFailed && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400 flex items-center justify-between gap-3"
                >
                  <span>{connectFailed === 'create' ? t('pvCreateFailed') : t('pvJoinFailed')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (connectFailed === 'create') void handleCreate()
                      else void handleJoin()
                    }}
                    disabled={creating || joining}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-bg-hover text-text-primary font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
                  >
                    {t('retry')}
                  </button>
                </div>
              )}

              {errorBox}

              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('pvMyConnections')}</h2>
                {connections.length === 0 && <p className="text-sm text-text-tertiary">{t('pvNoConnections')}</p>}
                {connections.map(conn => (
                  <div
                    key={conn.conversationId}
                    className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${
                      active === conn.conversationId ? 'bg-[#7578db]/10 ring-1 ring-[#7578db]/30' : 'bg-bg-surface'
                    }`}
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
                      aria-label={t('pvForget')}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </section>

              <p className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
                <ShieldCheck size={13} className="text-[#7578db] shrink-0" />
                {t('pvE2eeNote')}
              </p>
            </>
          )}

          {tab === 'groups' && (
            <>
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={groupBusy}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50"
              >
                <Plus size={16} /> {t('pvCreateGroup')}
              </button>

              {groupInvite && (
                <div className="rounded-2xl bg-bg-surface p-4 flex flex-col items-center gap-3">
                  <SafeQrCode value={groupInvite} size={160} />
                  <div className="w-full flex items-center gap-2">
                    <input readOnly value={groupInvite} className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-primary text-[11px] font-mono text-text-secondary truncate" />
                    <button type="button" onClick={() => navigator.clipboard?.writeText(groupInvite)} className="px-3 py-2 rounded-lg bg-bg-hover text-xs text-text-primary">{t('pvCopy')}</button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <textarea value={groupJoinLink} onChange={e => setGroupJoinLink(e.target.value)} placeholder={t('pvGroupJoinPlaceholder')} rows={2} className="w-full px-3 py-2 rounded-xl bg-bg-surface text-xs text-text-primary font-mono resize-none outline-none" />
                <button type="button" onClick={handleJoinGroup} disabled={groupBusy || !groupJoinLink.trim()} className="w-full px-3 py-2 rounded-xl bg-bg-hover text-text-primary text-sm font-medium disabled:opacity-50">{t('pvJoinAction')}</button>
              </div>

              {groupError && <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">{groupError}</div>}

              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('pvMyGroups')}</h2>
                {groups.length === 0 && <p className="text-sm text-text-tertiary">{t('pvNoGroups')}</p>}
                {groups.map(g => (
                  <div key={g.groupId} className="flex items-center justify-between gap-2 rounded-xl bg-bg-surface px-3 py-2">
                    <button type="button" onClick={() => openGroup(g.groupId)} className="flex items-center gap-2 text-sm text-text-primary min-w-0">
                      <Lock size={15} className="text-[#7578db] shrink-0" />
                      <span className="truncate">{g.name}</span>
                      <span className="text-[10px] text-text-tertiary shrink-0">{t('pvMembers', { count: g.members.length + 1 })}</span>
                    </button>
                    <button type="button" onClick={() => handleForgetGroup(g.groupId)} className="p-2 rounded-lg hover:bg-bg-hover text-text-tertiary" aria-label={t('pvForget')}><Trash2 size={15} /></button>
                  </div>
                ))}
              </section>
            </>
          )}

          {tab === 'status' && (
            <>
              <div className="flex items-center gap-2">
                <input
                  value={statusDraft}
                  onChange={e => setStatusDraft(e.target.value)}
                  placeholder={t('pvPublishStatus')}
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-bg-surface text-sm text-text-primary outline-none"
                />
                <button
                  type="button"
                  onClick={publishStatus}
                  disabled={!statusDraft.trim()}
                  className="px-3 py-2 rounded-xl bg-[#7578db] text-white text-sm font-medium disabled:opacity-50"
                >
                  {t('pvPublish')}
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary">{t('pvStatusHint')}</p>
              {statuses.length === 0 && <p className="text-sm text-text-tertiary">{t('pvNoStatus')}</p>}
              {statuses.map(s => (
                <div key={s.id} className="rounded-xl bg-bg-surface px-3 py-2">
                  <div className="flex items-center justify-between text-[10px] text-text-tertiary">
                    <span className="truncate">{s.conversationId === 'moi' ? t('pvMe') : s.conversationId}</span>
                    <span>{t('pvHoursLeft', { count: Math.max(0, Math.round((s.expiresAt - Date.now()) / 3_600_000)) })}</span>
                  </div>
                  <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{s.text}</p>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Chat 1:1 + contrôles compacts de la connexion */}
        {tab === 'connections' && active && (
          <div className="border-t border-bg-hover bg-bg-secondary">
            <div className="px-4 py-2.5 space-y-2 border-b border-bg-hover">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-text-secondary min-w-0">
                  <Lock size={13} className="text-[#7578db] shrink-0" />
                  <span className="truncate">{active}</span>
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => active && startCall()}
                    disabled={torOn}
                    title={torOn ? t('pvCallTorTooltip') : undefined}
                    className="px-2.5 py-1 rounded-lg bg-bg-hover text-text-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={t('pvCall')}
                  >
                    {t('pvCall')}
                  </button>
                  <button
                    type="button"
                    onClick={closeConnection}
                    className="p-1.5 rounded-lg hover:bg-bg-hover text-text-tertiary"
                    aria-label={t('pvCloseConnection')}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Contrôles compacts : relais SMP + Tor + incognito (une seule rangée). */}
              <div className="flex flex-wrap items-center gap-2">
                <div role="group" aria-label={t('pvRelayControl')} className="flex items-center rounded-full bg-bg-primary p-0.5">
                  <button type="button" aria-pressed={smpMode === 'auto'} onClick={() => applySmpMode('auto')} className={segClass(smpMode === 'auto')}>
                    {t('pvRelayAuto')}
                  </button>
                  <button type="button" aria-pressed={smpMode === 'manual'} onClick={() => applySmpMode('manual')} className={segClass(smpMode === 'manual')}>
                    {t('pvRelayChoose')}
                  </button>
                </div>
                <button type="button" onClick={changeSmpHost} className={chipClass}>
                  <RefreshCw size={13} /> {t('pvRelayChange')}
                </button>
                <span className="text-[11px] text-text-tertiary truncate max-w-[45%]" title={relayDisplay}>{relayDisplay}</span>
                <Toggle label={t('torLabel')} checked={torOn} onChange={toggleTor} />
                <Toggle label={t('pvIncognito')} checked={incognitoOn} onChange={toggleIncognito} icon={<EyeOff size={13} />} />
              </div>
              {/* Sélection manuelle : liste des serveurs SMP (le cycle reste un raccourci). */}
              {smpMode === 'manual' && smpOptions.length > 0 && (
                <label className="flex items-center gap-2 text-[11px] text-text-tertiary">
                  <span className="shrink-0">{t('pvRelayChoose')}</span>
                  <select
                    value={smpHost}
                    onChange={e => selectSmpHost(e.target.value, 'manual')}
                    aria-label={t('pvSmpSelectLabel')}
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg bg-bg-primary text-[11px] text-text-secondary font-mono focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7578db]"
                  >
                    {smpOptions.map(host => (
                      <option key={host} value={host}>{host}</option>
                    ))}
                  </select>
                </label>
              )}
              {smpPending && <p className="text-[11px] text-[#a5a7ff]">{t('pvRelayAppliesNext')}</p>}
              {incognitoOn && <p className="text-[11px] text-[#a5a7ff]">{t('pvIncognitoDesc')}</p>}
              {torOn && <p className="text-[11px] text-text-tertiary">{t('torActiveHint')}</p>}
            </div>

            <div className="h-56 overflow-auto px-4 py-2 space-y-2">
              {messages.length === 0 && <p className="text-xs text-text-tertiary">{t('pvNoMessages')}</p>}
              {messages.map(item => {
                const file = parseFileMessage(item.text) as FileDescriptor | null
                return (
                  <div
                    key={item.id}
                    className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                      item.mine ? 'ml-auto bg-[#7578db] text-white' : 'mr-auto bg-bg-surface text-text-primary'
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
                          {t('pvKb', { count: Math.max(1, Math.round(file.size / 1024)) })}
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
                aria-label={t('pvAttachFile')}
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
                placeholder={t('pvPrivateMessagePlaceholder')}
                className="flex-1 px-3 py-2 rounded-xl bg-bg-primary text-sm text-text-primary"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!draft.trim()}
                className="p-2 rounded-xl bg-[#7578db] text-white disabled:opacity-50"
                aria-label={t('send')}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Chat de groupe */}
        {tab === 'groups' && activeGroupId && (
          <div className="border-t border-bg-hover bg-bg-secondary">
            <div className="px-4 py-2 text-xs text-text-secondary flex items-center gap-2">
              <Lock size={13} className="text-[#7578db]" /> {t('pvGroupLabel', { id: activeGroupId })}
            </div>
            <div className="h-56 overflow-auto px-4 py-2 space-y-2">
              {groupMessages.length === 0 && <p className="text-xs text-text-tertiary">{t('pvNoMessagesShort')}</p>}
              {groupMessages.map(m => (
                <div key={m.id} className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${m.mine ? 'ml-auto bg-[#7578db] text-white' : 'mr-auto bg-bg-surface text-text-primary'}`}>{m.text}</div>
              ))}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-bg-hover">
              <input value={groupDraft} onChange={e => setGroupDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendGroup() } }} placeholder={t('pvGroupMessagePlaceholder')} className="flex-1 px-3 py-2 rounded-xl bg-bg-primary text-sm text-text-primary" />
              <button type="button" onClick={handleSendGroup} disabled={!groupDraft.trim()} className="p-2 rounded-xl bg-[#7578db] text-white disabled:opacity-50" aria-label={t('send')}><Send size={18} /></button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}
