
export const name='qq-owner-maintenance-guard';export const inject=['tools'];
const denied=['subagent','subagent_fork','list_subagent_models','send_message','interrupt_agent','list_agents','subagent_codex','subagent_claude_code','spawn_teammate','team_task_create','team_task_get','team_task_list','team_task_update','plugin_manager','workflow','ralph'];
export function apply(ctx){for(const name of denied)try{ctx.tools.restrict({deny:[name]});}catch{}ctx.tools.guard(exec=>{if(denied.includes(exec?.name)||/subagent|teammate|plugin_manager/.test(String(exec?.name)))return 'owner维护任务不允许继续派生或安装插件';});}
