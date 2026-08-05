/**
 * Picks which slice the prize wheel lands on.
 *
 * Every doctor sees the same wheel, but only some slices are actually winnable
 * for them (clinic owners win the premium prizes, everyone else the standard
 * ones). Kept out of the component so it stays a plain, testable function.
 *
 * @param items    every slice on the wheel, in display order
 * @param winnable the subset this doctor may win; empty/absent means all
 * @param rng      injectable for tests; defaults to Math.random
 * @returns the index into `items`, or -1 if there is nothing to spin
 */
export function pickWinnerIndex(items, winnable, rng = Math.random) {
  if (!items?.length) return -1

  const eligible = winnable?.length
    ? items.reduce((acc, item, i) => {
        if (winnable.some((w) => w.id === item.id)) acc.push(i)
        return acc
      }, [])
    : []

  // A wheel nobody can win on would dead-end the flow, so an empty or
  // non-matching `winnable` falls back to the whole wheel.
  const pool = eligible.length ? eligible : items.map((_, i) => i)
  return pool[Math.floor(rng() * pool.length)]
}

/**
 * Degrees the wheel must sit at for slice `index` to stop under the pointer.
 * Slice centres are at i*step + step/2 clockwise from 12 o'clock, so the wheel
 * ends on the negative of that.
 */
export function rotationForIndex(index, total) {
  const step = 360 / total
  return (360 - (index * step + step / 2)) % 360
}
