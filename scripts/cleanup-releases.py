#!/usr/bin/env python3
"""Keep the active Minework release; preview by default, delete with --apply."""
import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path('/home/ubuntu/workweave')


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True)


def inspect(name):
    return json.loads(docker('inspect', name))[0]


def checked_path(path, protected):
    if path.is_symlink() or not path.resolve().is_relative_to(ROOT.resolve()):
        raise RuntimeError(f'Refusing cleanup outside release root: {path}')
    if any(path.resolve() == item or item.is_relative_to(path.resolve()) or path.resolve().is_relative_to(item) for item in protected):
        raise RuntimeError(f'Refusing cleanup of an active mount or release: {path}')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--prune-build-cache', action='store_true',
                        help='Also clear unused cache in the shared Docker builder (no images or volumes).')
    args = parser.parse_args()
    active = inspect('workweave')
    if not active['State']['Running']:
        raise RuntimeError('Minework must be running before cleaning releases')
    image = active['Config']['Image']
    match = re.fullmatch(r'(?:workweave|minework):(\d{8}-[a-zA-Z0-9-]+)', image)
    if not match:
        raise RuntimeError(f'Cannot derive the active release from image: {image}')
    release = ROOT / 'releases' / match[1]
    if not release.is_dir() or release.is_symlink():
        raise RuntimeError('The active source release must exist as a real directory')
    protected = {release.resolve(), (ROOT / 'data').resolve(), (ROOT / 'workweave.env').resolve()}
    # A mount owned by any application must never be deleted as a build artifact.
    ids = docker('container', 'ls', '-aq').split()
    containers = json.loads(docker('inspect', *ids)) if ids else []
    for container in containers:
        for mount in container['Mounts']:
            if mount['Type'] == 'bind':
                protected.add(Path(mount['Source']).resolve())
    obsolete = [container for container in containers
                if re.fullmatch(r'/(?:workweave|minework)-(?:rollback-.+|failed-.+|.+-check)', container['Name'])
                and container['State']['Status'] in {'exited', 'created', 'dead'}]
    obsolete_ids = {container['Id'] for container in obsolete}
    referenced_images = {container['Image'] for container in containers if container['Id'] not in obsolete_ids}
    images = [json.loads(line) for line in docker('image', 'ls', '--no-trunc', '--format', '{{json .}}').splitlines()]
    old_images = sorted({f"{entry['Repository']}:{entry['Tag']}" for entry in images
                         if entry['Repository'] in {'workweave', 'minework'} and entry['Tag'] != '<none>'
                         and f"{entry['Repository']}:{entry['Tag']}" != image
                         and entry['ID'] not in referenced_images})
    paths = []
    for path in (ROOT / 'releases').iterdir():
        if path != release:
            paths.append(checked_path(path, protected))
    # Latest-only retention includes database snapshots. Never move backups to
    # another directory: the live bind-mounted database remains protected above.
    for name in ['backups', 'database-backups']:
        path = ROOT / name
        if path.exists():
            paths.append(checked_path(path, protected))
    for pattern in ['workweave-*.tar.gz', 'minework-*.tar.gz', 'workweave-*.zip', 'minework-*.zip', 'build-*.sh', 'deploy-*.sh', 'build-*.py', 'deploy-*.py', 'publish-*.py', 'verify-*.py', 'inspect-*.py', 'audit-*.py', 'inventory-cleanup.py', '*.bak', '*.backup', '*.old']:
        for path in ROOT.glob(pattern):
            if path.is_file():
                paths.append(checked_path(path, protected))
    paths = list(dict.fromkeys(paths))
    plan = {'mode': 'apply' if args.apply else 'preview', 'keep_image': image,
            'keep_release': str(release), 'remove_containers': [c['Name'][1:] for c in obsolete],
            'remove_images': old_images, 'remove_paths': [str(p) for p in paths],
            'retention': 'active release and live data only; no historical backups',
            'prune_shared_unused_build_cache': args.prune_build_cache}
    print(json.dumps(plan, indent=2), flush=True)
    if not args.apply:
        return
    # Abort if a deployment raced with the inventory.
    latest = inspect('workweave')
    if latest['Id'] != active['Id'] or latest['Image'] != active['Image'] or not latest['State']['Running']:
        raise RuntimeError('The active deployment changed; rerun the preview')
    free_before = shutil.disk_usage(ROOT).free
    for container in obsolete:
        latest = inspect(container['Id'])
        if latest['State']['Status'] not in {'exited', 'created', 'dead'}:
            raise RuntimeError('A rollback container restarted during cleanup')
        docker('container', 'rm', container['Id'])  # Never force-remove running containers.
    for reference in old_images:
        docker('image', 'rm', reference)
    for path in paths:
        checked_path(path, protected)
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
    if args.prune_build_cache:
        output = docker('builder', 'prune', '--all', '--force')
        print(output.strip().splitlines()[-1] if output.strip() else 'No unused build cache')
    latest = inspect('workweave')
    if latest['Id'] != active['Id'] or latest['Image'] != active['Image'] or not latest['State']['Running']:
        raise RuntimeError('Active deployment changed during cleanup')
    print(json.dumps({'freed_bytes': shutil.disk_usage(ROOT).free - free_before,
                      'active_image': latest['Config']['Image'], 'running': latest['State']['Running']}))


if __name__ == '__main__':
    main()
