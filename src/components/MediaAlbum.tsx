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

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden bg-bg-hover cursor-pointer ${className || ''}`}
      aria-label="Afficher le média"
    >
      {loading || !url ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a]">
          <div className="w-7 h-7 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      ) : isVideo ? (
        <>
          <video
            src={`${url}#t=0.1`}
            className="w-full h-full object-cover"
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
          className="w-full h-full object-cover"
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

  if (count === 2) {
    grid = (
      <div className="grid grid-cols-2 gap-0.5 w-full h-[220px]">
        {renderItem(displayed[0])}
        {renderItem(displayed[1])}
      </div>
    );
  } else if (count === 3) {
    grid = (
      <div className="grid grid-cols-2 gap-0.5 w-full h-[260px]">
        {renderItem(displayed[0], { className: 'row-span-2 h-full' })}
        <div className="grid grid-rows-2 gap-0.5 h-full">
          {renderItem(displayed[1])}
          {renderItem(displayed[2])}
        </div>
      </div>
    );
  } else {
    // 4+ : grille 2x2 carrée, +N sur la dernière si plus de 4
    grid = (
      <div className="grid grid-cols-2 grid-rows-2 gap-0.5 w-full h-[280px]">
        {renderItem(displayed[0])}
        {renderItem(displayed[1])}
        {renderItem(displayed[2])}
        {renderItem(displayed[3], { overlay: remaining })}
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
      <div className="relative w-[300px] sm:w-[330px] max-w-full rounded-xl overflow-hidden border-[3px] border-[#787add] group bg-transparent">
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
