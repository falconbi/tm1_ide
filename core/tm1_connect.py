"""
core/tm1_connect.py — TM1 session manager via PAW proxy.

Routes all TM1 REST calls through PAW at:
  {PAW_HOST}/api/v0/tm1/{server}/api/v1/{resource}

No direct TM1 connections — no per-server ports, addresses, or SSL config.
Server names still come from config/servers.json (PAW has no list endpoint).
"""

import json
from pathlib import Path
from core.paw_connect import get_cached_paw_session, PAW_HOST

SERVERS_FILE = Path(__file__).parent.parent / 'config' / 'servers.json'


def load_servers() -> list:
    if not SERVERS_FILE.is_file():
        raise EnvironmentError('TM1 not configured — config/servers.json not found')
    return json.loads(SERVERS_FILE.read_text(encoding='utf-8'))


def get_server_list() -> list:
    """Return [{name, databases:[name]}] for the frontend server dropdown."""
    return [{'name': s['name'], 'databases': [s['name']]} for s in load_servers()]


class TM1ProxySession:
    """PAW session scoped to one TM1 server via the /api/v0/tm1/ proxy."""

    def __init__(self, paw_session, server_name: str):
        self._session  = paw_session
        self.base_url  = f'{PAW_HOST}/api/v0/tm1/{server_name}/api/v1'

    def get(self, url, **kwargs):
        headers = kwargs.pop('headers', {})
        headers['ba-sso-authenticity'] = self._session.cookies.get('ba-sso-csrf', '')
        return self._session.get(url, headers=headers, **kwargs)


def get_session(db_name: str) -> TM1ProxySession:
    """Return a TM1ProxySession for the named database."""
    names = [s['name'] for s in load_servers()]
    if db_name not in names:
        raise ValueError(f"Database '{db_name}' not found in servers.json")
    return TM1ProxySession(get_cached_paw_session(), db_name)
