// 飞书同步桥：Vite 开发服务器里的本机接口，接收前端导出的地图图片与报告 XML，
// 调用 lark-cli 重写文档「地图」章节的自动区，保留分隔线以下的手写内容。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readdir, writeFile, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const DOC_TOKEN = process.env.FEISHU_SYNC_DOC || 'VVoLdb8kloVHT6xVzq3c3ltGn1d'
const DOC_URL = `https://tcnpa5l7f9cv.feishu.cn/docx/${DOC_TOKEN}`
const HEADING = '地图'
const DIVIDER_KEY = '以下为手写区'
const DIVIDER_XML = '<hr/><p>以下为手写区，同步不会覆盖。</p>'
const IMAGE_TOKEN = '<!--MAP_IMAGE-->'
// lark-cli 只接受工作目录内的本地图片，临时图放在项目根目录并在上传后删除
const IMAGE_XML = (file) => `<img path="@./${path.basename(file)}" width="820" caption="失窃之地探索地图"/>`
const MAX_BODY = 30 * 1024 * 1024

// Trae 自带的 lark-cli 不一定在用户终端的 PATH 里，按环境变量 → PATH → 插件目录依次查找
async function findInDir(dir, depth) {
  if (depth < 0) return ''
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    return ''
  }
  const hits = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await findInDir(full, depth - 1)
      if (sub) hits.push(sub)
    } else if (entry.name === 'lark-cli') {
      hits.push(full)
    }
  }
  hits.sort()
  return hits[hits.length - 1] || ''
}

let larkPath = ''
export async function resolveLarkCli() {
  if (larkPath) return larkPath
  const candidates = []
  if (process.env.FEISHU_LARK_CLI) candidates.push(process.env.FEISHU_LARK_CLI)
  try {
    const { stdout } = await execFileAsync('which', ['lark-cli'])
    if (stdout.trim()) candidates.push(stdout.trim())
  } catch (e) { /* PATH 里没有就继续找 */ }
  for (const candidate of candidates) {
    try {
      await access(candidate)
      larkPath = candidate
      return larkPath
    } catch (e) { /* 换下一个 */ }
  }
  const inPlugins = await findInDir(path.join(homedir(), '.trae-cn', 'plugins'), 5)
  if (inPlugins) {
    larkPath = inPlugins
    return larkPath
  }
  throw new Error('找不到 lark-cli：请确认已安装并登录，或用 FEISHU_LARK_CLI=绝对路径 启动开发服务器')
}

async function lark(args) {
  let stdout
  try {
    ({ stdout } = await execFileAsync(await resolveLarkCli(), args, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180000,
    }))
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message || '').trim()
    throw new Error(`lark-cli 执行失败：${detail.slice(0, 600)}`)
  }
  let out
  try {
    out = JSON.parse(stdout)
  } catch (e) {
    throw new Error(`lark-cli 返回的不是 JSON：${stdout.slice(0, 300)}`)
  }
  if (!out.ok) throw new Error(out.error?.message || out.message || 'lark-cli 返回失败')
  return out.data
}

async function findHeadingId() {
  const data = await lark(['docs', '+fetch', '--doc', DOC_TOKEN, '--scope', 'outline', '--max-depth', '1', '--as', 'user'])
  const content = data?.document?.content || ''
  const hit = new RegExp(`<h1 id="([^"]+)"[^>]*>${HEADING}</h1>`).exec(content)
  if (!hit) throw new Error(`文档里找不到「${HEADING}」一级标题`)
  return hit[1]
}

async function fetchSection(headingId) {
  const data = await lark([
    'docs', '+fetch', '--doc', DOC_TOKEN,
    '--scope', 'section', '--start-block-id', headingId,
    '--detail', 'with-ids', '--as', 'user',
  ])
  return data?.document?.content || ''
}

// 只看顶层 block：表格、列表里的嵌套标签不能当成可删除的兄弟节点
export function topLevelBlocks(xml) {
  const body = xml.replace(/^<fragment[^>]*>/, '').replace(/<\/fragment>\s*$/, '')
  const blocks = []
  const re = /<(\/?)([a-zA-Z0-9_-]+)([^>]*?)(\/?)>/g
  let depth = 0
  let m
  while ((m = re.exec(body))) {
    const closing = m[1] === '/'
    const tag = m[2]
    const selfClosing = m[4] === '/'
    if (closing) {
      if (depth > 0) depth -= 1
      if (depth === 0 && blocks.length) blocks[blocks.length - 1].end = re.lastIndex
      continue
    }
    if (depth === 0) {
      const idHit = /\bid="([^"]+)"/.exec(m[3] || '')
      blocks.push({ tag, id: idHit ? idHit[1] : '', start: m.index, end: selfClosing ? re.lastIndex : undefined })
      if (selfClosing) continue
      depth = 1
      continue
    }
    if (!selfClosing) depth += 1
  }
  return { body, blocks }
}

// 找出标题与手写区分隔线，返回本次要清掉的自动区 block
export function planSectionUpdate(xml) {
  const { body, blocks } = topLevelBlocks(xml)
  const headingIndex = blocks.findIndex((b) => b.tag === 'h1')
  if (headingIndex < 0) throw new Error('地图章节结构异常：没有找到标题块')
  const dividerIndex = blocks.findIndex((b) => b.start > blocks[headingIndex].start
    && body.slice(b.start, b.end).includes(DIVIDER_KEY))
  const autoStart = headingIndex + 1
  // 分隔线本身也重建，避免重复累积；手写区在分隔线之后，不受影响
  const autoEnd = dividerIndex > headingIndex ? dividerIndex : blocks.length - 1
  return {
    headingId: blocks[headingIndex].id,
    remove: autoEnd >= autoStart
      ? blocks.slice(autoStart, autoEnd + 1).filter((b) => b.id).map((b) => b.id)
      : [],
  }
}

async function deleteBlocks(ids) {
  const args = ['docs', '+update', '--doc', DOC_TOKEN, '--command', 'block_delete', '--as', 'user']
  if (ids.length === 1) args.push('--block-id', ids[0])
  else args.push('--start-block-id', ids[0], '--end-block-id', ids[ids.length - 1])
  await lark(args)
}

async function insertAfter(blockId, content) {
  return lark([
    'docs', '+update', '--doc', DOC_TOKEN,
    '--command', 'block_insert_after', '--block-id', blockId,
    '--content', content, '--as', 'user',
  ])
}

function stripDataUrl(image) {
  const raw = String(image || '')
  const i = raw.indexOf(',')
  return raw.startsWith('data:') && i >= 0 ? raw.slice(i + 1) : raw
}

async function syncToFeishu({ image, content }) {
  const base64 = stripDataUrl(image)
  if (!base64) throw new Error('没有收到地图图片')
  if (typeof content !== 'string' || !content.trim()) throw new Error('没有收到报告正文')

  const headingId = await findHeadingId()
  const sectionXml = await fetchSection(headingId)
  const plan = planSectionUpdate(sectionXml)
  if (plan.headingId !== headingId) throw new Error('地图章节标题块与预期不一致')
  const autoBlocks = plan.remove

  if (autoBlocks.length) await deleteBlocks(autoBlocks)

  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const tmpFile = path.resolve(`stolen-lands-map-${stamp}.png`)
  await writeFile(tmpFile, Buffer.from(base64, 'base64'))
  try {
    // 分隔线每次重建，始终作为自动区的下边界
    const xml = content.replace(IMAGE_TOKEN, IMAGE_XML(tmpFile)) + DIVIDER_XML
    await insertAfter(headingId, xml)
  } finally {
    await unlink(tmpFile).catch(() => {})
  }

  const after = await fetchSection(headingId)
  return {
    url: DOC_URL,
    removed: autoBlocks.length,
    hasDivider: after.includes(DIVIDER_KEY),
    hasImage: after.includes('<img'),
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体超过 30MB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function isLocal(req) {
  const ip = req.socket.remoteAddress || ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

export function feishuSync() {
  return {
    name: 'feishu-map-sync',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/feishu-sync', async (req, res) => {
        const send = (code, payload) => {
          res.statusCode = code
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        }
        if (!isLocal(req)) return send(403, { ok: false, error: '只允许本机调用同步接口' })
        if (req.method !== 'POST') return send(405, { ok: false, error: '只支持 POST' })
        try {
          const raw = await readBody(req)
          const payload = JSON.parse(raw || '{}')
          const data = await syncToFeishu(payload)
          send(200, { ok: true, data })
        } catch (err) {
          send(500, { ok: false, error: err?.message || String(err) })
        }
      })
    },
  }
}
