import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

describe('Stock-Synthszr Batch Ratings API', () => {
  it('returns valid response for known companies', async () => {
    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: ['apple', 'microsoft']
      })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.ratings).toBeInstanceOf(Array)
  })

  it('returns rating data structure', async () => {
    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: ['nvidia']
      })
    })

    const data = await response.json()

    if (data.ratings.length > 0) {
      const rating = data.ratings[0]
      expect(rating).toHaveProperty('company')
      // Rating can be null if not cached
      if (rating.rating) {
        expect(['BUY', 'HOLD', 'SELL']).toContain(rating.rating)
      }
    }
  })

  it('rejects more than 20 companies', async () => {
    const companies = Array(21).fill('apple')

    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies })
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.ok).toBe(false)
  })
})

describe('Premarket Batch Ratings API', () => {
  it('returns valid response for known premarket companies', async () => {
    const response = await fetch(`${API_BASE}/api/premarket/batch-ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: ['OpenAI', 'Anthropic']
      })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.ratings).toBeInstanceOf(Array)
  })

  it('rejects more than 20 companies', async () => {
    const companies = Array(21).fill('OpenAI')

    const response = await fetch(`${API_BASE}/api/premarket/batch-ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies })
    })

    expect(response.status).toBe(400)
  })
})
