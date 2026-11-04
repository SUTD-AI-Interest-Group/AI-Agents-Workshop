import type { Metadata } from 'next'
import { Anton, Geist, Geist_Mono } from 'next/font/google'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import './globals.css'

// next/font hashes family names, so fonts are wired through these variables (see app/tokens.css).
const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
const anton = Anton({ subsets: ['latin'], weight: '400', variable: '--font-anton' })

export const metadata: Metadata = {
  title: 'AI Agents · Design Thinking Canvas',
  description: 'Shared canvas for the SUTD AI Agents Workshop',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable, geistMono.variable, anton.variable)}>
      <body className="bg-background text-foreground antialiased">
        <TooltipProvider delay={600}>{children}</TooltipProvider>
      </body>
    </html>
  )
}
