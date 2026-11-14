// Status badge component

export function createStatusBadge(status) {
  const badge = document.createElement('span')
  badge.className = `status-badge status-${status.toLowerCase()}`
  badge.textContent = status
  return badge
}
