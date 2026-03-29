---
name: file-manipulator
description: Advanced file system operations. Use for recursive searching, bulk renaming, global search and replace, and safe editing of large numbers of files. Trigger when the user asks for multi-file operations, pattern-based changes, or complex workspace cleanup.
---

# File Manipulator

This skill extends the basic file tools with high-level coordination and safety features.

## When to use
- **Bulk Renaming**: "Rename all .png to .webp in the assets folder".
- **Global Search and Replace**: "Update the API version in all configuration files".
- **Recursive Search**: "Find all TODO comments in the src directory".
- **Specialized Data Editing**: "Update the 'status' field in all JSON projects".

## Core Logic

### 1. Global Search and Replace
Use the `scripts/search_replace.py` script for efficient multi-file updates.
```bash
python scripts/search_replace.py --dir <directory> --include "*.ts" --search "oldText" --replace "newText"
```

### 2. Bulk Renaming
Use the `scripts/bulk_rename.py` script to rename files based on regex.
```bash
python scripts/bulk_rename.py --dir <directory> --pattern "\.old$" --replacement ".new"
```

### 3. Safe Editing with Backups
Before performing large-scale destructive operations, create a backup:
```bash
python scripts/file_backup.py --action create --target <directory_or_file>
```
To restore:
```bash
python scripts/file_backup.py --action restore --target <directory_or_file>
```

## Best Practices
- **Dry Run First**: For bulk operations, always perform a dry run or list the affected files before applying changes.
- **Use Backups**: Always create a backup when the user asks for "system-wide" or "massive" changes.
- **Incremental Changes**: Prefer small, verifiable steps over one giant operation.
- **Verify Results**: Use `grep_search` or `list_directory` after an operation to confirm success.

## Error Handling
If a script fails, check the logs in `logs/file-manipulator.log`. Revert using the backup if available.
