# Historical compact-v3 wire fixture

`afeec7b.json` records the unchanged `afeec7b8f7eed0cbf9c11dd74544582acb78c25f`
compact-v3 writer output for the existing single-step Runtime fixture, plus the
exact referenced objects and the restored logical model digest. It contains only
synthetic repository test data, not target-project or user task data.

Do not regenerate it when the current writer changes. The compatibility test
reads these bytes and material directly, then checks alternate YAML spellings
and negative hot-field/summary/material tampering. A different presentation
layout requires a new format reader, while the v3 model remains supported.

This fixture tests wire/material reading. Committed-manifest membership and
physical source hashes are separately covered by aggregate/lifecycle regressions.
