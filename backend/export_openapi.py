import json
from pathlib import Path
from app.main import app

def export_schema():
    schema = app.openapi()
    output_path = Path(__file__).resolve().parent.parent / "docs" / "contracts" / "openapi.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False)
    print(f"Successfully exported OpenAPI schema with {len(schema.get('paths', {}))} paths to {output_path}")

if __name__ == "__main__":
    export_schema()
