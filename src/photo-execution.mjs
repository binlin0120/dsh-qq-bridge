// Current authenticated text grants actions; roleplay and quoted history never do.
export const PHOTO_EXECUTION_RULES='【图片执行与事实】明确要画、拍或生成一张图，用media/photo，不能只答应或用表情包代替。要看你画的作品、草稿或旧图，先核对真实图片来源；有原图用media/forward，不为找不到旧图自动付费重新画。画完给我看看是交付要求，不证明已经在画；没有实际作品或进行中的图片任务就说明并问是否现在制作、要画什么。角色日常里提到画画不等于实际图片任务。不能编半张草稿、线条没整理完等执行进度；没有真实任务不说正在制作、画好了叫你、稍后交图。图片动作接收后只按实际排队、制作、传输和送达状态说话，发送成功前不说已发出。';

export function photoExecutionRequest(text){
  const t=String(text??'').split('\n本次附件资料：')[0].trim();
  if(!t||/不要|不用|别(?:发|画|拍|生成)|取消|停止|他说|她说|比如|假如|如果|怎么实现|修改代码|支持.{0,8}(?:生图|画图)|(?:能|可以).{0,8}(?:生图|画图).{0,6}吗/.test(t))return null;
  if(/^(?:[“「"『]|引用[:：])/.test(t))return null;
  if(/分析|点评|评价|解读|识别|怎么回事/.test(t)&&!/生成|重画|帮我画|画张|拍张|发张/.test(t))return null;
  const picture=/照片|自拍|图片|生图|画作|作品|草稿|素描|风景图|美女图|画的(?:图|画)|画(?:一[张幅个]|[张幅个])|(?:给我|帮我)画|画完/.test(t);
  if(!picture||!/给我|发我|给大家|给我们|让我|看看|看下|想看|来(?:一)?张|发(?:给我)?(?:一)?张|画(?:一张|一幅|张|幅)|生成|帮我|拍(?:一)?张/.test(t))return null;
  if(/画完|拍完|做完|做好后|画好后/.test(t))return {mode:'when_ready'};
  if(/之前|以前|上次|昨天|旧图|原图|发过|刚才.{0,6}发|那张.{0,8}(?:再发|重发)/.test(t))return {mode:'existing'};
  if(/生成|重(?:新)?画|再画|画(?:一[张幅个]|[张幅个])|(?:给我|帮我|请你)画|拍(?:一)?张|来(?:一)?张|发(?:给我)?(?:一)?张.{0,16}(?:照片|自拍|图片)/.test(t))return {mode:'create'};
  return {mode:'existing'};
}

export function photoExecutionClaim(text,request=null){
  const t=String(text??'');
  return /还没(?:画|拍|做)完|(?:我|这边)(?:还在|正在|接着|继续).{0,8}(?:画|拍)|正在(?:生成|制作|出图)|已经开始(?:画|制作|生成)|(?:画完|画好|拍好).{0,18}(?:给你|发你|发给你|叫你)|(?:收拾|整理|理).{0,8}(?:干净|好|完).{0,16}(?:给你|拿给你)|第一个(?:拿|发|给).{0,8}看|桌上只有半张草稿/.test(t)
    ||!!request&&/(?:已经|刚刚|刚才|已)(?:给你|发给你)?(?:发|画|拍|做好)|(?:图|照片|画作|作品).{0,8}(?:做好了|发出去了|发给你了)|画好了我叫你/.test(t);
}

const imageAction=a=>a?.type==='media'&&['photo','forward'].includes(a.kind);
const clarifies=t=>/什么|哪(?:张|幅|个|种)|要不要|需要.{0,8}吗|现在.{0,10}吗|引用|还没有.{0,12}(?:图|作品|画作)/.test(t);

export function photoDecisionNeedsRepair(text,decision){
  const request=photoExecutionRequest(text),actions=decision.actions||[];
  if(!request&&actions.some(imageAction))return true;
  if(actions.some(a=>a.type==='media'&&a.kind==='photo')&&request?.mode!=='create')return true;
  const valid=actions.some(a=>imageAction(a)&&(request?.mode==='create'?a.kind==='photo':a.kind==='forward'));
  if(valid)return false; // The acknowledgement is grounded after executing this action.
  if(photoExecutionClaim(decision.reply,request))return true;
  if(!request)return false;
  return !clarifies(decision.reply);
}

export function photoJobMatches(text,job){
  if(!job?.status)return false;
  if(/画作|草稿|素描|画的(?:图|画)|画完|画好|绘画/.test(String(text)))return /画|绘|素描|草稿|作品|作业/.test(String(job.scene||job.prompt||''));
  return true;
}

export function photoExecutionFallback(text){
  const request=photoExecutionRequest(text);
  if(request?.mode==='create')return '这张图还没开始制作。你想要什么具体画面呀？';
  if(request)return '我这边还没有核实到可以发给你的这幅作品。你可以引用那张原图；如果想现在画一张，告诉我想画什么就好。';
  return '刚才说得不准确，我这边没有实际在制作的画作，也没有稍后发图的安排。';
}

export function photoReceiptReply(job={}){
  if(job.status==='completed')return '这张图已经确认发给你啦。';
  if(job.status==='failed')return '这张图没能做好，还没有发给你。';
  if(job.status==='cancelled')return '这张图已经停下，就先不发了。';
  if(job.status==='uncertain')return '这张图的进展还没确认，暂时没能发给你。';
  if(job.phase==='file_ready')return '这张图已经做好了，还没确认发到你那边。';
  if(['downloading','retry_wait'].includes(job.phase))return '这张图还没完整传过来，暂时还没发给你。';
  if(['polling','poll_wait'].includes(job.phase))return '这张图还在等结果，暂时没能发给你。';
  if(job.status==='queued')return '这张图已经排上了，还没开始制作，做好后发给你。';
  return '这张图已经接下了，还没确认做好和发出。';
}
