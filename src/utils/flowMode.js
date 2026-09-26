// Lets one deployed build serve two funnels: the normal quiz flow, and a
// direct-to-wheel variant reached via /1 in the URL (point a second QR code
// at e.g. medicon.eqova.in/1 — the server must fall back to index.html for
// that path too, see public/.htaccess). ?skipquiz=1 keeps working as an
// alternate trigger. Read once at load — a fresh QR scan is a fresh page
// load either way, so this never needs to change mid-session.
const path = window.location.pathname.replace(/\/+$/, '')
export const SKIP_QUIZ =
  path === '/1' || new URLSearchParams(window.location.search).get('skipquiz') === '1'
