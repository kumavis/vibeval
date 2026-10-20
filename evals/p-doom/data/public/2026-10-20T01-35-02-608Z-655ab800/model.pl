0.69999999999999996::bio_enabling.
0.12::bio_release.
0.55000000000000004::bio_spread.
0.12::bio_fatal.
0.45000000000000001::nuclear_context.
0.035000000000000003::nuclear_trigger.
0.5::nuclear_fatal.
0.65000000000000002::digital_delegation.
0.29999999999999999::autonomous_power.
0.12::control_break.
0.22::control_fatal.
0.059999999999999998::cascade_initiation.
0.040000000000000001::cascade_fatal.
bio_hazard :- bio_enabling, bio_release.
bio_global :- bio_hazard, bio_spread.
p_doom :- bio_global, bio_fatal.
nuclear_hazard :- nuclear_context, nuclear_trigger.
p_doom :- nuclear_hazard, nuclear_fatal.
control_hazard :- digital_delegation, autonomous_power, control_break.
p_doom :- control_hazard, control_fatal.
service_hazard :- digital_delegation, cascade_initiation.
p_doom :- service_hazard, cascade_fatal.
query(bio_global).
query(bio_hazard).
query(control_hazard).
query(nuclear_hazard).
query(p_doom).
query(service_hazard).
