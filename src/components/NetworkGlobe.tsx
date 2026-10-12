// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Globe 3D des flux réseau (Three.js, procédural — aucune texture externe).
 *
 * Affiche une sphère thémée (grille + atmosphère aux couleurs de l'app), les
 * nœuds (Vous, pont SMP, relais SMP, Supabase, Tor, XFTP) et des arcs animés à
 * chaque événement réseau. Les étiquettes sont des `<div>` HTML (police et thème
 * de l'app), repositionnées par projection à chaque frame — donc aucun re-render
 * React pendant l'animation.
 *
 * Perf : rendu borné (pixelRatio ≤ 2), arcs transitoires (max `MAX_ARCS`) libérés
 * après expiration, labels mis à jour impérativement.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GlobeNode } from '@/lib/relay/networkMap'
import { latLngToVec3 } from '@/lib/relay/networkMap'

export interface NetworkGlobeHandle {
  /** Déclenche un arc animé entre deux nœuds (no-op si un nœud est absent). */
  addFlow(fromId: string, toId: string, ok: boolean): void
}

interface NetworkGlobeProps {
  readonly nodes: GlobeNode[]
  /** Hauteur CSS du canvas (px). */
  readonly height?: number
}

const MAX_ARCS = 24
const ARC_LIFE_MS = 2600
const R = 1 // rayon de la sphère

interface Arc {
  createdAt: number
  curve: THREE.QuadraticBezierCurve3
  line: THREE.Line
  dot: THREE.Mesh
}

interface GlobeState {
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  earth: THREE.Group
  arcs: Arc[]
  nodesById: Map<string, GlobeNode>
  arcSeq: number
}

export const NetworkGlobe = forwardRef<NetworkGlobeHandle, NetworkGlobeProps>(function NetworkGlobe(
  { nodes, height = 320 },
  ref,
) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const stateRef = useRef<GlobeState | null>(null)

  const nodesById = useMemo(() => {
    const m = new Map<string, GlobeNode>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  useImperativeHandle(
    ref,
    () => ({
      addFlow(fromId: string, toId: string, ok: boolean) {
        const st = stateRef.current
        if (!st) return
        const from = st.nodesById.get(fromId)
        const to = st.nodesById.get(toId)
        if (!from || !to || fromId === toId) return
        spawnArc(st, from, to, ok)
      },
    }),
    [],
  )

  // ── Montage (une seule fois par changement de hauteur) ─────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return // WebGL indisponible → pas de globe (l'app reste fonctionnelle)
    }
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    renderer.setSize(mount.clientWidth || 300, height, false)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = `${height}px`
    renderer.domElement.style.display = 'block'
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, (mount.clientWidth || 300) / height, 0.1, 100)
    camera.position.set(0, 0.6, 3.2)
    camera.lookAt(0, 0, 0)

    const earth = new THREE.Group()
    scene.add(earth)

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0x0d1424 }),
    )
    earth.add(sphere)
    const grid = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.SphereGeometry(R * 1.003, 24, 16)),
      new THREE.LineBasicMaterial({ color: 0x7578db, transparent: true, opacity: 0.16 }),
    )
    earth.add(grid)

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.08, 48, 32),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: { glowColor: { value: new THREE.Color(0x7578db) } },
        vertexShader: `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 glowColor;
          varying vec3 vNormal;
          void main() {
            float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
            gl_FragColor = vec4(glowColor, 1.0) * intensity * 0.9;
          }`,
      }),
    )
    scene.add(atmo)

    const starCount = 420
    const starPos = new Float32Array(starCount * 3)
    const rv = new THREE.Vector3()
    for (let i = 0; i < starCount; i++) {
      rv.randomDirection().multiplyScalar(6 + Math.random() * 8)
      starPos.set([rv.x, rv.y, rv.z], i * 3)
    }
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0x9aa0ff, size: 0.035, transparent: true, opacity: 0.6 }),
    )
    scene.add(stars)

    const st: GlobeState = { camera, renderer, earth, arcs: [], nodesById: new Map(), arcSeq: 0 }
    stateRef.current = st

    let dragging = false
    let lastX = 0
    let lastY = 0
    let autoRotate = true
    const el = renderer.domElement
    const onDown = (e: PointerEvent) => {
      dragging = true
      autoRotate = false
      lastX = e.clientX
      lastY = e.clientY
      try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      earth.rotation.y += (e.clientX - lastX) * 0.005
      earth.rotation.x = Math.max(-1.2, Math.min(1.2, earth.rotation.x + (e.clientY - lastY) * 0.005))
      lastX = e.clientX
      lastY = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      dragging = false
      try { el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)

    const resize = () => {
      const w = mount.clientWidth
      if (w === 0) return
      camera.aspect = w / height
      camera.updateProjectionMatrix()
      renderer.setSize(w, height, false)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    const clock = new THREE.Clock()
    const camDir = new THREE.Vector3()
    const v = new THREE.Vector3()
    const negCam = new THREE.Vector3()
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta()
      if (autoRotate) earth.rotation.y += dt * 0.06

      const now = performance.now()
      for (let i = st.arcs.length - 1; i >= 0; i--) {
        const a = st.arcs[i]
        const t = (now - a.createdAt) / ARC_LIFE_MS
        if (t >= 1) {
          disposeArc(st, a, i)
          continue
        }
        a.dot.position.copy(a.curve.getPoint(Math.min(1, t)))
        const op = t < 0.15 ? t / 0.15 : 1 - t
        ;(a.line.material as THREE.LineBasicMaterial).opacity = op
        ;(a.dot.material as THREE.MeshBasicMaterial).opacity = op
      }

      camera.getWorldDirection(camDir)
      negCam.copy(camDir).negate()
      const w = mount.clientWidth
      for (const [id, gnode] of st.nodesById) {
        const div = labelRefs.current.get(id)
        if (!div) continue
        const [x, y, z] = latLngToVec3(gnode.lat, gnode.lng, R * 1.02)
        v.set(x, y, z).applyMatrix4(earth.matrixWorld)
        const facing = v.clone().normalize().dot(negCam)
        const proj = v.project(camera)
        div.style.transform = `translate(-50%, -50%) translate(${(proj.x * 0.5 + 0.5) * w}px, ${(-proj.y * 0.5 + 0.5) * height}px)`
        div.style.opacity = facing > 0.1 ? '1' : '0'
      }

      renderer.render(scene, camera)
    })

    return () => {
      renderer.setAnimationLoop(null)
      ro.disconnect()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      for (let i = st.arcs.length - 1; i >= 0; i--) disposeArc(st, st.arcs[i], i)
      sphere.geometry.dispose()
      ;(sphere.material as THREE.Material).dispose()
      grid.geometry.dispose()
      ;(grid.material as THREE.Material).dispose()
      atmo.geometry.dispose()
      ;(atmo.material as THREE.Material).dispose()
      starGeo.dispose()
      ;(stars.material as THREE.Material).dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [height])

  // ── (Re)construction des nœuds à chaque changement de liste ────────────
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    st.nodesById = nodesById
    const old = st.earth.getObjectByName('nodes')
    if (old) {
      st.earth.remove(old)
      old.traverse(o => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose()
        const m = mesh.material as THREE.Material | undefined
        m?.dispose()
      })
    }
    const group = new THREE.Group()
    group.name = 'nodes'
    for (const n of nodes) {
      const [x, y, z] = latLngToVec3(n.lat, n.lng, R * 1.01)
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), new THREE.MeshBasicMaterial({ color: n.color }))
      dot.position.set(x, y, z)
      group.add(dot)
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.038, 12, 12),
        new THREE.MeshBasicMaterial({ color: n.color, transparent: true, opacity: 0.22 }),
      )
      halo.position.set(x, y, z)
      group.add(halo)
    }
    st.earth.add(group)
  }, [nodes, nodesById])

  return (
    <div className="relative w-full" style={{ height }}>
      <div ref={mountRef} className="absolute inset-0" aria-hidden />
      {/* Étiquettes HTML : police et thème de l'app. */}
      <div className="absolute inset-0 pointer-events-none">
        {nodes.map(n => (
          <div
            key={n.id}
            ref={el => {
              if (el) labelRefs.current.set(n.id, el)
              else labelRefs.current.delete(n.id)
            }}
            className="absolute left-0 top-0 whitespace-nowrap text-[10px] font-medium"
            style={{ willChange: 'transform, opacity' }}
          >
            <span
              className="inline-block rounded px-1.5 py-0.5 bg-bg-primary/70 backdrop-blur-sm border border-bg-hover"
              style={{ color: `#${n.color.toString(16).padStart(6, '0')}` }}
            >
              {n.label}
              {n.approx ? ' ≈' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
})

/** Crée un arc animé entre deux nœuds et l'ajoute à la scène. */
function spawnArc(st: GlobeState, from: GlobeNode, to: GlobeNode, ok: boolean): void {
  const a = new THREE.Vector3(...latLngToVec3(from.lat, from.lng, R * 1.01))
  const b = new THREE.Vector3(...latLngToVec3(to.lat, to.lng, R * 1.01))
  const mid = a.clone().add(b).multiplyScalar(0.5)
  if (mid.lengthSq() < 1e-6) mid.set(0, 1, 0)
  mid.normalize().multiplyScalar(R * (1 + Math.min(0.6, a.distanceTo(b) * 0.35)))
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b)
  const color = ok ? 0x7578db : 0xf59e0b
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  )
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 10), new THREE.MeshBasicMaterial({ color, transparent: true }))
  dot.position.copy(a)
  st.earth.add(line)
  st.earth.add(dot)
  st.arcs.push({ createdAt: performance.now(), curve, line, dot })
  while (st.arcs.length > MAX_ARCS) disposeArc(st, st.arcs[0], 0)
}

function disposeArc(st: GlobeState, a: Arc, index: number): void {
  st.earth.remove(a.line, a.dot)
  a.line.geometry.dispose()
  ;(a.line.material as THREE.Material).dispose()
  ;(a.dot.geometry as THREE.BufferGeometry).dispose()
  ;(a.dot.material as THREE.Material).dispose()
  st.arcs.splice(index, 1)
}
