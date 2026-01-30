"use client"

interface HumanMachineToggleProps {
  mode: 'human' | 'machine'
  onToggle: (mode: 'human' | 'machine') => void
}

/**
 * Floating toggle between Human (HTML) and LLM (Markdown) view
 * Small-caps Unicode characters for distinctive styling
 * Uses inline styles for Safari compatibility (fixed positioning issues)
 */
export function HumanMachineToggle({ mode, onToggle }: HumanMachineToggleProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          backgroundColor: '#fafafa',
          border: '1px solid #e5e5e5',
          borderRadius: 9999,
          padding: 4,
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
        }}
      >
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
          title="LLM-readable Markdown"
        >
          <span className="text-[10px]">{mode === 'machine' ? '◉' : '○'}</span>
          <span style={{ fontVariant: 'small-caps', letterSpacing: '0.05em' }}>ʟʟᴍ</span>
        </button>
      </div>
    </div>
  )
}
