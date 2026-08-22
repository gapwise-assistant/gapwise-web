import os

files = {}

def save(path, content):
    full = os.path.join('/home/martelaxe/gapwise', path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as out:
        out.write(content)
    print(f'Saved {path}')
