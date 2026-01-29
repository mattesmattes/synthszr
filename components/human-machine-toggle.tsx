"use client"

interface HumanMachineToggleProps {
  mode: 'human' | 'machine'
  onToggle: (mode: 'human' | 'machine') => void
}

/**
 * Floating toggle between Human (HTML) and Machine (Markdown) view
 * Small-caps Unicode characters for distinctive styling
 */
export function HumanMachineToggle({ mode, onToggle }: HumanMachineToggleProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="flex items-center gap-0.5 bg-background/95 backdrop-blur-sm border border-border rounded-full px-1 py-1 shadow-lg">
        <button
          onClick={() => onToggle('human')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            mode === 'human'
              ? 'bg-[#CCFF00] text-black'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          aria-pressed={mode === 'human'}
          title="Human-readable view"
        >
          <span className="text-[10px]">{mode === 'human' ? '◉' : '○'}</span>
          <span style={{ fontVariant: 'small-caps', letterSpacing: '0.05em' }}>ʜᴜᴍᴀɴ</span>
        </button>
        <button
          onClick={() => onToggle('machine')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            mode === 'machine'
              ? 'bg-[#CCFF00] text-black'
              : 'text-muted-foreground hover:text-foreground'
          }`}
          aria-pressed={mode === 'machine'}
          title="Machine-readable Markdown"
        >
          <span className="text-[10px]">{mode === 'machine' ? '◉' : '○'}</span>
          <span style={{ fontVariant: 'small-caps', letterSpacing: '0.05em' }}>ᴍᴀᴄʜɪɴᴇ</span>
        </button>
      </div>
    </div>
  )
}
