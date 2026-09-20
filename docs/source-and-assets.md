# Source and asset policy

Brickworks uses original code, procedural materials, geometry, audio, and documentation. The desired look is a generic, brick-built miniature industrial world. Do not add LEGO, Tesla, robotaxi maker, supplier, or other third-party logos; do not use protected brand names in the scene; and do not import third-party model, texture, audio, or icon assets unless their license and provenance are recorded before use.

The public publication [WO2024182432A1](https://patents.google.com/patent/WO2024182432A1/en) is design context only. Brickworks independently adapts five broad simulation ideas: staged material receiving, parallel module processing, queue and buffer constraints, joining of independently produced modules, and outbound staging/dispatch. These are common manufacturing abstractions implemented with original names, records, behavior, and visual design. The patent is not an asset source, specification, implementation guide, endorsement, or claim that Brickworks uses Tesla's factory methods. Avoid copying drawings, text, names, layouts, distinctive visual features, or patented claim language.

## Asset inventory requirements

For every non-procedural asset, record in the change that introduces it:

| Field | Required value |
| --- | --- |
| Asset ID and path | Stable identifier and repository path. |
| Creator/source | Original author or a direct source URL. |
| License | License name and attribution/notice obligation. |
| Modification | Whether it was altered and how. |
| Review | Confirmation that it contains no third-party marks or restricted content. |

Store original visual reference work under `docs/assets/`; that directory is intentionally outside the documentation ownership boundary for implementation changes. The repository's original code and documentation are MIT licensed under [LICENSE](../LICENSE).
