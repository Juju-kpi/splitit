// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

// Geist pour le texte, Geist Mono pour les montants. next/font les sert
// depuis notre domaine : pas de requete vers Google au chargement.
const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-geist',
  display: 'swap',
})
const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Splitit — Partagez vos dépenses',
  description: 'Partagez vos dépenses entre amis avec scan OCR et remboursements automatiques',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Splitit',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#08090C',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body className="bg-bg text-text antialiased font-sans">
        <Providers>{children}</Providers>
        {/* Enregistrement du service worker pour les notifications push web */}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').catch(function(err) {
                console.warn('[SW] Registration failed:', err);
              });
            });
          }
        `}} />
      </body>
    </html>
  )
}
