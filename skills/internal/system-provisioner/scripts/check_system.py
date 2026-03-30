import os
import shutil
import platform
import json
import subprocess

def check_package_manager(cmd):
    return shutil.which(cmd) is not None

def get_system_info():
    info = {
        "os": platform.system(),
        "release": platform.release(),
        "arch": platform.machine(),
        "package_managers": {}
    }

    # Common package managers
    pms = ["apt", "dnf", "yum", "pacman", "brew", "choco", "scoop", "pip", "npm", "yarn", "pnpm", "winget"]
    
    for pm in pms:
        info["package_managers"][pm] = check_package_manager(pm)

    python3_pm = check_package_manager("python3")
    info["package_managers"]["python3"] = python3_pm
    if python3_pm:
        try:
            info["python_version"] = subprocess.check_output(["python3", "--version"], text=True).strip()
        except:
            pass
    else:
        python_pm = check_package_manager("python")
        info["package_managers"]["python"] = python_pm
        if python_pm:
            try:
                info["python_version"] = subprocess.check_output(["python", "--version"], text=True).strip()
            except:
                pass

    return info

if __name__ == "__main__":
    system_info = get_system_info()
    print(json.dumps(system_info, indent=2))
