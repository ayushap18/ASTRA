import ast
import hashlib
from pathlib import PurePosixPath

import tree_sitter_javascript
import tree_sitter_typescript
from tree_sitter import Language, Node, Parser

from app.models import Evidence, Graph

JAVASCRIPT = Language(tree_sitter_javascript.language())
TYPESCRIPT = Language(tree_sitter_typescript.language_typescript())
TSX = Language(tree_sitter_typescript.language_tsx())

LANGUAGES = {
    ".js": JAVASCRIPT,
    ".jsx": JAVASCRIPT,
    ".mjs": JAVASCRIPT,
    ".cjs": JAVASCRIPT,
    ".ts": TYPESCRIPT,
    ".mts": TYPESCRIPT,
    ".cts": TYPESCRIPT,
    ".tsx": TSX,
}


def _literal(node: Node | None, source: bytes) -> str | None:
    if node is None or node.type != "string":
        return None
    try:
        value = ast.literal_eval(source[node.start_byte : node.end_byte].decode())
    except (SyntaxError, ValueError):
        return None
    return value if isinstance(value, str) else None


def _references(root: Node, source: bytes):
    stack = [root]
    while stack:
        node = stack.pop()
        spec = None
        if node.type in {"import_statement", "export_statement"}:
            source_node = node.child_by_field_name("source")
            if source_node is None and node.type == "import_statement":
                require_clause = next(
                    (child for child in node.named_children if child.type == "import_require_clause"), None
                )
                if require_clause is not None:
                    source_node = require_clause.child_by_field_name("source")
            spec = _literal(source_node, source)
        elif node.type == "call_expression":
            function = node.child_by_field_name("function")
            arguments = node.child_by_field_name("arguments")
            if function is not None and arguments is not None:
                function_name = source[function.start_byte : function.end_byte]
                values = [child for child in arguments.named_children if child.type != "comment"]
                if values and (
                    function_name == b"import" or (function_name == b"require" and len(values) == 1)
                ):
                    spec = _literal(values[0], source)
        if spec is not None:
            yield spec, node.start_point.row + 1
        stack.extend(reversed(node.children))


def _package_name(spec: str) -> str | None:
    if not spec or spec.startswith((".", "/", "node:")):
        return None
    parts = spec.split("/")
    if spec.startswith("@"):
        return "/".join(parts[:2]) if len(parts) >= 2 and parts[1] else None
    return parts[0] or None


def inspect_sources(graph: Graph, sources: dict[str, str]) -> Graph:
    by_path = {p.install_path: p for p in graph.packages}
    existing_evidence = {e.id for e in graph.evidence}
    for file, content in sorted(sources.items()):
        path = PurePosixPath(file)
        language = LANGUAGES.get(path.suffix.lower())
        if language is None or "node_modules" in path.parts:
            continue
        source = content.encode()
        tree = Parser(language).parse(source)
        if tree.root_node.has_error:
            warning = f"AST parse for {file} contains syntax errors; module-reference evidence may be partial"
            if warning not in graph.warnings:
                graph.warnings.append(warning)
        digest = hashlib.sha256(source).hexdigest()
        for spec, line_number in _references(tree.root_node, source):
            name = _package_name(spec)
            if name is None:
                continue
            # Project sources can substantiate only the root-installed instance.
            package = by_path.get("node_modules/" + name)
            if not package:
                continue
            eid = (
                "ev:module:" + hashlib.sha256(f"{file}:{line_number}:{package.id}".encode()).hexdigest()[:20]
            )
            if eid not in existing_evidence:
                existing_evidence.add(eid)
                graph.evidence.append(
                    Evidence(
                        id=eid,
                        kind="module_reference",
                        source="static-ast-v2",
                        location=f"{file}:{line_number}",
                        sha256=digest,
                        summary=(
                            f"Parsed module syntax references {name}; source-file and package execution "
                            "are unproven."
                        ),
                        confidence=0.8,
                    )
                )
            if eid not in package.reachability.evidence_ids:
                package.reachability.evidence_ids.append(eid)
            if package.reachability.level < 2:
                package.reachability.level = 2
                package.reachability.status = "module_observed"
    # Parsed module syntax is still not proof of package or edge execution.
    return graph
