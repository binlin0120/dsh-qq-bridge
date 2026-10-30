// input-media: explicit live dependencies preserve shared state and authority boundaries.
export const dependencies=["GROUP_MEMBER_IDS_TTL_MS","GROUP_MEMBER_NAME_TTL_MS","INBOX_DIR","MAX_MEDIA_BYTES","MAX_MEDIA_COUNT","MAX_MEDIA_PIXELS","REPLY_INFO_TTL_MS","REPLY_NEGATIVE_TTL_MS","bot","caps","cfg","crypto","currentMode","event_selfId","execFileSync","extractMediaFromSegments","fs","getSocialV2State","groupMemberIdsCache","groupMemberNameCache","groupMessage","isOwnerKey","log","looksLikeImageBuffer","messageMediaStore","oneBotCall","path","process","replyInfoCache","safeFetchBuffer","safeFetchBytes","safeFileName","scrubPrivate","segmentsToText","sleepMs","socialV2","todayStr","work"];
export function createInputMedia(deps){
/** 机主发来的文件存到 工作目录/收到的文件/日期/；语音转文字。返回要附给她的说明 */
  async function buildInboundNote(key, kind, id, event) {
    const segs = Array.isArray(event.message) ? event.message : [];
    const notes = [];
    for (const seg of segs) {
      const d = seg?.data ?? {};
      if (seg?.type === 'file' && deps.isOwnerKey(key)) {
        const name = deps.safeFileName(d.name ?? d.file_name ?? d.file);
        try {
          const fileId = d.file_id ?? d.fileId ?? d.id ?? d.file;
          let url = d.url ? String(d.url) : '';
          if (!url) {
            const r = await deps.oneBotCall('get_private_file_url', { user_id: Number(id), file_id: fileId, ...(d.file_hash ? { file_hash: d.file_hash } : {}) });
            url = String(r?.url ?? r?.download_url ?? '');
          }
          if (!url) throw new Error('拿不到下载链接');
          const buf = (await deps.safeFetchBytes(url, 50 * 1024 * 1024)).buffer;
          const dir = deps.path.join(deps.INBOX_DIR, deps.todayStr());
          deps.fs.mkdirSync(dir, { recursive: true });
          let dest = deps.path.join(dir, name);
          if (deps.fs.existsSync(dest)) dest = deps.path.join(dir, `${Date.now()}-${name}`);
          deps.fs.writeFileSync(dest, buf);
          notes.push(`【文件】机主发来的「${name}」已存到 ${dest}（${Math.round(buf.length / 1024)} KB，SHA256=${deps.crypto.createHash('sha256').update(buf).digest('hex')}），要看就去打开`);
          deps.log(`收到文件：${name} → ${dest}`);
          try {
            const f = deps.work.addInput(key, name, buf);
            notes.push(`【隔离工作文件】${f.name}也已登记，文件号${f.id}；可交给隔离工作任务处理。`);
          } catch (error) {
            deps.log(`隔离工作文件登记失败 ${name}：${error?.message ?? error}`);
            notes.push(`【隔离工作文件】原文件已保存，但隔离任务登记失败：${deps.scrubPrivate(error?.message ?? String(error))}`);
          }
        } catch (error) {
          deps.log(`收文件失败 ${name}：${error?.message ?? error}；段落字段：${Object.keys(d).join(',')}`);
          notes.push(`【文件】机主发了「${name}」，但没下载下来（${error?.message ?? error}）`);
        }
      } else if(seg?.type==='file' && deps.caps.mayWork(key)){
        try{const name=deps.safeFileName(d.name??d.file_name??d.file);let u=d.url?String(d.url):'';if(!u){const r=await deps.oneBotCall('get_private_file_url',{user_id:Number(id),file_id:d.file_id??d.fileId??d.id??d.file,...(d.file_hash?{file_hash:d.file_hash}:{})});u=String(r?.url??r?.download_url??'');}if(!u)throw Error('拿不到下载链接');const buf=(await deps.safeFetchBytes(u,50*1024*1024)).buffer;const f=deps.work.addInput(key,name,buf);notes.push(`【工作文件】${f.name}已登记，仅当前管理员自己的任务可用，文件号${f.id}。需要处理时用【工作：任务描述】，联网需明确写【工作：联网 任务描述】。`);}
        catch(e){notes.push('【工作文件】未收好：'+deps.scrubPrivate(e.message));}
      } else if (seg?.type === 'record') {
        let textOut = '';
        for (let i = 0; i < 3 && !textOut; i++) {
          try {
            const r = await deps.oneBotCall('fetch_ptt_text', { message_id: String(event.message_id ?? '') });
            textOut = String(r?.text ?? '').trim();
          } catch {}
          if (!textOut) await deps.sleepMs(1500);
        }
        notes.push(textOut ? `【语音转文字】${textOut}` : '【语音】（没转出文字，可以让对方打字说）');
      }
    }
    return notes.length ? '\n' + notes.join('\n') : '';
  }

async function fetchHistoryLines(key, count) {
    const [kind, id] = key.split(':');
    const n = Math.min(100, Math.max(1, Number(count) || 20));
    const data = kind === 'group'
      ? await deps.oneBotCall('get_group_msg_history', { group_id: Number(id), count: n })
      : await deps.oneBotCall('get_friend_msg_history', { user_id: Number(id), count: n });
    const list = Array.isArray(data?.messages) ? data.messages : (Array.isArray(data) ? data : []);
    const out = [];
    for (const m of list) {
      const who = String(m.user_id ?? m.sender?.user_id ?? '') === String(deps.event_selfId()) ? '你' : (m.sender?.card || m.sender?.nickname || String(m.user_id ?? '?'));
      const txt = await deps.segmentsToText(Array.isArray(m.message) ? m.message : [], { includeReply: false }).catch(() => '');
      out.push({ ...deps.groupMessage(m,String(txt||m.raw_message||''),deps.event_selfId(),deps.cfg.ownerQQ,deps.extractMediaFromSegments(Array.isArray(m.message)?m.message:[])), who });
    }
    return out;
  }

// ── 图片/表情字节解析（供一代自动内联与二代按需工具） ────────────────────
  function mimeFromBuffer(buf) {
    if (!buf || buf.length < 12) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
    return 'image/jpeg';
  }

function mimeFromUrl(url, fallback = 'image/jpeg') {
    try {
      const pathname = new URL(String(url)).pathname.toLowerCase();
      if (pathname.endsWith('.png')) return 'image/png';
      if (pathname.endsWith('.webp')) return 'image/webp';
      if (pathname.endsWith('.gif')) return 'image/gif';
      if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    } catch {}
    return fallback;
  }

// 解析常见图片宽高（PNG/JPEG/GIF；WebP 暂不解析返回 null）。
  // 用于限制“图片炸弹”的解码像素量。
  function getImageDimensions(buf) {
    if (!buf || buf.length < 24) return null;
    try {
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
      if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
      }
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        let offset = 2;
        while (offset + 9 < buf.length) {
          if (buf[offset] !== 0xff) { offset += 1; continue; }
          const marker = buf[offset + 1];
          if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
          const len = buf.readUInt16BE(offset + 2);
          if (len < 2) return null;
          // SOF0-SOF15（排除 DHT C4、DAC CC、DNL DC、DRI DD）
          if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
          }
          offset += 2 + len;
        }
      }
      // WebP：解析 VP8X / VP8L / VP8 三种容器，避免“图片炸弹”绕过像素上限。
      if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const fourcc = buf.toString('ascii', 12, 16);
        if (fourcc === 'VP8X' && buf.length >= 30) {
          const width = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
          const height = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
          return { width, height };
        }
        if (fourcc === 'VP8L' && buf.length >= 25) {
          const bits = [buf[21], buf[22], buf[23], buf[24]];
          const width = 1 + (((bits[1] & 0x3f) << 8) | bits[0]);
          const height = 1 + (((bits[3] & 0x0f) << 10) | (bits[2] << 2) | ((bits[1] & 0xc0) >> 6));
          return { width, height };
        }
        if (fourcc === 'VP8 ' && buf.length >= 30) {
          const width = buf.readUInt16LE(26) & 0x3fff;
          const height = buf.readUInt16LE(28) & 0x3fff;
          return { width, height };
        }
      }
    } catch {}
    return null;
  }

function base64FromMaybe(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    if (!s) return null;
    if (s.startsWith('base64://')) return s.slice('base64://'.length).replace(/\s/g, '');
    if (s.startsWith('data:image/')) {
      const idx = s.indexOf(',');
      if (idx >= 0) return s.slice(idx + 1).replace(/\s/g, '');
    }
    // 纯 base64（允许少量空白）
    if (/^[A-Za-z0-9+/=\s]+$/.test(s)) return s.replace(/\s/g, '');
    return null;
  }

function isSafeLocalMediaPath(filePath) {
    try {
      const real = deps.fs.realpathSync(String(filePath));
      const homeDir = deps.cfg.snowluma?.homeDir ? String(deps.cfg.snowluma.homeDir) : null;
      if (!homeDir) return false;
      const realHome = deps.fs.realpathSync(homeDir);
      return real === realHome || real.startsWith(realHome + deps.path.sep);
    } catch {
      return false;
    }
  }

// OneBot 图片 file 字段只应接受简单缓存文件名；拒绝路径、URL、盘符、协议前缀等，
  // 防止把任意本地路径/内网 URL 交给网关 get_image 造成 SSRF/任意文件读取。
  function isProbablySafeImageFileRef(file) {
    const s = String(file ?? '').trim();
    if (!s || s.length > 512) return false;
    if (/[\u0000-\u001f\u007f]/.test(s)) return false;
    if (/[\\/]/.test(s)) return false;
    if (/^[a-zA-Z]:/.test(s)) return false;
    if (/^(file|https?|base64|data):/i.test(s)) return false;
    if (s.includes('..')) return false;
    return /^[\w.+=@-]+$/.test(s);
  }

// QQ 表情包 CDN 的地址可以只靠 emoji_id 推出来（实测形态：
  // https://gxh.vip.qq.com/club/item/parcel/item/<id 前两位>/<id>/raw300.gif）。
  // 市场表情不在网关缓存里（get_image 返回 image not found in cache），url 又可能缺失，
  // 这条兜底能救回这一类；只接受纯十六进制 id，绝不把任意字符串拼进 URL。
  function emojiCdnCandidates(emojiId) {
    const id = String(emojiId ?? '').trim();
    if (!/^[0-9a-f]{16,64}$/i.test(id)) return [];
    return [`https://gxh.vip.qq.com/club/item/parcel/item/${id.slice(0, 2)}/${id}/raw300.gif`];
  }

// 有些网关不带 emoji_id，但 file 名里就嵌着它（实测 "f9-<32 位 hex>.gif"）。
  function emojiIdFromFileName(file) {
    const match = /(?:^|[^0-9a-f])([0-9a-f]{32})\.(?:gif|png|jpe?g|webp)$/i.exec(String(file ?? '').trim());
    return match ? match[1] : '';
  }

/** 校验一张图片字节：格式、大小（调用方已限）、像素上限；不通过返回 null。 */
  function acceptImageBuffer(buf, label = '图片') {
    if (!buf || !buf.length) return null;
    if (!deps.looksLikeImageBuffer(buf)) {
      deps.log(`${label}不是有效图片（PNG/JPEG/GIF/WebP），已跳过`);
      return null;
    }
    const dims = getImageDimensions(buf);
    if (dims && dims.width * dims.height > deps.MAX_MEDIA_PIXELS) {
      deps.log(`${label}像素超限，已跳过（${dims.width}x${dims.height}）`);
      return null;
    }
    return { buffer: buf, mimeType: mimeFromBuffer(buf) };
  }

async function fetchOneBotImage(media) {
    // 表情包（市场/收藏表情）优先走 CDN：get_image 对市场表情必然失败
    // （SnowLuma 缓存里没有该文件），先试 URL 能省一次失败往返，也更可靠。
    const emojiId = String(media.emojiId || emojiIdFromFileName(media.file) || '');
    const isSticker = media.kind === 'sticker' || !!emojiId || String(media.subType || '') === '1';
    const label = isSticker ? '表情' : '图片';
    const failures = [];
    const urls = [];
    const pushUrl = (raw) => {
      const s = String(raw ?? '').trim();
      if (!/^https?:\/\//i.test(s) || urls.includes(s)) return;
      urls.push(s);
    };
    pushUrl(media.url);
    for (const candidate of emojiCdnCandidates(emojiId)) pushUrl(candidate);

    const tryUrls = async () => {
      for (const url of urls) {
        try {
          const fetched = await deps.safeFetchBuffer(url, deps.MAX_MEDIA_BYTES);
          const accepted = acceptImageBuffer(fetched.buffer, `${label} URL `);
          if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(url) };
          failures.push(`${url} 不是有效图片`);
        } catch (error) {
          failures.push(`${url}: ${error?.message ?? error}`);
        }
      }
      return null;
    };
    // 只有 file 是安全缓存文件名时才允许交给网关（防任意路径/内网 URL 注入）。
    const tryGetImage = async () => {
      if (!(media.kind === 'image' || media.kind === 'sticker')) return null;
      if (!media.file || !isProbablySafeImageFileRef(media.file)) return null;
      try {
        const info = await deps.bot.getImage({ file: String(media.file) });
        const obj = info && typeof info === 'object' ? info : {};
        const base64 = base64FromMaybe(obj.data) || base64FromMaybe(obj.base64) || base64FromMaybe(obj.file);
        if (base64) {
          // 粗略估计 base64 解码后大小，超限直接拒绝，避免超大字符串撑爆内存
          if (base64.length * 3 / 4 <= deps.MAX_MEDIA_BYTES) {
            const accepted = acceptImageBuffer(Buffer.from(base64, 'base64'), 'get_image 返回的图片');
            if (accepted) return accepted;
          } else {
            deps.log(`get_image 返回的图片 base64 超限，已跳过（${Math.round(base64.length * 3 / 4 / 1024)}KB）`);
          }
        }
        if (obj.url) {
          try {
            const fetched = await deps.safeFetchBuffer(String(obj.url), deps.MAX_MEDIA_BYTES);
            const accepted = acceptImageBuffer(fetched.buffer, 'get_image URL 图片');
            if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(obj.url) };
          } catch (error) {
            failures.push(`get_image url: ${error?.message ?? error}`);
          }
        }
        if (typeof obj.file === 'string' && !obj.file.startsWith('base64://') && deps.fs.existsSync(obj.file) && isSafeLocalMediaPath(obj.file)) {
          const stat = deps.fs.statSync(obj.file);
          if (stat.size > deps.MAX_MEDIA_BYTES) {
            deps.log(`本地图片文件超限，已跳过（${Math.round(stat.size / 1024)}KB）`);
          } else {
            const accepted = acceptImageBuffer(deps.fs.readFileSync(obj.file), '本地图片');
            if (accepted) return accepted;
          }
        }
      } catch (error) {
        failures.push(`get_image: ${error?.message ?? error}`);
      }
      return null;
    };

    const result = isSticker
      ? (await tryUrls()) ?? (await tryGetImage())
      : (await tryGetImage()) ?? (await tryUrls());
    if (result) return result;
    if (failures.length) {
      deps.log(`[media] ${label}获取失败（${failures.length} 次尝试）：${failures.slice(0, 3).join(' | ')}`);
    }
    return null;
  }

function extractFaceImage(buffer) {
    // Read one bounded image in memory. Never extract archive paths to disk.
    const script = `import zipfile,io,sys
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
items=z.infolist()
if len(items)>256: raise ValueError('too many zip entries')
images=[i for i in items if i.filename.lower().endswith(('.png','.gif','.jpg','.jpeg','.webp')) and 0<i.file_size<=8388608 and not i.flag_bits&1]
images.sort(key=lambda i:(0 if i.filename.lower().endswith('.png') else 1,i.filename))
if not images: raise ValueError('no supported image in zip')
sys.stdout.buffer.write(z.read(images[0]))`;
    return deps.execFileSync(deps.process.platform==='win32'?'python':'python3',['-c',script],{input:buffer,maxBuffer:9*1024*1024,timeout:10000,stdio:['pipe','pipe','pipe']});
  }

async function fetchFaceMedia(media) {
    const faceId = Number(media.faceId);
    // 系统小表情（face 段）：只有数字 id 才有对应实体；拿不到时至少保留 summary 文案。
    const fallbackText = media.summary ? `[表情:${media.summary}]` : `[表情#${media.faceId}]`;
    if (!Number.isInteger(faceId)) return { text: fallbackText };
    try {
      const face = await deps.bot.fetchFaceEntity(faceId);
      if (face && typeof face === 'object') {
        const desc = face.q_des || (Array.isArray(face.emoji_name_alias) && face.emoji_name_alias[0]) || '';
        if (face.url) {
          try {
            const fetched = await deps.safeFetchBytes(String(face.url), deps.MAX_MEDIA_BYTES);
            let bytes=fetched.buffer;
            if(bytes[0]===0x50 && bytes[1]===0x4b) bytes=extractFaceImage(bytes);
            const accepted = acceptImageBuffer(bytes, '表情图片');
            if (accepted) return { ...accepted, mimeType: accepted.mimeType || mimeFromUrl(face.url), text: desc ? `[表情:${desc}]` : '' };
          } catch (error) {
            deps.log(`表情图片抓取失败: ${error?.message ?? error}`);
          }
        }
        return { text: desc ? `[表情:${desc}]` : fallbackText };
      }
    } catch (error) {
      deps.log(`fetchFaceEntity 失败: ${error?.message ?? error}`);
    }
    return { text: fallbackText };
  }

async function resolveMediaList(mediaList) {
    const parts = [];
    let index = 0;
    let totalBytes = 0;
    for (const media of Array.isArray(mediaList) ? mediaList : []) {
      index += 1;
      if (index > deps.MAX_MEDIA_COUNT) {
        parts.push({ type: 'text', text: `[图片/表情 ${index}（超过单条上限 ${deps.MAX_MEDIA_COUNT}，已跳过）]` });
        continue;
      }
      if (!media || typeof media !== 'object') continue;
      if (media.kind === 'face') {
        const face = await fetchFaceMedia(media);
        if (face.buffer) {
          if (totalBytes + face.buffer.length > deps.MAX_MEDIA_BYTES) {
            parts.push({ type: 'text', text: `[表情${index}（图片总大小超限，已跳过）]` });
            continue;
          }
          totalBytes += face.buffer.length;
          if (face.text) parts.push({ type: 'text', text: face.text });
          parts.push({ type: 'image', mediaType: face.mimeType || 'image/png', data: face.buffer.toString('base64'), name: `face-${media.faceId}.${(face.mimeType || 'png').split('/')[1]}` });
        } else {
          parts.push({ type: 'text', text: face.text || `[表情#${media.faceId}]` });
        }
      } else {
        const img = await fetchOneBotImage(media);
        const sticker = media.kind === 'sticker';
        const summary = sticker && media.summary ? `:${String(media.summary).slice(0, 20)}` : '';
        const label = sticker ? (summary ? `[表情${summary}]` : `[表情${index}]`) : `[图片${index}]`;
        if (img?.buffer) {
          if (totalBytes + img.buffer.length > deps.MAX_MEDIA_BYTES) {
            parts.push({ type: 'text', text: `${label}（图片总大小超限，已跳过）` });
            continue;
          }
          totalBytes += img.buffer.length;
          parts.push({ type: 'text', text: label });
          parts.push({ type: 'image', mediaType: img.mimeType || 'image/jpeg', data: img.buffer.toString('base64'), name: `qq-${sticker ? 'sticker' : 'image'}-${index}.${(img.mimeType || 'image/jpeg').split('/')[1]}` });
        } else {
          parts.push({ type: 'text', text: `${label}（获取失败）` });
        }
      }
    }
    return parts;
  }

async function fetchMediaData(mediaList) {
    const out = [];
    let index = 0;
    let totalBytes = 0;
    for (const media of Array.isArray(mediaList) ? mediaList : []) {
      index += 1;
      if (index > deps.MAX_MEDIA_COUNT) {
        out.push({ index, kind: media?.kind === 'face' ? 'face' : (media?.kind === 'sticker' ? 'sticker' : 'image'), text: `（超过单条上限 ${deps.MAX_MEDIA_COUNT}，已跳过）` });
        continue;
      }
      if (!media || typeof media !== 'object') continue;
      if (media.kind === 'face') {
        const face = await fetchFaceMedia(media);
        if (face.buffer) {
          if (totalBytes + face.buffer.length > deps.MAX_MEDIA_BYTES) {
            out.push({ index, kind: 'face', faceId: media.faceId ? String(media.faceId) : undefined, text: '（图片总大小超限，已跳过）' });
            continue;
          }
          totalBytes += face.buffer.length;
          out.push({
            index,
            kind: 'face',
            faceId: media.faceId ? String(media.faceId) : undefined,
            mimeType: face.mimeType || 'image/png',
            data: face.buffer.toString('base64'),
            text: face.text || ''
          });
        } else {
          out.push({ index, kind: 'face', faceId: media.faceId ? String(media.faceId) : undefined, text: face.text || `[表情#${media.faceId}]` });
        }
      } else {
        const img = await fetchOneBotImage(media);
        const kind = media.kind === 'sticker' ? 'sticker' : 'image';
        const noun = kind === 'sticker' ? '表情' : '图片';
        const base = {
          index,
          kind,
          ...(media.file ? { file: String(media.file) } : {}),
          ...(media.url ? { url: String(media.url) } : {}),
          ...(media.emojiId ? { emojiId: String(media.emojiId) } : {}),
          ...(media.summary ? { summary: String(media.summary) } : {}),
          ...(media.subType ? { subType: String(media.subType) } : {})
        };
        if (img?.buffer) {
          if (totalBytes + img.buffer.length > deps.MAX_MEDIA_BYTES) {
            out.push({ ...base, text: `（${noun}总大小超限，已跳过）` });
            continue;
          }
          totalBytes += img.buffer.length;
          out.push({
            ...base,
            mimeType: img.mimeType || 'image/jpeg',
            data: img.buffer.toString('base64'),
            text: ''
          });
        } else {
          out.push({ ...base, text: `（${noun}获取失败）` });
        }
      }
    }
    return out;
  }

function mediaHintFor(key, messageRef, mediaList) {
    if (!Array.isArray(mediaList) || mediaList.length === 0 || !messageRef) return '';
    if (deps.currentMode === 'reserved2') {
      return `\n【图片/表情】本条消息包含 ${mediaList.length} 个图片/表情（消息ID=${messageRef}）。如需要查看/识别，请调用 mcp__snowluma__qq_get_message_images，参数 key="${key}", messageId="${messageRef}"。`;
    }
    return `\n【图片/表情】本条消息包含 ${mediaList.length} 个图片/表情（消息ID=${messageRef}）。`;
  }

function findMessageMedia(key, ref) {
    const refStr = String(ref ?? '').trim();
    if (!refStr) return [];
    // 二代：消息对象上直接带 media（仅在确实存在二代会话状态时读取，避免为 gen1 创建影子状态）
    if (deps.currentMode === 'reserved2' || deps.socialV2.conversations.has(key)) {
      try {
        const st = deps.getSocialV2State(key);
        if (st) {
          // Unread can outlive the recent window. Compact model views retain
          // handles instead of transport URLs, so both buffers must resolve.
          for (const messages of [st.recentMessages, st.unread]) {
            const found = (Array.isArray(messages) ? messages : []).find((m) => m && (String(m.messageId || '') === refStr || String(m.seq || '') === refStr));
            if (found && Array.isArray(found.media) && found.media.length) return found.media;
          }
        }
      } catch {}
    }
    // 一代/普通模式：messageMediaStore
    const byRef = deps.messageMediaStore.get(key);
    if (byRef) {
      const hit = byRef.get(refStr);
      if (Array.isArray(hit)) return hit;
      // 兼容按 seq 查找（messageMediaStore 只存 messageId 时，尝试遍历所有值）
      for (const [storedRef, media] of byRef) {
        if (String(storedRef) === refStr && Array.isArray(media)) return media;
      }
    }
    return [];
  }

function pruneGroupMemberNameCache() {
    const now = Date.now();
    for (const [k, v] of deps.groupMemberNameCache) {
      if (now - v.ts > deps.GROUP_MEMBER_NAME_TTL_MS) deps.groupMemberNameCache.delete(k);
    }
    if (deps.groupMemberNameCache.size > 2000) {
      const keys = [...deps.groupMemberNameCache.keys()].slice(0, deps.groupMemberNameCache.size - 2000);
      for (const k of keys) deps.groupMemberNameCache.delete(k);
    }
  }

async function assertGroupMember(groupId, userId) {
    const gid = String(groupId);
    const uid = String(userId);
    let cached = deps.groupMemberIdsCache.get(gid);
    if (!cached || Date.now() - cached.ts > deps.GROUP_MEMBER_IDS_TTL_MS) {
      let list;
      try {
        list = await deps.bot.getGroupMemberList(Number(gid));
      } catch (error) {
        // 失败即拒绝（fail-closed）：宁可拍不出去，也不要绕过校验。
        return `无法获取群 ${gid} 的成员列表：${error?.message ?? error}`;
      }
      const members = Array.isArray(list) ? list : (list?.data ?? []);
      const ids = new Set(members.map((m) => String(m?.user_id ?? '')).filter(Boolean));
      if (!ids.size) return `群 ${gid} 的成员列表为空，无法校验拍一拍目标`;
      cached = { ids, ts: Date.now() };
      deps.groupMemberIdsCache.set(gid, cached);
      if (deps.groupMemberIdsCache.size > 50) {
        for (const [k, v] of deps.groupMemberIdsCache) {
          if (Date.now() - v.ts > 10 * 60 * 1000) deps.groupMemberIdsCache.delete(k);
        }
      }
    }
    return cached.ids.has(uid) ? null : `QQ ${uid} 不是群 ${gid} 的成员，已拒绝拍一拍`;
  }

async function resolveGroupMemberName(groupId, userId) {
    const key = `${String(groupId)}:${String(userId)}`;
    const hit = deps.groupMemberNameCache.get(key);
    if (hit && Date.now() - hit.ts < deps.GROUP_MEMBER_NAME_TTL_MS) return hit.name;
    try {
      // 优先精确查询单个成员（快，适合单条 @）
      let name = null;
      try {
        const info = await deps.bot.getGroupMemberInfo(Number(groupId), Number(userId));
        name = info?.card || info?.nickname || null;
      } catch {}
      if (name) {
        deps.groupMemberNameCache.set(key, { name, ts: Date.now() });
        pruneGroupMemberNameCache();
        return name;
      }
      // 回退：拉一次整群成员列表并建立整组缓存（兼容未实现 get_group_member_info 的网关）
      const list = await deps.bot.getGroupMemberList(Number(groupId));
      const members = Array.isArray(list) ? list : (list?.data ?? []);
      const now = Date.now();
      for (const m of members) {
        const n = m?.card || m?.nickname || null;
        if (n) deps.groupMemberNameCache.set(`${String(groupId)}:${String(m.user_id)}`, { name: n, ts: now });
      }
      pruneGroupMemberNameCache();
      name = deps.groupMemberNameCache.get(key)?.name ?? null;
      return name;
    } catch {
      return null;
    }
  }

function pruneReplyInfoCache() {
    if (deps.replyInfoCache.size <= 1000) return;
    const now = Date.now();
    for (const [k, v] of deps.replyInfoCache) {
      if (now - v.ts > deps.REPLY_INFO_TTL_MS) deps.replyInfoCache.delete(k);
    }
    if (deps.replyInfoCache.size > 1000) {
      const oldestKey = deps.replyInfoCache.keys().next().value;
      if (oldestKey !== undefined) deps.replyInfoCache.delete(oldestKey);
    }
  }

async function resolveReplyInfo(kind, convId, messageId, selfId = null) {
    pruneReplyInfoCache();
    const cacheKey = `${kind}:${String(convId)}:${String(messageId)}`;
    const hit = deps.replyInfoCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < (hit.info ? deps.REPLY_INFO_TTL_MS : deps.REPLY_NEGATIVE_TTL_MS)) return hit.info;
    try {
      const numericId = Number(messageId);
      if (!Number.isSafeInteger(numericId)) {
        deps.log(`引用消息 id 超出安全整数范围，拒绝解析: ${messageId}`);
        deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
        return null;
      }
      const raw = await deps.bot.getMessage(numericId);
      if (!raw) {
        deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
        return null;
      }
      // 消息归属校验：防止跨会话读取其他群/私聊消息。
      // 若网关返回的 raw 对象连归属字段都缺失，则视为无法确认归属，拒绝返回内容。
      if (kind === 'group') {
        const rawGroup = raw.group_id ?? raw.groupId;
        if (rawGroup == null) {
          deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
          return null;
        }
        if (String(rawGroup) !== String(convId)) {
          deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
          return null;
        }
      } else {
        const rawUser = raw.user_id ?? raw.userId ?? raw.sender?.user_id;
        const rawGroup = raw.group_id ?? raw.groupId;
        // 私聊消息必须同时满足：没有群归属，且发送者匹配。防止用群消息 id 跨会话读取。
        if (rawGroup != null) {
          deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
          return null;
        }
        if (rawUser == null) {
          deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
          return null;
        }
        if (String(rawUser) !== String(convId) && !(selfId != null && String(rawUser) === String(selfId))) {
          deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
          return null;
        }
      }
      const sender = raw.sender?.card || raw.sender?.nickname || String(raw.sender?.user_id ?? raw.user_id ?? '未知');
      const text = await deps.segmentsToText(raw.message ?? [], {
        resolveAtName: kind === 'group' ? (qq) => resolveGroupMemberName(convId, qq) : null,
        includeReply: false
      });
      const senderUserId = raw.sender?.user_id ?? raw.user_id ?? null;
      const info = {
        sender: String(sender ?? ''),
        text: String(text ?? '').slice(0, 200),
        userId: senderUserId != null ? String(senderUserId) : null
      };
      deps.replyInfoCache.set(cacheKey, { info, ts: Date.now() });
      return info;
    } catch (error) {
      deps.log('解析引用消息失败:', error?.message ?? error);
      deps.replyInfoCache.set(cacheKey, { info: null, ts: Date.now() });
      return null;
    }
  }

// 发送引用时解析目标：支持真实 QQ message_id，也支持 recentMessages 里的 seq（自动映射到真实 messageId）。
  async function resolveReplyTargetV2(st, kind, convId, ref) {
    const refStr = String(ref ?? '').trim();
    if (!refStr) return null;
    const found = Array.isArray(st?.recentMessages) ? st.recentMessages.find((m) => m && String(m.seq) === refStr) : null;
    // 若 ref 命中本地 seq，且本地存有真实 messageId，优先按 seq 映射，避免与真实 id 冲突。
    if (found && found.messageId && String(found.messageId) !== refStr) {
      const realId = String(found.messageId);
      const realInfo = await resolveReplyInfo(kind, convId, realId);
      return {
        info: realInfo || {
          sender: String(found.sender || ''),
          text: String(found.text || found.plain || '').slice(0, 200),
          userId: null,
          messageId: realId,
          seq: found.seq
        },
        messageId: realId
      };
    }
    let info = await resolveReplyInfo(kind, convId, refStr);
    if (info) return { info, messageId: refStr };
    if (found && found.messageId) {
      const realId = String(found.messageId);
      const realInfo = await resolveReplyInfo(kind, convId, realId);
      return {
        info: realInfo || {
          sender: String(found.sender || ''),
          text: String(found.text || found.plain || '').slice(0, 200),
          userId: null,
          messageId: realId,
          seq: found.seq
        },
        messageId: realId
      };
    }
    return null;
  }

// 判断当前消息是否“引用/回复了机器人自己”：若是，则桥接层也把它当作直接对 AI 说。
  async function isQuoteTargetSelf(message, kind, id, selfId) {
    if (!Array.isArray(message) || selfId == null) return false;
    for (const seg of message) {
      if (seg?.type === 'reply' && seg.data?.id != null) {
        const info = await resolveReplyInfo(kind, id, String(seg.data.id), selfId);
        if (info?.userId && String(info.userId) === String(selfId)) return true;
      }
    }
    return false;
  }
return {buildInboundNote,fetchHistoryLines,mimeFromBuffer,mimeFromUrl,getImageDimensions,base64FromMaybe,isSafeLocalMediaPath,isProbablySafeImageFileRef,emojiCdnCandidates,emojiIdFromFileName,acceptImageBuffer,fetchOneBotImage,extractFaceImage,fetchFaceMedia,resolveMediaList,fetchMediaData,mediaHintFor,findMessageMedia,pruneGroupMemberNameCache,assertGroupMember,resolveGroupMemberName,pruneReplyInfoCache,resolveReplyInfo,resolveReplyTargetV2,isQuoteTargetSelf};
}
