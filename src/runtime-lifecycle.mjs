// Fatal failures never resume normal application execution.
export function installLifecycle({runtimeProcess=process,log=()=>{},snapshot=()=>{},canSnapshot=()=>true,release=()=>{},stopAccepting=()=>{},redact=s=>String(s)}){
 let stopping=false;const failures=[];
 const safe=(name,fn)=>{try{fn();}catch{failures.push(name);}};
 const shutdown=(reason,code=1)=>{if(stopping){safe('release',release);runtimeProcess.exit(code||1);return;}stopping=true;safe('stop',stopAccepting);safe('log',()=>log(code?'进程异常退出，等待守护恢复':'退出中',redact(reason?.stack||reason?.message||reason||'shutdown')));try{safe('snapshot',()=>{if(canSnapshot())snapshot();});}finally{try{safe('release',release);}finally{runtimeProcess.exit(code);}}};
 const handlers={unhandledRejection:error=>shutdown(error,1),uncaughtException:error=>shutdown(error,1),SIGTERM:()=>shutdown('SIGTERM',0),SIGINT:()=>shutdown('SIGINT',0),exit:()=>safe('release',release)};
 for(const [event,fn] of Object.entries(handlers))runtimeProcess.on(event,fn);
 return {shutdown,get stopping(){return stopping;},failures,dispose(){for(const [event,fn] of Object.entries(handlers))runtimeProcess.removeListener(event,fn);}};
}
