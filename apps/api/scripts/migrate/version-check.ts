export const REQUIRED_POSTGRES_MAJOR = 18

export const assertPostgresMajor = (serverVersionNum: number): void => {
  const major = Math.floor(serverVersionNum / 10000)
  if (major !== REQUIRED_POSTGRES_MAJOR) {
    throw new Error(
      `This project requires Postgres ${REQUIRED_POSTGRES_MAJOR}.x (docs/api/README.md §7); the target server reports ${major}.x.`,
    )
  }
}
