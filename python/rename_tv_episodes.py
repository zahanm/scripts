import re
import os
import shutil

def newn(s):
    m = re.match(r'(.+)\[(\d+)x(\d+)\](.+)', s)
    if not m:
        return None
    else:
        gg = m.groups()
        return f"{gg[0]}s0{ff[1]}e{gg[2]}{gg[3]}"

if __name__ == '__main__':
    for f in os.listdir():
        nn = newn(f)
        if nn:
            shutil.move(f, nn)

