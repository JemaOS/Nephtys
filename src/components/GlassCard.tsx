// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface GlassCardProps {
  readonly children: ReactNode
  readonly className?: string
  readonly onClick?: () => void
  readonly hover?: boolean
}

export function GlassCard({ children, className, onClick, hover = false }: GlassCardProps) {
  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      className={cn(
        'bg-glass-surface-light backdrop-blur-[30px] border border-glass-border rounded-lg p-8 shadow-glass-md transition-all duration-slow',
        hover && 'hover:bg-opacity-60 hover:backdrop-blur-[35px] hover:shadow-glass-lg cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </Component>
  )
}
