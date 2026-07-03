'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * E-1: client island for the help route's "Back to Board" action.
 * The guide content itself is server-rendered; only this button ships JS.
 */
export function HelpBackButton() {
  const router = useRouter()
  return (
    <Button variant="outline" size="sm" onClick={() => router.push('/board')} className="h-8">
      <ArrowLeft className="h-3.5 w-3.5 mr-1" />
      Back to Board
    </Button>
  )
}
