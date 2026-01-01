"use client"

import { useState } from "react"

export function BlogHeader() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <a href="/" className="font-mono text-xl font-bold tracking-tight">
          S/
        </a>

        <div className="hidden items-center gap-8 md:flex">
          <a href="#" className="text-sm hover:text-accent transition-colors">
            Articles
          </a>
          <a href="#" className="text-sm hover:text-accent transition-colors">
            Projects
          </a>
          <a href="#" className="text-sm hover:text-accent transition-colors">
            About
          </a>
          <button className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            Subscribe
          </button>
        </div>

        <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          <svg
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {menuOpen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </nav>

      {menuOpen && (
        <div className="border-t border-border bg-background px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            <a href="#" className="text-sm hover:text-accent transition-colors">
              Articles
            </a>
            <a href="#" className="text-sm hover:text-accent transition-colors">
              Projects
            </a>
            <a href="#" className="text-sm hover:text-accent transition-colors">
              About
            </a>
            <button className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              Subscribe
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
