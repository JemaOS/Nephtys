// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useState } from 'react'
import { Pin, Archive, Trash2, X, Volume2, VolumeX, Edit, ArrowLeft, MoreVertical, CheckSquare } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'

export interface ConversationContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onMarkAsUnread: () => void
  onPin: () => void
  onArchive: () => void
  onMute: () => void
  onClearMessages: () => void
  onDelete: () => void
  onOpenInNewWindow: () => void
  onSelect?: () => void
  isPinned?: boolean
  isMuted?: boolean
}

export function ConversationContextMenu({
  x, y, onClose, onMarkAsUnread, onPin, onArchive, onMute, onClearMessages, onDelete, onOpenInNewWindow, onSelect,
  isPinned = false, isMuted = false
}: ConversationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const menuItems = [
    { icon: Edit, label: 'Marquer comme non lu', onClick: onMarkAsUnread },
    { icon: Pin, label: isPinned ? 'Désépingler' : 'Épingler en haut', onClick: onPin },
    { icon: Archive, label: 'Archiver', onClick: onArchive },
    { icon: isMuted ? Volume2 : VolumeX, label: isMuted ? 'Réactiver le son' : 'Désactiver les notifications', onClick: onMute },
    { icon: Trash2, label: 'Effacer les messages', onClick: onClearMessages, danger: true },
    { icon: X, label: 'Supprimer', onClick: onDelete, danger: true },
    { icon: Edit, label: 'Ouvrir dans une nouvelle fenêtre', onClick: onOpenInNewWindow },
    { icon: X, label: 'Fermer la discussion', onClick: onClose },
    ...(onSelect ? [{ icon: CheckSquare, label: 'Sélectionner', onClick: onSelect }] : []),
  ]

  // Mobile: WhatsApp-style top action bar
  if (isMobile) {
    return (
      <>
        {/* Overlay - tap anywhere to close */}
        <div 
          className="fixed inset-0 z-40 bg-black/20" 
          onClick={onClose}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onClose();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Fermer le menu"
        />
        
        {/* Top Action Bar - WhatsApp style */}
        <div
          ref={menuRef}
          className="fixed top-0 left-0 right-0 z-50 bg-bg-surface border-b border-bg-hover shadow-lg animate-in slide-in-from-top duration-200"
        >
          <div className="flex items-center justify-between h-14 px-2">
            {/* Left side: Back arrow + count */}
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
              >
                <ArrowLeft size={24} className="text-text-primary" />
              </button>
              <span className="text-lg font-medium text-text-primary">1</span>
            </div>
            
            {/* Right side: Action icons */}
            <div className="flex items-center gap-1">
              {/* Pin */}
              <button
                onClick={() => { onPin(); onClose() }}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
                title={isPinned ? 'Désépingler' : 'Épingler'}
              >
                <Pin size={20} className={isPinned ? 'text-accent' : 'text-text-primary'} />
              </button>
              
              {/* Delete */}
              <button
                onClick={() => { onDelete(); onClose() }}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
                title="Supprimer"
              >
                <Trash2 size={20} className="text-text-primary" />
              </button>
              
              {/* Mute */}
              <button
                onClick={() => { onMute(); onClose() }}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
                title={isMuted ? 'Réactiver le son' : 'Désactiver les notifications'}
              >
                {isMuted ? (
                  <Volume2 size={20} className="text-text-primary" />
                ) : (
                  <VolumeX size={20} className="text-text-primary" />
                )}
              </button>
              
              {/* More options menu */}
              <MoreOptionsMenu
                onMarkAsUnread={() => { onMarkAsUnread(); onClose() }}
                onArchive={() => { onArchive(); onClose() }}
                onClearMessages={() => { onClearMessages(); onClose() }}
                onOpenInNewWindow={() => { onOpenInNewWindow(); onClose() }}
              />
            </div>
          </div>
        </div>
      </>
    )
  }

  // Desktop: Traditional context menu
  return (
    <>
      {/* Overlay */}
      <div 
        className="fixed inset-0 z-40" 
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClose();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Fermer le menu"
      />
      
      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[280px] bg-bg-surface rounded-lg shadow-2xl py-2 border border-bg-hover"
        style={{
          left: `${x}px`,
          top: `${y}px`,
        }}
      >
        {menuItems.map((item) => (
          <button
            key={item.label}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className={`w-full px-6 py-3 flex items-center gap-4 hover:bg-bg-hover transition-colors text-left ${
              item.danger ? 'text-[#ea4335]' : 'text-text-primary'
            }`}
          >
            <item.icon size={18} />
            <span className="text-sm">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}

// Sub-component for the "More options" dropdown on mobile
function MoreOptionsMenu({
  onMarkAsUnread,
  onArchive,
  onClearMessages,
  onOpenInNewWindow
}: {
  onMarkAsUnread: () => void
  onArchive: () => void
  onClearMessages: () => void
  onOpenInNewWindow: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const moreItems = [
    { icon: Edit, label: 'Marquer comme non lu', onClick: onMarkAsUnread },
    { icon: Archive, label: 'Archiver', onClick: onArchive },
    { icon: Trash2, label: 'Effacer les messages', onClick: onClearMessages, danger: true },
    { icon: Edit, label: 'Ouvrir dans une nouvelle fenêtre', onClick: onOpenInNewWindow },
  ]

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
        title="Plus d'options"
      >
        <MoreVertical size={20} className="text-text-primary" />
      </button>
      
      {isOpen && (
        <div className="absolute right-0 top-12 z-50 min-w-[220px] bg-bg-surface rounded-lg shadow-2xl py-2 border border-bg-hover">
          {moreItems.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
              className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-bg-hover transition-colors text-left ${
                item.danger ? 'text-[#ea4335]' : 'text-text-primary'
              }`}
            >
              <item.icon size={18} />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}