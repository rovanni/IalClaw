import json
import sys

# Common installation recipes for different operating systems and package managers
RECIPES = {
    "ffmpeg": {
        "Windows": {
            "choco": "choco install ffmpeg",
            "scoop": "scoop install ffmpeg",
            "winget": "winget install ffmpeg"
        },
        "Linux": {
            "apt": "sudo apt-get update && sudo apt-get install -y ffmpeg",
            "dnf": "sudo dnf install ffmpeg",
            "pacman": "sudo pacman -S ffmpeg",
            "brew": "brew install ffmpeg"
        },
        "Darwin": {
            "brew": "brew install ffmpeg"
        }
    },
    "tree": {
        "Windows": {
            "choco": "choco install tree",
            "scoop": "scoop install tree",
            "winget": "winget install GnuWin32.Tree"
        },
        "Linux": {
            "apt": "sudo apt-get update && sudo apt-get install -y tree",
            "dnf": "sudo dnf install tree",
            "pacman": "sudo pacman -S tree",
        }
    },
    "git": {
        "Windows": {
            "choco": "choco install git",
            "scoop": "scoop install git",
            "winget": "winget install Git.Git"
        },
        "Linux": {
            "apt": "sudo apt-get update && sudo apt-get install -y git",
            "dnf": "sudo dnf install git",
            "pacman": "sudo pacman -S git",
        }
    }
}

def get_install_command(resource, os_name, pm_list):
    if resource not in RECIPES:
        return None
    
    os_recipes = RECIPES[resource].get(os_name, {})
    for pm in pm_list:
        if pm in os_recipes:
            return os_recipes[pm]
    
    return None

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: install_helper.py <resource> <os> <pm1,pm2,...>"}))
        sys.exit(1)
    
    resource = sys.argv[1].lower()
    os_name = sys.argv[2]
    pm_list = sys.argv[3].split(",") if len(sys.argv) > 3 else []
    
    command = get_install_command(resource, os_name, pm_list)
    print(json.dumps({"resource": resource, "command": command}))
