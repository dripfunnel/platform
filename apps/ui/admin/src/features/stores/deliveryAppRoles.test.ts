import { describe, expect, it } from 'vitest'
import { staffRoles } from '../shell/staffRoles'
import { canChangeDeliveryApp } from './deliveryAppRoles'

describe('who gets the Delivery app controls', () => {
  it('turns them on for the Super admin and the Engineer on call, and off for every other role', () => {
    expect(staffRoles.filter(canChangeDeliveryApp)).toEqual(['staff-super-admin', 'staff-engineer'])
  })
})
