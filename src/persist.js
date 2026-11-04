// 文件存档：同源 /api/save 存在时优先读写项目目录里的 saves/ 文件。
// 服务器不可用（例如 Vite 开发页）时静默退回 localStorage。
const API = '/api/save'

export async function fetchSave(key) {
  if (typeof fetch !== 'function') return null
  try {
    const res = await fetch(`${API}?key=${encodeURIComponent(key)}`, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    return null
  }
}

export function saveRemote(key, value) {
  if (typeof fetch !== 'function') return
  try {
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
      keepalive: true,
    }).catch(() => {})
  } catch (e) { /* 忽略：离线时仍保留 localStorage */ }
}
