// One write on the customer screen: busy while it runs, a toast when it saved, and its refusal in words on the card until the next try.
export type CustomerWrite = { busy: boolean; run: (work: () => Promise<string>) => Promise<boolean> }
