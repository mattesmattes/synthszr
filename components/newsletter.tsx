"use client"

import type React from "react"

import { useState } from "react"

export function Newsletter() {
  const [email, setEmail] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    console.log("Newsletter subscription:", email)
    setEmail("")
  }

  return (
    <section className="mt-20 border-t border-border pt-16">
      <div className="mx-auto max-w-2xl">
        <h2 className="font-mono text-2xl font-bold md:text-lg">Stay Updated</h2>
        <p className="mt-4 text-muted-foreground">
          Get notified about new articles, projects, and experiments. No spam, unsubscribe anytime.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            className="flex-1 rounded-sm border border-border bg-background px-4 py-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="submit"
            className="rounded-sm bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Subscribe
          </button>
        </form>
      </div>
    </section>
  )
}
