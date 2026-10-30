import {CONVERSATION_STYLE} from './conversation-style.mjs';
export const PUBLIC_TECHNICAL_CONTEXT='【可公开的运行事实】QQ消息经OneBot兼容网关进入桥接程序；桥接按真实发送者和当前会话核对权限，把本次消息与允许的上下文交给DSH运行环境处理，再根据实际回执把回复送回原聊天。私聊和各群的记忆按会话隔离；提醒保存在本地并在到点时认领、核对发送回执，历史回忆不会自动重建提醒。图片沿用已配置服务的异步任务和投递检查。上述公开机制可以直接解释；当前未提供具体提供商、版本、机器地址或私人配置值，不猜测。描述公开工作机制不等于已检查本次故障或获准操作服务器。';
export function buildConversationPersona({base,privatePersona='',key='',actorRole='guest',groupPolicy={}}={}){
 if(typeof base!=='string'||base.trim().length<80)throw Error('共同人格未加载，停止拼接，避免回退到私人预设');
 const group=String(key).startsWith('group:'),owner=actorRole==='owner',sentences=Number.isInteger(groupPolicy.maxSentences)?Math.min(3,Math.max(1,groupPolicy.maxSentences)):2;
 const scene=group?`【当前场景】这是公开群聊；真实发言者${owner?'已核实为主人，保持熟悉自然':'是群友，保持友好的朋友距离'}。只用当前群的公开称呼、资料和记忆，不带主人私聊关系、专属称呼或经历。通常不超过${sentences}句，必要的公开技术解释按问题简明展开。主人身份不因在群里改变，具体动作仍由当前可信权限决定。`:`【当前场景】这是${owner?'主人私聊，保留既有亲近关系和称呼':'访客私聊，保持友好的朋友距离'}。只使用本会话允许的记忆，动作依当前可信权限执行。`;
 return [owner&&!group?privatePersona:'','【共同人格】'+base,CONVERSATION_STYLE,scene,PUBLIC_TECHNICAL_CONTEXT].filter(Boolean).join('\n');
}
export function audienceGreetingIntent(text){
 const t=String(text||'').trim();
 if(/发到|发送|转发|私信|传话|QQ号|群号|账号|[1-9]\d{4,}|提醒|定时|分钟|小时/.test(t))return false;
 return /^(?:(?:对了|那个|帮我|请|你|先|麻烦你)[，,！!。\s]*)*(?:跟|给|向|对)?(?:抖音(?:的)?朋友(?:们)?|直播间(?:的)?(?:朋友们|观众)?|观众(?:们)?|大家|镜头前的朋友们)(?:打(?:个|一下|一声)?招呼|问(?:个)?好|说(?:两|几)句(?:话)?)[吧呀呗啊~～!！。\s]*$/.test(t);
}
