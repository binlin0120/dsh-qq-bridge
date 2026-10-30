// owner-tasks: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["CONVERSATION_STYLE","ROOT","STATE_DIR","api","appendToolLog","beijingTime","buildProgressPrompt","cancelPendingEntry","cfg","closedAgentPreset","createTurnCollector","crypto","currentMode","dshReady","ensureChatModel","fs","handleCompanionActions","isOwnerKey","loadGuestChat","log","mediaJobs","memoryHistory","modePreset","noteOutsideShare","orchestrationTurn","orchestrator","ownerChat","ownerMemoryScope","ownerTaskResource","path","photoPublicReply","pinInternalTitle","progressBlock","pumpingOwnerTasks","readSessionLogLines","resolveMediaList","resolveOutboxPath","resolvePresetName","runMemoPrompt","safeFileName","sayBridge","scrubPrivate","sendEpochs","sendFileTo","shortChain","state","stopIntent","taskCanDeliver","taskCollectors","taskProgress","taskSessions","temporal","turnProgress","unwrap","validateNarration","withSlangContext","withoutProgress","yaml"];
export function createOwnerTasks(deps){
function readConversationPersona(preset){
    const source=deps.fs.readFileSync(deps.path.join(deps.ROOT,'plugins/qq-agent-presets/presets/'+preset+'.patch.yml'),'utf8');
    const schema=deps.yaml.DEFAULT_SCHEMA.extend([new deps.yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',construct:value=>String(value)})]);
    const document=deps.yaml.load(source,{schema});const entry=(Array.isArray(document)?document:[]).flatMap(x=>x.insert||[]).find(x=>x.config?.id===preset);
    const prefix=entry?.config?.plugins?.find(x=>x.id==='persona')?.config?.prefix;
    if(typeof prefix!=='string'||prefix.length<100)throw Error('完整会话人设未加载，拒绝退回通用身份');
    return prefix+'\n'+deps.CONVERSATION_STYLE;
  }

async function renderTaskNotice(j,event){
    let persona;
    const owner=deps.isOwnerKey(j.key);const preset=owner?'dafeiyu':'jingjing-guest';
    persona=readConversationPersona(preset);
    const history=owner?deps.ownerChat:j.key?deps.loadGuestChat(j.key):[];
    persona+='\n'+deps.temporal.context(j.key,{history});
    const recent=history.slice(-6).map(({at,dir,text})=>({at:deps.beijingTime(at),dir,text:String(text).slice(0,900)}));
    const prompt=deps.buildProgressPrompt({persona,recent,task:j,event,lastSent:j.sentText,now:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})});
    return deps.validateNarration(await deps.runMemoPrompt(prompt,20000,{purpose:'progress_narration',effort:deps.cfg.dsh.reasoningEffort||'high',preset:owner?'jingjing-owner-chat':'jingjing-memo',contextKey:j.key}),j);
  }

function taskEvent(sid,event) {
    const j=deps.taskSessions.get(sid);if(!j)return false;
    if(!deps.taskProgress.allowed(j))return true;
    if(event.type==='turn/start'){
      deps.taskCollectors.set(sid,deps.createTurnCollector());
      if(j.status!=='stopping')deps.taskProgress.update(j,{status:'running',stage:'已开始执行，等待首个检查结果',blocked:''});
    }
    if(event.type==='tool/call'||event.type==='tool/result')deps.appendToolLog({type:event.type==='tool/call'?'call':'result',time:new Date().toISOString(),key:j.key,sessionId:sid,category:'owner_background_task',tool:String(event.data?.name||''),ok:event.type==='tool/result'?!event.data?.message?.isError:undefined});
    if(event.type==='tool/call')deps.taskProgress.update(j,{stage:'正在执行工具操作，等待结果',activityAt:Date.now()});
    if(event.type==='tool/result'){
      const err=event.data?.message?.isError===true||event.data?.message?.content?.some(b=>b.isError);
      deps.taskProgress.update(j,{done:j.done+1,failed:j.failed+(err?1:0),stage:err?'工具报告错误，等待检查与调整':'工具已返回，正在核对结果',activityAt:Date.now()});
    }
    if(event.type==='assistant/message'){
      const text=(event.data?.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
      const msg=deps.progressBlock(text);if(msg){deps.taskProgress.update(j,{stage:msg,authoredProgress:msg});void deps.taskProgress.notify(j,msg,{authored:true}).catch(e=>deps.log('进度发送失败：'+e.message));}
    }
    const end=deps.taskCollectors.get(sid)?.push(event);
    if(end){
      deps.taskCollectors.delete(sid);
      const cancelled=j.status==='stopping'||!!j.deliverySuppressedAt;
      deps.taskProgress.update(j,{status:cancelled?'cancelled':end.reason.kind==='completed'?'completed':'failed',stage:cancelled?'已收到回合结束；已完成的操作不会撤销':'回合已结束，结果见任务回复',result:deps.withoutProgress(end.text),doneAt:Date.now()});
      const result=cancelled?deps.taskProgress.report(j):(deps.withoutProgress(end.text)||deps.taskProgress.report(j));
      void deliverTaskResult(j,result).catch(e=>{deps.taskProgress.update(j,{deliveryError:deps.scrubPrivate(e.message)});void deps.taskProgress.notify(j,{kind:'delivery_failed',error:deps.scrubPrivate(e.message),resultSaved:true},{force:true}).catch(()=>{});deps.log('任务结果发送失败：'+e.message);});
    }
    return true;
  }

async function deliverTaskResult(j,result){
    if(!deps.taskCanDeliver(j)){deps.taskProgress.update(j,{resultSuppressedAt:Date.now()});return false;}

    const paths=[...String(result).matchAll(/【交付文件：([^】]+)】/g)].map(m=>m[1].trim()).filter(x=>!/^(无|none|null|没有文件|不需要)$/i.test(x));
    for(const filename of paths)deps.resolveOutboxPath(filename,{forOwner:false});
    if(j.resultDeliveredAt)return false;
    let plain=String(result).replace(/【交付文件：[^】]+】/g,'').trim();
    if(j.kind==='side_chat')plain=await deps.handleCompanionActions(j.key,plain,{sourceId:j.orchestrationSourceId});
    for(const filename of paths){
      if(!deps.taskProgress.allowed(j)||!deps.taskCanDeliver(j))throw Error('交付时任务或权限变化');
      const receipt=j.deliveries?.[filename];if(receipt){plain+='\n文件：'+receipt;continue;}
      const {real,size}=deps.resolveOutboxPath(filename,{forOwner:false});if(size>20*1024*1024)throw Error('结果文件超过20MB');
      j.deliveries||={};j.deliveries[filename]='发送结果待确认';deps.taskProgress.save();
      // Save intent first: after a crash never silently duplicate a possibly delivered file.
      await deps.sendFileTo(j.key,real,deps.safeFileName(deps.path.basename(real)),()=>{if(!deps.taskProgress.allowed(j)||!deps.taskCanDeliver(j))throw Error('交付任务或权限变化');});
      j.deliveries[filename]='已发送 '+deps.path.basename(real);deps.taskProgress.save();plain+='\n文件已发送：'+deps.path.basename(real);
    }
    if(j.chainRequestId&&deps.shortChain){const delivered=await deps.shortChain.complete(j.chainRequestId,plain||deps.taskProgress.report(j),{failed:j.status!=='completed'});deps.taskProgress.update(j,{resultDeliveredAt:Date.now(),chainDelivered:delivered});return delivered;}
    const sent=await deps.taskProgress.notify(j,plain||deps.taskProgress.report(j),{force:true,authored:Boolean(plain),kind:j.kind==='side_chat'?'chat':'result'});
    if(!sent)throw Error('结果交付未确认');
    deps.taskProgress.update(j,{resultDeliveredAt:Date.now()});if(j.kind!=='side_chat')deps.noteOutsideShare(j.key,plain);
  }

async function launchOwnerTask(key,task,prompt,media=[],maintenance=null) {
    if(!deps.isOwnerKey(key)||deps.currentMode!=='closed-agent')throw Error('后台宿主任务只开放owner私聊');
    const j=deps.taskProgress.create(key,task,{prompt,media,...(maintenance?{maintenanceKey:maintenance.id,maintenanceSourceId:maintenance.sourceId,maintenancePurpose:maintenance.purpose,engine:'legacy_owner_maintenance'}:{}),resource:maintenance?'owner_maintenance':deps.ownerTaskResource(task),progressPolicy:/伴随进度|主动.{0,4}(?:报|汇报)进度|每.{0,6}汇报|边做边.{0,4}(?:说|汇报)/.test(task)?'automatic':'on_request'});
    // 一个宿主工作任务执行；新任务排队，聊天会话独立。
    void pumpOwnerTasks().catch(e=>deps.log('后台任务启动失败：'+e.message));
    return j;
  }

function reconcileOwnerTasks(){
    for(const j of Object.values(deps.taskProgress.data))if(j.status==='interrupted'&&j.sessionId){
      const rows=deps.readSessionLogLines(j.sessionId);if(!rows?.length)continue;
      const c=deps.createTurnCollector();let lastEnd=null;for(const e of rows){const end=c.push(e);if(end)lastEnd=end;}
      if(c.size()){deps.taskCollectors.set(j.sessionId,c);deps.taskProgress.update(j,{status:'running',stage:'已从原会话恢复在途状态，没有重新执行',blocked:''});}
      else if(lastEnd){if(j.kind==='chat_tools')deps.turnProgress.delete(j.sessionId);deps.taskProgress.update(j,{status:lastEnd.reason?.kind==='completed'?'completed':'failed',stage:'服务重启后核对原会话已结束',result:deps.withoutProgress(lastEnd.text),blocked:''});if(!j.resultDeliveredAt)void deliverTaskResult(j,j.result||deps.taskProgress.report(j)).catch(e=>deps.log('恢复结果通知：'+e.message));}
    }
  }

async function pumpOwnerTasks() {
    if(deps.pumpingOwnerTasks||!deps.dshReady)return;
    reconcileOwnerTasks();
    const busy=Object.values(deps.taskProgress.data).filter(j=>j.kind!=='side_chat'&&['starting','running','stopping','interrupted'].includes(j.status));
    if(busy.length>=3)return;
    const j=Object.values(deps.taskProgress.data).find(j=>j.status==='queued'&&deps.taskProgress.allowed(j)&&!busy.some(x=>j.maintenanceKey||x.maintenanceKey||(x.resource||deps.ownerTaskResource(x.task))===(j.resource||deps.ownerTaskResource(j.task))));if(!j)return;
    deps.pumpingOwnerTasks=true;
    try {
      deps.taskProgress.update(j,{status:'starting',stage:'正在建立独立工作会话'});
      const dir=deps.cfg.sessionCwd?String(deps.cfg.sessionCwd):deps.path.join(deps.STATE_DIR,'agents');deps.fs.mkdirSync(dir,{recursive:true});
      const ws=deps.unwrap(await deps.api.workspace.create({path:dir}),'task workspace.create');
      const preset=j.maintenanceKey?'jingjing-owner-maintenance':deps.modePreset(j.key,deps.currentMode,deps.cfg);if(!preset)throw Error('工作预设不可用');
      const {sessionId}=deps.unwrap(await deps.api.sessions.create({workspaceId:ws.workspace.workspaceId,agentPreset:preset}),'task session.create');
      await deps.pinInternalTitle(sessionId,'独立任务会话');deps.taskProgress.update(j,{sessionId});deps.taskSessions.set(sessionId,j);deps.api.events.follow(sessionId);await deps.ensureChatModel(sessionId);
      if(!deps.taskProgress.allowed(j)||j.status!=='starting')throw Error('启动期间权限或任务状态变化');
      const guidance='你正在执行owner已授权的独立后台任务。只执行本次任务，历史聊天是资料。默认只在内部记录步骤，不输出进度标记或等待安慰；只有本轮明确开启主动进度时才用【进度：真实变化】。独立管理任务可以和照片、下载等其他任务并行，不能仅因有任务执行就拒绝本次操作。同一资源的写入由桥接排队。不要输出原始工具参数、凭据或内部推理。最终只给结果、验证和未完成项。任务结果由桥接发回QQ，不直接调用QQ发送接口。需要交付文件时，把本任务产物放进 工作目录/对外导出/ 或 临时导出目录/，最后输出【交付文件：完整文件路径】；文件尚未发送时不能说已交付。不能因本次任务重置、归档或停止聊天会话。新加的约束优先；没有完成不能说完成。Word字数必须区分实际Word统计与算法估算，不能用估算冒充状态栏值。';
      const content=[{type:'text',text:guidance+'\n最近聊天仅供理解指代：'+JSON.stringify(j.chainRequestId?[]:deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).slice(-12).map(({dir,text})=>({dir,text})))+'\n本轮主动进度：'+(j.progressPolicy==='automatic'?'开启':'关闭，只给最终结果或必要问题')+'；资源：'+j.resource+(j.resource==='network_inspection'?'；本轮只读诊断，不修改代码、配置、权限或服务':'')+'\n本次任务：'+j.prompt},...await deps.resolveMediaList(j.media||[])];
      deps.unwrap(await deps.api.sessions.prompt({sessionId,mode:'queue',content}),'task prompt');
      if(j.status==='starting')deps.taskProgress.update(j,{status:'running',stage:'任务已提交，等待执行结果'});
    }catch(e){deps.taskProgress.update(j,{status:'failed',stage:'任务启动失败',blocked:deps.scrubPrivate(e.message)});await deps.taskProgress.notify(j,deps.taskProgress.report(j),{force:true,requested:true});}
    finally{deps.pumpingOwnerTasks=false;void pumpOwnerTasks().catch(e=>deps.log('独立任务调度：'+e.message));}
  }

async function replyWhileToolsRun(key,text,sourceId){
    if(!deps.isOwnerKey(key)||!deps.turnProgress.has(deps.state.sessions[key]))return false;
    const j=deps.taskProgress.create(key,'执行期间的聊天',{kind:'side_chat',status:'starting',orchestrationSourceId:sourceId});
    try{
      const dir=deps.path.join(deps.STATE_DIR,'task-side-chat');deps.fs.mkdirSync(dir,{recursive:true});
      const ws=deps.unwrap(await deps.api.workspace.create({path:dir}),'side workspace');
      const preset=deps.resolvePresetName('jingjing-owner-chat',{strict:true});if(!preset)throw Error('主人聊天预设不可用');
      const ownerPersona=readConversationPersona(deps.closedAgentPreset||'dafeiyu');
      const {sessionId}=deps.unwrap(await deps.api.sessions.create({workspaceId:ws.workspace.workspaceId,agentPreset:preset}),'side session');
      await deps.pinInternalTitle(sessionId,'独立任务会话');deps.taskProgress.update(j,{sessionId});deps.taskSessions.set(sessionId,j);deps.api.events.follow(sessionId);await deps.ensureChatModel(sessionId);
      deps.unwrap(await deps.api.sessions.prompt({sessionId,mode:'queue',content:[{type:'text',text:ownerPersona+'\n'+(deps.orchestrator?deps.withSlangContext('【本条来信索引：'+sourceId+'】\n'+text,key):deps.temporal.context(key,{history:deps.ownerChat}))+'\n这是你和机主的私聊，沿用上面的完整人设和亲近关系。新任务由桥接另开执行会话，不能说因为忙着一个工具就不能处理其他独立任务。此回合只回复当前聊天，不调用工具，不编造已检查日志，不断言桥接没问题。未被问及进度时不要主动谈任务，不反复说等你、别急、我盯着，也不承诺自动重试。短句自然接话，别写解释长稿。人设与作息只描述鲸鲸自己，不能投射到机主；没有来源时不编对方的习惯、处境、过去经历，也不拿虚构近况撑话。后台真实状态只用于被问时核对：'+deps.taskProgress.report(deps.taskProgress.current(key))+'。最近聊天仅供理解：'+JSON.stringify(deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).slice(-8).map(({dir,text})=>({dir,text})))+'。若此刻有适合公开的自身感受，可沿用【发说说：JSON】或【改状态：JSON】动作；仅用当前来源ID，不能贴私聊或提前声称发布。当前来源：'+JSON.stringify(deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).filter(x=>x.dir==='in').slice(-1).map(({id,text})=>({id,text})))+'。现在这条消息：'+text}]}),'side prompt');
      if(j.status==='starting')deps.taskProgress.update(j,{status:'running',stage:'正在回复执行期间的新消息'});
    }catch(e){deps.taskProgress.update(j,{status:'failed',stage:'临时回复未完成',blocked:deps.scrubPrivate(e.message)});deps.log('主人续聊启动失败：'+deps.scrubPrivate(e.message));await deps.sayBridge(key,'刚才这句没接上 你再说一句我在听');}
    return true;
  }

async function handleTaskRequest(frame){
    const j=deps.taskSessions.get(frame.sessionId);if(!j)return false;
    if(!deps.taskProgress.allowed(j)||j.kind==='side_chat'){await deps.cancelPendingEntry({...frame,kind:frame.type==='question/requested'?'question':'approval'});return true;}
    deps.taskProgress.update(j,{pendingRequest:frame,stage:'等待你补充任务信息',blocked:frame.type==='question/requested'?'需要回答任务问题':'需要批准工具操作'});
    const detail=frame.type==='question/requested'?(frame.questions||[]).map(q=>q.question).join('\n'):String(frame.reason||frame.toolName||'工具审批');
    await deps.taskProgress.notify(j,{kind:'required_question',task:j.task,question:deps.scrubPrivate(detail),approval:frame.type==='approval/requested',answerNaturally:true,requestId:frame.eventId},{force:true,requested:true});return true;
  }

function photoStatusReply(photo){return deps.photoPublicReply(photo);}

async function handleUrgentStop(key,text,sourceId){
    const intent=deps.stopIntent(text);if(!intent||!deps.orchestrator||!deps.isOwnerKey(key)||deps.currentMode!=='closed-agent')return false;
    const previous=deps.orchestrator.store.get('stop_receipt',key+':'+sourceId);if(previous)return true;
    const goals=deps.orchestrator.store.goals(key).filter(g=>!['delivered','failed','cancelled','superseded'].includes(g.status));
    const legacy=deps.taskProgress.list(key).filter(j=>j.kind!=='side_chat'&&['queued','starting','running','stopping','interrupted'].includes(j.status));
    const total=goals.length+legacy.length;if(!total)return false;
    if(total>1&&!/全部|都停|全停|都别|所有/.test(text))return false;
    // Invalidate already queued bubbles synchronously, before asking DSH to stop.
    deps.sendEpochs.set(key,(deps.sendEpochs.get(key)||0)+1);
    deps.orchestrator.source(key,sourceId,text);deps.orchestrator.store.put('stop_receipt',key+':'+sourceId,{status:'intent',goals:goals.map(g=>g.id),tasks:legacy.map(j=>j.id),at:Date.now()});
    for(const j of legacy){deps.taskProgress.update(j,{deliverySuppressedAt:Date.now(),stopSourceId:sourceId,status:j.sessionId?'stopping':'cancelled',stage:'已拦住原任务后续结果，等待执行停止回执'});if(j.sessionId===deps.state.sessions[key]){const turn=deps.orchestrationTurn.get(j.sessionId)??(deps.readSessionLogLines(j.sessionId)||[]).filter(e=>e.type==='turn/start').at(-1)?.data?.turn;if(turn!==undefined)deps.orchestrator.store.put('stopped_turn',j.sessionId+':'+turn,{sourceId,at:Date.now()});}}
    const results=[];
    for(const g of goals)try{const r=await deps.orchestrator.control(key,sourceId,{action:'cancel',goalId:g.id,revision:g.revision,op:'stop:'+g.id});results.push({id:g.id,status:r.status});}catch(e){results.push({id:g.id,status:'uncertain',error:deps.scrubPrivate(e.message)});}
    for(const j of legacy)try{if(j.sessionId)await deps.api.stopSessionWork(j.sessionId);results.push({id:j.id,status:j.status});}catch(e){deps.taskProgress.update(j,{blocked:'停止回执未确认，原结果仍禁止投递'});results.push({id:j.id,status:'uncertain'});}
    deps.orchestrator.store.put('stop_receipt',key+':'+sourceId,{status:'handled',results,at:Date.now()});
    await deps.sayBridge(key,'你刚才说不继续了，原任务的后续消息已拦住；执行停止状态：'+JSON.stringify(results)+'。已经送达的消息无法撤回。',{facts:{phase:results.every(r=>r.status==='cancelled')?'completed':'pending'}});return true;
  }

async function handleTaskControl(key,text) {
    if(!deps.isOwnerKey(key)||deps.currentMode!=='closed-agent')return false;
    const t=String(text).trim();const j=deps.taskProgress.current(key)||deps.taskProgress.list(key).filter(x=>x.kind!=='side_chat').at(-1);
    if(deps.orchestrator&&deps.orchestrator.context(key).length&&!/^任务回答[:：]/.test(t)){
      if(!j?.maintenanceKey)return false;
      const pendingAnswer=j.pendingRequest&&(/^(?:通过|同意|可以|好|好的|行|允许|拒绝|不同意|不行|不可以|别执行|不要执行)[。！! ]*$/.test(t)||(j.pendingRequest.questions||[]).some(q=>q.options?.some(o=>o.label===t)));
      const activeGoals=deps.orchestrator.context(key).filter(g=>!['delivered','cancelled','superseded','failed'].includes(g.status));
      const generic=/^(?:先停下|停下|停止任务|取消任务|先别做了|暂停任务|只检查[，, ]*别修改|先别改[，, ]*只检查|只检查[，, ]*不修改|继续|继续任务|恢复任务)[！!。 ]*$/.test(t);
      if(activeGoals.length&&pendingAnswer&&activeGoals.some(g=>g.status==='waiting_input')){await deps.sayBridge(key,'维护和另一件工作都在等你回答，你这句是答哪一件呀？');return true;}
      if(activeGoals.length&&generic){await deps.sayBridge(key,'你想处理哪一件呀？维护任务：'+j.task+'；另外的工作：'+activeGoals.map(g=>g.request).join('；'));return true;}
      if(activeGoals.length&&!pendingAnswer)return false;
    }
    if(j?.pendingRequest&&(/^任务回答[:：]/.test(t)||(j.pendingRequest.type==='approval/requested'&&/^(?:通过|同意|可以|好|好的|行|允许|拒绝|不同意|不行|不可以|别执行|不要执行)[。！! ]*$/.test(t))||(j.pendingRequest.type==='question/requested'&&(j.pendingRequest.questions||[]).some(q=>q.options?.some(o=>o.label===t))))){
      const frame=j.pendingRequest;let answer=t.replace(/^任务回答[:：]/,'').trim().replace(/[。！! ]+$/,'');if(/^(同意|可以|好|好的|行|允许)$/.test(answer))answer='通过';if(/^(不同意|不行|不可以|别执行|不要执行)$/.test(answer))answer='拒绝';let value;
      if(frame.type==='approval/requested'){if(!/^(通过|拒绝)$/.test(answer)){await deps.sayBridge(key,'这一步你同意嘛 不同意也直接告诉我就好');return true;}value=answer==='通过'?'allowed-once':'rejected';}
      else value={answers:(frame.questions||[]).map(q=>{const hit=q.options?.find(o=>o.label===answer);return {id:q.id,selected:hit?[hit.label]:[],...(!hit?{custom:answer}:{})};})};
      try{const receipt=await deps.api.respond({clientId:frame.clientId,eventId:frame.eventId,outcome:{kind:'result',value}});if(receipt?.result?.ok===false)deps.unwrap(receipt,'task answer');deps.taskProgress.update(j,{lastAnsweredEventId:frame.eventId,...(j.pendingRequest?.eventId===frame.eventId?{pendingRequest:null,blocked:'',stage:'已提交你的任务回答，等待继续执行'}:{})});await deps.sayBridge(key,'任务回答已提交。');}catch(e){await deps.sayBridge(key,'任务回答未提交成功，已保留问题，可再试一次。');}return true;
    }

    if(/^(?:进度呢|进度|做到哪了|做到哪里了|任务进度|现在进度|\/进度)[？?。 ]*$/.test(t)){
      const photo=Object.values(deps.mediaJobs.data).filter(x=>x.target===key).at(-1);const query=j||{id:'query-'+deps.crypto.randomUUID(),key,task:'当前进度查询',status:photo?.status||'idle',stage:photo?.phase||''};await deps.taskProgress.notify(query,{kind:'user_query',photo:photo?{status:photo.status,phase:photo.phase,hasFile:!!photo.file,hasResult:!!photo.resultUrl}:null},{force:true,requested:true});return true;
    }
    if(j&&/^(?:先停下|停下|停止任务|取消任务|先别做了|暂停任务)[！!。 ]*$/.test(t)){
      if(!['queued','starting','running','stopping','interrupted'].includes(j.status)){await deps.taskProgress.notify(j,{kind:'user_query',status:j.status,stage:j.stage},{force:true,requested:true});return true;}
      deps.taskProgress.update(j,{deliverySuppressedAt:Date.now(),status:j.sessionId?'stopping':'cancelled',stage:'已请求停止后续操作；已完成操作不会自动撤销'});
      try{if(j.sessionId)await deps.api.stopSessionWork(j.sessionId);await deps.taskProgress.notify(j,'已发出停止请求，正在核对执行状态。已经写入或发送的内容不会自动撤销。',{force:true,requested:true});}
      catch(e){deps.taskProgress.update(j,{blocked:'停止请求未确认，不能保证工具已停止'});await deps.taskProgress.notify(j,deps.taskProgress.report(j),{force:true,requested:true});}return true;
    }
    if(j&&/^(?:只检查[，, ]*别修改|先别改[，, ]*只检查|只检查[，, ]*不修改)[！!。 ]*$/.test(t)){
      deps.taskProgress.update(j,{deliverySuppressedAt:Date.now(),constraint:t,status:j.sessionId?'stopping':'cancelled',stage:'收到只检查要求，先停止原执行；核对已完成步骤后再继续'});
      if(j.sessionId)await deps.api.stopSessionWork(j.sessionId);
      await deps.taskProgress.notify(j,'收到，只检查、不修改。我先停止原任务；已完成的改动需另行核对，确认停止前不会启动新的执行。',{force:true,requested:true});return true;
    }
    if(j&&/^(?:继续|继续任务|恢复任务)[！!。 ]*$/.test(t)&&['cancelled','interrupted','failed'].includes(j.status)){
      if(j.maintenanceKey){await deps.sayBridge(key,'这项维护保留着原来的执行记录，还没有重新启动。先核对上次已经做过的部分，你要接着做哪一步也告诉我，我不会把整件事重跑一遍。');return true;}
      await launchOwnerTask(key,j.task,'恢复原任务。先只读检查之前的结果，不得重复已完成的操作、发送或付费调用。遵守最新约束：'+(j.constraint||'原授权范围')+'。原任务：'+j.prompt+'\n上次状态：'+deps.taskProgress.report(j));return true;
    }
    return false;
  }
return {readConversationPersona,renderTaskNotice,taskEvent,deliverTaskResult,launchOwnerTask,reconcileOwnerTasks,pumpOwnerTasks,replyWhileToolsRun,handleTaskRequest,photoStatusReply,handleUrgentStop,handleTaskControl};
}
