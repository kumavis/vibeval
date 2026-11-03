# November 3, 2026 ballot source inventory

Retrieved October 27, 2026. No model votes or recommendations are included here.

## Selected representative ballot

`san-leandro-ballot.json` is the **complete printed BT11 sample**, precinct label **454510 (0301)**, from pages **64–75** of Alameda County's official composite guide. It has **49 contests**: 20 candidate contests, 13 judicial retentions, 14 statewide propositions, Regional Transit Measure RTM, and San Lorenzo Unified School District Measure J.

This is a representative San Leandro ballot, not the user's personal ballot. San Leandro City Hall (835 East 14th Street) was investigated as an anchor, but its exact ballot style was not established. County GIS locates City Hall in consolidated precinct 458400. The selected sample is explicitly a different precinct and is used intact, without combining district contests.

BT11 has U.S. House district 10, Assembly district 20, BOE district 2, Chabot–Las Positas area 2, AC Transit ward 5, BART district 4, and EBMUD ward 7. Its printed city contests include mayor and council districts 1, 2 (short term), 3, and 5.

## San Leandro printed-ballot issue

San Leandro adopted district-based council elections in June 2026, but its November printed ballots contain all four council races. An October 12 municipal report confirms this discrepancy and the planned district tabulation. The county's October 24 notice says it will count/report votes and the city will determine winners using certified precinct results and district maps. The experiment follows the actual printed sample and is not personal voting guidance.

The county notice is accessible via direct HTTP download and indexed search; the web tool's text-open endpoint sometimes returns an ID-loading error. The original live HTML is retained in `raw/san-leandro-notice.html`.

## Primary sources

- [Official county election page](https://acvote.alamedacountyca.gov/election-information/elections?id=260)
- [Official county composite voter information guide](https://acvote.alamedacountyca.gov/acvote-assets/02_election_information/PDFs/20261103/Voter%20Information%20Guide/vig_nov2026_eng.pdf) — 965 PDF pages; saved locally.
- [Official county candidate list](https://alamedacountyca.gov/rov_app/candidatelist) — public read-only POST search with `electionId=260`, `raceStatus=onballot`, `candidateStatus=COMPLETED`; candidate names and seat counts extracted, duplicate desktop/mobile rendering deduplicated.
- [State certified candidate and judicial retention list](https://elections.cdn.sos.ca.gov/statewide-elections/2026-general/cert-list-candidates.pdf) — August 27, 2026; 42 PDF pages.
- [Official statewide propositions](https://voterguide.sos.ca.gov/propositions/)
- [October 24 county notice](https://acvote.alamedacountyca.gov/main/article?newsid=sanleandro)
- [October 12 municipal report and Reso 2026-131](https://sanleandro.legistar.com/LegislationDetail.aspx?FullText=1&GUID=FC539250-F086-4D6D-9762-C7259CB1DDA4&ID=8285082&Options=&Search=)
- [Official county district lookup](https://alamedacountyca.gov/rovapps/districtlookup/)
- [Official November 2026 consolidated precinct map](https://data.acgov.org/datasets/a0a6b435f9a049d488854669d2376038_0)

## Additional inventories and provenance

`composite-ballot.json` contains 158 unique on-ballot contests across the county: 103 candidate contests, 13 judicial retentions, and 42 measures. It is a union of incompatible districts, not one voter's ballot. `oakland-ballot.json` is an unused verified alternative BT48.

All 13 retention names were individually checked in BT11. Candidate names are from the official search; printed sample text verifies the contest membership. The PDF's sample-ballot font mapping required a +29 character-code conversion for ASCII text. Accented letters can be imperfect in the intermediate extraction, so official candidate-list spellings take precedence. No new political content was inferred from text corruption.

Options include printed candidates. Qualified late write-ins, if any, require separate verification. `ranked` and `maxSelections` describe the printed voting layout. All BT11 candidate contests use Vote for One.

Bulky public source PDFs, HTML, original and decoded text, and GIS query responses remain locally in ignored `raw/`. `normalize_inventory.py` rebuilds composite/Oakland inventories from retained raw extracts; `build_san_leandro.py` rebuilds the selected 49-contest inventory from that composite and the decoded sample. No final shared `ballot.json` is created by these research scripts.
