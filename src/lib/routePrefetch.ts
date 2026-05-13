// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Préfetch des bundles de routes lazy-loaded au hover/touch d'un lien
 * de navigation. Quand l'utilisateur hover sur "Discussions", le chunk
 * `ChatsPage` se télécharge en arrière-plan, donc au clic réel le code
 * est déjà parsé → navigation instantanée (~0ms vs ~500ms sur 3G).
 *
 * Usage :
 *   <button onMouseEnter={() => prefetchRoute('/chats')} onClick={...}>
 *
 * Chaque route n'est préfetchée qu'une seule fois (cache via Set).
 */

const prefetchedRoutes = new Set<string>()

const routeImporters: Record<string, () => Promise<unknown>> = {
  '/chats': () => import('@/pages/ChatsPage'),
  '/contacts': () => import('@/pages/ContactsPage'),
  '/groups': () => import('@/pages/GroupsPage'),
  '/calls': () => import('@/pages/CallsPage'),
  '/archived': () => import('@/pages/ArchivedPage'),
  '/settings': () => import('@/pages/SettingsPage'),
}

export function prefetchRoute(path: string): void {
  // Match préfixe : /chats/abc → /chats
  const matchKey = Object.keys(routeImporters).find(p => path.startsWith(p))
  if (!matchKey || prefetchedRoutes.has(matchKey)) return
  prefetchedRoutes.add(matchKey)
  // Fire-and-forget. Les erreurs de chunk loading remonteront naturellement
  // au moment du vrai navigate() via le ErrorBoundary du Suspense.
  routeImporters[matchKey]().catch(() => {
    // Si le préfetch échoue (offline), on retire de la liste pour réessayer
    prefetchedRoutes.delete(matchKey)
  })
}

/**
 * Préfetch ChatViewPage qui est dans le même chunk de pages mais souvent
 * cible de navigation depuis ChatsPage. À appeler sur hover d'une row de
 * conversation.
 */
export function prefetchChatView(): void {
  const key = '__chatview__'
  if (prefetchedRoutes.has(key)) return
  prefetchedRoutes.add(key)
  import('@/pages/ChatViewPage').catch(() => {
    prefetchedRoutes.delete(key)
  })
}
