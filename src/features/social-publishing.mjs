// social-publishing: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["SENSITIVE_RE","chatArchive","fs","isOwnerKey","oneBotCall","resolveOutboxPath","socialPublisher"];
export function createSocialPublishing(deps){
async function publishSocial(kind,body,{automatic=false,key=null}={}){
    const content=String(kind==='profile'?String(body.longnick||'')+' | '+String(body.wording||''):kind==='qzone'?body.content:kind==='signature'?body.longnick:body.wording||'').trim();
    if(kind==='profile'&&(String(body.longnick||'').length>60||String(body.wording||'').length>20))throw Error('签名或状态过长');
    if(!content||content.length>(kind==='status'?20:kind==='signature'?60:1000))throw Error('动态内容为空或过长');
    if(deps.SENSITIVE_RE.test(content)||/https?:|\d{5,}|@/.test(content))throw Error('动态含敏感信息，未发布');
    if(automatic){if(!deps.isOwnerKey(key))throw Error('群聊和访客不能触发账号动态');const ids=body.sourceIds;if(!Array.isArray(ids)||!ids.length||ids.length>4)throw Error('自主动态需要本次私聊来源');const sources=deps.chatArchive.query(key,{}).filter(x=>ids.includes(x.id)&&x.dir==='in');if(sources.length!==new Set(ids).size||sources.some(x=>Date.now()-(x.receivedAt||x.at)>6*3600000))throw Error('动态来源不存在或过旧');if(/机主|机主|老大|客户|订单|账单|账号|密码|密钥|群号|手机号|住址|身份证/.test(content))throw Error('自主动态只表达自己的感受，不公开私聊身份和工作信息');for(const source of sources){for(let i=0;i+10<=String(source.text).length;i++)if(content.includes(source.text.slice(i,i+10)))throw Error('自主动态不能照搬私聊原话');}}
    return deps.socialPublisher.publish(kind,content,async()=>{
      if(kind==='qzone'){const images=[];for(const p of Array.isArray(body.images)?body.images.slice(0,4):[]){const f=deps.resolveOutboxPath(p,{forOwner:false});images.push('base64://'+deps.fs.readFileSync(f.real).toString('base64'));}const result=await deps.oneBotCall('send_qzone_msg',{content,ugc_right:4,...(images.length?{images}:{})});const tid=typeof result==='string'?result:result?.tid||result?.id||result?.unikey;return {confirmed:!!tid,tid:tid?String(tid):null};}
      if(kind==='profile'){await deps.oneBotCall('set_self_longnick',{longNick:String(body.longnick),long_nick:String(body.longnick)});await deps.oneBotCall('set_diy_online_status',{face_id:Number(body.face_id??1),face_type:Number(body.face_type??1),wording:String(body.wording)});}else if(kind==='signature')await deps.oneBotCall('set_self_longnick',{longNick:content,long_nick:content});else await deps.oneBotCall('set_diy_online_status',{face_id:Number(body.face_id??1),face_type:Number(body.face_type??1),wording:content});return {confirmed:true,acknowledgedBy:'OneBot success'};
    },{dryRun:body.dryRun===true,sourceIds:body.sourceIds||[]});
  }
return {publishSocial};
}
