import { describe, expect, it } from 'vitest'
import { budgets, overBudget } from './budgets'

describe('the byte budgets (storefront ARCHITECTURE §9)', () => {
  it('passes a theme at its budgets and refuses one a byte over, naming each', () => {
    expect(overBudget({ jsGzip: budgets.firstLoadJsGzip, cssGzip: budgets.cssGzip })).toEqual([])
    const over = overBudget({ jsGzip: budgets.firstLoadJsGzip + 1, cssGzip: budgets.cssGzip + 1 })
    expect(over.map((p) => [p.step, p.rule])).toEqual([
      ['budget', 'budget/js'],
      ['budget', 'budget/css'],
    ])
  })
})
