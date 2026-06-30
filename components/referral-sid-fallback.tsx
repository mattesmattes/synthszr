"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/** Wenn die Referral-Seite ohne ?sid geöffnet wird (z.B. über den Web-Tip-Promo),
 *  die beim Anmelden gespeicherte Subscriber-ID aus localStorage nachreichen. */
export function ReferralSidFallback() {
  const router = useRouter()
  useEffect(() => {
    try {
      const sid = localStorage.getItem("synthszr_sid")
      if (sid) router.replace(`?sid=${encodeURIComponent(sid)}`)
    } catch {}
  }, [router])
  return null
}
