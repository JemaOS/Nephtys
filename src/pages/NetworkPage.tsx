// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Page « Réseau » — suivi EN TEMPS RÉEL des chemins réseau du mode privé.
 *
 * Affiche (1) l'état des chemins configurés (Tor, pont SMP, relais SMP, transport
 * actif/dégradé) et (2) un flux d'événements live émis par les couches réseau
 * (Tor, SMP, SMP v9, Supabase, XFTP, repli). Vue purement locale : rien n'est
 * envoyé au serveur.
 *
 * Perf : les événements sont coalescés (au plus un rendu toutes les 200 ms) et
 * la liste est bornée à 200 lignes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Globe, Trash2 } from 'lucide-react'
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
  getOnionRelayUrl,
  getSmpBridgeUrl,
  getSmpV9Host,
  isRelayFallbackActive,
  isTorRelayEnabled,
  onRelayTransportChange,
} from '@/lib/relay/relayClient'

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

  // Coalescence : on accumule les événements et on applique au plus un rendu
  // toutes les 200 ms (évite un re-render par paquet à fort débit).
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

  const torOn = isTorRelayEnabled()
  const onion = torOn ? getOnionRelayUrl() : ''
  const bridge = getSmpBridgeUrl()
  const host = getSmpV9Host()

  const rows = useMemo(() => events.slice().reverse().slice(0, 200), [events])

  const summary = [
    { label: t('netTor'), value: torOn ? `${t('netOn')} · ${onion}` : t('netOff') },
    { label: t('netTransport'), value: fallback ? t('netDegraded') : t('netNormal') },
    { label: t('netBridge'), value: bridge },
    { label: t('netHost'), value: host },
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

          <section className="rounded-2xl bg-bg-surface p-3 space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('netPaths')}</h2>
            {summary.map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-3 text-xs">
                <span className="text-text-secondary shrink-0">{label}</span>
                <span className="text-text-primary font-mono text-right break-all">{value}</span>
              </div>
            ))}
          </section>

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
