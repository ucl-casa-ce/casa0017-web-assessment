# Access London: Toilet Map Data

## Main outputs
- toilets_london_with_review.csv: cleaned records with review flags.
- toilets_london_with_review.geojson: map points with review flags.
- toilets_london_borough_summary.csv: borough-level record statistics.
- toilets_coordinate_review_assessed.csv: review decisions for shared coordinates.
- toilets_source_manifest.json: input provenance and file fingerprints.
- toilets_quality_report.json: processing counts and remaining limitations.

## Scope
The supplied export contains 16,142 records.
Spatial filtering assigns 1,919 records to the supplied London boundaries.
These are source records, not a verified count of unique physical toilets.

## Processing
1. Preserve the original CSV.
2. Match coordinates against all 33 supplied borough polygons.
3. Retain records matching exactly one borough.
4. Preserve original fields and add standardised values.
5. Map explicit true/false/blank values to yes/no/unknown.
6. Flag exact shared coordinates and record review decisions.
7. Export map data and borough summaries.

## Important interpretation rules
- Accessibility values are source declarations, not project field verification.
- Unknown does not mean inaccessible.
- RADAR key information does not independently prove accessibility.
- Free of charge does not guarantee unrestricted public access.
- Source active status does not establish whether a toilet is currently open.
- Source update and verification dates are not project observation dates.
- Nearby toilets must not be assigned to venues without evidence.
- All retained records remain in the outputs, including review candidates.
- Exact-coordinate checks do not detect every possible duplicate.
- Borough percentages describe this dataset, not all real-world toilets.
- The supplied boundary version determines the spatial filtering result.

## Current review status
25 records are flagged across
12 shared-coordinate groups.
No records have been merged or relocated.
Unflagged records have not been independently verified.

## Source and attribution
Toilet Map dataset: https://www.toiletmap.org.uk/dataset
Retain the source's CC BY 4.0 attribution and indicate that the data was
filtered, standardised and annotated by the Access London team.
Retain the original team boundary package and its source/licence information.

## Reproduction
Use the raw files identified in toilets_source_manifest.json.
Install the dependencies listed in requirements.txt.
Run scripts 01 through 08 in numerical order.

Script 05 preserves an existing review worksheet.
Script 06 stops if its assessed output already exists.
For a full rerun, use a separate project copy with an empty outputs folder,
while retaining the original inputs and scripts.
Review decisions apply to this batch and must be reassessed for new source data.
