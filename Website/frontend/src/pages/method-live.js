// Page: Method & sources – the "How the Live map forecast works" section.
// Fills its highlighted values and tables from the map's settings (Website/shared/river/config.js)
// and opens the dropdown named in the page address (e.g. method.html#traffic-light).
import '../river/method-live.css'
import '../river/methodology.js'

function openFromHash() {
  const el = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
  if (!el) return
  const drop = el.closest('details.lm')
  if (drop) drop.open = true
  el.scrollIntoView()
}
openFromHash()
addEventListener('hashchange', openFromHash)
