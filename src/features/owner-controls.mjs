// owner-controls: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["cfg","OwnerMaintenanceBroker","api","capabilityRole","caps","chatArchive","collectCurrentSticker","currentMechanismFacts","currentMode","handleOwnerGroupCommand","handleTaskControl","isCurrentSession","isOwnerKey","isSessionAllowedInCurrentMode","launchOwnerTask","log","memoryBook","memoryHistory","memoryQueue","noteOwnerChat","oneBotCall","orchestrationTurn","orchestrator","ownerChat","ownerMemoryScope","parseAgentObject","parseMemoObject","publishSocial","queueCharacterPhoto","rememberStructured","renderTaskNotice","reverse","rosterSnapshot","rosterUpdate","sayBridge","scrubPrivate","sendCurrentSticker","sendToQQ","taskProgress","temporal","validQQ","work"];
export function createOwnerControls(deps){
function observeOrchestratorFrame(frame){
          if(deps.orchestrator&&frame.type==='session/event'){
            const ownerKey=deps.reverse.get(frame.sessionId),event=frame.event;
            if(ownerKey&&deps.isOwnerKey(ownerKey)&&deps.isCurrentSession(ownerKey,frame.sessionId)){
              if(event.type==='turn/start')deps.orchestrationTurn.set(frame.sessionId,event.data?.turn);
              if(event.type==='user/message'&&event.data?.role!=='assistant'){
                const raw=(event.data?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');const match=/【本条来信索引：([a-f0-9-]+)】/.exec(raw);
                if(match&&deps.orchestrator.store.readSource(ownerKey,match[1])){const turn=deps.orchestrationTurn.get(frame.sessionId);const id=frame.sessionId+':'+turn;const binding=deps.orchestrator.store.get('turn_source',id)||{owner:ownerKey,sourceIds:[]};if(!binding.sourceIds.includes(match[1]))binding.sourceIds.push(match[1]);deps.orchestrator.store.put('turn_source',id,binding);}
              }
            }
          }

  }

async function applyOrchestrationRoster(key,sourceId,action,sourceText){
    if(!deps.isOwnerKey(key)||!deps.orchestrator)throw Error('只有owner可以变更名单');
    const id=['roster',key,sourceId,action.op].join(':');const previous=deps.orchestrator.store.get('broker',id);
    if(previous){if(previous.status==='completed')return previous.result;const desired=previous.operation==='add';const member=deps.rosterSnapshot()[previous.list]?.includes(previous.target);if(member===desired){previous.status='completed';previous.result={target:previous.target,list:previous.list,member:desired,confirmed:true};deps.orchestrator.store.put('broker',id,previous);return previous.result;}throw Error('上次名单变更结果尚未核实，没有重复执行');}
    if(!['add','remove'].includes(action.operation)||!['users','groups','admins'].includes(action.list))throw Error('名单动作无效');
    if(/(?:别|不要|不用|不许|禁止).{0,8}(?:加|删|移|设|改)/.test(sourceText))throw Error('本条消息没有授权执行名单变更');
    const phrase=action.operation==='add'?/(?:加|添|允许|设为|设成|进名单|白名单)/:/(?:删|移出|移除|踢出|取消|去掉)/;if(!phrase.test(sourceText))throw Error('本条消息没有明确的名单变更要求');
    if(action.list==='admins'&&!/管理员|管理名单|(?:加|设为|设成|升为).{0,6}管理/.test(sourceText))throw Error('本条消息没有授权提升管理员权限');if(action.list==='groups'&&!/群/.test(sourceText))throw Error('本条消息没有明确要变更群名单');
    let target=String(action.target||'');if(!/^\d{5,12}$/.test(target)||!(sourceText.match(/\b\d{5,12}\b/g)||[]).includes(target)){
      const name=String(action.lookupName||'').trim();if(!name||!sourceText.includes(name))throw Error('还没核实你指的是谁');
      const friends=await deps.oneBotCall(action.list==='groups'?'get_group_list':'get_friend_list',{});const matches=(Array.isArray(friends)?friends:[]).filter(x=>x.nickname===name||x.remark===name||x.group_name===name);if(matches.length!==1)throw Error('这个名字没能唯一对应到目标，还需要确认你指的是谁');target=String(action.list==='groups'?matches[0].group_id:matches[0].user_id);
    }
    const escape=value=>Array.from(String(value),ch=>'\\^$.*+?()[]{}|'.includes(ch)?'\\'+ch:ch).join('');
    const identifiers=[target,...(action.lookupName?[String(action.lookupName)]:[])];const clauses=sourceText.split(/[，,。；;\n]/).filter(x=>identifiers.some(id=>x.includes(id)));
    if(action.list==='admins'){
      const granted=clauses.some(clause=>!/(?:如果|假如|假设|要是|他说|她说|你说|原话|示例|例子|引用|昨天|之前|会有什么|有什么风险|什么后果|为什么|如何|怎么|风险吗)/.test(clause)&&identifiers.some(id=>{
        const tail='\\s*(?:吧|呀|啦|哦|就行|好(?:吗|么)|可以(?:吗|么)?)?[\\s。！!？?]*$';const who=escape(id),gap='(?:\\s|给他|给她|帮他|帮她|给我|帮我|也|再|先|一下)*';
        const after=action.operation==='add'?'(?:设(?:置)?为|设成|升级为|升为|任命为|提升为|加(?:进|入|到|为|成)?|当|做|成为|开|开放|开启)(?:\\s|个|一个|一下)*(?:管理员|管理)(?:名单|权限)?':'(?:从(?:管理员|管理)(?:名单)?(?:中|里)?移(?:出|除)|移(?:出|除)(?:管理员|管理)(?:名单)?|取消(?:管理员|管理)(?:权限)?|删(?:除|掉)?(?:管理员|管理)(?:身份|权限)?)';
        const before=action.operation==='add'?'(?:加(?:一个|个)?管理(?:员)?|设为管理员|任命管理员)':'(?:删管理(?:员)?|移除管理(?:员)?|取消管理员)';
        return new RegExp(who+gap+after+tail).test(clause)||new RegExp(before+'\\s*'+who+tail).test(clause)||new RegExp('(?:任命|设|设置)\\s*'+who+'\\s*为管理员'+tail).test(clause);
      }));
      if(!granted)throw Error('这句话没能明确对应你要变更谁的管理员权限，尚未改动');
    }
    if(action.list==='groups'&&!clauses.some(clause=>/群(?!友)/.test(clause)))throw Error('群名单变更没有与本次指定对象对应，尚未改动');
    const snapshot=()=>deps.rosterSnapshot()[action.list].includes(target);
    const record={id,sourceId,target,list:action.list,operation:action.operation,status:'request_sent',at:Date.now()};deps.orchestrator.store.put('broker',id,record);
    try{const result=deps.rosterUpdate(action.operation,action.list,target);if(!result.ok)throw Error(result.error);await deps.work.reconcile();const desired=action.operation==='add';if(snapshot()!==desired)throw Error('名单回读未对上');record.status='completed';record.result={target,list:action.list,member:desired,confirmed:true};deps.orchestrator.store.put('broker',id,record);return record.result;}catch(e){record.status='uncertain';record.error=deps.scrubPrivate(e.message);deps.orchestrator.store.put('broker',id,record);throw e;}
  }

async function applyOwnerMaintenanceControl(key,sourceId,action){
    if(!deps.orchestrator||!deps.isOwnerKey(key)||deps.currentMode!=='closed-agent')throw Error('维护控制只接受owner私聊');
    const source=deps.orchestrator.store.readSource(key,sourceId),j=deps.taskProgress.data[action.jobId];
    if(!source||source.owner!==key||!j?.maintenanceKey||j.key!==key)throw Error('没有核实你指的是哪项维护');
    const command=action.command;if(!['cancel','constrain','status','resume','answer'].includes(command))throw Error('维护控制无效');
    const phrases={cancel:/停|取消|别做|不做/,constrain:/只检查|只看|别改|不改|不要改/,status:/进度|进展|怎么样|咋样|结果|了吗|了没|做到|状态/,resume:/继续|恢复|接着/};
    if(command!=='answer'&&!phrases[command].test(source.text))throw Error('这条来信没有授权这项维护控制');
    const id=['maintenance_control',key,sourceId,j.id,command].join(':');const old=deps.orchestrator.store.get('broker',id);if(old)return old.result||{jobId:j.id,status:j.status,unconfirmed:true};
    if(command==='answer'){
      const expected=deps.orchestrator.store.get('source_context',key+':'+sourceId)?.maintenanceQuestions?.[j.id];
      if(!expected||j.pendingRequest?.eventId!==expected||deps.taskProgress.current(key)?.id!==j.id||(action.eventId&&action.eventId!==expected))throw Error('这条回答没有对应来信当时的待答问题，尚未提交');
      deps.orchestrator.store.put('broker',id,{status:'intent',jobId:j.id,eventId:expected});
      await deps.handleTaskControl(key,'任务回答：'+source.text);
      const answered=j.lastAnsweredEventId===expected,result={jobId:j.id,status:j.status,eventId:expected,answered,questionStillPending:!!j.pendingRequest};
      deps.orchestrator.store.put('broker',id,{status:answered?'committed':'uncertain',eventId:expected,result});return result;
    }
    if(command==='status')return {jobId:j.id,status:j.status,task:j.task,stage:j.stage};
    if(command==='resume')return {jobId:j.id,status:j.status,restarted:false,reason:'先核对原执行及外部回执，未重新启动'};
    deps.orchestrator.store.put('broker',id,{status:'intent',jobId:j.id});
    if(command==='constrain')deps.taskProgress.update(j,{constraint:'只检查，不修改'});
    if(['queued','starting','running','stopping','interrupted'].includes(j.status)){
      deps.taskProgress.update(j,{deliverySuppressedAt:Date.now(),status:j.sessionId?'stopping':'cancelled',stage:command==='constrain'?'先停止原维护，之后只检查、不修改':'已阻止后续维护派发，等待原执行停止回执'});
      if(j.sessionId)await deps.api.stopSessionWork(j.sessionId);
    }
    const result={jobId:j.id,status:j.status,constraint:j.constraint||null,alreadyCompletedEffectsNotUndone:true};deps.orchestrator.store.put('broker',id,{status:'committed',result});return result;
  }

async function applyOwnerMaintenance(key,sourceId,action){
    const broker=new deps.OwnerMaintenanceBroker({store:deps.orchestrator.store,
      allowed:k=>!!deps.orchestrator&&deps.isOwnerKey(k)&&deps.currentMode==='closed-agent'&&deps.isSessionAllowedInCurrentMode(k),
      source:(k,id)=>deps.orchestrator.store.readSource(k,id),
      find:id=>Object.values(deps.taskProgress.data).find(j=>j.maintenanceKey===id),
      create:r=>deps.launchOwnerTask(r.key,r.text,'【本次owner原始授权，不能扩写对象或命令】\n'+r.text,[],r)});
    return broker.submit(key,sourceId,action);
  }

function wantsOrchestrationStatus(text){const s=String(text);if(/(?:不用|别|不必|不要).{0,8}(?:汇报|告诉|报告|进度)/.test(s))return false;return /进度|进展|做到.{0,5}(?:哪|哪里)|(?:做|弄|处理|算|改|写|生成|完成|好).{0,3}(?:了吗|了没|没有|了么|咋样|怎么样)|结果(?:呢|怎么样)|(?:什么|哪).{0,5}(?:阶段|步骤)|(?:你|那边).{0,12}(?:怎么样|咋样)|什么时候.{0,8}(?:好|完)|\bstatus\b/i.test(s);}

async function applyOrchestrationActions(key,plain,origin){
    const marks=[...String(plain).matchAll(/【协作：([^】]+)】/g)];if(!marks.length)return plain;
    let text=String(plain).replace(/【协作：[^】]+】/g,'').trim();const binding=origin.sourceId?{sourceIds:[origin.sourceId]}:deps.orchestrator.store.get('turn_source',origin.sessionId+':'+origin.turn);
    let index=0;for(const m of marks){try{const action=deps.parseAgentObject(m[1]);const sourceId=action.sourceId||(binding?.sourceIds.length===1?binding.sourceIds[0]:null);if(!binding?.sourceIds.includes(sourceId))throw Error('这次操作的来信归属没有核实，尚未派活');action.op=String(index++);if(action.action==='status'&&!wantsOrchestrationStatus(deps.orchestrator.store.readSource(key,sourceId)?.text||''))continue;if(action.action==='owner_maintenance_control'){const result=await applyOwnerMaintenanceControl(key,sourceId,action);text='';await deps.sayBridge(key,'维护操作的实际回执：'+JSON.stringify(result));continue;}if(action.action==='owner_maintenance'){const result=await applyOwnerMaintenance(key,sourceId,action);if(!['queued','starting','running'].includes(result.status)){text='';await deps.sayBridge(key,'你指定的维护任务记录：'+JSON.stringify(result));}continue;}if(action.action==='roster'){const source=deps.orchestrator.store.readSource(key,sourceId);const result=await applyOrchestrationRoster(key,sourceId,action,source.text);await deps.sayBridge(key,'这次名单操作已实际回读：'+JSON.stringify(result),{facts:{phase:'completed'}});text='';continue;}if(!['create','status'].includes(action.action)){const snapshot=deps.orchestrator.store.get('source_context',key+':'+sourceId);const revision=snapshot?.goalVersions?.[action.goalId];if(!revision)throw Error('没有核实这条来信所指的目标版本');if(action.revision&&action.revision!==revision)throw Error('动作版本与本轮来信不符');action.revision=revision;}const result=await deps.orchestrator.apply(key,sourceId,action);if(action.action==='status'){const data={goalId:result.id,status:result.status,request:result.request,tasks:deps.orchestrator.store.tasks(result.id,result.revision).map(t=>({name:t.name,status:t.status,phase:t.phase,summary:t.result?.summary})),error:result.error};await deps.sayBridge(key,'你问的这件事当前实际情况：'+JSON.stringify(data),{facts:{phase:result.status==='delivered'?'completed':['failed','blocked_external'].includes(result.status)?'failed':'pending'}});}else if(action.action!=='create')await deps.sayBridge(key,'刚才这项要求已经记录：'+JSON.stringify({action:action.action,status:result.status,request:result.request,error:result.error}));}catch(e){await deps.sayBridge(key,'这次没有执行这项操作：'+deps.scrubPrivate(e.message));}}
    return text;
  }

async function handleCompanionActions(key,plain,origin={}){
    if(deps.orchestrator&&deps.isOwnerKey(key))plain=await applyOrchestrationActions(key,plain,origin);
    const socialMarks=[...String(plain).matchAll(/【(发说说|改状态)：([^】]+)】/g)];
    if(socialMarks.length){plain=String(plain).replace(/【(?:发说说|改状态)：[^】]+】/g,'').trim();if(deps.isOwnerKey(key))for(const marker of socialMarks){try{const body=deps.parseMemoObject(marker[2]);const result=await deps.publishSocial(marker[1]==='发说说'?'qzone':'status',body,{automatic:true,key});deps.log('自主动态结果：'+JSON.stringify({kind:marker[1],sent:result.sent||false,reason:result.reason||result.error||null}));}catch(e){deps.log('自主动态未发布：'+deps.scrubPrivate(e.message));}}}
    const eventMarks=[...String(plain).matchAll(/【事件：([^】]+)】/g)];
    if(eventMarks.length){plain=String(plain).replace(/【事件：[^】]+】/g,'').trim();for(const m of eventMarks){try{deps.temporal.report(key,deps.parseMemoObject(m[1]),ids=>deps.chatArchive.query(key,{}).filter(x=>ids.includes(x.id)));}catch(e){deps.log('时间事件未写入：'+deps.scrubPrivate(e.message));}}}
    const remembers=[...String(plain).matchAll(/【记住：([^】]+)】/g)];
    if(remembers.length){if(!deps.isOwnerKey(key))return plain.replace(/【记住：[^】]+】/g,'').trim();for(const m of remembers){const request=deps.parseMemoObject(m[1]);deps.memoryBook.resolveSource(request.source);deps.memoryQueue.enqueue(request);}plain=String(plain).replace(/【记住：[^】]+】/g,'').trim();deps.memoryQueue.flush({snapshot:()=>deps.memoryBook.snapshot(),remember:deps.rememberStructured});}
    const edits=[...String(plain).matchAll(/【修正记忆：([^】]+)】/g)];
    let correctedMemories=0;if(edits.length){plain=String(plain).replace(/【修正记忆：[^】]+】/g,'').trim();if(!deps.isOwnerKey(key))return '不能修改别人的私有记忆';try{for(const edit of edits){deps.memoryBook.correct(deps.parseMemoObject(edit[1]));correctedMemories++;}if(!plain)plain='记忆已更正';}catch(e){return (correctedMemories?'已完成'+correctedMemories+'条纠错；其余':'')+'记忆修正未写入：'+deps.scrubPrivate(e.message);}}

    const markers=[...String(plain).matchAll(/【(发照片|发表情包|收藏表情|工作)：([^】]{1,1500})】/g)];if(!markers.length)return plain;
    let reply=String(plain).replace(/【(发照片|发表情包|收藏表情|工作)：[^】]{1,1500}】/g,'').trim();let done=0;
    try{for(const m of markers){
      if(m[1]==='发照片'){await deps.queueCharacterPhoto(key,m[2],{caption:reply.replace(/[^。！!？?\n]*(?:生成|画好|传过来|出来我|拍好就发)[^。！!？?\n]*[。！!？?]?/g,'').trim(),direct:true});if(!reply)reply=await deps.renderTaskNotice({key,task:'用户要求分享照片',status:'queued',stage:'照片任务已接收，尚未确认送达'},{kind:'photo_requested'});}
      if(m[1]==='发表情包')await deps.sendCurrentSticker(key,m[2].trim());
      if(m[1]==='收藏表情'){const [ref,index]=m[2].split('|');await deps.collectCurrentSticker(key,ref.trim(),Number(index)||1);}
      if(m[1]==='工作'){if(deps.isOwnerKey(key)&&/区别|那别人呢|现在.*权限/.test(deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).filter(x=>x.dir==='in').at(-1)?.text||'')){continue;}if(!deps.caps.mayWork(key))throw Error('文件和程序工作只对管理员私聊开放');const spec=m[2].trim().startsWith('{')?deps.parseMemoObject(m[2]):{task:m[2].replace(/^联网[：: ]/,''),online:/^联网[：: ]/.test(m[2])};if(/^(完整需求|任务描述|完整任务|根据当前文件和对方要求描述任务)$/.test(String(spec.task).trim())){const details=String(plain).replace(/【(发照片|发表情包|收藏表情|工作)：[^】]+】/g,'').trim();if(details.length<8)throw Error('任务描述不完整，请说具体怎么处理这份文件');spec.task=details;}if(deps.orchestrator&&deps.isOwnerKey(key)){const binding=origin.sourceId?{sourceIds:[origin.sourceId]}:deps.orchestrator.store.get('turn_source',origin.sessionId+':'+origin.turn);if(binding?.sourceIds.length!==1)throw Error('本次任务来源尚未核实');deps.orchestrator.submit(key,binding.sourceIds[0],String(spec.task),{op:'work',online:spec.online===true});if(!reply)reply='我来把这件事分好再做呀';}else{const job=deps.work.submit(key,spec.task,{online:spec.online===true,inputIds:spec.inputIds,parentId:spec.parentId});reply=`任务已排队 ${job.id}${job.online?'（联网）':'（不联网）'}`;}}
      done++;
    }}catch(e){reply=(done?'前面已完成，后面的没办成：':'这次没办成：')+deps.scrubPrivate(e.message);}
    return reply;
  }

async function handleCapabilityCommand(key,text,event){
    const t=String(text).trim();const owner=deps.isOwnerKey(key);const role=deps.capabilityRole(key);
    if(await deps.handleOwnerGroupCommand(key,t,event))return true;
    if(owner&&(/^(?:你)?(?:看看|查看|汇总)?(?:一下)?(?:当前|现在)?(?:所有的)?(?:机制|所有机制|全部机制|当前所有的机制)[？?。 ]*$/.test(t)||t==='/当前机制')){deps.memoryBook.repair();const report=deps.currentMechanismFacts().join('\n\n');await deps.sendToQQ(key,report);deps.noteOwnerChat('out',report);return true;}
    if(t==='/我的权限'){const x=deps.work.info(key);await deps.sayBridge(key,`身份：${role||'未授权'}\n隔离工作：${x.work?'可用':x.reason||'此身份不开放'}\n每日次数/费用额度：不限\n联网：每任务可选\n照片：${key.startsWith('private:')?'按内容选择':'群友'+(deps.cfg.groupPhotos.enabled?'每天'+deps.cfg.groupPhotos.perDay+'张（不同群共用，北京时间零点刷新）':'暂未开放')+'，主人不占此额度'}`);return true;}
    if(owner){
      const promote=/^(?:请)?(?:把|将)?(.+?)(?:加进|加入|加到|设为|设成|加为|加)(?:管理员|管理)(?:名单)?[。！! ]*$/.exec(t);
      if(promote&&!t.startsWith('/')){let target=deps.validQQ(promote[1].trim());if(!target){const friends=await deps.oneBotCall('get_friend_list',{});const q=promote[1].trim();const matches=(Array.isArray(friends)?friends:[]).filter(f=>f.nickname===q||f.remark===q);if(matches.length!==1){await deps.sayBridge(key,'名字没法唯一对应，告诉我他的QQ号就能加');return true;}target=String(matches[0].user_id);}const r=deps.rosterUpdate('add','admins',target);if(!r.ok)throw Error(r.error);await deps.sayBridge(key,`已核实 ${target} 是管理员；${deps.work.runner.ready?'可私聊发工作需求，联网可选':'隔离工作环境暂不可用，环境就绪后自动开放'}`);return true;}
      const remove=/^\/移出\s+(\d+)$/.exec(t);if(remove){deps.rosterUpdate('remove','admins',remove[1]);deps.rosterUpdate('remove','users',remove[1]);await deps.work.reconcile();await deps.sayBridge(key,'已移出管理员和聊天用户名单，后续工作已撤销');return true;}
      const pause=/^\/(暂停工作|恢复工作)\s+(\d+)$/.exec(t);if(pause){deps.caps.pause('private:'+pause[2],pause[1]==='暂停工作');await deps.work.reconcile();await deps.sayBridge(key,'已更新并核实工作权限');return true;}
    }
    if(!key.startsWith('private:'))return false;
    if(t==='/任务'||/^\/任务\s+/.test(t)){if(!deps.caps.mayWork(key)){await deps.sayBridge(key,'工作仅管理员私聊开放');return true;}const jobs=deps.work.list(key);const id=t.split(/\s+/)[1];const list=id?jobs.filter(j=>j.id===id):jobs;await deps.sayBridge(key,list.length?list.map(j=>`${j.id} ${j.status}${j.online?' 联网':''}\n${j.task.slice(0,120)}${j.error?'\n'+j.error:''}`).join('\n'):'没有自己的任务');return true;}
    const cancel=/^\/取消任务\s+([a-f0-9-]+)$/.exec(t);if(cancel){try{await deps.work.cancel(key,cancel[1]);await deps.sayBridge(key,'任务已取消');}catch(e){await deps.sayBridge(key,e.message);}return true;}
    const task=/^\/干活\s+([\s\S]+)$/.exec(t);if(task){try{const online=/^(?:联网|--online)\s+/.test(task[1]);if(deps.orchestrator&&deps.isOwnerKey(key)){const source=deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).filter(x=>x.dir==='in').at(-1);deps.orchestrator.submit(key,source.id,task[1].replace(/^(?:联网|--online)\s+/,''),{online,op:'slash-work'});await deps.sayBridge(key,'已经把这件事交给协作任务处理啦');}else{const j=deps.work.submit(key,task[1].replace(/^(?:联网|--online)\s+/,''),{online});await deps.sayBridge(key,`任务已排队 ${j.id}${online?'（联网）':'（不联网）'}`);}}catch(e){await deps.sayBridge(key,e.message);}return true;}
    return false;
  }
return {observeOrchestratorFrame,applyOrchestrationRoster,applyOwnerMaintenanceControl,applyOwnerMaintenance,wantsOrchestrationStatus,applyOrchestrationActions,handleCompanionActions,handleCapabilityCommand};
}
