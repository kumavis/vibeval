0.014999999999999999::bio_hazard.
0.059999999999999998::bio_mass_death.
0.012::nuclear_hazard.
0.17999999999999999::nuclear_mass_death.
0.0060000000000000001::control_hazard.
0.12::control_mass_death.
bio_route :- bio_hazard, bio_mass_death.
nuclear_route :- nuclear_hazard, nuclear_mass_death.
control_route :- control_hazard, control_mass_death.
p_doom :- bio_route.
p_doom :- nuclear_route.
p_doom :- control_route.
query(bio_route).
query(control_route).
query(nuclear_route).
query(p_doom).
