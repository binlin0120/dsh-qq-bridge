import crypto from 'node:crypto';
import {photoExecutionRequest,photoExecutionClaim,photoJobMatches} from './photo-execution.mjs';

export const IMAGE_PLAN_RULES='【统一图片计划】结合当前原话与同会话最近真实对话解释图片需求，输出imagePlan:{intent:"create|reuse|status|clarify|none",artifactType:"photo|poster|illustration|image",subject:"画面主题",target:"current或本次明确目标"}。海报/插画是作品，不是自拍。对方说什么都行、随便来一张时，可以在已确认的作品类型内自主选题，不能改成其他类型。新图用media/photo并带artifactType；旧图用forward，不重画。进度只查原任务。普通问候、讨论能力和引用不创建图片任务。缺少原图如实问清，不编造画稿。';
const objectRe=/海报|插画|绘画|画作|素描|作品|图片|照片|自拍|生图|画的(?:图|画)|画完/;
const ignored=t=>!t||/不要|不用|不想|别(?:画|拍|发)|取消|停止|他说|她说|假如|如果|比如|本次附件资料|^[“「"]/.test(t)||/分析|点评|评价|解读|识别|怎么实现|怎么回事|支持.{0,8}(?:生图|画图)/.test(t);
export function artifactType(text,fallback='photo'){
 const t=String(text||'');if(/海报|poster/i.test(t))return 'poster';if(/插画|水彩|素描|绘画|画作|手绘/.test(t))return 'illustration';if(/自拍|生活照|照片|拍张/.test(t))return 'photo';return fallback;
}
export function buildArtworkPrompt(type,scene){
 return (type==='poster'?'制作可直接展示的海报成图，完整平面版式，标题与文字清晰，图形与配色协调。':type==='illustration'?'创作完整的插画作品，构图、色彩与绘画风格保持一致。':'创作符合要求的完整图片作品。')+'\n画面要求：'+String(scene);
}
export function imageContext(c,records,history,now=Date.now()){
 const scoped=records.filter(r=>r.id!==c.id&&r.actorQQ===c.actorQQ&&r.origin===c.origin&&r.at<=now&&now-r.at<86400000).sort((a,b)=>b.at-a.at);
 const outgoing=history.filter(x=>x.dir==='out').slice(-6).reverse();
 for(let i=0;i<outgoing.length;i++){
  const text=String(outgoing[i].text||''),key=c.origin+':'+crypto.createHash('sha256').update(text).digest('hex');
  const record=scoped.find(r=>r.status==='completed'&&r.outputs?.[key]?.status==='sent');if(!record)continue;
  if(scoped.some(r=>r.at>record.at&&(r.actions||[]).some(a=>!['media','memory'].includes(a.type))))return null;
  const plan=record.imagePlan;
  if(plan?.intent==='create'&&(record.actions||[]).some(a=>a.type==='media'&&a.kind==='photo'))continue;
  if(plan?.intent==='clarify'||/画|生成|制作|拍/.test(text)&&/给你|什么样|哪种|想看|要不要/.test(text))return {sourceRequestId:record.id,artifactType:plan?.artifactType||artifactType(text,'image'),subject:plan?.subject||'',latest:i===0,offer:true,needsScene:plan?.intent==='clarify'};
 }
 const previous=scoped[0];
 if(previous?.imagePlan?.intent==='clarify'&&previous.outputs&&Object.values(previous.outputs).some(x=>x.status==='sent'))return {...previous.imagePlan,sourceRequestId:previous.id,offer:true,needsScene:true,latest:true};
 return null;
}
export function resolveImagePlan(c,decision,{context=null,job=null,records=[]}={}){
 const text=String(c.text||'').split('\n本次附件资料：')[0].trim();
 const explicitNew=/重新(?:画|拍)|重画|再画|再拍|再来|新(?:图|画|照片)|画(?:张|一张|个|一幅)|(?:帮我|给我)画|生成|拍张|来张/.test(text);
 const old=/原图|旧图|上次|以前|之前|昨天|发过|重发|再发/.test(text)&&!explicitNew;
 const requestAct=/给我|帮我|来一|来张|看看|想看|画张|画一|拍张|生成|都行|随便|画完|画好了吗/.test(text);
 const confirmation=context?.latest&&/^(?:好|好的|可以|行|嗯嗯|是的)[！!。\s]*$/.test(text);
 const sceneAnswer=context?.needsScene&&!confirmation&&text.length<=200&&!/[？?]|^(?:你|查|帮我|如何|为什么)/.test(text);
 const type=artifactType(text,context?.artifactType||decision.imagePlan?.artifactType||'photo');
 const plan={intent:'none',artifactType:type,subject:String(decision.imagePlan?.subject||context?.subject||'').slice(0,600),target:'current',sourceRequestId:context?.sourceRequestId||null};
 if(ignored(text))return plan;
 const linked=job&&artifactType(text,job.artifactType||'photo')===(job.artifactType||'photo')&&records.some(r=>r.id!==c.id&&r.origin===c.origin&&r.actorQQ===c.actorQQ&&r.engine==='media'&&r.externalId===job.id);
 const picture=objectRe.test(text)||!!photoExecutionRequest(text)||explicitNew||!!context||!!linked;
 if(!picture||!requestAct&&!confirmation&&!sceneAnswer)return plan;
 if(confirmation&&job)return plan;
 if(/画完/.test(text)&&photoJobMatches(text,job)&&!['failed','cancelled','completed','uncertain'].includes(job.status)){plan.intent='status';plan.jobId=job.id;return plan;}
 if(linked&&!explicitNew&&!old&&!['completed','failed','cancelled'].includes(job.status)){plan.intent='status';plan.jobId=job.id;plan.artifactType=job.artifactType||'photo';return plan;}
 if(linked&&job.status==='completed'&&!explicitNew&&!/(?:来|发)(?:一)?张|都行|随便/.test(text)&&!old){plan.intent='reuse';plan.jobId=job.id;plan.artifactType=job.artifactType||'photo';return plan;}
 if(old){plan.intent='reuse';return plan;}
 if(explicitNew||/(?:来|发)(?:一)?张/.test(text)||/都行|随便/.test(text)&&objectRe.test(text)||confirmation||sceneAnswer||context?.offer&&(requestAct||confirmation)){plan.intent='create';if(sceneAnswer)plan.subject=text;return plan;}
 if(/画完|画好了吗/.test(text)){plan.intent=linked?'status':'clarify';return plan;}
 plan.intent='reuse';return plan;
}
export function applyImagePlan(decision,plan){
 const actions=decision.actions||[],images=actions.filter(a=>a.type==='media'&&['photo','forward'].includes(a.kind));
 if(plan.intent==='none')return {repair:!!images.length||photoExecutionClaim(decision.reply),reason:'no_current_request'};
 if(plan.intent==='status')return {status:true};
 if(plan.intent==='reuse'&&plan.jobId){
  const action=images[0]||{type:'media',target:'current'};action.kind='forward';action.imageJobId=plan.jobId;action.artifactType=plan.artifactType;
  decision.actions=actions.filter(a=>!(a.type==='media'&&['photo','forward'].includes(a.kind)));decision.actions.push(action);return {accepted:true};
 }
 if(plan.intent==='create'){
  const photo=images.find(a=>a.kind==='photo');if(!photo)return {repair:true,reason:'missing_image_action'};
  photo.artifactType=plan.artifactType;plan.target=photo.target||'current';
  if(plan.artifactType==='poster'&&!/海报|poster/i.test(String(photo.scene)))photo.scene='由你自主选题的完整海报，保留标题、图形与清晰版式。'+(plan.subject||'');
  if(plan.artifactType==='illustration'&&/自拍|手机照片/.test(String(photo.scene)))photo.scene='由你自主选题的完整插画作品。'+(plan.subject||'');
  plan.subject=String(photo.scene||plan.subject).slice(0,600);return {accepted:true};
 }
 if(images.some(a=>a.kind==='photo'))return {repair:true,reason:'reuse_requires_original'};
 if(images.some(a=>a.kind==='forward'))return {accepted:true};
 if(photoExecutionClaim(decision.reply))return {repair:true,reason:'unsupported_progress'};
 return {clarify:true};
}
