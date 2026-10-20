0.80000000000000004::bio_access.
0.14999999999999999::bio_release.
0.12::bio_fatality.
0.65000000000000002::military_reliance.
0.059999999999999998::nuclear_trigger.
0.34999999999999998::nuclear_fatality.
0.84999999999999998::agentic_reach.
0.65000000000000002::strategic_capability.
0.17999999999999999::control_escape.
0.34999999999999998::entrenchment.
0.45000000000000001::autonomous_fatality.
0.080000000000000002::systemic_trigger.
0.050000000000000003::systemic_fatality.
bio_hazard :- bio_access, bio_release.
bio_catastrophe :- bio_hazard, bio_fatality.
nuclear_hazard :- military_reliance, nuclear_trigger.
nuclear_catastrophe :- nuclear_hazard, nuclear_fatality.
uncontrolled_campaign :- agentic_reach, strategic_capability, control_escape.
entrenched_ai :- uncontrolled_campaign, entrenchment.
autonomous_catastrophe :- entrenched_ai, autonomous_fatality.
systemic_hazard :- agentic_reach, systemic_trigger.
systemic_catastrophe :- systemic_hazard, systemic_fatality.
p_doom :- bio_catastrophe.
p_doom :- nuclear_catastrophe.
p_doom :- autonomous_catastrophe.
p_doom :- systemic_catastrophe.
query(autonomous_catastrophe).
query(bio_catastrophe).
query(bio_hazard).
query(entrenched_ai).
query(nuclear_catastrophe).
query(nuclear_hazard).
query(p_doom).
query(systemic_catastrophe).
query(systemic_hazard).
query(uncontrolled_campaign).
