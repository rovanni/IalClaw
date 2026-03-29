import os

def setup_test_workspace():
    # Use workspace-relative path
    base = "skills/internal/file-manipulator-workspace/test_workspace"
    dirs = ["logs", "config", "data"]
    
    # Ensure directory exists
    if not os.path.exists(base):
        os.makedirs(base, exist_ok=True)
    
    for d in dirs:
        d_path = os.path.join(base, d)
        os.makedirs(d_path, exist_ok=True)
    
        # Create files
        if d == "logs":
            for i in range(3):
                with open(os.path.join(d_path, f"log_{i}.txt"), "w") as f:
                    f.write(f"log content {i}")
        elif d == "config":
            for i in range(3):
                with open(os.path.join(d_path, f"conf_{i}.yaml"), "w") as f:
                    f.write(f"server: localhost\nport: 808{i}")
        elif d == "data":
            for i in range(3):
                with open(os.path.join(d_path, f"data_{i}.json"), "w") as f:
                    f.write('{"status": "active"}')
            
    print(f"Test workspace setup at {os.path.abspath(base)}")

if __name__ == "__main__":
    setup_test_workspace()
