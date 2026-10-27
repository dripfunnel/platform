export class DispatchRefused extends Error {
  readonly extensions: { code: string }
  constructor(readonly code: string) {
    super(code)
    this.name = 'DispatchRefused'
    this.extensions = { code }
  }
}
