export const Help = () => (
  <section aria-labelledby="help-title">
    <h2 id="help-title">Need a hand?</h2>
    <label htmlFor="size-guide">Size guide</label>
    <progress id="size-guide" value={3} max={5} />
    <p>
      Call us, or write in <code>support</code> at <cite>Our studio</cite>.
    </p>
    <svg viewBox="0 0 10 10" aria-hidden>
      <defs>
        <clipPath id="c">
          <circle cx="5" cy="5" r="5" />
        </clipPath>
      </defs>
      <rect width="10" height="10" clipPath="url(#c)" fillOpacity={0.5} />
    </svg>
  </section>
)
