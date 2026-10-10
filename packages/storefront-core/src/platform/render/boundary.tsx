'use client'

import { Component, type ReactNode } from 'react'
import { reportProblem, type StorefrontProblem } from '../../sealed/report'

type Props = { kind: StorefrontProblem['kind']; name: string; baseline: ReactNode; onFail?: () => void; children: ReactNode }

/** The theme's part, or the baseline's when the theme's throws, reported once (ARCHITECTURE §3.3, §3.5). */
export class Boundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch() {
    reportProblem({ kind: this.props.kind, subject: this.props.name })
    this.props.onFail?.()
  }

  override render() {
    return this.state.failed ? this.props.baseline : this.props.children
  }
}

/** Wraps one of the theme's sections; `baseline` is the same section from the baseline theme. */
export const SectionBoundary = ({ name, baseline, children }: { name: string; baseline: ReactNode; children: ReactNode }) => (
  <Boundary kind="section" name={name} baseline={baseline}>
    {children}
  </Boundary>
)
