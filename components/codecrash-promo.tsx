import Link from "next/link"

export function CodecrashPromo() {
  return (
    <section className="mt-20">
      <Link
        href="https://codecrash.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="mx-auto block max-w-2xl overflow-hidden rounded-lg"
      >
        <div className="grid grid-cols-2">
          {/* Book Cover — cyan multiply blend */}
          <div className="relative bg-neon-cyan">
            <img
              src="/cc-box-cover.png"
              alt="Code Crash — Matthias Schrader"
              className="block h-full w-full object-cover"
              style={{ mixBlendMode: 'multiply' }}
            />
          </div>

          {/* Portrait — transparent pixels on gray bg */}
          <div className="bg-[#D4D4D4]">
            <img
              src="/cc-box-mattes.png"
              alt="Matthias Schrader"
              className="block h-full w-full object-cover"
            />
          </div>

          {/* Text box */}
          <div className="col-span-2 flex flex-col justify-center bg-[#DDD0BC] p-6">
            <p className="font-mono text-[10px] font-medium uppercase tracking-wider text-black/50">
              CODE CRASH
            </p>
            <h2 className="mt-1 font-mono text-xl font-bold leading-tight text-black">
              Now available in German and English
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-black/70" style={{ fontFamily: 'var(--font-serif), serif' }}>
              Most companies treat AI as an optimization layer. That's a mistake. The real opportunity is building
              entirely new categories of value — and the window to act is closing fast. In Code Crash, Matthias Schrader
              lays out a practical framework for leaders who want to move beyond pilots and into production.
            </p>
            <span className="mt-4 inline-block font-mono text-xs font-semibold text-black">
              codecrash.ai →
            </span>
          </div>
        </div>
      </Link>
    </section>
  )
}
