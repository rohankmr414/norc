from urllib3 import PoolManager
import shutil
import os
from os.path import dirname as up
import subprocess
from distutils.dir_util import copy_tree

url = "https://download.cron.com/mac/dmg/x64"
path = up(os.path.abspath(__file__))
cron_dmg = path + "/cron.dmg"
http = PoolManager()

with http.request('GET', url, preload_content=False) as r, open(cron_dmg, 'wb') as out_file:
    shutil.copyfileobj(r, out_file)
subprocess.run(["7z", "x", "cron.dmg", "-oout"])
shutil.copy("out/Cron/Cron.app/Contents/Resources/app.asar", path)
shutil.rmtree("out/")
os.remove(cron_dmg)
subprocess.run(["npx", "asar", "extract", "app.asar", "out"])
os.mkdir("out/build/icons")
copy_tree("icons/", "out/build/icons/")
