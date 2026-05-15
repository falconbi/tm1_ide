"""
tm1_deploy/loader.py — load and validate YAML model definitions.
"""

import yaml
from pathlib import Path


def load_yaml(path: Path) -> dict:
    with open(path, encoding='utf-8') as f:
        return yaml.safe_load(f)


def load_model(model_dir: Path) -> dict:
    """
    Load all YAML definitions from a model directory.
    Returns { 'dimensions': [...], 'cubes': [...] }
    """
    model = {'dimensions': [], 'cubes': []}

    dim_dir  = model_dir / 'dimensions'
    cube_dir = model_dir / 'cubes'

    if dim_dir.is_dir():
        for f in sorted(dim_dir.glob('*.yaml')):
            d = load_yaml(f)
            d['_file'] = str(f)
            model['dimensions'].append(d)

    if cube_dir.is_dir():
        for f in sorted(cube_dir.glob('*.yaml')):
            c = load_yaml(f)
            c['_file'] = str(f)
            # Load rules file if referenced
            if c.get('rules'):
                rules_path = model_dir / c['rules']
                if rules_path.is_file():
                    c['_rules_text'] = rules_path.read_text(encoding='utf-8')
            model['cubes'].append(c)

    return model


def flatten_elements(elements: list, parent: str = None) -> tuple[list, list]:
    """
    Recursively flatten nested YAML element tree into flat elements + edges lists.
    Returns (elements, edges).
    """
    flat_elements = []
    edges = []

    for el in elements:
        flat_elements.append({
            'Name': el['name'],
            'Type': el.get('type', 'Numeric'),
        })
        if parent:
            edges.append({
                'ParentName':    parent,
                'ComponentName': el['name'],
                'Weight':        el.get('weight', 1),
            })
        if el.get('children'):
            child_els, child_edges = flatten_elements(el['children'], parent=el['name'])
            flat_elements.extend(child_els)
            edges.extend(child_edges)

    return flat_elements, edges
