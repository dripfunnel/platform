export const Note = ({ tone, words }: { tone: 'warm' | 'cool'; words: string }) => <p className={tone}>{words}</p>
