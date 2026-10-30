// media: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["AbortSignal","DRAW_DIR","MAX_MEDIA_PIXELS","PHOTO_LOOK","ROOT","STATE_DIR","assertGroupMedia","groupAuthority","canSendNow","caps","cfg","dailyQuota","downloadImage","escapeCqText","fetch","fs","getImageDimensions","handleCompanionActions","imageResult","inQuietHours","isOwnerKey","log","looksLikeImageBuffer","mediaFailure","mediaJobs","memoryHistory","noteGuestChat","noteOutsideShare","noteOwnerChat","noteRelay","oneBotCall","os","outTarget","ownerChat","ownerMemoryScope","parallelDownloadImage","path","photoPublicReply","preparePhotoReferences","process","readImageJson","readJsonSafe","renderTaskNotice","resolveSafeAddresses","sayBridge","scrubPrivate","selectImageDownloadIps","sendChain","shortChain","sleep","sleepMs","state","submitImageTask","takeQuota","temporal","truncateText","validateFetchUrl"];
export function createMedia(deps){
async function sendImageTo(key, buffer, caption, guard) {
    deps.outTarget(key);
    validateImage(buffer);
    const [kind, id] = key.split(':');
    const message = [{ type: 'image', data: { file: 'base64://' + buffer.toString('base64') } }];
    if (caption) message.push({ type: 'text', data: { text: deps.escapeCqText(String(caption)) } });
    const params = kind === 'private' ? { user_id: Number(id), message } : { group_id: Number(id), message };
    const pending=deps.sendChain.then(async()=>{await guard?.();deps.outTarget(key);return deps.oneBotCall(kind === 'private' ? 'send_private_msg' : 'send_group_msg', params);});
    deps.sendChain=pending.catch(()=>{}).then(()=>deps.sleep(deps.cfg.sendDelayMs));
    const data = await pending;
    return data?.message_id ?? null;
  }

async function sendFileTo(key, real, name, guard) {
    guard?.();
    deps.outTarget(key);
    const [kind, id] = key.split(':');
    const file = 'base64://' + deps.fs.readFileSync(real).toString('base64');
    const pending=deps.sendChain.then(()=>{guard?.();deps.outTarget(key);return deps.oneBotCall(kind==='private'?'upload_private_file':'upload_group_file',kind==='private'?{user_id:Number(id),file,name}:{group_id:Number(id),file,name});});
    deps.sendChain=pending.catch(()=>{}).then(()=>deps.sleep(deps.cfg.sendDelayMs));await pending;
  }

function laneKey() {
    const name=deps.cfg.draw?.apiKeyEnv||'IMAGE_API_KEY';
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw Error('draw.apiKeyEnv 格式无效');
    const key=deps.process.env[name];if(!key)throw Error('图片服务密钥环境变量尚未配置');return key;
  }

async function curlDownload(u, tmp, job) {
    const progress=fields=>{if(job)deps.mediaJobs.update(job,{...fields,downloadPercent:fields.totalBytes?Math.floor(fields.downloadedBytes/fields.totalBytes*100):0,phase:'downloading',lastProgressAt:Date.now()});};
    const checked = await deps.validateFetchUrl(u);
    if (checked.url.protocol !== 'https:') throw new Error('图片链接必须为HTTPS');
    const host=new URL(u).hostname;
    const dnsIps=(await deps.resolveSafeAddresses(host)).filter(x=>!x.includes(':'));
    const ips=deps.selectImageDownloadIps(host,dnsIps,deps.readJsonSafe(deps.path.join(deps.STATE_DIR,'image-download-routes.json'),{}));
    if(!ips.length)throw Error('图床没有可用公网IPv4地址');
    if(deps.cfg.draw?.parallelDownload===true){try{return await deps.parallelDownloadImage(u,tmp,ips,{validate:validateImage,log: deps.log,progress,segments:deps.cfg.draw.downloadSegments||16,concurrency:deps.cfg.draw.downloadConcurrency||4});}catch(e){if(e.code!=='PARALLEL_UNSUPPORTED')throw e;deps.log('图床不支持可校验分段，改为完整取回');}}
    return deps.downloadImage(u,tmp,ips,{validate:validateImage,log: deps.log,progress});
  }

/** 异步画图：提交任务 → 每 5 秒查一次 → 画好用 curl 下载（这台机器上 Node 连那个图床会超时） */
  async function drawImage(prompt, size, aspect, job) {
    const base = String(deps.cfg.draw?.baseUrl || '').replace(/\/+$/, '');
    if(!base)throw Error('请先配置 draw.baseUrl 图片服务地址');
    const model = String(deps.cfg.draw?.model || 'gpt-image-2');
    const headers = { authorization: `Bearer ${laneKey()}`, 'content-type': 'application/json' };
    const input = { prompt: String(prompt), aspect_ratio: String(aspect || '1:1') };
    if(job?.character&&!job.taskId&&!job.resultUrl){const refs=(deps.cfg.draw?.referenceFiles||[]).map(p=>deps.path.resolve(deps.ROOT,p));if(refs.length!==2)throw Object.assign(Error('需要先配置 draw.referenceFiles 的两张角色参考图'),{code:'IMAGE_REFERENCE_INVALID'});const prepared=await deps.preparePhotoReferences({files:refs,cacheDir:deps.path.join(deps.STATE_DIR,'photo-reference-cache'),scriptPath:deps.path.join(deps.ROOT,'scripts/prepare-photo-references.py'),validate:validateImage});input.images=prepared.images;if(job)deps.mediaJobs.update(job,{referenceBytes:prepared.report.encodedBytes,referenceHashes:prepared.report.references.map(r=>r.sourceSha256)});input.prompt+=' 两张参考都是鲸鲸自己的角色照片，以参考图保持同一个人的脸型、五官、眼镜和发型；有人物时只用鲸鲸的参考脸，不另造人物、不生成其他人。物品或餐食照片无需人物出镜。按新场景改变动作、衣着和环境，不照搬旧背景。';}
    // 默认尺寸：config.json 的 draw.imageSize（出厂 1K）。显式传 size 时以传参为准。
    const imageSize = String(size || deps.cfg.draw?.imageSize || '1K');
    if (imageSize) input.image_size = imageSize;
    input.n=1;
    if(deps.cfg.draw?.resultFormat==='b64_json'&&deps.cfg.draw?.b64AsyncSupported===true){const capability=deps.readJsonSafe(deps.path.join(deps.STATE_DIR,'image-capabilities.json'),{});const route=capability.routes?.find(x=>x.url===base+'/task/submit'&&x.model===model);if(route?.responseFormats?.b64_json!=='supported')throw Error('当前图片路由没有验证通过Base64返回能力，未提交付费任务');input.response_format='b64_json';}
    // OpenAI image routes use size; image_size alone may be ignored upstream.
    if(/^\d+x\d+$/.test(imageSize))input.size=imageSize;
    else {const edge=/^2K$/i.test(imageSize)?2048:/^4K$/i.test(imageSize)?4096:1024;const [aw,ah]=String(aspect||'1:1').split(':').map(Number);if(aw>0&&ah>0){const scale=edge/Math.max(aw,ah);input.size=`${Math.max(16,Math.round(aw*scale/16)*16)}x${Math.max(16,Math.round(ah*scale/16)*16)}`;}else input.size=`${edge}x${edge}`;}

    let tid=job?.taskId;
    if(!tid&&!job?.resultUrl)tid=await deps.submitImageTask({url:base+'/task/submit',key:laneKey(),payload:{model,input},job:job||{},routeStateFile:deps.path.join(deps.STATE_DIR,'image-upload-routes.json'),log: deps.log,update:fields=>{if(job)deps.mediaJobs.update(job,fields);}});

    let url = job?.resultUrl || '';let buf;
    const pollDeadline=Date.now()+300000;
    for (let i = 0; i < 60 && !url && !buf && Date.now()<pollDeadline; i++) {
      await deps.sleepMs(5000);
      try {
        const q = await deps.fetch(`${base}/task/${encodeURIComponent(tid)}`, { headers, signal: deps.AbortSignal.timeout(Math.max(1000,Math.min(30000,pollDeadline-Date.now()))) });
        if(!q.ok)throw Object.assign(Error('图片进度查询 HTTP '+q.status),{code:'IMAGE_POLL_PENDING'});
        const qj = await deps.readImageJson(q).catch(error => {throw Error('画图失败：结果响应无效或超过限制');});
        if (qj.status === 'failed' || qj.status === 'error' || qj.status === 'cancelled') throw Object.assign(new Error(`画图失败：${deps.truncateText(JSON.stringify(qj.error ?? qj.result ?? qj.status), 200)}`),{code:'IMAGE_GENERATION_FAILED'});
        if(qj.status==='completed'){
          try{const result=deps.imageResult(qj,{validate:validateImage});if(!result)throw Error('任务已完成但结果缺少可取回的图片');url=result.url||'';buf=result.buffer;}
          catch(e){throw Error('画图失败：'+e.message);}
        }
      } catch (error) {
        if (String(error?.message).startsWith('画图失败')) throw error;
      }
    }
    if (!url&&!buf) throw Object.assign(new Error('图片仍在原任务中等待结果'),{code:'IMAGE_POLL_PENDING'});
    if(job) deps.mediaJobs.update(job,{...(url?{resultUrl:url}:{}),status:'running',phase:buf?'file_ready':'downloading'});
    if(!buf)buf = await curlDownload(url, deps.path.join(deps.os.tmpdir(), `jj-draw-${job?.id || Date.now()}.part`),job);
    validateImage(buf);
    deps.fs.mkdirSync(deps.DRAW_DIR, { recursive: true });
    const stamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(/[-: ]/g, '').slice(0, 14);
    const file = deps.path.join(deps.DRAW_DIR, `${job?.id || stamp}.png`);
    deps.fs.writeFileSync(file, buf);
    return { file, bytes: buf.length, model };
  }

function validateImage(buf) {
    if(!deps.looksLikeImageBuffer(buf) || buf.length>20*1024*1024) throw new Error('图片格式无效或超过20MB');
    if(buf.subarray(1,4).toString()==='PNG' && !buf.subarray(-12).includes(Buffer.from('IEND'))) throw new Error('PNG不完整');
    if(buf[0]===255 && buf[1]===216 && !(buf.at(-2)===255 && buf.at(-1)===217)) throw new Error('JPEG不完整');
    if(buf.subarray(0,4).toString()==='RIFF' && buf.readUInt32LE(4)+8!==buf.length) throw new Error('WebP长度不一致');
    const dims=deps.getImageDimensions(buf);if(!dims || dims.width<=0 || dims.height<=0 || dims.width*dims.height>deps.MAX_MEDIA_PIXELS) throw new Error('图片尺寸无效或像素超限');
  }

async function runMediaJob(j) {
    if(j.chainRequestId&&deps.shortChain){const r=deps.shortChain.record(j.chainRequestId);if(!r||r.cancelledAt||j.chainCancelled)return;deps.shortChain.guard({...r,owner:true},r);}
    if(j.character&&j.target.startsWith('group:'))await deps.assertGroupMedia(j.authorization,j.target,'photo');
    deps.outTarget(j.target);
    if(!deps.canSendNow(j.target,{direct:j.direct===true})) {
      const d=new Date(Date.now()+8*3600000);const next=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+(d.getUTCHours()>=23?1:0),0);
      deps.mediaJobs.update(j,{status:'queued',nextAt:next});return;
    }
    const recovered=deps.path.join(deps.DRAW_DIR,j.id+'.png');if(!j.file&&deps.fs.existsSync(recovered)){validateImage(deps.fs.readFileSync(recovered));deps.mediaJobs.update(j,{file:recovered});}
    if(!j.file || !deps.fs.existsSync(j.file)) {
      const r=await drawImage(j.prompt,j.size,j.aspect,j); deps.mediaJobs.update(j,{file:r.file});
    }
    deps.outTarget(j.target);
    if(!deps.canSendNow(j.target,{direct:j.direct===true})) {deps.mediaJobs.update(j,{status:'queued',nextAt:Date.now()+60000});return;}
    if(j.character&&j.target.startsWith('group:'))await deps.assertGroupMedia(j.authorization,j.target,'photo');
    if(j.character&&Date.now()-j.at>30*60000&&!j.captionRefreshed){
      j.caption=await deps.renderTaskNotice({key:j.target,task:'把此前用户要求的照片补给对方',status:'running',stage:'原照片已完整保存，尚未发送',scene:j.scene},{kind:'delayed_photo',originalScene:j.scene,originalAt:j.at,originalCaption:j.caption,requirement:'沿用原照片场景，不说刚拍，不追问用户是否还醒着'});j.captionRefreshed=true;deps.mediaJobs.save();
    }
    const latestOwnerText=deps.memoryHistory(deps.ownerMemoryScope,deps.ownerChat).filter(x=>x.dir==='in').at(-1)?.text||'';
    if(j.character&&deps.isOwnerKey(j.target)&&(deps.state.ownerQuiet||(deps.inQuietHours()&&/晚安|睡了|睡觉|马上就睡|^眠$/.test(latestOwnerText)))){deps.mediaJobs.update(j,{status:'queued',phase:'file_ready',nextAt:Date.now()+15*60000});return;}
    if(j.chainRequestId&&deps.shortChain){const r=deps.shortChain.record(j.chainRequestId);deps.shortChain.guard({...r,owner:true},r);}
    deps.mediaJobs.update(j,{status:'sending'});
    const imageGuard=()=>{if(j.chainRequestId&&deps.shortChain){const r=deps.shortChain.record(j.chainRequestId);deps.shortChain.guard({...r,owner:true},r);}if(j.character&&j.target.startsWith('group:'))return deps.assertGroupMedia(j.authorization,j.target,'photo');};const imageReceipt=await sendImageTo(j.target,deps.fs.readFileSync(j.file),j.caption,imageGuard);
    if(imageReceipt===null||imageReceipt===undefined)throw Error('图片发送结果未知，不能确认送达');
    deps.mediaJobs.update(j,{status:'completed',phase:'completed',deliveryMessageId:imageReceipt,doneAt:Date.now(),error:null,nextAt:0});if(j.chainRequestId&&deps.shortChain){const r=deps.shortChain.record(j.chainRequestId);if(r&&!r.cancelledAt){r.status='completed';r.result='照片已确认发送';deps.shortChain.put(r);}}
    deps.temporal.verified(j.target,{entity:'照片送达:'+j.id,description:j.scene||j.prompt||'图片',status:'completed',at:j.doneAt,sourceId:j.id,sourceKind:'qq_delivery_receipt'});
    if(j.character){deps.caps.photoSent(j.target);if(!deps.caps.data.life||Number(deps.caps.data.life.at)<=Number(j.at))deps.caps.data.life={scene:j.scene||'',caption:j.caption||'',at:j.at,deliveredAt:Date.now()};deps.caps.data.lifeHistory=[...(deps.caps.data.lifeHistory||[]),deps.caps.data.life].slice(-20);deps.caps.save();}
    if(deps.isOwnerKey(j.target)){const text=`（${j.character?'照片':'画图'}已送达，拍摄场景时间${new Date(j.at).toISOString()}）${j.scene||j.prompt}\n配文：${j.caption||''}`;deps.noteOwnerChat('out',text);deps.noteOutsideShare(j.target,text);}
    else {deps.noteGuestChat(j.target,{dir:'out',text:`（${j.character?'照片':'画图'}已送达，原场景时间${new Date(j.at).toISOString()}）${j.scene||j.prompt} 配文：${j.caption||''}`});deps.noteRelay(j.target,`（发了一张图）${j.prompt}`);}
    deps.log(`画图任务已送达 ${j.id}`);
  }

async function processMediaJob(j){
    try{await runMediaJob(j);if(j.chainRequestId&&deps.shortChain)deps.shortChain.syncMedia(j);}
    catch(e){
      deps.log(`画图任务 ${j.id} 未完成：${e.message}`);
      const failure=deps.mediaFailure(e,j);const mayRetry=failure.retryable&&Date.now()-j.at<6*3600000;
      deps.mediaJobs.update(j,{...failure,status:mayRetry?'queued':failure.status==='queued'?'failed':failure.status,error:String(e.message).slice(0,300),errorCode:failure.code,...(mayRetry?{downloadFailures:(j.downloadFailures||0)+1,nextAt:Date.now()+Math.min(15*60000,60000*2**Math.min(j.downloadFailures||0,4))}:{})});
      if(j.chainRequestId&&deps.shortChain)deps.shortChain.syncMedia(j);
      if(mayRetry)return;
      const key=j.target;
      if(!key.startsWith('group:')&&!j.chainCancelled&&!j.failureNotifiedAt&&!j.failureNoticeState&&deps.canSendNow(key,{direct:j.direct===true})){
        const text=deps.photoPublicReply(j);deps.mediaJobs.update(j,{failureNoticeState:'sending'});const receipt=await deps.sayBridge(key,text,{nativeVoice:true});
        deps.mediaJobs.update(j,{failureNotifiedAt:Date.now(),failureNoticeState:receipt?.ok?'sent':'unknown'});
      }
      throw e;
    }
  }

function photoPrompt(scene){return deps.PHOTO_LOOK+'\n当前生活场景：'+deps.scrubPrivate(scene);}

async function queueCharacterPhoto(key,scene,{caption='',direct=true,authorization=null}={}){
    if(key.startsWith('group:'))await deps.assertGroupMedia(authorization,key,'photo');deps.outTarget(key);
    if(key.startsWith('private:')&&!deps.isOwnerKey(key)&&!deps.cfg.guestPhotos.enabled)throw Error('照片暂时发不了');
    if(/身份证|住址|手机号|色情|裸体|内衣|比基尼|未成年|真名|机主|机主|其他人|别人的照片|真实朋友|两个人/.test(scene))throw Error('这个不拍 换个日常的吧');
    const prompt=photoPrompt(scene);const old=Object.values(deps.mediaJobs.data).find(j=>j.target===key&&(key.startsWith('group:')?j.authorization?.id===authorization?.id:j.prompt===prompt&&Date.now()-j.at<600000&&!['failed','uncertain'].includes(j.status)));if(old)return old;
    const guestPhoto=!deps.isOwnerKey(key)&&!key.startsWith('group:');
    if(guestPhoto||authorization?.kind==='member'){if(deps.cfg.usageLimits&&deps.dailyQuota.count('draw')>=deps.cfg.draw.dailyLimit-deps.cfg.guestPhotos.ownerReserve)throw Error('今天照片额度不够啦');if(guestPhoto&&deps.dailyQuota.count('guest:'+key)>=deps.cfg.guestPhotos.perDay)throw Error('今天先不拍了');}
    if(deps.cfg.usageLimits&&deps.dailyQuota.count('draw')>=deps.cfg.draw.dailyLimit)throw Error('今天照片额度不够啦');
    if(authorization?.kind==='member')deps.groupAuthority.admitMember(authorization,key);
    if(guestPhoto)deps.dailyQuota.take('guest:'+key,deps.cfg.guestPhotos.perDay);deps.takeQuota('draw',deps.cfg.draw.dailyLimit);
    return deps.mediaJobs.add({kind:'draw',target:key,prompt,caption:String(caption).slice(0,400),guest:guestPhoto||authorization?.kind==='member',character:true,direct,authorization,scene:String(scene).slice(0,500)});
  }

async function handleGuestPhoto(key,plain) {return deps.handleCompanionActions(key,plain);}
return {sendImageTo,sendFileTo,laneKey,curlDownload,drawImage,validateImage,runMediaJob,processMediaJob,photoPrompt,queueCharacterPhoto,handleGuestPhoto};
}
