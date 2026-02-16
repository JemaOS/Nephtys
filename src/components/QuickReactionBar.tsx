// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { Plus } from 'lucide-react'

interface QuickReactionBarProps {
  isOpen: boolean
  position: { x: number; y: number }
  onReaction: (emoji: string) => void
  onMoreOptions: () => void
  onClose: () => void
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

export function QuickReactionBar({
  isOpen,
  position,
  onReaction,
  onMoreOptions,
  onClose,
}: QuickReactionBarProps) {
  if (!isOpen) return null

  // Calculate position to keep the bar on screen
  const barWidth = 320 // Approximate width of the bar
  const barHeight = 56 // Approximate height
  
  let left = position.x - barWidth / 2
  let top = position.y - barHeight - 10 // Position above the click point
  
  // Keep within viewport bounds
  if (left < 10) left = 10
  if (left + barWidth > window.innerWidth - 10) {
    left = window.innerWidth - barWidth - 10
  }
  if (top < 10) {
    top = position.y + 10 // Position below if not enough space above
  }

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 z-50 w-full h-full cursor-default"
        onClick={onClose}
        aria-label="Fermer"
      />
      
      {/* Reaction Bar */}
      <div
        className="fixed z-50 bg-[#233138] rounded-full px-3 py-2 shadow-2xl flex items-center gap-1"
        style={{
          left: `${left}px`,
          top: `${top}px`,
        }}
      >
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => {
              onReaction(emoji)
              onClose()
            }}
            className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-[#3b4a54] rounded-full transition-all hover:scale-125 active:scale-95"
          >
            {emoji}
          </button>
        ))}
        
        {/* More options button */}
        <button
          onClick={() => {
            onMoreOptions()
            onClose()
          }}
          className="w-10 h-10 flex items-center justify-center bg-[#3b4a54] hover:bg-[#4a5c68] rounded-full transition-colors"
        >
          <Plus size={20} className="text-[#8696a0]" />
        </button>
      </div>
    </>
  )
}