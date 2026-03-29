import os
import shutil
import argparse
import sys
import datetime

def create_backup(target):
    if not os.path.exists(target):
        print(f"Error: {target} does not exist.", file=sys.stderr)
        return False
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{target}.backup_{timestamp}"
    
    try:
        if os.path.isdir(target):
            shutil.copytree(target, backup_path)
        else:
            shutil.copy2(target, backup_path)
        print(f"Created backup: {backup_path}")
        return True
    except Exception as e:
        print(f"Error creating backup: {e}", file=sys.stderr)
        return False

def restore_backup(target):
    # Find the most recent backup
    backups = [f for f in os.listdir(os.path.dirname(target) or '.') if f.startswith(os.path.basename(target) + ".backup_")]
    if not backups:
        print(f"No backups found for {target}", file=sys.stderr)
        return False
    
    backups.sort(reverse=True)
    latest_backup = os.path.join(os.path.dirname(target) or '.', backups[0])
    
    try:
        if os.path.exists(target):
            if os.path.isdir(target):
                shutil.rmtree(target)
            else:
                os.remove(target)
        
        if os.path.isdir(latest_backup):
            shutil.copytree(latest_backup, target)
        else:
            shutil.copy2(latest_backup, target)
            
        print(f"Restored from backup: {latest_backup}")
        return True
    except Exception as e:
        print(f"Error restoring backup: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create or restore file/directory backups.")
    parser.add_argument("--action", choices=["create", "restore"], required=True, help="Action to perform")
    parser.add_argument("--target", required=True, help="File or directory target")
    
    args = parser.parse_args()
    
    if args.action == "create":
        success = create_backup(args.target)
    else:
        success = restore_backup(args.target)
        
    if not success:
        sys.exit(1)
