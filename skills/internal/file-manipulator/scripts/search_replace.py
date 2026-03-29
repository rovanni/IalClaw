import os
import argparse
import fnmatch
import sys

def search_replace(directory, include_pattern, search_text, replace_text, dry_run=False):
    affected_count = 0
    
    for root, dirs, files in os.walk(directory):
        for filename in fnmatch.filter(files, include_pattern):
            file_path = os.path.join(root, filename)
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                if search_text in content:
                    new_content = content.replace(search_text, replace_text)
                    
                    if dry_run:
                        print(f"[DRY RUN] Would update: {file_path}")
                    else:
                        with open(file_path, 'w', encoding='utf-8') as f:
                            f.write(new_content)
                        print(f"Updated: {file_path}")
                        affected_count += 1
            except Exception as e:
                print(f"Error processing {file_path}: {e}", file=sys.stderr)
                
    return affected_count

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Search and replace text in multiple files.")
    parser.add_argument("--dir", required=True, help="Target directory")
    parser.add_argument("--include", default="*", help="File pattern to include (e.g. *.ts)")
    parser.add_argument("--search", required=True, help="Text to search for")
    parser.add_argument("--replace", required=True, help="Replacement text")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without applying them")
    
    args = parser.parse_args()
    
    if not os.path.isdir(args.dir):
        print(f"Error: {args.dir} is not a directory.", file=sys.stderr)
        sys.exit(1)
        
    count = search_replace(args.dir, args.include, args.search, args.replace, args.dry_run)
    print(f"Done. Files affected: {count}")
