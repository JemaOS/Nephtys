// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface GlassCardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
  hover?: boolean
}

export function GlassCard({ children, className, onClick, hover = false }: GlassCardProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={cn(
        'bg-glass-surface-light backdrop-blur-[30px] border border-glass-border rounded-lg p-8 shadow-glass-md transition-all duration-slow',
        hover && 'hover:bg-opacity-60 hover:backdrop-blur-[35px] hover:shadow-glass-lg cursor-pointer',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : -1}
      onKeyDown={onClick ? handleKeyDown : undefined}
    >
      {children}
    </div>
  )
}
