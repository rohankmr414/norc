import json

with open('out/package.json') as json_file:
    data = json.load(json_file)

data["name"] = "cron-cal"
data["devDependencies"] = {"electron": "^17.0.0", "electron-builder": "^22.14.5"}
data["scripts"] = {
    "start": "electron .",
    "pack": "electron-builder --dir",
    "build": "electron-builder build --linux"
}
data["build"] = {
    "appId": "com.cron.electron",
    "productName": "CronCal",
    "linux": {
        "target": ["deb", "pacman"],
        "category": "Office",
        "artifactName": "Cron-${version}.${ext}",
        "desktop": {
            "Name": "Cron Calender",
            "Terminal": "false"
        }
    },
    "protocols": [
        {
            "name": "Cron Calendar",
            "schemes": [
                "cron"
            ]
        }
    ],
    "directories": {
        "output": "release"
    },
    "files": [
        "./build/**/*",
        "./build/*",
        "./build/preload/*",
        "./build/icons/*"
    ]
}
with open('out/package.json', 'w') as json_file:
    json.dump(data, json_file)


with open('out/build/main/main.js', 'r') as file:
    file_data = file.read()

file_data = file_data.replace("win32", "linux")
file_data = file_data.replace("darwin", "linux")
file_data = file_data.replace("development", "production")

with open('out/build/main/main.js', 'w') as file:
    file.write(file_data)

