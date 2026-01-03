#!/usr/bin/env node

/**
 * Test Gemini image generation via direct Google API
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!apiKey) {
  console.error('❌ GOOGLE_GENERATIVE_AI_API_KEY not set')
  process.exit(1)
}

console.log('🔑 API Key found:', apiKey.slice(0, 10) + '...')

const genAI = new GoogleGenerativeAI(apiKey)

async function testImageGeneration() {
  console.log('\n📸 Testing Gemini 2.0 Flash image generation...\n')

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  })

  const prompt = `Erstelle ein einfaches Schwarz-Weiß Bild: Ein Roboter liest eine Zeitung.
Stil: Klare Linien, hoher Kontrast, keine Grautöne.`

  console.log('📝 Prompt:', prompt.slice(0, 100) + '...')
  console.log('⏳ Generiere Bild...\n')

  try {
    const result = await model.generateContent(prompt)
    const response = result.response

    console.log('📨 Response erhalten')

    // Check candidates
    for (const candidate of response.candidates || []) {
      console.log('  Candidate found, parts:', candidate.content?.parts?.length)

      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          console.log('  📝 Text:', part.text.slice(0, 100))
        }
        if (part.inlineData) {
          console.log('  🖼️  Image found!')
          console.log('     MimeType:', part.inlineData.mimeType)
          console.log('     Data length:', part.inlineData.data?.length, 'bytes')

          // Save test image
          const fs = await import('fs')
          const buffer = Buffer.from(part.inlineData.data, 'base64')
          fs.writeFileSync('/tmp/gemini-test.png', buffer)
          console.log('     ✅ Saved to /tmp/gemini-test.png')

          return true
        }
      }
    }

    console.log('❌ Kein Bild in der Antwort gefunden')
    console.log('   Vollständige Response:', JSON.stringify(response, null, 2).slice(0, 500))
    return false

  } catch (error) {
    console.error('❌ Fehler:', error.message)
    if (error.message.includes('not found')) {
      console.log('\n💡 Tipp: Das Modell unterstützt möglicherweise keine Bildgenerierung.')
      console.log('   Verfügbare Modelle: gemini-2.0-flash-exp, imagen-3.0-generate-002')
    }
    return false
  }
}

testImageGeneration().then(success => {
  process.exit(success ? 0 : 1)
})
