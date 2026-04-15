import type { Metadata } from "next"
import { IBM_Plex_Sans, IBM_Plex_Mono, Space_Grotesk, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
})

const spaceGrotesk = Space_Grotesk({
  variable: "--font-head",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  preload: false,
})

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
})

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono-alt",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  preload: false,
})

export const metadata: Metadata = {
  title: "Conductor — AI Agent Orchestration Platform",
  description: "Orchestrate AI agents with workflow chains, automated dispatch, and human verification gates.",
  keywords: ["Conductor", "agent orchestration", "workflow chains", "AI agents", "Task management", "Kanban board", "AI workflow", "Next.js"],
  authors: [{ name: "Conductor Team" }],
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
  },
  openGraph: {
    title: "Conductor — AI Agent Orchestration Platform",
    description: "Orchestrate AI agents with workflow chains, automated dispatch, and human verification gates.",
    url: "https://agentboard.app",
    siteName: "Conductor",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Conductor — AI Agent Orchestration Platform",
    description: "Orchestrate AI agents with workflow chains, automated dispatch, and human verification gates.",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${ibmPlexSans.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${ibmPlexMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  )
}
