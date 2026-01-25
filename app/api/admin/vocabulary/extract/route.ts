import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import Anthropic from '@anthropic-ai/sdk'

// Dynamic import for pdf-parse to avoid build issues
async function parsePDF(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse')
  const data = await pdfParse(buffer)
  return data.text
}

export const maxDuration = 120

const EXTRACTION_PROMPT = `Du bist ein Experte für Stilanalyse und Sprachcharakteristik.

Analysiere den folgenden Text und extrahiere das CHARAKTERISTISCHE VOKABULAR, das den Schreibstil des Autors ausmacht.

Suche nach:
1. **Wiederkehrende Fachbegriffe** - Begriffe die häufig und bewusst verwendet werden
2. **Eigene Wortschöpfungen** - Neologismen oder ungewöhnliche Wortkombinationen
3. **Charakteristische Metaphern** - Bildhafte Sprache die den Stil prägt
4. **Anglizismen** - Englische Begriffe die absichtlich verwendet werden
5. **Phrasen & Redewendungen** - Typische Formulierungen und Satzmuster
6. **Business/Tech-Jargon** - Spezifische Fachsprache
7. **Stilistische Besonderheiten** - Ungewöhnliche Satzkonstruktionen, Präfixbildungen

WICHTIG:
- Extrahiere NUR Begriffe die CHARAKTERISTISCH für diesen Autor sind
- Ignoriere allgemeine Wörter und Standard-Fachbegriffe
- Konzentriere dich auf das was den Stil EINZIGARTIG macht
- Pro Begriff: Erkläre kurz warum er charakteristisch ist

Antworte im JSON Format:
{
  "vocabulary": [
    {
      "term": "Begriff",
      "category": "metapher|eigener_fachbegriff|anglizismus|phrase|fachbegriff|business_jargon|satzkonstruktion|neologismus",
      "preferred_usage": "Wie der Begriff typischerweise verwendet wird",
      "context": "Warum dieser Begriff charakteristisch für den Stil ist"
    }
  ],
  "style_summary": "Kurze Zusammenfassung des Schreibstils (2-3 Sätze)"
}

TEXT ZUR ANALYSE:
`

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 })
    }

    // Check file type
    const allowedTypes = [
      'application/pdf',
      'text/plain',
      'text/html',
      'text/markdown',
      'text/rtf',
      'application/rtf',
    ]

    const allowedExtensions = ['.pdf', '.txt', '.html', '.htm', '.md', '.rtf']
    const extension = '.' + file.name.split('.').pop()?.toLowerCase()

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(extension)) {
      return NextResponse.json({
        error: `Nicht unterstützter Dateityp: ${file.type || extension}. Erlaubt: PDF, TXT, HTML, MD, RTF`
      }, { status: 400 })
    }

    // Read file content
    const buffer = Buffer.from(await file.arrayBuffer())
    let textContent = ''

    if (file.type === 'application/pdf' || extension === '.pdf') {
      // Parse PDF
      try {
        textContent = await parsePDF(buffer)
      } catch (pdfError) {
        console.error('[Vocabulary Extract] PDF parse error:', pdfError)
        return NextResponse.json({
          error: 'PDF konnte nicht gelesen werden. Versuche eine andere Datei.'
        }, { status: 400 })
      }
    } else {
      // Plain text, HTML, MD, RTF - read as text
      textContent = buffer.toString('utf-8')

      // Strip HTML tags if it's HTML
      if (file.type === 'text/html' || extension === '.html' || extension === '.htm') {
        textContent = textContent
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      }
    }

    if (!textContent || textContent.length < 100) {
      return NextResponse.json({
        error: 'Datei enthält zu wenig Text für eine Analyse (min. 100 Zeichen)'
      }, { status: 400 })
    }

    // Truncate if too long (keep first ~50k chars for analysis)
    const maxChars = 50000
    if (textContent.length > maxChars) {
      console.log(`[Vocabulary Extract] Truncating text from ${textContent.length} to ${maxChars} chars`)
      textContent = textContent.slice(0, maxChars) + '\n\n[... Text gekürzt für Analyse ...]'
    }

    console.log(`[Vocabulary Extract] Analyzing ${textContent.length} chars from ${file.name}`)

    // Call Claude to analyze the text
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT + textContent
        }
      ]
    })

    // Parse the response
    const responseText = response.content[0].type === 'text' ? response.content[0].text : ''

    // Extract JSON from response (handle potential markdown code blocks)
    let jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/)
    let jsonStr = jsonMatch ? jsonMatch[1] : responseText

    // Try to find JSON object if not in code block
    if (!jsonMatch) {
      const jsonStart = responseText.indexOf('{')
      const jsonEnd = responseText.lastIndexOf('}')
      if (jsonStart !== -1 && jsonEnd !== -1) {
        jsonStr = responseText.slice(jsonStart, jsonEnd + 1)
      }
    }

    try {
      const result = JSON.parse(jsonStr)

      return NextResponse.json({
        ok: true,
        fileName: file.name,
        textLength: textContent.length,
        vocabulary: result.vocabulary || [],
        styleSummary: result.style_summary || null
      })
    } catch (parseError) {
      console.error('[Vocabulary Extract] JSON parse error:', parseError)
      console.log('[Vocabulary Extract] Raw response:', responseText.slice(0, 500))

      return NextResponse.json({
        error: 'Analyse konnte nicht verarbeitet werden. Bitte erneut versuchen.'
      }, { status: 500 })
    }
  } catch (error) {
    console.error('[Vocabulary Extract] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unbekannter Fehler'
    }, { status: 500 })
  }
}
