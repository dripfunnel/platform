import { bpsOf } from './percent'

describe('a typed percentage', () => {
  it('reads as basis points, to two places and up to 100', () => {
    expect([bpsOf('5'), bpsOf('7.5'), bpsOf('12,25'), bpsOf(' 100 '), bpsOf('0')]).toEqual([500, 750, 1225, 10000, 0])
    expect([bpsOf(''), bpsOf('101'), bpsOf('1000'), bpsOf('100.01'), bpsOf('1.234'), bpsOf('-1'), bpsOf('5%')]).toEqual([null, null, null, null, null, null, null])
  })

  it('reads a price adjustment with its sign and no ceiling', () => {
    expect([bpsOf('-5', true), bpsOf('10.5', true), bpsOf('-2,5', true), bpsOf('250', true)]).toEqual([-500, 1050, -250, 25000])
    expect([bpsOf('', true), bpsOf('--5', true), bpsOf('1.234', true)]).toEqual([null, null, null])
  })
})
