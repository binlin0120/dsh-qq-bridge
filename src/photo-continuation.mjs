import crypto from 'node:crypto';

export function photoContinuationRequest(value){
  const text=String(value??'').trim().replace(/[\s，,。.!！~～]+$/g,'');
  if(!text||text.length>100||/不要|不用|不想|取消|停止|他说|她说|比如|如果|假如|之前|以前|上次|昨天|原图|旧图|发过|[“”「」"'？?]|本次附件资料|private:|group:|\d{5,}/.test(text))return null;
  if(/^(?:好|好的|可以|行|是的|嗯嗯)$/.test(text))return 'confirm';
  return /^(?:(?:我)?(?:想|要|还想)(?:看|看看)(?:你(?:自己)?(?:画|做)的(?:图|画|作品)?)?|(?:那|好|行)?你?(?:现在|这就|马上)?(?:给我|让我)(?:看|看看|看下)(?:吧|呀|啊)?|(?:那)?(?:就)?(?:现在|马上|这就)(?:画|给我画)(?:吧|呀|啊)?)$/.test(text)?'view':null;
}

function isOffer(text){
  return /(?:我(?:可以|能|来)|那我).{0,10}(?:现在|马上|这就).{0,8}(?:给你|帮你)?画(?:一张|张|一幅)|要不要.{0,6}(?:我)?画(?:一张|张|一幅)|你(?:是)?想让我现在画一张给你看吗/.test(text);
}

export function resolvePhotoContinuation({text,origin,actorQQ,requestId,records=[],history=[],job,now=Date.now()}){
  const followup=photoContinuationRequest(text);
  if(!followup||!origin.startsWith('private:'))return null;
  const scoped=records.filter(r=>r.id!==requestId&&r.origin===origin&&r.actorQQ===String(actorQQ)&&r.at<=now&&now-r.at<86400000).sort((a,b)=>b.at-a.at);
  const recent=scoped.filter(r=>now-r.at<1800000);
  const bound=scoped.find(r=>r.engine==='media'&&r.externalId===job?.id&&(r.photoContinuation?.kind==='offer'||r.actions?.some(a=>a.type==='media'&&a.kind==='photo')));
  if(followup==='view'&&bound&&!scoped.some(r=>r.at>bound.at&&(r.actions||[]).some(a=>a.type!=='media')))return {text:'画完给我看看',kind:'job',sourceRequestId:bound.id,jobId:job.id};
  // Actual outgoing history is necessary but not sufficient: attest it against a sent receipt.
  const outgoing=history.filter(x=>x.dir==='out').slice(-6).reverse();
  for(let i=0;i<outgoing.length;i++){
    if(followup==='confirm'&&i>0)break;
    const message=String(outgoing[i].text||'');if(!isOffer(message))continue;
    const key=origin+':'+crypto.createHash('sha256').update(message).digest('hex');
    const source=recent.find(r=>r.status==='completed'&&r.outputs?.[key]?.status==='sent');
    if(!source)continue;
    // An intervening concrete operation changes the topic; do not borrow an older offer.
    if(recent.some(r=>r.at>source.at&&(r.actions||[]).some(a=>a.type!=='media')))return null;
    return {text:'现在给我画一张图看看',kind:'offer',sourceRequestId:source.id};
  }
  return null;
}
