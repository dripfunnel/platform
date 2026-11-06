import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@dripfunnel/shared/graphql'
import { formatTime, messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { detailOf, listOf, rolloutOf, storeOf } from './rolloutFixtures'
import { refusalWords, rolloutDialog } from './rolloutDialog'
import { RolloutDetail, type RolloutDetailProps } from './RolloutDetail'
import { Rollouts, type RolloutsProps } from './Rollouts'

const words = messages.rollouts
const noop = () => undefined

const render = async (node: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ['/rollouts'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const list = (props: Partial<RolloutsProps> = {}) =>
  render(<Rollouts page={listOf([rolloutOf(), rolloutOf({ id: 'r0', version: '0.6.1', state: 'done', percent: 100, finishedAt: '2026-11-02T06:22:04.542Z' })])} forced={null} canManage onStart={noop} onReload={noop} {...props} />)

const detail = (props: Partial<RolloutDetailProps> = {}) =>
  render(<RolloutDetail page={detailOf()} status={undefined} forced={null} canManage onStatus={noop} onAction={noop} onReload={noop} {...props} />)

describe('Rollouts', () => {
  it('lists each rollout with its state and store counts, and says first that a paused one blocks every release', async () => {
    const html = await list()
    const text = textOf(html)
    expect(text).toContain('0.8.1')
    expect(text).toContain(words.states.paused)
    expect(text).toContain('1 live · 3 pinned')
    expect(text).toContain(words.pausedBanner.title)
    expect(text).toContain(`0.8.1, started ${formatTime('2026-11-02T06:30:47.699Z')}, is paused.`)
    expect(text).not.toContain('paused since')
    expect(text).toContain('No new release can roll out until it is resumed or rolled back.')
    expect(html).toContain('href="/rollouts/f477af24-ed09-47c7-b649-710a098fa2fe"')
    expect(text.indexOf(words.pausedBanner.title)).toBeLessThan(text.indexOf('0.6.1'))
  })

  it('shows no banner when nothing is paused', async () => {
    expect(textOf(await list({ page: listOf([rolloutOf({ state: 'waves', percent: 10 })]) }))).not.toContain(words.pausedBanner.title)
  })

  it('offers Start only to a manager, and the read-only notice otherwise', async () => {
    expect(textOf(await list())).toContain(words.start)
    const readonly = textOf(await list({ canManage: false }))
    expect(readonly).not.toContain(words.start)
    expect(readonly).toContain(words.readonly.title)
    expect(textOf(await list({ forced: 'readonly' }))).not.toContain(words.start)
  })

  it('draws its loading, empty, error and no-access states', async () => {
    expect(await list({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await list({ forced: 'empty' }))).toContain(words.empty.title)
    expect(textOf(await list({ forced: 'error' }))).toContain(words.error.title)
    expect(textOf(await list({ page: null }))).toContain(words.denied.title)
  })
})

describe('RolloutDetail', () => {
  it('lists the rollout’s stores with their group, version, state and why', async () => {
    const html = await detail()
    const text = textOf(html)
    expect(text).toContain('storefront-core 0.8.1')
    expect(text).toContain('Jaipur Looms')
    expect(text).toContain(words.detail.canary)
    expect(text).toContain('0.6.1')
    expect(text).toContain(words.storeStates.pinned)
    expect(text).toContain(words.errors.gate_failed)
    expect(html).toContain('href="/stores/02bb1673-31b8-4025-8625-c82cf5ccb9ac"')
  })

  it('shows a build’s own code as it is', async () => {
    expect(textOf(await detail({ page: detailOf(rolloutOf(), [storeOf({ error: 'deploy_refused' })]) }))).toContain('Code: deploy_refused')
  })

  it('offers the steers of the rollout’s state to a manager only', async () => {
    const button = (label: string) => new RegExp(`<button[^>]*>${label}</button>`)
    const paused = await detail()
    expect(paused).toMatch(button(words.actions.resume))
    expect(paused).toMatch(button(words.actions.rollBack))
    expect(paused).not.toMatch(button(words.actions.pause))
    expect(await detail({ page: detailOf(rolloutOf({ state: 'canary' })) })).toMatch(button(words.actions.pause))
    expect(await detail({ page: detailOf(rolloutOf({ state: 'rolled_back' })) })).not.toMatch(button(words.actions.rollBack))
    const reader = await detail({ canManage: false })
    expect(reader).not.toMatch(button(words.actions.resume))
    expect(textOf(reader)).toContain(words.readonly.title)
  })

  it('draws its empty, loading, error, not-found and no-access states', async () => {
    expect(textOf(await detail({ forced: 'empty' }))).toContain(words.detail.noStoresTitle)
    expect(await detail({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await detail({ forced: 'error' }))).toContain(words.error.title)
    expect(textOf(await detail({ page: null }))).toContain(words.detail.notFound.title)
    expect(textOf(await detail({ page: 'denied' }))).toContain(words.denied.title)
  })
})

describe('rollout dialogs', () => {
  it('asks a reason for every steer, and roll back restates its consequence as the dangerous one', () => {
    const back = rolloutDialog({ kind: 'steer', action: 'rollBack', rollout: { id: 'r', version: '0.8.1' } })
    expect(back.title).toBe('Roll back 0.8.1?')
    expect(back.consequence).toContain('every store live on 0.8.1 goes back to the build it had before')
    expect(back.danger).toBe(true)
    expect(back.reason?.label).toBe(words.dialogs.reason.label)
    expect(rolloutDialog({ kind: 'steer', action: 'pause', rollout: { id: 'r', version: '0.8.1' } }).danger).toBe(false)
  })

  it('takes a released version to start one', () => {
    const start = rolloutDialog({ kind: 'start' })
    expect(start.input?.error('0.10.0')).toBeNull()
    expect(start.input?.error('latest')).toBe(words.dialogs.start.versionError)
    expect(start.choices?.[0]?.options.map((o) => o.value)).toEqual(['upgrade', 'security'])
  })

  it('words each refusal, and names the rollout in the way', () => {
    expect(refusalWords(new ApiError('ROLLOUT_ACTIVE', 'x'), { version: '0.8.1' })).toBe('0.8.1 is running or paused. Resume or roll it back first.')
    expect(refusalWords(new ApiError('ROLLOUT_ACTIVE', 'x'))).toBe(words.refusals.ROLLOUT_ACTIVE)
    expect(refusalWords(new ApiError('WRONG_STATE', 'x'))).toBe(words.refusals.WRONG_STATE)
    expect(refusalWords(new ApiError('SOMETHING_NEW', 'x'))).toBe(words.refusals.other)
    expect(refusalWords(new Error('network'))).toBe(words.refusals.other)
  })
})
