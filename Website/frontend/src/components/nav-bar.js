// Navigation bar component

export function createNavBar() {
  const nav = document.createElement('nav')
  nav.innerHTML = `
    <ul>
      <li><a href="/">Now</a></li>
      <li><a href="/triggers.html">Triggers</a></li>
      <li><a href="/tide.html">Tide</a></li>
      <li><a href="/method.html">Method</a></li>
    </ul>
  `
  return nav
}
