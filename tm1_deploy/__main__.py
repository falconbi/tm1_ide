"""
tm1_deploy — CLI entry point.

Usage:
    python3 -m tm1_deploy diff  --server "Planning Sample" --model models/
    python3 -m tm1_deploy apply --server "Planning Sample" --model models/
"""

import argparse
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / '.env')

from tm1_deploy.diff  import diff_model, print_diff
from tm1_deploy.apply import apply_model


def main():
    parser = argparse.ArgumentParser(prog='tm1_deploy')
    parser.add_argument('command', choices=['diff', 'apply'])
    parser.add_argument('--server', required=True, help='TM1 server name')
    parser.add_argument('--model',  default='models/', help='Path to model directory')
    args = parser.parse_args()

    model_dir = Path(args.model)
    if not model_dir.is_dir():
        print(f'Error: model directory not found: {model_dir}')
        sys.exit(1)

    if args.command == 'diff':
        print(f'\nDiff [{args.server}] vs {model_dir}\n')
        changes = diff_model(args.server, model_dir)
        print_diff(changes)

    elif args.command == 'apply':
        apply_model(args.server, model_dir)


if __name__ == '__main__':
    main()
