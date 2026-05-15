"""
tm1_deploy/diff.py — compare YAML model definitions against live TM1 server state.

Returns a list of Change objects describing what would be created or updated.
"""

from dataclasses import dataclass
from tm1_deploy.tm1_client import TM1Client
from tm1_deploy.loader import load_model, flatten_elements
from pathlib import Path


@dataclass
class Change:
    action:  str   # 'create' | 'update' | 'ok'
    kind:    str   # 'dimension' | 'cube'
    name:    str
    details: list  # human-readable list of what would change


def diff_dimension(client: TM1Client, defn: dict) -> Change:
    name    = defn['dimension']
    live    = client.get_dimension(name)

    if live is None:
        return Change('create', 'dimension', name, ['does not exist on server'])

    changes = []

    # Compare elements
    yaml_els, _ = flatten_elements(defn.get('elements', []))
    yaml_names  = {e['Name'] for e in yaml_els}
    live_names  = {e['Name'] for e in client.get_elements(name)}

    added   = yaml_names - live_names
    removed = live_names - yaml_names
    if added:
        changes.append(f'add elements: {sorted(added)}')
    if removed:
        changes.append(f'remove elements: {sorted(removed)}')

    # Compare attribute definitions
    yaml_attrs = {a['name']: a['type'] for a in defn.get('attributes', [])}
    live_attrs = {a['Name']: a['Type'] for a in client.get_element_attributes(name)}

    for aname, atype in yaml_attrs.items():
        if aname not in live_attrs:
            changes.append(f'add attribute: {aname} ({atype})')
        elif live_attrs[aname] != atype:
            changes.append(f'change attribute type: {aname} {live_attrs[aname]} → {atype}')
    for aname in live_attrs:
        if aname not in yaml_attrs:
            changes.append(f'remove attribute: {aname}')

    return Change('update' if changes else 'ok', 'dimension', name, changes)


def diff_cube(client: TM1Client, defn: dict) -> Change:
    name = defn['cube']
    live = client.get_cube(name)

    if live is None:
        return Change('create', 'cube', name, ['does not exist on server'])

    changes = []

    yaml_dims = defn.get('dimensions', [])
    live_dims = [d['Name'] for d in live.get('Dimensions', [])]

    if yaml_dims != live_dims:
        changes.append(f'dimensions: {live_dims} → {yaml_dims}')

    yaml_rules = defn.get('_rules_text', '').strip()
    live_rules = (live.get('Rules') or '').strip()
    if yaml_rules != live_rules:
        changes.append('rules file differs')

    return Change('update' if changes else 'ok', 'cube', name, changes)


def diff_model(server: str, model_dir: Path) -> list[Change]:
    client = TM1Client(server)
    model  = load_model(model_dir)
    result = []

    for defn in model['dimensions']:
        result.append(diff_dimension(client, defn))

    for defn in model['cubes']:
        result.append(diff_cube(client, defn))

    return result


def print_diff(changes: list[Change]):
    has_changes = False
    for c in changes:
        if c.action == 'ok':
            print(f'  ✓  {c.kind:12} {c.name}')
        else:
            has_changes = True
            symbol = '+' if c.action == 'create' else '~'
            print(f'  {symbol}  {c.kind:12} {c.name}')
            for detail in c.details:
                print(f'       {detail}')
    if not has_changes:
        print('\n  No changes.')
