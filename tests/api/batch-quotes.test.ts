import { describe, it, expect } from 'vitest'

const API_BASE = process.env.TEST_API_URL || 'https://synthszr.vercel.app'

describe('Stock-Synthszr Batch Quotes API', () => {
  it('returns valid response for known companies', async () => {
    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: ['apple', 'microsoft', 'nvidia']
      })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.quotes).toBeInstanceOf(Array)
    expect(data.quotes.length).toBe(3)

    // Verify structure
    for (const quote of data.quotes) {
      expect(quote).toHaveProperty('company')
      expect(quote).toHaveProperty('displayName')
      expect(quote).toHaveProperty('ticker')
      expect(quote).toHaveProperty('rating')
    }
  })

  it('returns ticker for known companies', async () => {
    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: ['apple', 'tesla']
      })
    })

    const data = await response.json()

    const apple = data.quotes.find((q: { company: string }) => q.company === 'apple')
    const tesla = data.quotes.find((q: { company: string }) => q.company === 'tesla')

    expect(apple?.ticker).toBe('AAPL')
    expect(tesla?.ticker).toBe('TSLA')
  })

  it('handles unknown companies gracefully', async () => {
    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companies: ['unknowncompany123']
      })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.quotes[0].ticker).toBeNull()
  })

  it('rejects more than 20 companies', async () => {
    const companies = Array(21).fill('apple')

    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies })
    })

    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.ok).toBe(false)
  })

  it('returns empty array for empty input', async () => {
    const response = await fetch(`${API_BASE}/api/stock-synthszr/batch-quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies: [] })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()
    expect(data.quotes).toEqual([])
  })
})
