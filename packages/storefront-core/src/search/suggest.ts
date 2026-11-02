'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useShopData } from '../platform/render/data'
import { cardsSchema, summaryFields } from '../products/summary'
import { maxQueryLength } from './search'

// Products under a search box while the shopper types (#1070): the search page's own matching, its first few only.

const suggestDelay = 250
export const minSuggestLength = 2
const maxSuggestions = 4

const suggestQuery = `query Suggest($search: String, $first: Int) { products(search: $search, first: $first) { nodes { ${summaryFields} } } }`

const suggestSchema = z.object({ products: z.object({ nodes: cardsSchema }).nullable() })

/** The products matching what was typed, asked for once typing pauses; nothing under two letters. */
export const useSuggestions = (typed: string, first: number) => {
  const [words, setWords] = useState('')
  useEffect(() => {
    const next = typed.trim().slice(0, maxQueryLength)
    if (next.length < minSuggestLength) return setWords('')
    const timer = setTimeout(() => setWords(next), suggestDelay)
    return () => clearTimeout(timer)
  }, [typed])
  const count = Math.min(Math.max(Math.floor(first), 1), maxSuggestions)
  const list = useShopData(words ? JSON.stringify(['suggest', words, count]) : null, async (client) => (await client.query(suggestQuery, suggestSchema, { search: words, first: count })).products?.nodes ?? [])
  return { words, status: list.status, products: list.data }
}
