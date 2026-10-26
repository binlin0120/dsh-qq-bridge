// 小鲸鱼访客会话（closed-agent 下机主以外的人和群）的工具硬边界。
//
// 和 qq-tool-restrict.mjs 的区别：那边允许全部 QQ MCP 工具；这里连 QQ 工具都不给，
// 只留联网搜索（web-search-safe 的 web_search / web_fetch；fetch 由 safe-fetch 挡掉本机和内网地址）。
// 访客的回复由桥接自动转发，她不需要任何发送/查询 QQ 的工具。
//
// 为什么要「先全遮、后放开」：
//   DSH 0.2.1 装载预设时 MCP 还没连上，搜索工具名不在 restrictable 名单里，
//   restrict({ allow: [搜索] }) 会因 unknown 名字直接抛错。
//   所以先 restrict({ allow: [] }) 把继承来的全局工具（三组 MCP、list/read_mcp_resource、
//   working_directory 等）全部遮住；再每隔几秒重试 allow:[搜索]，成功后才撤掉全遮。
//   限制是取交集的，必须「先挂新的、再撤旧的」，任何时刻都不会出现放开的空窗。
//
// 第二层：tools.guard 执行期白名单兜底，只放行 mcp__web-search-safe__*。
export const name = 'qq-guest-restrict'

export const inject = ['tools']

const SAFE_PREFIX = 'mcp__web-search-safe__'
const ALLOW = ['mcp__web-search-safe__web_search', 'mcp__web-search-safe__web_fetch']
const RETRY_MS = 3000
const MAX_TRIES = 200 // 约 10 分钟

export function apply(ctx, config = {}) {
  // noTools：一个工具都不给（记事整理会话用——它读的是别人的聊天原文，不给搜索免得被诱导去抓网页）
  if (config?.noTools === true) {
    try { ctx.tools.restrict({ allow: [] }) } catch (error) { console.error(`[qq-guest-restrict] noTools 全遮失败：${error?.message ?? error}`) }
    ctx.tools.guard((exec) => `工具 "${exec?.name}" 在这个会话里不可用`)
    return
  }
  let blanket = null
  try {
    ctx.tools.restrict({ allow: ALLOW })
    console.error('[qq-guest-restrict] 搜索工具已放开（装载时即可用）')
  } catch {
    try {
      blanket = ctx.tools.restrict({ allow: [] })
    } catch (error) {
      console.error(`[qq-guest-restrict] 全遮失败，只剩执行期白名单：${error?.message ?? error}`)
    }
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      try {
        ctx.tools.restrict({ allow: ALLOW })
        clearInterval(timer)
        if (blanket) { try { blanket() } catch {} blanket = null }
        console.error(`[qq-guest-restrict] 搜索工具已放开（第 ${tries} 次重试）`)
      } catch {
        if (tries >= MAX_TRIES) {
          clearInterval(timer)
          console.error('[qq-guest-restrict] 搜索工具一直没注册出来，访客会话保持无工具')
        }
      }
    }, RETRY_MS)
    timer.unref?.()
    try { ctx.on('dispose', () => clearInterval(timer)) } catch {}
  }
  ctx.tools.guard((exec) => {
    const n = exec?.name
    if (typeof n === 'string' && n.startsWith(SAFE_PREFIX)) return
    return `工具 "${n}" 在访客会话里不可用（只能聊天和联网搜索）`
  })
}
