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

async function postSave(key, value, keepalive) {
  if (typeof fetch !== 'function') return false
  // 浏览器可能复用已被服务端关闭的空闲连接；失败时重开连接再试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
        keepalive,
      })
      if (res.ok) return true
    } catch (e) { /* 重试一次 */ }
  }
  return false
}

// 返回写入结果，调用方可以据此提示“文件存档未连接”
export function saveRemote(key, value) {
  return postSave(key, value, true)
}

// 页面卸载时的兜底提交：sendBeacon 不等待响应，但比 keepalive fetch 更容易送达
export function beaconSave(key, value) {
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return false
  try {
    const blob = new Blob([JSON.stringify({ key, value })], { type: 'application/json' })
    return navigator.sendBeacon(API, blob)
  } catch (e) {
    return false
  }
}

// 探测文件存档接口：Vite 开发模式会把 /api/save 回退成 HTML，按内容类型排除
export async function hasFileSave() {
  if (typeof fetch !== 'function') return false
  try {
    const res = await fetch(`${API}?key=kingdom-manage-v1`, { cache: 'no-store' })
    const type = res.headers.get('content-type') || ''
    return type.includes('application/json')
  } catch (e) {
    return false
  }
}
