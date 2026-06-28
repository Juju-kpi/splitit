// src/app/layout.tsx
import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'SplitIt — Partagez vos dépenses',
  description: 'Partagez vos dépenses entre amis avec scan OCR et remboursements automatiques',
  manifest: '/manifest.json',
  themeColor: '#0C0C0F',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body className="bg-bg text-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
