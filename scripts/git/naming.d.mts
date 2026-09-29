export type Branch = { issue: number; kind: 'feature' | 'task' | 'bug'; name: string }

export declare const protectedBranches: readonly string[]
export declare const parseBranch: (name: string) => Branch | undefined
export declare const branchProblem: (name: string) => string | undefined
export declare const subjectIssue: (subject: string) => number | undefined
export declare const subjectProblem: (subject: string) => string | undefined
export declare const firstLine: (message: string, commentChar: string) => string
