"""
tm1_deploy/tm1_client.py — TM1 REST API client for the deploy tool.

All calls route through PAW proxy:
  {PAW_HOST}/api/v0/tm1/{server}/api/v1/{resource}
"""

import requests
from core.paw_connect import get_cached_paw_session, PAW_HOST


class TM1Client:
    """Thin REST client scoped to one TM1 server."""

    def __init__(self, server: str):
        self.server  = server
        self._session = None

    def _s(self) -> requests.Session:
        if self._session is None:
            self._session = get_cached_paw_session()
        return self._session

    def _url(self, path: str) -> str:
        return f'{PAW_HOST}/api/v0/tm1/{self.server}/api/v1/{path}'

    def _headers(self) -> dict:
        return {'ba-sso-authenticity': self._s().cookies.get('ba-sso-csrf', '')}

    def get(self, path: str, **params) -> dict:
        r = self._s().get(self._url(path), headers=self._headers(), params=params)
        r.raise_for_status()
        return r.json() if r.content else {}

    def post(self, path: str, body: dict) -> dict:
        r = self._s().post(self._url(path), json=body, headers=self._headers())
        r.raise_for_status()
        return r.json() if r.content else {}

    def patch(self, path: str, body: dict) -> dict:
        r = self._s().patch(self._url(path), json=body, headers=self._headers())
        r.raise_for_status()
        return r.json() if r.content else {}

    def delete(self, path: str) -> None:
        r = self._s().delete(self._url(path), headers=self._headers())
        r.raise_for_status()

    # ── Dimension helpers ─────────────────────────────────────────────────────

    def get_dimension(self, name: str) -> dict | None:
        try:
            return self.get(f"Dimensions('{name}')", **{'$select': 'Name'})
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise

    def get_elements(self, dim: str) -> list:
        d = self.get(
            f"Dimensions('{dim}')/Hierarchies('{dim}')/Elements",
            **{'$select': 'Name,Type,Level'}
        )
        return d.get('value', [])

    def get_edges(self, dim: str) -> list:
        d = self.get(
            f"Dimensions('{dim}')/Hierarchies('{dim}')/Edges",
            **{'$select': 'ParentName,ComponentName,Weight'}
        )
        return d.get('value', [])

    def get_element_attributes(self, dim: str) -> list:
        d = self.get(
            f"Dimensions('{dim}')/Hierarchies('{dim}')/ElementAttributes",
            **{'$select': 'Name,Type'}
        )
        return d.get('value', [])

    # ── Cube helpers ──────────────────────────────────────────────────────────

    def get_cube(self, name: str) -> dict | None:
        try:
            return self.get(f"Cubes('{name}')", **{'$select': 'Name,Rules', '$expand': 'Dimensions($select=Name)'})
        except requests.HTTPError as e:
            if e.response.status_code == 404:
                return None
            raise
