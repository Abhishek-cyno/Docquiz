/**
 * Upper-cases the first letter of every word in a person's name, leaving the
 * rest of each word alone so "McDonald" or "D'Souza" are not flattened.
 * Whitespace is preserved, so it is safe to run on every keystroke.
 *
 *   "dr. shivangi mittal" -> "Dr. Shivangi Mittal"
 */
export function capitalizeName(value) {
  return String(value ?? '').replace(/(^|\s)(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase())
}
