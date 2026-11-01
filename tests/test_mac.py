# -*- coding: utf-8 -*-
import runpy, tempfile, json, io, copy
from pathlib import Path
from unittest.mock import patch
m=runpy.run_path(str(Path(__file__).resolve().parents[1] / 'Урок-Zoom.py'))
action=m['action']; g=action.__globals__
settings={'Email Zoom':'teacher@example.com','Account ID':'account','Client ID':'client','Client Secret':'secret','Calendar URL':'https://script.google.com/macros/s/example/exec','Calendar Token':'private-key'}
with tempfile.TemporaryDirectory() as tmp:
 g['STATE']=Path(tmp)/'state.json';g['key_get']=lambda k:settings.get(k,'')
 calls=[]; google=[]; fail=[True]
 def post(url,body,headers):
  calls.append(url)
  return {'access_token':'token'} if 'oauth' in url else {'join_url':'https://us06web.zoom.us/j/123456789?pwd=abc','password':'abc'}
 def google_post(req,**kwargs):
  data=json.loads(req.data);google.append(data)
  if fail[0]: raise TimeoutError()
  return io.BytesIO(json.dumps({'ok':True,'eventId':'stable-event'}).encode())
 g['post']=post
 d={'name':'Юра','subject':'Математика','gender':'м','date':'2099-01-10','time':'13:00','zone':'Europe/Moscow','duration':60,'board':'https://miro.com/welcomeonboard/abc?share_link_id=1','text':'Привет!\n[ССЫЛКА ZOOM] 😤 🤪 🥰','requestId':'test-request-123','remember':True,'studentZone':'Europe/Moscow','lessonType':'trial','agreement':'mother'}
 with patch('urllib.request.urlopen',google_post):
  r=action('create',d);assert r['calendarStatus']=='pending';assert '[ССЫЛКА ZOOM]' not in r['text'];assert 'pwd=abc' in r['text'];assert len(calls)==2
  assert google[0]['start']=='2099-01-10T10:00:00+00:00';assert google[0]['end']=='2099-01-10T11:00:00+00:00'
  # A second create retries only Calendar and preserves the Zoom link.
  fail[0]=False;r=action('create',d);assert r['calendarStatus']=='created';assert len(calls)==2
  r=action('syncCalendar',{'requestId':d['requestId']});assert len(google)==2
  assert 'private-key' not in json.dumps(r)
  assert action('init',{})['students'][0]['studentZone']=='Europe/Moscow'
  bad={**d,'requestId':'new-request','board':'https://example.com/no'}
  try: action('create',bad)
  except ValueError: pass
  else: raise AssertionError('bad board allowed')
print('Mac: Zoom → message → Calendar, timezone, retry without duplicate, saved student and secret isolation passed')
