const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        input: text.slice(0, 8000),
        model: EMBEDDING_MODEL,
      }),
    })

    if (!res.ok) {
      console.error('Embedding API error:', res.status, await res.text())
      return null
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>
    }

    return data.data[0]?.embedding || null
  } catch (error) {
    console.error('Embedding generation failed:', error)
    return null
  }
}
