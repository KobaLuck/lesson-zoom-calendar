# -*- coding: utf-8 -*-
"""Урок Zoom: локальный интерфейс для Windows, macOS и Linux, Python 3.9+."""
import base64
import json
import secrets
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
STATE = ROOT / '.lesson-zoom.json'
SERVICE = 'LessonZoom'
TOKEN = secrets.token_urlsafe(32)
UNCERTAIN = set()

def read_state():
    if not STATE.exists():
        return {'students': []}
    return json.loads(STATE.read_text(encoding='utf-8'))

def save_state(s):
    tmp = STATE.with_suffix('.tmp')
    tmp.write_text(json.dumps(s, ensure_ascii=False), encoding='utf-8')
    tmp.chmod(0o600)
    tmp.replace(STATE)

def credential_backend():
    """Use only OS-backed stores; never fall back to a plain-text file."""
    try:
        if sys.platform == 'win32':
            from keyring.backends.Windows import WinVaultKeyring
            return WinVaultKeyring()
        if sys.platform.startswith('linux'):
            from keyring.backends.SecretService import Keyring
            return Keyring()
    except ImportError as e:
        raise ValueError('Установите зависимости: python -m pip install -r requirements.txt') from e
    raise ValueError('Поддерживаются Windows, macOS и Linux.')


def key_get(name):
    if sys.platform == 'darwin':
        p = subprocess.run(['security', 'find-generic-password', '-s', SERVICE, '-a', name, '-w'], capture_output=True, text=True, encoding='utf-8')
        if p.returncode not in (0, 44):
            raise ValueError('Не удалось открыть связку ключей macOS. Разрешите доступ к LessonZoom.')
        return p.stdout.strip() if p.returncode == 0 else ''
    try:
        return credential_backend().get_password(SERVICE, name) or ''
    except ValueError:
        raise
    except Exception as e:
        raise ValueError('Не удалось открыть хранилище ключей. В Linux запустите и разблокируйте Secret Service (например, GNOME Keyring). В Windows проверьте доступ к диспетчеру учётных данных.') from e


def key_set(name, value):
    if sys.platform == 'darwin':
        try:
            subprocess.run(['security', 'add-generic-password', '-U', '-s', SERVICE, '-a', name, '-w', value], check=True, capture_output=True)
        except subprocess.CalledProcessError as e:
            raise ValueError('Не удалось сохранить ключ в связке ключей macOS.') from e
        return
    try:
        credential_backend().set_password(SERVICE, name, value)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError('Не удалось сохранить ключ. Разблокируйте системное хранилище и повторите.') from e


def config():
    s = read_state()
    try:
        keys = {k: key_get(k) for k in ['Email Zoom', 'Calendar URL', 'Calendar Token', 'Account ID', 'Client ID', 'Client Secret']}
    except ValueError as e:
        return {**s, 'host': '', 'calendarUrl': '', 'connected': False, 'calendarConnected': False, 'storageError': str(e)}
    return {**s, 'host': keys['Email Zoom'], 'calendarUrl': keys['Calendar URL'], 'calendarConnected': bool(keys['Calendar URL'] and keys['Calendar Token']), 'connected': all(keys[k] for k in ['Email Zoom', 'Account ID', 'Client ID', 'Client Secret'])}

def post(url, body, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method='POST'), timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code >= 500:
            raise RuntimeError('Zoom временно не подтвердил результат запроса.') from e
        try:
            v = json.load(e)
            detail = v.get('message') or v.get('reason') or str(e.code)
        except Exception:
            detail = str(e.code)
        raise ValueError('Zoom: ' + detail) from e

def validate(d):
    if not d.get('name', '').strip() or not d.get('subject', '').strip():
        raise ValueError('Введите имя и предмет.')
    if d.get('gender') not in ('м', 'ж') or d.get('zone') not in ('Europe/Moscow', 'Asia/Ho_Chi_Minh'):
        raise ValueError('Проверьте обращение и часовой пояс.')
    n = d.get('duration')
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 1440:
        raise ValueError('Длительность — от 1 до 1440 минут.')
    start = datetime.strptime(d['date'] + ' ' + d['time'], '%Y-%m-%d %H:%M').replace(tzinfo=ZoneInfo(d['zone']))
    if start <= datetime.now(start.tzinfo):
        raise ValueError('Это время уже прошло. Выберите другой день или время.')
    if '[ССЫЛКА ZOOM]' not in d.get('text', ''):
        raise ValueError('В тексте пропущено место для ссылки Zoom.')
    if d.get('board'):
        u = urllib.parse.urlparse(d['board'])
        if u.scheme != 'https' or u.hostname not in ('app.holst.so', 'miro.com', 'www.miro.com') or not u.path.strip('/')  or u.path.rstrip('/').endswith(('/recent', '/all')):
            raise ValueError('Вставьте ссылку на саму доску Миро или Холст.')
    if not d.get('requestId'):
        raise ValueError('Обновите страницу и повторите.')
    return start

def calendar_url_valid(url):
    u = urllib.parse.urlparse(url)
    return u.scheme == 'https' and u.hostname == 'script.google.com' and u.path.startswith('/macros/s/') and u.path.endswith('/exec') and not u.query and not u.fragment and not u.username

def sync_calendar(s):
    result = s.get('last', {})
    if result.get('calendarStatus') == 'created' or not result.get('calendarPayload'):
        return {**result, 'config': config()}
    try:
        url, secret = key_get('Calendar URL'), key_get('Calendar Token')
        if not calendar_url_valid(url) or not secret:
            raise ValueError('Заполните настройки Google Календаря.')
        payload = {**result['calendarPayload'], 'token': secret}
        with urllib.request.urlopen(urllib.request.Request(url, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST'), timeout=45) as response:
            v = json.load(response)
        if not v.get('ok') or not v.get('eventId'):
            raise ValueError(v.get('error', 'Google не подтвердил добавление события.'))
        result.update(calendarStatus='created', calendarEventId=v['eventId'], calendarError='')
    except Exception as e:
        detail = str(e) if isinstance(e, ValueError) else 'Проверьте интернет, адрес и доступ к Google-скрипту.'
        result.update(calendarStatus='pending', calendarError='Zoom создан, но урок ещё не добавлен в календарь. ' + detail + ' Нажмите «Повторить добавление в календарь».')
    s['last'] = result
    save_state(s)
    return {**result, 'config': config()}

def action(name, d):
    if name == 'init':
        return config()
    if name == 'syncCalendar':
        s = read_state()
        if not s.get('last') or s['last'].get('requestId') != d.get('requestId'):
            raise ValueError('Откройте последнее сообщение.')
        return sync_calendar(s)
    if name == 'settings':
        if '@' not in d.get('host', ''):
            raise ValueError('Введите email вашего аккаунта Zoom.')
        for field, label in [('account', 'Account ID'), ('client', 'Client ID'), ('secret', 'Client Secret')]:
            if not d.get(field) and not key_get(label):
                raise ValueError('Заполните ' + label)
        if not calendar_url_valid(d.get('calendarUrl', '') or key_get('Calendar URL')):
            raise ValueError('Вставьте адрес опубликованного Google-скрипта: https://script.google.com/macros/s/…/exec')
        if not (d.get('calendarToken') or key_get('Calendar Token')):
            raise ValueError('Введите ключ Google-скрипта.')
        for field, label in [('calendarUrl', 'Calendar URL'), ('calendarToken', 'Calendar Token'), ('host', 'Email Zoom'), ('account', 'Account ID'), ('client', 'Client ID'), ('secret', 'Client Secret')]:
            if d.get(field):
                key_set(label, d[field])
        return {'connected': True, 'calendarConnected': True}
    if name != 'create':
        raise ValueError('Неизвестное действие.')
    s = read_state()
    if s.get('last', {}).get('requestId') == d.get('requestId'):
        return sync_calendar(s)
    if d.get('requestId') in UNCERTAIN or d.get('requestId') in s.get('uncertain', []):
        raise ValueError('Zoom не подтвердил результат прошлого запроса. Проверьте встречи в Zoom. Для новой попытки измените данные урока.')
    if s.get('last', {}).get('calendarStatus') == 'pending':
        raise ValueError('Сначала откройте последнее сообщение и повторите добавление предыдущего урока в календарь.')
    start = validate(d)
    if not config()['calendarConnected']:
        raise ValueError('Сначала подключите Google Календарь в настройках.')
    host, account, client, secret = (key_get(k) for k in ['Email Zoom', 'Account ID', 'Client ID', 'Client Secret'])
    if not all([host, account, client, secret]):
        raise ValueError('Сначала заполните настройки Zoom.')
    auth = base64.b64encode((client + ':' + secret).encode()).decode()
    token = post('https://zoom.us/oauth/token', urllib.parse.urlencode({'grant_type': 'account_credentials', 'account_id': account}).encode(), {'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded'})['access_token']
    body = {'topic': d['subject'] + ' — ' + d['name'], 'type': 2, 'start_time': start.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'timezone': d['zone'], 'duration': d['duration'], 'password': str(secrets.randbelow(900000)+100000), 'settings': {'waiting_room': True, 'join_before_host': False, 'host_video': True, 'participant_video': True, 'use_pmi': False}}
    UNCERTAIN.add(d['requestId'])
    s['uncertain'] = (s.get('uncertain', []) + [d['requestId']])[-20:]
    save_state(s)
    try:
        m = post('https://api.zoom.us/v2/users/' + urllib.parse.quote(host, safe='') + '/meetings', json.dumps(body).encode(), {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    except ValueError:
        UNCERTAIN.discard(d['requestId'])
        s['uncertain'].remove(d['requestId'])
        save_state(s)
        raise
    except Exception as e:
        raise ValueError('Не удалось получить ответ Zoom. Встреча могла создаться. Проверьте список встреч перед новой попыткой.') from e
    if not m.get('join_url'):
        raise ValueError('Zoom не вернул ссылку. Проверьте список встреч.')
    link = m['join_url'] + ('\nКод доступа: ' + m['password'] if m.get('password') else '')
    text = d['text'].replace('[ССЫЛКА ZOOM]', link)
    result = {'requestId': d['requestId'], 'text': text, 'title': d['name'] + ' · ' + start.strftime('%d.%m.%Y, %H:%M'), 'url': m['join_url']}
    result['calendarStatus'] = 'pending'
    result['calendarPayload'] = {'requestId': d['requestId'], 'title': body['topic'], 'start': start.astimezone(timezone.utc).isoformat(), 'end': (start + timedelta(minutes=d['duration'])).astimezone(timezone.utc).isoformat(), 'zoomUrl': m['join_url'], 'description': text}
    s['last'] = result
    s['defaults'] = {k: d[k] for k in ['subject', 'duration', 'zone', 'time']}
    if d.get('remember'):
        s['students'] = [{k: d.get(k, '') for k in ['name', 'gender', 'subject', 'board', 'studentZone', 'lessonType', 'agreement']}] + [v for v in s.get('students', []) if v['name'] != d['name']][:19]
    s['uncertain'].remove(d['requestId'])
    save_state(s)
    UNCERTAIN.discard(d['requestId'])
    return sync_calendar(s)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, value, code=200, kind='application/json; charset=utf-8'):
        body = value.encode() if isinstance(value, str) else json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get('Host') != '127.0.0.1:' + str(self.server.server_port):
            return self.send({'error': 'Доступ запрещён'}, 403)
        if self.path != '/':
            return self.send({'error': 'Не найдено'}, 404)
        html = (ROOT / 'Интерфейс.html').read_text(encoding='utf-8')
        html = html.replace('<script>', '<script>window.TOKEN=' + json.dumps(TOKEN) + ';', 1)
        self.send(html, kind='text/html; charset=utf-8')

    def do_POST(self):
        if self.path != '/api' or self.headers.get('X-Lesson-Token') != TOKEN or self.headers.get('Host') != '127.0.0.1:' + str(self.server.server_port):
            return self.send({'error': 'Доступ запрещён'}, 403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length < 100000:
                raise ValueError('Слишком большой запрос.')
            body = json.loads(self.rfile.read(length))
            self.send(action(body['action'], body.get('data', {})))
        except Exception as e:
            message = str(e) if isinstance(e, ValueError) else 'Не удалось завершить действие. Проверьте подключение и настройки Zoom.'
            self.send({'error': message}, 400)

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 0), Handler)
    url = 'http://127.0.0.1:' + str(server.server_port)
    print('Урок Zoom открыт в браузере. Это окно можно свернуть. Для завершения нажмите Ctrl+C.', flush=True)
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
