import { configure } from '@testing-library/react'

// waitFor and findBy give up after 1 s by default, too soon on a loaded CI runner (#1152).
configure({ asyncUtilTimeout: 5_000 })
