"""Verify pagination and match metadata against the existing local demo, without logging keys."""
import json, time, urllib.request, urllib.error, http.cookiejar, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:7800/api'
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def call(path, method='GET', value=None):
    body = None if value is None else json.dumps(value).encode()
    req = urllib.request.Request(BASE + path, body, {'Content-Type': 'application/json', 'X-OneSearch-Request': '1'}, method=method)
    with client.open(req, timeout=60) as r:
        return None if r.status == 204 else json.load(r)['data']

password = (ROOT / 'data/dev-login.txt').read_text(encoding='utf-8').splitlines()[1].split(': ', 1)[1]
call('/auth/login', 'POST', {'username': 'admin', 'password': password})
instances = call('/instances')
for instance in instances:
    if instance['provider'] == 'native' and instance['status'] == 'stopped' and instance['desiredState'] == 'running':
        call(f'/instances/{instance["id"]}/actions', 'POST', {'action': 'start'})
        for _ in range(160):
            if call('/instances/' + instance['id'])['status'] == 'running': break
            time.sleep(.25)
        else: raise TimeoutError('instance restart')
demo = next(i for i in instances if i['name'] == '博客演示' and i['status'] != 'archived')
id = demo['id']
prefix = f'/instances/{id}/engine/indexes/blog_articles'
# Only the public Blog demo exposes its article body, enabling excerpts around body matches.
settings = call(prefix + '/settings')
displayed = settings['displayedAttributes']
if '*' not in displayed and 'content' not in displayed:
    ref = call(prefix + '/settings', 'PATCH', {'displayedAttributes': displayed + ['content']})
    for _ in range(240):
        task = call(f'/instances/{id}/engine/tasks/{ref["taskUid"]}')
        if task['status'] == 'succeeded': break
        if task['status'] == 'failed': raise RuntimeError('demo settings update failed')
        time.sleep(.25)
    else: raise TimeoutError('settings task')
first = call(prefix + '/documents?limit=20&offset=0')
second = call(prefix + '/documents?limit=20&offset=20')
assert first['total'] == second['total'] == 37
assert len(first['results']) == 20 and len(second['results']) == 17
assert not ({d['id'] for d in first['results']} & {d['id'] for d in second['results']})
params = {'q': '强化学习', 'hitsPerPage': 5, 'attributesToHighlight': ['*'], 'attributesToCrop': ['content', 'excerpt'], 'cropLength': 40, 'showMatchesPosition': True}
result1 = call(prefix + '/search', 'POST', {**params, 'page': 1})
result2 = call(prefix + '/search', 'POST', {**params, 'page': 2})
assert result1['totalHits'] == result2['totalHits'] == 7 and result2['totalPages'] == 2
assert len(result1['hits']) == 5 and len(result2['hits']) == 2
assert not ({d['id'] for d in result1['hits']} & {d['id'] for d in result2['hits']})
assert any('<em>' in json.dumps(d['_formatted'], ensure_ascii=False) and d['_matchesPosition'] for d in result1['hits'])
policy = call(f'/instances/{id}/sites/blog_articles')
assert policy['enabled'] and 'http://localhost:5178' in policy['origins']
key = call(f'/instances/{id}/engine/keys', 'POST', {'name': '分页高亮验证（临时）', 'actions': ['search'], 'indexes': ['blog_articles'], 'expiresAt': None})
try:
    req = urllib.request.Request(BASE + f'/search/{id}/blog_articles', json.dumps({'q': '强化学习', 'page': 2, 'hitsPerPage': 999}).encode(), {'Content-Type': 'application/json', 'Origin': 'http://localhost:5178', 'Authorization': 'Bearer ' + key['key']})
    with urllib.request.urlopen(req, timeout=30) as r: public = json.load(r)
    assert public['hitsPerPage'] == policy['maxLimit'] and len(public['hits']) <= policy['maxLimit']
    assert public['hits'] and public['hits'][0]['_formatted'] and public['hits'][0]['_matchesPosition']
finally:
    call(f'/instances/{id}/engine/keys/{key["uid"]}', 'DELETE')
summary = {'documents': 37, 'documentPages': [20, 17], 'searchHits': 7, 'searchPages': [5, 2], 'highlighting': True, 'matchPositions': True, 'publicPaginationCap': True}
(ROOT / 'data/search-verification.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary))
