import { useEffect, useRef } from 'react'
import { Pin, Archive, Trash2, X, Volume2, VolumeX, Edit } from 'lucide-react'

interface ConversationContextMenuProps {
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
  isPinned?: boolean
  isMuted?: boolean
}

export function ConversationContextMenu({
  x, y, onClose, onMarkAsUnread, onPin, onArchive, onMute, onClearMessages, onDelete, onOpenInNewWindow,
  isPinned = false, isMuted = false
}: ConversationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

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
  ]

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      
      {/* Menu */}
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[280px] bg-bg-surface rounded-lg shadow-2xl py-2 border border-bg-hover"
        style={{
          left: `${x}px`,
          top: `${y}px`,
        }}
      >
        {menuItems.map((item, idx) => (
          <button
            key={idx}
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