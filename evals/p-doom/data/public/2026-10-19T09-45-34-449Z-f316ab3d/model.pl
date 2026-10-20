0.59999999999999998::bio_access.
0.12::bio_release.
0.12::bio_mortality.
0.75::critical_access.
0.5::strategic_autonomy.
0.20000000000000001::power_seeking.
0.25::control_loss.
0.45000000000000001::control_mortality.
0.059999999999999998::infrastructure_shock.
0.02::infrastructure_mortality.
0.65000000000000002::nuclear_exposure.
0.035000000000000003::nuclear_trigger.
0.34999999999999998::nuclear_mortality.
bio_event :- bio_access, bio_release.
p_doom :- bio_event, bio_mortality.
control_event :- critical_access, strategic_autonomy, power_seeking, control_loss.
p_doom :- control_event, control_mortality.
infrastructure_event :- critical_access, infrastructure_shock.
p_doom :- infrastructure_event, infrastructure_mortality.
nuclear_event :- nuclear_exposure, nuclear_trigger.
p_doom :- nuclear_event, nuclear_mortality.
query(bio_event).
query(control_event).
query(infrastructure_event).
query(nuclear_event).
query(p_doom).
