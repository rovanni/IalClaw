import os
import re
import argparse
import sys

def bulk_rename(directory, pattern, replacement, dry_run=False):
    regex = re.compile(pattern)
    renamed_count = 0
    
    for root, dirs, files in os.walk(directory):
        for filename in files:
            if regex.search(filename):
                new_filename = regex.sub(replacement, filename)
                old_path = os.path.join(root, filename)
                new_path = os.path.join(root, new_filename)
                
                if dry_run:
                    print(f"[DRY RUN] Would rename: {old_path} -> {new_path}")
                else:
                    try:
                        os.rename(old_path, new_path)
                        print(f"Renamed: {old_path} -> {new_path}")
                        renamed_count += 1
                    except Exception as e:
                        print(f"Error renaming {old_path}: {e}", file=sys.stderr)
    
    return renamed_count

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk rename files in a directory using regex.")
    parser.add_argument("--dir", required=True, help="Target directory")
    parser.add_argument("--pattern", required=True, help="Regex pattern to match")
    parser.add_argument("--replacement", required=True, help="Replacement string")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without applying them")
    
    args = parser.parse_args()
    
    if not os.path.isdir(args.dir):
        print(f"Error: {args.dir} is not a directory.", file=sys.stderr)
        sys.exit(1)
        
    count = bulk_rename(args.dir, args.pattern, args.replacement, args.dry_run)
    print(f"Done. Files affected: {count}")
