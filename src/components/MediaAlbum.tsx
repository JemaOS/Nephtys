// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React, { useState } from 'react';
import { Play } from 'lucide-react';
import type { Message } from '@/lib/supabase';
import { MediaViewer } from './MediaViewer';
import { useDecryptedMedia } from '@/hooks/useDecryptedMedia';
import { MessageHoverActions } from './MessageHoverActions';
import { MediaTimestampOverlay } from './MediaMessageComponents';

interface AlbumItemProps {
  message: Message;
  currentUserId?: string;
  onClick: () => void;
  isVideo: boolean;
  className?: string;
  showOverlayCount?: number;
}

const AlbumItem: React.FC<AlbumItemProps> = ({
  message, currentUserId, onClick, isVideo, className, showOverlayCount,
}) => {
  const src = message.media_url || message.file_url || '';
  const { url, loading } = useDecryptedMedia({
    encrypted: !!(message as any).is_media_encrypted,
    messageId: message.id,
    userId: currentUserId,
    src,
  });

  // Le button doit toujours occuper toute la cellule flex. On s'assure que
  // height:100% est défini via style inline pour ne pas dépendre du parsing
  // Tailwind (qui peut ignorer h-full si le parent n'a pas de hauteur résolue
  // lors du premier paint).
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden bg-[#1a1a1a] cursor-pointer block p-0 m-0 border-0 ${className || ''}`}
      style={{ width: '100%', height: '100%' }}
      aria-label="Afficher le média"
    >
      {/* Fond sombre toujours visible — évite le fond blanc natif du browser */}
      <div className="absolute inset-0 bg-[#1a1a1a]" />

      {loading || !url ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      ) : isVideo ? (
        <>
          <video
            src={`${url}#t=0.1`}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center backdrop-blur-sm">
              <Play size={22} className="text-white ml-0.5" fill="white" />
            </div>
          </div>
        </>
      ) : (
        <img
          src={url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
      {showOverlayCount !== undefined && showOverlayCount > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <span className="text-white text-3xl font-semibold drop-shadow-lg">
            +{showOverlayCount}
          </span>
        </div>
      )}
    </button>
  );
};

interface MediaAlbumProps {
  /** Tous les messages de l'album (au moins 2). Le premier est le "leader". */
  messages: Message[];
  currentUserId?: string;
  isOwn: boolean;
  showHoverActions: boolean;
  onOpenMenu?: (e: React.MouseEvent) => void;
  onForward?: () => void;
  onStar?: () => void;
  onPin?: () => void;
  onReaction?: (emoji: string) => void;
  isStarred?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  senderName?: string;
  senderAvatar?: string;
  /** Tous les médias de la conversation pour la navigation viewer */
  allMedia?: Array<{
    url: string;
    type: 'image' | 'video' | 'audio' | 'gif' | 'sticker';
    senderName: string;
    senderAvatar?: string;
    timestamp: string;
    isOwn: boolean;
    messageId: string;
  }>;
  getMediaIndexForMessage?: (messageId: string) => number;
}

/**
 * Affiche plusieurs images/vidéos en mosaïque WhatsApp-like.
 * - 2 médias : 2 colonnes
 * - 3 médias : 1 grand à gauche + 2 à droite
 * - 4 médias : grille 2x2
 * - 5+      : grille 2x2 avec +N sur la 4e
 */
export const MediaAlbum: React.FC<MediaAlbumProps> = ({
  messages,
  currentUserId,
  isOwn,
  showHoverActions,
  onOpenMenu,
  onForward,
  onStar,
  onPin,
  onReaction,
  isStarred = false,
  status,
  senderName = 'Utilisateur',
  senderAvatar,
  allMedia,
  getMediaIndexForMessage,
}) => {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerStartMessageId, setViewerStartMessageId] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const count = messages.length;
  const displayed = count > 4 ? messages.slice(0, 4) : messages;
  const remaining = count > 4 ? count - 4 : 0;

  const handleClick = (msg: Message) => {
    setViewerStartMessageId(msg.id);
    const idx = getMediaIndexForMessage?.(msg.id) ?? 0;
    setViewerIndex(Math.max(0, idx));
    setViewerOpen(true);
  };

  const closeViewer = () => {
    setViewerOpen(false);
    setViewerStartMessageId(null);
  };

  // Detect if any media is encrypted: si oui, on désactive la nav fullscreen
  // multi-fichiers (le viewer ne sait pas déchiffrer les autres entrées).
  const anyEncrypted = messages.some((m) => !!(m as any).is_media_encrypted);

  const isVideoMsg = (m: Message) => m.type === 'video' || m.media_type === 'video';

  // Calcul timestamp/status à afficher (overlay sur dernière tuile)
  const lastMsg = messages[messages.length - 1];

  const renderItem = (msg: Message, opts?: { className?: string; overlay?: number }) => (
    <AlbumItem
      key={msg.id}
      message={msg}
      currentUserId={currentUserId}
      onClick={() => handleClick(msg)}
      isVideo={isVideoMsg(msg)}
      className={opts?.className}
      showOverlayCount={opts?.overlay}
    />
  );

  let grid: React.ReactNode = null;

  // Helper : cellule flex dont les enfants héritent bien de 100% de hauteur.
  // `min-h-0` est requis pour que flex-children puissent être plus petits que
  // leur contenu et prennent la hauteur de leur conteneur.
  const cell = (child: React.ReactNode, extra = '') => (
    <div className={`relative min-h-0 overflow-hidden ${extra}`} style={{ height: '100%' }}>
      {child}
    </div>
  );

  if (count === 2) {
    grid = (
      <div className="flex gap-[2px] w-full" style={{ height: '165px' }}>
        <div className="flex-1 min-h-0" style={{ height: '100%' }}>
          {cell(renderItem(displayed[0]))}
        </div>
        <div className="flex-1 min-h-0" style={{ height: '100%' }}>
          {cell(renderItem(displayed[1]))}
        </div>
      </div>
    );
  } else if (count === 3) {
    grid = (
      <div className="flex gap-[2px] w-full" style={{ height: '220px' }}>
        <div style={{ flex: '2', minHeight: 0, height: '100%' }}>
          {cell(renderItem(displayed[0]), 'h-full')}
        </div>
        <div style={{ flex: '1', minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ flex: 1, minHeight: 0 }}>{cell(renderItem(displayed[1]))}</div>
          <div style={{ flex: 1, minHeight: 0 }}>{cell(renderItem(displayed[2]))}</div>
        </div>
      </div>
    );
  } else {
    // 4+ : grille 2x2
    grid = (
      <div className="flex flex-col gap-[2px] w-full" style={{ height: '330px' }}>
        <div className="flex gap-[2px]" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, height: '100%' }}>{cell(renderItem(displayed[0]))}</div>
          <div style={{ flex: 1, minHeight: 0, height: '100%' }}>{cell(renderItem(displayed[1]))}</div>
        </div>
        <div className="flex gap-[2px]" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, height: '100%' }}>{cell(renderItem(displayed[2]))}</div>
          <div style={{ flex: 1, minHeight: 0, height: '100%' }}>{cell(renderItem(displayed[3], { overlay: remaining }))}</div>
        </div>
      </div>
    );
  }

  // Récupérer infos du média ciblé par viewerStartMessageId pour fallback
  const startMsg = messages.find((m) => m.id === viewerStartMessageId) || messages[0];
  const startSrc = startMsg.media_url || startMsg.file_url || '';
  const { url: startUrl } = useDecryptedMedia({
    encrypted: !!(startMsg as any).is_media_encrypted,
    messageId: startMsg.id,
    userId: currentUserId,
    src: startSrc,
  });

  return (
    <>
      <div
        className="relative rounded-xl overflow-hidden border-[3px] border-[#787add] group bg-transparent"
        style={{ width: '330px', maxWidth: '100%' }}
      >
        {onOpenMenu && (
          <MessageHoverActions
            isVisible={showHoverActions}
            isOwn={isOwn}
            onOpenMenu={onOpenMenu}
          />
        )}
        {grid}
        <MediaTimestampOverlay
          timestamp={lastMsg.created_at}
          status={status}
          isOwn={isOwn}
        />
      </div>
      {messages[0].content && (
        <p className="mt-1.5 text-sm whitespace-pre-wrap break-words">{messages[0].content}</p>
      )}

      {viewerOpen && (
        <MediaViewer
          isOpen={viewerOpen}
          mediaUrl={startUrl || startSrc}
          mediaType={isVideoMsg(startMsg) ? 'video' : 'image'}
          senderName={senderName}
          senderAvatar={senderAvatar}
          timestamp={startMsg.created_at}
          isOwn={isOwn}
          isStarred={isStarred}
          onClose={closeViewer}
          onForward={onForward ? () => { closeViewer(); onForward(); } : undefined}
          onStar={onStar}
          onPin={onPin}
          onReaction={onReaction}
          allMedia={anyEncrypted ? undefined : allMedia}
          currentIndex={anyEncrypted ? 0 : viewerIndex}
          onNavigate={anyEncrypted ? undefined : (idx) => setViewerIndex(idx)}
        />
      )}
    </>
  );
};
