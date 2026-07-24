// Fisher–Yates shuffle — returns a new array, does not mutate input.
export function shuffle(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// Pick `count` random items from an array (unique).
export function pickRandom(array, count) {
  return shuffle(array).slice(0, count)
}
