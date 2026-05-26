// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { X, Image as ImageIcon, FileVideo, Sticker, FileText } from 'lucide-react';
import { useDecryptedMedia } from '@/hooks/useDecryptedMedia';
import { useMediaUrl } from '@/hooks/useMediaUrl';
import { useAuth } from '@/context/AuthContext';

/**
 * Affiche une miniature pour un media. Stratégie progressive :
 *  1. data URL → affichage direct
 *  2. path bucket → URL signée via useMediaUrl
 *  3. si l'<img> échoue (octets chiffrés ?) → fallback vers décryption E2EE
 *
 * Beaucoup d'anciens messages ont is_media_encrypted=null en DB mais sont
 * en réalité chiffrés. Le fallback onError les rattrape automatiquement.
 */
const PlainReplyThumbnail: React.FC<{ messageId: string; src: string }> = ({
  messageId,
  src,
}) => {
  const [imgError, setImgError] = React.useState(false);
  const isDataOrHttp = src.startsWith('data:') || src.startsWith('http');
  const { url, loading } = useMediaUrl(isDataOrHttp ? null : src);
  const finalSrc = isDataOrHttp ? src : url;

  React.useEffect(() => {
    console.log('[ReplyThumb-P]', {
      srcPrefix: src.substring(0, 60),
      isDataOrHttp,
      hasFinalSrc: !!finalSrc,
      loading,
      imgError,
    });
  }, [src, isDataOrHttp, finalSrc, loading, imgError]);

  // Si l'image en clair échoue, on tente la décryption E2EE.
  if (imgError && !isDataOrHttp) {
    return <EncryptedReplyThumbnail messageId={messageId} src={src} />;
  }

  if (!isDataOrHttp && loading && !finalSrc) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/20">
        <div className="w-4 h-4 border-2 border-[#787add]/40 border-t-[#787add] rounded-full animate-spin" />
      </div>
    );
  }

  if (!finalSrc) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/20">
        <ImageIcon size={16} className="text-text-secondary" />
      </div>
    );
  }

  return (
    <img
      src={finalSrc}
      alt="Aperçu"
      className="h-full w-full object-cover"
      onError={() => setImgError(true)}
    />
  );
};

interface MessageReplyProps {
  replyToMessage: {
    id: string;
    content: string;
    sender_id: string;
    senderName?: string;
    mediaUrl?: string | null;
    mediaType?: string | null;
    fileName?: string | null;
    /** Si true, le média est chiffré E2EE et nécessite un déchiffrement pour la miniature */
    isEncrypted?: boolean;
    /** URL source du média chiffré (path storage) */
    encryptedSrc?: string | null;
  } | null;
  onCancel?: () => void;
  onClick?: () => void;
  isPreview?: boolean; // true = dans la barre d'input, false = dans le message
}

/**
 * Miniature déchiffrée pour les médias E2EE dans les citations de réponse.
 * Utilise useDecryptedMedia pour obtenir un blob URL affichable.
 */
const EncryptedReplyThumbnail: React.FC<{
  messageId: string;
  src: string;
}> = ({ messageId, src }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const { url, loading, error } = useDecryptedMedia({
    encrypted: true,
    messageId,
    userId,
    src,
  });

  React.useEffect(() => {
    console.log('[ReplyThumb-E]', { messageId, userId, hasUrl: !!url, loading, error: error?.toString() });
  }, [messageId, userId, url, loading, error]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/20">
        <div className="w-4 h-4 border-2 border-[#787add]/40 border-t-[#787add] rounded-full animate-spin" />
      </div>
    );
  }

  if (!url) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/20">
        <ImageIcon size={16} className="text-text-secondary" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt="Thumbnail"
      className="h-full w-full object-cover"
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
};

export const MessageReply: React.FC<MessageReplyProps> = ({
  replyToMessage,
  onCancel,
  onClick,
  isPreview = false,
}) => {
  if (!replyToMessage) return null;

  const truncateText = (text: string, maxLength: number = 100) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  // Detect media type and content
  let displayContent = replyToMessage.content;
  let mediaUrl = replyToMessage.mediaUrl;
  let mediaType = replyToMessage.mediaType;
  let Icon = null;
  let typeLabel = '';

  // Check for GIF/Sticker in content (Markdown format)
  // Avoid catastrophic backtracking by checking suffix first
  const gifSuffixRegex = /\[GIF\]\((https?:\/\/[^)]+)\)$/;
  const stickerSuffixRegex = /\[STICKER\]\((https?:\/\/[^)]+)\)$/;
  
  let gifMatch = null;
  let stickerMatch = null;

  if (replyToMessage.content) {
    const gifSuffixMatch = replyToMessage.content.match(gifSuffixRegex);
    if (gifSuffixMatch) {
      const url = gifSuffixMatch[1];
      const contentBefore = replyToMessage.content.substring(0, gifSuffixMatch.index);
      // Remove optional prefix
      const cleanContent = contentBefore.replace(/^(?:\[Transféré\]\s*)?/, '');
      gifMatch = [replyToMessage.content, cleanContent, url];
    }

    const stickerSuffixMatch = replyToMessage.content.match(stickerSuffixRegex);
    if (stickerSuffixMatch) {
      const url = stickerSuffixMatch[1];
      const contentBefore = replyToMessage.content.substring(0, stickerSuffixMatch.index);
      // Remove optional prefix
      const cleanContent = contentBefore.replace(/^(?:\[Transféré\]\s*)?/, '');
      stickerMatch = [replyToMessage.content, cleanContent, url];
    }
  }

  if (gifMatch) {
    displayContent = gifMatch[1] || ''; // Caption or empty
    mediaUrl = gifMatch[2];
    mediaType = 'gif';
    Icon = ImageIcon; // Or a specific GIF icon if available
    typeLabel = 'GIF';
  } else if (stickerMatch) {
    displayContent = stickerMatch[1] || '';
    mediaUrl = stickerMatch[2];
    mediaType = 'sticker';
    Icon = Sticker;
    typeLabel = 'Sticker';
  } else if (mediaType === 'image') {
    Icon = ImageIcon;
    typeLabel = 'Photo';
  } else if (mediaType === 'video') {
    Icon = FileVideo;
    typeLabel = 'Vidéo';
  } else if (mediaType === 'file') {
    Icon = FileText;
    typeLabel = replyToMessage.fileName || 'Fichier';
  }

  // Determine what text to display
  const getDisplayText = (): string => {
    if (displayContent) {
      return truncateText(displayContent, isPreview ? 100 : 150);
    }
    return typeLabel;
  };
  
  const renderContent = () => (
    <div className="flex items-stretch">
      {/* Left accent border - Theme color */}
      <div className="w-1 bg-accent flex-shrink-0" />
      
      {/* Content */}
      <div className="flex-1 min-w-0 px-3 py-2 flex justify-between items-center">
        <div className="flex-1 min-w-0 mr-2">
          <div className={`text-sm font-medium text-primary-300 mb-0.5 ${isPreview ? '' : 'text-xs font-semibold'}`}>
            {replyToMessage.senderName || 'Utilisateur'}
          </div>
          <div className={`text-sm truncate flex items-center gap-1.5 ${isPreview ? 'text-text-secondary' : 'text-text-primary/80'}`}>
            {Icon && (
              <Icon size={16} className="flex-shrink-0" />
            )}
            <span className="truncate">
              {getDisplayText()}
            </span>
          </div>
        </div>

        {/* Thumbnail for images/GIFs/Stickers/Videos.
            Affiche systématiquement si on a un mediaUrl OU si le média est
            chiffré (on tente alors la décryption). On retire la dépendance
            au flag is_media_encrypted (parfois absent en DB) en utilisant
            simplement la présence d'un encryptedSrc. */}
        {(mediaUrl || replyToMessage.encryptedSrc) && (mediaType === 'image' || mediaType === 'gif' || mediaType === 'sticker' || mediaType === 'video') && (
          <div className="h-10 w-10 rounded overflow-hidden flex-shrink-0 bg-black/5 border border-white/10 ml-2">
            {mediaType === 'video' ? (
              <div className="w-full h-full flex items-center justify-center bg-black/20">
                <FileVideo size={20} className="text-text-secondary" />
              </div>
            ) : mediaUrl ? (
              <PlainReplyThumbnail messageId={replyToMessage.id} src={mediaUrl} />
            ) : replyToMessage.encryptedSrc ? (
              <EncryptedReplyThumbnail
                messageId={replyToMessage.id}
                src={replyToMessage.encryptedSrc}
              />
            ) : null}
          </div>
        )}
      </div>
      
      {/* Close button (only for preview) */}
      {isPreview && onCancel && (
        <button
          onClick={onCancel}
          className="px-3 flex items-center justify-center hover:bg-bg-surface/50 transition-colors flex-shrink-0 border-l border-white/5"
          aria-label="Annuler la réponse"
        >
          <X size={20} className="text-text-secondary" />
        </button>
      )}
    </div>
  );

  if (isPreview) {
    // Affichage dans la barre d'input (avant d'envoyer) - Style JemaOS
    return (
      <div className="mb-2 mx-1 bg-bg-hover rounded-xl overflow-hidden shadow-sm border border-white/5">
        {renderContent()}
      </div>
    );
  }

  // Affichage dans le message (citation) - Style JemaOS
  return (
    <button
      type="button"
      className="mb-2 rounded-lg overflow-hidden bg-black/20 border-l-0 cursor-pointer hover:opacity-80 transition-opacity w-full text-left"
      onClick={onClick}
    >
      {renderContent()}
    </button>
  );
};
