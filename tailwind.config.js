/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: ['class'],
	content: [
		'./pages/**/*.{ts,tsx}',
		'./components/**/*.{ts,tsx}',
		'./app/**/*.{ts,tsx}',
		'./src/**/*.{ts,tsx}',
	],
	theme: {
		container: {
			center: true,
			padding: '1rem',
			screens: {
				'2xl': '1400px',
			},
		},
		extend: {
			colors: {
				// Couleurs utilisant les variables CSS
				'bg-primary': 'var(--bg-primary)',
				'bg-secondary': 'var(--bg-secondary)',
				'bg-surface': 'var(--bg-surface)',
				'bg-hover': 'var(--bg-hover)',
				'text-primary': 'var(--text-primary)',
				'text-secondary': 'var(--text-secondary)',
				'text-tertiary': 'var(--text-tertiary)',
				'accent': 'var(--accent)',
				
				// Mapping des anciennes couleurs hardcodées vers les variables
				// Fond principal sombre (#0b141a) -> bg-primary
				'jemaos-dark': 'var(--bg-primary)',
				// Fond secondaire sombre (#111b21) -> bg-secondary
				'jemaos-darker': 'var(--bg-secondary)',
				// Surfaces (#202c33) -> bg-surface
				'jemaos-surface': 'var(--bg-surface)',
				// Hover (#2a3942) -> bg-hover
				'jemaos-hover': 'var(--bg-hover)',
				// Texte clair (#e9edef) -> text-primary
				'jemaos-text': 'var(--text-primary)',
				// Texte secondaire (#8696a0) -> text-secondary
				'jemaos-text-secondary': 'var(--text-secondary)',
				// Accent violet
				'jemaos-accent': 'var(--accent)',
				
				// Primary - Violet Nephtys (conservé pour compatibilité)
				primary: {
					100: '#d4d5f7',
					300: '#9fa1eb',
					400: '#8385e3',
					500: '#6b6fdb',
					600: '#5558c9',
				},
				// Glassmorphism surfaces (dark theme)
				glass: {
					'bg-start': '#0b141a',
					'bg-end': '#111b21',
					'surface-light': 'rgba(32,44,51,0.95)',
					'surface-medium': 'rgba(42,57,66,0.9)',
					border: 'rgba(255,255,255,0.1)',
				},
				// Semantic colors (conservé pour compatibilité)
				success: {
					500: '#00D9A3',
					glow: '#00FFB3',
				},
				warning: {
					500: '#FFB020',
				},
				danger: {
					500: '#FF4757',
				},
				info: {
					500: '#4C9AFF',
				},
			},
			fontFamily: {
				sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'Inter', 'system-ui', 'sans-serif'],
				mono: ['SF Mono', 'Consolas', 'Monaco', 'monospace'],
			},
			fontSize: {
				xs: ['12px', '16px'],
				sm: ['14px', '20px'],
				base: ['16px', '24px'],
				lg: ['20px', '28px'],
				xl: ['24px', '32px'],
				'2xl': ['32px', '40px'],
			},
			fontWeight: {
				regular: '400',
				medium: '500',
				semibold: '600',
				bold: '700',
			},
			padding: {
				'safe': 'env(safe-area-inset-bottom)',
			},
			spacing: {
				'1': '4px',
				'2': '8px',
				'3': '12px',
				'4': '16px',
				'6': '24px',
				'8': '32px',
				'12': '48px',
				'16': '64px',
				'24': '96px',
			},
			borderRadius: {
				sm: '8px',
				md: '12px',
				lg: '16px',
				xl: '24px',
				'2xl': '32px',
				full: '9999px',
			},
			boxShadow: {
				'glass-sm': '0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
				'glass-md': '0 4px 16px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.08)',
				'glass-lg': '0 8px 32px rgba(0,0,0,0.08), 0 4px 8px rgba(0,0,0,0.10)',
				'glass-xl': '0 16px 48px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.14)',
				'glow-success': '0 0 16px rgba(0,255,179,0.4)',
				'glow-primary': '0 0 24px rgba(107,111,219,0.3)',
			},
			backdropBlur: {
				light: '20px',
				medium: '30px',
				heavy: '40px',
			},
			transitionDuration: {
				instant: '100ms',
				fast: '200ms',
				normal: '300ms',
				slow: '400ms',
				slower: '600ms',
			},
			transitionTimingFunction: {
				'ease-natural': 'cubic-bezier(0.16, 1, 0.3, 1)',
				'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
			},
			keyframes: {
				'fade-in': {
					from: { opacity: '0' },
					to: { opacity: '1' },
				},
				'slide-up': {
					from: { transform: 'translateY(100%)' },
					to: { transform: 'translateY(0)' },
				},
				'slide-down': {
					from: { transform: 'translateY(-100%)' },
					to: { transform: 'translateY(0)' },
				},
				'scale-in': {
					from: { transform: 'scale(0.9)', opacity: '0' },
					to: { transform: 'scale(1)', opacity: '1' },
				},
			},
			animation: {
				'fade-in': 'fade-in 300ms ease-out',
				'slide-up': 'slide-up 400ms cubic-bezier(0.16, 1, 0.3, 1)',
				'slide-down': 'slide-down 400ms cubic-bezier(0.16, 1, 0.3, 1)',
				'scale-in': 'scale-in 400ms cubic-bezier(0.16, 1, 0.3, 1)',
			},
		},
	},
	plugins: [require('tailwindcss-animate')],
}
