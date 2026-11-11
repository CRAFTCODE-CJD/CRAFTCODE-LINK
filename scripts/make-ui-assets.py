"""Create the original CRAFTCODE LINK artwork and local notification sounds."""
from pathlib import Path
from PIL import Image
import subprocess
from make_sounds import write_sounds

folder = Path(__file__).resolve().parents[1] / 'src/renderer/assets'
folder.mkdir(exist_ok=True)
art = Path(__file__).resolve().parents[1] / 'installer'
subprocess.run(['inkscape', str(art / 'link.svg'), '--export-width=512',
                '--export-filename=' + str(folder / 'craftlink.png')], check=True)
im = Image.open(folder / 'craftlink.png').convert('RGBA')
im.save(folder / 'craftlink.ico', sizes=[(n,n) for n in (16,24,32,48,64,128,256)])
sidebar = Image.new('RGB', (164,314), '#15212c')
mark = im.resize((117,117), Image.Resampling.LANCZOS)
sidebar.paste(mark, (23,82), mark)
# The author's hammer and ruler identify the publisher at the foot of the wizard.
stamp = Image.open(art / 'publisher.png').convert('L').resize((32,32), Image.Resampling.LANCZOS)
sidebar.paste('#9facb4', (66,262,98,294), stamp)
sidebar.save(art / 'sidebar.bmp')
header = Image.new('RGB', (150,57), 'white')
mark = im.resize((47,47), Image.Resampling.LANCZOS)
header.paste(mark, (93,5), mark)
header.save(art / 'header.bmp')
write_sounds(folder)
