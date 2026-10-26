// 把 DSH 全局层塞进每个会话的「开发者向」提示词段落遮掉（只影响挂了这一行的预设）。
//
// 这些段落是给在 DSH Web GUI 里改 DSH 本身的编程助手看的：Web GUI 的 HMR 说明、
// 文件链接要写成 Markdown、MCP resource 服务器清单、DSH 源码检出目录……
// 对 QQ 上的小鲸鱼全是噪音：每条消息都要付这几千字的钱，还会把她往「助手腔」上带。
//
// 做法：在预设自己的作用域里注册同名的空段落。DSH 的 systemPrompt 按名字合并，
// 作用域内的同名段落会遮住全局那条；渲染时空段落会被过滤掉。
// 不动任何工具、不动全局配置，DSH 的 Web GUI 会话照旧。
export const name = 'qq-prompt-trim'

export const inject = ['systemPrompt']

const SECTIONS = [
  ['harness:source', 'HARNESS_SOURCE'],
  ['app:web-surface', 'WEB_SURFACE'],
  ['ui:deliverable-file-references', 'DELIVERABLE_FILE_REFERENCES'],
  ['mcp-resource-servers', 'MCP_SERVERS'],
]
const CONTEXTS = [
  ['harness:source', 'HARNESS_SOURCE'],
  ['app:web-surface', 'WEB_SURFACE'],
]

const orderOf = (fn, key) => {
  const n = fn(key)
  return Number.isFinite(n) ? n : 0
}

export function apply(ctx) {
  const sp = ctx.systemPrompt
  for (const [sectionName, orderKey] of SECTIONS) {
    try {
      ctx.effect(() => sp.section({ name: sectionName, order: orderOf((k) => sp.getSectionOrder(k), orderKey), interpolate: false, text: '' }), `qq-prompt-trim.section(${sectionName})`)
    } catch (error) {
      console.error(`[qq-prompt-trim] 遮不掉段落 ${sectionName}: ${error?.message ?? error}`)
    }
  }
  for (const [contextName, orderKey] of CONTEXTS) {
    try {
      ctx.effect(() => sp.context({ name: contextName, order: orderOf((k) => sp.getContextOrder(k), orderKey), interpolate: false, text: '' }), `qq-prompt-trim.context(${contextName})`)
    } catch (error) {
      console.error(`[qq-prompt-trim] 遮不掉上下文 ${contextName}: ${error?.message ?? error}`)
    }
  }
}
