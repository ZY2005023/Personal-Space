"""Validate the active OpenAPI and its documented differences from the frozen delivery.

Requires PyYAML and openapi-spec-validator. Does not access a database or network.
"""
import copy
import json
from pathlib import Path
import yaml
from openapi_spec_validator import validate

root = Path(__file__).resolve().parents[1]
spec = yaml.safe_load((root / "contracts/openapi.yaml").read_text(encoding="utf-8"))
baseline = yaml.safe_load((root / "docs/design-delivery/03-openapi-3.1.1.yaml").read_text(encoding="utf-8"))
validate(spec)
references = []
def walk(value):
    if isinstance(value, dict):
        if "$ref" in value:
            ref = value["$ref"]
            assert ref.startswith("#/"), "Only local references are allowed"
            node = spec
            for part in ref[2:].split("/"):
                node = node[part.replace("~1", "/").replace("~0", "~")]
            references.append(ref)
        for item in value.values():
            walk(item)
    elif isinstance(value, list):
        for item in value:
            walk(item)
walk(spec)
operations = [op["operationId"] for path in spec["paths"].values() for method, op in path.items() if method in {"get", "post", "put", "delete", "patch", "head", "options"}]
assert len(operations) == len(set(operations)), "Duplicate operationId"
normalized = copy.deepcopy(spec)
preview = normalized["paths"].pop("/admin/media/{mediaId}/image")["get"]
assert preview["security"] == [{"adminSession": []}]
assert preview["responses"]["200"]["headers"]["Cache-Control"]["schema"]["const"] == "private, no-store"
normalized["info"] = baseline["info"]
normalized.pop("x-implementation-status")
normalized["components"]["securitySchemes"]["adminSession"] = baseline["components"]["securitySchemes"]["adminSession"]
normalized["components"]["schemas"]["Problem"]["properties"]["code"]["enum"] = baseline["components"]["schemas"]["Problem"]["properties"]["code"]["enum"]
normalized["components"]["responses"].pop("Problem503")
for item in normalized["paths"].values():
    for op in item.values():
        assert op["responses"].pop("503") == {"$ref": "#/components/responses/Problem503"}
assert normalized == baseline, "An undocumented change to the frozen API semantics was found"
package = json.loads((root / "package.json").read_text(encoding="utf-8"))
lock = json.loads((root / "package-lock.json").read_text(encoding="utf-8"))
for group in ("dependencies", "devDependencies"):
    for name, version in package[group].items():
        assert lock["packages"]["node_modules/" + name]["version"] == version
        assert lock["packages"][""][group][name] == version
auth_spec = yaml.safe_load((root / "contracts/auth-security.yaml").read_text(encoding="utf-8"))
validate(auth_spec)
auth_refs = []
def walk_auth(value):
    if isinstance(value, dict):
        if "$ref" in value:
            ref = value["$ref"]
            assert ref.startswith("#/")
            node = auth_spec
            for part in ref[2:].split("/"):
                node = node[part.replace("~1", "/").replace("~0", "~")]
            auth_refs.append(ref)
        for child in value.values(): walk_auth(child)
    elif isinstance(value, list):
        for child in value: walk_auth(child)
walk_auth(auth_spec)
assert auth_spec["servers"] == [{"url": "/api/auth/security"}]
assert auth_spec["security"] == [{"adminSession": []}]
auth_ids = [op["operationId"] for item in auth_spec["paths"].values() for op in item.values()]
assert len(set(auth_ids + operations)) == len(auth_ids + operations)
for item in auth_spec["paths"].values():
    op = item["post"]
    assert any(p["name"] == "X-CSRF-Token" and p["required"] for p in op["parameters"])
    assert op["responses"]["200"]["headers"]["Cache-Control"]["schema"]["const"] == "private, no-store"
print(json.dumps({"authSecurityStructure": "passed", "authSecurityOperations": len(auth_ids), "authSecurityReferenceOccurrences": len(auth_refs), "authSecurityUnresolvedReferences": 0}))
print(json.dumps({"openapi": spec["openapi"], "contractVersion": spec["info"]["version"], "structure": "passed", "referenceOccurrences": len(references), "unresolvedReferences": 0, "paths": len(spec["paths"]), "operations": len(operations), "documentedDifferencesOnly": True, "dependencyLockMatches": True, "databaseAccessed": False}, ensure_ascii=False, indent=2))
