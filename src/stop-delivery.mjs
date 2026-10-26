
export function stopIntent(text){
 const t=String(text||'').trim();
 if(!t||/^(?:如果|假如|假设|他说|她说|引用|比如)|怎么.{0,8}(?:停|取消)|如何.{0,8}(?:停|取消)/.test(t))return null;
 if(/(?:不要|别|不用).{0,5}(?:停止|停下|取消任务|取消工作)/.test(t))return null;
 // Progress preference alone must never cancel the requested work.
 if(/进度|汇报|播报|报告/.test(t)&&!/(?:任务|工作).{0,6}(?:停止|取消|别做)|(?:停止|取消).{0,6}(?:任务|工作)/.test(t))return null;
 if(/(?:全部|所有|都|全).{0,8}(?:停|取消|别做)|(?:停|取消).{0,8}(?:全部|所有)/.test(t))return 'cancel';
 if(/^(?:先)?(?:停下|停止任务|取消任务|停止工作|取消工作|暂停任务|别做了|不用做了|不要做了|不做了|先别做了)[！!。\s]*$/.test(t)||/(?:把|将).{0,25}(?:任务|工作).{0,6}(?:停掉|停止|取消)/.test(t))return 'cancel';
 if(/(?:不用|不要|不必|别).{0,8}(?:告诉我|给我发|发给我|再发|发送|再说|说了|发了)/.test(t)&&!/继续做|接着做|继续干/.test(t))return 'stop_delivery';
 return null;
}
export function taskCanDeliver(j){return !!j&&!j.deliverySuppressedAt&&!['stopping','cancelled','superseded'].includes(j.status);}
