"""
tm1_deploy/apply.py — apply YAML model definitions to a TM1 server.
"""

from tm1_deploy.tm1_client import TM1Client
from tm1_deploy.loader import load_model, flatten_elements
from tm1_deploy.diff import diff_dimension, diff_cube
from pathlib import Path


def apply_dimension(client: TM1Client, defn: dict):
    name    = defn['dimension']
    hier    = defn.get('hierarchy', name)
    change  = diff_dimension(client, defn)

    if change.action == 'ok':
        print(f'  ✓  dimension  {name}  (no changes)')
        return

    elements, edges = flatten_elements(defn.get('elements', []))

    if change.action == 'create':
        client.post('Dimensions', {
            'Name': name,
            'Hierarchies': [{
                'Name':     hier,
                'Elements': elements,
                'Edges':    edges,
            }]
        })
        print(f'  +  dimension  {name}  created')
    else:
        # Update: replace hierarchy elements and edges
        client.patch(f"Dimensions('{name}')/Hierarchies('{hier}')", {
            'Elements': elements,
            'Edges':    edges,
        })
        print(f'  ~  dimension  {name}  updated')

    # Ensure attribute definitions exist
    live_attrs = {a['Name'] for a in client.get_element_attributes(name)}
    for attr in defn.get('attributes', []):
        if attr['name'] not in live_attrs:
            client.post(
                f"Dimensions('{name}')/Hierarchies('{hier}')/ElementAttributes",
                {'Name': attr['name'], 'Type': attr['type']}
            )
            print(f'       + attribute  {attr["name"]} ({attr["type"]})')


def apply_cube(client: TM1Client, defn: dict):
    name   = defn['cube']
    change = diff_cube(client, defn)

    if change.action == 'ok':
        print(f'  ✓  cube        {name}  (no changes)')
        return

    dims = defn.get('dimensions', [])

    if change.action == 'create':
        client.post('Cubes', {
            'Name': name,
            'Dimensions@odata.bind': [f"Dimensions('{d}')" for d in dims],
        })
        print(f'  +  cube        {name}  created')
    else:
        print(f'  ~  cube        {name}  updated')

    # Apply rules if present
    rules_text = defn.get('_rules_text', '')
    if rules_text:
        client.patch(f"Cubes('{name}')", {'Rules': rules_text})
        print(f'       ~ rules updated')


def apply_model(server: str, model_dir: Path):
    client = TM1Client(server)
    model  = load_model(model_dir)

    print(f'\nApplying model to [{server}]...\n')

    for defn in model['dimensions']:
        apply_dimension(client, defn)

    for defn in model['cubes']:
        apply_cube(client, defn)

    print('\nDone.')
