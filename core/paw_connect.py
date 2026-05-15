import os
import time
import threading
import requests
from pathlib import Path
from urllib.parse import quote
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

PAW_HOST     = os.environ['PAW_HOST']
PAW_USERNAME = os.environ.get('PAW_USERNAME', '')
PAW_PASSWORD = os.environ.get('PAW_PASSWORD', '')

PAW_CONFIG = {'paw_host': PAW_HOST}

_session_lock   = threading.Lock()
_cached_session = None
_session_expiry = 0
SESSION_TTL     = 600  # 10 minutes


def get_cached_paw_session() -> requests.Session:
    """Return a cached PAW session, re-authenticating if expired."""
    global _cached_session, _session_expiry
    with _session_lock:
        if _cached_session and time.time() < _session_expiry:
            return _cached_session
        _cached_session = get_paw_session()
        _session_expiry = time.time() + SESSION_TTL
        return _cached_session


def invalidate_paw_session():
    global _cached_session, _session_expiry
    with _session_lock:
        _cached_session = None
        _session_expiry = 0


def get_paw_session() -> requests.Session:
    """Authenticate with PAW V11 native auth and return a session."""
    s = requests.Session()
    s.get(f'{PAW_HOST}/login', allow_redirects=True)
    s.post(
        f'{PAW_HOST}/login/form/',
        data={'username': PAW_USERNAME, 'password': PAW_PASSWORD, 'mode': 'basic'},
        headers={'ba-sso-authenticity': s.cookies.get('ba-sso-csrf', '')},
    )
    if not s.cookies.get('ba-sso-csrf'):
        raise ConnectionError('PAW V11 login failed — ba-sso-csrf cookie not set')
    return s


def paw_get(session: requests.Session, path: str, **kwargs) -> dict:
    """Authenticated GET to PAW Content Services API."""
    url = f'{PAW_HOST}/pacontent/v1/{path}'
    csrf = session.cookies.get('ba-sso-csrf', '')
    headers = {
        'ba-sso-authenticity': csrf,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
    }
    r = session.get(url, headers=headers, **kwargs)
    r.raise_for_status()
    return r.json()


def get_shared_assets(session: requests.Session) -> list:
    data = paw_get(session, "Assets(path='%252fshared')/Assets")
    return data.get('value', [])


def get_folder_assets(session: requests.Session, folder_path: str) -> list:
    encoded = quote(quote(folder_path, safe=''), safe='')
    data = paw_get(session, f"Assets(path='{encoded}')/Assets")
    return data.get('value', [])


def get_asset_by_id(session: requests.Session, asset_id: str, expand_content: bool = False) -> dict:
    path = f"Assets('{asset_id}')"
    if expand_content:
        path += '?$expand=content'
    return paw_get(session, path)


if __name__ == '__main__':
    print('Connecting to PAW...')
    session = get_paw_session()
    print('Connected ✅')
    print(f'PAW Host: {PAW_HOST}')
    assets = get_shared_assets(session)
    print(f'\nShared Assets: {len(assets)} found')
    for a in assets:
        print(f"  [{a['type']:12}] {a['name']}  ({a['path']})")
