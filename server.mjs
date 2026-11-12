// 静态站点 + 文件存档服务：把地图与王国的状态写到项目目录的 saves/ 里。
// 用法：node server.mjs（默认 http://0.0.0.0:8989/）
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, copyFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleFeishuSync } from './scripts/feishu-sync.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(ROOT, 'dist')
const SAVE_DIR = path.join(ROOT, 'saves')
const BACKUP_DIR = path.join(SAVE_DIR, 'backups')
const PORT = Number(process.env.PORT || 8989)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_BODY = 5 * 1024 * 1024
const ALLOWED = new Set(['kingdom-map-v1', 'kingdom-manage-v1', 'kingdom-map-ui-v1'])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(body)
}

async function ensureDirs() {
  await mkdir(SAVE_DIR, { recursive: true })
  await mkdir(BACKUP_DIR, { recursive: true })
}

async function pruneBackups(key) {
  const files = (await readdir(BACKUP_DIR)).filter((f) => f.startsWith(`${key}.`)).sort()
  while (files.length > 5) {
    const file = files.shift()
    try { await unlink(path.join(BACKUP_DIR, file)) } catch (e) { /* 忽略 */ }
  }
}

async function handleApi(req, res, url) {
  // 存档请求频率低，避免浏览器复用已关闭的空闲连接
  res.setHeader('Connection', 'close')
  if (url.pathname !== '/api/save') return send(res, 404, 'not found')
  if (req.method === 'GET') {
    const key = url.searchParams.get('key')
    if (!ALLOWED.has(key)) return send(res, 400, 'bad key')
    try {
      const text = await readFile(path.join(SAVE_DIR, `${key}.json`), 'utf8')
      send(res, 200, text, 'application/json; charset=utf-8')
    } catch (e) {
      send(res, 404, '{}', 'application/json; charset=utf-8')
    }
    return
  }
  if (req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_BODY) req.destroy()
    })
    req.on('end', async () => {
      let data
      try {
        data = JSON.parse(body)
      } catch (e) {
        return send(res, 400, 'bad json')
      }
      const key = data && data.key
      if (!ALLOWED.has(key) || !data.value || typeof data.value !== 'object') {
        return send(res, 400, 'bad payload')
      }
      try {
        await ensureDirs()
        const file = path.join(SAVE_DIR, `${key}.json`)
        const text = JSON.stringify(data.value, null, 1)
        try {
          await copyFile(file, path.join(BACKUP_DIR, `${key}.${Date.now()}.json`))
          await pruneBackups(key)
        } catch (e) { /* 首次写入没有旧文件 */ }
        await writeFile(file, text, 'utf8')
        send(res, 200, JSON.stringify({ ok: true, key, bytes: text.length }), 'application/json; charset=utf-8')
      } catch (e) {
        send(res, 500, 'write failed')
      }
    })
    return
  }
  send(res, 405, 'method not allowed')
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  const file = path.normalize(path.join(DIST, pathname))
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return send(res, 403, 'forbidden')
  try {
    const data = await readFile(file)
    const ext = path.extname(file).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      // 本地工具不需要缓存，避免浏览器继续使用旧构建
      'Cache-Control': 'no-store',
    })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch (e) {
    send(res, 404, 'not found')
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  try {
    if (url.pathname === '/api/feishu-sync') return await handleFeishuSync(req, res)
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
    await serveStatic(req, res, url)
  } catch (e) {
    send(res, 500, 'server error')
  }
})

server.keepAliveTimeout = 65000
server.headersTimeout = 66000

ensureDirs().then(() => {
  server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}/`
    console.log(`Kingdom simulator: ${url}`)
    console.log(`Saves: ${SAVE_DIR}`)
    // 仅在带 --open 启动时自动打开浏览器，避免后台重启时反复弹窗
    if (process.argv.includes('--open')) {
      const open = process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
      open.on('error', (err) => console.error('打开浏览器失败:', err.message))
      open.unref()
      console.log('已尝试打开浏览器:', url)
    }
  })
})
