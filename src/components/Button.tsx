// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface ButtonProps {
  readonly children: ReactNode
  readonly onClick?: () => void
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly size?: 'sm' | 'md' | 'lg'
  readonly disabled?: boolean
  readonly loading?: boolean
  readonly className?: string
  readonly type?: 'button' | 'submit'
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  className,
  type = 'button',
}: ButtonProps) {
  const baseStyles = 'rounded-md font-semibold transition-all duration-fast flex items-center justify-center gap-2'
  
  const variants = {
    primary: 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-glass-md hover:brightness-110 hover:shadow-glow-primary active:scale-95',
    secondary: 'bg-glass-surface-light backdrop-blur-[20px] border border-glass-border text-primary-500 shadow-glass-sm hover:bg-opacity-60 active:scale-95',
    ghost: 'bg-transparent text-text-primary hover:bg-[rgba(255,255,255,0.3)] active:scale-95',
  }
  
  const sizes = {
    sm: 'px-4 py-2 text-sm h-10',
    md: 'px-6 py-3 text-base h-12',
    lg: 'px-8 py-4 text-lg h-14',
  }
  
  const disabledStyles = 'opacity-40 cursor-not-allowed hover:brightness-100 hover:shadow-none active:scale-100'
  
  return (
    <button
      type={type}
      className={cn(
        baseStyles,
        variants[variant],
        sizes[size],
        (disabled || loading) && disabledStyles,
        className
      )}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading && <Loader2 className="w-5 h-5 animate-spin" />}
      {children}
    </button>
  )
}
