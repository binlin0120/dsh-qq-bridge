"""Create cached upload derivatives without overwriting the character references."""
import sys,json,hashlib,logging,os
from pathlib import Path
from PIL import Image,ImageOps

def main():
 opts=json.loads(sys.argv[1]);cache=Path(opts['cacheDir']);cache.mkdir(parents=True,exist_ok=True,mode=0o700)
 logging.basicConfig(filename=cache/'prepare.log',encoding='utf-8',level=logging.INFO)
 results=[]
 for name in opts['files']:
  source=Path(name);raw=source.read_bytes();digest=hashlib.sha256(raw).hexdigest()
  target=cache/(hashlib.sha256((digest+':jpeg-v2-1024-86').encode()).hexdigest()+'.jpg')
  if not target.exists():
   with Image.open(source) as original:
    image=ImageOps.exif_transpose(original).convert('RGB')
    for edge,quality in [(1024,86),(896,84),(768,82)]:
     copy=image.copy();copy.thumbnail((edge,edge),getattr(Image,'Resampling',Image).LANCZOS)
     temp=target.with_suffix('.new');copy.save(temp,format='JPEG',quality=quality,optimize=True,progressive=True)
     if temp.stat().st_size<=192*1024:break
    if temp.stat().st_size>192*1024:raise ValueError('Reference exceeds upload budget')
    os.chmod(temp,0o600);os.replace(temp,target)
  with Image.open(target) as check:
   check.verify()
  with Image.open(target) as check:w,h=check.size
  results.append({'file':str(target.resolve()),'sourceSha256':digest,'sourceBytes':len(raw),'bytes':target.stat().st_size,'width':w,'height':h,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
 if sum(4*((x['bytes']+2)//3) for x in results)>512*1024:raise ValueError('Combined reference upload exceeds budget')
 logging.info('Prepared %s reference images, %s bytes',len(results),sum(x['bytes'] for x in results))
 print(json.dumps({'references':results,'encodedBytes':sum(4*((x['bytes']+2)//3) for x in results)}))

try:main()
except Exception:
 logging.exception('Reference preparation failed');sys.exit(1)
