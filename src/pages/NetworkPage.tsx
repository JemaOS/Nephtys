// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Page « Réseau » — suivi EN TEMPS RÉEL des chemins réseau du mode privé.
 *
 *   • globe 3D (Three.js) : nœuds + flux animés, thème et police de l'app ;
 *   • IP d'ENTRÉE (votre IP publique) et IP de SORTIE (vue par le serveur) ;
 *   • chiffrement par saut (E2EE, TLS, Tor, Supabase, XFTP) ;
 *   • flux d'événements live émis par les couches réseau.
 *
 * Vue purement locale (l'IP est obtenue via un service externe configurable,
 * uniquement quand cette page est ouverte).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Globe, Lock, Trash2 } from 'lucide-react'
import { MainLayout } from '@/components/MainLayout'
import { useI18n } from '@/i18n'
import {
  netLogClear,
  netLogSnapshot,
  netLogSubscribe,
  type NetEvent,
  type NetLayer,
  type NetStatus,
} from '@/lib/relay/netLog'
import {
  buildGlobeNodes,
  currentBridge,
  egressInfo,
  fetchGeoIp,
  flowTargetFor,
  NODE_DEVICE,
  type GeoIp,
  type GlobeNode,
} from '@/lib/relay/networkMap'
import { isRelayFallbackActive, isSmpV9Enabled, isTorRelayEnabled, onRelayTransportChange } from '@/lib/relay/relayClient'
import { NetworkGlobe, type NetworkGlobeHandle } from '@/components/NetworkGlobe'

const LAYER_STYLE: Record<NetLayer, string> = {
  tor: 'text-purple-400',
  smp: 'text-[#7578db]',
  'smp-v9': 'text-[#7578db]',
  supabase: 'text-emerald-400',
  xftp: 'text-cyan-400',
  relay: 'text-amber-400',
}

const STATUS_DOT: Record<NetStatus, string> = {
  start: 'bg-text-tertiary',
  ok: 'bg-emerald-500',
  fail: 'bg-red-500',
  fallback: 'bg-amber-500',
}

function timeOf(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour12: false })
}

export function NetworkPage() {
  const { t } = useI18n()
  const [events, setEvents] = useState<NetEvent[]>(() => netLogSnapshot())
  const globeRef = useRef<NetworkGlobeHandle | null>(null)

  // Coalescence : au plus un rendu toutes les 200 ms.
  const pendingRef = useRef<NetEvent[]>([])
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    const flush = () => {
      timerRef.current = null
      if (pendingRef.current.length === 0) return
      const add = pendingRef.current
      pendingRef.current = []
      setEvents(prev => {
        const next = prev.concat(add)
        return next.length > 400 ? next.slice(next.length - 400) : next
      })
    }
    const unsub = netLogSubscribe(e => {
      // Flux animé sur le globe (impératif, sans re-render).
      globeRef.current?.addFlow(NODE_DEVICE, flowTargetFor(e.layer), e.status !== 'fail')
      pendingRef.current.push(e)
      if (timerRef.current == null) timerRef.current = window.setTimeout(flush, 200)
    })
    return () => {
      unsub()
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const [fallback, setFallback] = useState(() => isRelayFallbackActive())
  useEffect(() => onRelayTransportChange(setFallback), [])

  // IP d'entrée + géolocalisation approximative de l'appareil (appel unique).
  const [geo, setGeo] = useState<GeoIp | null>(null)
  const [geoLoading, setGeoLoading] = useState(true)
  useEffect(() => {
    let alive = true
    fetchGeoIp().then(g => {
      if (!alive) return
      setGeo(g)
      setGeoLoading(false)
    })
    return () => { alive = false }
  }, [])

  const torOn = isTorRelayEnabled()
  const smpV9 = isSmpV9Enabled()
  const bridge = currentBridge()
  const egress = useMemo(() => egressInfo(), [torOn, smpV9]) // eslint-disable-line react-hooks/exhaustive-deps

  const nodes: GlobeNode[] = useMemo(
    () => buildGlobeNodes({ device: geo, torEnabled: isTorRelayEnabled(), smpV9Enabled: isSmpV9Enabled() }),
    [geo],
  )

  const rows = useMemo(() => events.slice().reverse().slice(0, 200), [events])

  const summary = [
    { label: t('netTor'), value: torOn ? t('netOn') : t('netOff') },
    { label: t('netTransport'), value: fallback ? t('netDegraded') : t('netNormal') },
    { label: t('netBridge'), value: bridge },
  ]

  const hops = [
    { key: 'e2ee', title: t('netHopE2ee'), desc: t('netHopE2eeDesc') },
    { key: 'tls', title: t('netHopTls'), desc: t('netHopTlsDesc') },
    ...(torOn ? [{ key: 'tor', title: t('netHopTor'), desc: t('netHopTorDesc') }] : []),
    ...(smpV9 ? [{ key: 'smp', title: t('netHopSmp'), desc: t('netHopSmpDesc') }] : []),
    { key: 'supabase', title: t('netHopSupabase'), desc: t('netHopSupabaseDesc') },
    { key: 'xftp', title: t('netHopXftp'), desc: t('netHopXftpDesc') },
  ]

  return (
    <MainLayout>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-20">
          <header className="flex items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
              <Globe size={20} className="text-[#7578db]" /> {t('netTitle')}
            </h1>
            <button
              type="button"
              onClick={() => {
                netLogClear()
                setEvents([])
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-hover text-text-primary text-xs font-medium"
            >
              <Trash2 size={14} /> {t('netClear')}
            </button>
          </header>

          {/* Globe 3D : nœuds + flux animés */}
          <section className="rounded-2xl bg-bg-surface overflow-hidden">
            <NetworkGlobe ref={globeRef} nodes={nodes} height={300} />
          </section>

          {/* IP d'entrée / sortie */}
          <section className="rounded-2xl bg-bg-surface p-3 space-y-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              <Lock size={13} /> {t('netIpTitle')}
            </h2>
            <div className="flex items-start justify-between gap-3 text-xs">
              <span className="text-text-secondary shrink-0">{t('netIpEntry')}</span>
              <span className="text-text-primary font-mono text-right break-all">
                {geo ? geo.ip : geoLoading ? '…' : t('netIpUnknown')}
                {geo?.city ? ` · ${geo.city}` : ''}
              </span>
            </div>
            <div className="flex items-start justify-between gap-3 text-xs">
              <span className="text-text-secondary shrink-0">{t('netIpExit')}</span>
              <span className={`font-mono text-right break-all ${egress.masked ? 'text-amber-400' : 'text-text-primary'}`}>
                {egress.ip}
                {` · ${egress.transport}`}
              </span>
            </div>
            <p className="text-[10px] text-text-tertiary">{t('netGeoNote')}</p>
          </section>

          {/* Chemins réseau (état) */}
          <section className="rounded-2xl bg-bg-surface p-3 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('netPaths')}</h2>
            {summary.map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-text-secondary shrink-0">{label}</span>
                <span className="text-text-primary font-mono text-right break-all">{value}</span>
              </div>
            ))}
          </section>

          {/* Chiffrement par saut */}
          <section className="rounded-2xl bg-bg-surface p-3 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('netEncTitle')}</h2>
            {hops.map(h => (
              <div key={h.key} className="space-y-0.5">
                <p className="text-xs font-medium text-text-primary">{h.title}</p>
                <p className="text-[11px] text-text-secondary">{h.desc}</p>
              </div>
            ))}
          </section>

          {/* Flux live */}
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              <Activity size={13} /> {t('netLive')}
            </h2>
            {rows.length === 0 && <p className="text-sm text-text-tertiary">{t('netEmpty')}</p>}
            {rows.map(ev => (
              <div key={ev.id} className="flex items-start gap-2 rounded-xl bg-bg-surface px-3 py-2">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[ev.status]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`font-semibold ${LAYER_STYLE[ev.layer]}`}>{ev.layer}</span>
                    <span className="text-text-primary font-mono">{ev.op}</span>
                    {typeof ev.ms === 'number' && <span className="text-text-tertiary">{ev.ms} ms</span>}
                    <span className="ml-auto text-text-tertiary">{timeOf(ev.t)}</span>
                  </div>
                  {ev.endpoint && <p className="text-[11px] text-text-secondary font-mono break-all">{ev.endpoint}</p>}
                  {ev.detail && <p className="text-[11px] text-text-tertiary break-all">{ev.detail}</p>}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </MainLayout>
  )
}
