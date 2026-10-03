"""Local integration verification. Reads dev-login.txt; never prints credentials."""
import json, time, urllib.request, urllib.error, http.cookiejar, pathlib, secrets, hashlib, xml.etree.ElementTree as ET
from html.parser import HTMLParser
ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:7800/api'
jar = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def call(path, method='GET', value=None):
    body = None if value is None else json.dumps(value).encode()
    req = urllib.request.Request(BASE + path, body, {'Content-Type':'application/json','X-OneSearch-Request':'1'}, method=method)
    with client.open(req, timeout=100) as r: return None if r.status==204 else json.load(r)['data']
def task(instance, ref):
    for _ in range(240):
        result=call(f'/instances/{instance}/engine/tasks/{ref["taskUid"]}')
        if result['status']=='succeeded': return result
        if result['status'] in ('failed','canceled'): raise RuntimeError(result)
        time.sleep(.25)
    raise TimeoutError('index task')
def running(instance):
    for _ in range(160):
        result=call('/instances/'+instance)
        if result['status']=='running': return
        if result['status']=='failed': raise RuntimeError(result)
        time.sleep(.25)
    raise TimeoutError('instance startup')
def public(instance,key,origin):
    req=urllib.request.Request(BASE+f'/search/{instance}/blog_articles',json.dumps({'q':'强化学习','limit':999}).encode(),{'Content-Type':'application/json','Authorization':'Bearer '+key,'Origin':origin})
    try:
        with urllib.request.urlopen(req,timeout=30) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
class Plain(HTMLParser):
    def __init__(self):super().__init__();self.parts=[]
    def handle_data(self,text):self.parts.append(text)
password=(ROOT/'data/dev-login.txt').read_text(encoding='utf-8').splitlines()[1].split(': ',1)[1]
call('/auth/login','POST',{'username':'admin','password':password})
instances=call('/instances')
# Resume only services whose persisted desired state is running after a deliberate dev reload.
for i in instances:
    if i['provider']=='native' and i['status']=='stopped' and i['desiredState']=='running':
        call(f'/instances/{i["id"]}/actions','POST',{'action':'start'});running(i['id'])
demo=next((i for i in instances if i['name']=='博客演示' and i['status']!='archived'),None)
if demo is None:demo=call('/instances','POST',{'name':'博客演示','description':'','provider':'native','memoryMB':512,'threads':2})['instance']
id=demo['id'];running(id)
indexes=call(f'/instances/{id}/engine/indexes?limit=100')['results']
if not any(i['uid']=='blog_articles' for i in indexes):task(id,call(f'/instances/{id}/engine/indexes','POST',{'uid':'blog_articles','primaryKey':'id'}))
feed=ET.parse('D:/Repositories/Web_Projects/Blog/public/search.xml')
docs=[]
for entry in feed.findall('.//entry'):
    title=entry.findtext('title') or '';url=entry.findtext('url') or '';raw=entry.findtext('content') or '';plain=Plain();plain.feed(raw);content=' '.join(' '.join(plain.parts).split())
    docs.append({'id':hashlib.sha256(url.encode()).hexdigest()[:32],'title':title,'url':url,'content':content,'excerpt':content[:240]})
if not docs:raise RuntimeError('Blog public search.xml is empty')
task(id,call(f'/instances/{id}/engine/indexes/blog_articles/documents','POST',docs))
task(id,call(f'/instances/{id}/engine/indexes/blog_articles/settings','PATCH',{'searchableAttributes':['title','content'],'displayedAttributes':['id','title','url','excerpt','content']}))
result=call(f'/instances/{id}/engine/indexes/blog_articles/search','POST',{'q':'强化学习','limit':10})
assert result['hits'],'Chinese search returned no result'
key=call(f'/instances/{id}/engine/keys','POST',{'name':'dev 验证（临时）','actions':['search'],'indexes':['blog_articles'],'expiresAt':None})
call(f'/instances/{id}/sites/blog_articles','PUT',{'enabled':True,'origins':['http://localhost:5178'],'requireOrigin':True,'rate':60,'maxLimit':3})
code,search=public(id,key['key'],'http://localhost:5178');assert code==200 and len(search['hits'])<=3
assert public(id,key['key'],'https://untrusted.example')[0]==403
keys=call(f'/instances/{id}/engine/keys')['results'];assert all('key' not in k for k in keys)
call(f'/instances/{id}/engine/keys/{key["uid"]}','DELETE')
assert public(id,key['key'],'http://localhost:5178')[0]==403 # revoked key rejected by Meilisearch
history=call('/history?instance='+id);assert any(e['status']==403 for e in history['results'])
backup_password_path=ROOT/'data/smoke-backup-password.txt'
backup_password=backup_password_path.read_text(encoding='utf-8') if backup_password_path.exists() else secrets.token_hex(20)
backup_password_path.write_text(backup_password,encoding='utf-8')
backups=[]
for kind in ('platform','dump'):
    backup=call('/backups','POST',{'kind':kind,'instanceId':id if kind=='dump' else '', 'password':backup_password})
    for _ in range(400):
        current=next(b for b in call('/backups') if b['id']==backup['id'])
        if current['status']=='succeeded':break
        if current['status']=='failed':raise RuntimeError(current)
        time.sleep(.25)
    assert current['status']=='succeeded'
    with client.open(BASE+f'/backups/{backup["id"]}/download') as r:assert r.read(10)==b'ONESEARCH1'
    backups.append({'id':backup['id'],'kind':kind,'size':current['size']})
summary={'instance':id,'documents':len(docs),'searchHits':result['estimatedTotalHits'],'publicLimitEnforced':True,'originBlocked':True,'revokedKeyBlocked':True,'historyRecords':history['total'],'backups':backups}
(ROOT/'data/verification.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
