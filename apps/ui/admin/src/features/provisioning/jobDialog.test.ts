import { describe, expect, it } from 'vitest'
import { jobDialog, type JobTarget } from './jobDialog'

const target: JobTarget = { name: 'Peak Supply Co.', code: 'peak-supply', owner: { name: 'Owen Hart' }, step: 'repo', attempts: 2 }

describe('job dialogs', () => {
  it('names the step a Retry runs again and the attempt it will be', () => {
    const dialog = jobDialog('retry', target)
    expect(dialog.confirmLabel).toBe('Retry “Repo”')
    expect(dialog.notes).toEqual(['Attempt 3. Steps that finished are kept.'])
    expect(dialog.danger).toBe(false)
    expect(dialog.typeToConfirm).toBeUndefined()
  })

  it('makes Undo destructive, names who can sign up again, and asks for a reason and the store code', () => {
    const dialog = jobDialog('undo', target)
    expect(dialog.danger).toBe(true)
    expect(dialog.consequence).toContain('so Owen Hart can sign up again')
    expect(dialog.notes).toContain('This can’t be undone.')
    expect(dialog.reason).toBeDefined()
    expect(dialog.typeToConfirm?.expected).toBe('peak-supply')
  })
})
