import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Design Thinking Canvas',
  description: 'Shared canvas for the SUTD AI Agents Workshop',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable, geistMono.variable)}>
      <body className="bg-background text-foreground antialiased">
        <TooltipProvider delay={600}>{children}</TooltipProvider>
      </body>
    </html>
  )
}
